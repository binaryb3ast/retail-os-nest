import { registerAs } from '@nestjs/config';
import { isLogLevel } from './config.validation';

export const appConfig = registerAs('app', () => ({
  name: process.env.SERVICE_NAME ?? 'store-management-api',
  environment: process.env.NODE_ENV ?? 'development',
}));

export const serverConfig = registerAs('server', () => ({
  port: Number(process.env.PORT ?? 3000),
}));

export const loggingConfig = registerAs('logging', () => {
  const environment = process.env.NODE_ENV ?? 'development';
  const level =
    process.env.LOG_LEVEL ?? (environment === 'development' ? 'debug' : 'info');
  if (!isLogLevel(level)) {
    throw new Error('Invalid log level after configuration validation');
  }
  const httpLogging = process.env.HTTP_LOGGING_ENABLED ?? 'true';
  if (httpLogging !== 'true' && httpLogging !== 'false') {
    throw new Error(
      'Invalid HTTP logging setting after configuration validation',
    );
  }
  return {
    level,
    pretty: environment === 'development',
    httpEnabled: httpLogging === 'true',
  };
});

export const apiConfig = registerAs('api', () => ({
  prefix: process.env.API_PREFIX ?? 'api',
  defaultVersion: process.env.API_DEFAULT_VERSION ?? '1',
}));
