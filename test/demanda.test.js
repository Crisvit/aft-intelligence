const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generarCandidatosDesdeCatalogo, hayIntegracionConfigurada } = require('../src/demanda');

test('generarCandidatosDesdeCatalogo: deriva candidatos solo del catálogo real, nunca inventa texto', () => {
  const candidatos = generarCandidatosDesdeCatalogo({ marca: 'Wolfpack', categoria_nombre: 'Andamios', descripcion: 'Andamio multidireccional 14,6kg' });
  assert.deepEqual(candidatos, [
    'wolfpack andamios',
    'andamio multidireccional 14,6kg',
    'wolfpack andamio multidireccional 14,6kg'
  ]);
});

test('generarCandidatosDesdeCatalogo: campos vacíos no generan candidatos vacíos ni duplicados', () => {
  const candidatos = generarCandidatosDesdeCatalogo({ marca: '', categoria_nombre: '', descripcion: 'Taladro' });
  assert.deepEqual(candidatos, ['taladro']);

  const sinNada = generarCandidatosDesdeCatalogo({});
  assert.deepEqual(sinNada, []);
});

test('hayIntegracionConfigurada: devuelve un booleano coherente con el entorno de este proceso', () => {
  assert.equal(typeof hayIntegracionConfigurada(), 'boolean');
});
