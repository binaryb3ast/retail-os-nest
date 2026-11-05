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
  | 'AUTH.SESSION_REVOKED';

export interface UserAuditEventInput {
  readonly action: UserAuditAction;
  readonly actor: AuditActor;
  readonly targetType: 'USER' | 'IDENTITY';
  readonly targetId: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly identityType?: UserIdentityType;
  readonly previousStatus?: UserStatus;
  readonly newStatus?: UserStatus;
  readonly branchId?: Types.ObjectId | null;
  readonly reason?: string;
}
