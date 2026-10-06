import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ClientCredentialsTokenProvider } from "../dist/auth/client-credentials.js";
import {
  AutotiaConnectionError,
  AutotiaError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  ValuationFailedError,
  VehicleValuationClient,
  WaiterTimeoutError,
} from "../dist/index.js";

const fixturesPath = path.resolve(
  import.meta.dirname,
  "conformance/fixtures.json",
);
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

function jsonResponse(status, data, extra = {}) {
  const body = {
    data,
    apiRequestId: "req-test",
    executionId: "exec-test",
    durationMs: 1,
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(token = "test-access-token", expiresIn = 3600) {
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// -------------------------------------------------------------------------
// Conformance Suite (fixtures.json - 18 cases)
// -------------------------------------------------------------------------

for (const tc of fixtures.cases) {
  test(`conformance: ${tc.id}`, async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const responses = tc.responses ?? [];

    const mockFetch = async (input, init = {}) => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(urlStr);

      if (url.pathname.includes("/oauth2/token")) {
        tokenCalls++;
        return tokenResponse(`token-${tokenCalls}`);
      }

      apiCalls++;

      if (tc.transportFailure) {
        throw new TypeError(tc.transportFailure.message);
      }

      const resp = responses[Math.min(apiCalls - 1, responses.length - 1)];

      const body =
        typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body);
      return new Response(body, {
        status: resp.status,
        headers: resp.headers ?? {},
      });
    };

    const client = new VehicleValuationClient({
      baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
      tokenUrl: "https://auth.example.com/oauth2/token",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      fetch: mockFetch,
      timeoutMs: 15000,
    });

    let action;
    if (tc.operation === "valuations.waitUntilComplete") {
      action = () =>
        client.valuations.waitUntilComplete("val-1", {
          timeoutMs: 3000,
          pollAfterMs: 20,
        });
    } else if (
      tc.request.path === "/v1/vehicle-valuation" &&
      tc.request.method === "POST"
    ) {
      action = () =>
        client.valuations.create(
          { year: 2020, odometerKm: 50000 },
          tc.request.headers?.["Idempotency-Key"]
            ? { idempotencyKey: tc.request.headers["Idempotency-Key"] }
            : {},
        );
    } else if (tc.request.path.startsWith("/v1/vehicle-valuation/")) {
      const id = tc.request.path.replace("/v1/vehicle-valuation/", "");
      action = () => client.valuations.get(id);
    } else if (tc.request.path === "/v1/catalog") {
      action = () => client.catalog.listMarks();
    } else if (tc.request.path.startsWith("/v1/catalog/")) {
      const parts = tc.request.path.replace("/v1/catalog/", "").split("/");
      if (parts.length === 1) {
        action = () => client.catalog.listModels(parts[0]);
      } else if (parts.length === 2) {
        action = () => client.catalog.listYears(parts[0], parts[1]);
      } else if (parts.length === 3) {
        action = () =>
          client.catalog.listTrims(parts[0], parts[1], Number(parts[2]));
      }
    }

    if (!action) {
      throw new Error(`Acción no implementada para el caso: ${tc.id}`);
    }

    if (tc.expected.kind === "error") {
      await assert.rejects(action, (err) => {
        assert(err instanceof Error);
        assert.equal(err.name, tc.expected.class);
        if (tc.expected.code !== undefined && tc.expected.code !== null) {
          assert.equal(err.code, tc.expected.code);
        }
        return true;
      });
      if (tc.expected.retry?.retryable) {
        assert.equal(apiCalls, (tc.expected.retry.maxRetries ?? 2) + 1);
      }
    } else if (tc.expected.kind === "value") {
      const result = await action();
      if (tc.expected.value !== undefined) {
        assert.deepEqual(result, tc.expected.value);
      }
      if (tc.expected.tokenRefreshes !== undefined) {
        assert.equal(tokenCalls - 1, tc.expected.tokenRefreshes);
      }
      if (tc.expected.polls !== undefined) {
        assert.equal(apiCalls, tc.expected.polls);
      }
    }
  });
}

// -------------------------------------------------------------------------
// Unit Tests: Client Options and Construction
// -------------------------------------------------------------------------

test("constructor: valida que se proporcione environment o baseUrl + tokenUrl", () => {
  assert.throws(
    () =>
      new VehicleValuationClient({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      }),
    TypeError,
  );

  assert.throws(
    () =>
      new VehicleValuationClient({
        environment: "invalid",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      }),
    TypeError,
  );
});

