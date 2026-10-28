// Agente 2 — paso obligatorio de reposición automática de stock, añadido
// a continuación de la comparación Shopify <-> AFT (runInventorySync, en
// sync.js, que este archivo no modifica ni vuelve a invocar). Decide, para
// cada coincidencia FIABLE con diferencia de stock, si hay que actualizar
// la cantidad "available" de Shopify al último stock confirmado por AFT —
// y si está autorizado, la escribe de verdad; si no, solo la simula.
//
// DRY RUN por defecto: sin SHOPIFY_WRITE_ENABLED=true, o si la app no
// tiene el scope write_inventory concedido (comprobado en cada ejecución,
// nunca asumido ni cacheado), este agente SOLO CALCULA y REGISTRA lo que
// haría — nunca llama a Shopify para escribir. El único archivo con
// capacidad real de escritura es src/shopifyWriteClient.js.
const { pool } = require('./db');
const shopify = require('./shopifyClient');
const shopifyWrite = require('./shopifyWriteClient');

const SHOPIFY_WRITE_ENABLED = String(process.env.SHOPIFY_WRITE_ENABLED || '').toLowerCase() === 'true';
// Gate INDEPENDIENTE para la actualización controlada de una sola
// referencia (prioridad 3) — activar esta variable nunca activa el lote
// completo (ni al pulsar "Ejecutar reposición" ni en la ejecución diaria
// programada del pipeline), que sigue mirando solo SHOPIFY_WRITE_ENABLED.
const SHOPIFY_WRITE_UNA_REF_ENABLED = String(process.env.SHOPIFY_WRITE_UNA_REF_ENABLED || '').toLowerCase() === 'true';
const MAIN_LOCATION_ID = process.env.SHOPIFY_MAIN_LOCATION_ID || 'gid://shopify/Location/102229836040';

// Clasificación del cambio — puramente informativa para el historial, no
// cambia la decisión de escribir ni el valor escrito (siempre el stock_aft
// confirmado, como cantidad absoluta).
//  - 'producto_recuperado_stock_cero_negativo': Shopify estaba en 0 o
//    negativo y AFT confirma stock real > 0 — el caso más urgente.
//  - 'reposicion_detectada': Shopify ya tenía stock positivo, pero AFT
//    confirma más unidades de las que Shopify refleja.
//  - 'correccion_a_la_baja': AFT confirma MENOS unidades que Shopify
//    (incluido llegar a 0) — no es una reposición, es una corrección.
function clasificarEvento(antes, nuevo) {
  if (nuevo === antes) return 'sin_cambios';
  if (antes <= 0 && nuevo > 0) return 'producto_recuperado_stock_cero_negativo';
  if (nuevo > antes) return 'reposicion_detectada';
  return 'correccion_a_la_baja';
}

