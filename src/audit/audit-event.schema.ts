import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { UserIdentityType } from '../identities/user-identity.schema';
import type { UserStatus } from '../users/user.schema';
import type { UserAuditAction } from './audit.types';

@Schema({
  collection: 'audit_events',
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  versionKey: false,
})
export class AuditEventRecord {
  @Prop({
    type: String,
    required: true,
    enum: [
      'USER.CREATED',
      'USER.PROFILE_UPDATED',
      'USER.STATUS_CHANGED',
      'USER.IDENTITY_ADDED',
      'USER.IDENTITY_REMOVED',
      'USER.IDENTITY_PRIMARY_CHANGED',
    'USER.PASSWORD_SET',
    'USER.PASSWORD_CHANGED',
    'AUTH.LOGIN_SUCCEEDED',
    'AUTH.SESSION_CREATED',
    'AUTH.SESSION_REVOKED',
    ],
    immutable: true,
  })
  action!: UserAuditAction;

  @Prop({
    type: String,
    required: true,
    enum: ['USER', 'SYSTEM'],
    immutable: true,
  })
  actorType!: 'USER' | 'SYSTEM';

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, immutable: true })
  actorUserId!: Types.ObjectId | null;

  @Prop({ type: String, maxlength: 100, default: null, immutable: true })
  actorLabel!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: ['USER', 'IDENTITY'],
    immutable: true,
  })
  targetType!: 'USER' | 'IDENTITY';

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  targetId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['USERNAME', 'EMAIL'],
    default: null,
    immutable: true,
  })
  identityType!: UserIdentityType | null;

  @Prop({
    type: String,
    enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
    default: null,
    immutable: true,
  })
  previousStatus!: UserStatus | null;

  @Prop({
    type: String,
    enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
    default: null,
    immutable: true,
  })
  newStatus!: UserStatus | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, immutable: true })
  branchId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, immutable: true })
  requestId!: string;

  @Prop({ type: String, required: true, immutable: true })
  correlationId!: string;

  @Prop({ type: String, maxlength: 500, default: null, immutable: true })
  reason!: string | null;

  createdAt!: Date;
}

export type AuditEventDocument = HydratedDocument<AuditEventRecord>;
export const AuditEventSchema = SchemaFactory.createForClass(AuditEventRecord);
AuditEventSchema.index(
  { targetType: 1, targetId: 1, createdAt: -1 },
  { name: 'audit_by_target' },
);
AuditEventSchema.index(
  { actorUserId: 1, createdAt: -1 },
  { name: 'audit_by_actor' },
);

AuditEventSchema.pre('validate', function () {
  if (this.actorType === 'USER' && !this.actorUserId) {
    this.invalidate(
      'actorUserId',
      'User audit actors require a user identifier',
    );
  }
  if (this.actorType === 'SYSTEM' && !this.actorLabel) {
    this.invalidate('actorLabel', 'System audit actors require a label');
  }
});
