import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LoginRateLimitService } from './login-rate-limit.service';

interface LoginRequest extends Request {
  body: { identityValue?: unknown };
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: LoginRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LoginRequest>();
    const identity =
      typeof request.body?.identityValue === 'string'
        ? request.body.identityValue.slice(0, 254)
        : 'invalid';
    await this.rateLimit.assertAllowed(identity, request.ip || 'unknown');
    return true;
  }
}
