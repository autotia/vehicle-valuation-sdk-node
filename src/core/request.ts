import type { TokenProvider } from "../auth/token-provider.js";
import {
  AuthenticationError,
  AutotiaConnectionError,
  AutotiaError,
  makeHttpError,
} from "./errors.js";
import { getRetrySettings, isTransient, retryDelay } from "./retry.js";
import type {
  CallOptions,
  Envelope,
  FetchFunction,
  HttpMethod,
} from "./types.js";

export interface RequestConfig {
  baseUrl: string;
  fetch: FetchFunction;
  tokenProvider: TokenProvider;
  maxRetries: number;
  timeoutMs: number;
}

export async function requestData<T>(
  config: RequestConfig,
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: CallOptions = {},
): Promise<T> {
  const started = Date.now();
  const timeout = options.timeoutMs ?? config.timeoutMs;
  const retrySettings = getRetrySettings(options, config.maxRetries);
  let retries = 0;
  let authRefreshes = 0;
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  while (true) {
    if (options.signal?.aborted) {
      throw new AutotiaConnectionError("La solicitud fue cancelada.", {
        cause: options.signal.reason,
      });
    }
    if (Date.now() - started >= timeout) {
      throw new AutotiaConnectionError("La llamada superó su plazo total.");
    }

    const token = await config.tokenProvider.getToken();
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    if (serialized !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
    if (options.ifNoneMatch) {
      headers.set("If-None-Match", options.ifNoneMatch);
    }

    const remaining = timeout - (Date.now() - started);
    const timeoutSignal = AbortSignal.timeout(Math.max(1, remaining));
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const requestInit: RequestInit = {
        method,
        headers,
        signal: requestSignal,
      };
      if (serialized !== undefined) {
        requestInit.body = serialized;
      }
      const response = await config.fetch(
        joinUrl(config.baseUrl, path),
        requestInit,
      );

      if (response.status === 304) {
        return null as T;
      }

      const responseText = await response.text();
      const envelope = parseEnvelope(responseText);

      if (response.status === 401 && authRefreshes < 1) {
        authRefreshes += 1;
        config.tokenProvider.invalidate?.();
        continue;
      }

      if (!response.ok) {
        throw makeHttpError(response.status, envelope, responseText);
      }

      if (
        !envelope ||
        !Object.prototype.hasOwnProperty.call(envelope, "data")
      ) {
        throw new AutotiaError("La API devolvió un envelope no válido.", {
          status: response.status,
        });
      }

      if (envelope.error) {
        throw makeHttpError(response.status, envelope, responseText);
      }

      return envelope.data as T;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AutotiaConnectionError("La solicitud fue cancelada.", {
          cause: options.signal.reason,
        });
      }
      if (timeoutSignal.aborted) {
        throw new AutotiaConnectionError("La llamada superó su plazo total.", {
          cause: error,
        });
      }

      const sdkError = asSdkError(error);
      if (!isTransient(sdkError) || retries >= retrySettings.maxRetries) {
        throw sdkError;
      }

      const delay = retryDelay(
        retries,
        retrySettings.baseDelayMs,
        retrySettings.maxDelayMs,
      );
      retries += 1;
      const remainingAfterError = timeout - (Date.now() - started);
      if (remainingAfterError <= delay) {
        throw new AutotiaConnectionError("La llamada superó su plazo total.", {
          cause: sdkError,
        });
      }

      await wait(delay, options.signal);
    }
  }
}

function parseEnvelope(body: string): Envelope<unknown> | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object"
      ? (parsed as Envelope<unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function asSdkError(error: unknown): AutotiaError {
  if (error instanceof AutotiaError) return error;
  if (error instanceof Error) {
    return new AutotiaConnectionError("Falló la comunicación con la API.", {
      cause: error,
    });
  }
  return new AutotiaConnectionError("Falló la comunicación con la API.");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new AutotiaConnectionError("La solicitud fue cancelada.", {
          cause: signal.reason,
        }),
      );
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new AutotiaConnectionError("La solicitud fue cancelada.", {
          cause: signal?.reason,
        }),
      );
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function isAuthenticationError(
  error: unknown,
): error is AuthenticationError {
  return error instanceof AuthenticationError;
}
