// Agente de rentabilidad — solo lectura hacia Shopify/AFT, escribe
// exclusivamente en hmt-db. Reutiliza el cálculo de coste/IVA/recargo ya
// validado en sync.js (calcularCosteYMargen) sin duplicarlo ni cambiarlo:
// solo añade transporte al cliente (configurable por categoría/producto/
// peso, nunca una tarifa única) y compara contra el PVP REAL de Shopify
// cuando existe, o el PVP de AFT como proyección cuando el producto todavía
// no está en Shopify (una oportunidad).
const { pool } = require('./db');
const { calcularCosteYMargen, normalizar, round2 } = require('./sync');

const MARGEN_BAJO_PCT = Number(process.env.RENTABILIDAD_MARGEN_BAJO_PCT) || 15;
const DIFERENCIA_COSTE_ALERTA_PCT = Number(process.env.RENTABILIDAD_DIFERENCIA_COSTE_PCT) || 20;
const BATCH_SIZE = 500;

async function cargarReglasTransporte() {
  const { rows } = await pool.query(`SELECT * FROM config_transporte_cliente WHERE activo = true`);
  return rows;
}

// Resuelve la tarifa de transporte AL CLIENTE para una referencia: excepción
// por ref > categoría > peso mínimo > valor por defecto (que puede incluir
// umbral de envío gratis). Nunca aplica una tarifa única a todo el catálogo.
function resolverTransporteCliente(ref, categoriaNombre, pesoGr, pvpReferencia, reglas) {
  function aplicar(regla, origen) {
    const gratis = regla.umbral_envio_gratis != null && pvpReferencia != null && Number(pvpReferencia) >= Number(regla.umbral_envio_gratis);
    return { tarifa: gratis ? 0 : Number(regla.tarifa), origen };
  }

  const reglaRef = reglas.find((r) => r.tipo === 'ref' && r.clave === ref);
  if (reglaRef) return aplicar(reglaRef, `ref:${ref}`);

  const categoriaNorm = normalizar(categoriaNombre);
  const reglaCategoria = reglas.find((r) => r.tipo === 'categoria' && categoriaNorm.indexOf(r.clave) !== -1);
  if (reglaCategoria) return aplicar(reglaCategoria, `categoria:${reglaCategoria.clave}`);

  const reglasPeso = reglas
    .filter((r) => r.tipo === 'peso_minimo' && pesoGr != null && Number(pesoGr) >= Number(r.umbral_peso_gr))
    .sort((a, b) => Number(b.umbral_peso_gr) - Number(a.umbral_peso_gr));
  if (reglasPeso.length) return aplicar(reglasPeso[0], `peso_minimo:${reglasPeso[0].clave}`);

  const reglaDefault = reglas.find((r) => r.tipo === 'default');
  if (reglaDefault) return aplicar(reglaDefault, 'default');

  return { tarifa: 0, origen: 'sin_regla_configurada' };
}

// Desglose completo de coste y rentabilidad estimada para una referencia.
// portes_proveedor_aft (aft_catalogo.portes) se calcula y se muestra, pero
// NO se suma al coste total: no está confirmado si ya viene incluido en
// aft_stock_precios.costo, así que sumarlo a ciegas podría duplicarlo.
function calcularFilaRentabilidad(row, reglas) {
  const base = calcularCosteYMargen(row);
  const pvpReal = row.shopify_price != null ? Number(row.shopify_price) : null;
  const pvpEsReal = pvpReal != null;
  const pvpReferencia = pvpEsReal ? pvpReal : base.precioVentaAFT;

  const transporte = resolverTransporteCliente(row.ref, row.categoria_nombre, row.peso_gr, pvpReferencia, reglas);
  const costeTotalEstimado = round2(base.costeDesembolsado + transporte.tarifa);

  const margenAbsoluto = pvpReferencia != null ? round2(pvpReferencia - costeTotalEstimado) : null;
  const margenPct = (pvpReferencia != null && pvpReferencia > 0) ? round2((margenAbsoluto / pvpReferencia) * 100) : null;

  const shopifyCost = row.shopify_cost != null ? Number(row.shopify_cost) : null;
  const diferenciaCosteShopify = shopifyCost != null ? round2(costeTotalEstimado - shopifyCost) : null;

  let estado = 'ok';
  if (margenPct == null) estado = 'sin_pvp';
  else if (margenPct < 0) estado = 'perdida';
  else if (margenPct < MARGEN_BAJO_PCT) estado = 'margen_bajo';

  return {
    ref: row.ref, marca: row.marca, descripcion: row.descripcion,
    coste_sin_iva: base.costeBase, iva_importe: base.ivaImporte, recargo_importe: base.recargoImporte,
    coste_con_impuestos: base.costeDesembolsado,
    portes_proveedor_aft: row.portes != null ? Number(row.portes) : null,
    transporte_cliente: transporte.tarifa, transporte_cliente_origen: transporte.origen,
    coste_total_estimado: costeTotalEstimado,
    pvp_real: pvpReferencia, pvp_es_real: pvpEsReal,
    margen_pct: margenPct, margen_absoluto: margenAbsoluto,
    shopify_cost: shopifyCost, diferencia_coste_shopify: diferenciaCosteShopify,
    estado_rentabilidad: estado
  };
}

