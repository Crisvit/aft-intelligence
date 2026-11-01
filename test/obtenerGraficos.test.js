const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agregarEjecucionesPorDia, DIAS_PERMITIDOS, VENTANA_MAXIMA_DIAS } = require('../src/usecases/obtenerGraficos');

test('agregarEjecucionesPorDia: agrupa por día de Madrid y cuenta success/error/running por separado', () => {
  const filas = [
    { started_at: '2026-03-10T09:00:00Z', status: 'success' },
    { started_at: '2026-03-10T10:00:00Z', status: 'error' },
    { started_at: '2026-03-10T11:00:00Z', status: 'success' },
    { started_at: '2026-03-11T09:00:00Z', status: 'running' }
  ];
  const out = agregarEjecucionesPorDia(filas);
  assert.equal(out.length, 2);
  assert.equal(out[0].fecha, '2026-03-10');
  assert.equal(out[0].correctas, 2);
  assert.equal(out[0].fallidas, 1);
  assert.equal(out[0].enCurso, 0);
  assert.equal(out[1].fecha, '2026-03-11');
  assert.equal(out[1].enCurso, 1);
});

test('agregarEjecucionesPorDia: lista vacía da lista vacía, nunca inventa un día', () => {
  assert.deepEqual(agregarEjecucionesPorDia([]), []);
});

test('agregarEjecucionesPorDia: resultado ordenado por fecha ascendente', () => {
  const filas = [
    { started_at: '2026-03-12T09:00:00Z', status: 'success' },
    { started_at: '2026-03-10T09:00:00Z', status: 'success' },
    { started_at: '2026-03-11T09:00:00Z', status: 'success' }
  ];
  const out = agregarEjecucionesPorDia(filas);
  assert.deepEqual(out.map((o) => o.fecha), ['2026-03-10', '2026-03-11', '2026-03-12']);
});

test('DIAS_PERMITIDOS y VENTANA_MAXIMA_DIAS: el filtro ofrece exactamente 7/30/90, acotado por la ventana máxima', () => {
  assert.deepEqual(DIAS_PERMITIDOS, [7, 30, 90]);
  assert.equal(VENTANA_MAXIMA_DIAS, Math.max(...DIAS_PERMITIDOS));
});
