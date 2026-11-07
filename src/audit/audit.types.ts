import type { Types } from 'mongoose';
import type { UserIdentityType } from '../identities/user-identity.schema';
import type { UserStatus } from '../users/user.schema';

export type AuditActor =
  | { readonly type: 'USER'; readonly userId: Types.ObjectId }
  | { readonly type: 'SYSTEM'; readonly label: string };

export type UserAuditAction =
  | 'USER.CREATED'
  | 'USER.PROFILE_UPDATED'
  | 'USER.STATUS_CHANGED'
  | 'USER.IDENTITY_ADDED'
  | 'USER.IDENTITY_REMOVED'
  | 'USER.IDENTITY_PRIMARY_CHANGED'
  | 'USER.PASSWORD_SET'
  | 'USER.PASSWORD_CHANGED'
  | 'AUTH.LOGIN_SUCCEEDED'
  | 'AUTH.SESSION_CREATED'
  | 'AUTH.SESSION_REVOKED'
  | 'BRANCH.CREATED'
  | 'BRANCH.STATUS_CHANGED'
  | 'BRANCH_MEMBERSHIP.CREATED'
  | 'BRANCH_MEMBERSHIP.STATUS_CHANGED'
  | 'ROLE.CREATED'
  | 'ROLE.SYSTEM_CREATED'
  | 'ROLE.UPDATED'
  | 'ROLE.STATUS_CHANGED'
  | 'ROLE_ASSIGNMENT.CREATED'
  | 'ROLE_ASSIGNMENT.REACTIVATED'
  | 'ROLE_ASSIGNMENT.REVOKED';

export interface UserAuditEventInput {
  readonly action: UserAuditAction;
  readonly actor: AuditActor;
  readonly targetType:
    | 'USER'
    | 'IDENTITY'
    | 'BRANCH'
    | 'BRANCH_MEMBERSHIP'
    | 'ROLE'
    | 'ROLE_ASSIGNMENT';
  readonly targetId: Types.ObjectId;
  readonly userId?: Types.ObjectId | null;
  readonly identityType?: UserIdentityType;
  readonly previousStatus?: UserStatus;
  readonly newStatus?: UserStatus;
  readonly previousBranchStatus?: 'ACTIVE' | 'DEACTIVATED' | null;
  readonly newBranchStatus?: 'ACTIVE' | 'DEACTIVATED' | null;
  readonly previousMembershipStatus?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  readonly newMembershipStatus?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  readonly roleCode?: string | null;
  readonly previousPermissions?: readonly string[] | null;
  readonly newPermissions?: readonly string[] | null;
  readonly previousRoleActive?: boolean | null;
  readonly newRoleActive?: boolean | null;
  readonly assignmentScope?: 'SYSTEM' | 'BRANCH' | null;
  readonly previousAssignmentStatus?: 'ACTIVE' | 'REVOKED' | null;
  readonly newAssignmentStatus?: 'ACTIVE' | 'REVOKED' | null;
  readonly branchId?: Types.ObjectId | null;
  readonly reason?: string;
}
