// Agente de rentabilidad — solo lectura hacia Shopify/AFT, escribe
// exclusivamente en hmt-db. Reutiliza el cálculo de coste/IVA/recargo ya
// validado en sync.js (calcularCosteYMargen) sin duplicarlo ni cambiarlo.
//
// Transporte: AFT da un coste de portes REAL por referencia
// (aft_catalogo.portes), confirmado con datos reales (escaleras, andamios,
// accesorios...) — ya no se asume una tarifa fija ni propia cuando AFT
// envía directo al cliente. La tarifa configurable por categoría/peso/
// default (config_transporte_cliente) queda como respaldo SOLO para
// referencias sin un valor de portes válido, para no sumar transporte
// propio cuando AFT ya cobra el suyo (evita duplicarlo).
const { pool } = require('./db');
const { calcularCosteYMargen, normalizar, round2 } = require('./sync');

const MARGEN_BAJO_PCT = Number(process.env.RENTABILIDAD_MARGEN_BAJO_PCT) || 15;
const DIFERENCIA_COSTE_ALERTA_PCT = Number(process.env.RENTABILIDAD_DIFERENCIA_COSTE_PCT) || 20;
// Comisión de venta — SIN configurar por defecto (0%): no se inventa un
// porcentaje. Se queda en 0€ hasta que se confirme una tarifa real.
const COMISION_VENTA_PCT = Number(process.env.RENTABILIDAD_COMISION_VENTA_PCT) || 0;
// PVP por debajo del cual un producto con margen suficiente se marca como
// candidato a venta complementaria (complemento de compra), no venta
// individual destacada. Configurable, con un valor de partida razonable —
// nunca decide coste ni margen, solo clasifica.
const PVP_COMPLEMENTO_MAX = Number(process.env.RENTABILIDAD_PVP_COMPLEMENTO_MAX) || 15;
const BATCH_SIZE = 500;

async function cargarReglasTransporte() {
  const { rows } = await pool.query(`SELECT * FROM config_transporte_cliente WHERE activo = true`);
  return rows;
}

// Interpreta aft_catalogo.portes como importe monetario, validando vacíos,
// formato y valores inválidos — nunca se asume un número si el dato no es
// fiable. "vacio" es un caso normal (no todas las refs van con envío
// directo de AFT); "formato_invalido"/"valor_negativo" son datos de AFT
// anómalos y se marcan aparte para revisión.
function parsePortes(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { valido: false, valor: null, motivo: 'vacio' };
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return { valido: false, valor: null, motivo: 'formato_invalido' };
  }
  if (num < 0) {
    return { valido: false, valor: null, motivo: 'valor_negativo' };
  }
  return { valido: true, valor: round2(num) };
}

// Respaldo propio (configurable, NO es el coste real de AFT): excepción
// por ref > categoría > peso mínimo > valor por defecto (con umbral de
// envío gratis). Solo se usa cuando la ref no trae un portes válido de AFT.
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

// Decide el transporte real de una referencia: el portes de AFT (envío
// directo) si es válido, o el respaldo propio si no lo es — nunca ambos a
// la vez, para no duplicar transporte.
function resolverTransporte(row, pvpReferencia, reglas) {
  const parsedPortes = parsePortes(row.portes);
  if (parsedPortes.valido) {
    return {
      tarifa: parsedPortes.valor, origen: `aft_portes_directo`, esEnvioDirectoAFT: true,
      datosIncompletos: false, motivoIncompleto: null
    };
  }
  const propio = resolverTransporteCliente(row.ref, row.categoria_nombre, row.peso_gr, pvpReferencia, reglas);
  const esAnomalia = parsedPortes.motivo === 'formato_invalido' || parsedPortes.motivo === 'valor_negativo';
  return {
    tarifa: propio.tarifa, origen: propio.origen, esEnvioDirectoAFT: false,
    datosIncompletos: esAnomalia,
    motivoIncompleto: esAnomalia ? `Valor de portes de AFT inválido (${parsedPortes.motivo}) — se usó tarifa propia de respaldo (${propio.origen}).` : null
  };
}

// Confirmación comercial: AFT permite agrupar productos en un mismo pedido,
// pero el coste del transporte agrupado depende del peso total y todavía no
// hay una tabla de tarifas verificada para ese escenario. Por eso este
// escenario NUNCA calcula un coste ni un margen: solo informa el peso total
// (si se conoce) y un estado explícito. Nunca se suman los portes
// individuales como sustituto del coste agrupado — un pedido agrupado paga
// un único porte por el conjunto, no uno por artículo, así que sumarlos
// sobrestimaría el coste y daría una cifra inventada.
function resolverEscenarioAgrupado(row, transporte) {
  const pesoGr = row.peso_gr != null ? Number(row.peso_gr) : null;
  // Solo tiene sentido ofrecer el escenario agrupado para refs con envío
  // directo de AFT confirmado (portes válido) — si ni siquiera hay un
  // porte individual fiable, no hay base alguna para plantear agrupar.
  const estado = transporte.esEnvioDirectoAFT ? 'pendiente_cotizacion' : 'no_aplica';
  return { pesoGr: Number.isFinite(pesoGr) ? pesoGr : null, estado };
}

