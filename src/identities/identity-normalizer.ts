import { HttpStatus } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { ApplicationException } from '../core/errors/application.exception';
import type { UserIdentityType } from './user-identity.schema';

export interface NormalizedIdentity {
  readonly value: string;
  readonly normalizedValue: string;
}

export function normalizeIdentity(
  type: UserIdentityType,
  input: string,
): NormalizedIdentity {
  const value = input.trim();
  if (value.length === 0 || value.length > 254) {
    throw new ApplicationException(
      'IDENTITY_INVALID',
      HttpStatus.BAD_REQUEST,
      'The identity value is invalid.',
    );
  }

  if (type === 'USERNAME') {
    if (
      value.length < 3 ||
      value.length > 32 ||
      !/^[A-Za-z0-9._-]+$/.test(value)
    ) {
      throw new ApplicationException(
        'IDENTITY_INVALID',
        HttpStatus.BAD_REQUEST,
        'The username must be 3 to 32 ASCII letters, digits, dots, underscores, or hyphens.',
      );
    }
    return { value, normalizedValue: value.toLowerCase() };
  }

  if (
    !isEmail(value, { allow_display_name: false, allow_utf8_local_part: false })
  ) {
    throw new ApplicationException(
      'IDENTITY_INVALID',
      HttpStatus.BAD_REQUEST,
      'The email address is invalid.',
    );
  }

  // The application treats email identities as case-insensitive, including the local part.
  return { value, normalizedValue: value.toLowerCase() };
}
