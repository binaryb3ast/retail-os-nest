import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ProblemFieldError } from './problem-details.types';

export class ApplicationException extends HttpException {
  constructor(
    readonly code: string,
    status: HttpStatus,
    readonly detail: string,
    readonly errors?: ProblemFieldError[],
  ) {
    super(detail, status);
  }
}
