// Consultas de solo lectura para el nuevo panel SaaS (Inicio/Coincidencias) —
// deliberadamente en un archivo aparte, nunca dentro de src/reposicion.js:
// esto es presentación agregada para el dashboard, no lógica del agente de
// reposición ni del pipeline. Ninguna función de aquí escribe nada, ni se
// invoca desde ningún paso del pipeline — solo desde server.js al construir
// la página.
const { pool } = require('./db');

// Evolución diaria de la reposición real (hora de Madrid), para el gráfico
// de Inicio. Solo el lote diario (modo='lote') — una prueba de una sola
// referencia no es una "sincronización" a efectos de esta tendencia. Sin
// historial todavía, se devuelve un array vacío — el dashboard debe mostrar
// "Sin datos", nunca un cero inventado donde no hay ninguna ejecución.
async function obtenerEvolucionReposicion(dias) {
  const diasSeguro = Math.min(Math.max(parseInt(dias, 10) || 30, 1), 90);
  const { rows } = await pool.query(
    `SELECT (finished_at AT TIME ZONE 'Europe/Madrid')::date AS dia,
            COUNT(*)::int AS runs,
            COUNT(*) FILTER (WHERE status = 'parcial')::int AS runs_parciales,
            COALESCE(SUM(actualizados), 0)::int AS actualizados,
            COALESCE(SUM(simulados), 0)::int AS simulados,
            COALESCE(SUM(errores), 0)::int AS errores
     FROM reposicion_runs
     WHERE modo = 'lote' AND finished_at IS NOT NULL
       AND finished_at >= now() - ($1 || ' days')::interval
     GROUP BY 1
     ORDER BY 1`,
    [diasSeguro]
  );
  return rows;
}

// Listado real de referencias bloqueadas (no solo el conteo agregado que ya
// da obtenerBloqueadosPorMotivo en src/reposicion.js) — mismo universo base
// y mismos motivos, para que el panel pueda mostrarlas una a una con su
// motivo. Deliberadamente duplicado aquí en vez de importado: es una
// consulta de presentación, no debe poder alterar el comportamiento del
// agente de reposición si cambia.
async function obtenerReferenciasBloqueadas(limite) {
  const limiteSeguro = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);
  const { rows } = await pool.query(
    `SELECT ref, ean, shopify_product_title, matched_by, estado, checked_at,
            alerta_duplicado, alerta_multiples_ubicaciones, alerta_ubicacion_no_encontrada, bloquear_escritura,
            shopify_inventory_item_id, shopify_stock, stock_aft
     FROM shopify_match
     WHERE estado IN ('cambiaria','a_cero','sin_cambio')
       AND (
         matched_by NOT IN ('ean','sku') OR matched_by IS NULL
         OR alerta_duplicado = true OR alerta_multiples_ubicaciones = true OR alerta_ubicacion_no_encontrada = true
         OR bloquear_escritura = true
         OR shopify_inventory_item_id IS NULL OR shopify_stock IS NULL
         OR stock_aft IS NULL OR stock_aft < 0
       )
     ORDER BY ref
     LIMIT $1`,
    [limiteSeguro]
  );
  return rows.map((r) => ({ ...r, motivos: motivosBloqueo(r) }));
}

function motivosBloqueo(r) {
  const motivos = [];
  if (!r.matched_by || !['ean', 'sku'].includes(r.matched_by)) motivos.push('sin coincidencia EAN/SKU fiable');
  if (r.alerta_duplicado) motivos.push('coincidencia duplicada');
  if (r.alerta_multiples_ubicaciones) motivos.push('múltiples ubicaciones');
  if (r.alerta_ubicacion_no_encontrada) motivos.push('ubicación no encontrada');
  if (r.bloquear_escritura) motivos.push('bloqueo manual');
  if (!r.shopify_inventory_item_id) motivos.push('sin inventory_item_id de Shopify');
  if (r.shopify_stock === null || r.shopify_stock === undefined) motivos.push('sin stock de Shopify leído');
  if (r.stock_aft === null || r.stock_aft === undefined) motivos.push('sin stock de AFT');
  else if (Number(r.stock_aft) < 0) motivos.push('stock de AFT negativo');
  return motivos;
}

// Último evento de reposición (escrito o no) por referencia — para que la
// página de coincidencias muestre el estado REAL de cada una ("Actualizado
// y verificado", "Simulado", "Error"...), nunca solo si hay diferencia de
// stock. DISTINCT ON ya ordenado por fecha descendente: una fila por ref.
async function obtenerUltimoEventoPorRef() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ref) ref, tipo_evento, dry_run, escrito, verificado, detectado_en
     FROM reposicion_eventos
     ORDER BY ref, detectado_en DESC`
  );
  const mapa = {};
  for (const r of rows) mapa[r.ref] = r;
  return mapa;
}

module.exports = { obtenerEvolucionReposicion, obtenerReferenciasBloqueadas, motivosBloqueo, obtenerUltimoEventoPorRef };
