import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '../core/errors/application.exception';

export function settingException(
  code: string,
  status: HttpStatus,
  detail: string,
): ApplicationException {
  return new ApplicationException(code, status, detail);
}
