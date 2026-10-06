export type HttpMethod = "GET" | "POST";

export type FetchFunction = typeof globalThis.fetch;

export interface CallOptions {
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  signal?: AbortSignal | undefined;
  idempotencyKey?: string | undefined;
  ifNoneMatch?: string | undefined;
  pollAfterMs?: number | undefined;
}

export interface Envelope<T> {
  data: T | null;
  apiRequestId?: string | undefined;
  executionId?: string | undefined;
  durationMs?: number | undefined;
  pageToken?: string | undefined;
  error?:
    | { code?: string | undefined; description?: string | undefined }
    | undefined;
}
