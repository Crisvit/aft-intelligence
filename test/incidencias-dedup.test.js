// registrarIncidencia() no debe acumular una copia de una incidencia
// pendiente idéntica en cada ejecución del pipeline — ver el comentario en
// src/sync.js. Nunca toca una base de datos real (mock de src/db por
// texto de la consulta), para que corra en CI sin Postgres.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function instalarPoolMock() {
  const llamadas = [];
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      pool: {
        query: async (sql, params) => {
          llamadas.push({ sql, params });
          return { rows: [] };
        }
      }
    }
  };
  return llamadas;
}

function cargarSyncFresco() {
  delete require.cache[require.resolve('../src/sync')];
  delete require.cache[require.resolve('../src/aftClient')];
  delete require.cache[require.resolve('../src/shopifyClient')];
  delete require.cache[require.resolve('../src/historialCambios')];
  return require('../src/sync');
}

test('registrarIncidencia: el INSERT real va condicionado a que no exista ya una pendiente idéntica', async () => {
  const llamadas = instalarPoolMock();
  const { registrarIncidencia } = cargarSyncFresco();

  await registrarIncidencia('REF-1', 'EAN-1', 'ean_duplicado', 'detalle de prueba');

  assert.equal(llamadas.length, 1);
  const { sql, params } = llamadas[0];
  // Debe ser un INSERT ... SELECT ... WHERE NOT EXISTS, nunca un INSERT
  // incondicional — es la diferencia real entre "siempre añade una fila
  // nueva" (el comportamiento anterior) y "solo añade si no hay ya una
  // pendiente igual".
  assert.match(sql, /INSERT INTO incidencias/);
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.match(sql, /estado = 'pendiente'/);
  assert.deepEqual(params, ['REF-1', 'EAN-1', 'ean_duplicado', 'detalle de prueba']);
});

test('registrarIncidencia: la condición de deduplicación compara tipo, detalle y ref (con NULL seguro)', async () => {
  const llamadas = instalarPoolMock();
  const { registrarIncidencia } = cargarSyncFresco();

  await registrarIncidencia(null, null, 'permiso_shopify_faltante', 'falta el scope read_locations');

  const { sql, params } = llamadas[0];
  // ref puede ser NULL (p. ej. permisos, categorías duplicadas) — la
  // comparación debe usar IS NOT DISTINCT FROM, nunca "=", que nunca es
  // verdadero entre NULLs y dejaría sin deduplicar justo estos casos.
  assert.match(sql, /ref IS NOT DISTINCT FROM/);
  assert.equal(params[0], null);
});
