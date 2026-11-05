import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { normalizeIdentity } from './identity-normalizer';
import { UserIdentityRecord, UserIdentityType } from './user-identity.schema';
import { UserRecord } from '../users/user.schema';
import { UsersService } from '../users/users.service';

export interface UserIdentityView {
  readonly id: string;
  readonly userId: string;
  readonly type: UserIdentityType;
  readonly value: string;
  readonly isVerified: boolean;
  readonly verifiedAt: Date | null;
  readonly isPrimary: boolean;
  readonly createdAt: Date;
}

export interface AuthenticationIdentity {
  readonly id: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly type: UserIdentityType;
  readonly isVerified: boolean;
}

@Injectable()
export class IdentitiesService {
  constructor(
    @InjectModel(UserIdentityRecord.name)
    private readonly identities: Model<UserIdentityRecord>,
    @InjectModel(UserRecord.name)
    private readonly users: Model<UserRecord>,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
    private readonly userService: UsersService,
  ) {}

  async findForAuthentication(
    type: UserIdentityType,
    normalizedValue: string,
  ): Promise<AuthenticationIdentity | null> {
    const identity = await this.identities
      .findOne({ type, normalizedValue })
      .select('_id userId type isVerified')
      .lean()
      .exec();
    return identity
      ? {
          id: identity._id,
          userId: identity.userId,
          type: identity.type,
          isVerified: identity.isVerified,
        }
      : null;
  }

  async findForAuthenticationById(
    identityId: Types.ObjectId,
    session: import('mongoose').ClientSession,
  ): Promise<AuthenticationIdentity | null> {
    const identity = await this.identities
      .findById(identityId)
      .select('_id userId type isVerified')
      .session(session)
      .lean()
      .exec();
    return identity
      ? {
          id: identity._id,
          userId: identity.userId,
          type: identity.type,
          isVerified: identity.isVerified,
        }
      : null;
  }

  async listForUser(userId: string): Promise<readonly UserIdentityView[]> {
    const ownerId = this.parseId(userId);
    const records = await this.identities
      .find({ userId: ownerId })
      .sort({ type: 1, createdAt: 1 })
      .lean()
      .exec();
    return records.map((record) => this.toView(record));
  }

