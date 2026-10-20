# @autotia/vehicle-valuation-sdk

SDK oficial de Node.js y TypeScript (ESM) para la API B2B de tasación vehicular de Autotia (Chile).

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

const acceptance = await client.orders.create({
  reportType: "general-price",
  mark: "Toyota",
  model: "Yaris",
  year: 2020,
  version: "1.5",
  odometerKm: 50000,
});

const order = await client.orders.waitUntilComplete(acceptance.orderId);
console.log(order.result);
```

La tasación es asíncrona: `create` la solicita y `waitUntilComplete` consulta su estado respetando el intervalo
que indica la API, hasta que termina o vence el plazo.

## Recursos

| Método | Descripción |
|---|---|
| `client.orders.create(input, options?)` | Solicita un pedido de tasación entregando la versión exacta. |
| `client.orders.createFromTrimText(input, options?)` | Infiere la versión a partir de texto libre y solicita la tasación. |
| `client.orders.get(orderId, options?)` | Consulta el estado de un pedido. |
| `client.orders.waitUntilComplete(orderId, options?)` | Espera el resultado de un pedido. |
| `client.catalog.inferTrim(input, options?)` | Infiere las versiones del catálogo a partir de marca, modelo, año y texto libre. |
| `client.catalog.listMarks(options?)` | Lista las marcas del catálogo. |
| `client.catalog.listModels(mark, options?)` | Lista los modelos de una marca. |
| `client.catalog.listYears(mark, model, options?)` | Lista los años disponibles de un modelo. |
| `client.catalog.listTrims(mark, model, year, options?)` | Lista las versiones disponibles para un año y modelo. |

Todo método acepta `signal` (`AbortSignal`) y `timeoutMs` en sus opciones para cancelar o acotar la llamada.

## Tasación a partir de texto libre

Cuando no se conoce de antemano la versión normalizada del catálogo oficial, se puede solicitar la tasación directamente a partir de una descripción en texto libre mediante `createFromTrimText`:

```ts
import {
  VehicleValuationClient,
  TrimInferenceError,
} from "@autotia/vehicle-valuation-sdk";

const client = new VehicleValuationClient({
  clientId: process.env.AUTOTIA_CLIENT_ID,
  clientSecret: process.env.AUTOTIA_CLIENT_SECRET,
  environment: "prod",
});

try {
  const { order, inference, selectedVersion } =
    await client.orders.createFromTrimText(
      {
        reportType: "general-price",
        mark: "Toyota",
        model: "Yaris",
        year: 2020,
        trimText: "1.5 GL sedan mecanico",
        odometerKm: 50000,
      },
      {
        minConfidence: 60, // Opcional: umbral mínimo de preferencia (0-100)
      },
    );

  console.log(`Versión seleccionada: ${selectedVersion}`);
  console.log(`Preferencia calculada: ${inference.versions[0]?.confidence}%`);

  const completed = await client.orders.waitUntilComplete(order.orderId);
  console.log(completed.result);
} catch (error) {
  if (error instanceof TrimInferenceError) {
    // El texto no aportó evidencia, contradice el catálogo o no alcanzó minConfidence
    console.warn(
      `Inferencia no concluyente (${error.outcome}). Opciones disponibles:`,
      error.versions,
    );
  } else {
    throw error;
  }
}
```

### Semántica de `confidence`

El campo `confidence` devuelto en cada versión inferida representa la **preferencia relativa entre los candidatos evaluados** y suma 100 sobre el conjunto completo de versiones analizadas; no es una probabilidad estadística de acierto. Si un solo candidato resulta compatible con el texto, su `confidence` es 100.

## Autenticación

El SDK obtiene y renueva el token OAuth2 (`client_credentials`) automáticamente y lo reutiliza mientras está
vigente.

**`clientSecret` es una credencial de servidor.** Nunca la incluyas en código que se ejecute en un navegador o en
una app móvil. Si tu plataforma ya administra tokens, usa la opción `tokenProvider` en lugar de `clientSecret`.

## Idempotencia

`orders.create` envía siempre un header `Idempotency-Key`. Si no entregas uno, el SDK genera un UUID. Para que
un reintento de tu propio proceso no genere un segundo pedido, entrega una clave estable de tu negocio:

```ts
await client.orders.create(input, { idempotencyKey: "order-123-valuation-1" });
```

## Errores

Todos los errores heredan de `AutotiaError`, que expone `status`, `code`, `apiRequestId` y `executionId`. Incluye
`apiRequestId` cuando contactes a soporte.

| Error | Cuándo ocurre | ¿El SDK reintenta? |
|---|---|---|
| `BadRequestError` | Solicitud inválida (400). | No |
| `AuthenticationError` | Credenciales inválidas o token rechazado (401). | Una vez, renovando el token |
| `PermissionDeniedError` | Cliente sin permiso o suspendido (403). | No |
| `NotFoundError` | Vehículo, marca, modelo o año inexistente (404). | No |
| `ConflictError` | La `Idempotency-Key` ya se usó con otra solicitud (409). | No |
| `UnprocessableEntityError` | No hay datos suficientes para tasar (422). | No |
| `QuotaExceededError` | Se agotó la cuota contratada (429). | No |
| `RateLimitError` | Demasiadas solicitudes por segundo (429). | Sí, con espera exponencial |
| `InternalServerError` | Servicio no disponible o tiempo agotado (503, 504). | Sí, con espera exponencial |
| `AutotiaConnectionError` | Falla de red, DNS o conexión. | Sí, con espera exponencial |
| `WaiterTimeoutError` | `waitUntilComplete` superó su plazo. | No |
| `OrderFailedError` | El pedido terminó con error. | No |
| `TrimInferenceError` | La inferencia de versión no aportó evidencia, contradice el catálogo o no alcanzó `minConfidence`. | No |

## Compatibilidad

- Node.js 22.12 o superior. Se prueba en Node.js 22 y 24.
- Otros runtimes con `fetch` estándar (Deno, Bun, Workers) no están validados.

## Licencia

[MIT](LICENSE)

## Publicación (mantenedores)

La publicación se realiza automáticamente mediante GitHub Actions (`publish.yml`) al crear un tag `v<version>` sobre la rama `main`. La primera publicación ya se realizó; el workflow publica solo con trusted publishing y no usa tokens npm.

Para configurar o reconfigurar la publicación:
- En GitHub, se requiere el environment `npm` con permiso para los tags `v*`.
- En npmjs.com, se requiere configurar Trusted Publisher para la organización `autotia`, repositorio correspondiente, workflow `publish.yml`, environment `npm` y la opción "Allow npm publish" habilitada.
- El workflow de GitHub Actions requiere Node.js 24 y npm 11.5.1 o superior (instala npm 11.15.0).

El flujo estándar de publicación es el siguiente:

1. Llevar los cambios aprobados desde `dev` hacia `main` (mediante Pull Request y merge).
2. Crear y enviar el tag de versión (por ejemplo `v1.0.1`) sobre `main`.
3. El workflow en GitHub Actions publica en npm utilizando autenticación de confianza (Trusted Publishing con OIDC) y procedencia verificable (provenance).
4. Las versiones estables (sin sufijo de pre-versión) se publican con el dist-tag `latest`. Las versiones con sufijo (como `-beta.N`) se publican con el dist-tag `next`.
