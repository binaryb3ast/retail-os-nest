import type { ConfigService } from '@nestjs/config';

export interface DatabaseConfig {
  uri: string;
  dbName: string;
  maxPoolSize: number;
  minPoolSize: number;
  maxConnecting: number;
  maxIdleTimeMS: number;
  waitQueueTimeoutMS: number;
  connectTimeoutMS: number;
  serverSelectionTimeoutMS: number;
  socketTimeoutMS: number;
  retryAttempts: number;
  retryDelayMS: number;
  autoIndex: boolean;
}

export type DatabaseConfigReader = Pick<ConfigService, 'getOrThrow'>;
