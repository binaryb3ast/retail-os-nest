import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'user_sessions', timestamps: true, strict: 'throw', versionKey: false })
export class UserSessionRecord {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'UserRecord' })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, select: false })
  tokenHash!: string;

  @Prop({ type: Number, required: true, min: 0 })
  authVersion!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, maxlength: 100, default: null })
  revocationReason!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserSessionDocument = HydratedDocument<UserSessionRecord>;
export const UserSessionSchema = SchemaFactory.createForClass(UserSessionRecord);
UserSessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_session_token_hash' });
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_expire_at' });
UserSessionSchema.index({ userId: 1, createdAt: -1 }, { name: 'sessions_by_user' });
