import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const branchStatuses = ['ACTIVE', 'DEACTIVATED'] as const;
export type BranchStatus = (typeof branchStatuses)[number];

@Schema({
  collection: 'branches',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class BranchRecord {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 120,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    minlength: 2,
    maxlength: 32,
  })
  code!: string;

  @Prop({
    type: String,
    required: true,
    enum: branchStatuses,
    default: 'ACTIVE',
  })
  status!: BranchStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export type BranchDocument = HydratedDocument<BranchRecord>;
export const BranchSchema = SchemaFactory.createForClass(BranchRecord);
BranchSchema.index({ code: 1 }, { unique: true, name: 'uniq_branch_code' });
