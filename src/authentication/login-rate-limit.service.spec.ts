import { HttpStatus } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ApplicationException } from '../core/errors/application.exception';
import { LoginRateLimitRecord } from './login-rate-limit.schema';
import { LoginRateLimitService } from './login-rate-limit.service';

describe('LoginRateLimitService', () => {
  function serviceWithAttempts(attempts: number) {
    const exec = jest.fn().mockResolvedValue({ attempts });
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    const model = {
      findOneAndUpdate,
    } as unknown as Model<LoginRateLimitRecord>;
    return { service: new LoginRateLimitService(model), findOneAndUpdate };
  }

  it('allows attempts within the shared identity and address window', async () => {
    const { service, findOneAndUpdate } = serviceWithAttempts(10);
    await expect(
      service.assertAllowed('admin@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects attempts after the window limit', async () => {
    const { service } = serviceWithAttempts(11);
    let failure: unknown;
    try {
      await service.assertAllowed('admin@example.com', '127.0.0.1');
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ApplicationException);
    expect(failure).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
    if (failure instanceof ApplicationException) {
      expect(failure.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
