import { RequestContextService } from './request-context.service';
import { isValidContextId } from './request-context.types';

describe('RequestContextService', () => {
  it('keeps async contexts isolated between concurrent operations', async () => {
    const context = new RequestContextService();
    const result = await Promise.all([
      context.run({ requestId: 'req-a', correlationId: 'corr-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return context.current();
      }),
      context.run({ requestId: 'req-b', correlationId: 'corr-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return context.current();
      }),
    ]);

    expect(result).toEqual([
      { requestId: 'req-a', correlationId: 'corr-a' },
      { requestId: 'req-b', correlationId: 'corr-b' },
    ]);
    expect(context.current()).toBeUndefined();
  });

  it('accepts bounded safe identifiers and rejects unsafe or oversized values', () => {
    expect(isValidContextId('req-01:abc.123')).toBe(true);
    expect(isValidContextId('bad id')).toBe(false);
    expect(isValidContextId('x'.repeat(129))).toBe(false);
  });
});