// Clasificación de venta — puramente informativa, no cambia coste ni
// margen. Prioridad: datos incompletos > margen insuficiente (pérdida,
// margen bajo o sin PVP) > complementaria (PVP bajo, candidato a venta
// cruzada) > individual (venta destacada por sí sola).
function clasificarVenta(estado, pvpReferencia) {
  if (estado === 'datos_incompletos') return 'datos_incompletos';
  if (estado === 'perdida' || estado === 'margen_bajo' || estado === 'sin_pvp') return 'margen_insuficiente';
  if (pvpReferencia != null && pvpReferencia <= PVP_COMPLEMENTO_MAX) return 'complementaria';
  return 'individual';
}

// Desglose completo: coste de producto, IVA 21%, recargo de equivalencia
// 5,2%, transporte (AFT directo o respaldo propio, nunca ambos) y comisión
// de venta, diferenciados. El coste final se marca siempre como estimado:
// el tratamiento fiscal (IVA) de portes todavía no está confirmado.
function calcularFilaRentabilidad(row, reglas) {
  const datosBaseIncompletos = row.costo == null || row.pvp_sin_iva == null;
  const base = calcularCosteYMargen(row);

  const pvpReal = row.shopify_price != null ? round2(Number(row.shopify_price)) : null;
  const pvpEsReal = pvpReal != null;
  const pvpReferencia = pvpEsReal ? pvpReal : base.precioVentaAFT;

  const transporte = resolverTransporte(row, pvpReferencia, reglas);
  const comisionVentaImporte = pvpReferencia != null ? round2((pvpReferencia * COMISION_VENTA_PCT) / 100) : null;

  const costeTotalEstimado = datosBaseIncompletos
    ? null
    : round2(base.costeDesembolsado + transporte.tarifa + (comisionVentaImporte || 0));

  const margenAbsoluto = (!datosBaseIncompletos && pvpReferencia != null) ? round2(pvpReferencia - costeTotalEstimado) : null;
  const margenPct = (margenAbsoluto != null && pvpReferencia > 0) ? round2((margenAbsoluto / pvpReferencia) * 100) : null;

  const shopifyCost = row.shopify_cost != null ? round2(Number(row.shopify_cost)) : null;
  const diferenciaCosteShopify = (!datosBaseIncompletos && shopifyCost != null) ? round2(costeTotalEstimado - shopifyCost) : null;

  const datosIncompletos = datosBaseIncompletos || transporte.datosIncompletos;
  const datosIncompletosMotivo = datosBaseIncompletos
    ? 'Falta costo o pvp_sin_iva en aft_stock_precios — no se puede calcular un coste fiable para esta referencia.'
    : transporte.motivoIncompleto;

  let estado;
  if (datosBaseIncompletos) estado = 'datos_incompletos';
  else if (margenPct == null) estado = 'sin_pvp';
  else if (margenPct < 0) estado = 'perdida';
  else if (margenPct < MARGEN_BAJO_PCT) estado = 'margen_bajo';
  else estado = 'ok';

  const escenarioAgrupado = resolverEscenarioAgrupado(row, transporte);
  const clasificacionVenta = clasificarVenta(estado, pvpReferencia);
  const esCandidatoComplemento = clasificacionVenta === 'complementaria';

  return {
    ref: row.ref, marca: row.marca, descripcion: row.descripcion,
    coste_sin_iva: datosBaseIncompletos ? null : base.costeBase,
    iva_importe: datosBaseIncompletos ? null : base.ivaImporte,
    recargo_importe: datosBaseIncompletos ? null : base.recargoImporte,
    coste_con_impuestos: datosBaseIncompletos ? null : base.costeDesembolsado,
    portes_proveedor_aft: parsePortes(row.portes).valido ? parsePortes(row.portes).valor : null,
    transporte_cliente: datosBaseIncompletos ? null : transporte.tarifa,
    transporte_cliente_origen: transporte.origen,
    es_envio_directo_aft: transporte.esEnvioDirectoAFT,
    comision_venta_importe: datosBaseIncompletos ? null : comisionVentaImporte,
    coste_total_estimado: costeTotalEstimado,
    pvp_real: pvpReferencia, pvp_es_real: pvpEsReal,
    margen_pct: margenPct, margen_absoluto: margenAbsoluto,
    shopify_cost: shopifyCost, diferencia_coste_shopify: diferenciaCosteShopify,
    estado_rentabilidad: estado,
    datos_incompletos: datosIncompletos,
    datos_incompletos_motivo: datosIncompletosMotivo,
    peso_gr: escenarioAgrupado.pesoGr,
    escenario_agrupado_estado: escenarioAgrupado.estado,
    clasificacion_venta: clasificacionVenta,
    es_candidato_complemento: esCandidatoComplemento
  };
}

