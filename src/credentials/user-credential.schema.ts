import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'user_credentials', timestamps: true, strict: 'throw', versionKey: false })
export class UserCredentialRecord {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'UserRecord' })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({ type: Date, required: true })
  passwordChangedAt!: Date;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  failedAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop({ type: Date, default: null })
  lastFailedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1, min: 1 })
  revision!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserCredentialDocument = HydratedDocument<UserCredentialRecord>;
export const UserCredentialSchema = SchemaFactory.createForClass(UserCredentialRecord);
UserCredentialSchema.index({ userId: 1 }, { unique: true, name: 'uniq_credential_per_user' });
