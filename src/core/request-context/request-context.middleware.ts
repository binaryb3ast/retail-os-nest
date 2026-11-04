import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';
import {
  CORRELATION_ID_HEADER,
  isValidContextId,
  REQUEST_ID_HEADER,
} from './request-context.types';

function acceptedHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== 'string' || !isValidContextId(value)) return undefined;
  return value;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId =
      acceptedHeader(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();
    const correlationId =
      acceptedHeader(request.headers[CORRELATION_ID_HEADER]) ?? randomUUID();

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    this.context.run({ requestId, correlationId }, next);
  }
}
