import { validateDatabaseEnvironment } from '../../infrastructure/database/config/database.config';

const logLevels = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

export type LogLevel = (typeof logLevels)[number];
type Environment = Record<string, unknown>;

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === 'string' && logLevels.some((level) => level === value)
  );
}

function readString(
  environment: Environment,
  key: string,
  defaultValue: string,
  pattern: RegExp,
): string {
  const value = environment[key] ?? defaultValue;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Invalid environment configuration: ${key} is malformed`);
  }
  return value;
}

function readPort(environment: Environment): number {
  const value = environment.PORT ?? '3000';
  const port =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'Invalid environment configuration: PORT must be an integer from 1 to 65535',
    );
  }
  return port;
}

function readBoolean(
  environment: Environment,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = environment[key] ?? String(defaultValue);
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(
    `Invalid environment configuration: ${key} must be true or false`,
  );
}

function readLogLevel(
  environment: Environment,
  nodeEnvironment: string,
): LogLevel {
  const defaultLevel = nodeEnvironment === 'development' ? 'debug' : 'info';
  const value = environment.LOG_LEVEL ?? defaultLevel;
  if (!isLogLevel(value)) {
    throw new Error(
      `Invalid environment configuration: LOG_LEVEL must be one of ${logLevels.join(', ')}`,
    );
  }
  return value;
}

export function validateApplicationEnvironment(
  input: Environment,
): Environment {
  const databaseEnvironment = validateDatabaseEnvironment(input);
  const nodeEnvironment = databaseEnvironment.NODE_ENV;
  if (typeof nodeEnvironment !== 'string') {
    throw new Error('Invalid environment configuration: NODE_ENV is malformed');
  }

  return {
    ...databaseEnvironment,
    SERVICE_NAME: readString(
      input,
      'SERVICE_NAME',
      'store-management-api',
      /^[a-z][a-z0-9-]{1,62}$/,
    ),
    PORT: readPort(input),
    LOG_LEVEL: readLogLevel(input, nodeEnvironment),
    HTTP_LOGGING_ENABLED: readBoolean(input, 'HTTP_LOGGING_ENABLED', true),
    API_PREFIX: readString(
      input,
      'API_PREFIX',
      'api',
      /^[a-z][a-z0-9-]{0,30}$/,
    ),
    API_DEFAULT_VERSION: readString(
      input,
      'API_DEFAULT_VERSION',
      '1',
      /^[1-9]\d{0,2}$/,
    ),
  };
}