  async addIdentity(
    userId: string,
    type: UserIdentityType,
    value: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<UserIdentityView> {
    const ownerId = this.parseId(userId);
    const normalized = normalizeIdentity(type, value);
    try {
      return await this.transactions.execute(async (session) => {
        const owner = await this.users
          .findById(ownerId)
          .session(session)
          .exec();
        if (!owner || owner.status === 'DEACTIVATED') {
          throw this.exception(
            'USER_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The user does not exist.',
          );
        }
        const existingPrimary = await this.identities
          .findOne({ userId: ownerId, type, isPrimary: true })
          .session(session)
          .exec();
        const identity = new this.identities({
          userId: ownerId,
          type,
          value: normalized.value,
          normalizedValue: normalized.normalizedValue,
          isVerified: false,
          verifiedAt: null,
          isPrimary: !existingPrimary,
        });
        await identity.save({ session });
        await this.audit.record(
          {
            action: 'USER.IDENTITY_ADDED',
            actor,
            targetType: 'IDENTITY',
            targetId: identity._id,
            userId: ownerId,
            identityType: type,
            reason,
          },
          session,
        );
        return this.toView(identity);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'IDENTITY_CONFLICT',
          HttpStatus.CONFLICT,
          'The identity is already reserved or a primary identity update conflicted.',
        );
      }
      throw error;
    }
  }

  async setPrimary(
    userId: string,
    identityId: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<UserIdentityView> {
    const ownerId = this.parseId(userId);
    const targetId = this.parseId(identityId);
    try {
      return await this.transactions.execute(async (session) => {
        const identity = await this.identities
          .findOne({ _id: targetId, userId: ownerId })
          .session(session)
          .exec();
        if (!identity) {
          throw this.exception(
            'IDENTITY_NOT_FOUND',
            HttpStatus.NOT_FOUND,
            'The identity does not exist.',
          );
        }
        if (identity.isPrimary) return this.toView(identity);

        await this.identities
          .updateMany(
            { userId: ownerId, type: identity.type, isPrimary: true },
            { $set: { isPrimary: false } },
            { session },
          )
          .exec();
        identity.isPrimary = true;
        await identity.save({ session });
        await this.userService.advanceAuthVersion(ownerId, session);
        await this.audit.record(
          {
            action: 'USER.IDENTITY_PRIMARY_CHANGED',
            actor,
            targetType: 'IDENTITY',
            targetId,
            userId: ownerId,
            identityType: identity.type,
            reason,
          },
          session,
        );
        return this.toView(identity);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'IDENTITY_PRIMARY_CONFLICT',
          HttpStatus.CONFLICT,
          'The primary identity changed concurrently.',
        );
      }
      throw error;
    }
  }

  async removeIdentity(
    userId: string,
    identityId: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<void> {
    const ownerId = this.parseId(userId);
    const targetId = this.parseId(identityId);
    await this.transactions.execute(async (session) => {
      const owner = await this.users.findById(ownerId).session(session).exec();
      const identity = await this.identities
        .findOne({ _id: targetId, userId: ownerId })
        .session(session)
        .exec();
      if (!owner || !identity) {
        throw this.exception(
          'IDENTITY_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The identity does not exist.',
        );
      }

      const remainingCount = await this.identities
        .countDocuments({ userId: ownerId, _id: { $ne: targetId } })
        .session(session);
      if (remainingCount === 0) {
        throw this.exception(
          'USER_LAST_IDENTITY',
          HttpStatus.CONFLICT,
          'A user must retain at least one identity.',
        );
      }
      if (owner.status === 'ACTIVE' && identity.isVerified) {
        const otherVerifiedIdentity = await this.identities
          .exists({
            userId: ownerId,
            _id: { $ne: targetId },
            isVerified: true,
          })
          .session(session);
        if (!otherVerifiedIdentity) {
          throw this.exception(
            'USER_VERIFIED_IDENTITY_REQUIRED',
            HttpStatus.CONFLICT,
            'An active user must retain a verified identity.',
          );
        }
      }

      if (identity.isPrimary) {
        const replacement = await this.identities
          .findOne({
            userId: ownerId,
            type: identity.type,
            _id: { $ne: targetId },
          })
          .sort({ createdAt: 1 })
          .session(session)
          .exec();
        if (replacement) {
          identity.isPrimary = false;
          await identity.save({ session });
          replacement.isPrimary = true;
          await replacement.save({ session });
          await this.audit.record(
            {
              action: 'USER.IDENTITY_PRIMARY_CHANGED',
              actor,
              targetType: 'IDENTITY',
              targetId: replacement._id,
              userId: ownerId,
              identityType: identity.type,
              reason,
            },
            session,
          );
        }
      }

      if (identity.isVerified || owner.status === 'ACTIVE') {
        await this.userService.advanceAuthVersion(ownerId, session);
      }
      await identity.deleteOne({ session });
      await this.audit.record(
        {
          action: 'USER.IDENTITY_REMOVED',
          actor,
          targetType: 'IDENTITY',
          targetId,
          userId: ownerId,
          identityType: identity.type,
          reason,
        },
        session,
      );
    });
  }

  private toView(
    identity: UserIdentityRecord & { _id: Types.ObjectId },
  ): UserIdentityView {
    return {
      id: identity._id.toString(),
      userId: identity.userId.toString(),
      type: identity.type,
      value: identity.value,
      isVerified: identity.isVerified,
      verifiedAt: identity.verifiedAt,
      isPrimary: identity.isPrimary,
      createdAt: identity.createdAt,
    };
  }

  private parseId(value: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value) || !isValidObjectId(value)) {
      throw this.exception(
        'IDENTIFIER_INVALID',
        HttpStatus.BAD_REQUEST,
        'The identifier is invalid.',
      );
    }
    return new Types.ObjectId(value);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private exception(
    code: string,
    status: HttpStatus,
    detail: string,
  ): ApplicationException {
    return new ApplicationException(code, status, detail);
  }
}
