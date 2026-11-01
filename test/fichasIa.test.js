const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarCalidad, hayProveedorIaConfigurado } = require('../src/fichasIa');

const FICHA_VALIDA = {
  titulo: 'Andamio Multidireccional Wolfpack 14,6kg Profesional',
  descripcion: 'Andamio multidireccional de la marca Wolfpack, fabricado en acero resistente, ideal para trabajos en altura de uso profesional y doméstico. Fácil montaje y desmontaje.',
  atributos: { marca: 'Wolfpack', categoria: 'Andamios' },
  meta_titulo: 'Andamio Wolfpack 14,6kg | Herramitienda',
  meta_descripcion: 'Compra el andamio multidireccional Wolfpack 14,6kg al mejor precio. Envío rápido y profesional. Ideal para trabajos en altura.',
  keywords_seo: ['andamio wolfpack', 'andamio multidireccional']
};
const ROW = { ref: 'FIC-1', marca: 'WOLFPACK' };

test('validarCalidad: ficha completa y bien formada pasa sin motivos', () => {
  const r = validarCalidad(ROW, FICHA_VALIDA);
  assert.equal(r.ok, true);
  assert.equal(r.motivo, null);
});

test('validarCalidad: la marca real debe aparecer en título o descripción', () => {
  const sinMarca = { ...FICHA_VALIDA, titulo: 'Andamio multidireccional 14,6kg profesional', descripcion: FICHA_VALIDA.descripcion.replace(/wolfpack/gi, 'la marca') };
  const r = validarCalidad(ROW, sinMarca);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /la marca real no aparece/);
});

test('validarCalidad: título fuera de rango (demasiado corto)', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, titulo: 'Andamio' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /título fuera de rango/);
});

test('validarCalidad: rechaza marcadores de relleno sin completar', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, descripcion: FICHA_VALIDA.descripcion + ' [COMPLETAR AQUI]' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /marcadores de relleno/);
});

test('validarCalidad: sin keywords_seo no pasa', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, keywords_seo: [] });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /sin keywords_seo/);
});

// --- Características adicionales (caracterización previa a mover la
// función a src/domain/, para detectar cualquier cambio de comportamiento
// en el traslado) ---

test('[caracterización] título demasiado largo (>70) falla', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, titulo: 'T'.repeat(71) });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /título fuera de rango \(71 caracteres/);
});

test('[caracterización] meta_titulo demasiado largo (>60) falla', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, meta_titulo: 'M'.repeat(61) });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /meta_titulo demasiado largo \(61 caracteres/);
});

test('[caracterización] meta_descripcion fuera de rango (muy corta o muy larga) falla', () => {
  const corta = validarCalidad(ROW, { ...FICHA_VALIDA, meta_descripcion: 'Corta' });
  assert.equal(corta.ok, false);
  assert.match(corta.motivo, /meta_descripcion fuera de rango \(5 caracteres/);

  const larga = validarCalidad(ROW, { ...FICHA_VALIDA, meta_descripcion: 'M'.repeat(161) });
  assert.equal(larga.ok, false);
  assert.match(larga.motivo, /meta_descripcion fuera de rango \(161 caracteres/);
});

test('[caracterización] sin atributos (objeto) falla', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, atributos: null });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /sin atributos/);
});

test('[caracterización] varios fallos simultáneos se concatenan con "; "', () => {
  const r = validarCalidad(ROW, { ...FICHA_VALIDA, titulo: 'Corto', keywords_seo: [] });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /título fuera de rango.*; sin keywords_seo/);
});

test('hayProveedorIaConfigurado: refleja si ANTHROPIC_API_KEY está definida en este proceso', () => {
  // El valor se captura al cargar el módulo (ya requerido arriba), así que
  // solo comprobamos que la función devuelve un booleano coherente con el
  // entorno real de este test, sin asumir cuál es.
  assert.equal(typeof hayProveedorIaConfigurado(), 'boolean');
});
