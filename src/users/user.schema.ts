import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserAccountType = 'HUMAN' | 'SERVICE';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

@Schema({
  collection: 'users',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class UserRecord {
  @Prop({ type: String, required: true, enum: ['HUMAN', 'SERVICE'] })
  accountType!: UserAccountType;

  @Prop({
    type: String,
    required: true,
    enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
    default: 'INVITED',
  })
  status!: UserStatus;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  lastName!: string;

  @Prop({ type: String, trim: true, maxlength: 150, default: null })
  displayName!: string | null;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  authVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<UserRecord>;
export const UserSchema = SchemaFactory.createForClass(UserRecord);

UserSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'users_by_status_created' },
);
