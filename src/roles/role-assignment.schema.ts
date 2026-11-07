import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BranchRecord } from '../branches/branch.schema';
import { UserRecord } from '../users/user.schema';
import { RoleRecord } from './role.schema';

export const assignmentScopes = ['SYSTEM', 'BRANCH'] as const;
export type AssignmentScope = (typeof assignmentScopes)[number];
export const roleAssignmentStatuses = ['ACTIVE', 'REVOKED'] as const;
export type RoleAssignmentStatus = (typeof roleAssignmentStatuses)[number];

@Schema({
  collection: 'role_assignments',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class RoleAssignmentRecord {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: UserRecord.name,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: RoleRecord.name,
  })
  roleId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: assignmentScopes })
  scope!: AssignmentScope;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null,
    ref: BranchRecord.name,
  })
  branchId!: Types.ObjectId | null;

  @Prop({
    type: String,
    required: true,
    enum: roleAssignmentStatuses,
    default: 'ACTIVE',
  })
  status!: RoleAssignmentStatus;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null,
    ref: UserRecord.name,
  })
  assignedByUserId!: Types.ObjectId | null;

  @Prop({ type: Date, required: true, default: Date.now })
  assignedAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RoleAssignmentDocument = HydratedDocument<RoleAssignmentRecord>;
export const RoleAssignmentSchema =
  SchemaFactory.createForClass(RoleAssignmentRecord);
RoleAssignmentSchema.index(
  { userId: 1, roleId: 1, scope: 1, branchId: 1 },
  { unique: true, name: 'uniq_role_assignment_per_scope' },
);
RoleAssignmentSchema.index(
  { userId: 1, status: 1, scope: 1, branchId: 1 },
  { name: 'assignments_by_user_scope_status' },
);
RoleAssignmentSchema.index(
  { branchId: 1, status: 1, userId: 1 },
  { name: 'assignments_by_branch_status_user' },
);

RoleAssignmentSchema.pre('validate', function () {
  if (this.scope === 'SYSTEM' && this.branchId !== null) {
    this.invalidate('branchId', 'System assignments cannot reference a branch');
  }
  if (this.scope === 'BRANCH' && !this.branchId) {
    this.invalidate(
      'branchId',
      'Branch assignments require a branch identifier',
    );
  }
});
