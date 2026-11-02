// Historial de cambios reales de AFT (coste, PVP sin IVA y stock por
// referencia). Recupera lo útil del Proceso B de n8n dentro de AFT
// Intelligence 2.0.
//
// Qué se registra: un cambio REAL = la referencia ya existía en
// aft_stock_precios y el valor nuevo de AFT difiere del guardado. No se
// registran altas (primera vez que aparece una ref), ni valores ausentes
// (NULL/no numéricos), ni diferencias de céntimos por redondeo.
//
// Sin duplicados: la comparación se hace contra la foto actual DENTRO de la
// misma transacción que hace el upsert de esa foto (ver procesarEnLotes en
// sync.js). Si el lote falla, se deshacen cambios y foto a la vez y el
// reintento recalcula la diferencia; si el import se repite con los mismos
// datos, ya no hay diferencia y no se inserta nada. Un índice único
// (import_run_id, ref, campo) es una segunda barrera.
//
// Este módulo solo escribe en aft_cambios (nuestra base). NUNCA llama a
// Shopify ni modifica precios o inventario.

const CAMPOS = ['costo', 'pvp_sin_iva', 'stock'];
// Los importes de AFT vienen con 2 decimales: una diferencia menor que medio
// céntimo es ruido de representación, no un cambio de precio.
const EPSILON_IMPORTE = 0.005;

// Alerta cuando el COSTE (nunca PVP ni stock) sube un 10% o más respecto al
// valor anterior — configurable, nunca hardcoded sin forma de ajustarlo.
const UMBRAL_ALERTA_COSTE_PCT = Number(process.env.AFT_CAMBIOS_UMBRAL_ALERTA_PCT) || 10;

// Política de retención — SOLO DEFINIDA, sin ejecutar ninguna purga: este
// módulo no borra ninguna fila de aft_cambios. El número de meses es
// informativo (se muestra en el panel) hasta que el procedimiento de
// purga se diseñe, se pruebe con backups verificados y se apruebe por
// separado. No añadir código de borrado aquí sin esa aprobación explícita.
const RETENCION_MESES = Number(process.env.AFT_CAMBIOS_RETENCION_MESES) || 12;

function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function esCambio(campo, anterior, nuevo) {
  if (campo === 'stock') return anterior !== nuevo;
  return Math.abs(nuevo - anterior) >= EPSILON_IMPORTE;
}

// previos: Map ref -> { costo, pvp_sin_iva, stock } (foto actual en BD).
// nuevas: filas ya normalizadas { ref, costo, pvp_sin_iva, stock, fecha_cambio_aft }.
// Función pura. Devuelve solo cambios reales.
function detectarCambios(previos, nuevas) {
  const cambios = [];
  for (const n of nuevas) {
    const previo = previos.get(n.ref);
    if (!previo) continue; // alta: no es un cambio
    for (const campo of CAMPOS) {
      const anterior = aNumero(previo[campo]);
      const nuevo = aNumero(n[campo]);
      if (anterior === null || nuevo === null) continue;
      if (esCambio(campo, anterior, nuevo)) {
        cambios.push({
          ref: n.ref, campo, valor_anterior: anterior, valor_nuevo: nuevo,
          fecha_cambio_aft: n.fecha_cambio_aft || null
        });
      }
    }
  }
  return cambios;
}

// % de variación de un valor sobre el anterior. null si no hay base real
// sobre la que calcular un porcentaje (anterior 0 o ausente) — nunca se
// inventa un porcentaje a partir de una base inexistente.
// Función pura.
function pctVariacion(anterior, nuevo) {
  if (anterior === null || anterior === undefined || nuevo === null || nuevo === undefined) return null;
  const a = Number(anterior);
  const n = Number(nuevo);
  if (!Number.isFinite(a) || !Number.isFinite(n) || a === 0) return null;
  return ((n - a) / a) * 100;
}

// Un cambio es una alerta de subida de coste si es del campo 'costo' y su
// variación alcanza el umbral configurado (10% por defecto). PVP y stock
// nunca generan esta alerta — es específica de coste, como se pidió.
// Función pura.
function esAlertaSubidaCoste(cambio, umbralPct = UMBRAL_ALERTA_COSTE_PCT) {
  if (!cambio || cambio.campo !== 'costo') return false;
  const pct = pctVariacion(cambio.valor_anterior, cambio.valor_nuevo);
  return pct != null && pct >= umbralPct;
}

