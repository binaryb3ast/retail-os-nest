import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

@Injectable()
export class DatabaseTransactionService {
  private readonly logger = new Logger(DatabaseTransactionService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async execute<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    let outcome:
      { success: true; value: T } | { success: false; error: unknown };

    try {
      outcome = {
        success: true,
        value: await session.withTransaction(() => work(session)),
      };
    } catch (error: unknown) {
      this.logger.error('MongoDB transaction failed');
      outcome = { success: false, error };
    }

    try {
      await session.endSession();
    } catch (error: unknown) {
      this.logger.error('MongoDB session cleanup failed');
      if (outcome.success) {
        outcome = { success: false, error };
      }
    }

    if (!outcome.success) throw outcome.error;
    return outcome.value;
  }
}