async function registrarAlerta(ref, tipo, detalle, valor) {
  await pool.query(`INSERT INTO rentabilidad_alertas (ref, tipo, detalle, valor) VALUES ($1,$2,$3,$4)`, [ref, tipo, detalle, valor]);
}

const RESULT_COLS = [
  'ref', 'marca', 'descripcion', 'coste_sin_iva', 'iva_importe', 'recargo_importe', 'coste_con_impuestos',
  'portes_proveedor_aft', 'transporte_cliente', 'transporte_cliente_origen', 'coste_total_estimado',
  'pvp_real', 'pvp_es_real', 'margen_pct', 'margen_absoluto', 'shopify_cost', 'diferencia_coste_shopify', 'estado_rentabilidad'
];
function valoresResultado(f) { return RESULT_COLS.map((c) => (f[c] !== undefined ? f[c] : null)); }
function construirInsertResultados(numFilas) {
  const nCols = RESULT_COLS.length;
  const grupos = [];
  for (let i = 0; i < numFilas; i++) {
    const placeholders = RESULT_COLS.map((_, c) => `$${i * nCols + c + 1}`);
    grupos.push(`(${placeholders.join(',')}, now())`);
  }
  return `INSERT INTO rentabilidad_resultados (${RESULT_COLS.join(',')}, checked_at) VALUES ${grupos.join(', ')}`;
}

// Igual patrón que ya usan sync.js/ingestAft(): lotes con reintento fila a
// fila ante error, reemplazando la tabla entera solo cuando termina — es la
// foto de la última ejecución, no un historial (el historial vive en
// rentabilidad_alertas).
async function guardarResultadosEnLotes(filas) {
  await pool.query('DELETE FROM rentabilidad_resultados');
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += BATCH_SIZE) {
    const lote = filas.slice(i, i + BATCH_SIZE);
    try {
      await pool.query(construirInsertResultados(lote.length), lote.flatMap(valoresResultado));
      guardadas += lote.length;
    } catch (e) {
      console.error(`[rentabilidad] Fallo el lote de resultados (filas ${i}-${i + lote.length - 1}): ${e.message}. Reintentando fila a fila.`);
      for (const fila of lote) {
        try {
          await pool.query(construirInsertResultados(1), valoresResultado(fila));
          guardadas++;
        } catch (e2) {
          console.error(`[rentabilidad] Error SQL guardando resultado ref=${fila.ref}: ${e2.message}`);
        }
      }
    }
  }
  return guardadas;
}

