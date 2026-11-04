import type { Connection } from 'mongoose';
import { DatabaseTransactionService } from './database-transaction.service';

describe('DatabaseTransactionService', () => {
  it('runs work in a transaction and always closes the session', async () => {
    const session = {
      withTransaction: jest.fn((work: () => Promise<string>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DatabaseTransactionService({
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection);

    await expect(
      service.execute(() => Promise.resolve('committed')),
    ).resolves.toBe('committed');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('rethrows transaction errors after closing the session', async () => {
    const failure = new Error('transaction failed');
    const session = {
      withTransaction: jest.fn().mockRejectedValue(failure),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DatabaseTransactionService({
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection);

    await expect(service.execute(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('preserves a transaction error if session cleanup also fails', async () => {
    const failure = new Error('transaction failed');
    const session = {
      withTransaction: jest.fn().mockRejectedValue(failure),
      endSession: jest.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const service = new DatabaseTransactionService({
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection);

    await expect(service.execute(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });
});
