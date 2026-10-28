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
