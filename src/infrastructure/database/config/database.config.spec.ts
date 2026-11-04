import {
  getDatabaseConfig,
  validateDatabaseEnvironment,
} from './database.config';

describe('database configuration', () => {
  it('applies bounded defaults and disables automatic indexes in production', () => {
    const values = validateDatabaseEnvironment({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017',
    });
    const config = {
      getOrThrow: <T>(key: string) => values[key] as T,
    };

    expect(getDatabaseConfig(config)).toMatchObject({
      dbName: 'store_management',
      maxPoolSize: 20,
      minPoolSize: 0,
      maxConnecting: 2,
      maxIdleTimeMS: 60000,
      waitQueueTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      retryAttempts: 5,
      retryDelayMS: 3000,
      autoIndex: false,
    });
  });

  it('rejects malformed and inconsistent settings', () => {
    expect(() =>
      validateDatabaseEnvironment({ MONGODB_URI: 'not-a-mongodb-uri' }),
    ).toThrow(/Invalid environment configuration/);
    expect(() =>
      validateDatabaseEnvironment({
        MONGODB_URI: 'mongodb://localhost',
        MONGODB_MAX_POOL_SIZE: 'many',
      }),
    ).toThrow(/Invalid environment configuration/);
    expect(() =>
      validateDatabaseEnvironment({
        MONGODB_URI: 'mongodb://localhost',
        MONGODB_MAX_POOL_SIZE: '5',
        MONGODB_MIN_POOL_SIZE: '6',
      }),
    ).toThrow(/must not exceed/);
  });
});
