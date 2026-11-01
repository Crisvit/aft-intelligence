// Capa de presentación (Clean Architecture) — página "Oportunidades
// comerciales". Extraída de src/buildDashboardHtml.js (fase 3; ver
// test/buildDashboardHtml.characterization.test.js para la prueba de
// caracterización previa a la extracción) y ampliada en el mismo cambio
// para mostrar lo que fase 2 ya calculaba y guardaba, pero el dashboard
// nunca mostraba: afinidad comercial, clasificación de margen y, sobre
// todo, el estado de elegibilidad (recomendada / excedente / fuera de
// foco / ambigua) — fase 2 persiste TODOS los candidatos válidos, no solo
// los recomendados, así que sin esto la tabla mezclaba ambos sin
// distinguirlos.
//
// Invariante que esta vista nunca toca: el score y el motivo que llegan
// en cada fila ya vienen calculados por src/domain/oportunidades.js — no
// se recalcula ni se reinterpreta aquí ningún número, solo se muestra.
const { esc, eur, pct, num, titleCase, pl, tiempoRelativo, copiarReferenciaBtn } = require('./helpers');

const ESTADO_ELEGIBILIDAD_BADGE = {
  recomendada: '<span class="badge badge-ok">Recomendada</span>',
  excedente_categoria: '<span class="badge badge-off" style="background:#EFF6FF;color:#2563EB;">Excedente de categoría</span>',
  excedente_total: '<span class="badge badge-off" style="background:#EFF6FF;color:#2563EB;">Excedente del ranking</span>',
  fuera_de_foco: '<span class="badge badge-off" style="background:#F3F4F6;color:#6B7280;">Fuera de foco</span>',
  ambigua_revision: '<span class="badge badge-warn">Afinidad ambigua — revisión</span>'
};
// Sin estado_elegibilidad (resultados guardados antes de fase 2, o
// filtro de afinidad desactivado de forma que el campo no se recalculó
// todavía): nunca se inventa un estado, se muestra como tal.
const ESTADO_ELEGIBILIDAD_DEFAULT = '<span class="badge badge-off">Sin clasificar</span>';

const AFINIDAD_CLASE_BADGE = {
  principal: '<span class="badge badge-off" style="background:#ECFDF5;color:#059669;">Afinidad principal</span>',
  complementaria: '<span class="badge badge-off" style="background:#ECFDF5;color:#059669;">Afinidad complementaria</span>',
  estacional: '<span class="badge badge-off" style="background:#ECFDF5;color:#059669;">Afinidad estacional</span>',
  fuera_de_foco: '<span class="badge badge-off" style="background:#F3F4F6;color:#6B7280;">Fuera de foco</span>',
  ambigua: '<span class="badge badge-warn">Afinidad ambigua</span>'
};

const MARGEN_CLASE_BADGE = {
  autorizacion_excepcional: '<span class="badge badge-off" style="background:#FEF2F2;color:#DC2626;">Autorización excepcional</span>',
  revision_comercial: '<span class="badge badge-warn">Revisión comercial</span>',
  apto_evaluacion: '<span class="badge badge-ok">Apto para evaluación</span>',
  sin_dato: '<span class="badge badge-off">Margen sin dato</span>'
};

function badgeEstadoElegibilidad(c) {
  return ESTADO_ELEGIBILIDAD_BADGE[c.estadoElegibilidad] || ESTADO_ELEGIBILIDAD_DEFAULT;
}
function badgeAfinidad(c) {
  if (!c.afinidadClase) return '<span class="badge badge-off">Sin dato</span>';
  return AFINIDAD_CLASE_BADGE[c.afinidadClase] || esc(c.afinidadClase);
}
function badgeMargen(c) {
  if (!c.margenClasificacion) return '<span class="badge badge-off">Sin dato</span>';
  const base = MARGEN_CLASE_BADGE[c.margenClasificacion] || esc(c.margenClasificacion);
  return base + (c.margenPrioridadAdicional ? ' <span class="badge badge-ok" title="Margen ≥20%">★</span>' : '');
}

function filaOportunidad(c) {
  const margen = c.margenPct != null ? Number(c.margenPct) : null;
  return '<tr data-marca="' + esc(titleCase(c.marca || '')) + '" data-margen="' + (margen != null ? margen : '') + '" data-estado="' + esc(c.estadoElegibilidad || '') + '" data-afinidad="' + esc(c.afinidadClase || '') + '">' +
    '<td data-label="Producto"><div style="font-weight:600;">' + esc(titleCase(c.descripcion || c.ref)) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(c.ref) + (c.categoriaOriginal ? ' · ' + esc(c.categoriaOriginal) : '') + '</div></td>' +
    '<td data-label="Marca">' + esc(titleCase(c.marca || '')) + (c.esPrioritaria ? ' <span class="badge badge-ok">Prioritaria</span>' : '') + (c.esComplementaria ? ' <span class="badge badge-off" style="background:#F5F3FF;color:#7C3AED;">Complementaria</span>' : '') + '</td>' +
    '<td data-label="Elegibilidad">' + badgeEstadoElegibilidad(c) + '</td>' +
    '<td data-label="Afinidad">' + badgeAfinidad(c) + '</td>' +
    '<td data-label="Margen (clasificación)">' + badgeMargen(c) + '</td>' +
    '<td class="num" data-label="Stock AFT">' + num(c.stock) + '</td>' +
    '<td class="num" data-label="Coste">' + eur(c.coste) + '</td>' +
    '<td class="num" data-label="PVP recomendado">' + eur(c.precio) + '</td>' +
    '<td class="num ok" data-label="Margen">' + (margen != null ? pct(margen) : '—') + '</td>' +
    '<td class="num" data-label="Score">' + (c.score != null ? Number(c.score).toFixed(0) + '/100' : '—') + '</td>' +
    '<td data-label="Enlaces">' + copiarReferenciaBtn(c.ref) + '</td>' +
    '</tr>' +
    '<tr class="row-detalle" data-marca="' + esc(titleCase(c.marca || '')) + '" data-margen="' + (margen != null ? margen : '') + '" data-estado="' + esc(c.estadoElegibilidad || '') + '" data-afinidad="' + esc(c.afinidadClase || '') + '"><td colspan="11" style="font-size:11px;color:var(--sub);padding-top:0;padding-bottom:10px;">' + esc(c.motivo || '') + (c.afinidadMotivo ? ' · ' + esc(c.afinidadMotivo) : '') + '</td></tr>';
}