// Filtra y adjunta el % de variación a los cambios de coste que superan el
// umbral, más recientes primero. Función pura.
function filtrarAlertasSubidaCoste(cambios, umbralPct = UMBRAL_ALERTA_COSTE_PCT) {
  return cambios
    .filter((c) => esAlertaSubidaCoste(c, umbralPct))
    .map((c) => ({ ...c, variacion_pct: pctVariacion(c.valor_anterior, c.valor_nuevo) }));
}

// Convierte la salida de valoresStock() de sync.js
// ([ref, costo, pvp_sin_iva, stock, fecha]) a una fila con nombres.
function filaDesdeValoresStock(valores) {
  return { ref: valores[0], costo: valores[1], pvp_sin_iva: valores[2], stock: valores[3], fecha_cambio_aft: valores[4] };
}

// Se ejecuta DENTRO de la transacción abierta del lote, antes del upsert
// de la foto. `client` es el cliente de pg de esa transacción.
async function registrarCambiosLote(client, valoresStockLote, runId) {
  const nuevas = valoresStockLote.map(filaDesdeValoresStock).filter((f) => f.ref);
  if (!nuevas.length) return 0;

  const { rows } = await client.query(
    `SELECT ref, costo, pvp_sin_iva, stock FROM aft_stock_precios WHERE ref = ANY($1::text[])`,
    [nuevas.map((f) => f.ref)]
  );
  const previos = new Map(rows.map((r) => [r.ref, r]));
  const cambios = detectarCambios(previos, nuevas);
  if (!cambios.length) return 0;

  const COLS = 6;
  const grupos = cambios.map((_, i) => {
    const p = Array.from({ length: COLS }, (__, c) => `$${i * COLS + c + 1}`);
    return `(${p.join(',')})`;
  });
  const params = cambios.flatMap((c) => [c.ref, c.campo, c.valor_anterior, c.valor_nuevo, c.fecha_cambio_aft, runId || null]);
  const res = await client.query(
    `INSERT INTO aft_cambios (ref, campo, valor_anterior, valor_nuevo, fecha_cambio_aft, import_run_id)
     VALUES ${grupos.join(', ')}
     ON CONFLICT (import_run_id, ref, campo) WHERE import_run_id IS NOT NULL DO NOTHING`,
    params
  );
  return res.rowCount != null ? res.rowCount : cambios.length;
}

