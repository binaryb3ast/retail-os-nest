import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { AuthenticationUserState, UsersService } from '../users/users.service';
import { UserSessionRecord } from './user-session.schema';

const sessionLifetimeMs = 12 * 60 * 60 * 1000;

export interface AuthenticatedPrincipal {
  readonly userId: Types.ObjectId;
  readonly sessionId: Types.ObjectId;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly sessionId: string;
}

@Injectable()
export class SessionsService implements OnModuleInit {
  constructor(
    @InjectModel(UserSessionRecord.name)
    private readonly sessions: Model<UserSessionRecord>,
    private readonly users: UsersService,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sessions.createIndexes();
  }

  async issue(
    user: AuthenticationUserState,
    actor: AuditActor,
  ): Promise<IssuedSession> {
    return this.transactions.execute((session) =>
      this.issueInTransaction(user, actor, session),
    );
  }

  async issueInTransaction(
    user: AuthenticationUserState,
    actor: AuditActor,
    session: ClientSession,
  ): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    const sessionId = new Types.ObjectId();

    const currentUser = await this.users.getAuthenticationState(
      user.id,
      session,
    );
    if (
      !currentUser ||
      currentUser.status !== 'ACTIVE' ||
      currentUser.authVersion !== user.authVersion
    ) {
      throw this.authenticationFailed();
    }
    await this.sessions.create(
      [
        {
          _id: sessionId,
          userId: user.id,
          tokenHash,
          authVersion: user.authVersion,
          expiresAt,
          revokedAt: null,
          revocationReason: null,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        action: 'AUTH.SESSION_CREATED',
        actor,
        targetType: 'USER',
        targetId: user.id,
        userId: user.id,
      },
      session,
    );

    return { token, expiresAt, sessionId: sessionId.toString() };
  }

  async resolve(token: string): Promise<AuthenticatedPrincipal | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = this.hashToken(token);
    const session = await this.sessions
      .findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    if (!session) return null;

    const user = await this.users.getAuthenticationState(session.userId);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.authVersion !== session.authVersion
    ) {
      return null;
    }
    return { userId: session.userId, sessionId: session._id };
  }

  async revoke(
    token: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const tokenHash = this.hashToken(token);
    await this.transactions.execute(async (session) => {
      const record = await this.sessions
        .findOne({ tokenHash, revokedAt: null })
        .session(session)
        .exec();
      if (!record) return;
      record.revokedAt = new Date();
      record.revocationReason = reason?.slice(0, 100) ?? 'LOGOUT';
      await record.save({ session });
      await this.audit.record(
        {
          action: 'AUTH.SESSION_REVOKED',
          actor,
          targetType: 'USER',
          targetId: record.userId,
          userId: record.userId,
          reason,
        },
        session,
      );
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private authenticationFailed(): ApplicationException {
    return new ApplicationException(
      'AUTHENTICATION_FAILED',
      HttpStatus.UNAUTHORIZED,
      'Authentication failed.',
    );
  }
}
