export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
}

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const contextIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isValidContextId(value: string): boolean {
  return contextIdPattern.test(value);
}
