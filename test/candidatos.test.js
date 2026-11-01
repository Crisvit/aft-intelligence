const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seleccionarCandidatos, motivoDescarteIndividual, configCandidatos } = require('../src/candidatos');

const CFG = {
  stockMinimo: 10, margenMinimoPct: 20, maxPorCategoria: 4, maxCandidatos: 60,
  excluirTextos: ['CADENA PARA', 'RECAMBIO', 'FUNDA PARA'], soloMarcasPrioritarias: false
};

function fila(o) {
  return {
    ref: 'R', marca: 'WOLFPACK', descripcion: 'Amoladora 900W', categoria_nombre: 'AMOLADORAS',
    stock_aft: 20, margen_pct: 30, es_marca_prioritaria: true, ...o
  };
}

test('configCandidatos: valores por defecto = stock 10, margen 20, 4 por categoría, 60 total', () => {
  const guardado = {};
  const claves = ['OPORTUNIDADES_STOCK_MINIMO', 'OPORTUNIDADES_MARGEN_MINIMO_PCT', 'OPORTUNIDADES_MAX_POR_CATEGORIA', 'OPORTUNIDADES_MAX_CANDIDATOS', 'OPORTUNIDADES_EXCLUIR_TEXTOS', 'OPORTUNIDADES_SOLO_MARCAS_PRIORITARIAS'];
  for (const k of claves) { guardado[k] = process.env[k]; delete process.env[k]; }
  try {
    const c = configCandidatos();
    assert.equal(c.stockMinimo, 10);
    assert.equal(c.margenMinimoPct, 20);
    assert.equal(c.maxPorCategoria, 4);
    assert.equal(c.maxCandidatos, 60);
    assert.ok(c.excluirTextos.includes('RECAMBIO'));
    assert.equal(c.soloMarcasPrioritarias, false);
  } finally {
    for (const k of claves) { if (guardado[k] === undefined) delete process.env[k]; else process.env[k] = guardado[k]; }
  }
});

test('configCandidatos: se puede configurar por entorno y un valor inválido cae al defecto', () => {
  process.env.OPORTUNIDADES_STOCK_MINIMO = '5';
  process.env.OPORTUNIDADES_MAX_POR_CATEGORIA = '2';
  process.env.OPORTUNIDADES_MAX_CANDIDATOS = 'abc';
  process.env.OPORTUNIDADES_EXCLUIR_TEXTOS = '';
  try {
    const c = configCandidatos();
    assert.equal(c.stockMinimo, 5);
    assert.equal(c.maxPorCategoria, 2);
    assert.equal(c.maxCandidatos, 60); // inválido -> defecto
    assert.deepEqual(c.excluirTextos, []); // vacío explícito desactiva la exclusión
  } finally {
    delete process.env.OPORTUNIDADES_STOCK_MINIMO;
    delete process.env.OPORTUNIDADES_MAX_POR_CATEGORIA;
    delete process.env.OPORTUNIDADES_MAX_CANDIDATOS;
    delete process.env.OPORTUNIDADES_EXCLUIR_TEXTOS;
  }
});

test('stock mínimo: 9 uds. se descarta con motivo, 10 uds. pasa', () => {
  assert.match(motivoDescarteIndividual(fila({ stock_aft: 9 }), CFG), /stock AFT 9 uds\. < mínimo 10/);
  assert.equal(motivoDescarteIndividual(fila({ stock_aft: 10 }), CFG), null);
});

test('margen mínimo: 19,9% se descarta, 20% pasa, sin margen se descarta', () => {
  assert.match(motivoDescarteIndividual(fila({ margen_pct: 19.9 }), CFG), /margen 19\.9% < mínimo 20%/);
  assert.equal(motivoDescarteIndividual(fila({ margen_pct: 20 }), CFG), null);
  assert.match(motivoDescarteIndividual(fila({ margen_pct: null }), CFG), /margen proyectado no disponible/);
});

test('exclusión de recambios/accesorios por texto, insensible a mayúsculas y tildes', () => {
  assert.match(motivoDescarteIndividual(fila({ descripcion: 'Cadena para motosierra 40cm' }), CFG), /CADENA PARA/);
  assert.match(motivoDescarteIndividual(fila({ descripcion: 'RECAMBIO filtro' }), CFG), /RECAMBIO/);
  assert.equal(motivoDescarteIndividual(fila({ descripcion: 'Motosierra 40cm con cadena' }), CFG), null);
  // con la lista vacía no se excluye nada
  assert.equal(motivoDescarteIndividual(fila({ descripcion: 'Recambio filtro' }), { ...CFG, excluirTextos: [] }), null);
});

