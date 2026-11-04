import * as pino from 'pino';
import { Writable } from 'node:stream';
import { redactedFields, serializeRequest } from './logging.module';

describe('structured logging safety', () => {
  it('redacts sensitive fields in nested log data', () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = pino(
      { redact: { paths: redactedFields, censor: '[REDACTED]' } },
      destination,
    );

    logger.info(
      {
        user: { password: 'hidden', email: 'person@example.test' },
        event: { actor: { credentials: { otp: '123456' } } },
        req: { headers: { authorization: 'Bearer hidden' } },
        res: { headers: { 'set-cookie': 'session=hidden' } },
      },
      'safe event',
    );

    const entry: unknown = JSON.parse(output);
    expect(entry).toMatchObject({
      user: { password: '[REDACTED]', email: '[REDACTED]' },
      event: { actor: { credentials: { otp: '[REDACTED]' } } },
      req: { headers: { authorization: '[REDACTED]' } },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
    });
  });

  it('omits query strings from automatic request logs', () => {
    const request = {
      method: 'GET',
      url: '/records?token=secret',
    };

    expect(serializeRequest(request)).toEqual({
      method: 'GET',
      url: '/records',
    });
  });
});
