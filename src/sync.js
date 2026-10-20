// Lógica de negocio portada y extendida desde el workflow n8n
// "AFT → Shopify: Sync diaria de stock y precio" (nodos 2 y 5), ya auditada
// y verificada contra las reglas de Herramitienda. Añade aquí lo que ese
// workflow no tenía: fallback por SKU e incidencia explícita de stock negativo.
//
// Este módulo NUNCA llama a una mutación de Shopify. Solo lee AFT, lee
// Shopify y escribe en nuestra propia base (hmt-db).

const { pool } = require('./db');
const aft = require('./aftClient');
const shopify = require('./shopifyClient');

const BRANDS = ['WOLFPACK', 'PAPILLON', 'SATURNIA', 'MAURER', 'SAMURAI', 'YAMATO'];
const CATEGORIAS_INCLUIDAS = [
  'HERRAMIENTA', 'ELECTROPORTATIL', 'AMOLADORA', 'TALADRO', 'SIERRA', 'MOTOSIERRA',
  'DESBROZADOR', 'HIDROLIMPIADORA', 'COMPRESOR', 'GENERADOR', 'SOLDAR',
  'DISCO DE CORTE', 'DISCO ABRASIVO', 'LIJA', 'BROCA', 'LLAVE', 'DESTORNILLADOR',
  'PODA', 'NIVEL', 'MANGUERA', 'RIEGO', 'BOMBA DE AGUA', 'MALLA DE SOMBREO',
  'BOTA', 'ROPA DE TRABAJO'
];
const FREE_SHIPPING_THRESHOLD = 30;
const SHIPPING_HERRAMITIENDA = 4.41;
const IVA_RECARGO_MAP = { 21: 5.2, 10: 1.4, 4: 0.5 };
const MAIN_LOCATION_ID = process.env.SHOPIFY_MAIN_LOCATION_ID || 'gid://shopify/Location/102229836040';

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// 1. Ingesta AFT (catálogo, categorías, stock/precios) -> hmt-db
// ---------------------------------------------------------------------------
async function ingestAft() {
  const token = await aft.getAftToken();
  const [categorias, productos, stockPrecios] = await Promise.all([
    aft.getCategorias(token),
    aft.getProductos(token),
    aft.getStockPrecios(token)
  ]);

  const catList = Array.isArray(categorias) ? categorias : (categorias.items || categorias.data || []);
  const prodList = Array.isArray(productos) ? productos : (productos.items || productos.data || []);
  const stockList = Array.isArray(stockPrecios) ? stockPrecios : (stockPrecios.items || stockPrecios.data || []);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of catList) {
      await client.query(
        `INSERT INTO aft_categorias (id_categoria, nombre, padre, url_img, ultima_sync)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (id_categoria) DO UPDATE SET nombre=$2, padre=$3, url_img=$4, ultima_sync=now()`,
        [String(c.id), c.nombre, c.padre != null ? String(c.padre) : null, c.urL_IMG_CAT || c.url_img || null]
      );
    }

    const catNombreMap = {};
    for (const c of catList) catNombreMap[String(c.id)] = normalizar(c.nombre);

    for (const p of prodList) {
      await client.query(
        `INSERT INTO aft_catalogo (ref, ean, marca, categoria_id, categoria_nombre, descripcion_corta, descripcion_larga, peso_gr, alto_cm, ancho_cm, largo_cm, portes, tipo_iva, por_iva, ultima_sync)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (ref) DO UPDATE SET ean=$2, marca=$3, categoria_id=$4, categoria_nombre=$5,
           descripcion_corta=$6, descripcion_larga=$7, peso_gr=$8, alto_cm=$9, ancho_cm=$10,
           largo_cm=$11, portes=$12, tipo_iva=$13, por_iva=$14, ultima_sync=now()`,
        [
          p.ref, p.ean, p.marca, p.categorias != null ? String(p.categorias) : null,
          catNombreMap[String(p.categorias)] || null, p.descripcioN_CORTA, p.descripcioN_LARGA,
          p.pesO_GR, p.altO_CM, p.anchO_CM, p.largO_CM, p.portes, p.tipO_IVA, p.poR_IVA
        ]
      );
    }

    for (const s of stockList) {
      const pvpSinIva = s.pvP_SINIVA != null ? s.pvP_SINIVA : s.pvp_siniva;
      await client.query(
        `INSERT INTO aft_stock_precios (ref, costo, pvp_sin_iva, stock, fecha_ultimo_cambio_aft, ultima_actualizacion_local)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (ref) DO UPDATE SET costo=$2, pvp_sin_iva=$3, stock=$4, fecha_ultimo_cambio_aft=$5, ultima_actualizacion_local=now()`,
        [s.ref, s.costo, pvpSinIva, s.stock, s.fechA_ULTIMO_CAMBIO ? new Date(s.fechA_ULTIMO_CAMBIO) : null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { categorias: catList.length, productos: prodList.length, stockPrecios: stockList.length };
}

// ---------------------------------------------------------------------------
// 2. Candidatos: catálogo AFT ya combinado, filtrado por marca/categoría,
//    con coste real calculado (IVA + recargo de equivalencia + portes).
// ---------------------------------------------------------------------------
async function getCandidatosConCoste() {
  const { rows } = await pool.query(`
    SELECT c.ref, c.ean, c.marca, c.descripcion_corta AS descripcion, c.categoria_nombre,
           sp.stock, sp.costo, sp.pvp_sin_iva, c.por_iva
    FROM aft_catalogo c
    JOIN aft_stock_precios sp ON sp.ref = c.ref
    WHERE c.ean IS NOT NULL AND c.ean <> ''
  `);

  const out = [];
  for (const d of rows) {
    const marcaOk = BRANDS.some((m) => normalizar(d.marca).indexOf(m) !== -1);
    if (!marcaOk) continue;
    const catOk = CATEGORIAS_INCLUIDAS.some((p) => normalizar(d.categoria_nombre).indexOf(p) !== -1);
    if (!catOk) continue;

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

    out.push({
      ref: d.ref, ean: d.ean, marca: d.marca, descripcion: d.descripcion,
      stock, stockCero: stock === 0, stockNegativo: stock < 0,
      ivaRate, recargoAplicado, recargoDesconocido,
      costeBase: costoBase, ivaImporte, recargoImporte, transporteHerramitienda,
      costeDesembolsado, costeParaMargen, precioVentaAFT
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Comparación con Shopify: EAN primero, SKU (ref) como alternativa solo
//    cuando el resultado es inequívoco (exactamente una variante).
// ---------------------------------------------------------------------------
function combinarConShopify(fuente, graphqlResult, matchedBy) {
  const edges = (graphqlResult.data && graphqlResult.data.productVariants && graphqlResult.data.productVariants.edges) || [];
  if (edges.length === 0) return null;

  const alertaDuplicado = edges.length > 1;
  const edge = edges[0];
  const levels = (edge.node.inventoryItem && edge.node.inventoryItem.inventoryLevels && edge.node.inventoryItem.inventoryLevels.edges) || [];
  const ubicaciones = levels.map((l) => {
    const qtyEntry = (l.node.quantities || []).find((q) => q.name === 'available');
    return { locationId: l.node.location.id, locationName: l.node.location.name, available: qtyEntry ? qtyEntry.quantity : null };
  });
  const alertaMultiplesUbicaciones = ubicaciones.length > 1;
  const ubicacionPrincipal = ubicaciones.find((u) => u.locationId === MAIN_LOCATION_ID);
  const alertaUbicacionPrincipalNoEncontrada = !ubicacionPrincipal;
  const stockShopifyUbicacionPrincipal = ubicacionPrincipal ? ubicacionPrincipal.available : null;
  const precioShopifyActual = edge.node.price != null ? Number(edge.node.price) : null;
  const tituloShopify = edge.node.product ? edge.node.product.title : null;
  const costeAnteriorShopify = edge.node.inventoryItem && edge.node.inventoryItem.unitCost ? Number(edge.node.inventoryItem.unitCost.amount) : null;
  const margenActualPct = precioShopifyActual ? round2(((precioShopifyActual - fuente.costeParaMargen) / precioShopifyActual) * 100) : null;
  const margenConPrecioAFTPct = fuente.precioVentaAFT ? round2(((fuente.precioVentaAFT - fuente.costeParaMargen) / fuente.precioVentaAFT) * 100) : null;
  const diferenciaPrecioPct = precioShopifyActual ? round2(((fuente.precioVentaAFT - precioShopifyActual) / precioShopifyActual) * 100) : null;

  let recomendacionPrecio = 'sin cambio relevante';
  if (precioShopifyActual != null) {
    if (fuente.precioVentaAFT > precioShopifyActual) recomendacionPrecio = 'AFT indica precio mayor - revisar posible subida';
    else if (fuente.precioVentaAFT < precioShopifyActual) recomendacionPrecio = 'AFT indica precio menor - revisar margen actual';
  }

  // SKU solo se acepta como fuente fiable si no hay ambigüedad (una sola variante).
  const matchFiable = matchedBy === 'ean' || (matchedBy === 'sku' && edges.length === 1);

  const bloquearEscritura = alertaDuplicado || alertaMultiplesUbicaciones || alertaUbicacionPrincipalNoEncontrada || !matchFiable;
  const stockDiferencia = fuente.stock - (stockShopifyUbicacionPrincipal || 0);

  return {
    ref: fuente.ref, ean: fuente.ean, marca: fuente.marca,
    shopify_variant_id: edge.node.id,
    shopify_inventory_item_id: edge.node.inventoryItem.id,
    shopify_product_title: tituloShopify,
    shopify_price: precioShopifyActual,
    shopify_stock: stockShopifyUbicacionPrincipal,
    shopify_cost: costeAnteriorShopify,
    matched_by: matchedBy,
    num_variantes_encontradas: edges.length,
    alerta_duplicado: alertaDuplicado,
    alerta_multiples_ubicaciones: alertaMultiplesUbicaciones,
    alerta_ubicacion_no_encontrada: alertaUbicacionPrincipalNoEncontrada,
    stock_aft: fuente.stock,
    stock_diferencia: stockDiferencia,
    coste_para_margen: fuente.costeParaMargen,
    precio_venta_aft: fuente.precioVentaAFT,
    margen_actual_pct: margenActualPct,
    margen_con_precio_aft_pct: margenConPrecioAFTPct,
    diferencia_precio_pct: diferenciaPrecioPct,
    recomendacion_precio: recomendacionPrecio,
    bloquear_escritura: bloquearEscritura,
    stockCero: fuente.stockCero,
    stockNegativo: fuente.stockNegativo
  };
}

// ---------------------------------------------------------------------------
// 4. Ejecuta la comparación completa AFT <-> Shopify (SOLO LECTURA) y guarda
//    el resultado (diferencias + incidencias + resumen) en hmt-db.
// ---------------------------------------------------------------------------
async function runInventorySync() {
  const startedAt = new Date();
  const { rows: runRows } = await pool.query(
    `INSERT INTO sync_runs (started_at, status) VALUES ($1, 'running') RETURNING id`,
    [startedAt]
  );
  const runId = runRows[0].id;

  const counters = { matched: 0, cambiarian: 0, aCero: 0, sinCambio: 0, incidencias: 0, noEncontrados: 0 };

  try {
    await ingestAft();
    const candidatos = await getCandidatosConCoste();
    const shopifyToken = await shopify.getShopifyToken();

    await pool.query('DELETE FROM shopify_match');

    for (const fuente of candidatos) {
      if (fuente.stockNegativo) {
        await registrarIncidencia(fuente.ref, fuente.ean, 'stock_negativo', `AFT reporta stock ${fuente.stock} para ref ${fuente.ref}`);
        counters.incidencias++;
        continue;
      }

      let resultado = combinarConShopify(fuente, await shopify.findVariantByBarcode(shopifyToken, fuente.ean), 'ean');

      if (!resultado) {
        // Fallback por SKU/referencia, solo cuando el EAN no encontró nada.
        resultado = combinarConShopify(fuente, await shopify.findVariantBySku(shopifyToken, fuente.ref), 'sku');
      }

      if (!resultado) {
        await pool.query(
          `INSERT INTO shopify_match (ref, ean, marca, stock_aft, estado, checked_at)
           VALUES ($1,$2,$3,$4,'no_encontrado', now())`,
          [fuente.ref, fuente.ean, fuente.marca, fuente.stock]
        );
        counters.noEncontrados++;
        continue;
      }

      if (resultado.alerta_duplicado || resultado.alerta_multiples_ubicaciones || resultado.alerta_ubicacion_no_encontrada) {
        const motivos = [];
        if (resultado.alerta_duplicado) motivos.push('EAN con múltiples variantes en Shopify');
        if (resultado.alerta_multiples_ubicaciones) motivos.push('múltiples ubicaciones de inventario');
        if (resultado.alerta_ubicacion_no_encontrada) motivos.push('ubicación principal no encontrada');
        await registrarIncidencia(fuente.ref, fuente.ean, resultado.alerta_duplicado ? 'ean_duplicado' : 'multiples_ubicaciones', motivos.join('; '));
        counters.incidencias++;
      }

      let estado;
      if (resultado.bloquear_escritura) estado = 'incidencia';
      else if (resultado.stockCero && resultado.shopify_stock !== 0) estado = 'a_cero';
      else if (resultado.stock_diferencia !== 0 || Math.abs(resultado.diferencia_precio_pct || 0) > 0) estado = 'cambiaria';
      else estado = 'sin_cambio';

      if (estado === 'cambiaria') counters.cambiarian++;
      else if (estado === 'a_cero') counters.aCero++;
      else if (estado === 'sin_cambio') counters.sinCambio++;

      counters.matched++;

      await pool.query(
        `INSERT INTO shopify_match (ref, ean, marca, shopify_variant_id, shopify_inventory_item_id,
           shopify_product_title, shopify_price, shopify_stock, shopify_cost, matched_by,
           num_variantes_encontradas, alerta_duplicado, alerta_multiples_ubicaciones,
           alerta_ubicacion_no_encontrada, stock_aft, stock_diferencia, coste_para_margen,
           precio_venta_aft, margen_actual_pct, margen_con_precio_aft_pct, diferencia_precio_pct,
           recomendacion_precio, bloquear_escritura, estado, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now())`,
        [
          resultado.ref, resultado.ean, resultado.marca, resultado.shopify_variant_id, resultado.shopify_inventory_item_id,
          resultado.shopify_product_title, resultado.shopify_price, resultado.shopify_stock, resultado.shopify_cost, resultado.matched_by,
          resultado.num_variantes_encontradas, resultado.alerta_duplicado, resultado.alerta_multiples_ubicaciones,
          resultado.alerta_ubicacion_no_encontrada, resultado.stock_aft, resultado.stock_diferencia, resultado.coste_para_margen,
          resultado.precio_venta_aft, resultado.margen_actual_pct, resultado.margen_con_precio_aft_pct, resultado.diferencia_precio_pct,
          resultado.recomendacion_precio, resultado.bloquear_escritura, estado
        ]
      );
    }

    await pool.query(
      `UPDATE sync_runs SET finished_at = now(), status = 'success',
         total_aft_candidatos = $2, total_matched = $3, total_cambiarian = $4, total_a_cero = $5,
         total_sin_cambio = $6, total_incidencias = $7, total_no_encontrados = $8
       WHERE id = $1`,
      [runId, candidatos.length, counters.matched, counters.cambiarian, counters.aCero, counters.sinCambio, counters.incidencias, counters.noEncontrados]
    );

    return { runId, totalCandidatos: candidatos.length, ...counters };
  } catch (e) {
    await pool.query(`UPDATE sync_runs SET finished_at = now(), status = 'error', error_message = $2 WHERE id = $1`, [runId, e.message]);
    throw e;
  }
}

async function registrarIncidencia(ref, ean, tipo, detalle) {
  await pool.query(
    `INSERT INTO incidencias (ref, ean, tipo, detalle) VALUES ($1,$2,$3,$4)`,
    [ref, ean, tipo, detalle]
  );
}

module.exports = { ingestAft, runInventorySync, getCandidatosConCoste };
