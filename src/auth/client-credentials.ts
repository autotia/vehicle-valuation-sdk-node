import { AuthenticationError, AutotiaConnectionError } from "../core/errors.js";
import type { FetchFunction } from "../core/types.js";
import type { TokenProvider } from "./token-provider.js";

export interface ClientCredentialsOptions {
  fetch?: FetchFunction | undefined;
  scopes?: string[] | undefined;
}

export class ClientCredentialsTokenProvider implements TokenProvider {
  #token: string | undefined;
  #expiresAt = 0;
  #pending: Promise<string> | undefined;
  readonly #fetch: FetchFunction;
  readonly #tokenUrl: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #scopes: string[] | undefined;

  public constructor(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    options: ClientCredentialsOptions = {},
  ) {
    this.#tokenUrl = tokenUrl;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#scopes = options.scopes;
  }

  public getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.#token && Date.now() < this.#expiresAt) {
      return Promise.resolve(this.#token);
    }
    if (this.#pending) {
      return this.#pending;
    }
    const promise = this.#fetchToken();
    this.#pending = promise;
    promise.then(
      () => {
        if (this.#pending === promise) this.#pending = undefined;
      },
      () => {
        if (this.#pending === promise) this.#pending = undefined;
      },
    );
    return promise;
  }

  public invalidate(): void {
    this.#token = undefined;
    this.#expiresAt = 0;
  }

  async #fetchToken(): Promise<string> {
    const form = new URLSearchParams();
    form.set("grant_type", "client_credentials");
    if (this.#scopes && this.#scopes.length > 0) {
      form.set("scope", this.#scopes.join(" "));
    }
    const auth = btoa(`${this.#clientId}:${this.#clientSecret}`);
    const headers = new Headers({
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });

    let response: Response;
    try {
      response = await this.#fetch(this.#tokenUrl, {
        method: "POST",
        headers,
        body: form.toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (error instanceof AutotiaConnectionError) throw error;
      throw new AutotiaConnectionError(
        "No se pudo conectar con el servicio de autenticación.",
        { cause: error },
      );
    }

    let payload: unknown;
    try {
      const text = await response.text();
      payload = JSON.parse(text);
    } catch (error) {
      throw new AuthenticationError(
        "El servicio de autenticación devolvió una respuesta no válida.",
        {
          status: response.status,
          cause: error,
        },
      );
    }

    if (!response.ok || !isTokenPayload(payload)) {
      throw new AuthenticationError("No se pudo obtener un token de acceso.", {
        status: response.status,
      });
    }

    const ttl =
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : 300;
    const accessToken = payload.access_token;
    this.#token = accessToken;
    this.#expiresAt = Date.now() + Math.max(0, ttl * 1000 - 60000);
    if (this.#expiresAt <= Date.now()) {
      this.#expiresAt = Date.now() + Math.floor(ttl * 1000 * 0.8);
    }
    return accessToken;
  }
}

function isTokenPayload(
  value: unknown,
): value is { access_token: string; expires_in?: unknown } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { access_token?: unknown }).access_token === "string",
  );
}
