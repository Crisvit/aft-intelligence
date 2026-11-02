// src/rentabilidad.js no tenía ninguna prueba automatizada — hueco real
// detectado en la auditoría (Fase 2), para el módulo que calcula el
// margen real de cada referencia. Todas las funciones probadas aquí son
// PURAS (no tocan Postgres/Shopify/AFT).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePortes, resolverTransporteCliente, resolverTransporte, resolverEscenarioAgrupado,
  clasificarVenta, calcularFilaRentabilidad, PVP_COMPLEMENTO_MAX
} = require('../src/rentabilidad');

// ---------------------------------------------------------------------------
// parsePortes
// ---------------------------------------------------------------------------
test('parsePortes: vacío/null/undefined/cadena vacía -> inválido, motivo "vacio" (caso normal, no una anomalía)', () => {
  for (const v of [null, undefined, '', '   ']) {
    const r = parsePortes(v);
    assert.equal(r.valido, false);
    assert.equal(r.motivo, 'vacio');
    assert.equal(r.valor, null);
  }
});

test('parsePortes: texto no numérico -> inválido, motivo "formato_invalido" (anomalía real de AFT)', () => {
  const r = parsePortes('no-es-un-numero');
  assert.equal(r.valido, false);
  assert.equal(r.motivo, 'formato_invalido');
});

test('parsePortes: valor negativo -> inválido, motivo "valor_negativo" (anomalía real de AFT)', () => {
  const r = parsePortes(-5);
  assert.equal(r.valido, false);
  assert.equal(r.motivo, 'valor_negativo');
});

test('parsePortes: número válido (incluido 0, envío directo gratuito confirmado por AFT) se acepta', () => {
  assert.deepEqual(parsePortes('4.5'), { valido: true, valor: 4.5 });
  assert.deepEqual(parsePortes(0), { valido: true, valor: 0 });
  assert.deepEqual(parsePortes(13), { valido: true, valor: 13 });
});

// ---------------------------------------------------------------------------
// resolverTransporteCliente — respaldo propio, prioridad ref > categoría >
// peso mínimo > default
// ---------------------------------------------------------------------------
const REGLAS = [
  { tipo: 'default', clave: '_DEFAULT_', tarifa: 4.41, umbral_envio_gratis: 30 },
  { tipo: 'categoria', clave: 'ESCALERA', tarifa: 13, umbral_envio_gratis: null },
  { tipo: 'peso_minimo', clave: 'PESO_20KG', umbral_peso_gr: 20000, tarifa: 13, umbral_envio_gratis: null },
  { tipo: 'ref', clave: 'REF-ESPECIAL', tarifa: 7, umbral_envio_gratis: null }
];

test('resolverTransporteCliente: una regla por ref exacta gana sobre cualquier otra', () => {
  const r = resolverTransporteCliente('REF-ESPECIAL', 'Cualquier categoría', 1000, 10, REGLAS);
  assert.equal(r.tarifa, 7);
  assert.equal(r.origen, 'ref:REF-ESPECIAL');
});

test('resolverTransporteCliente: sin regla por ref, una regla por categoría (substring, normalizado) aplica', () => {
  const r = resolverTransporteCliente('REF-X', 'Escalera de tijera', 1000, 10, REGLAS);
  assert.equal(r.tarifa, 13);
  assert.match(r.origen, /^categoria:/);
});

test('resolverTransporteCliente: sin ref ni categoría, una regla por peso mínimo aplica si el peso lo alcanza', () => {
  const r = resolverTransporteCliente('REF-X', 'Herramienta genérica', 25000, 10, REGLAS);
  assert.equal(r.tarifa, 13);
  assert.match(r.origen, /^peso_minimo:/);
});

test('resolverTransporteCliente: por debajo del peso mínimo, cae a la regla default', () => {
  const r = resolverTransporteCliente('REF-X', 'Herramienta genérica', 5000, 10, REGLAS);
  assert.equal(r.tarifa, 4.41);
  assert.equal(r.origen, 'default');
});

test('resolverTransporteCliente: PVP por encima del umbral de envío gratis de la regla aplicada -> tarifa 0', () => {
  const r = resolverTransporteCliente('REF-X', 'Herramienta genérica', 5000, 35, REGLAS);
  assert.equal(r.tarifa, 0);
  assert.equal(r.origen, 'default'); // el origen se conserva aunque la tarifa sea 0
});

test('resolverTransporteCliente: sin ninguna regla aplicable, tarifa 0 con origen explícito (nunca un valor inventado)', () => {
  const r = resolverTransporteCliente('REF-X', 'Herramienta genérica', 1000, 10, []);
  assert.equal(r.tarifa, 0);
  assert.equal(r.origen, 'sin_regla_configurada');
});

