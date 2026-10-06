import { VehicleValuationClient } from "../dist/index.js";

if (process.env.AUTOTIA_SMOKE !== "1") {
  process.stdout.write(
    "Smoke desactivado. Define AUTOTIA_SMOKE=1 y credenciales de servidor para habilitarlo.\n",
  );
  process.exit(0);
}

const client = new VehicleValuationClient({
  environment: "dev",
  clientId: process.env.AUTOTIA_CLIENT_ID,
  clientSecret: process.env.AUTOTIA_CLIENT_SECRET,
});

try {
  const catalog = await client.catalog.listMarks();
  process.stdout.write(
    `Conexión correcta; versión de catálogo: ${catalog?.catalogVersion ?? "desconocida"}\n`,
  );
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  process.stderr.write(`${err.name}: ${err.message}\n`);
  process.exitCode = 1;
}
