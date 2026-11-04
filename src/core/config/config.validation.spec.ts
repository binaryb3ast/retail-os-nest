import { validateApplicationEnvironment } from './config.validation';

describe('application configuration validation', () => {
  const base = { MONGODB_URI: 'mongodb://localhost:27017/store' };

  it('provides safe development defaults and validates explicit values', () => {
    expect(validateApplicationEnvironment(base)).toMatchObject({
      NODE_ENV: 'development',
      SERVICE_NAME: 'store-management-api',
      PORT: 3000,
      LOG_LEVEL: 'debug',
      HTTP_LOGGING_ENABLED: true,
      API_PREFIX: 'api',
      API_DEFAULT_VERSION: '1',
    });

    expect(
      validateApplicationEnvironment({
        ...base,
        NODE_ENV: 'production',
        PORT: '8080',
        LOG_LEVEL: 'warn',
        HTTP_LOGGING_ENABLED: 'false',
        API_PREFIX: 'store-api',
        API_DEFAULT_VERSION: '2',
      }),
    ).toMatchObject({
      PORT: 8080,
      LOG_LEVEL: 'warn',
      HTTP_LOGGING_ENABLED: false,
      API_PREFIX: 'store-api',
      API_DEFAULT_VERSION: '2',
    });
  });

  it('rejects invalid ports, booleans, enums, and API values', () => {
    for (const input of [
      { ...base, PORT: '70000' },
      { ...base, PORT: '3.5' },
      { ...base, HTTP_LOGGING_ENABLED: 'yes' },
      { ...base, LOG_LEVEL: 'verbose-ish' },
      { ...base, API_PREFIX: '/api' },
      { ...base, API_DEFAULT_VERSION: 'v1' },
    ]) {
      expect(() => validateApplicationEnvironment(input)).toThrow(
        /Invalid environment configuration/,
      );
    }
  });

  it('requires database configuration because the app opens MongoDB at startup', () => {
    expect(() => validateApplicationEnvironment({ PORT: '3000' })).toThrow(
      /MONGODB_URI is required/,
    );
  });
});