// ---------------------------------------------------------------------------
// resolverTransporte — decide entre portes reales de AFT (envío directo) y
// el respaldo propio, nunca ambos a la vez
// ---------------------------------------------------------------------------
test('resolverTransporte: portes de AFT válido -> usa ese valor, marca envío directo AFT, sin anomalía', () => {
  const r = resolverTransporte({ ref: 'REF-1', portes: '13', categoria_nombre: 'Andamios', peso_gr: 30000 }, 50, REGLAS);
  assert.equal(r.tarifa, 13);
  assert.equal(r.esEnvioDirectoAFT, true);
  assert.equal(r.datosIncompletos, false);
  assert.equal(r.origen, 'aft_portes_directo');
});

test('resolverTransporte: portes de AFT vacío (caso normal) -> usa el respaldo propio, sin marcar anomalía', () => {
  const r = resolverTransporte({ ref: 'REF-1', portes: null, categoria_nombre: 'Taladros', peso_gr: 500 }, 50, REGLAS);
  assert.equal(r.esEnvioDirectoAFT, false);
  assert.equal(r.datosIncompletos, false);
  assert.equal(r.tarifa, 0); // PVP 50 >= umbral 30 de la regla default
});

test('resolverTransporte: portes de AFT con formato inválido o negativo -> respaldo propio, PERO marca datos_incompletos (anomalía real)', () => {
  const r1 = resolverTransporte({ ref: 'REF-1', portes: 'no-valido', categoria_nombre: 'Taladros', peso_gr: 500 }, 10, REGLAS);
  assert.equal(r1.esEnvioDirectoAFT, false);
  assert.equal(r1.datosIncompletos, true);
  assert.match(r1.motivoIncompleto, /formato_invalido/);

  const r2 = resolverTransporte({ ref: 'REF-1', portes: -3, categoria_nombre: 'Taladros', peso_gr: 500 }, 10, REGLAS);
  assert.equal(r2.datosIncompletos, true);
  assert.match(r2.motivoIncompleto, /valor_negativo/);
});

// ---------------------------------------------------------------------------
// resolverEscenarioAgrupado — nunca calcula un coste para el pedido
// agrupado, solo informa peso total y un estado explícito
// ---------------------------------------------------------------------------
test('resolverEscenarioAgrupado: con envío directo AFT confirmado -> pendiente_cotizacion (nunca un coste inventado)', () => {
  const r = resolverEscenarioAgrupado({ peso_gr: 30000 }, { esEnvioDirectoAFT: true });
  assert.equal(r.estado, 'pendiente_cotizacion');
  assert.equal(r.pesoGr, 30000);
});

test('resolverEscenarioAgrupado: sin envío directo AFT -> no_aplica', () => {
  const r = resolverEscenarioAgrupado({ peso_gr: 500 }, { esEnvioDirectoAFT: false });
  assert.equal(r.estado, 'no_aplica');
});

test('resolverEscenarioAgrupado: peso no numérico -> pesoGr null, nunca NaN ni un valor inventado', () => {
  const r = resolverEscenarioAgrupado({ peso_gr: 'no-numero' }, { esEnvioDirectoAFT: true });
  assert.equal(r.pesoGr, null);
});

// ---------------------------------------------------------------------------
// clasificarVenta — prioridad: datos_incompletos > margen insuficiente >
// complementaria > individual
// ---------------------------------------------------------------------------
test('clasificarVenta: datos_incompletos tiene prioridad sobre cualquier otra clasificación', () => {
  assert.equal(clasificarVenta('datos_incompletos', 10), 'datos_incompletos');
});

test('clasificarVenta: pérdida, margen_bajo y sin_pvp son siempre "margen_insuficiente"', () => {
  assert.equal(clasificarVenta('perdida', 50), 'margen_insuficiente');
  assert.equal(clasificarVenta('margen_bajo', 50), 'margen_insuficiente');
  assert.equal(clasificarVenta('sin_pvp', 50), 'margen_insuficiente');
});

test(`clasificarVenta: margen suficiente y PVP <= ${PVP_COMPLEMENTO_MAX}€ -> complementaria`, () => {
  assert.equal(clasificarVenta('ok', PVP_COMPLEMENTO_MAX), 'complementaria');
  assert.equal(clasificarVenta('ok', 1), 'complementaria');
});

test('clasificarVenta: margen suficiente y PVP por encima del umbral de complemento -> individual', () => {
  assert.equal(clasificarVenta('ok', PVP_COMPLEMENTO_MAX + 0.01), 'individual');
});

// ---------------------------------------------------------------------------
// calcularFilaRentabilidad — integración completa
// ---------------------------------------------------------------------------
const FILA_BASE = {
  ref: 'REF-1', marca: 'Wolfpack', descripcion: 'Taladro', categoria_nombre: 'Herramienta Electrica',
  portes: null, peso_gr: 500, stock: 10, costo: 20, pvp_sin_iva: 35, por_iva: 21,
  shopify_price: null, shopify_cost: null
};

