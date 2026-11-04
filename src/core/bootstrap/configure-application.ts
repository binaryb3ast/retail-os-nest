import {
  RequestMethod,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { RequestContextMiddleware } from '../request-context/request-context.middleware';

export function configureApplication(app: INestApplication): void {
  const requestContextMiddleware = app.get(RequestContextMiddleware);
  app.use(requestContextMiddleware.use.bind(requestContextMiddleware));
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  app.setGlobalPrefix(config.getOrThrow<string>('api.prefix'), {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/database', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.getOrThrow<string>('api.defaultVersion'),
  });
}
