import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationException } from '../core/errors/application.exception';
import {
  AuthenticatedPrincipal,
  SessionsService,
} from '../sessions/sessions.service';

export interface AuthenticatedRequest extends Request {
  authenticatedPrincipal?: AuthenticatedPrincipal;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.get('authorization');
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match) throw this.unauthenticated();

    const principal = await this.sessions.resolve(match[1]);
    if (!principal) throw this.unauthenticated();
    request.authenticatedPrincipal = principal;
    return true;
  }

  private unauthenticated(): ApplicationException {
    return new ApplicationException(
      'AUTHENTICATION_REQUIRED',
      HttpStatus.UNAUTHORIZED,
      'Authentication is required.',
    );
  }
}
