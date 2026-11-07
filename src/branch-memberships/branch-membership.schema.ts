import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BranchRecord } from '../branches/branch.schema';
import { UserRecord } from '../users/user.schema';

export const branchMembershipStatuses = [
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
] as const;
export type BranchMembershipStatus = (typeof branchMembershipStatuses)[number];

@Schema({
  collection: 'branch_memberships',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class BranchMembershipRecord {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: UserRecord.name,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: BranchRecord.name,
  })
  branchId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: branchMembershipStatuses,
    default: 'ACTIVE',
  })
  status!: BranchMembershipStatus;

  @Prop({ type: Date, required: true, default: Date.now })
  joinedAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type BranchMembershipDocument = HydratedDocument<BranchMembershipRecord>;
export const BranchMembershipSchema = SchemaFactory.createForClass(
  BranchMembershipRecord,
);
BranchMembershipSchema.index(
  { userId: 1, branchId: 1 },
  { unique: true, name: 'uniq_membership_per_user_branch' },
);
BranchMembershipSchema.index(
  { branchId: 1, status: 1, userId: 1 },
  { name: 'memberships_by_branch_status_user' },
);
