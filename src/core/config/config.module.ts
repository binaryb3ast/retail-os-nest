import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  apiConfig,
  appConfig,
  loggingConfig,
  serverConfig,
} from './config.factory';
import { validateApplicationEnvironment } from './config.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateApplicationEnvironment,
      load: [appConfig, serverConfig, loggingConfig, apiConfig],
    }),
  ],
  exports: [ConfigModule],
})
export class CoreConfigModule {}
