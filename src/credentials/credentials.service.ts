import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { UsersService } from '../users/users.service';
import { UserCredentialRecord } from './user-credential.schema';

const argonOptions: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const commonPasswordDenylist = new Set([
  'passwordpassword',
  'password12345678',
  '123456789012345',
  'qwertyuiopasdfgh',
  'letmeinletmein1',
]);

export interface AuthenticationCredential {
  readonly userId: Types.ObjectId;
  readonly passwordHash: string;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
  readonly revision: number;
}

@Injectable()
export class CredentialsService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    @InjectModel(UserCredentialRecord.name)
    private readonly credentials: Model<UserCredentialRecord>,
    private readonly usersService: UsersService,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(
      randomBytes(32).toString('base64url'),
      argonOptions,
    );
    await this.credentials.createIndexes();
  }

  async setInitialPassword(
    userId: Types.ObjectId,
    password: string,
    actor: AuditActor,
  ): Promise<void> {
    const passwordHash = await this.hashPasswordForProvisioning(password);
    try {
      await this.transactions.execute(async (session) => {
        const user = await this.usersService.getAuthenticationState(
          userId,
          session,
        );
        if (!user || user.status !== 'INVITED') {
          throw this.exception(
            'USER_NOT_ELIGIBLE_FOR_CREDENTIAL',
            HttpStatus.CONFLICT,
            'The account cannot receive an initial password.',
          );
        }
        await this.credentials.create(
          [
            {
              userId,
              passwordHash,
              passwordChangedAt: new Date(),
              failedAttempts: 0,
              lockedUntil: null,
              lastFailedAt: null,
              revision: 1,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            action: 'USER.PASSWORD_SET',
            actor,
            targetType: 'USER',
            targetId: userId,
            userId,
          },
          session,
        );
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'USER_CREDENTIAL_EXISTS',
          HttpStatus.CONFLICT,
          'The account already has a password credential.',
        );
      }
      throw error;
    }
  }

  async hashPasswordForProvisioning(password: string): Promise<string> {
    return argon2.hash(this.normalizePassword(password), argonOptions);
  }

  async changePassword(
    userId: Types.ObjectId,
    currentPassword: string,
    nextPassword: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<void> {
    const normalizedCurrent =
      this.normalizePasswordForVerification(currentPassword);
    const normalizedNext = this.normalizePassword(nextPassword);
    const current = await this.credentials
      .findOne({ userId })
      .select('+passwordHash')
      .lean()
      .exec();
    if (
      !current ||
      !(await this.verify(normalizedCurrent, current.passwordHash))
    ) {
      throw this.exception(
        'CREDENTIALS_INVALID',
        HttpStatus.UNAUTHORIZED,
        'The current credentials are invalid.',
      );
    }
    if (current.lockedUntil && current.lockedUntil > new Date()) {
      throw this.exception(
        'CREDENTIALS_INVALID',
        HttpStatus.UNAUTHORIZED,
        'The current credentials are invalid.',
      );
    }
    const nextHash = await argon2.hash(normalizedNext, argonOptions);

    await this.transactions.execute(async (session) => {
      const user = await this.usersService.getAuthenticationState(
        userId,
        session,
      );
      const credential = await this.credentials
        .findOne({ userId })
        .select('+passwordHash')
        .session(session)
        .exec();
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        !credential ||
        credential.revision !== current.revision
      ) {
        throw this.exception(
          'CREDENTIALS_INVALID',
          HttpStatus.UNAUTHORIZED,
          'The current credentials are invalid.',
        );
      }
      credential.passwordHash = nextHash;
      credential.passwordChangedAt = new Date();
      credential.failedAttempts = 0;
      credential.lockedUntil = null;
      credential.lastFailedAt = null;
      credential.revision += 1;
      await credential.save({ session });
      await this.usersService.advanceAuthVersion(userId, session);
      await this.audit.record(
        {
          action: 'USER.PASSWORD_CHANGED',
          actor,
          targetType: 'USER',
          targetId: userId,
          userId,
          reason,
        },
        session,
      );
    });
  }

  async findForAuthentication(
    userId: Types.ObjectId,
  ): Promise<AuthenticationCredential | null> {
    const credential = await this.credentials
      .findOne({ userId })
      .select('+passwordHash')
      .lean()
      .exec();
    if (!credential) return null;
    return {
      userId: credential.userId,
      passwordHash: credential.passwordHash,
      failedAttempts: credential.failedAttempts,
      lockedUntil: credential.lockedUntil,
      revision: credential.revision,
    };
  }

  async verifyPassword(
    password: string,
    credential: AuthenticationCredential | null,
  ): Promise<boolean> {
    const normalized = this.normalizePasswordForVerification(password);
    return argon2.verify(
      credential?.passwordHash ?? this.dummyHash,
      normalized,
    );
  }

  async recordFailedAttempt(userId: Types.ObjectId): Promise<void> {
    await this.credentials
      .updateOne({ userId }, [
        {
          $set: {
            failedAttempts: { $add: [{ $ifNull: ['$failedAttempts', 0] }, 1] },
            lastFailedAt: '$$NOW',
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [
                { $gte: ['$failedAttempts', 5] },
                { $dateAdd: { startDate: '$$NOW', unit: 'minute', amount: 5 } },
                '$lockedUntil',
              ],
            },
          },
        },
      ])
      .exec();
  }

  async resetFailedAttempts(
    userId: Types.ObjectId,
    revision: number,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.credentials
      .updateOne(
        { userId, revision },
        {
          $set: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    if (result.modifiedCount !== 1) {
      throw this.exception(
        'CREDENTIAL_REVISION_CONFLICT',
        HttpStatus.CONFLICT,
        'The credential changed during authentication.',
      );
    }
  }

  async verifyEncodedPassword(
    password: string,
    encodedHash: string,
  ): Promise<boolean> {
    return argon2.verify(
      encodedHash,
      this.normalizePasswordForVerification(password),
    );
  }

  private normalizePassword(password: string): string {
    if (typeof password !== 'string') {
      throw this.exception(
        'PASSWORD_INVALID',
        HttpStatus.BAD_REQUEST,
        'The password is invalid.',
      );
    }
    const normalized = password.normalize('NFC');
    const length = [...normalized].length;
    if (
      length < 15 ||
      length > 128 ||
      Buffer.byteLength(normalized, 'utf8') > 1024
    ) {
      throw this.exception(
        'PASSWORD_INVALID',
        HttpStatus.BAD_REQUEST,
        'Password length must be 15 to 128 characters.',
      );
    }
    if (commonPasswordDenylist.has(normalized.toLowerCase())) {
      throw this.exception(
        'PASSWORD_INVALID',
        HttpStatus.BAD_REQUEST,
        'Choose a less common password.',
      );
    }
    return normalized;
  }

  private normalizePasswordForVerification(password: string): string {
    if (
      typeof password !== 'string' ||
      Buffer.byteLength(password, 'utf8') > 1024
    ) {
      return '';
    }
    return password.normalize('NFC');
  }

  private async verify(
    password: string,
    encodedHash: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(encodedHash, password);
    } catch {
      return false;
    }
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
