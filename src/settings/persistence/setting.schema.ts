import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { SettingScope } from '../domain/setting-scope';

@Schema({ collection: 'settings', timestamps: true, strict: 'throw' })
export class SettingRecord {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true, enum: ['SYSTEM', 'BRANCH'] })
  scope!: SettingScope;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, ref: 'Branch' })
  branchId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: unknown;

  @Prop({ type: Number, required: true, min: 1 })
  revision!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SettingDocument = HydratedDocument<SettingRecord>;
export const SettingSchema = SchemaFactory.createForClass(SettingRecord);

SettingSchema.pre('validate', function () {
  if (this.scope === 'SYSTEM' && this.branchId !== null) {
    this.invalidate('branchId', 'SYSTEM settings cannot belong to a branch');
  }
  if (this.scope === 'BRANCH' && !(this.branchId instanceof Types.ObjectId)) {
    this.invalidate('branchId', 'BRANCH settings require a branch identifier');
  }
});

SettingSchema.index(
  { key: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: 'SYSTEM' },
    name: 'uniq_system_setting_key',
  },
);
SettingSchema.index(
  { key: 1, branchId: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: 'BRANCH' },
    name: 'uniq_branch_setting_key',
  },
);
