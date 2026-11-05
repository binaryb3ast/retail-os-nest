import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type UserIdentityType = 'USERNAME' | 'EMAIL';

@Schema({
  collection: 'user_identities',
  timestamps: true,
  strict: 'throw',
  versionKey: false,
})
export class UserIdentityRecord {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    ref: 'UserRecord',
  })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['USERNAME', 'EMAIL'] })
  type!: UserIdentityType;

  @Prop({ type: String, required: true, trim: true, maxlength: 254 })
  value!: string;

  @Prop({ type: String, required: true, maxlength: 254 })
  normalizedValue!: string;

  @Prop({ type: Boolean, required: true, default: false })
  isVerified!: boolean;

  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;

  @Prop({ type: Boolean, required: true, default: false })
  isPrimary!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserIdentityDocument = HydratedDocument<UserIdentityRecord>;
export const UserIdentitySchema =
  SchemaFactory.createForClass(UserIdentityRecord);

UserIdentitySchema.index(
  { type: 1, normalizedValue: 1 },
  { unique: true, name: 'uniq_identity_type_normalized_value' },
);
UserIdentitySchema.index(
  { userId: 1, type: 1, createdAt: 1 },
  { name: 'identities_by_user_type' },
);
UserIdentitySchema.index(
  { userId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { isPrimary: true },
    name: 'uniq_primary_identity_per_type',
  },
);

UserIdentitySchema.pre('validate', function () {
  if (this.isVerified && !this.verifiedAt) {
    this.invalidate(
      'verifiedAt',
      'Verified identities require a verification timestamp',
    );
  }
  if (!this.isVerified && this.verifiedAt) {
    this.invalidate(
      'verifiedAt',
      'Unverified identities cannot have a verification timestamp',
    );
  }
});
