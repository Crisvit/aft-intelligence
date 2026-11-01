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

module.exports = {
  CAMPOS, EPSILON_IMPORTE, detectarCambios, registrarCambiosLote, consultarHistorial, normalizarFiltros, filaDesdeValoresStock
};