// oportunidadRows llega tal cual de la consulta SQL (columnas de
// oportunidades_resultados); esta vista las traduce a la forma interna
// que usa filaOportunidad, en un único lugar.
function normalizarFila(row) {
  return {
    ref: row.ref, marca: row.marca, descripcion: row.descripcion,
    categoriaOriginal: row.categoria_nombre || null,
    stock: row.stock, coste: row.coste, precio: row.precio, margenPct: row.margenPct,
    esPrioritaria: row.esPrioritaria, esComplementaria: row.esComplementaria,
    score: row.score, motivo: row.motivo,
    afinidadClase: row.afinidadClase || null, afinidadMotivo: row.afinidadMotivo || null,
    margenClasificacion: row.margenClasificacion || null, margenPrioridadAdicional: !!row.margenPrioridadAdicional,
    estadoElegibilidad: row.estadoElegibilidad || null
  };
}

function renderOportunidadesSection(oportunidadRowsCrudas, opciones) {
  const ultimaOportunidades = opciones && opciones.ultimaOportunidades;
  const stockMinimoOportunidad = opciones && opciones.stockMinimoOportunidad;

  const oportunidadRows = (oportunidadRowsCrudas || []).map(normalizarFila);
  if (!oportunidadRows.length) {
    return '<div class="empty-state">Ninguna referencia de tus marcas/categorías comerciales está pendiente de añadir a Shopify ahora mismo.</div>';
  }

  const marcasOportunidad = Array.from(new Set(oportunidadRows.map((c) => titleCase(c.marca || '')).filter(Boolean))).sort();
  const recomendadas = oportunidadRows.filter((c) => c.estadoElegibilidad === 'recomendada').length;
  const excedentes = oportunidadRows.filter((c) => c.estadoElegibilidad === 'excedente_categoria' || c.estadoElegibilidad === 'excedente_total').length;
  const ambiguas = oportunidadRows.filter((c) => c.afinidadClase === 'ambigua').length;
  const fueraDeFoco = oportunidadRows.filter((c) => c.afinidadClase === 'fuera_de_foco').length;

  return '<div class="filterbar">' +
      '<select id="filtroMarca" class="filter-select" onchange="filtrarOportunidades()"><option value="">Todas las marcas</option>' + marcasOportunidad.map((m) => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('') + '</select>' +
      '<select id="filtroMargen" class="filter-select" onchange="filtrarOportunidades()"><option value="0">Cualquier margen</option><option value="20">20%+</option><option value="30">30%+</option><option value="40">40%+</option></select>' +
      '<select id="filtroEstadoOportunidad" class="filter-select" onchange="filtrarOportunidades()">' +
        '<option value="">Todos los estados</option>' +
        '<option value="recomendada">Recomendadas</option>' +
        '<option value="excedente_categoria">Excedente de categoría</option>' +
        '<option value="excedente_total">Excedente del ranking</option>' +
      '</select>' +
      '<select id="filtroAfinidadOportunidad" class="filter-select" onchange="filtrarOportunidades()">' +
        '<option value="">Toda afinidad</option>' +
        '<option value="principal">Principal</option>' +
        '<option value="complementaria">Complementaria</option>' +
        '<option value="estacional">Estacional</option>' +
        '<option value="fuera_de_foco">Fuera de foco</option>' +
        '<option value="ambigua">Ambigua (revisión)</option>' +
      '</select>' +
    '</div>' +
    '<div class="table-note" id="contadorOportunidades">Mostrando ' + pl(oportunidadRows.length, 'oportunidad', 'oportunidades') + ' del último análisis del Agente 4' + (ultimaOportunidades ? ' (' + tiempoRelativo(ultimaOportunidades.finished_at) + ')' : '') + ' — referencias de tus marcas/categorías comerciales con al menos ' + pl(stockMinimoOportunidad || 1, 'unidad', 'unidades') + ' en stock AFT que la última sincronización no encontró en Shopify. Se muestran TODOS los candidatos válidos, no solo los recomendados: ' + recomendadas + ' recomendadas, ' + excedentes + ' excedentes/en reserva' + (ambiguas ? ', ' + ambiguas + ' con afinidad ambigua (pendientes de revisión en Aprobaciones)' : '') + (fueraDeFoco ? ', ' + fueraDeFoco + ' fuera de foco' : '') + '. Puntuación explicable (ver motivo bajo cada fila): marca prioritaria + margen proyectado + stock + afinidad — nunca una señal de demanda externa inventada. La clasificación de margen es solo informativa, nunca altera el score.</div>' +
    '<div class="table-scroll"><table><thead><tr><th>Producto</th><th>Marca</th><th>Elegibilidad</th><th>Afinidad</th><th>Margen (clasificación)</th><th>Stock AFT</th><th>Coste</th><th>PVP recomendado</th><th>Margen</th><th>Score</th><th>Enlaces</th></tr></thead><tbody id="tablaOportunidadesBody">' +
    oportunidadRows.map(filaOportunidad).join('') +
    '</tbody></table></div>';
}

module.exports = { renderOportunidadesSection };
