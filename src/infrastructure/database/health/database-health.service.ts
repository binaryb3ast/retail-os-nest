import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Exclude, Expose } from 'class-transformer';
import mongoose, { type Connection } from 'mongoose';

@Exclude()
export class DatabaseHealthStatusDto {
  @Expose()
  status!: 'ok';

  @Expose()
  database!: 'connected';

  constructor() {
    this.status = 'ok';
    this.database = 'connected';
  }
}

@Exclude()
export class LivenessStatusDto {
  @Expose()
  status!: 'ok';

  constructor() {
    this.status = 'ok';
  }
}

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async check(): Promise<DatabaseHealthStatusDto> {
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
      return new DatabaseHealthStatusDto();
    } catch {
      this.logger.warn('Readiness check failed: database ping failed');
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }
  }
}
