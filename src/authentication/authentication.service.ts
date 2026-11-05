import { HttpStatus, Injectable } from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { CredentialsService } from '../credentials/credentials.service';
import { normalizeIdentity } from '../identities/identity-normalizer';
import { IdentitiesService } from '../identities/identities.service';
import { UserIdentityType } from '../identities/user-identity.schema';
import { UsersService } from '../users/users.service';
import { IssuedSession, SessionsService } from '../sessions/sessions.service';

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly identities: IdentitiesService,
    private readonly credentials: CredentialsService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    identityType: UserIdentityType,
    identityValue: string,
    password: string,
  ): Promise<IssuedSession> {
    let normalizedValue: string | null = null;
    try {
      normalizedValue = normalizeIdentity(identityType, identityValue).normalizedValue;
    } catch {
      // Invalid and unknown identities follow the same failure path.
    }
    const identity = normalizedValue
      ? await this.identities.findForAuthentication(identityType, normalizedValue)
      : null;

    const userId = identity?.userId;
    const [credential, user] = userId
      ? await Promise.all([
          this.credentials.findForAuthentication(userId),
          this.users.getAuthenticationState(userId),
        ])
      : [null, null];
    const passwordMatches = await this.credentials.verifyPassword(password, credential);
    const isLocked = Boolean(credential?.lockedUntil && credential.lockedUntil > new Date());
    const canAuthenticate = Boolean(
      identity?.isVerified &&
        user?.status === 'ACTIVE' &&
        credential &&
        passwordMatches &&
        !isLocked,
    );

    if (!canAuthenticate || !user || !credential || !userId || !identity) {
      if (credential) await this.credentials.recordFailedAttempt(credential.userId);
      throw this.authenticationFailed();
    }

    const actor = { type: 'USER', userId } as const;
    try {
      return await this.transactions.execute(async (session) => {
        const currentIdentity = await this.identities.findForAuthenticationById(identity.id, session);
        const currentUser = await this.users.getAuthenticationState(userId, session);
        if (
          !currentIdentity?.isVerified ||
          currentIdentity.userId.toString() !== userId.toString() ||
          !currentUser ||
          currentUser.status !== 'ACTIVE' ||
          currentUser.authVersion !== user.authVersion ||
          credential.lockedUntil && credential.lockedUntil > new Date()
        ) {
          throw this.authenticationFailed();
        }

        await this.credentials.resetFailedAttempts(userId, credential.revision, session);
        const issued = await this.sessions.issueInTransaction(currentUser, actor, session);
        await this.audit.record(
          {
            action: 'AUTH.LOGIN_SUCCEEDED',
            actor,
            targetType: 'USER',
            targetId: userId,
            userId,
          },
          session,
        );
        return issued;
      });
    } catch (error: unknown) {
      if (
        error instanceof ApplicationException &&
        (error.code === 'AUTHENTICATION_FAILED' ||
          error.code === 'CREDENTIAL_REVISION_CONFLICT')
      ) {
        throw this.authenticationFailed();
      }
      throw error;
    }
  }

  async logout(
    token: string,
    principal: { readonly userId: Types.ObjectId },
  ): Promise<void> {
    if (!isValidObjectId(principal.userId)) throw this.authenticationFailed();
    await this.sessions.revoke(token, { type: 'USER', userId: principal.userId }, 'LOGOUT');
  }

  private authenticationFailed(): ApplicationException {
    return new ApplicationException(
      'AUTHENTICATION_FAILED',
      HttpStatus.UNAUTHORIZED,
      'Authentication failed.',
    );
  }
}
