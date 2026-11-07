import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { BranchesService } from '../branches/branches.service';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { UsersService } from '../users/users.service';
import {
  BranchMembershipRecord,
  BranchMembershipStatus,
} from './branch-membership.schema';

export interface BranchMembershipView {
  readonly id: string;
  readonly userId: string;
  readonly branchId: string;
  readonly status: BranchMembershipStatus;
  readonly joinedAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const membershipTransitions: Readonly<
  Record<BranchMembershipStatus, readonly BranchMembershipStatus[]>
> = {
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: ['ACTIVE'],
};

@Injectable()
export class BranchMembershipsService implements OnModuleInit {
  constructor(
    @InjectModel(BranchMembershipRecord.name)
    private readonly memberships: Model<BranchMembershipRecord>,
    private readonly branches: BranchesService,
    private readonly users: UsersService,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.memberships.createIndexes();
  }

  async add(
    userId: string,
    branchId: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<BranchMembershipView> {
    const memberId = this.parseId(userId, 'USER_ID_INVALID');
    const ownerBranchId = this.parseId(branchId, 'BRANCH_ID_INVALID');

    try {
      return await this.transactions.execute(async (session) => {
        const branch = await this.branches.findActiveById(
          ownerBranchId,
          session,
        );
        if (!branch) {
          throw this.exception(
            'BRANCH_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The active branch does not exist.',
          );
        }
        const user = await this.users.getAuthenticationState(memberId, session);
        if (!user || user.status === 'DEACTIVATED') {
          throw this.exception(
            'USER_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The user does not exist.',
          );
        }

        const [membership] = await this.memberships.create(
          [
            {
              userId: memberId,
              branchId: ownerBranchId,
              status: 'ACTIVE',
              joinedAt: new Date(),
              revokedAt: null,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            action: 'BRANCH_MEMBERSHIP.CREATED',
            actor,
            targetType: 'BRANCH_MEMBERSHIP',
            targetId: membership._id,
            userId: memberId,
            branchId: ownerBranchId,
            newMembershipStatus: 'ACTIVE',
            reason,
          },
          session,
        );
        return this.toView(membership);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'BRANCH_MEMBERSHIP_EXISTS',
          HttpStatus.CONFLICT,
          'The user already has a membership record for this branch.',
        );
      }
      throw error;
    }
  }

  async changeStatus(
    membershipId: string,
    nextStatus: BranchMembershipStatus,
    actor: AuditActor,
    reason?: string,
  ): Promise<BranchMembershipView> {
    const objectId = this.parseId(membershipId, 'BRANCH_MEMBERSHIP_ID_INVALID');
    return this.transactions.execute(async (session) => {
      const membership = await this.memberships
        .findById(objectId)
        .session(session)
        .exec();
      if (!membership) {
        throw this.exception(
          'BRANCH_MEMBERSHIP_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The branch membership does not exist.',
        );
      }
      if (membership.status === nextStatus) return this.toView(membership);
      if (!membershipTransitions[membership.status].includes(nextStatus)) {
        throw this.exception(
          'BRANCH_MEMBERSHIP_TRANSITION_INVALID',
          HttpStatus.CONFLICT,
          'The requested membership status transition is not allowed.',
        );
      }

      if (nextStatus === 'ACTIVE') {
        const branch = await this.branches.findActiveById(
          membership.branchId,
          session,
        );
        if (!branch) {
          throw this.exception(
            'BRANCH_NOT_FOUND',
            HttpStatus.CONFLICT,
            'An inactive branch cannot receive an active membership.',
          );
        }
        const user = await this.users.getAuthenticationState(
          membership.userId,
          session,
        );
        if (!user || user.status === 'DEACTIVATED') {
          throw this.exception(
            'USER_NOT_FOUND',
            HttpStatus.CONFLICT,
            'A deactivated or missing user cannot receive an active membership.',
          );
        }
      }

      const previousStatus = membership.status;
      membership.status = nextStatus;
      if (previousStatus === 'REVOKED' && nextStatus === 'ACTIVE') {
        membership.joinedAt = new Date();
      }
      membership.revokedAt = nextStatus === 'REVOKED' ? new Date() : null;
      await membership.save({ session });
      await this.audit.record(
        {
          action: 'BRANCH_MEMBERSHIP.STATUS_CHANGED',
          actor,
          targetType: 'BRANCH_MEMBERSHIP',
          targetId: membership._id,
          userId: membership.userId,
          branchId: membership.branchId,
          previousMembershipStatus: previousStatus,
          newMembershipStatus: nextStatus,
          reason,
        },
        session,
      );
      return this.toView(membership);
    });
  }

  async isActiveMember(
    userId: Types.ObjectId,
    branchId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    let query = this.memberships.exists({ userId, branchId, status: 'ACTIVE' });
    if (session) query = query.session(session);
    return Boolean(await query);
  }

  private parseId(value: string, code: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value)) {
      throw this.exception(
        code,
        HttpStatus.BAD_REQUEST,
        'The identifier is invalid.',
      );
    }
    return new Types.ObjectId(value);
  }

  private toView(
    membership: BranchMembershipRecord & { _id: Types.ObjectId },
  ): BranchMembershipView {
    return {
      id: membership._id.toString(),
      userId: membership.userId.toString(),
      branchId: membership.branchId.toString(),
      status: membership.status,
      joinedAt: membership.joinedAt,
      revokedAt: membership.revokedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
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
