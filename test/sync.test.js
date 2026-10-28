const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularCosteYMargen, normalizar, round2 } = require('../src/sync');

test('round2: redondea a 2 decimales', () => {
  assert.equal(round2(1.005), 1); // float binario real, documenta el comportamiento tal cual
  assert.equal(round2(1.2345), 1.23);
  assert.equal(round2(2), 2);
});

test('normalizar: mayúsculas y sin acentos', () => {
  assert.equal(normalizar('Amoladora Ángulo'), 'AMOLADORA ANGULO');
  assert.equal(normalizar(null), '');
  assert.equal(normalizar(undefined), '');
});

test('calcularCosteYMargen: IVA 21% aplica el recargo de equivalencia de 5.2% conocido', () => {
  const r = calcularCosteYMargen({ stock: 10, costo: 100, pvp_sin_iva: 120, por_iva: 21, marca: 'WOLFPACK', categoria_nombre: 'HERRAMIENTA' });
  assert.equal(r.recargoDesconocido, false);
  assert.equal(r.recargoAplicado, 5.2);
  assert.equal(r.ivaImporte, 21); // 100 * 21%
  assert.equal(r.recargoImporte, 5.2); // 100 * 5.2%
  assert.equal(r.precioVentaAFT, round2(120 * 1.21));
});

test('calcularCosteYMargen: tipo de IVA desconocido no inventa un recargo', () => {
  const r = calcularCosteYMargen({ stock: 1, costo: 50, pvp_sin_iva: 40, por_iva: 7, marca: 'X', categoria_nombre: 'Y' });
  assert.equal(r.recargoDesconocido, true);
  assert.equal(r.recargoAplicado, 0);
  assert.equal(r.recargoImporte, 0);
});

test('calcularCosteYMargen: transporte Herramitienda solo a partir del umbral de 30€ (PVP con IVA)', () => {
  const barato = calcularCosteYMargen({ stock: 1, costo: 5, pvp_sin_iva: 10, por_iva: 21, marca: 'X', categoria_nombre: 'Y' }); // PVP con IVA ~12.1 < 30
  assert.equal(barato.transporteHerramitienda, 0);

  const caro = calcularCosteYMargen({ stock: 1, costo: 50, pvp_sin_iva: 40, por_iva: 21, marca: 'X', categoria_nombre: 'Y' }); // PVP con IVA ~48.4 >= 30
  assert.equal(caro.transporteHerramitienda, 4.41);
});

test('calcularCosteYMargen: marca y categoría fuera de las listas incluidas -> no es oportunidad comercial', () => {
  const r = calcularCosteYMargen({ stock: 5, costo: 10, pvp_sin_iva: 15, por_iva: 21, marca: 'MARCA DESCONOCIDA', categoria_nombre: 'CATEGORIA DESCONOCIDA' });
  assert.equal(r.esOportunidadComercial, false);
});

test('calcularCosteYMargen: marca prioritaria por defecto + categoría incluida -> sí es oportunidad comercial', () => {
  const r = calcularCosteYMargen({ stock: 5, costo: 10, pvp_sin_iva: 15, por_iva: 21, marca: 'Wolfpack', categoria_nombre: 'Herramienta eléctrica' });
  assert.equal(r.esOportunidadComercial, true);
});

test('calcularCosteYMargen: detecta stock cero y negativo sin ambigüedad', () => {
  assert.equal(calcularCosteYMargen({ stock: 0, costo: 1, pvp_sin_iva: 1, por_iva: 21 }).stockCero, true);
  assert.equal(calcularCosteYMargen({ stock: -2, costo: 1, pvp_sin_iva: 1, por_iva: 21 }).stockNegativo, true);
  assert.equal(calcularCosteYMargen({ stock: 3, costo: 1, pvp_sin_iva: 1, por_iva: 21 }).stockCero, false);
});
