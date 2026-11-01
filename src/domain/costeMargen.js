// Capa de dominio (Clean Architecture) — reglas de negocio puras, sin
// PostgreSQL, sin fetch, sin ningún require de infraestructura. Movidas
// tal cual desde src/sync.js (fase 1 de la refactorización, sin cambiar
// su comportamiento — ver test/sync.test.js).
//
// Nota de la fase 1: BRANDS/CATEGORIAS_INCLUIDAS se leen de process.env al
// cargar el módulo (igual que antes, en sync.js) — es una simplificación
// deliberada de esta fase; inyectar la configuración en vez de leerla aquí
// directamente es trabajo de una fase posterior (capa de aplicación),
// fuera del alcance pedido ahora.
function listaDesdeEnv(nombreEnv, porDefecto) {
  const valor = process.env[nombreEnv];
  if (!valor) return porDefecto;
  return valor.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}
const BRANDS = listaDesdeEnv('AFT_BRANDS', ['WOLFPACK', 'PAPILLON', 'SATURNIA', 'MAURER', 'SAMURAI', 'YAMATO']);
const CATEGORIAS_INCLUIDAS = listaDesdeEnv('AFT_CATEGORIAS_INCLUIDAS', [
  'HERRAMIENTA', 'ELECTROPORTATIL', 'AMOLADORA', 'TALADRO', 'SIERRA', 'MOTOSIERRA',
  'DESBROZADOR', 'HIDROLIMPIADORA', 'COMPRESOR', 'GENERADOR', 'SOLDAR',
  'DISCO DE CORTE', 'DISCO ABRASIVO', 'LIJA', 'BROCA', 'LLAVE', 'DESTORNILLADOR',
  'PODA', 'NIVEL', 'MANGUERA', 'RIEGO', 'BOMBA DE AGUA', 'MALLA DE SOMBREO',
  'BOTA', 'ROPA DE TRABAJO'
]);
const FREE_SHIPPING_THRESHOLD = 30;
const SHIPPING_HERRAMITIENDA = 4.41;
const IVA_RECARGO_MAP = { 21: 5.2, 10: 1.4, 4: 0.5 };

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Coste real (IVA + recargo de equivalencia + portes) por referencia AFT.
// Dos vistas sobre el mismo cálculo (en src/sync.js, no aquí):
// - getTodasLasReferenciasConCoste(): TODAS las referencias con stock/precio
//   (con o sin EAN), marcando esOportunidadComercial si además pasa el
//   filtro de marca/categoría. La usa el control de inventario (prioridad
//   absoluta: cruzar TODO AFT contra Shopify, EAN primero y SKU como
//   alternativa inequívoca, sin descartar nada de antemano).
// - getCandidatosConCoste(): el filtro de marca/categoría de siempre, para
//   detectar oportunidades comerciales nuevas.
// ---------------------------------------------------------------------------
function calcularCosteYMargen(d) {
  const stock = Number(d.stock || 0);
  const costoBase = Number(d.costo || 0);
  const pvpSinIva = Number(d.pvp_sin_iva || 0);
  const ivaRate = Number(d.por_iva || 0);
  const recargoRate = IVA_RECARGO_MAP[ivaRate];
  const recargoDesconocido = recargoRate === undefined;
  const recargoAplicado = recargoDesconocido ? 0 : recargoRate;
  const ivaImporte = round2(costoBase * (ivaRate / 100));
  const recargoImporte = round2(costoBase * (recargoAplicado / 100));
  const precioVentaAFT = round2(pvpSinIva * (1 + ivaRate / 100));
  const transporteHerramitienda = precioVentaAFT >= FREE_SHIPPING_THRESHOLD ? SHIPPING_HERRAMITIENDA : 0;
  const costeDesembolsado = round2(costoBase + ivaImporte + recargoImporte);
  const costeParaMargen = round2(costeDesembolsado + transporteHerramitienda);

  const marcaOk = BRANDS.some((m) => normalizar(d.marca).indexOf(m) !== -1);
  const catOk = CATEGORIAS_INCLUIDAS.some((p) => normalizar(d.categoria_nombre).indexOf(p) !== -1);

  return {
    ref: d.ref, ean: d.ean, marca: d.marca, descripcion: d.descripcion,
    stock, stockCero: stock === 0, stockNegativo: stock < 0,
    ivaRate, recargoAplicado, recargoDesconocido,
    costeBase: costoBase, ivaImporte, recargoImporte, transporteHerramitienda,
    costeDesembolsado, costeParaMargen, precioVentaAFT,
    esOportunidadComercial: marcaOk && catOk
  };
}

module.exports = { calcularCosteYMargen, normalizar, round2, BRANDS, CATEGORIAS_INCLUIDAS };
