import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { BranchMembershipsService } from '../branch-memberships/branch-memberships.service';
import { BranchesService } from '../branches/branches.service';
import { ApplicationException } from '../core/errors/application.exception';
import { UsersService } from '../users/users.service';
import { RoleAssignmentsService } from '../roles/role-assignments.service';
import { RolesService } from '../roles/roles.service';
import {
  isPermissionKey,
  permissionKeys,
  PermissionKey,
} from './permissions.registry';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly users: UsersService,
    private readonly branches: BranchesService,
    private readonly memberships: BranchMembershipsService,
    private readonly assignments: RoleAssignmentsService,
    private readonly roles: RolesService,
  ) {}

  async hasPermission(
    userId: Types.ObjectId,
    permission: PermissionKey,
    branchId?: Types.ObjectId,
  ): Promise<boolean> {
    if (!isPermissionKey(permission)) return false;
    const user = await this.users.getAuthenticationState(userId);
    if (!user || user.status !== 'ACTIVE') return false;

    if (branchId) {
      if (!(await this.branches.findActiveById(branchId))) return false;
      if (!(await this.memberships.isActiveMember(userId, branchId)))
        return false;
    }

    const roleIds = await this.assignments.getActiveRoleIdsForAuthorization(
      userId,
      branchId,
    );
    const roles = await this.roles.getActiveManyForAuthorization(roleIds);
    return roles.some((role) => role.permissions.includes(permission));
  }

  async requirePermission(
    userId: Types.ObjectId,
    permission: PermissionKey,
    branchId?: Types.ObjectId,
  ): Promise<void> {
    if (await this.hasPermission(userId, permission, branchId)) return;
    throw new ApplicationException(
      'PERMISSION_DENIED',
      HttpStatus.FORBIDDEN,
      'The user is not authorized to perform this action.',
    );
  }

  async getEffectivePermissions(
    userId: Types.ObjectId,
    branchId?: Types.ObjectId,
  ): Promise<readonly PermissionKey[]> {
    const user = await this.users.getAuthenticationState(userId);
    if (!user || user.status !== 'ACTIVE') return [];
    if (branchId) {
      if (!(await this.branches.findActiveById(branchId))) return [];
      if (!(await this.memberships.isActiveMember(userId, branchId))) return [];
    }
    const roleIds = await this.assignments.getActiveRoleIdsForAuthorization(
      userId,
      branchId,
    );
    const roles = await this.roles.getActiveManyForAuthorization(roleIds);
    const granted = new Set(roles.flatMap((role) => role.permissions));
    return permissionKeys.filter((permission) => granted.has(permission));
  }
}
