import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApplication } from './core/bootstrap/configure-application';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  configureApplication(app);
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('server.port'));
}
void bootstrap().catch(() => {
  new Logger('Bootstrap').error('Application failed to start');
  process.exitCode = 1;
});
