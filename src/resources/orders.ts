import {
  OrderFailedError,
  TrimInferenceError,
  WaiterTimeoutError,
} from "../core/errors.js";
import { type RequestConfig, requestData } from "../core/request.js";
import type { CallOptions } from "../core/types.js";
import { CatalogResource } from "./catalog.js";
import type {
  OrderAcceptance,
  OrderFromTrimTextOptions,
  OrderFromTrimTextRequest,
  OrderFromTrimTextResult,
  OrderRequest,
  OrderStatus,
} from "./types.js";

export class OrdersResource {
  readonly #config: RequestConfig;
  readonly #catalog: CatalogResource;

  public constructor(config: RequestConfig) {
    this.#config = config;
    this.#catalog = new CatalogResource(config);
  }

  public create(
    input: OrderRequest,
    options: CallOptions = {},
  ): Promise<OrderAcceptance | OrderStatus> {
    const opts: CallOptions = options.idempotencyKey
      ? options
      : { ...options, idempotencyKey: crypto.randomUUID() };
    return requestData<OrderAcceptance | OrderStatus>(
      this.#config,
      "POST",
      "/v1/orders",
      input,
      opts,
    );
  }

  public async createFromTrimText(
    input: OrderFromTrimTextRequest,
    options: OrderFromTrimTextOptions = {},
  ): Promise<OrderFromTrimTextResult> {
    const inferenceOptions: CallOptions = {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    };
    const inference = await this.#catalog.inferTrim(
      {
        mark: input.mark,
        model: input.model,
        year: input.year,
        text: input.trimText,
        limit: input.limit,
      },
      inferenceOptions,
    );

    if (inference.outcome === "no_evidence") {
      throw new TrimInferenceError(
        "El texto no aporta evidencia suficiente para determinar una versión.",
        inference.outcome,
        inference.versions,
      );
    }

    if (inference.outcome === "no_match") {
      throw new TrimInferenceError(
        "El texto no coincide con ninguna versión del catálogo para el año indicado.",
        inference.outcome,
        inference.versions,
      );
    }

    const firstCandidate = inference.versions[0];
    if (
      inference.outcome !== "matched" ||
      !inference.versions ||
      inference.versions.length === 0 ||
      !firstCandidate
    ) {
      throw new TrimInferenceError(
        `No fue posible determinar una versión compatible (resultado: ${inference.outcome}).`,
        inference.outcome,
        inference.versions ?? [],
      );
    }
    if (
      options.minConfidence !== undefined &&
      firstCandidate.confidence < options.minConfidence
    ) {
      throw new TrimInferenceError(
        `La confianza del candidato principal (${firstCandidate.confidence}) es inferior al umbral mínimo requerido (${options.minConfidence}).`,
        inference.outcome,
        inference.versions,
      );
    }

    const selectedVersion = firstCandidate.version;

    const orderOptions: CallOptions = {
      idempotencyKey: options.idempotencyKey,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      pollAfterMs: options.pollAfterMs,
    };

    const orderRequest: OrderRequest = {
      reportType: input.reportType,
      mark: input.mark,
      model: input.model,
      year: input.year,
      version: selectedVersion,
      odometerKm: input.odometerKm,
    };

    const order = await this.create(orderRequest, orderOptions);

    return {
      order,
      inference,
      selectedVersion,
    };
  }

  public get(orderId: string, options: CallOptions = {}): Promise<OrderStatus> {
    return requestData<OrderStatus>(
      this.#config,
      "GET",
      `/v1/orders/${encodeURIComponent(orderId)}`,
      undefined,
      options,
    );
  }

  public async waitUntilComplete(
    orderId: string,
    options: CallOptions = {},
  ): Promise<OrderStatus> {
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
      const status = await this.get(orderId, {
        ...options,
        timeoutMs: Math.max(1, remaining),
      });

      if (status.status === "FAILED") {
        const failure = status.failure ?? {
          code: "service_unavailable",
          description: "El pedido terminó sin resultado.",
        };
        throw new OrderFailedError(failure.description, {
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