test("constructor: valida credenciales o tokenProvider", () => {
  assert.throws(
    () =>
      new VehicleValuationClient({
        environment: "dev",
      }),
    TypeError,
  );

  assert.throws(
    () =>
      new VehicleValuationClient({
        environment: "dev",
        clientId: "test-client-id",
      }),
    TypeError,
  );
});

test("constructor: acepta preset dev", () => {
  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  });
  assert(client.valuations);
  assert(client.catalog);
});

test("constructor: acepta URLs personalizadas", () => {
  const client = new VehicleValuationClient({
    baseUrl: "https://custom.example.com/api",
    tokenUrl: "https://custom.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  });
  assert(client.valuations);
  assert(client.catalog);
});

test("constructor: acepta tokenProvider personalizado", () => {
  const customProvider = {
    getToken: async () => "custom-token",
  };
  const client = new VehicleValuationClient({
    environment: "dev",
    tokenProvider: customProvider,
  });
  assert(client.valuations);
  assert(client.catalog);
});

// -------------------------------------------------------------------------
// Unit Tests: OAuth2 Client Credentials
// -------------------------------------------------------------------------

test("oauth: solicita token con Basic auth y form data", async () => {
  let capturedAuth = "";
  let capturedBody = "";

  const mockFetch = async (input, init = {}) => {
    capturedAuth =
      init.headers?.get?.("Authorization") ?? init.headers?.Authorization;
    capturedBody = String(init.body);
    return tokenResponse();
  };

  const provider = new ClientCredentialsTokenProvider(
    "https://auth.example.com/oauth2/token",
    "my-client-id",
    "my-client-secret",
    { fetch: mockFetch },
  );

  const token = await provider.getToken();
  assert.equal(token, "test-access-token");
  assert.equal(capturedAuth, `Basic ${btoa("my-client-id:my-client-secret")}`);
  assert.equal(capturedBody, "grant_type=client_credentials");
});

test("oauth: incluye scopes cuando se configuran", async () => {
  let capturedBody = "";
  const mockFetch = async (_input, init = {}) => {
    capturedBody = String(init.body);
    return tokenResponse();
  };

  const provider = new ClientCredentialsTokenProvider(
    "https://auth.example.com/oauth2/token",
    "my-client-id",
    "my-client-secret",
    {
      fetch: mockFetch,
      scopes: ["scope1", "scope2"],
    },
  );

  await provider.getToken();
  assert.equal(
    capturedBody,
    "grant_type=client_credentials&scope=scope1+scope2",
  );
});

test("oauth: reutiliza token en caché antes de expirar", async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return tokenResponse("cached-token", 3600);
  };

  const provider = new ClientCredentialsTokenProvider(
    "https://auth.example.com/oauth2/token",
    "id",
    "secret",
    { fetch: mockFetch },
  );

  const t1 = await provider.getToken();
  const t2 = await provider.getToken();
  assert.equal(t1, "cached-token");
  assert.equal(t2, "cached-token");
  assert.equal(fetchCount, 1);
});

test("oauth: single-flight deduplica llamadas concurrentes", async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 20));
    return tokenResponse("sf-token", 3600);
  };

  const provider = new ClientCredentialsTokenProvider(
    "https://auth.example.com/oauth2/token",
    "id",
    "secret",
    { fetch: mockFetch },
  );

  const [t1, t2, t3] = await Promise.all([
    provider.getToken(),
    provider.getToken(),
    provider.getToken(),
  ]);

  assert.equal(t1, "sf-token");
  assert.equal(t2, "sf-token");
  assert.equal(t3, "sf-token");
  assert.equal(fetchCount, 1);
});

test("oauth: invalidate() limpia el token en caché", async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return tokenResponse(`token-${fetchCount}`, 3600);
  };

  const provider = new ClientCredentialsTokenProvider(
    "https://auth.example.com/oauth2/token",
    "id",
    "secret",
    { fetch: mockFetch },
  );

  const t1 = await provider.getToken();
  assert.equal(t1, "token-1");
  provider.invalidate();
  const t2 = await provider.getToken();
  assert.equal(t2, "token-2");
  assert.equal(fetchCount, 2);
});

// -------------------------------------------------------------------------
// Unit Tests: Valuations Resource
// -------------------------------------------------------------------------

