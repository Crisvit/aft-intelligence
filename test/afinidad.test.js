const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clasificarAfinidadComercial } = require('../src/domain/afinidad');

test('clasificarAfinidadComercial: coincidencia con lista principal', () => {
  const r = clasificarAfinidadComercial('Taladro percutor Wolfpack');
  assert.equal(r.clase, 'principal');
  assert.equal(r.elegible, true);
  assert.match(r.motivo, /TALADRO/);
});

test('clasificarAfinidadComercial: coincidencia con lista complementaria', () => {
  const r = clasificarAfinidadComercial('Llave de carraca');
  assert.equal(r.clase, 'complementaria');
  assert.equal(r.elegible, true);
});

test('clasificarAfinidadComercial: categoría sin ninguna coincidencia -> ambigua, no fuera_de_foco', () => {
  const r = clasificarAfinidadComercial('Categoría totalmente desconocida XYZ123');
  assert.equal(r.clase, 'ambigua');
  assert.equal(r.elegible, null);
  assert.match(r.motivo, /no coincide con ninguna lista/);
});

test('clasificarAfinidadComercial: categoría vacía o nula -> ambigua', () => {
  assert.equal(clasificarAfinidadComercial('').clase, 'ambigua');
  assert.equal(clasificarAfinidadComercial(null).clase, 'ambigua');
  assert.equal(clasificarAfinidadComercial(undefined).clase, 'ambigua');
});

test('clasificarAfinidadComercial: fuera_de_foco SOLO si está explícitamente en esa lista inyectada', () => {
  // Las entradas de lista se comparan tal cual (sin acentos, como las
  // listas por defecto de afinidad.js) — solo el texto de categoría de
  // entrada se normaliza (mayúsculas, sin diacríticos) antes de comparar.
  const listas = { principal: ['TALADRO'], complementaria: [], estacional: [], fueraDeFoco: ['DECORACION NAVIDENA'] };
  const r = clasificarAfinidadComercial('Decoración navideña', listas);
  assert.equal(r.clase, 'fuera_de_foco');
  assert.equal(r.elegible, false);

  // Con la misma lista de fuera_de_foco, una categoría que no coincide con
  // NINGUNA lista (ni siquiera fuera_de_foco) debe seguir siendo ambigua,
  // nunca caer por defecto en fuera_de_foco.
  const r2 = clasificarAfinidadComercial('Otra categoría sin relación', listas);
  assert.equal(r2.clase, 'ambigua');
});

test('clasificarAfinidadComercial: estacional es elegible igual que principal/complementaria', () => {
  const listas = { principal: [], complementaria: [], estacional: ['DESCORCHADOR NAVIDAD'], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Descorchador Navidad edición especial', listas);
  assert.equal(r.clase, 'estacional');
  assert.equal(r.elegible, true);
});

test('clasificarAfinidadComercial: insensible a mayúsculas/acentos', () => {
  const listas = { principal: ['POLEA'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('polea de tracción', listas);
  assert.equal(r.clase, 'principal');
});

test('clasificarAfinidadComercial: siempre incluye motivo trazable, nunca vacío', () => {
  for (const categoria of ['Taladro', 'Llave', 'Desconocida', '', null]) {
    const r = clasificarAfinidadComercial(categoria);
    assert.ok(r.motivo && r.motivo.length > 0);
  }
});
