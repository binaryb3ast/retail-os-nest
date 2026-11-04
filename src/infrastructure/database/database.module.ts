import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseHealthController } from './health/database-health.controller';
import { DatabaseHealthService } from './health/database-health.service';
import { DatabaseTransactionService } from './database-transaction.service';
import { createMongooseOptions } from './providers/database.provider';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createMongooseOptions,
    }),
  ],
  controllers: [DatabaseHealthController],
  providers: [DatabaseHealthService, DatabaseTransactionService],
  exports: [DatabaseTransactionService],
})
export class DatabaseModule {}
