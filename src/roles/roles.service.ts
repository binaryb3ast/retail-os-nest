import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import {
  parsePermissions,
  PermissionKey,
} from '../authorization/permissions.registry';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { RoleRecord } from './role.schema';

export interface RoleView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly description: string | null;
  readonly permissions: readonly PermissionKey[];
  readonly isSystem: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ActiveRoleForAuthorization {
  readonly id: Types.ObjectId;
  readonly code: string;
  readonly permissions: readonly PermissionKey[];
}

export interface RoleListResult {
  readonly data: readonly RoleView[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pageCount: number;
}

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @InjectModel(RoleRecord.name) private readonly roles: Model<RoleRecord>,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.roles.createIndexes();
  }

  async create(
    input: {
      readonly name: string;
      readonly code: string;
      readonly description?: string | null;
      readonly permissions: readonly string[];
    },
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleView> {
    const name = this.normalizeName(input.name);
    const code = this.normalizeCode(input.code);
    const description = this.normalizeDescription(input.description);
    const permissions = this.normalizePermissions(input.permissions);

    try {
      return await this.transactions.execute(async (session) => {
        const [role] = await this.roles.create(
          [
            {
              name,
              code,
              description,
              permissions,
              isSystem: false,
              isActive: true,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            action: 'ROLE.CREATED',
            actor,
            targetType: 'ROLE',
            targetId: role._id,
            roleCode: role.code,
            newPermissions: role.permissions,
            reason,
          },
          session,
        );
        return this.toView(role);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'ROLE_CODE_CONFLICT',
          HttpStatus.CONFLICT,
          'A role with this code already exists.',
        );
      }
      throw error;
    }
  }

  async createSystemRole(
    input: {
      readonly name: string;
      readonly code: string;
      readonly description?: string | null;
      readonly permissions: readonly string[];
    },
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleView> {
    if (actor.type !== 'SYSTEM') {
      throw this.exception(
        'SYSTEM_ROLE_CREATION_FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'System roles can only be created by a system operation.',
      );
    }
    const name = this.normalizeName(input.name);
    const code = this.normalizeCode(input.code);
    const description = this.normalizeDescription(input.description);
    const permissions = this.normalizePermissions(input.permissions);
    try {
      return await this.transactions.execute(async (session) => {
        const [role] = await this.roles.create(
          [
            {
              name,
              code,
              description,
              permissions,
              isSystem: true,
              isActive: true,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            action: 'ROLE.SYSTEM_CREATED',
            actor,
            targetType: 'ROLE',
            targetId: role._id,
            roleCode: role.code,
            newPermissions: role.permissions,
            reason,
          },
          session,
        );
        return this.toView(role);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'ROLE_CODE_CONFLICT',
          HttpStatus.CONFLICT,
          'A role with this code already exists.',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly permissions?: readonly string[];
    },
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleView> {
    const objectId = this.parseId(id, 'ROLE_ID_INVALID');
    const changes: {
      name?: string;
      description?: string | null;
      permissions?: PermissionKey[];
    } = {};
    if (input.name !== undefined) changes.name = this.normalizeName(input.name);
    if (input.description !== undefined)
      changes.description = this.normalizeDescription(input.description);
    if (input.permissions !== undefined)
      changes.permissions = this.normalizePermissions(input.permissions);
    if (Object.keys(changes).length === 0) {
      throw this.exception(
        'ROLE_UPDATE_EMPTY',
        HttpStatus.BAD_REQUEST,
        'At least one role field is required.',
      );
    }

    return this.transactions.execute(async (session) => {
      const role = await this.roles.findById(objectId).session(session).exec();
      if (!role)
        throw this.exception(
          'ROLE_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The role does not exist.',
        );
      this.assertCustomRole(role);
      const previousPermissions = role.permissions;
      Object.assign(role, changes);
      await role.save({ session });
      await this.audit.record(
        {
          action: 'ROLE.UPDATED',
          actor,
          targetType: 'ROLE',
          targetId: role._id,
          roleCode: role.code,
          previousPermissions,
          newPermissions: role.permissions,
          reason,
        },
        session,
      );
      return this.toView(role);
    });
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: AuditActor,
    reason?: string,
  ): Promise<RoleView> {
    const objectId = this.parseId(id, 'ROLE_ID_INVALID');
    return this.transactions.execute(async (session) => {
      const role = await this.roles.findById(objectId).session(session).exec();
      if (!role)
        throw this.exception(
          'ROLE_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The role does not exist.',
        );
      this.assertCustomRole(role);
      if (role.isActive === isActive) return this.toView(role);
      role.isActive = isActive;
      await role.save({ session });
      await this.audit.record(
        {
          action: 'ROLE.STATUS_CHANGED',
          actor,
          targetType: 'ROLE',
          targetId: role._id,
          roleCode: role.code,
          previousRoleActive: !isActive,
          newRoleActive: isActive,
          reason,
        },
        session,
      );
      return this.toView(role);
    });
  }

  async getActiveForAuthorization(
    roleId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ActiveRoleForAuthorization | null> {
    let query = this.roles
      .findOne({ _id: roleId, isActive: true })
      .select('_id code permissions');
    if (session) query = query.session(session);
    const role = await query.lean().exec();
    return role
      ? { id: role._id, code: role.code, permissions: role.permissions }
      : null;
  }

  async listAdmin(input: {
    readonly page: number;
    readonly limit: number;
    readonly search?: string;
    readonly isActive?: boolean;
  }): Promise<RoleListResult> {
    const filter: Record<string, unknown> = {};
    if (input.isActive !== undefined) filter.isActive = input.isActive;
    const search = input.search?.trim().slice(0, 100);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { code: { $regex: escaped, $options: 'i' } },
      ];
    }
    const skip = (input.page - 1) * input.limit;
    const [records, total] = await Promise.all([
      this.roles
        .find(filter)
        .sort({ isSystem: -1, code: 1 })
        .skip(skip)
        .limit(input.limit)
        .exec(),
      this.roles.countDocuments(filter).exec(),
    ]);
    return {
      data: records.map((role) => this.toView(role)),
      page: input.page,
      limit: input.limit,
      total,
      pageCount: Math.ceil(total / input.limit),
    };
  }

  async dashboardCounts(): Promise<{
    readonly total: number;
    readonly active: number;
  }> {
    const [total, active] = await Promise.all([
      this.roles.countDocuments({}).exec(),
      this.roles.countDocuments({ isActive: true }).exec(),
    ]);
    return { total, active };
  }

  async getActiveManyForAuthorization(
    roleIds: readonly Types.ObjectId[],
  ): Promise<readonly ActiveRoleForAuthorization[]> {
    if (roleIds.length === 0) return [];
    const roles = await this.roles
      .find({ _id: { $in: roleIds }, isActive: true })
      .select('_id code permissions')
      .lean()
      .exec();
    return roles.map((role) => ({
      id: role._id,
      code: role.code,
      permissions: role.permissions,
    }));
  }

  private normalizePermissions(values: readonly string[]): PermissionKey[] {
    try {
      return [...parsePermissions(values)];
    } catch {
      throw this.exception(
        'ROLE_PERMISSION_INVALID',
        HttpStatus.BAD_REQUEST,
        'The role contains an unknown permission.',
      );
    }
  }

  private normalizeName(value: string): string {
    if (typeof value !== 'string')
      throw this.exception(
        'ROLE_INVALID',
        HttpStatus.BAD_REQUEST,
        'The role name is invalid.',
      );
    const name = value.trim().normalize('NFC');
    if (name.length < 1 || name.length > 80)
      throw this.exception(
        'ROLE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Role name must contain 1 to 80 characters.',
      );
    return name;
  }

  private normalizeCode(value: string): string {
    if (typeof value !== 'string')
      throw this.exception(
        'ROLE_INVALID',
        HttpStatus.BAD_REQUEST,
        'The role code is invalid.',
      );
    const code = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(code))
      throw this.exception(
        'ROLE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Role code must contain 2 to 48 letters, numbers, or underscores.',
      );
    return code;
  }

  private normalizeDescription(
    value: string | null | undefined,
  ): string | null {
    if (value === null || value === undefined) return null;
    const description = value.trim();
    if (description.length > 500)
      throw this.exception(
        'ROLE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Role description must be 500 characters or fewer.',
      );
    return description || null;
  }

  private assertCustomRole(role: RoleRecord): void {
    if (role.isSystem)
      throw this.exception(
        'SYSTEM_ROLE_PROTECTED',
        HttpStatus.FORBIDDEN,
        'System roles cannot be changed through custom role operations.',
      );
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

  private toView(role: RoleRecord & { _id: Types.ObjectId }): RoleView {
    return {
      id: role._id.toString(),
      name: role.name,
      code: role.code,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
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
