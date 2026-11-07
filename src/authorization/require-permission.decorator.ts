import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from './permissions.registry';

export const requiredPermissionMetadataKey =
  'authorization:required-permission';

export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(requiredPermissionMetadataKey, permission);
