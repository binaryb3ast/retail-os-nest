import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { SettingScope } from '../domain/setting-scope';

export type SettingAuditAction =
  | 'SETTING.CREATED'
  | 'SETTING.UPDATED'
  | 'SETTING.RESET'
  | 'SETTING.BRANCH_OVERRIDE.CREATED'
  | 'SETTING.BRANCH_OVERRIDE.REMOVED';

@Schema({
  collection: 'setting_audits',
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  versionKey: false,
})
export class SettingAuditRecord {
  @Prop({
    type: String,
    required: true,
    enum: [
      'SETTING.CREATED',
      'SETTING.UPDATED',
      'SETTING.RESET',
      'SETTING.BRANCH_OVERRIDE.CREATED',
      'SETTING.BRANCH_OVERRIDE.REMOVED',
    ],
    immutable: true,
  })
  action!: SettingAuditAction;

  @Prop({ type: String, required: true, immutable: true })
  key!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['SYSTEM', 'BRANCH'],
    immutable: true,
  })
  scope!: SettingScope;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, immutable: true })
  branchId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null, immutable: true })
  previousValue!: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null, immutable: true })
  newValue!: unknown;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  actorId!: Types.ObjectId;

  @Prop({ type: String, required: true, immutable: true })
  requestId!: string;

  @Prop({ type: String, maxlength: 500, default: null, immutable: true })
  reason!: string | null;

  @Prop({ type: Number, required: true, min: 1, immutable: true })
  revision!: number;

  createdAt!: Date;
}

export type SettingAuditDocument = HydratedDocument<SettingAuditRecord>;
export const SettingAuditSchema =
  SchemaFactory.createForClass(SettingAuditRecord);
SettingAuditSchema.index(
  { key: 1, scope: 1, branchId: 1, createdAt: -1 },
  { name: 'setting_audit_history' },
);
SettingAuditSchema.index(
  { actorId: 1, createdAt: -1 },
  { name: 'setting_audit_actor_history' },
);
