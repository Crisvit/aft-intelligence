const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularScoreV3, clasificarAfinidad } = require('../src/scoreV3');

const COMPLETO = { margenPct: 50, precio: 100, coste: 60, stock: 30, categoria: 'AMOLADORAS', volumenDemanda: 10000, precioMercado: 100 };

test('con todos los datos reales: 100 puntos, cobertura 100%, sin componentes «Sin datos»', () => {
  const r = calcularScoreV3(COMPLETO);
  assert.equal(r.puntos, 100);
  assert.equal(r.cobertura, 1);
  assert.equal(r.puntosEvaluables, 100);
  assert.equal(r.etiqueta, 'Excelente');
  assert.equal(r.confianza, 'Alta');
  for (const c of Object.values(r.componentes)) assert.equal(c.estado, 'ok');
});

test('sin volumen de búsqueda verificado: demanda es «Sin datos», puntos null, NO se inventa un valor neutro', () => {
  const r = calcularScoreV3({ ...COMPLETO, volumenDemanda: null });
  assert.equal(r.componentes.demanda.puntos, null);
  assert.equal(r.componentes.demanda.estado, 'Sin datos');
  assert.match(r.componentes.demanda.explicacion, /Sin datos/);
  assert.notEqual(r.componentes.demanda.puntos, 12.5); // el valor neutro del sistema antiguo
  assert.equal(r.puntos, 75); // 100 - 25 de demanda, no 87.5
  assert.match(r.resumen, /Sin datos: demanda/);
});

test('sin precio de mercado: competitividad es «Sin datos», nunca 10 neutro', () => {
  const r = calcularScoreV3({ ...COMPLETO, precioMercado: null });
  assert.equal(r.componentes.competitividad.puntos, null);
  assert.equal(r.componentes.competitividad.estado, 'Sin datos');
  assert.equal(r.puntos, 80);
});

test('hoy (sin demanda ni mercado): puntos 55 máx., cobertura 55%, etiqueta nunca por encima de «Analizar»', () => {
  const r = calcularScoreV3({ ...COMPLETO, volumenDemanda: null, precioMercado: null });
  assert.equal(r.puntos, 55);
  assert.equal(r.puntosEvaluables, 55);
  assert.equal(r.cobertura, 0.55);
  assert.equal(r.puntosNormalizados, 100);
  assert.equal(r.etiqueta, 'Analizar'); // sin evidencia de demanda no puede ser Excelente/Interesante
  assert.equal(r.confianza, 'Media');
});

test('demanda real de volumen 0 es un dato real (0 puntos), distinto de «Sin datos»', () => {
  const r = calcularScoreV3({ ...COMPLETO, volumenDemanda: 0 });
  assert.equal(r.componentes.demanda.puntos, 0);
  assert.equal(r.componentes.demanda.estado, 'ok');
});

test('demanda: escala logarítmica creciente y saturada', () => {
  const p = (v) => calcularScoreV3({ ...COMPLETO, volumenDemanda: v }).componentes.demanda.puntos;
  assert.ok(p(10) < p(100));
  assert.ok(p(100) < p(1000));
  assert.equal(p(10000), 25);
  assert.equal(p(1000000), 25);
});

test('rentabilidad: sin margen es «Sin datos»; sin precio/coste solo cuenta el margen', () => {
  assert.equal(calcularScoreV3({ ...COMPLETO, margenPct: null }).componentes.rentabilidad.puntos, null);
  const soloMargen = calcularScoreV3({ ...COMPLETO, precio: null, coste: null, margenPct: 25 }).componentes.rentabilidad;
  assert.equal(soloMargen.puntos, 15); // 25/50 de 30
  assert.match(soloMargen.explicacion, /beneficio absoluto no disponible/);
});

test('competitividad con precio de mercado real: tramos por posición', () => {
  const c = (precio) => calcularScoreV3({ ...COMPLETO, precio, precioMercado: 100 }).componentes.competitividad.puntos;
  assert.equal(c(100), 20); // en línea
  assert.equal(c(70), 17);  // por debajo
  assert.equal(c(130), 9);  // algo por encima
  assert.equal(c(200), 2);  // muy por encima
});

test('stock: tramos 0 / ≤2 / ≤5 / ≤10 / ≤25 / >25 y stock inexistente es «Sin datos»', () => {
  const s = (n) => calcularScoreV3({ ...COMPLETO, stock: n }).componentes.stock.puntos;
  assert.deepEqual([s(0), s(2), s(5), s(10), s(25), s(26)], [0, 3, 6, 9, 12, 15]);
  assert.equal(calcularScoreV3({ ...COMPLETO, stock: null }).componentes.stock.puntos, null);
});

test('afinidad: core 10, media 6, baja 3, sin categoría «Sin datos» (no 4 neutro)', () => {
  const a = (cat) => calcularScoreV3({ ...COMPLETO, categoria: cat }).componentes.afinidad;
  assert.equal(clasificarAfinidad('Amoladoras'), 'core');
  assert.equal(a('AMOLADORAS').puntos, 10);
  assert.equal(a('Mangueras').puntos, 6);
  assert.equal(a('Botas de seguridad').puntos, 3);
  assert.equal(a('Cortinas').puntos, 3); // categoría conocida pero ajena
  assert.equal(a('').puntos, null);
  assert.equal(a('').estado, 'Sin datos');
});

test('cada componente trae fuente y explicación con los números usados', () => {
  const r = calcularScoreV3(COMPLETO);
  for (const [nombre, c] of Object.entries(r.componentes)) {
    assert.ok(c.fuente && c.fuente.length > 5, `${nombre} sin fuente`);
    assert.ok(c.explicacion && c.explicacion.length > 10, `${nombre} sin explicación`);
    assert.ok(c.max > 0);
  }
  assert.match(r.componentes.demanda.fuente, /DataForSEO/);
  assert.match(r.componentes.stock.explicacion, /Stock AFT 30 uds/);
});

test('sin ningún dato: etiqueta «Sin datos», 0 puntos, no lanza', () => {
  const r = calcularScoreV3({});
  assert.equal(r.puntos, 0);
  assert.equal(r.puntosEvaluables, 0);
  assert.equal(r.puntosNormalizados, null);
  assert.equal(r.etiqueta, 'Sin datos');
  assert.equal(r.confianza, 'Baja');
});
