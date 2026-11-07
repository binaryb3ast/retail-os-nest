import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { BranchMembershipsService } from '../branch-memberships/branch-memberships.service';
import { BranchesService } from '../branches/branches.service';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { UsersService } from '../users/users.service';
import { RolesService } from './roles.service';
import {
  AssignmentScope,
  RoleAssignmentRecord,
  RoleAssignmentStatus,
} from './role-assignment.schema';

export type RoleAssignmentTarget =
  | { readonly scope: 'SYSTEM' }
  | { readonly scope: 'BRANCH'; readonly branchId: string };

export interface RoleAssignmentView {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly scope: AssignmentScope;
  readonly branchId: string | null;
  readonly status: RoleAssignmentStatus;
  readonly assignedByUserId: string | null;
  readonly assignedAt: Date;
  readonly revokedAt: Date | null;
}

@Injectable()
export class RoleAssignmentsService implements OnModuleInit {
  constructor(
    @InjectModel(RoleAssignmentRecord.name)
    private readonly assignments: Model<RoleAssignmentRecord>,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly branches: BranchesService,
    private readonly memberships: BranchMembershipsService,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.assignments.createIndexes();
  }

  async assign(
    userId: string,
    roleId: string,
    target: RoleAssignmentTarget,
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleAssignmentView> {
    const memberId = this.parseId(userId, 'USER_ID_INVALID');
    const assignedRoleId = this.parseId(roleId, 'ROLE_ID_INVALID');
    const branchId =
      target.scope === 'BRANCH'
        ? this.parseId(target.branchId, 'BRANCH_ID_INVALID')
        : null;

    try {
      return await this.transactions.execute(async (session) => {
        const user = await this.users.getAuthenticationState(memberId, session);
        if (!user || user.status === 'DEACTIVATED') {
          throw this.exception(
            'USER_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The user does not exist.',
          );
        }
        const role = await this.roles.getActiveForAuthorization(
          assignedRoleId,
          session,
        );
        if (!role)
          throw this.exception(
            'ROLE_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The active role does not exist.',
          );
        if (branchId) {
          const branch = await this.branches.findActiveById(branchId, session);
          if (!branch)
            throw this.exception(
              'BRANCH_NOT_FOUND',
              HttpStatus.NOT_FOUND,
              'The active branch does not exist.',
            );
          if (
            !(await this.memberships.isActiveMember(
              memberId,
              branchId,
              session,
            ))
          ) {
            throw this.exception(
              'ACTIVE_BRANCH_MEMBERSHIP_REQUIRED',
              HttpStatus.CONFLICT,
              'The user must have an active membership in this branch.',
            );
          }
        }

        let assignment = await this.assignments
          .findOne({
            userId: memberId,
            roleId: assignedRoleId,
            scope: target.scope,
            branchId,
          })
          .session(session)
          .exec();
        const previousStatus = assignment?.status ?? null;
        if (assignment?.status === 'ACTIVE') {
          throw this.exception(
            'ROLE_ASSIGNMENT_EXISTS',
            HttpStatus.CONFLICT,
            'The role is already assigned in this scope.',
          );
        }
        if (assignment) {
          assignment.status = 'ACTIVE';
          assignment.assignedByUserId =
            actor.type === 'USER' ? actor.userId : null;
          assignment.assignedAt = new Date();
          assignment.revokedAt = null;
          await assignment.save({ session });
        } else {
          [assignment] = await this.assignments.create(
            [
              {
                userId: memberId,
                roleId: assignedRoleId,
                scope: target.scope,
                branchId,
                status: 'ACTIVE',
                assignedByUserId: actor.type === 'USER' ? actor.userId : null,
                assignedAt: new Date(),
                revokedAt: null,
              },
            ],
            { session },
          );
        }
        await this.audit.record(
          {
            action:
              previousStatus === 'REVOKED'
                ? 'ROLE_ASSIGNMENT.REACTIVATED'
                : 'ROLE_ASSIGNMENT.CREATED',
            actor,
            targetType: 'ROLE_ASSIGNMENT',
            targetId: assignment._id,
            userId: memberId,
            roleCode: role.code,
            assignmentScope: target.scope,
            branchId,
            newAssignmentStatus: 'ACTIVE',
            reason,
          },
          session,
        );
        return this.toView(assignment);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'ROLE_ASSIGNMENT_EXISTS',
          HttpStatus.CONFLICT,
          'The role is already assigned in this scope.',
        );
      }
      throw error;
    }
  }

  async revoke(
    assignmentId: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleAssignmentView> {
    const objectId = this.parseId(assignmentId, 'ROLE_ASSIGNMENT_ID_INVALID');
    return this.transactions.execute(async (session) => {
      const assignment = await this.assignments
        .findById(objectId)
        .session(session)
        .exec();
      if (!assignment)
        throw this.exception(
          'ROLE_ASSIGNMENT_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The role assignment does not exist.',
        );
      if (assignment.status === 'REVOKED') return this.toView(assignment);
      assignment.status = 'REVOKED';
      assignment.revokedAt = new Date();
      await assignment.save({ session });
      const role = await this.roles.getActiveForAuthorization(
        assignment.roleId,
        session,
      );
      await this.audit.record(
        {
          action: 'ROLE_ASSIGNMENT.REVOKED',
          actor,
          targetType: 'ROLE_ASSIGNMENT',
          targetId: assignment._id,
          userId: assignment.userId,
          roleCode: role?.code ?? null,
          assignmentScope: assignment.scope,
          branchId: assignment.branchId,
          previousAssignmentStatus: 'ACTIVE',
          newAssignmentStatus: 'REVOKED',
          reason,
        },
        session,
      );
      return this.toView(assignment);
    });
  }

  async getActiveRoleIdsForAuthorization(
    userId: Types.ObjectId,
    branchId?: Types.ObjectId,
  ): Promise<readonly Types.ObjectId[]> {
    const scopeFilter = branchId
      ? { $or: [{ scope: 'SYSTEM' }, { scope: 'BRANCH', branchId }] }
      : { scope: 'SYSTEM' };
    const assignments = await this.assignments
      .find({ userId, status: 'ACTIVE', ...scopeFilter })
      .select('roleId')
      .lean()
      .exec();
    return [
      ...new Map(
        assignments.map(({ roleId }) => [roleId.toString(), roleId]),
      ).values(),
    ];
  }

  private parseId(value: string, code: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value))
      throw this.exception(
        code,
        HttpStatus.BAD_REQUEST,
        'The identifier is invalid.',
      );
    return new Types.ObjectId(value);
  }

  private toView(
    assignment: RoleAssignmentRecord & { _id: Types.ObjectId },
  ): RoleAssignmentView {
    return {
      id: assignment._id.toString(),
      userId: assignment.userId.toString(),
      roleId: assignment.roleId.toString(),
      scope: assignment.scope,
      branchId: assignment.branchId?.toString() ?? null,
      status: assignment.status,
      assignedByUserId: assignment.assignedByUserId?.toString() ?? null,
      assignedAt: assignment.assignedAt,
      revokedAt: assignment.revokedAt,
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private exception(
    code: string,
    status: HttpStatus,
    detail: string,
  ): ApplicationException {
    return new ApplicationException(code, status, detail);
  }
}
