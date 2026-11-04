import { Logger } from '@nestjs/common';
import type { MongooseModuleFactoryOptions } from '@nestjs/mongoose';
import { getDatabaseConfig } from '../config/database.config';
import type { DatabaseConfigReader } from '../database.types';

export function createMongooseOptions(
  config: DatabaseConfigReader,
): MongooseModuleFactoryOptions {
  const database = getDatabaseConfig(config);
  const logger = new Logger('MongoDB');

  return {
    uri: database.uri,
    dbName: database.dbName,
    retryAttempts: database.retryAttempts,
    retryDelay: database.retryDelayMS,
    autoIndex: database.autoIndex,
    maxPoolSize: database.maxPoolSize,
    minPoolSize: database.minPoolSize,
    maxConnecting: database.maxConnecting,
    maxIdleTimeMS: database.maxIdleTimeMS,
    waitQueueTimeoutMS: database.waitQueueTimeoutMS,
    connectTimeoutMS: database.connectTimeoutMS,
    serverSelectionTimeoutMS: database.serverSelectionTimeoutMS,
    socketTimeoutMS: database.socketTimeoutMS,
    onConnectionCreate: (connection) => {
      connection.on('connected', () => logger.log('Connected'));
      connection.on('disconnected', () => logger.warn('Disconnected'));
      connection.on('reconnected', () => logger.log('Reconnected'));
      connection.on('error', () => logger.error('Connection error'));
    },
  };
}
