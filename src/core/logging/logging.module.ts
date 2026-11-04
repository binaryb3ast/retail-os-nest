import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import * as pino from 'pino';
import type { Request, Response } from 'express';
import { RequestContextModule } from '../request-context/request-context.module';
import { RequestContextService } from '../request-context/request-context.service';
import {
  isValidContextId,
  REQUEST_ID_HEADER,
} from '../request-context/request-context.types';

const sensitiveFieldNames = [
  'password',
  'passwordHash',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'secret',
  'email',
  'phone',
  'address',
  'dateOfBirth',
];

export const redactedFields = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.headers.x-api-key',
  'req.headers.x-auth-token',
  'res.headers.set-cookie',
  'res.headers.authorization',
  'res.headers.x-api-key',
  ...sensitiveFieldNames.flatMap((field) =>
    Array.from({ length: 6 }, (_, depth) => `${'*.'.repeat(depth)}${field}`),
  ),
];

export function serializeRequest(request: Pick<Request, 'method' | 'url'>): {
  method: string;
  url: string | undefined;
} {
  return {
    method: request.method,
    url: request.url?.split('?')[0],
  };
}

@Module({
  imports: [
    RequestContextModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule, RequestContextModule],
      inject: [ConfigService, RequestContextService],
      useFactory: (
        config: ConfigService,
        requestContext: RequestContextService,
      ) => ({
        pinoHttp: {
          level: config.getOrThrow<string>('logging.level'),
          autoLogging: config.getOrThrow<boolean>('logging.httpEnabled'),
          base: {
            service: config.getOrThrow<string>('app.name'),
            environment: config.getOrThrow<string>('app.environment'),
          },
          messageKey: 'message',
          timestamp: pino.stdTimeFunctions.isoTime,
          redact: { paths: redactedFields, censor: '[REDACTED]' },
          serializers: {
            req: serializeRequest,
          },
          genReqId: (_request: Request, response: Response) => {
            const requestId = response.getHeader(REQUEST_ID_HEADER);
            return typeof requestId === 'string' && isValidContextId(requestId)
              ? requestId
              : (requestContext.current()?.requestId ?? 'unavailable');
          },
          customProps: () => {
            const context = requestContext.current();
            return context
              ? {
                  requestId: context.requestId,
                  correlationId: context.correlationId,
                }
              : {};
          },
          transport: config.getOrThrow<boolean>('logging.pretty')
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:standard',
                },
              }
            : undefined,
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class CoreLoggingModule {}
