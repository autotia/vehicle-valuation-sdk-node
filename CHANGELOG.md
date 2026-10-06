# Registro de cambios

## Unreleased

## [0.1.0-beta.0] - 2026-10-06

- Implementación inicial del SDK oficial para Node.js 22.12 o superior (ESM).
- Autenticación OAuth2 client credentials con soporte de caché y single-flight.
- Cliente `VehicleValuationClient` con recursos de tasación (`valuations`) y catálogo (`catalog`).
- Polling con `waitUntilComplete`, reintentos automáticos con retroceso exponencial y full jitter, y jerarquía de errores tipados.
