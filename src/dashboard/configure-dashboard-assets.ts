import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Express, Request, Response } from 'express';
import * as express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function configureDashboardAssets(
  app: INestApplication,
  config: ConfigService,
): void {
  const server = app.getHttpAdapter().getInstance() as unknown as Express;
  const publicDirectory = join(process.cwd(), 'public');
  const builtViewsDirectory = join(process.cwd(), 'dist/views');
  const viewsDirectory = existsSync(builtViewsDirectory)
    ? builtViewsDirectory
    : join(process.cwd(), 'src/views');
  server.get('/', (_request: Request, response: Response) => {
    response.redirect('/login.html');
  });
  server.get('/admin/config.json', (_request: Request, response: Response) => {
    response.json({
      apiBase: `http://localhost:3000/${config.getOrThrow<string>('api.prefix')}/v${config.getOrThrow<string>('api.defaultVersion')}`,
    });
  });
  app.use(express.static(publicDirectory, { index: false }));
  app.use(
    '/admin',
    express.static(viewsDirectory, {
      index: 'main.html',
    }),
  );
}
