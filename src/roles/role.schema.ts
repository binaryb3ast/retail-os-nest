import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  permissionKeys,
  PermissionKey,
} from '../authorization/permissions.registry';

@Schema({
  collection: 'roles',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class RoleRecord {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 80,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    minlength: 2,
    maxlength: 48,
  })
  code!: string;

  @Prop({ type: String, default: null, maxlength: 500 })
  description!: string | null;

  @Prop({ type: [String], required: true, enum: permissionKeys, default: [] })
  permissions!: PermissionKey[];

  @Prop({ type: Boolean, required: true, default: false })
  isSystem!: boolean;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RoleDocument = HydratedDocument<RoleRecord>;
export const RoleSchema = SchemaFactory.createForClass(RoleRecord);
RoleSchema.index({ code: 1 }, { unique: true, name: 'uniq_role_code' });
RoleSchema.index({ isActive: 1, code: 1 }, { name: 'roles_by_status_code' });
