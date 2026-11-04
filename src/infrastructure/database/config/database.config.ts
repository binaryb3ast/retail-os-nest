import type { DatabaseConfig, DatabaseConfigReader } from '../database.types';

type DatabaseEnvironment = Record<string, unknown>;

function readString(
  environment: DatabaseEnvironment,
  key: string,
  fallback?: string,
): string {
  const value = environment[key] ?? fallback;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid environment configuration: ${key} is required`);
  }
  return value.trim();
}

function readInteger(
  environment: DatabaseEnvironment,
  key: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const rawValue = environment[key];
  const value =
    rawValue === undefined
      ? fallback
      : typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' && /^\d+$/.test(rawValue)
          ? Number(rawValue)
          : Number.NaN;

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Invalid environment configuration: ${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function isMongoUri(uri: string): boolean {
  const match = uri.match(/^(mongodb(?:\+srv)?:)\/\/([^/?#]+)/i);
  if (!match || /%(?![0-9a-f]{2})/i.test(uri)) return false;

  const scheme = match[1];
  const authority = match[2];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  const hosts = hostList.split(',');
  if (
    hosts.length === 0 ||
    hosts.some((host) => host.length === 0 || /\s|%/.test(host)) ||
    (scheme.toLowerCase() === 'mongodb+srv:' && hosts.length !== 1)
  ) {
    return false;
  }

  try {
    for (const host of hosts) {
      const parsed = new URL(`mongodb://${host}/`);
      if (!parsed.hostname) return false;
      if (scheme.toLowerCase() === 'mongodb+srv:' && parsed.port) return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function validateDatabaseEnvironment(
  environment: DatabaseEnvironment,
): DatabaseEnvironment {
  const nodeEnvironment = readString(environment, 'NODE_ENV', 'development');
  if (
    !['development', 'test', 'staging', 'production'].includes(nodeEnvironment)
  ) {
    throw new Error(
      'Invalid environment configuration: NODE_ENV is unsupported',
    );
  }

  const uri = readString(environment, 'MONGODB_URI');
  if (!isMongoUri(uri)) {
    throw new Error(
      'Invalid environment configuration: MONGODB_URI must be a MongoDB URI',
    );
  }

  const maxPoolSize = readInteger(environment, 'MONGODB_MAX_POOL_SIZE', 20, 1);
  const minPoolSize = readInteger(environment, 'MONGODB_MIN_POOL_SIZE', 0, 0);
  if (minPoolSize > maxPoolSize) {
    throw new Error(
      'Invalid environment configuration: MONGODB_MIN_POOL_SIZE must not exceed MONGODB_MAX_POOL_SIZE',
    );
  }

  return {
    ...environment,
    NODE_ENV: nodeEnvironment,
    MONGODB_URI: uri,
    MONGODB_DB_NAME: readString(
      environment,
      'MONGODB_DB_NAME',
      'store_management',
    ),
    MONGODB_MAX_POOL_SIZE: maxPoolSize,
    MONGODB_MIN_POOL_SIZE: minPoolSize,
    MONGODB_MAX_CONNECTING: readInteger(
      environment,
      'MONGODB_MAX_CONNECTING',
      2,
      1,
    ),
    MONGODB_MAX_IDLE_TIME_MS: readInteger(
      environment,
      'MONGODB_MAX_IDLE_TIME_MS',
      60000,
      0,
    ),
    MONGODB_WAIT_QUEUE_TIMEOUT_MS: readInteger(
      environment,
      'MONGODB_WAIT_QUEUE_TIMEOUT_MS',
      10000,
      1,
    ),
    MONGODB_CONNECT_TIMEOUT_MS: readInteger(
      environment,
      'MONGODB_CONNECT_TIMEOUT_MS',
      10000,
      1,
    ),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: readInteger(
      environment,
      'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
      10000,
      1,
    ),
    MONGODB_SOCKET_TIMEOUT_MS: readInteger(
      environment,
      'MONGODB_SOCKET_TIMEOUT_MS',
      45000,
      1,
    ),
    MONGODB_RETRY_ATTEMPTS: readInteger(
      environment,
      'MONGODB_RETRY_ATTEMPTS',
      5,
      1,
      10,
    ),
    MONGODB_RETRY_DELAY_MS: readInteger(
      environment,
      'MONGODB_RETRY_DELAY_MS',
      3000,
      1,
      30000,
    ),
  };
}

export function getDatabaseConfig(
  config: DatabaseConfigReader,
): DatabaseConfig {
  const environment = config.getOrThrow<string>('NODE_ENV');

  return {
    uri: config.getOrThrow<string>('MONGODB_URI'),
    dbName: config.getOrThrow<string>('MONGODB_DB_NAME'),
    maxPoolSize: config.getOrThrow<number>('MONGODB_MAX_POOL_SIZE'),
    minPoolSize: config.getOrThrow<number>('MONGODB_MIN_POOL_SIZE'),
    maxConnecting: config.getOrThrow<number>('MONGODB_MAX_CONNECTING'),
    maxIdleTimeMS: config.getOrThrow<number>('MONGODB_MAX_IDLE_TIME_MS'),
    waitQueueTimeoutMS: config.getOrThrow<number>(
      'MONGODB_WAIT_QUEUE_TIMEOUT_MS',
    ),
    connectTimeoutMS: config.getOrThrow<number>('MONGODB_CONNECT_TIMEOUT_MS'),
    serverSelectionTimeoutMS: config.getOrThrow<number>(
      'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
    ),
    socketTimeoutMS: config.getOrThrow<number>('MONGODB_SOCKET_TIMEOUT_MS'),
    retryAttempts: config.getOrThrow<number>('MONGODB_RETRY_ATTEMPTS'),
    retryDelayMS: config.getOrThrow<number>('MONGODB_RETRY_DELAY_MS'),
    autoIndex: environment !== 'production',
  };
}