test('calcularFilaRentabilidad: sin costo o sin pvp_sin_iva en AFT -> datos_incompletos, ningún coste/margen calculado (nunca un 0 inventado)', () => {
  const f1 = calcularFilaRentabilidad({ ...FILA_BASE, costo: null }, REGLAS);
  assert.equal(f1.estado_rentabilidad, 'datos_incompletos');
  assert.equal(f1.coste_total_estimado, null);
  assert.equal(f1.margen_pct, null);
  assert.match(f1.datos_incompletos_motivo, /Falta costo o pvp_sin_iva/);

  const f2 = calcularFilaRentabilidad({ ...FILA_BASE, pvp_sin_iva: null }, REGLAS);
  assert.equal(f2.estado_rentabilidad, 'datos_incompletos');
});

test('calcularFilaRentabilidad: sin coincidencia en Shopify -> pvp_real es el PVP de AFT proyectado (pvp_es_real=false)', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, shopify_price: null }, REGLAS);
  assert.equal(f.pvp_es_real, false);
  assert.equal(f.pvp_real, Math.round(35 * 1.21 * 100) / 100); // precioVentaAFT
});

test('calcularFilaRentabilidad: con coincidencia en Shopify -> pvp_real es el precio REAL de Shopify, no el proyectado de AFT', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, shopify_price: 59.9 }, REGLAS);
  assert.equal(f.pvp_es_real, true);
  assert.equal(f.pvp_real, 59.9);
});

test('calcularFilaRentabilidad: coste total = coste+IVA+recargo (sin IVA 21%->recargo 5.2% conocido) + transporte + comisión (0% por defecto)', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, costo: 20, por_iva: 21, shopify_price: 100 }, REGLAS);
  // costeDesembolsado = 20 + 20*0.21 + 20*0.052 = 20 + 4.2 + 1.04 = 25.24
  assert.equal(f.coste_con_impuestos, 25.24);
  // transporte: sin portes AFT, PVP 100 >= 30 -> regla default da tarifa 0 (envío gratis)
  assert.equal(f.transporte_cliente, 0);
  assert.equal(f.comision_venta_importe, 0);
  assert.equal(f.coste_total_estimado, 25.24);
  assert.equal(f.margen_absoluto, 100 - 25.24);
});

test('calcularFilaRentabilidad: estado "perdida" cuando el margen calculado es negativo', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, costo: 40, shopify_price: 30 }, REGLAS);
  assert.ok(f.margen_pct < 0);
  assert.equal(f.estado_rentabilidad, 'perdida');
  assert.equal(f.clasificacion_venta, 'margen_insuficiente');
});

test('calcularFilaRentabilidad: estado "margen_bajo" por debajo del umbral configurado (15% por defecto) pero no negativo', () => {
  // costeDesembolsado = 24*1.262 = 30.288; transporte 0 (PVP 35 >= umbral 30);
  // margen = (35-30.288)/35*100 = 13.46%
  const f = calcularFilaRentabilidad({ ...FILA_BASE, costo: 24, shopify_price: 35 }, REGLAS);
  assert.ok(f.margen_pct >= 0 && f.margen_pct < 15, `margen_pct=${f.margen_pct} debería estar entre 0 y 15`);
  assert.equal(f.estado_rentabilidad, 'margen_bajo');
});

test('calcularFilaRentabilidad: estado "ok" con margen por encima del umbral', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, costo: 20, shopify_price: 100 }, REGLAS);
  assert.ok(f.margen_pct >= 15);
  assert.equal(f.estado_rentabilidad, 'ok');
});

test('calcularFilaRentabilidad: diferencia de coste con Shopify solo se calcula cuando hay coste real de Shopify y datos completos', () => {
  const f1 = calcularFilaRentabilidad({ ...FILA_BASE, shopify_price: 100, shopify_cost: null }, REGLAS);
  assert.equal(f1.diferencia_coste_shopify, null);

  const f2 = calcularFilaRentabilidad({ ...FILA_BASE, shopify_price: 100, shopify_cost: 20 }, REGLAS);
  assert.equal(f2.diferencia_coste_shopify, round2(f2.coste_total_estimado - 20));
});

test('calcularFilaRentabilidad: anomalía de portes (formato inválido) se refleja en datos_incompletos aunque el margen sí se calcule', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, portes: 'no-valido', shopify_price: 100 }, REGLAS);
  assert.equal(f.datos_incompletos, true);
  assert.notEqual(f.estado_rentabilidad, 'datos_incompletos'); // el margen SÍ se pudo calcular con el respaldo
  assert.ok(f.coste_total_estimado != null);
});

test('calcularFilaRentabilidad: portes de AFT válido marca es_envio_directo_aft y usa ese importe exacto como transporte', () => {
  const f = calcularFilaRentabilidad({ ...FILA_BASE, portes: '13', shopify_price: 100 }, REGLAS);
  assert.equal(f.es_envio_directo_aft, true);
  assert.equal(f.transporte_cliente, 13);
  assert.equal(f.portes_proveedor_aft, 13);
});

function round2(n) { return Math.round(n * 100) / 100; }
