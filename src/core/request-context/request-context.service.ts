import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): RequestContext | undefined {
    return this.storage.getStore();
  }
}