// ---------------------------------------------------------------------------
// Ejecuta el análisis completo: coste desglosado + transporte configurado +
// margen real (PVP de Shopify) o proyectado (PVP de AFT, para oportunidades
// aún no publicadas) + alertas explicadas (pérdida, margen bajo, diferencia
// de coste con lo registrado en Shopify). Universo analizado: referencias
// con coincidencia fiable en Shopify (cambiaria/a_cero/sin_cambio) más
// oportunidades comerciales reales (no_encontrado + es_oportunidad_comercial)
// — no todo el catálogo AFT, solo lo que es accionable comercialmente.
// ---------------------------------------------------------------------------
async function ejecutarAnalisisRentabilidad(existingRunId) {
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE rentabilidad_runs SET fase = 'iniciando' WHERE id = $1`, [runId]);
  } else {
    const { rows } = await pool.query(`INSERT INTO rentabilidad_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`);
    runId = rows[0].id;
  }

  try {
    const reglas = await cargarReglasTransporte();

    const { rows } = await pool.query(`
      SELECT c.ref, c.ean, c.marca, c.descripcion_corta AS descripcion, c.categoria_nombre, c.peso_gr, c.portes,
             sp.stock, sp.costo, sp.pvp_sin_iva, c.por_iva,
             sm.shopify_price, sm.shopify_cost
      FROM aft_catalogo c
      JOIN aft_stock_precios sp ON sp.ref = c.ref
      JOIN shopify_match sm ON sm.ref = c.ref
      WHERE sm.estado IN ('cambiaria','a_cero','sin_cambio')
         OR (sm.estado = 'no_encontrado' AND sm.es_oportunidad_comercial = true)
    `);

    await pool.query(`UPDATE rentabilidad_runs SET fase = 'calculando', total_analizados = $2 WHERE id = $1`, [runId, rows.length]);

    const resultados = [];
    let enPerdida = 0, margenBajo = 0, diferenciaCoste = 0;

    for (const row of rows) {
      const fila = calcularFilaRentabilidad(row, reglas);
      resultados.push(fila);

      if (fila.estado_rentabilidad === 'perdida') {
        enPerdida++;
        await registrarAlerta(
          fila.ref, 'perdida',
          `${fila.ref}: margen estimado ${fila.margen_pct}% (coste total ${fila.coste_total_estimado}€ vs PVP ${fila.pvp_real}€${fila.pvp_es_real ? '' : ' proyectado de AFT, todavía sin coincidencia real en Shopify'}).`,
          fila.margen_pct
        );
      } else if (fila.estado_rentabilidad === 'margen_bajo') {
        margenBajo++;
        await registrarAlerta(
          fila.ref, 'margen_bajo',
          `${fila.ref}: margen estimado ${fila.margen_pct}%, por debajo del umbral configurado (${MARGEN_BAJO_PCT}%).`,
          fila.margen_pct
        );
      }

      if (fila.diferencia_coste_shopify != null && fila.coste_total_estimado > 0) {
        const diferenciaPct = round2((Math.abs(fila.diferencia_coste_shopify) / fila.coste_total_estimado) * 100);
        if (diferenciaPct >= DIFERENCIA_COSTE_ALERTA_PCT) {
          diferenciaCoste++;
          await registrarAlerta(
            fila.ref, 'diferencia_coste',
            `${fila.ref}: el coste registrado en Shopify (${fila.shopify_cost}€) difiere un ${diferenciaPct}% del coste total estimado (${fila.coste_total_estimado}€) — revisar si el coste de Shopify incluye IVA o está desactualizado, antes de confiar en la comparación.`,
            fila.diferencia_coste_shopify
          );
        }
      }
    }

    await pool.query(`UPDATE rentabilidad_runs SET fase = 'guardando' WHERE id = $1`, [runId]);
    const guardadas = await guardarResultadosEnLotes(resultados);

    const alertasTotal = enPerdida + margenBajo + diferenciaCoste;
    await pool.query(
      `UPDATE rentabilidad_runs SET status = 'success', finished_at = now(), fase = 'done',
         procesados = $2, en_perdida = $3, margen_bajo = $4, diferencia_coste = $5, alertas_total = $6
       WHERE id = $1`,
      [runId, guardadas, enPerdida, margenBajo, diferenciaCoste, alertasTotal]
    );

    return { runId, analizados: rows.length, guardados: guardadas, enPerdida, margenBajo, diferenciaCoste, alertasTotal };
  } catch (e) {
    await pool.query(
      `UPDATE rentabilidad_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = { ejecutarAnalisisRentabilidad, resolverTransporteCliente, calcularFilaRentabilidad };
