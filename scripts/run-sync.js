// Ejecuta una comparación AFT <-> Shopify de solo lectura desde la terminal
// (equivalente a POST /api/sync-run) y muestra el resumen. No escribe en Shopify.
const { runInventorySync } = require('../src/sync');
const { pool } = require('../src/db');

async function main() {
  console.log('Ejecutando sincronización de solo lectura AFT -> Shopify...');
  const result = await runInventorySync();
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error('Error en la sincronización:', e.message);
  process.exit(1);
});
