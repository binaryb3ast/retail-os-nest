import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { type Connection } from 'mongoose';

export interface DatabaseHealthStatus {
  status: 'ok';
  database: 'connected';
}

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async check(): Promise<DatabaseHealthStatus> {
    if (
      this.connection.readyState !== mongoose.STATES.connected ||
      !this.connection.db
    ) {
      this.logger.warn('Readiness check failed: database is not connected');
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'disconnected',
      });
    }

    try {
      await this.connection.db.admin().ping();
      return { status: 'ok', database: 'connected' };
    } catch {
      this.logger.warn('Readiness check failed: database ping failed');
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }
  }
}