// stock_shopify_despues guarda siempre el valor objetivo (f.nuevo): lo ya
// escrito cuando escrito=true, o lo que se habría escrito (simulado en dry
// run, o lo que se intentó si hubo un error) — nunca se inventa un número
// distinto del que de verdad decidió la clasificación.
async function registrarEvento(runId, f) {
  await pool.query(
    `INSERT INTO reposicion_eventos
       (run_id, ref, ean, marca, shopify_variant_id, shopify_inventory_item_id,
        stock_shopify_antes, stock_aft, stock_shopify_despues, tipo_evento, dry_run, escrito, verificado, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [runId, f.ref, f.ean, f.marca, f.shopify_variant_id, f.shopify_inventory_item_id,
     f.antes, f.nuevo, f.nuevo,
     f.tipo, f.dry_run, f.escrito, f.verificado, f.detalle]
  );
}

// ---------------------------------------------------------------------------
// Universo: SOLO coincidencias fiables — emparejadas por EAN exacto o SKU
// inequívoco (matched_by), sin ninguna alerta de ambigüedad (duplicado,
// múltiples ubicaciones, ubicación no encontrada) y sin bloquear_escritura
// (ambas comprobaciones se solapan a propósito — más vale redundante que
// dejar pasar una coincidencia dudosa). Nunca se actualiza una referencia
// sin inventory_item_id real, sin stock de AFT, o con stock de AFT
// negativo (dato anómalo, no un "AFT confirma 0 unidades" legítimo).
// ---------------------------------------------------------------------------
// refFiltro (opcional): restringe el universo a una única referencia AFT,
// usado por la actualización controlada de una sola referencia. Con el
// mismo WHERE que el lote completo — una ref que no cumple estos
// requisitos de fiabilidad nunca es candidata, tampoco a título individual.
async function obtenerCandidatos(refFiltro) {
  const params = [];
  let filtroRef = '';
  if (refFiltro) {
    params.push(refFiltro);
    filtroRef = `AND ref = $${params.length}`;
  }
  const { rows } = await pool.query(`
    SELECT ref, ean, marca, shopify_variant_id, shopify_inventory_item_id, shopify_stock, stock_aft
    FROM shopify_match
    WHERE estado IN ('cambiaria','a_cero','sin_cambio')
      AND matched_by IN ('ean','sku')
      AND alerta_duplicado = false
      AND alerta_multiples_ubicaciones = false
      AND alerta_ubicacion_no_encontrada = false
      AND bloquear_escritura = false
      AND shopify_inventory_item_id IS NOT NULL
      AND shopify_stock IS NOT NULL
      AND stock_aft IS NOT NULL
      AND stock_aft >= 0
      ${filtroRef}
  `, params);
  return rows;
}

async function contarOmitidosPorAmbiguedad() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM shopify_match
    WHERE estado IN ('cambiaria','a_cero','sin_cambio')
      AND (
        matched_by NOT IN ('ean','sku') OR matched_by IS NULL
        OR alerta_duplicado = true OR alerta_multiples_ubicaciones = true OR alerta_ubicacion_no_encontrada = true
        OR bloquear_escritura = true
        OR shopify_inventory_item_id IS NULL OR shopify_stock IS NULL
        OR stock_aft IS NULL OR stock_aft < 0
      )
  `);
  return rows[0].n;
}

// ---------------------------------------------------------------------------
// Procesa UN candidato: decide el tipo de evento, escribe de verdad solo si
// escrituraRealActiva, y registra el evento. Única implementación de este
// camino — la usan tanto el lote completo como la actualización controlada
// de una sola referencia, para que la lógica de escritura/verificación
// nunca tenga dos copias que puedan divergir entre sí.
// ---------------------------------------------------------------------------
async function procesarCandidato(runId, fila, escrituraRealActiva, token) {
  const antes = Number(fila.shopify_stock);
  const nuevo = Number(fila.stock_aft);
  const tipo = clasificarEvento(antes, nuevo);
  const base = { ref: fila.ref, ean: fila.ean, marca: fila.marca, shopify_variant_id: fila.shopify_variant_id, shopify_inventory_item_id: fila.shopify_inventory_item_id, antes, nuevo, tipo };

  if (tipo === 'sin_cambios') {
    await registrarEvento(runId, { ...base, dry_run: !escrituraRealActiva, escrito: false, verificado: null, detalle: 'El stock de Shopify ya coincide con el de AFT — sin acción.' });
    return { tipo, escrito: false, verificado: null, error: false };
  }

  if (!escrituraRealActiva) {
    await registrarEvento(runId, {
      ...base, dry_run: true, escrito: false, verificado: null,
      detalle: 'DRY RUN: se calculó la actualización pero no se escribió en Shopify (la escritura real no está autorizada para este camino, o falta el scope write_inventory).'
    });
    return { tipo, escrito: false, verificado: null, error: false };
  }

  try {
    await shopifyWrite.establecerStockDisponible(token, {
      inventoryItemId: fila.shopify_inventory_item_id, locationId: MAIN_LOCATION_ID,
      cantidad: nuevo, cantidadEsperadaActual: antes, motivo: 'cycle_count_available'
    });
    const leido = await shopifyWrite.leerStockDisponible(token, { inventoryItemId: fila.shopify_inventory_item_id, locationId: MAIN_LOCATION_ID });
    const verificado = leido === nuevo;
    await registrarEvento(runId, {
      ...base, dry_run: false, escrito: true, verificado,
      detalle: verificado
        ? 'Escrito en Shopify y verificado con una lectura posterior.'
        : `Escrito en Shopify, pero la lectura posterior devolvió ${leido} en vez de ${nuevo} — revisar manualmente.`
    });
    return { tipo, escrito: true, verificado, error: false };
  } catch (e) {
    await registrarEvento(runId, { ...base, dry_run: false, escrito: false, verificado: null, tipo: 'error', detalle: e.message });
    return { tipo: 'error', escrito: false, verificado: null, error: true, mensaje: e.message };
  }
}

