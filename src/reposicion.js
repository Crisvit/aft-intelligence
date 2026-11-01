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
const { notificarFallo } = require('./alertas');

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

// Clasifica el RESULTADO real de procesar un candidato — para contar. Pura,
// depende solo de lo que procesarCandidato ya decidió (r.tipo/escrito/error),
// nunca repite la clasificación del evento. El contador "actualizados" solo
// debe subir cuando escrito===true (una escritura real confirmada en
// Shopify); "simulado" es el cálculo en dry run, nunca se cuenta como
// actualización real.
//  - 'sin_cambios': el stock ya coincidía, no había nada que hacer.
//  - 'error': la escritura (o su verificación previa en vivo) falló.
//  - 'actualizado': escrito===true — hubo una escritura real en Shopify
//    (verificada o no; eso lo registra aparte verificaciones_fallidas).
//  - 'simulado': se calculó el cambio pero no se escribió (dry run).
function clasificarResultado(r) {
  if (r.tipo === 'sin_cambios') return 'sin_cambios';
  if (r.error) return 'error';
  if (r.escrito) return 'actualizado';
  return 'simulado';
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
    SELECT ref, ean, marca, shopify_variant_id, shopify_inventory_item_id, shopify_stock, stock_aft,
           shopify_product_title, matched_by, estado, checked_at,
           alerta_duplicado, alerta_multiples_ubicaciones, alerta_ubicacion_no_encontrada, bloquear_escritura
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
    ORDER BY
      -- Prioridad 2: AFT confirma 0 uds. y Shopify todavía la muestra como
      -- disponible — el caso más urgente (cliente puede comprar algo sin
      -- stock real) — va siempre primero, antes que cualquier otro caso.
      (CASE WHEN stock_aft = 0 AND shopify_stock > 0 THEN 0 ELSE 1 END),
      ABS(stock_aft - shopify_stock) DESC,
      ref
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

// Desglose de las referencias bloqueadas por motivo — para mostrarlas en el
// dashboard en vez de solo un total agregado. Los motivos NO son excluyentes
// entre sí (una fila puede tener varios a la vez, p. ej. duplicado Y sin
// inventory_item_id): cada número es "cuántas están bloqueadas AL MENOS por
// este motivo", no una partición. Mismo universo base que contarOmitidosPorAmbiguedad().
async function obtenerBloqueadosPorMotivo() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE matched_by NOT IN ('ean','sku') OR matched_by IS NULL)::int AS sin_match_fiable,
      COUNT(*) FILTER (WHERE alerta_duplicado = true)::int AS duplicado,
      COUNT(*) FILTER (WHERE alerta_multiples_ubicaciones = true)::int AS multiples_ubicaciones,
      COUNT(*) FILTER (WHERE alerta_ubicacion_no_encontrada = true)::int AS ubicacion_no_encontrada,
      COUNT(*) FILTER (WHERE bloquear_escritura = true)::int AS bloqueo_manual,
      COUNT(*) FILTER (WHERE shopify_inventory_item_id IS NULL)::int AS sin_inventory_item_id,
      COUNT(*) FILTER (WHERE shopify_stock IS NULL)::int AS sin_stock_shopify,
      COUNT(*) FILTER (WHERE stock_aft IS NULL)::int AS sin_stock_aft,
      COUNT(*) FILTER (WHERE stock_aft < 0)::int AS stock_aft_negativo
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
  return rows[0];
}

