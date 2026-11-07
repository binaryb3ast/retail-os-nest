import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({
  collection: 'login_rate_limits',
  timestamps: false,
  strict: 'throw',
  versionKey: false,
})
export class LoginRateLimitRecord {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Date, required: true })
  windowStartedAt!: Date;

  @Prop({ type: Number, required: true, min: 0 })
  attempts!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type LoginRateLimitDocument = HydratedDocument<LoginRateLimitRecord>;
export const LoginRateLimitSchema =
  SchemaFactory.createForClass(LoginRateLimitRecord);
LoginRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'login_rate_limit_ttl' },
);
