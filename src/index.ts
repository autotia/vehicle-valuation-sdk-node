import { ClientCredentialsTokenProvider } from "./auth/client-credentials.js";
import type { TokenProvider } from "./auth/token-provider.js";
import type { RequestConfig } from "./core/request.js";
import type { FetchFunction } from "./core/types.js";
import { CatalogResource } from "./resources/catalog.js";
import { ValuationsResource } from "./resources/valuations.js";

export * from "./core/errors.js";
export * from "./core/types.js";
export * from "./resources/types.js";
export type { TokenProvider } from "./auth/token-provider.js";
export type {
  ClientCredentialsTokenProvider,
  ClientCredentialsOptions,
} from "./auth/client-credentials.js";
export type { ValuationsResource } from "./resources/valuations.js";
export type { CatalogResource } from "./resources/catalog.js";

export interface VehicleValuationClientOptions {
  environment?: "dev" | "prod" | undefined;
  baseUrl?: string | undefined;
  tokenUrl?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  scopes?: string[] | undefined;
  tokenProvider?: TokenProvider | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  fetch?: FetchFunction | undefined;
}

const ENVIRONMENTS = {
  dev: {
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl:
      "https://prdrpt-b2b-dev.auth.us-east-1.amazoncognito.com/oauth2/token",
  },
  // Pendiente de confirmar antes de publicar el preset en prod.
  prod: {
    baseUrl: "https://api.autotia.com/public-secure/shop-b2b",
    tokenUrl:
      "https://prdrpt-b2b-prod.auth.us-east-1.amazoncognito.com/oauth2/token",
  },
} as const;

export class VehicleValuationClient {
  readonly #valuations: ValuationsResource;
  readonly #catalog: CatalogResource;

  public get valuations(): ValuationsResource {
    return this.#valuations;
  }

  public get catalog(): CatalogResource {
    return this.#catalog;
  }

  public constructor(options: VehicleValuationClientOptions) {
    if (
      !options ||
      (!options.environment && !(options.baseUrl && options.tokenUrl))
    ) {
      throw new TypeError(
        "Indica environment o proporciona baseUrl y tokenUrl.",
      );
    }
    const preset = options.environment
      ? ENVIRONMENTS[options.environment]
      : undefined;
    if (options.environment && !preset) {
      throw new TypeError("environment debe ser dev o prod.");
    }
    const baseUrl = options.baseUrl ?? preset?.baseUrl;
    const tokenUrl = options.tokenUrl ?? preset?.tokenUrl;
    if (!baseUrl || !tokenUrl) {
      throw new TypeError("No se pudo determinar baseUrl y tokenUrl.");
    }
    const fetchFn = options.fetch ?? globalThis.fetch;
    let tokenProvider = options.tokenProvider;
    if (!tokenProvider) {
      if (!options.clientId || !options.clientSecret) {
        throw new TypeError(
          "Se requieren clientId y clientSecret, o tokenProvider.",
        );
      }
      tokenProvider = new ClientCredentialsTokenProvider(
        tokenUrl,
        options.clientId,
        options.clientSecret,
        {
          fetch: fetchFn,
          scopes: options.scopes,
        },
      );
    }

    const config: RequestConfig = {
      baseUrl,
      fetch: fetchFn,
      tokenProvider,
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: options.timeoutMs ?? 30000,
    };

    this.#valuations = new ValuationsResource(config);
    this.#catalog = new CatalogResource(config);
  }
}
