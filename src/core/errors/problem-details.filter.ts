import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ExceptionFilter,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import mongoose from 'mongoose';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { RequestContextService } from '../request-context/request-context.service';
import { ApplicationException } from './application.exception';
import type { ProblemDetails } from './problem-details.types';

interface ErrorMapping {
  code: string;
  status: number;
  detail: string;
}

const httpMappings: Record<number, Omit<ErrorMapping, 'status'>> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'VALIDATION_ERROR',
    detail: 'The request is invalid.',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'AUTHENTICATION_REQUIRED',
    detail: 'Authentication is required.',
  },
  [HttpStatus.FORBIDDEN]: {
    code: 'ACCESS_DENIED',
    detail: 'Access is denied.',
  },
  [HttpStatus.NOT_FOUND]: {
    code: 'RESOURCE_NOT_FOUND',
    detail: 'The resource was not found.',
  },
  [HttpStatus.CONFLICT]: {
    code: 'RESOURCE_CONFLICT',
    detail: 'The request conflicts with the current resource state.',
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: 'BUSINESS_RULE_VIOLATION',
    detail: 'The request cannot be processed.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'RATE_LIMIT_EXCEEDED',
    detail: 'Too many requests.',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'DATABASE_ERROR',
    detail: 'A required service is unavailable.',
  },
};

function mongoCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'number' ? error.code : undefined;
}

function stackFrames(error: Error): string | undefined {
  const frames = error.stack?.split('\n').slice(1);
  return frames?.length ? frames.join('\n') : undefined;
}

function mapHttpStatus(status: number): ErrorMapping {
  const knownMapping = httpMappings[status];
  if (knownMapping) return { ...knownMapping, status };
  return status >= 500
    ? {
        code: 'INTERNAL_SERVER_ERROR',
        status,
        detail: 'An unexpected error occurred.',
      }
    : {
        code: 'HTTP_ERROR',
        status,
        detail: 'The request could not be completed.',
      };
}

function mapException(exception: unknown): ErrorMapping & {
  errors?: ApplicationException['errors'];
  expected: boolean;
} {
  if (exception instanceof ApplicationException) {
    return {
      code: exception.code,
      status: exception.getStatus(),
      detail: exception.detail,
      errors: exception.errors,
      expected: true,
    };
  }

  if (exception instanceof HttpException) {
    return { ...mapHttpStatus(exception.getStatus()), expected: true };
  }

  if (exception instanceof mongoose.Error.CastError) {
    return {
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      detail: 'The request contains an invalid value.',
      expected: true,
    };
  }

  if (exception instanceof mongoose.Error.ValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      detail: 'The request contains invalid data.',
      expected: true,
    };
  }

  if (mongoCode(exception) === 11000) {
    return {
      code: 'RESOURCE_CONFLICT',
      status: HttpStatus.CONFLICT,
      detail: 'A resource with these values already exists.',
      expected: true,
    };
  }

  if (
    exception instanceof Error &&
    [
      'MongoServerSelectionError',
      'MongoNetworkError',
      'MongoNetworkTimeoutError',
    ].includes(exception.name)
  ) {
    return {
      code: 'DATABASE_ERROR',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail: 'The database is temporarily unavailable.',
      expected: true,
    };
  }

  return {
    code: 'INTERNAL_SERVER_ERROR',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    detail: 'An unexpected error occurred.',
    expected: false,
  };
}

@Injectable()
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly requestContext: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const mapped = mapException(exception);
    const context = this.requestContext.current();
    const requestId = context?.requestId ?? 'unavailable';
    const instance = request.originalUrl.split('?')[0] ?? request.path;
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[mapped.status] ?? 'Error',
      status: mapped.status,
      detail: mapped.detail,
      instance,
      code: mapped.code,
      requestId,
      ...(mapped.errors ? { errors: mapped.errors } : {}),
    };

    if (mapped.expected) {
      this.logger.warn(
        { code: mapped.code, status: mapped.status },
        'Request failed',
      );
    } else {
      this.logger.error(
        {
          code: mapped.code,
          status: mapped.status,
          errorName:
            exception instanceof Error ? exception.name : 'UnknownError',
          stack:
            exception instanceof Error ? stackFrames(exception) : undefined,
        },
        'Unexpected request failure',
      );
    }

    response
      .status(mapped.status)
      .type('application/problem+json')
      .json(problem);
  }
}
