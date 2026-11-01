const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularOportunidad, esMarcaPrioritaria } = require('../src/oportunidades');

test('esMarcaPrioritaria: reconoce las marcas prioritarias por defecto', () => {
  assert.equal(esMarcaPrioritaria('WOLFPACK'), true);
  assert.equal(esMarcaPrioritaria('samurai'), true); // insensible a mayúsculas
  assert.equal(esMarcaPrioritaria('OTRA MARCA'), false);
  assert.equal(esMarcaPrioritaria(null), false);
});

test('calcularOportunidad: marca prioritaria + margen alto + stock alto -> score alto, motivo trazable', () => {
  const r = calcularOportunidad({ marca: 'WOLFPACK', margenPct: 50, stock: 25, precio: 20 });
  assert.equal(r.esPrioritaria, true);
  assert.equal(r.score, 100); // 40 (marca) + 40 (margen satura en 50) + 20 (stock satura en 20)
  assert.match(r.motivo, /marca prioritaria \(WOLFPACK, \+40 pts\)/);
  assert.match(r.motivo, /margen proyectado 50% \(\+40 pts\)/);
  assert.match(r.motivo, /stock AFT 25 uds\. \(\+20 pts\)/);
});

test('calcularOportunidad: sin datos de margen no inventa ningún punto, va a 0', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: 0, precio: null });
  assert.equal(r.score, 0);
  assert.match(r.motivo, /margen proyectado no disponible \(\+0 pts\)/);
});

test('calcularOportunidad: candidata a venta complementaria solo con margen>=0 y PVP bajo', () => {
  const complementaria = calcularOportunidad({ marca: 'MAURER', margenPct: 10, stock: 5, precio: 12 });
  assert.equal(complementaria.esComplementaria, true);

  const noComplementariaPorPrecio = calcularOportunidad({ marca: 'MAURER', margenPct: 10, stock: 5, precio: 50 });
  assert.equal(noComplementariaPorPrecio.esComplementaria, false);

  const noComplementariaPorMargenNegativo = calcularOportunidad({ marca: 'MAURER', margenPct: -5, stock: 5, precio: 10 });
  assert.equal(noComplementariaPorMargenNegativo.esComplementaria, false);
});

// --- Características adicionales (caracterización previa a mover la
// función a src/domain/, para detectar cualquier cambio de comportamiento
// en el traslado) ---

test('[caracterización] margen negativo nunca resta puntos, se queda en 0 para ese componente', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: -30, stock: 0, precio: null });
  assert.equal(r.score, 0); // ni margen ni stock aportan, nunca negativo
  assert.match(r.motivo, /margen proyectado -30% \(\+0 pts\)/);
});

test('[caracterización] margen y stock por encima del umbral de saturación no superan el peso máximo', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: 500, stock: 100000, precio: null });
  // margen satura en MARGEN_REFERENCIA_SATURACION=50 -> PESO_MARGEN_MAX=40;
  // stock satura en STOCK_REFERENCIA_SATURACION=20 -> PESO_STOCK_MAX=20.
  assert.equal(r.score, 60); // 0 (no prioritaria) + 40 (margen saturado) + 20 (stock saturado)
});

test('[caracterización] marca no prioritaria se refleja literalmente en el motivo', () => {
  const r = calcularOportunidad({ marca: 'MARCA INVENTADA', margenPct: null, stock: 0, precio: null });
  assert.equal(r.esPrioritaria, false);
  assert.match(r.motivo, /marca no prioritaria \(\+0 pts\)/);
});

test('[caracterización] stock negativo (dato anómalo) no resta puntos, se queda en 0 para ese componente', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: -10, precio: null });
  assert.equal(r.score, 0);
  assert.match(r.motivo, /stock AFT -10 uds\. \(\+0 pts\)/);
});
