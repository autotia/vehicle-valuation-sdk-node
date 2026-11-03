import { ClientCredentialsTokenProvider } from "./auth/client-credentials.js";
import type { TokenProvider } from "./auth/token-provider.js";
import type { RequestConfig } from "./core/request.js";
import type { FetchFunction } from "./core/types.js";
import { CatalogResource } from "./resources/catalog.js";
import { OrdersResource } from "./resources/orders.js";

export {
  AutotiaConnectionError,
  AutotiaError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  OrderFailedError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  TrimInferenceError,
  UnprocessableEntityError,
  WaiterTimeoutError,
  type ErrorDetails,
} from "./core/errors.js";
export * from "./core/types.js";
export * from "./resources/types.js";
export type { TokenProvider } from "./auth/token-provider.js";
export type {
  ClientCredentialsTokenProvider,
  ClientCredentialsOptions,
} from "./auth/client-credentials.js";
export type { OrdersResource } from "./resources/orders.js";
export type { CatalogResource } from "./resources/catalog.js";

/**
 * Opciones de configuración para inicializar el cliente VehicleValuationClient.
 */
export interface VehicleValuationClientOptions {
  /** Entorno predefinido ('dev' para desarrollo, 'prod' para producción). */
  environment?: "dev" | "prod" | undefined;
  /** URL base personalizada de la API B2B (requiere tokenUrl si no se usa environment). */
  baseUrl?: string | undefined;
  /** URL del endpoint OAuth2 token (requiere baseUrl si no se usa environment). */
  tokenUrl?: string | undefined;
  /** Identificador de cliente OAuth2 (clientId). */
  clientId?: string | undefined;
  /** Secreto de cliente OAuth2 (clientSecret). Solo debe utilizarse en entornos seguros de backend. */
  clientSecret?: string | undefined;
  /** Scopes opcionales a solicitar en la emisión del token. */
  scopes?: string[] | undefined;
  /** Proveedor personalizado de token OAuth2 si la aplicación gestiona la autenticación de forma delegada. */
  tokenProvider?: TokenProvider | undefined;
  /** Tiempo de espera máximo por intento en milisegundos (por defecto 30000 ms). */
  timeoutMs?: number | undefined;
  /** Cantidad máxima de reintentos automáticos ante errores transitorios de red o 503 (por defecto 2). */
  maxRetries?: number | undefined;
  /** Función fetch inyectable para entornos con proxies, pruebas o instrumentación personalizada. */
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

/**
 * Cliente oficial para la API B2B de tasación vehicular de Autotia (Chile).
 */
export class VehicleValuationClient {
  readonly #orders: OrdersResource;
  readonly #catalog: CatalogResource;

  /**
   * Recurso para crear pedidos de tasación, consultar su estado y esperar su resultado mediante sondeo.
   */
  public get orders(): OrdersResource {
    return this.#orders;
  }

  /**
   * Recurso para consultar marcas, modelos y versiones del catálogo vehicular e inferir especificaciones.
   */
  public get catalog(): CatalogResource {
    return this.#catalog;
  }

  /**
   * Inicializa una nueva instancia del cliente de tasación vehicular.
   *
   * @param options Opciones de configuración del cliente (ambiente, credenciales OAuth2, timeouts).
   * @throws {TypeError} Si no se entrega un ambiente válido o faltan las credenciales requeridas.
   *
   * @example
   * ```ts
   * import { VehicleValuationClient } from "@autotia/vehicle-valuation-sdk";
   *
   * const client = new VehicleValuationClient({
   *   environment: "prod",
   *   clientId: "mi-client-id",
   *   clientSecret: "mi-client-secret",
   * });
   * ```
   */
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

    this.#orders = new OrdersResource(config);
    this.#catalog = new CatalogResource(config);
  }
}
