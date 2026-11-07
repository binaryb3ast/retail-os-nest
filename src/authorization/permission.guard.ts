import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { ApplicationException } from '../core/errors/application.exception';
import type { AuthenticatedPrincipal } from '../sessions/sessions.service';
import { isPermissionKey, PermissionKey } from './permissions.registry';
import { AuthorizationService } from './authorization.service';
import { requiredPermissionMetadataKey } from './require-permission.decorator';

interface AuthorizedRequest extends Request {
  authenticatedPrincipal?: AuthenticatedPrincipal;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey>(
      requiredPermissionMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (requiredPermission === undefined) return true;
    if (!isPermissionKey(requiredPermission)) {
      throw new ApplicationException(
        'PERMISSION_CONFIGURATION_INVALID',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'The route permission is not registered.',
      );
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const principal = request.authenticatedPrincipal;
    if (!principal) {
      throw new ApplicationException(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.UNAUTHORIZED,
        'Authentication is required.',
      );
    }

    const branchParam = request.params?.branchId;
    let branchId: Types.ObjectId | undefined;
    if (branchParam !== undefined) {
      if (
        typeof branchParam !== 'string' ||
        !/^[a-f\d]{24}$/i.test(branchParam)
      ) {
        throw new ApplicationException(
          'BRANCH_ID_INVALID',
          HttpStatus.BAD_REQUEST,
          'The branch identifier is invalid.',
        );
      }
      branchId = new Types.ObjectId(branchParam);
    }

    await this.authorization.requirePermission(
      principal.userId,
      requiredPermission,
      branchId,
    );
    return true;
  }
}
