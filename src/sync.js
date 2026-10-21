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
const SHOPIFY_PAGE_SIZE = Number(process.env.SHOPIFY_VARIANTS_PAGE_SIZE) || 25;

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const BATCH_SIZE = 500;

// Dedup determinista: gana la primera aparición. Para cada clave repetida
// se registra si la fila descartada era idéntica a la que se conservó, o
// si difería (en cuyo caso conviene revisar manualmente vía incidencias).
function dedupPorClave(lista, claveFn) {
  const vistos = new Map();
  const resultado = [];
  const duplicados = [];
  for (const item of lista) {
    const clave = claveFn(item);
    if (clave === null || clave === undefined || String(clave).trim() === '') continue;
    if (vistos.has(clave)) {
      const idéntico = JSON.stringify(vistos.get(clave)) === JSON.stringify(item);
      duplicados.push({ clave, idéntico });
      continue;
    }
    vistos.set(clave, item);
    resultado.push(item);
  }
  return { resultado, duplicados };
}

// Construye un INSERT ... ON CONFLICT ... DO UPDATE multi-fila para `numFilas`
// filas de `columnas` columnas, añadiendo una columna de timestamp final con now().
function construirInsertMultiple(tabla, columnas, conflictCol, numFilas, colTimestamp) {
  const nCols = columnas.length;
  const grupos = [];
  for (let i = 0; i < numFilas; i++) {
    const placeholders = columnas.map((_, c) => `$${i * nCols + c + 1}`);
    grupos.push(`(${placeholders.join(',')}, now())`);
  }
  const setClause = columnas
    .filter((c) => c !== conflictCol)
    .map((c) => `${c}=EXCLUDED.${c}`)
    .join(', ');
  return `INSERT INTO ${tabla} (${columnas.join(',')}, ${colTimestamp})
          VALUES ${grupos.join(', ')}
          ON CONFLICT (${conflictCol}) DO UPDATE SET ${setClause}, ${colTimestamp}=now()`;
}

const COLS_CATEGORIAS = ['id_categoria', 'nombre', 'padre', 'url_img'];
function valoresCategoria(c) {
  return [String(c.id), c.nombre, c.padre != null ? String(c.padre) : null, c.urL_IMG_CAT || c.url_img || null];
}

const COLS_PRODUCTOS = [
  'ref', 'ean', 'marca', 'categoria_id', 'categoria_nombre', 'descripcion_corta', 'descripcion_larga',
  'peso_gr', 'alto_cm', 'ancho_cm', 'largo_cm', 'portes', 'tipo_iva', 'por_iva'
];
function valoresProducto(p, catNombreMap) {
  return [
    p.ref, p.ean, p.marca, p.categorias != null ? String(p.categorias) : null,
    catNombreMap[String(p.categorias)] || null, p.descripcioN_CORTA, p.descripcioN_LARGA,
    p.pesO_GR, p.altO_CM, p.anchO_CM, p.largO_CM, p.portes, p.tipO_IVA, p.poR_IVA
  ];
}

const COLS_STOCK = ['ref', 'costo', 'pvp_sin_iva', 'stock', 'fecha_ultimo_cambio_aft'];
function valoresStock(s) {
  const pvpSinIva = s.pvP_SINIVA != null ? s.pvP_SINIVA : s.pvp_siniva;
  return [s.ref, s.costo, pvpSinIva, s.stock, s.fechA_ULTIMO_CAMBIO ? new Date(s.fechA_ULTIMO_CAMBIO) : null];
}

async function actualizarProgresoImport(runId, campos) {
  if (!runId) return;
  const claves = Object.keys(campos);
  if (claves.length === 0) return;
  const sets = claves.map((k, i) => `${k}=$${i + 2}`).join(', ');
  await pool.query(`UPDATE aft_import_runs SET ${sets} WHERE id=$1`, [runId, ...claves.map((k) => campos[k])]);
}

