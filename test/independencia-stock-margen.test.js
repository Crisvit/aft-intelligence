// [fase 2] Regresión arquitectónica explícitamente pedida: "mantén
// completamente independiente el ajuste de stock de las alertas de
// márgenes". Verificado por inspección manual (grep) al diseñar esta fase:
// src/reposicion.js no tiene ninguna referencia a margen/rentabilidad, y
// src/rentabilidad.js no escribe en ninguna tabla de reposición ni toca
// stock (solo lo lee como columna informativa en un JOIN). Esta prueba fija
// esa garantía para que un cambio futuro no la rompa en silencio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reposicionSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'reposicion.js'), 'utf8');
const rentabilidadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'rentabilidad.js'), 'utf8');

test('[arquitectura] src/reposicion.js no referencia margen ni rentabilidad', () => {
  assert.doesNotMatch(reposicionSrc, /margen/i);
  assert.doesNotMatch(reposicionSrc, /rentabilidad/i);
});

test('[arquitectura] src/rentabilidad.js no escribe en reposicion_runs ni en ninguna tabla reposicion_*', () => {
  assert.doesNotMatch(rentabilidadSrc, /INSERT\s+INTO\s+reposicion_/i);
  assert.doesNotMatch(rentabilidadSrc, /UPDATE\s+reposicion_/i);
});

test('[arquitectura] src/rentabilidad.js no hace ningún UPDATE de stock (solo lo lee como columna informativa)', () => {
  assert.doesNotMatch(rentabilidadSrc, /UPDATE\s+\w+\s+SET[^;]*\bstock\b/i);
});