// ---------------------------------------------------------------------------
// Ejecuta el paso de reposición. existingRunId permite encadenarlo justo
// después de una sincronización (mismo patrón que el resto de agentes).
// ---------------------------------------------------------------------------
async function ejecutarReposicionStock(existingRunId) {
  const dryRunPrevisto = !SHOPIFY_WRITE_ENABLED;
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE reposicion_runs SET fase = 'iniciando', dry_run = $2 WHERE id = $1`, [runId, dryRunPrevisto]);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO reposicion_runs (status, fase, dry_run) VALUES ('running','iniciando',$1) RETURNING id`,
      [dryRunPrevisto]
    );
    runId = rows[0].id;
  }

  try {
    let token = null;
    let scopeOk = false;
    if (SHOPIFY_WRITE_ENABLED) {
      token = await shopify.getShopifyToken();
      scopeOk = await shopifyWrite.tieneScopeEscrituraInventario(token);
      if (!scopeOk) {
        console.error('[reposicion] SHOPIFY_WRITE_ENABLED=true pero la app no tiene concedido el scope write_inventory — se queda en modo simulación (dry run).');
      }
    }
    const escrituraRealActiva = SHOPIFY_WRITE_ENABLED && scopeOk;
    await pool.query(`UPDATE reposicion_runs SET dry_run = $2 WHERE id = $1`, [runId, !escrituraRealActiva]);

    const candidatos = await obtenerCandidatos();
    const omitidosAmbiguos = await contarOmitidosPorAmbiguedad();

    await pool.query(`UPDATE reposicion_runs SET fase = 'procesando', total_candidatos = $2 WHERE id = $1`, [runId, candidatos.length]);

    const c = { actualizados: 0, recuperados_stock_cero: 0, reposiciones_detectadas: 0, correcciones_a_la_baja: 0, sin_cambios: 0, errores: 0, verificaciones_fallidas: 0 };

    for (const fila of candidatos) {
      const r = await procesarCandidato(runId, fila, escrituraRealActiva, token);

      if (r.tipo === 'sin_cambios') { c.sin_cambios++; continue; }
      if (r.error) { c.errores++; continue; }
      if (r.escrito && r.verificado === false) c.verificaciones_fallidas++;

      c.actualizados++;
      if (r.tipo === 'producto_recuperado_stock_cero_negativo') c.recuperados_stock_cero++;
      else if (r.tipo === 'reposicion_detectada') c.reposiciones_detectadas++;
      else if (r.tipo === 'correccion_a_la_baja') c.correcciones_a_la_baja++;
    }

    await pool.query(
      `UPDATE reposicion_runs SET status='success', finished_at=now(), fase='done',
         actualizados=$2, recuperados_stock_cero=$3, reposiciones_detectadas=$4, correcciones_a_la_baja=$5,
         sin_cambios=$6, errores=$7, verificaciones_fallidas=$8
       WHERE id=$1`,
      [runId, c.actualizados, c.recuperados_stock_cero, c.reposiciones_detectadas, c.correcciones_a_la_baja, c.sin_cambios, c.errores, c.verificaciones_fallidas]
    );

    return { runId, dryRun: !escrituraRealActiva, totalCandidatos: candidatos.length, omitidosAmbiguos, ...c };
  } catch (e) {
    await pool.query(
      `UPDATE reposicion_runs SET status='error', finished_at=now(), fase='error', error_message=$2 WHERE id=$1`,
      [runId, e.message]
    );
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Actualización controlada de UNA sola referencia (prioridad 3) — para
// validar una escritura real contra producción sin activar el lote
// completo. Usa su propio gate (SHOPIFY_WRITE_UNA_REF_ENABLED), nunca
// SHOPIFY_WRITE_ENABLED: activarlo no hace que el lote diario (botón,
// POST /api/reposicion-run, ni el pipeline programado) empiece a escribir.
// Reutiliza exactamente el mismo filtro de fiabilidad (obtenerCandidatos)
// y la misma función de escritura/verificación (procesarCandidato) que el
// lote — una referencia que no sea candidata fiable nunca se toca, igual
// que en el lote completo.
// ---------------------------------------------------------------------------
async function ejecutarReposicionUnaReferencia(ref, iniciadoPor) {
  if (!ref || typeof ref !== 'string' || !ref.trim()) {
    throw new Error('Falta ref (referencia AFT) para la actualización controlada de una sola referencia.');
  }
  const refLimpia = ref.trim();
  const dryRunPrevisto = !SHOPIFY_WRITE_UNA_REF_ENABLED;

  const { rows } = await pool.query(
    `INSERT INTO reposicion_runs (status, fase, dry_run, modo, ref_solicitada, iniciado_por)
     VALUES ('running','iniciando',$1,'referencia_unica',$2,$3) RETURNING id`,
    [dryRunPrevisto, refLimpia, iniciadoPor || null]
  );
  const runId = rows[0].id;

  try {
    let token = null;
    let scopeOk = false;
    if (SHOPIFY_WRITE_UNA_REF_ENABLED) {
      token = await shopify.getShopifyToken();
      scopeOk = await shopifyWrite.tieneScopeEscrituraInventario(token);
      if (!scopeOk) {
        console.error('[reposicion] SHOPIFY_WRITE_UNA_REF_ENABLED=true pero la app no tiene concedido el scope write_inventory — se queda en modo simulación (dry run).');
      }
    }
    const escrituraRealActiva = SHOPIFY_WRITE_UNA_REF_ENABLED && scopeOk;
    await pool.query(`UPDATE reposicion_runs SET dry_run = $2 WHERE id = $1`, [runId, !escrituraRealActiva]);

    const candidatos = await obtenerCandidatos(refLimpia);
    await pool.query(`UPDATE reposicion_runs SET fase = 'procesando', total_candidatos = $2 WHERE id = $1`, [runId, candidatos.length]);

    if (candidatos.length === 0) {
      const motivo = `La referencia "${refLimpia}" no es una coincidencia fiable pendiente de actualizar ahora mismo (no existe en la última comparación, el stock ya coincide, o tiene alguna alerta de ambigüedad) — no se ha tocado nada.`;
      await pool.query(
        `UPDATE reposicion_runs SET status='success', finished_at=now(), fase='done', error_message=$2 WHERE id=$1`,
        [runId, motivo]
      );
      return { runId, dryRun: !escrituraRealActiva, encontrada: false, ref: refLimpia, motivo };
    }

    const resultado = await procesarCandidato(runId, candidatos[0], escrituraRealActiva, token);
    const verificacionFallida = resultado.escrito && resultado.verificado === false;

    await pool.query(
      `UPDATE reposicion_runs SET status='success', finished_at=now(), fase='done',
         actualizados=$2, recuperados_stock_cero=$3, reposiciones_detectadas=$4, correcciones_a_la_baja=$5,
         sin_cambios=$6, errores=$7, verificaciones_fallidas=$8
       WHERE id=$1`,
      [runId,
       (!resultado.error && resultado.tipo !== 'sin_cambios') ? 1 : 0,
       resultado.tipo === 'producto_recuperado_stock_cero_negativo' ? 1 : 0,
       resultado.tipo === 'reposicion_detectada' ? 1 : 0,
       resultado.tipo === 'correccion_a_la_baja' ? 1 : 0,
       resultado.tipo === 'sin_cambios' ? 1 : 0,
       resultado.error ? 1 : 0,
       verificacionFallida ? 1 : 0]
    );

    return {
      runId, dryRun: !escrituraRealActiva, encontrada: true, ref: refLimpia,
      tipo: resultado.tipo, escrito: resultado.escrito, verificado: resultado.verificado, error: resultado.error
    };
  } catch (e) {
    await pool.query(
      `UPDATE reposicion_runs SET status='error', finished_at=now(), fase='error', error_message=$2 WHERE id=$1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = { ejecutarReposicionStock, ejecutarReposicionUnaReferencia, clasificarEvento };