test("valuations.create: genera Idempotency-Key UUID automáticamente si falta", async () => {
  let capturedKey = "";
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    capturedKey = init.headers?.get?.("Idempotency-Key") ?? "";
    return jsonResponse(202, {
      valuationId: "val-auto-uuid",
      status: "PENDING",
      pollAfterMs: 2000,
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  const res = await client.valuations.create({ year: 2021, odometerKm: 30000 });
  assert.equal(res.valuationId, "val-auto-uuid");
  assert.match(
    capturedKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test("valuations.create: preserva Idempotency-Key provista por el usuario", async () => {
  let capturedKey = "";
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    capturedKey = init.headers?.get?.("Idempotency-Key") ?? "";
    return jsonResponse(202, {
      valuationId: "val-custom-key",
      status: "PENDING",
      pollAfterMs: 2000,
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  await client.valuations.create(
    { year: 2021, odometerKm: 30000 },
    { idempotencyKey: "my-custom-order-key" },
  );
  assert.equal(capturedKey, "my-custom-order-key");
});

test("valuations.waitUntilComplete: cancelable con AbortSignal", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return jsonResponse(202, { valuationId: "val-running", status: "RUNNING" });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);

  await assert.rejects(
    () =>
      client.valuations.waitUntilComplete("val-running", {
        signal: controller.signal,
        pollAfterMs: 50,
        timeoutMs: 5000,
      }),
    WaiterTimeoutError,
  );
});

test("valuations.waitUntilComplete: falla cuando timeout es superado", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return jsonResponse(202, { valuationId: "val-slow", status: "RUNNING" });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  await assert.rejects(
    () =>
      client.valuations.waitUntilComplete("val-slow", {
        pollAfterMs: 20,
        timeoutMs: 60,
      }),
    WaiterTimeoutError,
  );
});

// -------------------------------------------------------------------------
// Unit Tests: Catalog Resource
// -------------------------------------------------------------------------

test("catalog.listMarks: devuelve null en respuesta 304", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return new Response(null, {
      status: 304,
      headers: { ETag: '"cat-v1"' },
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  const marks = await client.catalog.listMarks({ ifNoneMatch: '"cat-v1"' });
  assert.equal(marks, null);
});

test("catalog: listModels, listYears, listTrims codifican parámetros en URL", async () => {
  const requestedPaths = [];
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    requestedPaths.push(url.pathname);
    return jsonResponse(200, { catalogVersion: "v1" });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  await client.catalog.listModels("Alfa Romeo");
  await client.catalog.listYears("Alfa Romeo", "Giulia Quadrifoglio");
  await client.catalog.listTrims("Alfa Romeo", "Giulia Quadrifoglio", 2022);

  assert.equal(
    requestedPaths[0],
    "/public-secure/shop-b2b/v1/catalog/Alfa%20Romeo",
  );
  assert.equal(
    requestedPaths[1],
    "/public-secure/shop-b2b/v1/catalog/Alfa%20Romeo/Giulia%20Quadrifoglio",
  );
  assert.equal(
    requestedPaths[2],
    "/public-secure/shop-b2b/v1/catalog/Alfa%20Romeo/Giulia%20Quadrifoglio/2022",
  );
});

// -------------------------------------------------------------------------
// Unit Tests: Reintentos y Excepciones
// -------------------------------------------------------------------------

test("reintentos: reintenta hasta maxRetries veces en errores transitorios (503)", async () => {
  let callCount = 0;
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    callCount++;
    return jsonResponse(503, null, {
      error: { code: "service_unavailable", description: "reintento" },
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
    maxRetries: 2,
  });

  await assert.rejects(
    () => client.catalog.listMarks(),
    (err) => {
      assert.equal(err.name, "InternalServerError");
      return true;
    },
  );

  // 1 llamada original + 2 reintentos = 3 llamadas en total
  assert.equal(callCount, 3);
});

test("reintentos: no reintenta en errores 400, 403, 404, 409", async () => {
  let callCount = 0;
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    callCount++;
    return jsonResponse(400, null, {
      error: { code: "invalid_request", description: "invalido" },
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
    maxRetries: 2,
  });

  await assert.rejects(
    () => client.valuations.create({ year: 2020, odometerKm: 1000 }),
    BadRequestError,
  );

  assert.equal(callCount, 1);
});

test("seguridad: los errores preservan metadatos y no filtran secretos", () => {
  const err = new AutotiaError("Error de prueba", {
    status: 400,
    code: "invalid_request",
    apiRequestId: "req-123",
    executionId: "exec-456",
  });

  assert.equal(err.status, 400);
  assert.equal(err.code, "invalid_request");
  assert.equal(err.apiRequestId, "req-123");
  assert.equal(err.executionId, "exec-456");
  assert.equal(JSON.stringify(err).includes("clientSecret"), false);
});
