# @autotia/vehicle-valuation-sdk

SDK oficial de Node.js y TypeScript (ESM) para la API B2B de tasación vehicular de Autotia (Chile).

> **Estado: en desarrollo.** Todavía no está publicado en npm. La API pública descrita aquí puede cambiar antes
> de la versión 1.0.0.

## ¿Qué paquete necesito?

| Tu entorno | Paquete |
|---|---|
| Node.js 22.12 o superior | `@autotia/vehicle-valuation-sdk` (este repositorio) |
| Node.js 11.15 a 22.11 | [`@autotia/vehicle-valuation-sdk-legacy`](https://github.com/autotia/vehicle-valuation-sdk-node-legacy) |

Ambos paquetes ofrecen la misma API y el mismo comportamiento.

## Instalación

```bash
npm install @autotia/vehicle-valuation-sdk
```

El paquete es ESM-only y no tiene dependencias. Desde Node.js 22.12 también puede cargarse con `require()`.

## Uso rápido

```ts
import { VehicleValuationClient } from "@autotia/vehicle-valuation-sdk";

const client = new VehicleValuationClient({
  clientId: process.env.AUTOTIA_CLIENT_ID,
  clientSecret: process.env.AUTOTIA_CLIENT_SECRET,
  environment: "prod", // o "dev"
});

const acceptance = await client.valuations.create({
  mark: "Toyota",
  model: "Yaris",
  year: 2020,
  version: "1.5",
  odometerKm: 50000,
});

const valuation = await client.valuations.waitUntilComplete(acceptance.valuationId);
console.log(valuation.result);
```

La tasación es asíncrona: `create` la solicita y `waitUntilComplete` consulta su estado respetando el intervalo
que indica la API, hasta que termina o vence el plazo.

## Recursos

| Método | Descripción |
|---|---|
| `client.valuations.create(input, options?)` | Solicita una tasación. |
| `client.valuations.get(valuationId, options?)` | Consulta el estado de una tasación. |
| `client.valuations.waitUntilComplete(valuationId, options?)` | Espera el resultado de una tasación. |
| `client.catalog.listMarks(options?)` | Lista las marcas del catálogo. |
| `client.catalog.listModels(...)`, `client.catalog.listYears(...)`, ... | Recorren el catálogo de modelos, años y versiones. |

Todo método acepta `signal` (`AbortSignal`) y `timeoutMs` en sus opciones para cancelar o acotar la llamada.

## Autenticación

El SDK obtiene y renueva el token OAuth2 (`client_credentials`) automáticamente y lo reutiliza mientras está
vigente.

**`clientSecret` es una credencial de servidor.** Nunca la incluyas en código que se ejecute en un navegador o en
una app móvil. Si tu plataforma ya administra tokens, usa la opción `tokenProvider` en lugar de `clientSecret`.

## Idempotencia

`valuations.create` envía siempre un header `Idempotency-Key`. Si no entregas uno, el SDK genera un UUID. Para que
un reintento de tu propio proceso no genere una segunda tasación, entrega una clave estable de tu negocio:

```ts
await client.valuations.create(input, { idempotencyKey: "order-123-valuation-1" });
```

## Errores

Todos los errores heredan de `AutotiaError`, que expone `status`, `code`, `apiRequestId` y `executionId`. Incluye
`apiRequestId` cuando contactes a soporte.

| Error | Cuándo ocurre | ¿El SDK reintenta? |
|---|---|---|
| `BadRequestError` | Solicitud inválida (400). | No |
| `AuthenticationError` | Credenciales inválidas o token rechazado (401). | Una vez, renovando el token |
| `PermissionDeniedError` | Cliente sin permiso o suspendido (403). | No |
| `NotFoundError` | Vehículo, marca o modelo inexistente (404). | No |
| `ConflictError` | La `Idempotency-Key` ya se usó con otra solicitud (409). | No |
| `UnprocessableEntityError` | No hay datos suficientes para tasar (422). | No |
| `QuotaExceededError` | Se agotó la cuota contratada (429). | No |
| `RateLimitError` | Demasiadas solicitudes por segundo (429). | Sí, con espera exponencial |
| `InternalServerError` | Servicio no disponible o tiempo agotado (503, 504). | Sí, con espera exponencial |
| `AutotiaConnectionError` | Falla de red, DNS o conexión. | Sí, con espera exponencial |
| `WaiterTimeoutError` | `waitUntilComplete` superó su plazo. | No |
| `ValuationFailedError` | La tasación terminó con error. | No |

## Compatibilidad

- Node.js 22.12 o superior. Se prueba en Node.js 22 y 24.
- Otros runtimes con `fetch` estándar (Deno, Bun, Workers) no están validados.

## Licencia

[MIT](LICENSE)
