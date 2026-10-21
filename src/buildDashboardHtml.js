// Panel de AFT Intelligence — reescrito para mostrar solo datos reales de
// hmt-db. Mantiene el lenguaje visual del panel original (misma paleta,
// tipografía, tarjetas, tablas) pero el contenido ya no simula nada: sin
// scoring inventado, sin botones que llamen a automatismos n8n que no
// existen en este repositorio. Lo que no está conectado todavía se señala
// como tal en la página "Integraciones", no se oculta ni se simula.
function buildDashboardHtml({
  productosShopify,
  ultimoSync,
  ultimaImport,
  matchRows,
  incidenciaRows,
  oportunidadRows,
  historialSyncRows,
  ultimaRentabilidad,
  ultimoPipeline,
  rentabilidadResultados,
  rentabilidadAlertas,
  rentabilidadRecomendaciones,
  pvpComplementoMax,
  stockMinimoOportunidad,
  totalesCatalogo,
  shopifyAdminStore
}) {

function esc(s){ return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function eur(n){ return (n === undefined || n === null) ? '—' : Number(n).toFixed(2) + '€'; }
function pct(n){ return (n === undefined || n === null) ? '—' : Number(n).toFixed(1) + '%'; }
function num(n){ return (n === undefined || n === null) ? '—' : n; }
function titleCase(s){ return String(s||'').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function pl(n, singular, plural){ return n + ' ' + (n === 1 ? singular : plural); }

function tiempoRelativo(iso){
  if (!iso) return '—';
  const fecha = new Date(iso);
  const ahora = new Date();
  const diffMin = Math.floor((ahora - fecha) / 60000);
  if (diffMin < 1) return 'Ahora mismo';
  if (diffMin < 60) return 'hace ' + diffMin + ' min';
  const esHoy = fecha.toDateString() === ahora.toDateString();
  const ayer = new Date(ahora); ayer.setDate(ayer.getDate() - 1);
  const esAyer = fecha.toDateString() === ayer.toDateString();
  const hora = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (esHoy) return hora;
  if (esAyer) return 'Ayer, ' + hora;
  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ', ' + hora;
}

const ICON = {
  home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  sparkles: '<path d="M12 3v4M12 17v4M5 12H3M8 8 5.5 5.5M8 16l-2.5 2.5M16 8l2.5-2.5M16 16l2.5 2.5M21 12h-2"/><circle cx="12" cy="12" r="2.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5M2 16l10 5 10-5"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8a2 2 0 0 1 2 2v2a8 8 0 0 1-8 8 8 8 0 0 1-8-8v-2a2 2 0 0 1 2-2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  alertTri: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  packageX: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8M8.5 5.5l7 4"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
};
function icon(name, size, color){ return '<svg width="'+(size||16)+'" height="'+(size||16)+'" viewBox="0 0 24 24" fill="none" stroke="'+(color||'currentColor')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+ICON[name]+'</svg>'; }

// AFT no tiene (todavía) una URL de producto pública confirmada — no se
// inventa una (eso es lo que daba enlaces en blanco antes). Mientras no
// exista una URL real verificada, el único enlace a AFT que se ofrece es
// "Copiar referencia" para buscarla a mano en el ERP/portal de AFT.
function copiarReferenciaBtn(ref){
  return '<button type="button" class="sec-link" style="background:none;border:none;cursor:pointer;padding:0;font:inherit;" onclick="copiarReferencia(this,\'' + esc(ref) + '\')" title="Copiar la referencia AFT al portapapeles">' +
    icon('copy', 11) + ' Copiar ref. AFT</button>';
}
// URL del producto en el admin de Shopify — construida SOLO a partir del
// shopify_product_id real (el ID del producto padre, leído de la API vía
// product.id en la consulta de variantes), nunca del id de la variante:
// /admin/products/<id de VARIANTE> no es una ficha válida y da página en
// blanco. Sin un product_id guardado (catálogo todavía no re-sincronizado
// tras este fix), no se construye ningún enlace — se muestra como ausente
// en vez de adivinar uno roto.
function shopifyProductUrl(productGid){
  if (!productGid || !shopifyAdminStore) return null;
  const numId = String(productGid).split('/').pop();
  if (!/^\d+$/.test(numId)) return null;
  return 'https://admin.shopify.com/store/' + shopifyAdminStore + '/products/' + numId;
}
function enlaceShopify(productGid){
  const url = shopifyProductUrl(productGid);
  if (!url) return '<span style="color:var(--sub);font-size:11.5px;">Sin ID de producto</span>';
  return '<a class="sec-link" href="' + esc(url) + '" target="_blank" rel="noopener">Ver en Shopify ' + icon('chevron', 11) + '</a>';
}

// --- Datos reales, sin inventar nada ---
// productosShopify ya viene de hmt-db (shopify_catalogo, todas las variantes
// leídas por getAllVariants) cruzado con el matching real contra AFT
// (shopify_match). "proveedor" solo puede ser "AFT" (si hubo coincidencia
// fiable por EAN/SKU) o "Sin identificar" — nunca se adivina a partir del
// vendor de Shopify ni por similitud de nombre.
const shopifyProducts = (productosShopify || []).map(p => ({
  id: p.shopify_variant_id, productId: p.shopify_product_id,
  titulo: p.titulo, vendorShopify: p.vendor_shopify, estado: p.estado,
  imagen: p.imagen_url, precio: p.precio != null ? Number(p.precio) : null, stock: p.stock,
  sku: p.sku, barcode: p.barcode, aftRef: p.aft_ref,
  proveedor: p.aft_ref ? ('AFT (ref ' + p.aft_ref + ')') : 'Sin identificar',
  esAft: !!p.aft_ref
}));

const stockCeroRows = matchRows.filter(r => r.estado === 'a_cero');
const incidenciaMatchRows = matchRows.filter(r => r.estado === 'incidencia');
const HORAS_LIMITE_DESACTUALIZADO = 26;
const datosDesactualizados = !ultimoSync || !ultimoSync.finished_at || (Date.now() - new Date(ultimoSync.finished_at).getTime()) > HORAS_LIMITE_DESACTUALIZADO * 3600000;

const kpis = [
  { icon: 'layers', bg: '#ECFDF5', color: '#059669', n: ultimoSync ? num(ultimoSync.total_aft_candidatos) : 0, l: 'Referencias AFT analizadas', page: 'actividad' },
  { icon: 'box', bg: '#EFF6FF', color: '#2563EB', n: ultimoSync ? num(ultimoSync.shopify_variantes_leidas) : 0, l: 'Variantes Shopify leídas', page: 'productos' },
  { icon: 'check', bg: '#ECFDF5', color: '#059669', n: ultimoSync ? num(ultimoSync.total_matched) : 0, l: 'Coincidencias AFT ↔ Shopify', page: 'coincidencias' },
  { icon: 'activity', bg: '#FFFBEB', color: '#D97706', n: ultimoSync ? num(ultimoSync.total_cambiarian) : 0, l: 'Cambios de stock/precio propuestos', page: 'coincidencias' },
  { icon: 'packageX', bg: '#FEF2F2', color: '#DC2626', n: ultimoSync ? num(ultimoSync.total_a_cero) : 0, l: 'Propuestas a stock cero', page: 'coincidencias' },
  { icon: 'alertTri', bg: '#FFFBEB', color: '#D97706', n: ultimoSync ? num(ultimoSync.total_incidencias) : 0, l: 'Incidencias', page: 'actividad' },
  { icon: 'packageX', bg: '#FEF2F2', color: '#DC2626', n: ultimaRentabilidad ? num(ultimaRentabilidad.en_perdida) : 0, l: 'Productos en pérdida estimada', page: 'rentabilidad' },
  { icon: 'alertTri', bg: '#FFFBEB', color: '#D97706', n: ultimaRentabilidad ? num(ultimaRentabilidad.margen_bajo) : 0, l: 'Productos con margen bajo', page: 'rentabilidad' }
];
const kpiHtml = kpis.map(k =>
  '<div class="kpi kpi-clickable" data-page="' + k.page + '" onclick="ir(this)"><div class="kpi-icon" style="background:' + k.bg + ';color:' + k.color + '">' + icon(k.icon, 18) + '</div><div class="kpi-n">' + k.n + '</div><div class="kpi-l">' + k.l + '</div></div>'
).join('');

// --- Necesita tu atención: solo situaciones reales, nunca simuladas ---
const atencion = [];
if (!ultimoSync) {
  atencion.push({ icon: 'alertTri', color: '#D97706', bg: '#FFFBEB', title: 'Todavía no se ha ejecutado ninguna comparación', desc: 'Lanza la importación AFT y la sincronización con Shopify desde Integraciones.', cta: 'Ir a Integraciones', page: 'integraciones' });
}
if (stockCeroRows.length > 0) {
  atencion.push({ icon: 'packageX', color: '#DC2626', bg: '#FEF2F2', title: pl(stockCeroRows.length, 'producto propuesto a stock cero', 'productos propuestos a stock cero'), desc: 'AFT los reporta sin stock y Shopify todavía los muestra con unidades.', cta: 'Ver en Coincidencias', page: 'coincidencias' });
}
if (incidenciaMatchRows.length > 0 || (ultimoSync && ultimoSync.total_incidencias > 0)) {
  const nIncidencias = ultimoSync ? ultimoSync.total_incidencias : incidenciaMatchRows.length;
  atencion.push({ icon: 'alertTri', color: '#DC2626', bg: '#FEF2F2', title: pl(nIncidencias, 'incidencia pendiente de revisión', 'incidencias pendientes de revisión'), desc: 'EAN duplicados, múltiples ubicaciones o datos que no se pudieron confirmar.', cta: 'Ver actividad', page: 'actividad' });
}
if (ultimoSync && ultimoSync.permisos_incompletos) {
  atencion.push({ icon: 'alertTri', color: '#D97706', bg: '#FFFBEB', title: 'Faltan permisos en la app de Shopify', desc: 'Algunos campos no se pudieron leer por falta de scope — no se ha inventado ningún valor.', cta: 'Ver Integraciones', page: 'integraciones' });
}
if (ultimoSync && ultimoSync.status === 'error') {
  atencion.push({ icon: 'alertTri', color: '#DC2626', bg: '#FEF2F2', title: 'La última comparación Shopify ↔ AFT terminó con error', desc: ultimoSync.error_message || 'Revisa los logs del servicio.', cta: 'Ver Integraciones', page: 'integraciones' });
}
if (oportunidadRows.length > 0) {
  atencion.push({ icon: 'sparkles', color: '#7C3AED', bg: '#F5F3FF', title: pl(oportunidadRows.length, 'oportunidad comercial nueva', 'oportunidades comerciales nuevas'), desc: 'Referencias de tus marcas/categorías que AFT tiene y Shopify todavía no.', cta: 'Ver oportunidades', page: 'oportunidades' });
}
if (ultimaRentabilidad && ultimaRentabilidad.en_perdida > 0) {
  atencion.push({ icon: 'packageX', color: '#DC2626', bg: '#FEF2F2', title: pl(ultimaRentabilidad.en_perdida, 'producto en pérdida estimada', 'productos en pérdida estimada'), desc: 'El coste total estimado supera al PVP real o proyectado.', cta: 'Ver rentabilidad', page: 'rentabilidad' });
}
if (ultimaRentabilidad && ultimaRentabilidad.margen_bajo > 0) {
  atencion.push({ icon: 'alertTri', color: '#D97706', bg: '#FFFBEB', title: pl(ultimaRentabilidad.margen_bajo, 'producto con margen bajo', 'productos con margen bajo'), desc: 'Por debajo del umbral mínimo configurado.', cta: 'Ver rentabilidad', page: 'rentabilidad' });
}
if (!ultimaRentabilidad) {
  atencion.push({ icon: 'activity', color: '#2563EB', bg: '#EFF6FF', title: 'El agente de rentabilidad todavía no se ha ejecutado', desc: 'Lánzalo desde Integraciones para ver márgenes y alertas reales.', cta: 'Ir a Integraciones', page: 'integraciones' });
}
function attnBtn(a){ return '<a class="btn-outline" data-page="' + a.page + '" onclick="ir(this)">' + esc(a.cta) + ' ' + icon('chevron', 13) + '</a>'; }
const atencionHtml = atencion.length
  ? atencion.slice(0, 4).map(a => '<div class="attn-card"><div class="attn-icon" style="background:' + a.bg + ';color:' + a.color + '">' + icon(a.icon, 18) + '</div><div class="attn-title">' + esc(a.title) + '</div><div class="attn-desc">' + esc(a.desc) + '</div>' + attnBtn(a) + '</div>').join('')
  : '<div class="empty-state" style="grid-column:1/-1;">Todo al día. No hay nada que necesite tu atención ahora mismo.</div>';

// --- Actividad: historial real de sync_runs + incidencias registradas ---
const eventos = [];
historialSyncRows.forEach(r => eventos.push({
  ts: r.finished_at || r.started_at,
  texto: r.status === 'error'
    ? 'Comparación Shopify ↔ AFT con error: ' + (r.error_message || '')
    : 'Comparación Shopify ↔ AFT: ' + num(r.total_matched) + ' coincidencias, ' + num(r.total_cambiarian) + ' cambios, ' + num(r.total_incidencias) + ' incidencias',
  color: r.status === 'error' ? '#DC2626' : '#087F78'
}));
incidenciaRows.forEach(r => eventos.push({ ts: r.detectado_en, texto: '[' + r.tipo + ']' + (r.ref ? ' ref ' + r.ref + ': ' : ' ') + (r.detalle || ''), color: '#D97706' }));
(rentabilidadAlertas || []).forEach(r => eventos.push({ ts: r.detectado_en, texto: '[rentabilidad: ' + r.tipo + '] ' + (r.detalle || ''), color: r.tipo === 'perdida' ? '#DC2626' : '#D97706' }));
eventos.sort((a, b) => new Date(b.ts) - new Date(a.ts));
function tlRow(texto, ts, color){ return '<div class="tl-row"><div class="tl-dot" style="background:' + color + '"></div><div class="tl-body"><div class="tl-text">' + esc(texto) + '</div><div class="tl-time">' + esc(tiempoRelativo(ts)) + '</div></div></div>'; }
const timelineHtml = eventos.length
  ? eventos.slice(0, 40).map(e => tlRow(e.texto, e.ts, e.color)).join('')
  : '<div class="empty-state">Aún no hay actividad registrada.</div>';
const timelineHtmlResumen = eventos.length
  ? eventos.slice(0, 6).map(e => tlRow(e.texto, e.ts, e.color)).join('')
  : '<div class="empty-state">Aún no hay actividad registrada.</div>';

// --- Página Coincidencias: SOLO matching fiable por EAN/SKU (nunca
//     ambiguo — ver filtro WHERE en server.js), marca tomada de AFT. ---
const ESTADO_BADGE = {
  cambiaria: '<span class="badge badge-warn">Cambio propuesto</span>',
  a_cero: '<span class="badge badge-off" style="background:#FEF2F2;color:#DC2626;">A stock cero</span>',
  sin_cambio: '<span class="badge badge-ok">Sin cambios</span>'
};
const MATCHED_BY_LABEL = { ean: 'EAN', sku: 'SKU' };
function filaCoincidencia(r){
  return '<tr data-ref="' + esc((r.ref||'').toLowerCase()) + '" data-nombre="' + esc((r.descripcion||'').toLowerCase()) + '" data-estado="' + esc(r.estado) + '">' +
    '<td data-label="Producto"><div style="font-weight:600;">' + esc(titleCase(r.descripcion || r.ref)) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(r.ref) + '</div></td>' +
    '<td data-label="Marca (AFT)">' + esc(titleCase(r.marca_aft || '')) + '</td>' +
    '<td data-label="Coincide por">' + (MATCHED_BY_LABEL[r.matched_by] || esc(r.matched_by || '')) + '</td>' +
    '<td class="num" data-label="Stock AFT">' + num(r.stock_aft) + '</td>' +
    '<td class="num" data-label="Stock Shopify">' + num(r.shopify_stock) + '</td>' +
    '<td class="num" data-label="Diferencia">' + num(r.stock_diferencia) + '</td>' +
    '<td class="num" data-label="Coste AFT sin IVA">' + eur(r.coste_aft_sin_iva) + '</td>' +
    '<td class="num" data-label="Coste AFT c/impuestos">' + eur(r.coste_aft_con_impuestos) + '</td>' +
    '<td class="num" data-label="Coste en Shopify">' + eur(r.shopify_cost) + '</td>' +
    '<td class="num" data-label="PVP Shopify">' + eur(r.shopify_price) + '</td>' +
    '<td class="num" data-label="PVP AFT">' + eur(r.precio_venta_aft) + '</td>' +
    '<td data-label="Estado">' + (ESTADO_BADGE[r.estado] || esc(r.estado)) + '</td>' +
    '<td data-label="Enlaces">' + enlaceShopify(r.shopify_product_id) + '<div style="margin-top:4px;">' + copiarReferenciaBtn(r.ref) + '</div></td>' +
    '</tr>';
}
const coincidenciasHtml = matchRows.length
  ? '<div class="filterbar">' +
      '<input type="text" id="buscarCoincidencia" class="filter-select" placeholder="Buscar por ref o nombre..." style="flex:1;max-width:280px;" oninput="filtrarCoincidencias()"/>' +
      '<select id="filtroEstadoCoincidencia" class="filter-select" onchange="filtrarCoincidencias()">' +
        '<option value="">Todos los estados</option>' +
        '<option value="cambiaria">Cambio propuesto</option>' +
        '<option value="a_cero">A stock cero</option>' +
        '<option value="sin_cambio">Sin cambios</option>' +
      '</select>' +
    '</div>' +
    '<div class="table-note" id="contadorCoincidencias">Mostrando ' + matchRows.length + ' de ' + pl(matchRows.length, 'coincidencia fiable', 'coincidencias fiables') + ' (emparejadas por EAN o SKU inequívoco). Las coincidencias ambiguas no se muestran aquí — se gestionan como incidencia (ver Actividad).</div>' +
    '<div class="table-scroll"><table><thead><tr><th>Producto</th><th>Marca (AFT)</th><th>Coincide por</th><th>Stock AFT</th><th>Stock Shopify</th><th>Diferencia</th><th>Coste AFT sin IVA</th><th>Coste AFT c/impuestos</th><th>Coste en Shopify</th><th>PVP Shopify</th><th>PVP AFT</th><th>Estado</th><th>Enlaces</th></tr></thead><tbody id="tablaCoincidenciasBody">' +
    matchRows.map(filaCoincidencia).join('') +
    '</tbody></table></div>' +
    '<p style="font-size:11.5px;color:var(--sub);margin-top:10px;">El coste registrado en Shopify se muestra tal cual está en la ficha — su tratamiento de IVA está pendiente de validar, por eso no se calcula una "diferencia de coste" automática entre AFT y Shopify.</p>'
  : '<div class="empty-state">Todavía no hay coincidencias guardadas. Ejecuta una sincronización desde Integraciones.</div>';

// --- Página Oportunidades: datos reales, sin ningún score inventado.
//     Ranking explicable: prioridad de marca (Wolfpack/Samurai/Maurer/
//     Papillon/Saturnia, configurable) primero, margen real/proyectado
//     después — nunca una puntuación opaca. ---
const marcasOportunidad = Array.from(new Set(oportunidadRows.map(c => titleCase(c.marca || '')).filter(Boolean))).sort();
function filaOportunidad(c){
  const margen = c.margenPct != null ? Number(c.margenPct) : null;
  return '<tr data-marca="' + esc(titleCase(c.marca || '')) + '" data-margen="' + (margen != null ? margen : '') + '">' +
    '<td data-label="Producto">' + esc(titleCase(c.descripcion || c.ref)) + '</td>' +
    '<td data-label="Marca">' + esc(titleCase(c.marca || '')) + (c.esPrioritaria ? ' <span class="badge badge-ok">Prioritaria</span>' : '') + '</td>' +
    '<td class="num" data-label="Stock AFT">' + num(c.stock) + '</td>' +
    '<td class="num" data-label="Coste">' + eur(c.coste) + '</td>' +
    '<td class="num" data-label="PVP recomendado">' + eur(c.precio) + '</td>' +
    '<td class="num ok" data-label="Margen">' + (margen != null ? pct(margen) : '—') + '</td>' +
    '<td data-label="Enlaces">' + copiarReferenciaBtn(c.ref) + '</td>' +
  '</tr>';
}
const oportunidadesHtml = oportunidadRows.length
  ? '<div class="filterbar">' +
      '<select id="filtroMarca" class="filter-select" onchange="filtrarOportunidades()"><option value="">Todas las marcas</option>' + marcasOportunidad.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('') + '</select>' +
      '<select id="filtroMargen" class="filter-select" onchange="filtrarOportunidades()"><option value="0">Cualquier margen</option><option value="20">20%+</option><option value="30">30%+</option><option value="40">40%+</option></select>' +
    '</div>' +
    '<div class="table-note">Mostrando ' + pl(oportunidadRows.length, 'oportunidad', 'oportunidades') + ' — referencias de tus marcas/categorías comerciales con al menos ' + pl(stockMinimoOportunidad || 1, 'unidad', 'unidades') + ' en stock AFT que la última sincronización no encontró en Shopify. Orden: marcas prioritarias (Wolfpack/Samurai/Maurer/Papillon/Saturnia) primero, después por margen — ambos configurables por variable de entorno.</div>' +
    '<div class="table-scroll"><table><thead><tr><th>Producto</th><th>Marca</th><th>Stock AFT</th><th>Coste</th><th>PVP recomendado</th><th>Margen</th><th>Enlaces</th></tr></thead><tbody id="tablaOportunidadesBody">' +
    oportunidadRows.map(filaOportunidad).join('') +
    '</tbody></table></div>'
  : '<div class="empty-state">Ninguna referencia de tus marcas/categorías comerciales está pendiente de añadir a Shopify ahora mismo.</div>';

// --- Página Rentabilidad (prioridad 1): coste desglosado, transporte al
//     cliente configurado por categoría/producto/peso (nunca una tarifa
//     única), margen real (PVP de Shopify) o proyectado (PVP de AFT para
//     oportunidades), y alertas explicadas. ---
const ESTADO_RENT_BADGE = {
  perdida: '<span class="badge badge-off" style="background:#FEF2F2;color:#DC2626;">Pérdida</span>',
  margen_bajo: '<span class="badge badge-warn">Margen bajo</span>',
  datos_incompletos: '<span class="badge badge-off" style="background:#F3F4F6;color:#6B7280;">Datos incompletos</span>',
  sin_pvp: '<span class="badge badge-off">Sin PVP</span>'
};
function explicacionTransporte(r){
  if (r.es_envio_directo_aft) return 'Envío directo de AFT (portes real por referencia)';
  if (r.transporte_cliente_origen === 'default' || (r.transporte_cliente_origen || '').indexOf(':') === -1) return 'Tarifa propia de respaldo (AFT no da portes para esta ref)';
  return 'Tarifa propia de respaldo (' + esc(r.transporte_cliente_origen) + ') — AFT no da portes para esta ref';
}
// Escenario de pedido agrupado: AFT permite agrupar pedidos, pero el coste
// depende del peso y todavía no hay tarifa verificada — por eso nunca se
// muestra un coste ni un margen aquí, solo el peso (si se conoce) y el
// estado. "Pendiente de cotización" es explícito, nunca se sustituye por
// la suma de portes individuales (eso sobrestimaría el coste real).
function celdaPedidoAgrupado(r){
  const pesoTxt = r.peso_gr != null ? (Number(r.peso_gr) / 1000).toFixed(1).replace(/\.0$/, '') + ' kg' : 'peso no disponible';
  if (r.escenario_agrupado_estado === 'pendiente_cotizacion') {
    return pesoTxt + '<div style="margin-top:2px;"><span class="badge badge-off" style="background:#EFF6FF;color:#2563EB;">Pendiente de cotización</span></div>';
  }
  return '<span style="color:var(--sub);">No aplica</span>';
}
function filaRentabilidad(r){
  const incompleta = r.estado_rentabilidad === 'datos_incompletos';
  return '<tr data-ref="' + esc((r.ref||'').toLowerCase()) + '" data-nombre="' + esc((r.descripcion||'').toLowerCase()) + '" data-estado="' + esc(r.estado_rentabilidad) + '">' +
    '<td data-label="Producto"><div style="font-weight:600;">' + esc(titleCase(r.descripcion || r.ref)) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(r.ref) + ' · ' + esc(titleCase(r.marca || '')) + '</div>' + (r.datos_incompletos_motivo ? '<div style="font-size:10.5px;color:#D97706;margin-top:2px;">' + esc(r.datos_incompletos_motivo) + '</div>' : '') + '</td>' +
    '<td class="num" data-label="Coste producto">' + (incompleta ? '—' : eur(r.coste_sin_iva)) + '</td>' +
    '<td class="num" data-label="+IVA/recargo">' + (incompleta ? '—' : eur(r.coste_con_impuestos)) + '</td>' +
    '<td class="num" data-label="Transporte">' + (incompleta ? '—' : eur(r.transporte_cliente)) + '<div style="font-size:10.5px;color:var(--sub);">' + explicacionTransporte(r) + '</div></td>' +
    '<td data-label="Pedido agrupado" style="font-size:11.5px;">' + celdaPedidoAgrupado(r) + '</td>' +
    '<td class="num" data-label="Comisión venta">' + (incompleta || r.comision_venta_importe == null ? '—' : eur(r.comision_venta_importe)) + '</td>' +
    '<td class="num" data-label="Coste total (estimado)">' + (incompleta ? '—' : eur(r.coste_total_estimado)) + '</td>' +
    '<td class="num" data-label="PVP">' + eur(r.pvp_real) + (r.pvp_es_real ? '' : ' <span style="font-size:10px;color:var(--sub);">(proyectado)</span>') + '</td>' +
    '<td class="num" data-label="Margen">' + (r.margen_pct != null ? '<span class="' + (r.margen_pct < 0 ? '' : 'ok') + '" style="' + (r.margen_pct < 0 ? 'color:#DC2626;font-weight:600;' : '') + '">' + pct(r.margen_pct) + '</span>' : '—') + '</td>' +
    '<td data-label="Estado">' + (ESTADO_RENT_BADGE[r.estado_rentabilidad] || esc(r.estado_rentabilidad)) + '</td>' +
    '</tr>';
}
// Resumen ejecutivo: solo cifras reales de la última ejecución guardada —
// nada calculado aparte, nada proyectado. Útil para una lectura de 5
// segundos antes de entrar en el detalle de la tabla.
const recomendacionesSeguroResumen = rentabilidadRecomendaciones || [];
const resumenEjecutivoHtml = ultimaRentabilidad
  ? '<div class="panel-card" style="padding:16px 18px;margin-bottom:18px;"><div style="font-weight:600;font-size:13px;margin-bottom:10px;">Resumen ejecutivo — última ejecución (' + esc(tiempoRelativo(ultimaRentabilidad.finished_at)) + ')</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12.5px;">' +
      '<div><span style="font-weight:700;font-size:16px;">' + num(ultimaRentabilidad.procesados) + '</span><br/><span style="color:var(--sub);">referencias analizadas</span></div>' +
      '<div><span style="font-weight:700;font-size:16px;color:#DC2626;">' + num(ultimaRentabilidad.en_perdida) + '</span><br/><span style="color:var(--sub);">en pérdida estimada</span></div>' +
      '<div><span style="font-weight:700;font-size:16px;color:#D97706;">' + num(ultimaRentabilidad.margen_bajo) + '</span><br/><span style="color:var(--sub);">con margen bajo</span></div>' +
      '<div><span style="font-weight:700;font-size:16px;color:#6B7280;">' + num(ultimaRentabilidad.diferencia_coste) + '</span><br/><span style="color:var(--sub);">con diferencia de coste vs. Shopify</span></div>' +
      '<div><span style="font-weight:700;font-size:16px;color:#059669;">' + recomendacionesSeguroResumen.filter(r => r.clasificacion_venta === 'individual').length + '</span><br/><span style="color:var(--sub);">rentables — venta individual</span></div>' +
      '<div><span style="font-weight:700;font-size:16px;color:#059669;">' + recomendacionesSeguroResumen.filter(r => r.clasificacion_venta === 'complementaria').length + '</span><br/><span style="color:var(--sub);">rentables — venta complementaria</span></div>' +
    '</div></div>'
  : '';
const rentabilidadResultadosSeguro = rentabilidadResultados || [];
const rentabilidadHtml = ultimaRentabilidad
  ? (rentabilidadResultadosSeguro.length
      ? '<div class="filterbar"><input type="text" id="buscarRentabilidad" class="filter-select" placeholder="Buscar por ref o nombre..." style="flex:1;max-width:280px;" oninput="filtrarRentabilidad()"/>' +
          '<select id="filtroEstadoRentabilidad" class="filter-select" onchange="filtrarRentabilidad()"><option value="">Todos (ordenados por riesgo)</option><option value="perdida">Pérdida</option><option value="datos_incompletos">Datos incompletos</option><option value="margen_bajo">Margen bajo</option></select></div>' +
        '<div class="table-note" id="contadorRentabilidad">Mostrando ' + rentabilidadResultadosSeguro.length + ' de ' + pl(rentabilidadResultadosSeguro.length, 'producto que requiere atención', 'productos que requieren atención') + ' (de ' + num(ultimaRentabilidad.procesados) + ' analizados), ordenados por riesgo: pérdida primero, después datos incompletos, después margen bajo.</div>' +
        '<div class="table-scroll"><table><thead><tr><th>Producto</th><th>Coste producto</th><th>+IVA/recargo</th><th>Transporte</th><th>Pedido agrupado</th><th>Comisión venta</th><th>Coste total (estimado)</th><th>PVP</th><th>Margen</th><th>Estado</th></tr></thead><tbody id="tablaRentabilidadBody">' +
        rentabilidadResultadosSeguro.map(filaRentabilidad).join('') +
        '</tbody></table></div>' +
        '<p style="font-size:11.5px;color:var(--sub);margin-top:10px;">El coste total se marca "(estimado)": el tratamiento fiscal de los portes de AFT (si el IVA ya está incluido en ese importe) todavía no está confirmado. El "Transporte" usa el portes real de AFT por referencia cuando está disponible (envío directo); solo se usa una tarifa propia de respaldo cuando AFT no da portes para esa ref — nunca se suman ambos. El coste registrado en Shopify tampoco se usa para calcular el margen (su IVA no está confirmado), solo para la alerta de diferencia de coste. "Pedido agrupado" muestra el peso total de la referencia cuando AFT da envío directo, pero el coste de agrupar varios productos en un mismo pedido queda "Pendiente de cotización": AFT no ha confirmado todavía una tarifa por peso para pedidos agrupados, y nunca se suman los portes individuales como sustituto (sobrestimaría el coste real) ni se calcula un margen para ese escenario.</p>' +
        '<h3 style="font-size:14px;margin:28px 0 12px;">Historial de alertas</h3>' +
        (rentabilidadAlertas && rentabilidadAlertas.length
          ? '<div class="panel-card">' + rentabilidadAlertas.slice(0, 50).map(a => '<div class="tl-row"><div class="tl-dot" style="background:' + (a.tipo === 'perdida' ? '#DC2626' : (a.tipo === 'datos_incompletos' ? '#6B7280' : '#D97706')) + '"></div><div class="tl-body"><div class="tl-text">' + esc(a.detalle) + '</div><div class="tl-time">' + esc(tiempoRelativo(a.detectado_en)) + '</div></div></div>').join('') + '</div>'
          : '<div class="empty-state">Sin alertas registradas todavía.</div>')
      : '<div class="empty-state">La última ejecución no encontró productos en pérdida, con margen bajo ni con datos incompletos.</div>')
  : '<div class="empty-state">El agente de rentabilidad todavía no se ha ejecutado. Lánzalo desde Integraciones.</div>';

// Recomendaciones de venta (puntos 6-8 del ajuste comercial): separa venta
// individual destacada de venta complementaria (producto de bajo precio,
// candidato a cross-sell), excluyendo siempre los productos de margen
// insuficiente o con datos incompletos (esos quedan en la tabla de arriba).
// Dentro de cada grupo, los productos YA publicados en Shopify van primero
// que las oportunidades AFT nuevas (PVP todavía proyectado).
function filaRecomendacion(r){
  const origen = r.pvp_es_real
    ? '<span class="badge badge-ok">Publicado en Shopify</span>'
    : '<span class="badge badge-off" style="background:#F3F4F6;color:#6B7280;">Oportunidad AFT nueva</span>';
  return '<tr>' +
    '<td data-label="Producto"><div style="font-weight:600;">' + esc(titleCase(r.descripcion || r.ref)) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(r.ref) + ' · ' + esc(titleCase(r.marca || '')) + '</div></td>' +
    '<td data-label="Origen">' + origen + '</td>' +
    '<td class="num" data-label="PVP">' + eur(r.pvp_real) + (r.pvp_es_real ? '' : ' <span style="font-size:10px;color:var(--sub);">(proyectado)</span>') + '</td>' +
    '<td class="num" data-label="Coste total (estimado)">' + eur(r.coste_total_estimado) + '</td>' +
    '<td class="num" data-label="Margen">' + (r.margen_pct != null ? pct(r.margen_pct) : '—') + '</td>' +
    '<td data-label="Pedido agrupado" style="font-size:11.5px;">' + celdaPedidoAgrupado(r) + '</td>' +
    '</tr>';
}
const recomendacionesSeguro = rentabilidadRecomendaciones || [];
const recIndividual = recomendacionesSeguro.filter(r => r.clasificacion_venta === 'individual');
const recComplementaria = recomendacionesSeguro.filter(r => r.clasificacion_venta === 'complementaria');
function tablaRecomendaciones(filas, vacioTexto){
  if (!filas.length) return '<div class="empty-state">' + vacioTexto + '</div>';
  return '<div class="table-scroll"><table><thead><tr><th>Producto</th><th>Origen</th><th>PVP</th><th>Coste total (estimado)</th><th>Margen</th><th>Pedido agrupado</th></tr></thead><tbody>' +
    filas.map(filaRecomendacion).join('') + '</tbody></table></div>';
}
const recomendacionesHtml = ultimaRentabilidad
  ? '<h3 style="font-size:14px;margin:32px 0 6px;">Recomendaciones de venta</h3>' +
    '<p style="font-size:11.5px;color:var(--sub);margin:0 0 14px;">Solo productos con margen suficiente (fuera de la tabla de atención de arriba). Los productos ya publicados en Shopify se listan antes que las nuevas oportunidades de AFT (PVP todavía proyectado, sin coincidencia real).</p>' +
    '<h4 style="font-size:12.5px;margin:0 0 8px;color:var(--sub);text-transform:uppercase;letter-spacing:.04em;">Venta individual (' + recIndividual.length + ')</h4>' +
    tablaRecomendaciones(recIndividual, 'Ningún producto con margen suficiente para destacar como venta individual todavía.') +
    '<h4 style="font-size:12.5px;margin:24px 0 8px;color:var(--sub);text-transform:uppercase;letter-spacing:.04em;">Venta complementaria — PVP ≤ ' + num(pvpComplementoMax) + '€ (' + recComplementaria.length + ')</h4>' +
    tablaRecomendaciones(recComplementaria, 'Ningún producto de bajo precio detectado como candidato a complemento todavía.')
  : '';

// --- Página Productos: catálogo COMPLETO de Shopify (todas las variantes,
//     no solo 100 productos ni la primera variante), con 4 filtros
//     independientes. "Proveedor" viene solo del matching real por EAN/SKU
//     contra AFT — nunca del vendor de Shopify (vendor_shopify se muestra
//     aparte, como dato informativo, nunca como criterio de identificación).
//     Los productos sin coincidencia fiable se marcan "Sin identificar",
//     nunca se adivina ni se etiqueta como un proveedor concreto. ---
const ESTADO_PRODUCTO_LABEL = { ACTIVE: 'Activo', DRAFT: 'Borrador', ARCHIVED: 'Archivado' };
function badgeEstadoProducto(estado){
  if (estado === 'DRAFT') return '<span class="badge badge-off">Borrador</span>';
  if (estado === 'ARCHIVED') return '<span class="badge badge-off">Archivado</span>';
  return '<span class="badge badge-ok">Activo</span>';
}
function filaProducto(p){
  const img = p.imagen ? '<img src="' + p.imagen + '" style="width:32px;height:32px;object-fit:contain;border-radius:6px;background:#F1F2F4;"/>' : '<div style="width:32px;height:32px;border-radius:6px;background:#F1F2F4;"></div>';
  const disponibilidad = p.stock > 0 ? 'con_stock' : 'sin_stock';
  return '<tr data-nombre="' + esc((p.titulo||'').toLowerCase()) + '" data-vendor="' + esc(p.vendorShopify || '') + '" data-estado="' + esc(p.estado || '') + '" data-proveedor="' + (p.esAft ? 'aft' : 'sin_identificar') + '" data-disponibilidad="' + disponibilidad + '">' +
    '<td data-label="">' + img + '</td>' +
    '<td data-label="Producto">' + esc(p.titulo) + '<div style="font-size:11px;color:var(--sub);">' + esc(p.sku || '') + '</div></td>' +
    '<td data-label="Proveedor">' + (p.esAft ? '<span class="badge badge-ok">' + esc(p.proveedor) + '</span>' : '<span class="badge badge-off">Sin identificar</span>') + '</td>' +
    '<td data-label="Marca (Shopify)">' + esc(p.vendorShopify || '—') + '</td>' +
    '<td class="num" data-label="Precio">' + eur(p.precio) + '</td>' +
    '<td class="num" data-label="Stock">' + (p.stock == null ? '—' : p.stock) + '</td>' +
    '<td data-label="Estado">' + badgeEstadoProducto(p.estado) + '</td>' +
    '<td data-label="Enlaces">' + enlaceShopify(p.productId) + (p.esAft ? '<div style="margin-top:4px;">' + copiarReferenciaBtn(p.aftRef) + '</div>' : '') + '</td></tr>';
}
const vendoresShopify = Array.from(new Set(shopifyProducts.map(p => p.vendorShopify).filter(Boolean))).sort();
const productosHtml = shopifyProducts.length
  ? '<div class="filterbar">' +
      '<input type="text" id="buscarProducto" class="filter-select" placeholder="Buscar por nombre..." style="flex:1;max-width:220px;" oninput="filtrarProductos()"/>' +
      '<select id="filtroProveedorProducto" class="filter-select" onchange="filtrarProductos()"><option value="">Proveedor: todos</option><option value="aft">AFT</option><option value="sin_identificar">Sin identificar</option></select>' +
      '<select id="filtroVendorProducto" class="filter-select" onchange="filtrarProductos()"><option value="">Marca (Shopify): todas</option>' + vendoresShopify.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('') + '</select>' +
      '<select id="filtroEstadoProducto" class="filter-select" onchange="filtrarProductos()"><option value="">Estado: todos</option><option value="ACTIVE">Activo</option><option value="DRAFT">Borrador</option><option value="ARCHIVED">Archivado</option></select>' +
      '<select id="filtroDisponibilidadProducto" class="filter-select" onchange="filtrarProductos()"><option value="">Disponibilidad: todas</option><option value="con_stock">Con stock</option><option value="sin_stock">Sin stock</option></select>' +
    '</div>' +
    '<div class="table-note" id="contadorProductos">Mostrando ' + shopifyProducts.length + ' de ' + pl(shopifyProducts.length, 'variante', 'variantes') + (totalesCatalogo ? ' (' + pl(totalesCatalogo.total_productos, 'producto distinto', 'productos distintos') + ', ' + pl(totalesCatalogo.total_variantes, 'variante', 'variantes') + ' en total en el catálogo leído)' : '') + '.</div>' +
    '<div class="table-scroll"><table><thead><tr><th></th><th>Producto</th><th>Proveedor</th><th>Marca (Shopify)</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Enlaces</th></tr></thead><tbody id="tablaProductosBody">' +
    shopifyProducts.map(filaProducto).join('') +
    '</tbody></table></div>' +
    '<p style="font-size:11.5px;color:var(--sub);margin-top:10px;">"Proveedor" solo se marca como AFT cuando hubo una coincidencia fiable por EAN o SKU con el catálogo AFT — nunca se infiere del campo "Marca (Shopify)" (vendor), que puede contener valores que no son marcas reales (p. ej. textos de envío). "Ver en Shopify" enlaza siempre al producto (nunca a la variante) usando su ID real leído de la API; sin ese ID guardado (catálogo pendiente de re-sincronizar) se muestra "Sin ID de producto" en vez de un enlace roto.</p>'
  : '<div class="empty-state">Todavía no se ha leído el catálogo de Shopify. Ejecuta una sincronización desde Integraciones.</div>';

// --- Integraciones: estado real de los dos agentes operativos, y los
//     pendientes de recuperar mostrados aparte y sin ningún botón activo. ---
function estadoImport(){
  if (!ultimaImport) return { dot: 'dot-warn', texto: 'Nunca ejecutada' };
  if (ultimaImport.status === 'running') return { dot: 'dot-warn', texto: 'En curso…' };
  if (ultimaImport.status === 'error') return { dot: 'dot-err', texto: 'Error en la última importación' };
  return { dot: 'dot-ok', texto: 'Actualizado ' + tiempoRelativo(ultimaImport.finished_at) };
}
function estadoSync(){
  if (!ultimoSync) return { dot: 'dot-warn', texto: 'Nunca ejecutada' };
  if (ultimoSync.status === 'running') return { dot: 'dot-warn', texto: 'En curso…' };
  if (ultimoSync.status === 'error') return { dot: 'dot-err', texto: 'Error en la última comparación' };
  if (ultimoSync.permisos_incompletos) return { dot: 'dot-warn', texto: 'Completa, con permisos incompletos' };
  return { dot: 'dot-ok', texto: 'Completa ' + tiempoRelativo(ultimoSync.finished_at) };
}
function estadoRentabilidad(){
  if (!ultimaRentabilidad) return { dot: 'dot-warn', texto: 'Nunca ejecutado' };
  if (ultimaRentabilidad.status === 'running') return { dot: 'dot-warn', texto: 'En curso…' };
  if (ultimaRentabilidad.status === 'error') return { dot: 'dot-err', texto: 'Error en el último análisis' };
  return { dot: 'dot-ok', texto: 'Actualizado ' + tiempoRelativo(ultimaRentabilidad.finished_at) };
}
function estadoPipeline(){
  if (!ultimoPipeline) return { dot: 'dot-warn', texto: 'Nunca ejecutado' };
  if (ultimoPipeline.status === 'running') {
    const etiquetaEtapa = { import_aft: 'importando AFT', sync_shopify: 'sincronizando Shopify', rentabilidad: 'calculando rentabilidad' }[ultimoPipeline.etapa] || 'en curso';
    return { dot: 'dot-warn', texto: 'En curso — ' + etiquetaEtapa + '…' };
  }
  if (ultimoPipeline.status === 'error') return { dot: 'dot-err', texto: 'Error en la última ejecución' };
  return { dot: 'dot-ok', texto: 'Completo ' + tiempoRelativo(ultimoPipeline.finished_at) };
}
const eImport = estadoImport();
const eSync = estadoSync();
const eRent = estadoRentabilidad();
const ePipeline = estadoPipeline();
const AGENTES_PENDIENTES = [
  { nombre: 'Fichas automáticas (IA)', detalle: 'Generación y revisión de fichas nuevas en Shopify.' },
  { nombre: 'Señales de demanda / keywords', detalle: 'Volumen de búsqueda, interés por producto y palabras clave (SEO).' },
  { nombre: 'Scoring de oportunidades con demanda externa', detalle: 'El ranking actual de Oportunidades ya usa datos reales (marca prioritaria + margen); esto añadiría demanda de mercado externa, que todavía no está conectada.' }
];
const integracionesHtml =
  '<div class="integ-card">' +
    '<div class="integ-row"><span class="dot ' + eImport.dot + '" id="aftEstadoDot"></span><div><div class="integ-name">Importación AFT</div><div class="integ-sub">Catálogo/categorías/stock desde AFT a hmt-db</div></div><span class="integ-status" id="aftEstadoTexto">' + esc(eImport.texto) + '</span></div>' +
    '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><button class="btn-solid btn-sm" onclick="importarAFT(this)">Importar AFT</button><span id="importarAFTResultado" class="integ-sub"></span></div>' +
    (ultimaImport ? '<div class="integ-sub" style="margin-top:8px;">Última: ' + num(ultimaImport.productos_insertados) + ' productos · ' + num(ultimaImport.stock_insertado) + ' filas de stock · ' + num(ultimaImport.incidencias) + ' incidencias</div>' : '') +
  '</div>' +
  '<div class="integ-card">' +
    '<div class="integ-row"><span class="dot ' + eSync.dot + '" id="syncEstadoDot"></span><div><div class="integ-name">Comparación Shopify ↔ AFT</div><div class="integ-sub">Solo lectura — nunca escribe en Shopify</div></div><span class="integ-status" id="syncEstadoTexto">' + esc(eSync.texto) + '</span></div>' +
    '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><button class="btn-solid btn-sm" onclick="sincronizarShopify(this)">Sincronizar Shopify ↔ AFT</button><span id="sincronizarResultado" class="integ-sub"></span></div>' +
    (ultimoSync ? '<div class="integ-sub" style="margin-top:8px;">Última: ' + num(ultimoSync.shopify_variantes_leidas) + ' variantes Shopify (' + num(ultimoSync.shopify_paginas_leidas) + ' páginas) · ' + num(ultimoSync.total_matched) + ' coincidencias · ' + num(ultimoSync.total_incidencias) + ' incidencias' + (ultimoSync.permisos_incompletos ? ' · faltan permisos: ' + esc((ultimoSync.permisos_detalle || '').slice(0, 140)) : '') + '</div>' : '') +
  '</div>' +
  '<div class="integ-card">' +
    '<div class="integ-row"><span class="dot ' + eRent.dot + '" id="rentEstadoDot"></span><div><div class="integ-name">Rentabilidad</div><div class="integ-sub">Coste desglosado + transporte configurado + alertas — solo lee hmt-db</div></div><span class="integ-status" id="rentEstadoTexto">' + esc(eRent.texto) + '</span></div>' +
    '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><button class="btn-solid btn-sm" onclick="ejecutarRentabilidad(this)">Analizar rentabilidad</button><span id="rentResultado" class="integ-sub"></span></div>' +
    (ultimaRentabilidad ? '<div class="integ-sub" style="margin-top:8px;">Última: ' + num(ultimaRentabilidad.procesados) + ' analizados · ' + num(ultimaRentabilidad.en_perdida) + ' en pérdida · ' + num(ultimaRentabilidad.margen_bajo) + ' margen bajo · ' + num(ultimaRentabilidad.diferencia_coste) + ' con diferencia de coste</div>' : '') +
  '</div>' +
  '<div class="integ-card">' +
    '<div class="integ-row"><span class="dot ' + ePipeline.dot + '" id="pipelineEstadoDot"></span><div><div class="integ-name">Pipeline completo (automatización)</div><div class="integ-sub">Importar AFT → Sincronizar Shopify (solo lectura) → Rentabilidad, en secuencia</div></div><span class="integ-status" id="pipelineEstadoTexto">' + esc(ePipeline.texto) + '</span></div>' +
    '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><button class="btn-solid btn-sm" onclick="ejecutarPipeline(this)">Ejecutar pipeline completo</button><span id="pipelineResultado" class="integ-sub"></span></div>' +
    '<div class="integ-sub" style="margin-top:8px;">Solo se ejecuta cuando lo lanzas aquí o si se activa explícitamente la variable de entorno PIPELINE_SCHEDULE_HOURS — desplegar este código no programa nada por sí solo.</div>' +
  '</div>' +
  '<div class="integ-card">' +
    '<div class="integ-name" style="margin-bottom:10px;">Agentes pendientes de recuperar</div>' +
    AGENTES_PENDIENTES.map(a => '<div class="integ-row" style="margin-bottom:8px;"><span class="dot" style="background:#D1D5DB;"></span><div><div class="integ-name" style="font-size:12.5px;">' + esc(a.nombre) + '</div><div class="integ-sub">' + esc(a.detalle) + '</div></div><span class="integ-status" style="color:#9CA3AF;">No conectado</span></div>').join('') +
    '<div class="integ-sub" style="margin-top:4px;">Estas funciones existían en el panel original (de otros agentes, fuera de este repositorio) y todavía no se han conectado a una fuente de datos real — el panel no simula sus resultados.</div>' +
  '</div>';

// --- HTML completo ---
const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>AFT Intelligence — Herramitienda</title><style>' +
"@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');" +
'*{box-sizing:border-box;margin:0;padding:0;}' +
':root{--bg:#F7F8FA;--card:#FFFFFF;--border:#E5E7EB;--ink:#111827;--sub:#667085;--brand:#087F78;--brand-dark:#066b65;}' +
'body{background:var(--bg);color:var(--ink);font-family:"Inter",-apple-system,sans-serif;display:flex;min-height:100vh;font-size:14px;-webkit-font-smoothing:antialiased;}' +
'.sidebar{width:236px;background:#fff;border-right:1px solid var(--border);flex-shrink:0;min-height:100vh;position:sticky;top:0;display:flex;flex-direction:column;padding:22px 0;}' +
'.sb-logo{display:flex;align-items:center;gap:9px;padding:0 22px 6px;}' +
'.sb-logo-mark{width:26px;height:26px;border-radius:7px;background:var(--brand);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0;}' +
'.sb-brand{font-weight:800;font-size:14.5px;letter-spacing:-0.01em;line-height:1.2;}' +
'.sb-sub{font-size:10.5px;color:var(--sub);font-weight:500;}' +
'.sb-nav{flex:1;margin-top:22px;padding:0 10px;}' +
'.sb-link{display:flex;align-items:center;gap:11px;padding:8px 12px;color:var(--sub);text-decoration:none;font-weight:500;font-size:13.5px;cursor:pointer;border-radius:8px;margin-bottom:2px;}' +
'.sb-link svg{flex-shrink:0;}' +
'.sb-link:hover{background:#F7F8FA;color:var(--ink);}' +
'.sb-link.active{background:#EAF5F4;color:var(--brand-dark);font-weight:600;}' +
'.sb-sep{height:1px;background:var(--border);margin:10px 22px;}' +
'.sb-foot{padding:12px 16px;margin:0 10px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;padding-top:16px;}' +
'.sb-foot-mark{width:30px;height:30px;border-radius:8px;background:var(--brand);flex-shrink:0;}' +
'.sb-foot .name{font-weight:600;font-size:12.5px;}' +
'.sb-foot .status{font-size:11px;color:#059669;display:flex;align-items:center;gap:4px;}' +
'main{flex:1;padding:34px 40px 60px;max-width:1240px;}' +
'.page{display:none;} .page.active{display:block;}' +
'.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;gap:12px;flex-wrap:wrap;}' +
'.header h1{font-size:23px;font-weight:800;letter-spacing:-0.02em;}' +
'.header .sub{color:var(--sub);margin-top:5px;font-size:14px;}' +
'.header-right{display:flex;align-items:center;gap:16px;}' +
'.updated{font-size:12.5px;color:var(--sub);white-space:nowrap;}' +
'.avatar{width:32px;height:32px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12.5px;}' +
'.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:34px;}' +
'.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;}' +
'.kpi-clickable{cursor:pointer;transition:border-color 0.15s,transform 0.1s;}' +
'.kpi-clickable:hover{border-color:var(--brand);}' +
'.kpi-clickable:active{transform:scale(0.98);}' +
'.kpi-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;}' +
'.kpi-n{font-size:25px;font-weight:800;letter-spacing:-0.02em;line-height:1;}' +
'.kpi-l{font-size:12.5px;color:var(--sub);margin-top:6px;font-weight:500;}' +
'.sec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}' +
'.sec-head h2{font-size:16px;font-weight:700;letter-spacing:-0.01em;display:flex;align-items:center;gap:7px;}' +
'.sec-link{font-size:12.5px;color:var(--brand-dark);font-weight:600;text-decoration:none;cursor:pointer;display:flex;align-items:center;gap:3px;}' +
'section.block{margin-bottom:34px;}' +
'.attn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;}' +
'.attn-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;}' +
'.attn-icon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;}' +
'.attn-title{font-weight:700;font-size:13.5px;line-height:1.3;}' +
'.attn-desc{font-size:12.5px;color:var(--sub);margin-top:5px;line-height:1.4;}' +
'.btn-outline{margin-top:14px;background:#fff;border:1px solid var(--border);color:var(--ink);padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;text-decoration:none;}' +
'.btn-solid{background:var(--brand);border:1px solid var(--brand);color:#fff;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;}' +
'.row-clickable{cursor:pointer;}' +
'.row-clickable:hover{background:#FAFAFA;}' +
'.bottom-grid{display:grid;grid-template-columns:65fr 35fr;gap:20px;align-items:start;}' +
'.panel-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:8px 20px;}' +
'.tl-row{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid var(--border);}' +
'.tl-row:last-child{border-bottom:none;}' +
'.tl-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;}' +
'.tl-text{font-size:13px;font-weight:500;}' +
'.tl-time{font-size:11.5px;color:var(--sub);margin-top:2px;}' +
'.empty-state{color:var(--sub);font-size:13px;text-align:center;padding:30px 20px;}' +
'.integ-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:10px;}' +
'.integ-row{display:flex;align-items:center;gap:12px;}' +
'.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}' +
'.dot-ok{background:#059669;}' +
'.dot-warn{background:#D97706;}' +
'.dot-err{background:#DC2626;}' +
'.integ-name{font-weight:700;font-size:13.5px;}' +
'.integ-sub{font-size:11.5px;color:var(--sub);margin-top:2px;}' +
'.integ-status{margin-left:auto;font-size:12px;color:var(--sub);font-weight:600;}' +
'table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;}' +
'th{text-align:left;font-size:11.5px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:0.02em;padding:12px 16px;border-bottom:1px solid var(--border);background:#FAFAFA;white-space:nowrap;}' +
'td{padding:12px 16px;font-size:13px;border-bottom:1px solid var(--border);}' +
'tr:last-child td{border-bottom:none;}' +
'td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
'.ok{color:#059669;font-weight:600;}' +
'.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
'.table-note{font-size:12px;color:var(--sub);margin-bottom:10px;}' +
'.badge{font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;white-space:nowrap;}' +
'.badge-warn{background:#FFFBEB;color:#D97706;}' +
'.badge-ok{background:#ECFDF5;color:#059669;}' +
'.badge-off{background:#F3F4F6;color:var(--sub);}' +
'.btn-sm{padding:5px 10px;font-size:11.5px;margin-top:0;}' +
'.filterbar{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;}' +
'.filter-select{font-size:12.5px;font-weight:500;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--ink);}' +
'.stale-banner{display:flex;align-items:center;gap:10px;background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:24px;}' +
'.pagetitle{font-size:20px;font-weight:800;margin-bottom:20px;letter-spacing:-0.02em;}' +
'.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:-2px;}' +
'.spinner.dark{border:2px solid rgba(0,0,0,0.15);border-top-color:var(--ink);}' +
'@keyframes spin{to{transform:rotate(360deg);}}' +
'.hamburger{display:none;margin-left:auto;background:none;border:1px solid var(--border);border-radius:8px;width:32px;height:32px;font-size:16px;cursor:pointer;color:var(--ink);}' +
'@media(max-width:700px){table thead{display:none;}table,table tbody,table tr,table td{display:block;width:100%;}table tr{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;padding:4px 0;background:#fff;}table td{border-bottom:none;padding:6px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:right;}table td.num{text-align:right;}table td::before{content:attr(data-label);font-size:11px;color:var(--sub);font-weight:600;text-align:left;}table td:empty{display:none;}.table-scroll{overflow-x:visible;}}' +
'@media(max-width:900px){.kpi-row{grid-template-columns:repeat(2,1fr);}.attn-grid{grid-template-columns:1fr;}.bottom-grid{grid-template-columns:1fr;}body{flex-direction:column;}.sidebar{width:100%;min-height:auto;position:relative;}.sb-logo{padding-right:16px;}.hamburger{display:block;}.sb-nav{display:none;margin-top:10px;}.sb-nav.open{display:block;}main{padding:20px;}}' +
'@media(max-width:480px){.header{flex-direction:column;align-items:stretch;margin-bottom:18px;gap:8px;}.header h1{font-size:19px;}.header .sub{font-size:13px;}.header-right{justify-content:flex-end;gap:10px;margin-top:2px;flex-wrap:wrap;}.updated{font-size:11px;}.sb-logo{padding:0 16px 4px;}.sb-foot{display:none;}.sidebar{padding:12px 0;}main{padding:14px;}.kpi-row{gap:10px;margin-bottom:22px;}.kpi{padding:12px 14px;}.kpi-icon{width:26px;height:26px;margin-bottom:7px;}.kpi-n{font-size:21px;}.kpi-l{font-size:11px;}}' +
'</style></head><body>' +

'<nav class="sidebar" id="sidebar">' +
'<div class="sb-logo"><div class="sb-logo-mark">H</div><div><div class="sb-brand">HERRAMITIENDA</div><div class="sb-sub">AFT Intelligence</div></div><button class="hamburger" onclick="toggleNav()" aria-label="Abrir menú">☰</button></div>' +
'<div class="sb-nav" id="sbNav">' +
'<a class="sb-link active" data-page="inicio" onclick="ir(this)">' + icon('home', 17) + '<span>Inicio</span></a>' +
'<a class="sb-link" data-page="coincidencias" onclick="ir(this)">' + icon('check', 17) + '<span>Coincidencias</span></a>' +
'<a class="sb-link" data-page="oportunidades" onclick="ir(this)">' + icon('sparkles', 17) + '<span>Oportunidades</span></a>' +
'<a class="sb-link" data-page="productos" onclick="ir(this)">' + icon('box', 17) + '<span>Productos</span></a>' +
'<a class="sb-link" data-page="rentabilidad" onclick="ir(this)">' + icon('alertTri', 17) + '<span>Rentabilidad</span></a>' +
'<a class="sb-link" data-page="actividad" onclick="ir(this)">' + icon('activity', 17) + '<span>Actividad</span></a>' +
'<div class="sb-sep"></div>' +
'<a class="sb-link" data-page="integraciones" onclick="ir(this)">' + icon('plug', 17) + '<span>Integraciones</span></a>' +
'<a class="sb-link" data-page="configuracion" onclick="ir(this)">' + icon('settings', 17) + '<span>Configuración</span></a>' +
'</div>' +
'<div class="sb-foot"><div class="sb-foot-mark"></div><div><div class="name">Herramitienda</div><div class="status">' + icon('check', 11) + ' AFT 2.0</div></div></div>' +
'</nav>' +

'<main>' +

'<div class="page active" id="page-inicio">' +
(datosDesactualizados && ultimoSync ? '<div class="stale-banner">' + icon('alertTri', 16) + '<span>Los datos no se actualizan desde hace más de ' + HORAS_LIMITE_DESACTUALIZADO + ' horas (última comparación: ' + esc(tiempoRelativo(ultimoSync.finished_at)) + '). Ejecuta una nueva sincronización desde Integraciones.</span></div>' : '') +
'<div class="header"><div><h1>AFT Intelligence</h1><div class="sub">Control de inventario y oportunidades entre AFT y Shopify — solo lectura.</div></div>' +
'<div class="header-right">' + (ultimoSync ? '<div class="updated">Última comparación: ' + esc(tiempoRelativo(ultimoSync.finished_at)) + '</div>' : '') + '<div class="avatar">H</div></div></div>' +
'<div class="kpi-row">' + kpiHtml + '</div>' +
'<section class="block" id="attnSection"><div class="sec-head"><h2>Necesita tu atención</h2></div><div class="attn-grid">' + atencionHtml + '</div></section>' +
'<div class="bottom-grid">' +
'<section class="block"><div class="sec-head"><h2>Actividad reciente</h2><a class="sec-link" data-page="actividad" onclick="ir(this)">Ver toda la actividad ' + icon('chevron', 12) + '</a></div><div class="panel-card">' + timelineHtmlResumen + '</div></section>' +
'<section class="block"><div class="sec-head"><h2>Integraciones</h2><a class="sec-link" data-page="integraciones" onclick="ir(this)">Ver detalle ' + icon('chevron', 12) + '</a></div><div class="panel-card" style="padding:16px 18px;"><div class="integ-row"><span class="dot ' + eImport.dot + '"></span><div><div class="integ-name" style="font-size:12.5px;">Importación AFT</div></div><span class="integ-status">' + esc(eImport.texto) + '</span></div><div class="integ-row" style="margin-top:10px;"><span class="dot ' + eSync.dot + '"></span><div><div class="integ-name" style="font-size:12.5px;">Comparación Shopify ↔ AFT</div></div><span class="integ-status">' + esc(eSync.texto) + '</span></div></div></section>' +
'</div>' +
'</div>' +

'<div class="page" id="page-coincidencias"><div class="pagetitle">Coincidencias AFT ↔ Shopify</div>' + coincidenciasHtml + '</div>' +

'<div class="page" id="page-oportunidades"><div class="pagetitle">Oportunidades comerciales</div>' + oportunidadesHtml + '</div>' +

'<div class="page" id="page-productos"><div class="pagetitle">Productos en Shopify</div>' + productosHtml + '</div>' +

'<div class="page" id="page-rentabilidad"><div class="pagetitle">Rentabilidad</div>' + resumenEjecutivoHtml + rentabilidadHtml + recomendacionesHtml + '</div>' +

'<div class="page" id="page-actividad"><div class="pagetitle">Actividad</div><div class="panel-card">' + timelineHtml + '</div></div>' +

'<div class="page" id="page-integraciones"><div class="pagetitle">Integraciones</div>' + integracionesHtml + '</div>' +

'<div class="page" id="page-configuracion"><div class="pagetitle">Configuración</div><div class="empty-state">Próximamente.</div></div>' +

'</main><script>' +
'function ir(btn){var id=btn.getAttribute("data-page");document.querySelectorAll(".sb-link").forEach(function(a){a.classList.remove("active");if(a.getAttribute("data-page")===id)a.classList.add("active");});document.querySelectorAll(".page").forEach(function(p){p.classList.remove("active")});document.getElementById("page-"+id).classList.add("active");window.scrollTo(0,0);document.getElementById("sbNav").classList.remove("open");}' +
'function copiarReferencia(btn,ref){var original=btn.innerHTML;function ok(){btn.innerHTML="Copiado ✓";setTimeout(function(){btn.innerHTML=original;},1500);}function fallback(){try{var ta=document.createElement("textarea");ta.value=ref;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.focus();ta.select();document.execCommand("copy");document.body.removeChild(ta);ok();}catch(e){btn.innerHTML="Ref: "+ref;}}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ref).then(ok).catch(fallback);}else{fallback();}}' +
'function toggleNav(){document.getElementById("sbNav").classList.toggle("open");}' +
'function filtrarCoincidencias(){var q=(document.getElementById("buscarCoincidencia").value||"").toLowerCase();var estado=document.getElementById("filtroEstadoCoincidencia").value;var visibles=0;document.querySelectorAll("#tablaCoincidenciasBody tr").forEach(function(r){var okTexto=r.dataset.ref.indexOf(q)>-1||r.dataset.nombre.indexOf(q)>-1;var okEstado=!estado||r.dataset.estado===estado;var match=okTexto&&okEstado;r.style.display=match?"":"none";if(match)visibles++;});var c=document.getElementById("contadorCoincidencias");var total=document.querySelectorAll("#tablaCoincidenciasBody tr").length;if(c)c.textContent="Mostrando "+visibles+" de "+total+(total===1?" coincidencia.":" coincidencias.");}' +
'function filtrarOportunidades(){var marca=document.getElementById("filtroMarca").value;var margen=parseFloat(document.getElementById("filtroMargen").value)||0;document.querySelectorAll("#tablaOportunidadesBody tr").forEach(function(r){var okMarca=!marca||r.dataset.marca===marca;var okMargen=(parseFloat(r.dataset.margen)||0)>=margen;r.style.display=(okMarca&&okMargen)?"":"none";});}' +
'function filtrarProductos(){var q=document.getElementById("buscarProducto").value.toLowerCase();var proveedor=document.getElementById("filtroProveedorProducto").value;var vendor=document.getElementById("filtroVendorProducto").value;var estado=document.getElementById("filtroEstadoProducto").value;var disponibilidad=document.getElementById("filtroDisponibilidadProducto").value;var visibles=0;document.querySelectorAll("#tablaProductosBody tr").forEach(function(r){if(!r.dataset.nombre)return;var okTexto=r.dataset.nombre.indexOf(q)>-1;var okProveedor=!proveedor||r.dataset.proveedor===proveedor;var okVendor=!vendor||r.dataset.vendor===vendor;var okEstado=!estado||r.dataset.estado===estado;var okDisponibilidad=!disponibilidad||r.dataset.disponibilidad===disponibilidad;var match=okTexto&&okProveedor&&okVendor&&okEstado&&okDisponibilidad;r.style.display=match?"":"none";if(match)visibles++;});var total=document.querySelectorAll("#tablaProductosBody tr[data-nombre]").length;var c=document.getElementById("contadorProductos");if(c)c.textContent="Mostrando "+visibles+" de "+total+(total===1?" variante.":" variantes.");}' +
'var aftPollTimer=null;' +
'function pararPollAFT(){if(aftPollTimer){clearInterval(aftPollTimer);aftPollTimer=null;}}' +
'function formatearFaseAFT(run){if(!run)return "Iniciando...";if(run.status==="running"){var fase=run.fase||"procesando";var detalle="";if(fase==="productos")detalle=" ("+(run.productos_insertados||0)+"/"+(run.total_productos||0)+")";else if(fase==="stock")detalle=" ("+(run.stock_insertado||0)+"/"+(run.total_stock||0)+")";else if(fase==="categorias")detalle=" ("+(run.categorias_insertadas||0)+"/"+(run.total_categorias||0)+")";return "Importando: "+fase+detalle+"...";}if(run.status==="success"){return "Categor\\u00edas: "+(run.categorias_insertadas||0)+" \\u00b7 Productos: "+(run.productos_insertados||0)+" \\u00b7 Stock: "+(run.stock_insertado||0)+" \\u00b7 Incidencias: "+(run.incidencias||0)+(run.stock_huerfano?" \\u00b7 "+run.stock_huerfano+" sin producto":"");}if(run.status==="error"){return "Error: "+(run.error_message||"desconocido");}return "";}' +
'function pollAFTEstado(btn,out){pararPollAFT();aftPollTimer=setInterval(function(){fetch("/api/aft-import/estado").then(function(r){return r.json();}).then(function(data){var run=data.run;if(out)out.textContent=formatearFaseAFT(run);if(!run||run.status!=="running"){pararPollAFT();btn.disabled=false;btn.textContent="Importar AFT";if(run&&run.status==="success"){if(out)out.style.color="#059669";var dot=document.getElementById("aftEstadoDot");if(dot)dot.className="dot dot-ok";var txt=document.getElementById("aftEstadoTexto");if(txt)txt.textContent="Actualizado ahora mismo";}else if(out){out.style.color="#DC2626";}}}).catch(function(){});},2000);}' +
'function importarAFT(btn){pararPollAFT();btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Importando...";var out=document.getElementById("importarAFTResultado");if(out){out.textContent="";out.style.color="";}fetch("/api/aft-import",{method:"POST"}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===202&&res.data&&res.data.ok){pollAFTEstado(btn,out);}else if(res.status===409){if(out){out.textContent="Ya hay una importaci\\u00f3n en curso, mostrando su progreso...";out.style.color="#D97706";}pollAFTEstado(btn,out);}else{btn.disabled=false;btn.textContent="Importar AFT";if(out){out.textContent="Error: "+(res.data&&res.data.error?res.data.error:"desconocido");out.style.color="#DC2626";}}}).catch(function(){btn.disabled=false;btn.textContent="Importar AFT";if(out){out.textContent="Error de red al contactar con el servidor.";out.style.color="#DC2626";}});}' +
'var syncPollTimer=null;' +
'function pararPollSync(){if(syncPollTimer){clearInterval(syncPollTimer);syncPollTimer=null;}}' +
'function formatearFaseSync(run){if(!run)return "Iniciando...";if(run.status==="running"){var fase=run.fase||"procesando";if(fase==="leyendo_shopify")return "Leyendo Shopify: "+(run.shopify_variantes_leidas||0)+" variantes ("+(run.shopify_paginas_leidas||0)+" p\\u00e1ginas)...";if(fase==="comparando"||fase==="guardando_resultados")return "Comparando: "+(run.comparacion_procesadas||0)+"/"+(run.comparacion_total||0)+" referencias...";return "Procesando...";}if(run.status==="success"){return "Coincidencias: "+(run.total_matched||0)+" \\u00b7 Cambios: "+(run.total_cambiarian||0)+" \\u00b7 A cero: "+(run.total_a_cero||0)+" \\u00b7 Incidencias: "+(run.total_incidencias||0)+(run.permisos_incompletos?" \\u00b7 permisos incompletos":"");}if(run.status==="error"){return "Error: "+(run.error_message||"desconocido");}return "";}' +
'function pollSyncEstado(btn,out){pararPollSync();syncPollTimer=setInterval(function(){fetch("/api/sync-run/estado").then(function(r){return r.json();}).then(function(data){var run=data.run;if(out)out.textContent=formatearFaseSync(run);if(!run||run.status!=="running"){pararPollSync();btn.disabled=false;btn.textContent="Sincronizar Shopify \\u2194 AFT";if(run&&run.status==="success"){if(out)out.style.color=run.permisos_incompletos?"#D97706":"#059669";var dot=document.getElementById("syncEstadoDot");if(dot)dot.className="dot "+(run.permisos_incompletos?"dot-warn":"dot-ok");var txt=document.getElementById("syncEstadoTexto");if(txt)txt.textContent="Completa ahora mismo";}else if(out){out.style.color="#DC2626";}}}).catch(function(){});},2000);}' +
'function sincronizarShopify(btn){pararPollSync();btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Sincronizando...";var out=document.getElementById("sincronizarResultado");if(out){out.textContent="";out.style.color="";}fetch("/api/sync-run",{method:"POST"}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===202&&res.data&&res.data.ok){pollSyncEstado(btn,out);}else if(res.status===409){if(out){out.textContent="Ya hay una sincronizaci\\u00f3n en curso, mostrando su progreso...";out.style.color="#D97706";}pollSyncEstado(btn,out);}else{btn.disabled=false;btn.textContent="Sincronizar Shopify \\u2194 AFT";if(out){out.textContent="Error: "+(res.data&&res.data.error?res.data.error:"desconocido");out.style.color="#DC2626";}}}).catch(function(){btn.disabled=false;btn.textContent="Sincronizar Shopify \\u2194 AFT";if(out){out.textContent="Error de red al contactar con el servidor.";out.style.color="#DC2626";}});}' +
'function filtrarRentabilidad(){var q=(document.getElementById("buscarRentabilidad").value||"").toLowerCase();var estado=document.getElementById("filtroEstadoRentabilidad").value;var visibles=0;document.querySelectorAll("#tablaRentabilidadBody tr").forEach(function(r){var okTexto=r.dataset.ref.indexOf(q)>-1||r.dataset.nombre.indexOf(q)>-1;var okEstado=!estado||r.dataset.estado===estado;var match=okTexto&&okEstado;r.style.display=match?"":"none";if(match)visibles++;});var c=document.getElementById("contadorRentabilidad");var total=document.querySelectorAll("#tablaRentabilidadBody tr").length;if(c)c.textContent="Mostrando "+visibles+" de "+total+(total===1?" producto.":" productos.");}' +
'var rentPollTimer=null;' +
'function pararPollRent(){if(rentPollTimer){clearInterval(rentPollTimer);rentPollTimer=null;}}' +
'function formatearFaseRent(run){if(!run)return "Iniciando...";if(run.status==="running"){return "Analizando: "+(run.fase||"procesando")+(run.total_analizados?" ("+(run.procesados||0)+"/"+run.total_analizados+")":"")+"...";}if(run.status==="success"){return "Analizados: "+(run.procesados||0)+" \\u00b7 P\\u00e9rdida: "+(run.en_perdida||0)+" \\u00b7 Margen bajo: "+(run.margen_bajo||0)+" \\u00b7 Diferencia coste: "+(run.diferencia_coste||0);}if(run.status==="error"){return "Error: "+(run.error_message||"desconocido");}return "";}' +
'function pollRentEstado(btn,out){pararPollRent();rentPollTimer=setInterval(function(){fetch("/api/rentabilidad-run/estado").then(function(r){return r.json();}).then(function(data){var run=data.run;if(out)out.textContent=formatearFaseRent(run);if(!run||run.status!=="running"){pararPollRent();btn.disabled=false;btn.textContent="Analizar rentabilidad";if(run&&run.status==="success"){if(out)out.style.color="#059669";var dot=document.getElementById("rentEstadoDot");if(dot)dot.className="dot dot-ok";var txt=document.getElementById("rentEstadoTexto");if(txt)txt.textContent="Actualizado ahora mismo";}else if(out){out.style.color="#DC2626";}}}).catch(function(){});},2000);}' +
'function ejecutarRentabilidad(btn){pararPollRent();btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Analizando...";var out=document.getElementById("rentResultado");if(out){out.textContent="";out.style.color="";}fetch("/api/rentabilidad-run",{method:"POST"}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===202&&res.data&&res.data.ok){pollRentEstado(btn,out);}else if(res.status===409){if(out){out.textContent="Ya hay un proceso en curso, mostrando su progreso...";out.style.color="#D97706";}pollRentEstado(btn,out);}else{btn.disabled=false;btn.textContent="Analizar rentabilidad";if(out){out.textContent="Error: "+(res.data&&res.data.error?res.data.error:"desconocido");out.style.color="#DC2626";}}}).catch(function(){btn.disabled=false;btn.textContent="Analizar rentabilidad";if(out){out.textContent="Error de red al contactar con el servidor.";out.style.color="#DC2626";}});}' +
'var pipelinePollTimer=null;' +
'function pararPollPipeline(){if(pipelinePollTimer){clearInterval(pipelinePollTimer);pipelinePollTimer=null;}}' +
'function formatearFasePipeline(run){if(!run)return "Iniciando...";if(run.status==="running"){var etiquetas={import_aft:"Importando AFT",sync_shopify:"Sincronizando Shopify",rentabilidad:"Calculando rentabilidad"};return (etiquetas[run.etapa]||"En curso")+"...";}if(run.status==="success"){return "Pipeline completo.";}if(run.status==="error"){return "Error: "+(run.error_message||"desconocido");}return "";}' +
'function pollPipelineEstado(btn,out){pararPollPipeline();pipelinePollTimer=setInterval(function(){fetch("/api/pipeline-run/estado").then(function(r){return r.json();}).then(function(data){var run=data.run;if(out)out.textContent=formatearFasePipeline(run);if(!run||run.status!=="running"){pararPollPipeline();btn.disabled=false;btn.textContent="Ejecutar pipeline completo";if(run&&run.status==="success"){if(out)out.style.color="#059669";var dot=document.getElementById("pipelineEstadoDot");if(dot)dot.className="dot dot-ok";var txt=document.getElementById("pipelineEstadoTexto");if(txt)txt.textContent="Completo ahora mismo";location.reload();}else if(out){out.style.color="#DC2626";}}}).catch(function(){});},3000);}' +
'function ejecutarPipeline(btn){pararPollPipeline();btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Ejecutando...";var out=document.getElementById("pipelineResultado");if(out){out.textContent="";out.style.color="";}fetch("/api/pipeline-run",{method:"POST"}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===202&&res.data&&res.data.ok){pollPipelineEstado(btn,out);}else if(res.status===409){if(out){out.textContent="Ya hay un proceso en curso, mostrando su progreso...";out.style.color="#D97706";}pollPipelineEstado(btn,out);}else{btn.disabled=false;btn.textContent="Ejecutar pipeline completo";if(out){out.textContent="Error: "+(res.data&&res.data.error?res.data.error:"desconocido");out.style.color="#DC2626";}}}).catch(function(){btn.disabled=false;btn.textContent="Ejecutar pipeline completo";if(out){out.textContent="Error de red al contactar con el servidor.";out.style.color="#DC2626";}});}' +
'</script></body></html>';

return html;
}

module.exports = { buildDashboardHtml };