// Última ejecución de reposición con ESCRITURA REAL confirmada (no una
// simulación, no una ejecución real que no llegó a actualizar nada) — para
// mostrar en el dashboard "última sincronización efectiva" como algo
// distinto de "última ejecución" (que puede haber sido solo dry run).
async function obtenerUltimaReposicionEfectiva() {
  const { rows } = await pool.query(`
    SELECT id, finished_at, status, actualizados, verificaciones_fallidas, errores, modo, ref_solicitada
    FROM reposicion_runs
    WHERE dry_run = false AND actualizados > 0
    ORDER BY finished_at DESC
    LIMIT 1
  `);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Procesa UN candidato: decide el tipo de evento, escribe de verdad solo si
// escrituraRealActiva, y registra el evento. Única implementación de este
// camino — la usan tanto el lote completo como la actualización controlada
// de una sola referencia, para que la lógica de escritura/verificación
// nunca tenga dos copias que puedan divergir entre sí.
// ---------------------------------------------------------------------------
async function procesarCandidato(runId, fila, escrituraRealActiva, token) {
  const antesSnapshot = Number(fila.shopify_stock);
  const nuevo = Number(fila.stock_aft);
  const identidad = { ref: fila.ref, ean: fila.ean, marca: fila.marca, shopify_variant_id: fila.shopify_variant_id, shopify_inventory_item_id: fila.shopify_inventory_item_id };

  if (!escrituraRealActiva) {
    // Sin escritura real no hay riesgo de pisar una venta, así que se usa el
    // snapshot de la última sincronización — una lectura en vivo por cada
    // candidato de un dry run (potencialmente cientos) no aporta seguridad y
    // sí coste/cuota de API. El detalle deja explícito que NO es un dato en vivo.
    const tipo = clasificarEvento(antesSnapshot, nuevo);
    const base = { ...identidad, antes: antesSnapshot, nuevo, tipo };
    if (tipo === 'sin_cambios') {
      await registrarEvento(runId, { ...base, dry_run: true, escrito: false, verificado: null, detalle: 'El stock de Shopify (última sincronización) ya coincide con el de AFT — sin acción.' });
      return { tipo, escrito: false, verificado: null, error: false };
    }
    await registrarEvento(runId, {
      ...base, dry_run: true, escrito: false, verificado: null,
      detalle: 'DRY RUN: calculado con el stock de la última sincronización (no en vivo) porque la escritura real no está autorizada para este camino, o falta el scope write_inventory. No se escribió en Shopify.'
    });
    return { tipo, escrito: false, verificado: null, error: false };
  }

  // Escritura real: nunca se usa el snapshot de la última sincronización
  // como base del compare-and-set ni para decidir el tipo de evento — se lee
  // el stock disponible EN VIVO justo antes de escribir, para no sobrescribir
  // una venta u otro cambio ocurrido en Shopify después de la última
  // sincronización, y para no confundir una referencia que ya no exista en
  // Shopify con un "stock 0" legítimo.
  let antesVivo;
  try {
    antesVivo = await shopifyWrite.leerStockDisponible(token, { inventoryItemId: fila.shopify_inventory_item_id, locationId: MAIN_LOCATION_ID });
  } catch (e) {
    await registrarEvento(runId, { ...identidad, antes: antesSnapshot, nuevo, tipo: 'error', dry_run: false, escrito: false, verificado: null, detalle: `No se pudo leer el stock en vivo antes de escribir: ${e.message}` });
    return { tipo: 'error', escrito: false, verificado: null, error: true, mensaje: e.message };
  }
  if (antesVivo === null) {
    await registrarEvento(runId, {
      ...identidad, antes: antesSnapshot, nuevo, tipo: 'error', dry_run: false, escrito: false, verificado: null,
      detalle: 'La lectura en vivo previa a escribir no encontró el inventory item / la ubicación en Shopify — no se escribe, para no hacer un compare-and-set sobre un dato inexistente.'
    });
    return { tipo: 'error', escrito: false, verificado: null, error: true, mensaje: 'Lectura en vivo previa a la escritura no encontró el item/ubicación.' };
  }

  const tipo = clasificarEvento(antesVivo, nuevo);
  const base = { ...identidad, antes: antesVivo, nuevo, tipo };

  if (tipo === 'sin_cambios') {
    await registrarEvento(runId, { ...base, dry_run: false, escrito: false, verificado: null, detalle: 'El stock EN VIVO de Shopify (verificado justo antes de escribir) ya coincide con el de AFT — sin acción.' });
    return { tipo, escrito: false, verificado: null, error: false };
  }

  try {
    await shopifyWrite.establecerStockDisponible(token, {
      inventoryItemId: fila.shopify_inventory_item_id, locationId: MAIN_LOCATION_ID,
      cantidad: nuevo, cantidadEsperadaActual: antesVivo, motivo: 'cycle_count_available'
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

    const c = { actualizados: 0, simulados: 0, recuperados_stock_cero: 0, reposiciones_detectadas: 0, correcciones_a_la_baja: 0, sin_cambios: 0, errores: 0, verificaciones_fallidas: 0 };

    for (const fila of candidatos) {
      const r = await procesarCandidato(runId, fila, escrituraRealActiva, token);
      const resultado = clasificarResultado(r);

      if (resultado === 'sin_cambios') { c.sin_cambios++; continue; }
      if (resultado === 'error') { c.errores++; continue; }
      if (r.escrito && r.verificado === false) c.verificaciones_fallidas++;

      // 'actualizado' = escritura real confirmada en Shopify; 'simulado' =
      // solo calculado (dry run) — nunca se cuentan juntos como "actualizados".
      if (resultado === 'actualizado') c.actualizados++;
      else c.simulados++;

      if (r.tipo === 'producto_recuperado_stock_cero_negativo') c.recuperados_stock_cero++;
      else if (r.tipo === 'reposicion_detectada') c.reposiciones_detectadas++;
      else if (r.tipo === 'correccion_a_la_baja') c.correcciones_a_la_baja++;
    }

    // Una ejecución con escritura real activa que tuvo errores o escrituras
    // sin verificar NUNCA se reporta como 'success' — 'parcial' deja visible
    // que el día no quedó completamente sincronizado, sin ocultarlo.
    const huboFalloReal = escrituraRealActiva && (c.errores > 0 || c.verificaciones_fallidas > 0);
    const statusFinal = huboFalloReal ? 'parcial' : 'success';

    await pool.query(
      `UPDATE reposicion_runs SET status=$9, finished_at=now(), fase='done',
         actualizados=$2, recuperados_stock_cero=$3, reposiciones_detectadas=$4, correcciones_a_la_baja=$5,
         sin_cambios=$6, errores=$7, verificaciones_fallidas=$8, simulados=$10
       WHERE id=$1`,
      [runId, c.actualizados, c.recuperados_stock_cero, c.reposiciones_detectadas, c.correcciones_a_la_baja, c.sin_cambios, c.errores, c.verificaciones_fallidas, statusFinal, c.simulados]
    );

    if (huboFalloReal) {
      await notificarFallo({
        agente: 'reposicion',
        mensaje: `Sincronización parcial: ${c.errores} error(es) y ${c.verificaciones_fallidas} escritura(s) sin verificar, de ${candidatos.length} candidatos (${c.actualizados} actualizados de verdad). Revisar reposicion_eventos del run #${runId}.`,
        runId
      });
    }

    return { runId, dryRun: !escrituraRealActiva, status: statusFinal, totalCandidatos: candidatos.length, omitidosAmbiguos, ...c };
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
    const clasificacion = clasificarResultado(resultado);
    const verificacionFallida = resultado.escrito && resultado.verificado === false;
    const huboFalloReal = escrituraRealActiva && (clasificacion === 'error' || verificacionFallida);
    const statusFinal = huboFalloReal ? 'parcial' : 'success';

    await pool.query(
      `UPDATE reposicion_runs SET status=$9, finished_at=now(), fase='done',
         actualizados=$2, recuperados_stock_cero=$3, reposiciones_detectadas=$4, correcciones_a_la_baja=$5,
         sin_cambios=$6, errores=$7, verificaciones_fallidas=$8, simulados=$10
       WHERE id=$1`,
      [runId,
       clasificacion === 'actualizado' ? 1 : 0,
       resultado.tipo === 'producto_recuperado_stock_cero_negativo' ? 1 : 0,
       resultado.tipo === 'reposicion_detectada' ? 1 : 0,
       resultado.tipo === 'correccion_a_la_baja' ? 1 : 0,
       clasificacion === 'sin_cambios' ? 1 : 0,
       clasificacion === 'error' ? 1 : 0,
       verificacionFallida ? 1 : 0,
       statusFinal,
       clasificacion === 'simulado' ? 1 : 0]
    );

    if (huboFalloReal) {
      await notificarFallo({
        agente: 'reposicion (referencia única)',
        mensaje: `La actualización de la referencia "${refLimpia}" terminó con ${clasificacion === 'error' ? ('un error: ' + (resultado.mensaje || 'ver reposicion_eventos')) : 'una escritura sin verificar'}.`,
        runId
      });
    }

    return {
      runId, dryRun: !escrituraRealActiva, encontrada: true, ref: refLimpia, status: statusFinal,
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

// Mismo umbral que usa el dashboard (buildDashboardHtml.js,
// HORAS_LIMITE_DESACTUALIZADO) para marcar la última sincronización como
// desactualizada — duplicado aquí a propósito (nunca se importa HTML desde
// lógica de negocio) pero debe mantenerse igual en ambos sitios.
const HORAS_LIMITE_DESACTUALIZADO_PREVIEW = 26;

// ---------------------------------------------------------------------------
// Previsualización de reposición (prioridad: dashboard, solo lectura) —
// NUNCA escribe nada ni lanza ninguna ejecución; reutiliza exactamente el
// mismo filtro de fiabilidad que el lote real y la actualización de una
// referencia (obtenerCandidatos(), sin tocar su WHERE). Ordena por menor
// diferencia absoluta de stock y recorta a `limite` (10 por defecto).
// ---------------------------------------------------------------------------
async function previsualizarReposicion(limite) {
  const limiteSeguro = Math.min(Math.max(parseInt(limite, 10) || 10, 1), 50);

  const { rows: sincRows } = await pool.query(
    `SELECT started_at, finished_at, status FROM sync_runs ORDER BY id DESC LIMIT 1`
  );
  const ultimaSync = sincRows[0] || null;
  const datosDesactualizados = !ultimaSync || !ultimaSync.finished_at ||
    (Date.now() - new Date(ultimaSync.finished_at).getTime()) > HORAS_LIMITE_DESACTUALIZADO_PREVIEW * 3600000;

  // El mismo universo fiable que usaría una escritura real — nunca una
  // consulta distinta construida aparte para esta pantalla.
  const candidatosFiables = await obtenerCandidatos();

  const conDiferencia = candidatosFiables
    .filter((c) => Number(c.stock_aft) !== Number(c.shopify_stock))
    .map((c) => {
      const stockAft = Number(c.stock_aft);
      const stockShopify = Number(c.shopify_stock);
      return {
        ref: c.ref,
        nombre: c.shopify_product_title || null,
        ean: c.ean,
        matchedBy: c.matched_by, // 'ean' | 'sku' — qué identificador se usó para el cruce
        stockAft,
        stockShopify,
        diferencia: stockAft - stockShopify,
        tipoEvento: clasificarEvento(stockShopify, stockAft),
        checkedAt: c.checked_at,
        // Garantizado por el WHERE de obtenerCandidatos(), nunca asumido
        // aquí: alerta_multiples_ubicaciones y alerta_ubicacion_no_encontrada
        // se calculan en sync.js comparando contra SHOPIFY_MAIN_LOCATION_ID
        // — si cualquiera fuera true, esta fila ni siquiera llegaría aquí.
        ubicacionVerificada: true,
        alertas: {
          duplicado: c.alerta_duplicado,
          multiplesUbicaciones: c.alerta_multiples_ubicaciones,
          ubicacionNoEncontrada: c.alerta_ubicacion_no_encontrada,
          bloqueado: c.bloquear_escritura
        },
        // El sistema solo lee/escribe el bucket "available" de Shopify —
        // nunca ha comprobado committed/reserved ni pedidos pendientes.
        // Nunca "sin riesgo": se declara explícitamente sin verificar.
        reservasPendientes: 'No verificado'
      };
    })
    .sort((a, b) => Math.abs(a.diferencia) - Math.abs(b.diferencia));

  return {
    datosDesactualizados,
    horasLimiteDesactualizado: HORAS_LIMITE_DESACTUALIZADO_PREVIEW,
    ultimaSync: ultimaSync ? { finishedAt: ultimaSync.finished_at, status: ultimaSync.status } : null,
    ubicacionConfigurada: MAIN_LOCATION_ID,
    totalCandidatosFiables: candidatosFiables.length,
    totalConDiferencia: conDiferencia.length,
    candidatos: conDiferencia.slice(0, limiteSeguro)
  };
}

module.exports = {
  ejecutarReposicionStock,
  ejecutarReposicionUnaReferencia,
  previsualizarReposicion,
  clasificarEvento,
  clasificarResultado,
  obtenerCandidatos,
  contarOmitidosPorAmbiguedad,
  obtenerBloqueadosPorMotivo,
  obtenerUltimaReposicionEfectiva
};