// Procesa `items` en lotes de BATCH_SIZE con upsert multi-fila. Si un lote
// falla (una fila con dato inválido, violación de tipo, etc.), ese lote se
// reintenta fila a fila para aislar e identificar exactamente cuál falla,
// sin perder el resto de filas correctas del lote ni de los lotes ya
// confirmados. Cada lote/fila vive en su propia transacción corta: nunca
// hay una única transacción gigante que pueda hacer ROLLBACK de todo.
async function procesarEnLotes(client, items, { tabla, columnas, conflictCol, colTimestamp, valoresFn, claveErrorFn, tipo, runId, campoInsertados }) {
  let insertados = 0;
  let erroresSql = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const lote = items.slice(i, i + BATCH_SIZE);
    await client.query('BEGIN');
    try {
      const sql = construirInsertMultiple(tabla, columnas, conflictCol, lote.length, colTimestamp);
      await client.query(sql, lote.flatMap(valoresFn));
      await client.query('COMMIT');
      insertados += lote.length;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[ingestAft] Fallo el lote de ${tipo} (filas ${i}-${i + lote.length - 1}): ${e.message}. Reintentando fila a fila.`);
      for (const item of lote) {
        await client.query('BEGIN');
        try {
          const sqlUna = construirInsertMultiple(tabla, columnas, conflictCol, 1, colTimestamp);
          await client.query(sqlUna, valoresFn(item));
          await client.query('COMMIT');
          insertados++;
        } catch (e2) {
          await client.query('ROLLBACK');
          erroresSql++;
          const clave = claveErrorFn(item);
          console.error(`[ingestAft] Error SQL en ${tipo} (${clave}): ${e2.message}`);
          await registrarIncidencia(clave, null, `error_sql_${tipo}`, e2.message);
        }
      }
    }
    await actualizarProgresoImport(runId, { fase: tipo, [campoInsertados]: insertados });
  }
  return { insertados, erroresSql };
}

// ---------------------------------------------------------------------------
// 1. Ingesta AFT (catálogo, categorías, stock/precios) -> hmt-db
//
// Diseño (ver incidencias.tipo para el detalle de cada caso detectado):
// - Deduplicación determinista por ref/id (gana la primera aparición),
//   igual para categorías, productos y stock; cada duplicado queda
//   registrado como incidencia, se conserven o no datos idénticos.
// - Las filas de stock cuya ref no tiene producto correspondiente en el
//   catálogo ya deduplicado se omiten (no violan la FK) pero se registran
//   como incidencia conservando la ref original.
// - Inserción por lotes (BATCH_SIZE) con upsert, en vez de una única
//   transacción gigante: un lote o fila con error no hace ROLLBACK de las
//   filas ya confirmadas, y los reintentos son seguros (upsert idempotente).
// - Si se pasa `runId`, el progreso se va escribiendo en aft_import_runs
//   para que el dashboard pueda mostrarlo mientras corre en segundo plano.
// ---------------------------------------------------------------------------
async function ingestAft(runId) {
  await actualizarProgresoImport(runId, { fase: 'descargando' });

  const token = await aft.getAftToken();
  const [categorias, productos, stockPrecios] = await Promise.all([
    aft.getCategorias(token),
    aft.getProductos(token),
    aft.getStockPrecios(token)
  ]);

  const catList = Array.isArray(categorias) ? categorias : (categorias.items || categorias.data || []);
  const prodList = Array.isArray(productos) ? productos : (productos.items || productos.data || []);
  const stockList = Array.isArray(stockPrecios) ? stockPrecios : (stockPrecios.items || stockPrecios.data || []);

  const { resultado: catDedup, duplicados: catDup } = dedupPorClave(catList, (c) => (c.id != null ? String(c.id) : null));
  const { resultado: prodDedup, duplicados: prodDup } = dedupPorClave(prodList, (p) => p.ref);
  const { resultado: stockDedup, duplicados: stockDup } = dedupPorClave(stockList, (s) => s.ref);

  for (const d of catDup) {
    await registrarIncidencia(null, null, 'categoria_duplicada', `id_categoria=${d.clave} duplicado en la respuesta de AFT (${d.idéntico ? 'datos idénticos, se ignoró la repetición' : 'datos distintos, se conservó la primera aparición'})`);
  }
  for (const d of prodDup) {
    await registrarIncidencia(d.clave, null, 'producto_duplicado', `ref=${d.clave} duplicado en el catálogo AFT (${d.idéntico ? 'datos idénticos, se ignoró la repetición' : 'datos distintos, se conservó la primera aparición'})`);
  }
  for (const d of stockDup) {
    await registrarIncidencia(d.clave, null, 'stock_duplicado', `ref=${d.clave} duplicado en stock/precios AFT (${d.idéntico ? 'datos idénticos, se ignoró la repetición' : 'datos distintos, se conservó la primera aparición'})`);
  }

  const refsValidos = new Set(prodDedup.map((p) => p.ref));
  const stockValido = [];
  const stockHuerfano = [];
  for (const s of stockDedup) {
    if (refsValidos.has(s.ref)) stockValido.push(s);
    else stockHuerfano.push(s);
  }
  for (const s of stockHuerfano) {
    await registrarIncidencia(s.ref, null, 'stock_sin_correspondencia', `Fila de stock con ref=${s.ref} no tiene producto correspondiente en el catálogo; se omite su importación pero se conserva la ref en esta incidencia.`);
  }

  const catNombreMap = {};
  for (const c of catDedup) catNombreMap[String(c.id)] = normalizar(c.nombre);

  await actualizarProgresoImport(runId, {
    fase: 'categorias',
    total_categorias: catDedup.length,
    categorias_duplicadas: catDup.length,
    total_productos: prodDedup.length,
    productos_duplicados: prodDup.length,
    total_stock: stockValido.length,
    stock_duplicado: stockDup.length,
    stock_huerfano: stockHuerfano.length,
    incidencias: catDup.length + prodDup.length + stockDup.length + stockHuerfano.length
  });

  const client = await pool.connect();
  let categoriasResult, productosResult, stockResult;
  try {
    categoriasResult = await procesarEnLotes(client, catDedup, {
      tabla: 'aft_categorias', columnas: COLS_CATEGORIAS, conflictCol: 'id_categoria', colTimestamp: 'ultima_sync',
      valoresFn: valoresCategoria, claveErrorFn: (c) => `id_categoria=${c.id}`, tipo: 'categorias', runId, campoInsertados: 'categorias_insertadas'
    });

    await actualizarProgresoImport(runId, { fase: 'productos' });
    productosResult = await procesarEnLotes(client, prodDedup, {
      tabla: 'aft_catalogo', columnas: COLS_PRODUCTOS, conflictCol: 'ref', colTimestamp: 'ultima_sync',
      valoresFn: (p) => valoresProducto(p, catNombreMap), claveErrorFn: (p) => `ref=${p.ref}`, tipo: 'productos', runId, campoInsertados: 'productos_insertados'
    });

    await actualizarProgresoImport(runId, { fase: 'stock' });
    stockResult = await procesarEnLotes(client, stockValido, {
      tabla: 'aft_stock_precios', columnas: COLS_STOCK, conflictCol: 'ref', colTimestamp: 'ultima_actualizacion_local',
      valoresFn: valoresStock, claveErrorFn: (s) => `ref=${s.ref}`, tipo: 'stock', runId, campoInsertados: 'stock_insertado'
    });
  } finally {
    client.release();
  }

  const totalErroresSql = categoriasResult.erroresSql + productosResult.erroresSql + stockResult.erroresSql;
  const totalIncidencias = catDup.length + prodDup.length + stockDup.length + stockHuerfano.length + totalErroresSql;

  await actualizarProgresoImport(runId, {
    fase: 'done',
    categorias_insertadas: categoriasResult.insertados,
    productos_insertados: productosResult.insertados,
    stock_insertado: stockResult.insertados,
    errores_sql: totalErroresSql,
    incidencias: totalIncidencias
  });

  return {
    categorias: { recibidos: catList.length, insertados: categoriasResult.insertados, duplicados: catDup.length },
    productos: { recibidos: prodList.length, insertados: productosResult.insertados, duplicados: prodDup.length },
    stockPrecios: { recibidos: stockList.length, insertados: stockResult.insertados, duplicados: stockDup.length, sinCorrespondencia: stockHuerfano.length },
    erroresSql: totalErroresSql,
    incidencias: totalIncidencias
  };
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

// Acumula las variantes de una página de getAllVariants() en dos mapas
// (por barcode y por sku), cada clave con un array de nodos — igual que una
// respuesta de búsqueda de Shopify con varias coincidencias, para poder
// seguir detectando ambigüedad (edges.length > 1) exactamente igual que antes.
function indexarVariantes(edges, mapaPorBarcode, mapaPorSku) {
  for (const edge of edges) {
    const node = edge.node;
    if (node.barcode != null && String(node.barcode).trim() !== '') {
      const clave = String(node.barcode).trim();
      if (!mapaPorBarcode.has(clave)) mapaPorBarcode.set(clave, []);
      mapaPorBarcode.get(clave).push(node);
    }
    if (node.sku != null && String(node.sku).trim() !== '') {
      const clave = String(node.sku).trim();
      if (!mapaPorSku.has(clave)) mapaPorSku.set(clave, []);
      mapaPorSku.get(clave).push(node);
    }
  }
}

// Da a combinarConShopify() la misma forma de datos que ya espera (un
// resultado GraphQL de productVariants con edges), pero construida a partir
// del mapa en memoria en vez de una búsqueda de red por referencia. Así
// combinarConShopify() no se modifica.
function edgesDesdeMapa(mapa, clave) {
  const nodos = (clave != null ? mapa.get(String(clave).trim()) : null) || [];
  return { data: { productVariants: { edges: nodos.map((node) => ({ node })) } } };
}

// ---------------------------------------------------------------------------
// 4. Ejecuta la comparación completa AFT <-> Shopify (SOLO LECTURA) y guarda
//    el resultado (diferencias + incidencias + resumen) en hmt-db.
//
// La lectura de Shopify ya no es una búsqueda por cada referencia AFT: se
// pagina UNA VEZ todo productVariants (ver shopify.getAllVariants) y se
// indexa en memoria por barcode/sku. El matching contra AFT nunca se
// considera definitivo hasta que esa paginación termina del todo
// (hasNextPage = false en la última página) — si falla a mitad, el run se
// marca como error y no se toca shopify_match con datos parciales.
// ---------------------------------------------------------------------------
async function runInventorySync(existingRunId) {
  const startedAt = new Date();
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE sync_runs SET fase = 'leyendo_shopify' WHERE id = $1`, [runId]);
  } else {
    const { rows: runRows } = await pool.query(
      `INSERT INTO sync_runs (started_at, status, fase) VALUES ($1, 'running', 'leyendo_shopify') RETURNING id`,
      [startedAt]
    );
    runId = runRows[0].id;
  }

  const counters = { matched: 0, cambiarian: 0, aCero: 0, sinCambio: 0, incidencias: 0, noEncontrados: 0 };

  try {
    await ingestAft();
    const candidatos = await getCandidatosConCoste();
    const shopifyToken = await shopify.getShopifyToken();

    const mapaPorBarcode = new Map();
    const mapaPorSku = new Map();

    const lectura = await shopify.getAllVariants(shopifyToken, {
      pageSize: SHOPIFY_PAGE_SIZE,
      onPage: async (edges, info) => {
        indexarVariantes(edges, mapaPorBarcode, mapaPorSku);
        await pool.query(
          `UPDATE sync_runs SET shopify_paginas_leidas = $2, shopify_variantes_leidas = $3 WHERE id = $1`,
          [runId, info.pagina, info.totalVariantes]
        );
      }
    });

    if (lectura.permisosFaltantes.length) {
      await pool.query(
        `UPDATE sync_runs SET permisos_incompletos = true, permisos_detalle = $2 WHERE id = $1`,
        [runId, lectura.permisosFaltantes.join(' | ').slice(0, 2000)]
      );
      for (const detalle of lectura.permisosFaltantes) {
        await registrarIncidencia(null, null, 'permiso_shopify_faltante', detalle);
        counters.incidencias++;
      }
    }

    // Lectura de Shopify completa y confirmada (getAllVariants solo devuelve
    // el control cuando pageInfo.hasNextPage ha sido false) — a partir de
    // aquí el matching ya puede considerarse definitivo.
    await pool.query(
      `UPDATE sync_runs SET fase = 'comparando', shopify_lectura_completa = true WHERE id = $1`,
      [runId]
    );

    await pool.query('DELETE FROM shopify_match');

    for (const fuente of candidatos) {
      if (fuente.stockNegativo) {
        await registrarIncidencia(fuente.ref, fuente.ean, 'stock_negativo', `AFT reporta stock ${fuente.stock} para ref ${fuente.ref}`);
        counters.incidencias++;
        continue;
      }

      let resultado = combinarConShopify(fuente, edgesDesdeMapa(mapaPorBarcode, fuente.ean), 'ean');

      if (!resultado) {
        // Fallback por SKU/referencia, solo cuando el EAN no encontró nada.
        resultado = combinarConShopify(fuente, edgesDesdeMapa(mapaPorSku, fuente.ref), 'sku');
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
      `UPDATE sync_runs SET finished_at = now(), status = 'success', fase = 'done',
         total_aft_candidatos = $2, total_matched = $3, total_cambiarian = $4, total_a_cero = $5,
         total_sin_cambio = $6, total_incidencias = $7, total_no_encontrados = $8
       WHERE id = $1`,
      [runId, candidatos.length, counters.matched, counters.cambiarian, counters.aCero, counters.sinCambio, counters.incidencias, counters.noEncontrados]
    );

    return {
      runId, totalCandidatos: candidatos.length,
      shopify: { paginas: lectura.paginas, variantesLeidas: lectura.totalVariantes, lecturaCompleta: true, permisosFaltantes: lectura.permisosFaltantes },
      ...counters
    };
  } catch (e) {
    await pool.query(
      `UPDATE sync_runs SET finished_at = now(), status = 'error', fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
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