test('sin categoría no puede ser candidata (no se podría aplicar el tope por categoría)', () => {
  assert.match(motivoDescarteIndividual(fila({ categoria_nombre: '' }), CFG), /sin categoría/);
  assert.match(motivoDescarteIndividual(fila({ categoria_nombre: null }), CFG), /sin categoría/);
});

test('solo marcas prioritarias: descarta las no prioritarias solo si el modo está activo', () => {
  const noPrio = fila({ es_marca_prioritaria: false, marca: 'YAMATO' });
  assert.equal(motivoDescarteIndividual(noPrio, CFG), null);
  assert.match(motivoDescarteIndividual(noPrio, { ...CFG, soloMarcasPrioritarias: true }), /marca no prioritaria/);
});

test('máximo por categoría: 6 aptas en la misma categoría -> solo 4, las de mayor margen', () => {
  const filas = [10, 60, 20, 50, 30, 40].map((m, i) => fila({ ref: 'A' + i, margen_pct: m + 10, es_marca_prioritaria: false }));
  const r = seleccionarCandidatos(filas, CFG);
  const elegidas = r.filter((f) => f.es_candidato).map((f) => f.margen_pct).sort((a, b) => b - a);
  assert.deepEqual(elegidas, [70, 60, 50, 40]);
  const descartada = r.find((f) => f.margen_pct === 20); // la de 10+10
  assert.equal(descartada.es_candidato, false);
  assert.match(descartada.motivo_descarte, /fuera del top 4 de su categoría \(puesto 6\)/);
  assert.equal(descartada.ranking_categoria, 6);
});

test('el tope por categoría es configurable', () => {
  const filas = [1, 2, 3].map((i) => fila({ ref: 'B' + i, margen_pct: 20 + i }));
  const r = seleccionarCandidatos(filas, { ...CFG, maxPorCategoria: 2 });
  assert.equal(r.filter((f) => f.es_candidato).length, 2);
});

test('categorías distintas no compiten entre sí', () => {
  const filas = [
    ...[1, 2, 3, 4].map((i) => fila({ ref: 'C' + i, categoria_nombre: 'AMOLADORAS' })),
    ...[1, 2, 3, 4].map((i) => fila({ ref: 'D' + i, categoria_nombre: 'TALADROS' }))
  ];
  assert.equal(seleccionarCandidatos(filas, CFG).filter((f) => f.es_candidato).length, 8);
});

test('en una categoría, la marca prioritaria va antes aunque tenga menos margen', () => {
  const filas = [
    fila({ ref: 'NOPRIO', es_marca_prioritaria: false, margen_pct: 60 }),
    fila({ ref: 'PRIO', es_marca_prioritaria: true, margen_pct: 25 })
  ];
  const r = seleccionarCandidatos(filas, { ...CFG, maxPorCategoria: 1 });
  assert.equal(r.find((f) => f.ref === 'PRIO').es_candidato, true);
  assert.equal(r.find((f) => f.ref === 'NOPRIO').es_candidato, false);
});

test('tope global: respeta maxCandidatos y explica el descarte', () => {
  const filas = [];
  for (let c = 0; c < 5; c++) for (let i = 0; i < 4; i++) filas.push(fila({ ref: `G${c}-${i}`, categoria_nombre: 'CAT' + c, margen_pct: 30 + i }));
  const r = seleccionarCandidatos(filas, { ...CFG, maxCandidatos: 10 });
  assert.equal(r.filter((f) => f.es_candidato).length, 10);
  assert.ok(r.some((f) => /tope global de 10/.test(f.motivo_descarte || '')));
});

test('no elimina ni muta filas: misma longitud y orden, entrada intacta', () => {
  const filas = [fila({ ref: 'X1', stock_aft: 1 }), fila({ ref: 'X2' })];
  const copia = JSON.parse(JSON.stringify(filas));
  const r = seleccionarCandidatos(filas, CFG);
  assert.deepEqual(filas, copia);
  assert.deepEqual(r.map((f) => f.ref), ['X1', 'X2']);
  assert.equal(r[0].es_candidato, false);
  assert.equal(r[1].es_candidato, true);
});
