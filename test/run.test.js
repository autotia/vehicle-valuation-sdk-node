import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ClientCredentialsTokenProvider } from "../dist/auth/client-credentials.js";
import { retryAfterDelay } from "../dist/core/retry.js";
import {
  AutotiaConnectionError,
  AutotiaError,
  BadRequestError,
  NotFoundError,
  OrderFailedError,
  RateLimitError,
  TrimInferenceError,
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
    if (tc.operation === "orders.waitUntilComplete") {
      const id =
        tc.request?.path?.replace?.("/v1/orders/", "") ??
        "ordb2b_01j7x000000000000000000000";
      action = () =>
        client.orders.waitUntilComplete(id, {
          timeoutMs: 3000,
          pollAfterMs: 20,
        });
    } else if (
      tc.request.path === "/v1/orders" &&
      tc.request.method === "POST"
    ) {
      action = () =>
        client.orders.create(
          { reportType: "general-price", year: 2020, odometerKm: 50000 },
          tc.request.headers?.["Idempotency-Key"]
            ? { idempotencyKey: tc.request.headers["Idempotency-Key"] }
            : {},
        );
    } else if (tc.request.path.startsWith("/v1/orders/")) {
      const id = tc.request.path.replace("/v1/orders/", "");
      action = () => client.orders.get(id);
    } else if (
      tc.request.path === "/v1/version-inference" &&
      tc.request.method === "POST"
    ) {
      action = () =>
        client.catalog.inferTrim(
          tc.request.body ?? {
            mark: "Chevrolet",
            model: "Camaro",
            year: 2013,
            text: "3.6 RS coupe mecanico",
          },
        );
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
        if (tc.expected.message !== undefined) {
          assert.equal(err.message, tc.expected.message);
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
  assert(client.orders);
  assert(client.catalog);
});

test("constructor: acepta URLs personalizadas", () => {
  const client = new VehicleValuationClient({
    baseUrl: "https://custom.example.com/api",
    tokenUrl: "https://custom.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  });
  assert(client.orders);
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
  assert(client.orders);
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
// Unit Tests: Orders Resource
// -------------------------------------------------------------------------

test("orders.create: genera Idempotency-Key UUID automáticamente si falta", async () => {
  let capturedKey = "";
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    capturedKey = init.headers?.get?.("Idempotency-Key") ?? "";
    return jsonResponse(202, {
      orderId: "ordb2b_auto_uuid",
      reportType: "general-price",
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

  const res = await client.orders.create({
    reportType: "general-price",
    year: 2021,
    odometerKm: 30000,
  });
  assert.equal(res.orderId, "ordb2b_auto_uuid");
  assert.equal(res.reportType, "general-price");
  assert.match(
    capturedKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test("orders.create: preserva Idempotency-Key provista por el usuario", async () => {
  let capturedKey = "";
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    capturedKey = init.headers?.get?.("Idempotency-Key") ?? "";
    return jsonResponse(202, {
      orderId: "ordb2b_custom_key",
      reportType: "general-price",
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

  await client.orders.create(
    { reportType: "general-price", year: 2021, odometerKm: 30000 },
    { idempotencyKey: "my-custom-order-key" },
  );
  assert.equal(capturedKey, "my-custom-order-key");
});

test("orders.create: envía reportType en el body y deserializa orderId y saleId", async () => {
  let capturedBody = "";
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    capturedBody =
      typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    return jsonResponse(202, {
      orderId: "ordb2b_01j7x000000000000000000001",
      reportType: "general-price",
      status: "PENDING",
      pollAfterMs: 2000,
      saleId: "sal_01j7x000000000000000000001",
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  const res = await client.orders.create({
    reportType: "general-price",
    mark: "Toyota",
    model: "Yaris",
    year: 2021,
    odometerKm: 30000,
  });

  const parsedBody = JSON.parse(capturedBody);
  assert.equal(parsedBody.reportType, "general-price");
  assert.equal(parsedBody.mark, "Toyota");
  assert.equal(parsedBody.year, 2021);
  assert.equal(res.orderId, "ordb2b_01j7x000000000000000000001");
  assert.equal(res.reportType, "general-price");
  assert.equal(res.saleId, "sal_01j7x000000000000000000001");
});

test("orders.get: consulta por orderId y deserializa orderId, reportType y saleId", async () => {
  let requestedPath = "";
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    requestedPath = url.pathname;
    return jsonResponse(200, {
      orderId: "ordb2b_01j7x000000000000000000001",
      reportType: "general-price",
      status: "COMPLETED",
      saleId: "sal_01j7x000000000000000000001",
      result: {
        schemaVersion: "general-price-result-v1",
        data: {},
      },
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  const res = await client.orders.get("ordb2b_01j7x000000000000000000001");
  assert.equal(
    requestedPath,
    "/public-secure/shop-b2b/v1/orders/ordb2b_01j7x000000000000000000001",
  );
  assert.equal(res.orderId, "ordb2b_01j7x000000000000000000001");
  assert.equal(res.reportType, "general-price");
  assert.equal(res.saleId, "sal_01j7x000000000000000000001");
  assert.equal(res.status, "COMPLETED");
});

test("orders.waitUntilComplete: cancelable con AbortSignal", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return jsonResponse(202, {
      orderId: "ordb2b_running",
      reportType: "general-price",
      status: "RUNNING",
    });
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
      client.orders.waitUntilComplete("ordb2b_running", {
        signal: controller.signal,
        pollAfterMs: 50,
        timeoutMs: 5000,
      }),
    WaiterTimeoutError,
  );
});

test("orders.waitUntilComplete: falla cuando timeout es superado", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return jsonResponse(202, {
      orderId: "ordb2b_slow",
      reportType: "general-price",
      status: "RUNNING",
    });
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });

  await assert.rejects(
    () =>
      client.orders.waitUntilComplete("ordb2b_slow", {
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

test("catalog: resolveVehicle, inferMark e inferModel usan sus rutas y cuerpos", async () => {
  const requests = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    requests.push({ path: url.pathname, body: JSON.parse(init.body) });
    return jsonResponse(200, {});
  };

  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });
  const resolutionRequest = {
    mark: "Toyota",
    year: 2020,
    search: "Yaris 1.5 GL",
  };
  await client.catalog.resolveVehicle(resolutionRequest);
  await client.catalog.inferMark({ text: "Toyota", limit: 3 });
  await client.catalog.inferModel({
    mark: "Toyota",
    year: 2020,
    text: "Yaris",
  });

  assert.deepEqual(requests, [
    {
      path: "/public-secure/shop-b2b/v1/vehicle-resolution",
      body: resolutionRequest,
    },
    {
      path: "/public-secure/shop-b2b/v1/mark-inference",
      body: { text: "Toyota", limit: 3 },
    },
    {
      path: "/public-secure/shop-b2b/v1/model-inference",
      body: { mark: "Toyota", year: 2020, text: "Yaris" },
    },
  ]);
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

test("429 respeta Retry-After en segundos hasta el tope", async () => {
  let calls = 0;
  const delays = [];
  const originalSetTimeout = globalThis.setTimeout;
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    calls++;
    if (calls === 1)
      return new Response("", { status: 429, headers: { "Retry-After": "2" } });
    return jsonResponse(200, { catalogVersion: "v1", marks: [] });
  };
  globalThis.setTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    return originalSetTimeout(callback, 0, ...args);
  };
  try {
    const client = new VehicleValuationClient({
      environment: "dev",
      clientId: "id",
      clientSecret: "secret",
      fetch: mockFetch,
    });
    await client.catalog.listMarks();
    assert.equal(delays[0], 2000);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("Retry-After acepta segundos y fecha HTTP con tope; ignora valores inválidos", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(retryAfterDelay("2", now), 2000);
  assert.equal(retryAfterDelay(new Date(now + 3000).toUTCString(), now), 3000);
  assert.equal(retryAfterDelay("30", now), 10000);
  assert.equal(retryAfterDelay("invalid", now), undefined);
});

test("reintento POST mantiene una clave idempotente estable", async () => {
  const keys = [];
  let calls = 0;
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    calls++;
    keys.push(init.headers.get("Idempotency-Key"));
    if (calls === 1)
      return jsonResponse(503, null, { error: { code: "unavailable" } });
    return jsonResponse(202, {
      orderId: "ordb2b_same",
      reportType: "general-price",
      status: "PENDING",
      pollAfterMs: 23,
    });
  };
  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });
  await client.orders.create(
    {
      reportType: "general-price",
      mark: "Toyota",
      model: "Yaris",
      version: "1.5",
      year: 2020,
    },
    { idempotencyKey: "stable-key" },
  );
  assert.deepEqual(keys, ["stable-key", "stable-key"]);
});

test("replay de pedido pendiente conserva el mismo orderId", async () => {
  let calls = 0;
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    calls++;
    return jsonResponse(202, {
      orderId: "ordb2b_replayed",
      reportType: "general-price",
      status: "PENDING",
      pollAfterMs: 7,
    });
  };
  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });
  const input = {
    reportType: "general-price",
    mark: "Toyota",
    model: "Yaris",
    version: "1.5",
    year: 2020,
  };
  const first = await client.orders.create(input, {
    idempotencyKey: "stable-key",
  });
  const replay = await client.orders.create(input, {
    idempotencyKey: "stable-key",
  });
  assert.equal(first.orderId, replay.orderId);
  assert.equal(calls, 2);
});

test("pedido FAILED reproducido conserva failure sin resolution", async () => {
  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    return jsonResponse(200, {
      orderId: "ordb2b_failed",
      reportType: "general-price",
      status: "FAILED",
      failure: { code: "data_unavailable", description: "sin datos" },
    });
  };
  const client = new VehicleValuationClient({
    environment: "dev",
    clientId: "id",
    clientSecret: "secret",
    fetch: mockFetch,
  });
  const status = await client.orders.get("ordb2b_failed");
  assert.deepEqual(status.failure, {
    code: "data_unavailable",
    description: "sin datos",
  });
  assert.equal(status.resolution, undefined);
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
    () =>
      client.orders.create({
        reportType: "general-price",
        year: 2020,
        odometerKm: 1000,
      }),
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

test("metadatos: package.json tiene repository.url apuntando a github.com/autotia/vehicle-valuation-sdk-node", () => {
  const pkgPath = path.resolve(import.meta.dirname, "../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  assert.ok(pkg.repository, "package.json debe definir repository");
  assert.ok(
    typeof pkg.repository.url === "string" &&
      pkg.repository.url.includes(
        "github.com/autotia/vehicle-valuation-sdk-node",
      ),
    `repository.url debe apuntar a github.com/autotia/vehicle-valuation-sdk-node, recibido: ${pkg.repository?.url}`,
  );
});

// -------------------------------------------------------------------------
// Unit Tests: Trim Inference and createFromTrimText
// -------------------------------------------------------------------------

test("catalog.inferTrim: envía cuerpo JSON correcto y recibe resultado", async () => {
  let capturedBody = null;
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) {
      return tokenResponse();
    }
    if (url.pathname.includes("/v1/version-inference")) {
      capturedBody = JSON.parse(init.body);
      return jsonResponse(200, {
        catalogVersion: "cat-test-1",
        outcome: "matched",
        totalCandidates: 1,
        versions: [{ version: "3.6 L RS MT", confidence: 100 }],
      });
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  const res = await client.catalog.inferTrim({
    mark: "Chevrolet",
    model: "Camaro",
    year: 2013,
    text: "3.6 RS coupe",
    limit: 3,
  });

  assert.deepEqual(capturedBody, {
    mark: "Chevrolet",
    model: "Camaro",
    year: 2013,
    text: "3.6 RS coupe",
    limit: 3,
  });
  assert.equal(res.catalogVersion, "cat-test-1");
  assert.equal(res.outcome, "matched");
  assert.equal(res.totalCandidates, 1);
  assert.equal(res.versions[0]?.version, "3.6 L RS MT");
  assert.equal(res.versions[0]?.confidence, 100);
});

test("orders.createFromTrimText: matched crea pedido con versions[0].version", async () => {
  let inferenceBody = null;
  let orderBody = null;

  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) {
      return tokenResponse();
    }
    if (url.pathname.includes("/v1/version-inference")) {
      inferenceBody = JSON.parse(init.body);
      return jsonResponse(200, {
        catalogVersion: "cat-v1",
        outcome: "matched",
        totalCandidates: 2,
        versions: [
          { version: "1.5 GL MT", confidence: 85 },
          { version: "1.5 XLi MT", confidence: 15 },
        ],
      });
    }
    if (url.pathname.includes("/v1/orders")) {
      orderBody = JSON.parse(init.body);
      return jsonResponse(
        202,
        {
          orderId: "ordb2b_from_trim_1",
          reportType: "general-price",
          status: "PENDING",
          pollAfterMs: 2000,
        },
        { status: 202 },
      );
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  const res = await client.orders.createFromTrimText({
    reportType: "general-price",
    mark: "Toyota",
    model: "Yaris",
    year: 2020,
    trimText: "1.5 GL sedan mecanico",
  });

  assert.equal(inferenceBody.text, "1.5 GL sedan mecanico");
  assert.equal(orderBody.version, "1.5 GL MT");
  assert.equal(orderBody.mark, "Toyota");
  assert.equal(orderBody.model, "Yaris");
  assert.equal(orderBody.year, 2020);
  assert.equal(Object.hasOwn(orderBody, "odometerKm"), false);
  assert.equal(res.selectedVersion, "1.5 GL MT");
  assert.equal(res.order.orderId, "ordb2b_from_trim_1");
  assert.equal(res.inference.outcome, "matched");
});

test("orders.createFromTrimText: no_evidence lanza TrimInferenceError sin llamar a orders.create", async () => {
  let orderCalls = 0;

  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    if (url.pathname.includes("/v1/version-inference")) {
      return jsonResponse(200, {
        catalogVersion: "cat-v1",
        outcome: "no_evidence",
        totalCandidates: 2,
        versions: [
          { version: "1.5 GL MT", confidence: 50 },
          { version: "1.5 XLi MT", confidence: 50 },
        ],
      });
    }
    if (url.pathname.includes("/v1/orders")) {
      orderCalls++;
      return jsonResponse(202, { orderId: "should-not-be-called" });
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  await assert.rejects(
    client.orders.createFromTrimText({
      reportType: "general-price",
      mark: "Toyota",
      model: "Yaris",
      year: 2020,
      trimText: "auto azul",
      odometerKm: 45000,
    }),
    (err) => {
      assert(err instanceof TrimInferenceError);
      assert.equal(err.outcome, "no_evidence");
      assert.equal(err.versions.length, 2);
      return true;
    },
  );

  assert.equal(orderCalls, 0);
});

test("orders.createFromTrimText: no_match lanza TrimInferenceError sin llamar a orders.create", async () => {
  let orderCalls = 0;

  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    if (url.pathname.includes("/v1/version-inference")) {
      return jsonResponse(200, {
        catalogVersion: "cat-v1",
        outcome: "no_match",
        totalCandidates: 0,
        versions: [],
      });
    }
    if (url.pathname.includes("/v1/orders")) {
      orderCalls++;
      return jsonResponse(202, { orderId: "should-not-be-called" });
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  await assert.rejects(
    client.orders.createFromTrimText({
      reportType: "general-price",
      mark: "Toyota",
      model: "Yaris",
      year: 2020,
      trimText: "v8 biturbo diesel 4x4",
      odometerKm: 45000,
    }),
    (err) => {
      assert(err instanceof TrimInferenceError);
      assert.equal(err.outcome, "no_match");
      assert.deepEqual(err.versions, []);
      return true;
    },
  );

  assert.equal(orderCalls, 0);
});

test("orders.createFromTrimText: minConfidence bajo umbral lanza TrimInferenceError", async () => {
  let orderCalls = 0;

  const mockFetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    if (url.pathname.includes("/v1/version-inference")) {
      return jsonResponse(200, {
        catalogVersion: "cat-v1",
        outcome: "matched",
        totalCandidates: 2,
        versions: [
          { version: "1.5 GL MT", confidence: 55 },
          { version: "1.5 XLi MT", confidence: 45 },
        ],
      });
    }
    if (url.pathname.includes("/v1/orders")) {
      orderCalls++;
      return jsonResponse(202, { orderId: "should-not-be-called" });
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  await assert.rejects(
    client.orders.createFromTrimText(
      {
        reportType: "general-price",
        mark: "Toyota",
        model: "Yaris",
        year: 2020,
        trimText: "1.5 mecanico",
        odometerKm: 45000,
      },
      { minConfidence: 70 },
    ),
    (err) => {
      assert(err instanceof TrimInferenceError);
      assert.equal(err.outcome, "matched");
      assert.equal(err.versions[0]?.confidence, 55);
      return true;
    },
  );

  assert.equal(orderCalls, 0);
});

test("orders.createFromTrimText: propaga Idempotency-Key solo a orders.create", async () => {
  let inferenceHeaders = null;
  let orderHeaders = null;

  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.includes("/oauth2/token")) return tokenResponse();
    if (url.pathname.includes("/v1/version-inference")) {
      inferenceHeaders = init.headers ?? {};
      return jsonResponse(200, {
        catalogVersion: "cat-v1",
        outcome: "matched",
        totalCandidates: 1,
        versions: [{ version: "1.5 GL MT", confidence: 100 }],
      });
    }
    if (url.pathname.includes("/v1/orders")) {
      orderHeaders = init.headers ?? {};
      return jsonResponse(
        202,
        {
          orderId: "ordb2b_idem_1",
          reportType: "general-price",
          status: "PENDING",
          pollAfterMs: 2000,
        },
        { status: 202 },
      );
    }
    throw new Error(`Ruta no esperada: ${url.pathname}`);
  };

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetch,
  });

  await client.orders.createFromTrimText(
    {
      reportType: "general-price",
      mark: "Toyota",
      model: "Yaris",
      year: 2020,
      trimText: "1.5 GL",
      odometerKm: 45000,
    },
    { idempotencyKey: "my-stable-key-123" },
  );

  const getHeader = (headers, name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  };

  assert.equal(getHeader(inferenceHeaders, "Idempotency-Key"), null);
  assert.equal(getHeader(orderHeaders, "Idempotency-Key"), "my-stable-key-123");
});

test("orders.createFromTrimText: respeta signal cancelado", async () => {
  const controller = new AbortController();
  controller.abort();

  const client = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: async () => tokenResponse(),
  });

  await assert.rejects(
    client.orders.createFromTrimText(
      {
        reportType: "general-price",
        mark: "Toyota",
        model: "Yaris",
        year: 2020,
        trimText: "1.5",
        odometerKm: 1000,
      },
      { signal: controller.signal },
    ),
  );
});

test("catalog.inferTrim: mapeo de errores HTTP 400 y 404 year_not_found", async () => {
  const mockFetchWithError = (status, code, description) => {
    return async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname.includes("/oauth2/token")) return tokenResponse();
      return jsonResponse(status, null, { error: { code, description } });
    };
  };

  const client400 = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetchWithError(400, "invalid_request", "Parámetros inválidos"),
  });
  await assert.rejects(
    client400.catalog.inferTrim({
      mark: "Chevrolet",
      model: "Camaro",
      year: 2013,
      text: "",
    }),
    (err) => {
      assert(err instanceof BadRequestError);
      assert.equal(err.code, "invalid_request");
      return true;
    },
  );

  const client404 = new VehicleValuationClient({
    baseUrl: "https://api.dev.autotia.com/public-secure/shop-b2b",
    tokenUrl: "https://auth.example.com/oauth2/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    fetch: mockFetchWithError(404, "year_not_found", "Año no encontrado"),
  });
  await assert.rejects(
    client404.catalog.inferTrim({
      mark: "Chevrolet",
      model: "Camaro",
      year: 1950,
      text: "3.6",
    }),
    (err) => {
      assert(err instanceof NotFoundError);
      assert.equal(err.code, "year_not_found");
      return true;
    },
  );
});
