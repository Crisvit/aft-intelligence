// dedupPorClave() (src/sync.js) — cómo se manejan las referencias AFT
// duplicadas en una misma respuesta de importación (Fase 2 de la
// auditoría: "referencias duplicadas"). Función PURA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupPorClave } = require('../src/sync');

test('dedupPorClave: sin duplicados, devuelve la lista completa y ningún duplicado detectado', () => {
  const lista = [{ ref: 'A' }, { ref: 'B' }, { ref: 'C' }];
  const { resultado, duplicados } = dedupPorClave(lista, (x) => x.ref);
  assert.deepEqual(resultado, lista);
  assert.deepEqual(duplicados, []);
});

test('dedupPorClave: con una ref repetida, gana la PRIMERA aparición y la repetida se descarta', () => {
  const primera = { ref: 'A', marca: 'Wolfpack' };
  const segunda = { ref: 'A', marca: 'OTRA-MARCA-DISTINTA' };
  const { resultado, duplicados } = dedupPorClave([primera, segunda], (x) => x.ref);
  assert.deepEqual(resultado, [primera]); // nunca la segunda, aunque tenga datos distintos
  assert.equal(duplicados.length, 1);
  assert.equal(duplicados[0].clave, 'A');
});

test('dedupPorClave: distingue si el duplicado tenía datos idénticos o datos distintos (para la incidencia)', () => {
  const a1 = { ref: 'A', marca: 'Wolfpack' };
  const a2 = { ref: 'A', marca: 'Wolfpack' }; // idéntico
  const { duplicados: idénticos } = dedupPorClave([a1, a2], (x) => x.ref);
  assert.equal(idénticos[0].idéntico, true);

  const b1 = { ref: 'B', marca: 'Wolfpack' };
  const b2 = { ref: 'B', marca: 'Bellota' }; // distinto
  const { duplicados: distintos } = dedupPorClave([b1, b2], (x) => x.ref);
  assert.equal(distintos[0].idéntico, false);
});

test('dedupPorClave: tres o más apariciones de la misma ref -> solo la primera se conserva, cada repetición extra genera su propio duplicado', () => {
  const lista = [{ ref: 'A', n: 1 }, { ref: 'A', n: 2 }, { ref: 'A', n: 3 }];
  const { resultado, duplicados } = dedupPorClave(lista, (x) => x.ref);
  assert.deepEqual(resultado, [{ ref: 'A', n: 1 }]);
  assert.equal(duplicados.length, 2);
});

test('dedupPorClave: clave null, undefined o cadena vacía se descarta sin contar como duplicado ni como resultado', () => {
  const lista = [{ ref: null }, { ref: undefined }, { ref: '' }, { ref: '   ' }, { ref: 'VALIDA' }];
  const { resultado, duplicados } = dedupPorClave(lista, (x) => x.ref);
  assert.deepEqual(resultado, [{ ref: 'VALIDA' }]);
  assert.deepEqual(duplicados, []);
});

test('dedupPorClave: claves numéricas distintas que son el mismo texto (p. ej. id de categoría) sí se deduplican vía String()', () => {
  const lista = [{ id: 10 }, { id: 10 }];
  const { resultado, duplicados } = dedupPorClave(lista, (x) => String(x.id));
  assert.equal(resultado.length, 1);
  assert.equal(duplicados.length, 1);
});
