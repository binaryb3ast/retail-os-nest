import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';
import { ApplicationException } from '../core/errors/application.exception';
import { LoginRateLimitRecord } from './login-rate-limit.schema';

const windowMs = 15 * 60 * 1000;
const maxAttemptsPerKey = 10;

@Injectable()
export class LoginRateLimitService implements OnModuleInit {
  constructor(
    @InjectModel(LoginRateLimitRecord.name)
    private readonly buckets: Model<LoginRateLimitRecord>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.buckets.createIndexes();
  }

  async assertAllowed(identity: string, address: string): Promise<void> {
    const now = new Date();
    const key = createHash('sha256')
      .update(`${identity.trim().toLowerCase()}\0${address}`)
      .digest('hex');
    const cutoff = new Date(now.getTime() - windowMs);
    let bucket: LoginRateLimitRecord | null;
    try {
      bucket = await this.buckets
        .findOneAndUpdate(
          { _id: key },
          [
            {
              $set: {
                windowStartedAt: {
                  $cond: [
                    {
                      $lt: [
                        { $ifNull: ['$windowStartedAt', new Date(0)] },
                        cutoff,
                      ],
                    },
                    now,
                    '$windowStartedAt',
                  ],
                },
                attempts: {
                  $cond: [
                    {
                      $lt: [
                        { $ifNull: ['$windowStartedAt', new Date(0)] },
                        cutoff,
                      ],
                    },
                    1,
                    { $add: [{ $ifNull: ['$attempts', 0] }, 1] },
                  ],
                },
                expiresAt: new Date(now.getTime() + windowMs),
              },
            },
          ],
          { upsert: true, new: true, lean: true },
        )
        .exec();
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        return this.assertAllowed(identity, address);
      }
      throw error;
    }
    if (bucket && bucket.attempts > maxAttemptsPerKey) {
      throw new ApplicationException(
        'LOGIN_RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many sign-in attempts. Try again in 15 minutes.',
      );
    }
  }
}
