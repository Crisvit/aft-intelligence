const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extraerHandleDeUrl, clasificarPagina, combinarFilaSeo, calcularRangoFechas
} = require('../src/seoGoogle');

test('extraerHandleDeUrl: extrae el handle de una página de producto real', () => {
  assert.equal(extraerHandleDeUrl('https://herramitienda.es/products/desbrozadora-gasolina-52cc'), 'desbrozadora-gasolina-52cc');
  assert.equal(extraerHandleDeUrl('https://herramitienda.es/products/taladro-18v?variant=123'), 'taladro-18v');
  assert.equal(extraerHandleDeUrl('/products/pala-jardin/'), 'pala-jardin');
});

test('extraerHandleDeUrl: null para páginas que no son de producto, nunca adivina', () => {
  assert.equal(extraerHandleDeUrl('https://herramitienda.es/'), null);
  assert.equal(extraerHandleDeUrl('https://herramitienda.es/collections/jardin'), null);
  assert.equal(extraerHandleDeUrl(null), null);
  assert.equal(extraerHandleDeUrl(''), null);
});

test('clasificarPagina: solo clasifica por encima del umbral de impresiones, con posición real', () => {
  assert.equal(clasificarPagina({ impresiones: 10, posicion: 15 }, { impresionesMinimas: 50, posicionUmbral: 10 }), null);
  assert.equal(clasificarPagina({ impresiones: 80, posicion: 15 }, { impresionesMinimas: 50, posicionUmbral: 10 }), 'alta_demanda_mal_posicionada');
  assert.equal(clasificarPagina({ impresiones: 80, posicion: 4 }, { impresionesMinimas: 50, posicionUmbral: 10 }), 'alta_demanda_bien_posicionada');
});

test('clasificarPagina: sin impresiones o sin posición real, nunca inventa una categoría', () => {
  assert.equal(clasificarPagina({ impresiones: null, posicion: 3 }, {}), null);
  assert.equal(clasificarPagina({ impresiones: 200, posicion: null }, {}), null);
});

test('combinarFilaSeo: null si la página no es de producto o no alcanza alta demanda', () => {
  const opts = { impresionesMinimas: 50, posicionUmbral: 10 };
  assert.equal(combinarFilaSeo({ url: 'https://x.es/', impresiones: 500, posicion: 1 }, { catalogoPorHandle: new Map(), sesionesPorHandle: new Map() }, opts), null);
  assert.equal(combinarFilaSeo({ url: 'https://x.es/products/taladro', impresiones: 5, posicion: 1 }, { catalogoPorHandle: new Map(), sesionesPorHandle: new Map() }, opts), null);
});

test('combinarFilaSeo: cruza handle con catálogo y sesiones GA4 cuando existen, sin inventar lo que falta', () => {
  const opts = { impresionesMinimas: 50, posicionUmbral: 10 };
  const catalogoPorHandle = new Map([['taladro-18v', { ref: 'AFT-1', marca: 'Wolfpack', titulo: 'Taladro percutor 18V' }]]);
  const sesionesPorHandle = new Map([['taladro-18v', 42]]);

  const filaCruzada = combinarFilaSeo(
    { url: 'https://x.es/products/taladro-18v', clics: 12, impresiones: 300, ctr: 0.04, posicion: 18 },
    { catalogoPorHandle, sesionesPorHandle },
    opts
  );
  assert.deepEqual(filaCruzada, {
    pagina_url: 'https://x.es/products/taladro-18v', shopify_handle: 'taladro-18v',
    ref: 'AFT-1', marca: 'Wolfpack', descripcion: 'Taladro percutor 18V',
    clics: 12, impresiones: 300, ctr: 0.04, posicion: 18, sesiones_ga4: 42,
    categoria: 'alta_demanda_mal_posicionada'
  });

  // Handle real pero sin fila en el catálogo todavía (p. ej. producto nuevo
  // no sincronizado) — ref/marca/descripcion/sesiones quedan null, nunca
  // un dato inventado.
  const filaSinCatalogo = combinarFilaSeo(
    { url: 'https://x.es/products/nuevo-sin-sync', impresiones: 100, posicion: 2 },
    { catalogoPorHandle: new Map(), sesionesPorHandle: new Map() },
    opts
  );
  assert.equal(filaSinCatalogo.ref, null);
  assert.equal(filaSinCatalogo.sesiones_ga4, null);
  assert.equal(filaSinCatalogo.categoria, 'alta_demanda_bien_posicionada');
});

test('calcularRangoFechas: respeta el retraso real de 3 días de Search Console', () => {
  const ahora = new Date('2026-02-01T00:00:00Z');
  const { startDate, endDate } = calcularRangoFechas(28, ahora);
  assert.equal(endDate, '2026-01-29');
  assert.equal(startDate, '2026-01-01');
});
