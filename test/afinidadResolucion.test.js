const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarResolucion, validarRevocacion, resolucionDesdeFila, CLASES_RESOLUBLES } = require('../src/domain/afinidadResolucion');

test('validarResolucion: acepta una resolución completa y válida', () => {
  const r = validarResolucion({ categoria: 'Jardín y exterior', clase: 'complementaria', motivo: 'Categoría de venta cruzada confirmada', resueltoPor: 'admin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errores, []);
  assert.equal(r.categoriaNormalizada, 'JARDIN Y EXTERIOR');
});

test('validarResolucion: rechaza categoría vacía', () => {
  const r = validarResolucion({ categoria: '', clase: 'principal', motivo: 'x', resueltoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /categoría no puede estar vacía/);
});

test('validarResolucion: rechaza clase no resoluble (nunca se puede "resolver" como ambigua)', () => {
  const r = validarResolucion({ categoria: 'Jardín', clase: 'ambigua', motivo: 'x', resueltoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /no válida/);
});

test('validarResolucion: rechaza clase inventada fuera de las 4 resolubles', () => {
  const r = validarResolucion({ categoria: 'Jardín', clase: 'super_prioritaria', motivo: 'x', resueltoPor: 'admin' });
  assert.equal(r.ok, false);
});

test('validarResolucion: CLASES_RESOLUBLES son exactamente las 4 elegibles, nunca ambigua', () => {
  assert.deepEqual(CLASES_RESOLUBLES.sort(), ['complementaria', 'estacional', 'fuera_de_foco', 'principal'].sort());
});

test('validarResolucion: rechaza sin usuario que resuelve', () => {
  const r = validarResolucion({ categoria: 'Jardín', clase: 'principal', motivo: 'x', resueltoPor: '' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /quién resuelve/);
});

test('validarResolucion: rechaza sin motivo', () => {
  const r = validarResolucion({ categoria: 'Jardín', clase: 'principal', motivo: '', resueltoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /motivo/);
});

test('validarResolucion: acumula todos los errores a la vez, no solo el primero', () => {
  const r = validarResolucion({ categoria: '', clase: 'ambigua', motivo: '', resueltoPor: '' });
  assert.equal(r.ok, false);
  assert.equal(r.errores.length, 4);
});

test('validarRevocacion: acepta categoría y usuario válidos', () => {
  const r = validarRevocacion({ categoria: 'Jardín', revocadoPor: 'admin' });
  assert.equal(r.ok, true);
  assert.equal(r.categoriaNormalizada, 'JARDIN');
});

test('validarRevocacion: rechaza sin usuario que revoca', () => {
  const r = validarRevocacion({ categoria: 'Jardín', revocadoPor: '' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /quién revoca/);
});

test('resolucionDesdeFila: null/undefined -> null', () => {
  assert.equal(resolucionDesdeFila(null), null);
  assert.equal(resolucionDesdeFila(undefined), null);
});

test('resolucionDesdeFila: traduce una fila de BD al formato esperado por clasificarAfinidadComercial', () => {
  const r = resolucionDesdeFila({
    clase: 'fuera_de_foco', motivo: 'Decisión comercial', resuelto_por: 'admin',
    resuelto_en: '2026-03-15T10:00:00.000Z'
  });
  assert.deepEqual(r, { clase: 'fuera_de_foco', motivo: 'Decisión comercial', resueltoPor: 'admin', resueltoEn: '2026-03-15' });
});

// --- Integración con clasificarAfinidadComercial: una resolución
// construida aquí debe funcionar end-to-end igual que en
// test/afinidad.test.js, confirmando que ambos módulos están en sintonía ---
test('[integración] una resolución válida persistida prevalece sobre la clasificación automática', () => {
  const { clasificarAfinidadComercial } = require('../src/domain/afinidad');
  const validacion = validarResolucion({ categoria: 'Ferretería exótica', clase: 'principal', motivo: 'Confirmado por comercial', resueltoPor: 'maria' });
  assert.equal(validacion.ok, true);

  const resolucion = resolucionDesdeFila({ clase: 'principal', motivo: 'Confirmado por comercial', resuelto_por: 'maria', resuelto_en: '2026-01-01' });
  const r = clasificarAfinidadComercial('Ferretería exótica', undefined, resolucion);
  assert.equal(r.clase, 'principal');
  assert.equal(r.resuelta, true);
});
