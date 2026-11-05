import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { normalizeIdentity } from '../identities/identity-normalizer';
import {
  UserIdentityRecord,
  UserIdentityType,
} from '../identities/user-identity.schema';
import { UserRecord, UserStatus } from './user.schema';

export interface CreateInvitedHumanInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName?: string;
  readonly identity: {
    readonly type: UserIdentityType;
    readonly value: string;
  };
}

export interface UpdateUserProfileInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly displayName?: string | null;
}

export interface UserProfile {
  readonly id: string;
  readonly accountType: UserRecord['accountType'];
  readonly status: UserStatus;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AuthenticationUserState {
  readonly id: Types.ObjectId;
  readonly status: UserStatus;
  readonly authVersion: number;
}

const statusTransitions: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  INVITED: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: [],
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserRecord.name)
    private readonly users: Model<UserRecord>,
    @InjectModel(UserIdentityRecord.name)
    private readonly identities: Model<UserIdentityRecord>,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async createInvitedHuman(
    input: CreateInvitedHumanInput,
    actor: AuditActor,
  ): Promise<UserProfile> {
    const firstName = this.requiredProfileName(input.firstName, 'firstName');
    const lastName = this.requiredProfileName(input.lastName, 'lastName');
    const displayName = this.optionalProfileName(
      input.displayName,
      'displayName',
    );
    const identity = normalizeIdentity(
      input.identity.type,
      input.identity.value,
    );

    try {
      return await this.transactions.execute(async (session) => {
        const user = new this.users({
          accountType: 'HUMAN',
          status: 'INVITED',
          firstName,
          lastName,
          displayName,
          authVersion: 0,
        });
        await user.save({ session });

        const identityRecord = new this.identities({
          userId: user._id,
          type: input.identity.type,
          value: identity.value,
          normalizedValue: identity.normalizedValue,
          isVerified: false,
          verifiedAt: null,
          isPrimary: true,
        });
        await identityRecord.save({ session });

        await this.audit.record(
          {
            action: 'USER.CREATED',
            actor,
            targetType: 'USER',
            targetId: user._id,
            userId: user._id,
            identityType: input.identity.type,
            newStatus: 'INVITED',
          },
          session,
        );
        return this.toProfile(user);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'IDENTITY_CONFLICT',
          HttpStatus.CONFLICT,
          'The identity is already reserved.',
        );
      }
      throw error;
    }
  }

  async getById(id: string): Promise<UserProfile> {
    const objectId = this.parseId(id, 'USER_ID_INVALID');
    const user = await this.users.findById(objectId).exec();
    if (!user) {
      throw this.exception(
        'USER_NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The user does not exist.',
      );
    }
    return this.toProfile(user);
  }

  async getAuthenticationState(
    userId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<AuthenticationUserState | null> {
    let query = this.users.findById(userId).select('_id status authVersion');
    if (session) query = query.session(session);
    const user = await query.lean().exec();
    return user
      ? { id: user._id, status: user.status, authVersion: user.authVersion }
      : null;
  }

  async advanceAuthVersion(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<number> {
    const updated = await this.users
      .findByIdAndUpdate(userId, { $inc: { authVersion: 1 } }, { new: true })
      .select('_id authVersion')
      .session(session)
      .lean()
      .exec();
    if (!updated) {
      throw this.exception('USER_NOT_FOUND', HttpStatus.NOT_FOUND, 'The user does not exist.');
    }
    return updated.authVersion;
  }

  async updateProfile(
    id: string,
    input: UpdateUserProfileInput,
    actor: AuditActor,
    reason?: string,
  ): Promise<UserProfile> {
    const objectId = this.parseId(id, 'USER_ID_INVALID');
    const changes: Partial<
      Pick<UserRecord, 'firstName' | 'lastName' | 'displayName'>
    > = {};
    if (input.firstName !== undefined)
      changes.firstName = this.requiredProfileName(
        input.firstName,
        'firstName',
      );
    if (input.lastName !== undefined)
      changes.lastName = this.requiredProfileName(input.lastName, 'lastName');
    if (input.displayName !== undefined)
      changes.displayName = this.optionalProfileName(
        input.displayName,
        'displayName',
      );
    if (Object.keys(changes).length === 0) {
      throw this.exception(
        'USER_PROFILE_EMPTY',
        HttpStatus.BAD_REQUEST,
        'At least one profile field is required.',
      );
    }

    return this.transactions.execute(async (session) => {
      const user = await this.users.findById(objectId).session(session).exec();
      if (!user) {
        throw this.exception(
          'USER_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The user does not exist.',
        );
      }
      if (user.status === 'DEACTIVATED') {
        throw this.exception(
          'USER_DEACTIVATED',
          HttpStatus.CONFLICT,
          'A deactivated user cannot be updated.',
        );
      }
      Object.assign(user, changes);
      await user.save({ session });
      await this.audit.record(
        {
          action: 'USER.PROFILE_UPDATED',
          actor,
          targetType: 'USER',
          targetId: user._id,
          userId: user._id,
          reason,
        },
        session,
      );
      return this.toProfile(user);
    });
  }

  async changeStatus(
    id: string,
    nextStatus: UserStatus,
    actor: AuditActor,
    reason?: string,
  ): Promise<UserProfile> {
    const objectId = this.parseId(id, 'USER_ID_INVALID');
    return this.transactions.execute(async (session) => {
      const user = await this.users.findById(objectId).session(session).exec();
      if (!user) {
        throw this.exception(
          'USER_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The user does not exist.',
        );
      }
      if (!statusTransitions[user.status].includes(nextStatus)) {
        throw this.exception(
          'USER_STATUS_TRANSITION_INVALID',
          HttpStatus.CONFLICT,
          'The requested account status transition is not allowed.',
        );
      }
      if (nextStatus === 'ACTIVE') {
        const verifiedIdentity = await this.identities
          .exists({
            userId: user._id,
            isVerified: true,
            type: { $in: ['USERNAME', 'EMAIL'] },
          })
          .session(session);
        if (!verifiedIdentity) {
          throw this.exception(
            'USER_VERIFIED_IDENTITY_REQUIRED',
            HttpStatus.CONFLICT,
            'An active user must have a verified login identity.',
          );
        }
      }

      const previousStatus = user.status;
      user.status = nextStatus;
      user.authVersion += 1;
      await user.save({ session });
      await this.audit.record(
        {
          action: 'USER.STATUS_CHANGED',
          actor,
          targetType: 'USER',
          targetId: user._id,
          userId: user._id,
          previousStatus,
          newStatus: nextStatus,
          reason,
        },
        session,
      );
      return this.toProfile(user);
    });
  }

  private toProfile(user: UserRecord & { _id: Types.ObjectId }): UserProfile {
    return {
      id: user._id.toString(),
      accountType: user.accountType,
      status: user.status,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private requiredProfileName(value: string, field: string): string {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 100) {
      throw this.exception(
        'USER_PROFILE_INVALID',
        HttpStatus.BAD_REQUEST,
        `${field} must contain 1 to 100 characters.`,
      );
    }
    return normalized;
  }

  private optionalProfileName(
    value: string | null | undefined,
    field: string,
  ): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 150) {
      throw this.exception(
        'USER_PROFILE_INVALID',
        HttpStatus.BAD_REQUEST,
        `${field} must contain 1 to 150 characters when provided.`,
      );
    }
    return normalized;
  }

  private parseId(value: string, code: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value) || !isValidObjectId(value)) {
      throw this.exception(
        code,
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