// ---------------------------------------------------------------------------
// Consulta de SOLO LECTURA. Todos los filtros van parametrizados; `campo`
// se valida contra una lista cerrada; límite acotado.
// ---------------------------------------------------------------------------
function normalizarFiltros(f = {}) {
  const limite = Math.min(Math.max(parseInt(f.limite, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(f.offset, 10) || 0, 0);
  const campo = f.campo && CAMPOS.includes(String(f.campo)) ? String(f.campo) : null;
  const ref = f.ref ? String(f.ref).trim() : null;
  const fecha = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return { limite, offset, campo, ref: ref || null, desde: fecha(f.desde), hasta: fecha(f.hasta), campoInvalido: !!f.campo && !campo };
}

async function consultarHistorial(pool, filtros) {
  const f = normalizarFiltros(filtros);
  if (f.campoInvalido) {
    const err = new Error(`campo inválido; valores permitidos: ${CAMPOS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (f.ref) add('h.ref = ?', f.ref);
  if (f.campo) add('h.campo = ?', f.campo);
  if (f.desde) add('h.detectado_en >= ?', f.desde);
  if (f.hasta) add('h.detectado_en < ?', f.hasta);
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const { rows: totalRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM aft_cambios h ${where}`, params);
  const { rows } = await pool.query(
    `SELECT h.id, h.ref, c.marca, c.descripcion_corta AS descripcion, h.campo,
            h.valor_anterior, h.valor_nuevo, h.fecha_cambio_aft, h.detectado_en, h.import_run_id
     FROM aft_cambios h LEFT JOIN aft_catalogo c ON c.ref = h.ref
     ${where}
     ORDER BY h.detectado_en DESC, h.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.limite, f.offset]
  );
  return { total: totalRows[0].total, limite: f.limite, offset: f.offset, cambios: rows };
}

// SOLO LECTURA: últimas alertas de subida de coste (>= umbral), con marca y
// descripción para mostrarlas en el panel. Revisa los últimos `ventana`
// cambios de coste (por defecto 500) y filtra los que alcanzan el umbral —
// no hace falta registrar las alertas aparte: se derivan siempre de
// aft_cambios, la misma fuente que el resto del historial.
async function listarAlertasSubidaCoste(pool, { limite = 50, ventana = 500, umbralPct = UMBRAL_ALERTA_COSTE_PCT } = {}) {
  const { rows } = await pool.query(
    `SELECT h.id, h.ref, c.marca, c.descripcion_corta AS descripcion, h.campo,
            h.valor_anterior, h.valor_nuevo, h.fecha_cambio_aft, h.detectado_en
     FROM aft_cambios h LEFT JOIN aft_catalogo c ON c.ref = h.ref
     WHERE h.campo = 'costo'
     ORDER BY h.detectado_en DESC, h.id DESC
     LIMIT $1`,
    [ventana]
  );
  return filtrarAlertasSubidaCoste(rows, umbralPct).slice(0, limite);
}

// Fecha de corte pura: todo lo detectado ANTES de esta fecha está fuera de
// la retención definida. No decide nada por sí sola — solo la usa la
// consulta de SOLO LECTURA de abajo.
function fechaCorteRetencion(ahora = new Date(), meses = RETENCION_MESES) {
  const corte = new Date(ahora);
  corte.setUTCMonth(corte.getUTCMonth() - meses);
  return corte;
}

// SOLO LECTURA: cuenta cuántas filas de aft_cambios son más antiguas que la
// retención definida. Informativo para el panel — este módulo NUNCA borra
// filas de aft_cambios; cualquier purga real es un procedimiento aparte,
// pendiente de verificar backups y de aprobación explícita.
async function contarPendientesDeRetencion(pool, meses = RETENCION_MESES) {
  const corte = fechaCorteRetencion(new Date(), meses);
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM aft_cambios WHERE detectado_en < $1`, [corte.toISOString()]);
  return { meses, corte: corte.toISOString(), pendientesDePurga: rows[0].total };
}

// SOLO LECTURA: cuántos cambios reales detectó AFT cada día (coste, PVP
// sin IVA, stock), hora de Madrid — para el gráfico de evolución de la
// página «Cambios AFT». Nunca un valor por referencia individual: es un
// recuento de actividad detectada, no una serie de precios. Sin historial
// en la ventana pedida, devuelve un array vacío — «Sin datos», nunca un
// cero inventado donde no se ha detectado nada todavía.
async function evolucionDiaria(pool, dias = 30) {
  const diasSeguro = Math.min(Math.max(parseInt(dias, 10) || 30, 1), 90);
  const { rows } = await pool.query(
    `SELECT (detectado_en AT TIME ZONE 'Europe/Madrid')::date AS dia,
            COUNT(*) FILTER (WHERE campo = 'costo')::int AS coste,
            COUNT(*) FILTER (WHERE campo = 'pvp_sin_iva')::int AS pvp,
            COUNT(*) FILTER (WHERE campo = 'stock')::int AS stock
     FROM aft_cambios
     WHERE detectado_en >= now() - ($1 || ' days')::interval
     GROUP BY 1
     ORDER BY 1`,
    [diasSeguro]
  );
  return rows;
}

module.exports = {
  CAMPOS, EPSILON_IMPORTE, UMBRAL_ALERTA_COSTE_PCT, RETENCION_MESES,
  detectarCambios, registrarCambiosLote, consultarHistorial, normalizarFiltros, filaDesdeValoresStock,
  pctVariacion, esAlertaSubidaCoste, filtrarAlertasSubidaCoste, listarAlertasSubidaCoste,
  fechaCorteRetencion, contarPendientesDeRetencion, evolucionDiaria
};