async function registrarAlerta(ref, tipo, detalle, valor) {
  await pool.query(`INSERT INTO rentabilidad_alertas (ref, tipo, detalle, valor) VALUES ($1,$2,$3,$4)`, [ref, tipo, detalle, valor]);
}

const RESULT_COLS = [
  'ref', 'marca', 'descripcion', 'coste_sin_iva', 'iva_importe', 'recargo_importe', 'coste_con_impuestos',
  'portes_proveedor_aft', 'transporte_cliente', 'transporte_cliente_origen', 'es_envio_directo_aft',
  'comision_venta_importe', 'coste_total_estimado',
  'pvp_real', 'pvp_es_real', 'margen_pct', 'margen_absoluto', 'shopify_cost', 'diferencia_coste_shopify',
  'estado_rentabilidad', 'datos_incompletos', 'datos_incompletos_motivo',
  'peso_gr', 'escenario_agrupado_estado', 'clasificacion_venta', 'es_candidato_complemento'
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
// Ejecuta el análisis completo: coste desglosado (producto, IVA, recargo,
// transporte AFT directo o de respaldo, comisión) + margen real (PVP de
// Shopify) o proyectado (PVP de AFT, para oportunidades aún no publicadas)
// + alertas explicadas (pérdida, margen bajo, diferencia de coste con
// Shopify, datos incompletos). Universo analizado: referencias con
// coincidencia fiable en Shopify (cambiaria/a_cero/sin_cambio) más
// oportunidades comerciales reales (no_encontrado + es_oportunidad_comercial)
// — no todo el catálogo AFT, solo lo que es accionable comercialmente.
// Usa los datos ya guardados en hmt-db (aft_catalogo.portes incluido) — no
// hace falta reimportar AFT ni volver a leer Shopify para esta ejecución.
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
    let enPerdida = 0, margenBajo = 0, diferenciaCoste = 0, datosIncompletosCount = 0;

    for (const row of rows) {
      const fila = calcularFilaRentabilidad(row, reglas);
      resultados.push(fila);

      if (fila.estado_rentabilidad === 'perdida') {
        enPerdida++;
        await registrarAlerta(
          fila.ref, 'perdida',
          `${fila.ref}: margen estimado ${fila.margen_pct}% (coste total estimado ${fila.coste_total_estimado}€ vs PVP ${fila.pvp_real}€${fila.pvp_es_real ? '' : ' proyectado de AFT, todavía sin coincidencia real en Shopify'}).`,
          fila.margen_pct
        );
      } else if (fila.estado_rentabilidad === 'margen_bajo') {
        margenBajo++;
        await registrarAlerta(
          fila.ref, 'margen_bajo',
          `${fila.ref}: margen estimado ${fila.margen_pct}%, por debajo del umbral configurado (${MARGEN_BAJO_PCT}%).`,
          fila.margen_pct
        );
      } else if (fila.estado_rentabilidad === 'datos_incompletos') {
        datosIncompletosCount++;
        await registrarAlerta(fila.ref, 'datos_incompletos', `${fila.ref}: ${fila.datos_incompletos_motivo}`, null);
      }

      if (fila.datos_incompletos && fila.estado_rentabilidad !== 'datos_incompletos') {
        // Anomalía en portes (formato/negativo) detectada aunque el resto del cálculo sí fue posible con el respaldo.
        datosIncompletosCount++;
        await registrarAlerta(fila.ref, 'datos_incompletos', `${fila.ref}: ${fila.datos_incompletos_motivo}`, null);
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

    const alertasTotal = enPerdida + margenBajo + diferenciaCoste + datosIncompletosCount;
    await pool.query(
      `UPDATE rentabilidad_runs SET status = 'success', finished_at = now(), fase = 'done',
         procesados = $2, en_perdida = $3, margen_bajo = $4, diferencia_coste = $5, alertas_total = $6
       WHERE id = $1`,
      [runId, guardadas, enPerdida, margenBajo, diferenciaCoste, alertasTotal]
    );

    return { runId, analizados: rows.length, guardados: guardadas, enPerdida, margenBajo, diferenciaCoste, datosIncompletos: datosIncompletosCount, alertasTotal };
  } catch (e) {
    await pool.query(
      `UPDATE rentabilidad_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = {
  ejecutarAnalisisRentabilidad, resolverTransporteCliente, resolverTransporte, parsePortes,
  calcularFilaRentabilidad, resolverEscenarioAgrupado, clasificarVenta, PVP_COMPLEMENTO_MAX
};
