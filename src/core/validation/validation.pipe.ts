import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { ApplicationException } from '../errors/application.exception';
import type { ProblemFieldError } from '../errors/problem-details.types';

function validationCode(constraint: string): string {
  switch (constraint) {
    case 'isEmail':
    case 'isUrl':
      return 'INVALID_FORMAT';
    case 'isString':
    case 'isNumber':
    case 'isInt':
    case 'isBoolean':
      return 'INVALID_TYPE';
    case 'whitelistValidation':
      return 'UNKNOWN_FIELD';
    case 'isNotEmpty':
    case 'isDefined':
      return 'REQUIRED_FIELD';
    default:
      return 'INVALID_VALUE';
  }
}

function validationMessage(constraint: string): string {
  switch (validationCode(constraint)) {
    case 'INVALID_FORMAT':
      return 'The value has an invalid format.';
    case 'INVALID_TYPE':
      return 'The value has an invalid type.';
    case 'UNKNOWN_FIELD':
      return 'This field is not allowed.';
    case 'REQUIRED_FIELD':
      return 'This field is required.';
    default:
      return 'The value is invalid.';
  }
}

function flattenErrors(
  errors: ValidationError[],
  prefix = '',
): ProblemFieldError[] {
  return errors.flatMap((error) => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const ownErrors = Object.keys(error.constraints ?? {}).map(
      (constraint) => ({
        field,
        code: validationCode(constraint),
        message: validationMessage(constraint),
      }),
    );
    return [...ownErrors, ...flattenErrors(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApplicationException(
        'VALIDATION_ERROR',
        400,
        'One or more fields are invalid.',
        flattenErrors(errors),
      ),
  });
}
