import { ValuationFailedError, WaiterTimeoutError } from "../core/errors.js";
import { type RequestConfig, requestData } from "../core/request.js";
import type { CallOptions } from "../core/types.js";
import type {
  ValuationAcceptance,
  ValuationRequest,
  ValuationStatus,
} from "./types.js";

export class ValuationsResource {
  readonly #config: RequestConfig;

  public constructor(config: RequestConfig) {
    this.#config = config;
  }

  public create(
    input: ValuationRequest,
    options: CallOptions = {},
  ): Promise<ValuationAcceptance | ValuationStatus> {
    const opts: CallOptions = options.idempotencyKey
      ? options
      : { ...options, idempotencyKey: crypto.randomUUID() };
    return requestData<ValuationAcceptance | ValuationStatus>(
      this.#config,
      "POST",
      "/v1/vehicle-valuation",
      input,
      opts,
    );
  }

  public get(
    valuationId: string,
    options: CallOptions = {},
  ): Promise<ValuationStatus> {
    return requestData<ValuationStatus>(
      this.#config,
      "GET",
      `/v1/vehicle-valuation/${encodeURIComponent(valuationId)}`,
      undefined,
      options,
    );
  }

  public async waitUntilComplete(
    valuationId: string,
    options: CallOptions = {},
  ): Promise<ValuationStatus> {
    const timeout = options.timeoutMs ?? 120000;
    const started = Date.now();
    let delay = options.pollAfterMs ?? 2000;

    while (Date.now() - started < timeout) {
      if (options.signal?.aborted) {
        throw new WaiterTimeoutError("La espera fue cancelada.", {
          cause: options.signal.reason,
        });
      }

      const remaining = timeout - (Date.now() - started);
      const status = await this.get(valuationId, {
        ...options,
        timeoutMs: Math.max(1, remaining),
      });

      if (status.status === "FAILED") {
        const failure = status.failure ?? {
          code: "service_unavailable",
          description: "La tasación terminó sin resultado.",
        };
        throw new ValuationFailedError(failure.description, {
          code: failure.code,
        });
      }

      if (status.status === "COMPLETED" && status.result) {
        return status;
      }

      const waitMs = Math.min(
        delay,
        Math.max(0, timeout - (Date.now() - started)),
      );
      if (waitMs <= 0) break;
      await waitFor(waitMs, options.signal);
      delay = options.pollAfterMs ?? delay;
    }

    throw new WaiterTimeoutError("La espera superó el plazo configurado.");
  }
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new WaiterTimeoutError("La espera fue cancelada.", {
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
        new WaiterTimeoutError("La espera fue cancelada.", {
          cause: signal?.reason,
        }),
      );
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
