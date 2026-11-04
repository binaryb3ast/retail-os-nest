import { ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { DatabaseHealthService } from './database-health.service';

describe('DatabaseHealthService', () => {
  it('returns ready after a successful lightweight ping', async () => {
    const service = new DatabaseHealthService({
      readyState: 1,
      db: { admin: () => ({ ping: jest.fn().mockResolvedValue({ ok: 1 }) }) },
    } as unknown as Connection);

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('reports disconnected and ping failures as unavailable', async () => {
    const disconnected = new DatabaseHealthService({
      readyState: 0,
      db: undefined,
    } as unknown as Connection);
    const failedPing = new DatabaseHealthService({
      readyState: 1,
      db: { admin: () => ({ ping: jest.fn().mockRejectedValue(new Error()) }) },
    } as unknown as Connection);

    await expect(disconnected.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(failedPing.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
