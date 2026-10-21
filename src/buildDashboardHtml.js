// Auto-ported from the original n8n "Generar Panel HTML" Code node.
// Logic and HTML/CSS/JS are reproduced verbatim; only the 7 data-source lines
// that used n8n's $('NodeName') accessor were replaced with function parameters.
function buildDashboardHtml({
  syncRows,
  shopifyProductsRaw,
  candRows,
  draftRows,
  detailRows,
  demandSignalsRows,
  scoresV3Rows
}) {
const shopifyProducts = ((shopifyProductsRaw && shopifyProductsRaw.data && shopifyProductsRaw.data.products && shopifyProductsRaw.data.products.edges) || []).map(e => {
  const v = (e.node.variants.edges[0] || {}).node || {};
  return {
    id: e.node.id,
    titulo: e.node.title,
    marca: e.node.vendor,
    estado: e.node.status,
    imagen: e.node.featuredMedia && e.node.featuredMedia.preview ? e.node.featuredMedia.preview.image.url : null,
    precio: v.price ? parseFloat(v.price) : null,
    stock: v.inventoryQuantity,
    sku: v.sku
  };
});
const fichasPendientes = draftRows.filter(d => !d.estado || d.estado === 'pendiente');
const cambiosPrecio = detailRows.filter(d => Math.abs((d.precioAnterior||0) - (d.precioNuevo||0)) >= 0.01);
const sinStockItems = detailRows.filter(d => d.stockNuevo === 0);
const demandSignalsByRef = {};
demandSignalsRows.forEach(r => { if (!demandSignalsByRef[r.producto_ref]) demandSignalsByRef[r.producto_ref] = r; });

function normalizarTxt(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }

const scoresV3PorRef = {};
const scoresV3PorNombre = {};
scoresV3Rows.forEach(r => {
  if (!scoresV3PorRef[r.producto_ref]) scoresV3PorRef[r.producto_ref] = r;
  const nombreNorm = normalizarTxt(r.producto_ref);
  if (!scoresV3PorNombre[nombreNorm]) scoresV3PorNombre[nombreNorm] = r;
});
function buscarScoreV3(c){
  if (scoresV3PorRef[c.ref]) return scoresV3PorRef[c.ref];
  const nombreNorm = normalizarTxt(c.descripcion || '');
  for (const key in scoresV3PorNombre) {
    if (nombreNorm.indexOf(key) !== -1 || key.indexOf(nombreNorm) !== -1) return scoresV3PorNombre[key];
  }
  return null;
}

const ultimaSync = syncRows[0] || null;
const HORAS_LIMITE_DESACTUALIZADO = 26;
const datosDesactualizados = !ultimaSync || (Date.now() - new Date(ultimaSync.createdAt).getTime()) > HORAS_LIMITE_DESACTUALIZADO * 3600000;
const oportunidades = candRows.filter(c => c.margenPct >= 20 && c.stock > 0 && c.estado !== 'descartado').sort((a,b) => b.margenPct - a.margenPct);
const productosMonitorizados = shopifyProducts.length;

function esc(s){ return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function eur(n){ return (n === undefined || n === null) ? '—' : Number(n).toFixed(2) + '€'; }
function titleCase(s){ return String(s||'').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function pl(n, singular, plural){ return n + ' ' + (n === 1 ? singular : plural); }

const AFINIDAD_CORE = ['herramienta','electroportatil','amoladora','taladro','sierra','motosierra','desbrozador','hidrolimpiadora','compresor','generador','soldadora','disco de corte','disco abrasivo','lija','broca','poda'];
const AFINIDAD_MEDIA = ['llave','destornillador','nivel','manguera','riego','bomba de agua','malla de sombreo','soldar','pantalla','cubrefiltro'];
const AFINIDAD_BAJA = ['bota','ropa de trabajo'];
function clasificarAfinidad(categoria){
  const c = normalizarTxt(categoria);
  if (!c) return 'sin_dato';
  if (AFINIDAD_CORE.some(k => c.indexOf(k) !== -1)) return 'core';
  if (AFINIDAD_MEDIA.some(k => c.indexOf(k) !== -1)) return 'media';
  if (AFINIDAD_BAJA.some(k => c.indexOf(k) !== -1)) return 'baja';
  return 'baja';
}

function calcularConfidenceV3(c){
  const estadoDemanda = c.estadoDatoDemanda || 'sin_datos';
  const ptsDemanda = { '>0': 40, '0': 20, 'sin_datos': 0 }[estadoDemanda] || 0;
  const ptsMercado = { 'Alta': 40, 'Media': 24, 'Baja': 0 }[c.marketConfidence] || 0;
  const ptsSpecs = c.faltanCriticosAFT ? 10 : 20;
  const total = ptsDemanda + ptsMercado + ptsSpecs;
  const label = total >= 70 ? 'Alta' : (total >= 40 ? 'Media' : 'Baja');
  return { total, label };
}
function calcularScoreV3(c){
  // PRIORIDAD 1: si existe un score real de DataForSEO (scores_v3), usarlo directo, sin recalcular
  const sv3 = buscarScoreV3(c);
  if (sv3) {
    let detalle = {};
    try { detalle = JSON.parse(sv3.componentes_detalle || '{}'); } catch(e) {}
    return {
      opportunity: sv3.opportunity,
      opportunityLabel: detalle.etiqueta || (sv3.opportunity >= 90 ? 'Excelente' : (sv3.opportunity >= 70 ? 'Interesante' : (sv3.opportunity >= 50 ? 'Analizar' : 'Baja prioridad'))),
      confidence: sv3.confidence,
      confidenceLabel: detalle.confidence_label || (sv3.confidence >= 70 ? 'Alta' : (sv3.confidence >= 40 ? 'Media' : 'Baja')),
      fuenteDemanda: 'DataForSEO (' + (sv3.fecha || '') + ')',
      desglose: {
        rentabilidad: detalle.rentabilidad != null ? detalle.rentabilidad : 0,
        demanda: detalle.demanda != null ? detalle.demanda : sv3.demand,
        competitividad: detalle.competitividad != null ? detalle.competitividad : sv3.competition,
        stock: detalle.stock != null ? detalle.stock : 0,
        afinidad: detalle.afinidad != null ? detalle.afinidad : 0
      }
    };
  }

  const margenScore = Math.min(1, (c.margenPct||0) / 50);
  const beneficioAbs = (c.precio||0) - (c.coste||0);
  const beneficioScore = Math.min(1, Math.max(0, beneficioAbs) / 40);
  const rentabilidad = Math.round(30 * (0.5*margenScore + 0.5*beneficioScore) * 10) / 10;

  const estadoDemanda = c.estadoDatoDemanda || 'sin_datos';
  let demanda;
  if (c.demandSignalGratuito) {
    demanda = { 'Fuerte': 20, 'Media': 14, 'Baja': 6, 'Sin datos': 12.5 }[c.demandSignalGratuito] || 12.5;
  } else if (estadoDemanda === 'sin_datos') {
    demanda = 12.5;
  } else if (estadoDemanda === '0') {
    demanda = 5.0;
  } else {
    demanda = Math.round(25 * Math.min(1, Math.log10((c.volumenDemanda||0)+1) / Math.log10(10000)) * 10) / 10;
  }

  const NEUTRAL_COMP = 10.0;
  let competitividad;
  if (!c.precioMercado) {
    competitividad = NEUTRAL_COMP;
  } else {
    const posicion = (c.precio||0) / c.precioMercado;
    let base;
    if (posicion >= 0.8 && posicion <= 1.2) base = 20;
    else if (posicion < 0.8) base = 17;
    else if (posicion <= 1.5) base = 9;
    else base = 2;
    const peso = { 'Alta': 1.0, 'Media': 0.6, 'Baja': 0.2 }[c.marketConfidence] || 0.2;
    competitividad = Math.round((NEUTRAL_COMP*(1-peso) + base*peso) * 10) / 10;
  }

  const stock = c.stock;
  let stockPts;
  if (!stock || stock <= 0) stockPts = 0;
  else if (stock <= 2) stockPts = 3;
  else if (stock <= 5) stockPts = 6;
  else if (stock <= 10) stockPts = 9;
  else if (stock <= 25) stockPts = 12;
  else stockPts = 15;

  const afinidadPts = { core: 10, media: 6, baja: 3, sin_dato: 4 }[c.afinidadClase] || 4;

  let total = rentabilidad + demanda + competitividad + stockPts + afinidadPts;

  const sinEvidenciaTotal = !c.demandSignalGratuito && estadoDemanda === 'sin_datos' && !c.precioMercado;
  if (sinEvidenciaTotal && total > 59) total = 59;

  total = Math.round(Math.min(100, Math.max(0, total)) * 10) / 10;
  const opportunityLabel = total >= 90 ? 'Excelente' : (total >= 70 ? 'Interesante' : (total >= 50 ? 'Analizar' : 'Baja prioridad'));
  const confidence = c.confidenceSignalGratuito
    ? { total: { 'Alta': 75, 'Media': 45, 'Baja': 15 }[c.confidenceSignalGratuito] || 15, label: c.confidenceSignalGratuito }
    : calcularConfidenceV3(c);

  return {
    opportunity: total, opportunityLabel,
    confidence: confidence.total, confidenceLabel: confidence.label,
    fuenteDemanda: c.demandSignalGratuito ? 'Gratis (Autocomplete + Search Console)' : (estadoDemanda === '>0' ? 'DataForSEO' : null),
    desglose: { rentabilidad, demanda, competitividad, stock: stockPts, afinidad: afinidadPts }
  };
}
function enriquecerParaScoreV3(c){
  const ds = demandSignalsByRef[c.ref];
  return Object.assign({}, c, {
    afinidadClase: clasificarAfinidad(c.categoria),
    estadoDatoDemanda: c.estadoDatoDemanda || 'sin_datos',
    volumenDemanda: c.volumenDemanda || null,
    precioMercado: c.precioMercado || null,
    marketConfidence: c.marketConfidence || 'Baja',
    faltanCriticosAFT: c.faltanCriticosAFT || false,
    demandSignalGratuito: (!c.estadoDatoDemanda && ds) ? ds.demand_signal : null,
    confidenceSignalGratuito: (!c.estadoDatoDemanda && ds) ? ds.confidence_signal : null
  });
}
function imgUrl(ref){ return 'https://www.aftgrupo.com/img_artics/' + ref + '.jpg'; }
function aftUrl(ref){ return 'https://www.aftgrupo.com/productos/ref-' + ref; }
const SHOPIFY_ADMIN_PRODUCTS = 'https://admin.shopify.com/store/kb9i0z-da/products';

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
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  alertTri: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  packageX: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8M8.5 5.5l7 4"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  circle: '<circle cx="12" cy="12" r="10"/>'
};
function icon(name, size, color){ return '<svg width="'+(size||16)+'" height="'+(size||16)+'" viewBox="0 0 24 24" fill="none" stroke="'+(color||'currentColor')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+ICON[name]+'</svg>'; }

const eventos = [];
syncRows.forEach(r => eventos.push({ ts: r.createdAt, tipo: 'sync', texto: 'Stock y precio actualizados en ' + pl(r.actualizados,'producto','productos'), icon: 'activity', color: '#087F78' }));
candRows.forEach(c => eventos.push({ ts: c.createdAt, tipo: 'oportunidad', texto: 'Nueva oportunidad detectada: ' + titleCase(c.descripcion || c.ref), icon: 'sparkles', color: '#7C3AED' }));
draftRows.forEach(d => eventos.push({ ts: d.fechaCreacion || d.createdAt, tipo: 'ficha', texto: 'Ficha generada: ' + d.titulo, icon: 'fileText', color: '#2563EB' }));
eventos.sort((a,b) => new Date(b.ts) - new Date(a.ts));
const ultimaActualizacionTxt = eventos.length ? tiempoRelativo(eventos[0].ts) : null;

function tlRow(texto, ts, color){ return '<div class="tl-row"><div class="tl-dot" style="background:'+color+'"></div><div class="tl-body"><div class="tl-text">' + esc(texto) + '</div><div class="tl-time">' + esc(tiempoRelativo(ts)) + '</div></div></div>'; }

const timelineHtml = eventos.length
  ? eventos.slice(0, 8).map(e => tlRow(e.texto, e.ts, e.color)).join('')
  : '<div class="empty-state">Aún no hay actividad. Cuando el sistema analice tu catálogo, la vas a ver aquí.</div>';

function agruparEventos(lista){
  const usados = new Array(lista.length).fill(false);
  const grupos = [];
  for (let i = 0; i < lista.length; i++) {
    if (usados[i]) continue;
    const base = lista[i];
    let ultimo = base.ts;
    let n = 1;
    for (let j = i + 1; j < lista.length; j++) {
      if (usados[j]) continue;
      if (lista[j].tipo === base.tipo && Math.abs(new Date(lista[j].ts) - new Date(base.ts)) < 15 * 60000) {
        usados[j] = true;
        n++;
      }
    }
    usados[i] = true;
    let texto;
    if (n > 1 && base.tipo === 'oportunidad') texto = pl(n,'nueva oportunidad detectada','nuevas oportunidades detectadas');
    else if (n > 1 && base.tipo === 'ficha') texto = pl(n,'ficha generada','fichas generadas');
    else texto = base.texto;
    grupos.push({ ts: base.ts, texto, color: base.color });
  }
  return grupos.sort((a,b) => new Date(b.ts) - new Date(a.ts));
}
const eventosResumen = agruparEventos(eventos);
const timelineHtmlResumen = eventosResumen.length
  ? eventosResumen.slice(0, 6).map(e => tlRow(e.texto, e.ts, e.color)).join('')
  : '<div class="empty-state">Aún no hay actividad. Cuando el sistema analice tu catálogo, la vas a ver aquí.</div>';

const tareas = [];
fichasPendientes.forEach(d => tareas.push({ texto: 'Aprobar ficha de ' + titleCase(d.titulo), meta: 'Ficha generada por IA', cuando: 'Hoy', page: 'catalogo' }));
oportunidades.slice(0,2).forEach(o => tareas.push({ texto: 'Revisar oportunidad: ' + titleCase(o.descripcion || o.ref), meta: 'Margen ' + o.margenPct + '%', cuando: 'Hoy', page: 'oportunidades' }));
if (ultimaSync && ultimaSync.errores > 0) tareas.push({ texto: 'Revisar errores de sincronización', meta: pl(ultimaSync.errores,'error','errores'), cuando: 'Hoy', page: 'actividad' });
const tareasHtml = tareas.length
  ? tareas.slice(0,6).map(t => '<div class="task-row" data-page="' + t.page + '" onclick="ir(this)" role="button" tabindex="0"><span class="task-dot"></span><div class="task-body"><div class="task-text">' + esc(t.texto) + '</div><div class="task-meta">' + esc(t.meta) + '</div></div><span class="task-when">' + esc(t.cuando) + '</span>' + icon('chevron',13,'var(--sub)') + '</div>').join('')
  : '<div class="empty-state">No hay tareas pendientes ahora mismo.</div>';

const atencion = [];
if (cambiosPrecio.length > 0) {
  atencion.push({ icon: 'alertTri', color: '#D97706', bg: '#FFFBEB', title: pl(cambiosPrecio.length,'producto ha cambiado','productos han cambiado') + ' de precio', desc: 'Comprueba si deseas actualizar Shopify.', cta: 'Revisar', page: 'actividad' });
}
if (sinStockItems.length > 0) {
  atencion.push({ icon: 'packageX', color: '#DC2626', bg: '#FEF2F2', title: pl(sinStockItems.length,'producto sin stock','productos sin stock'), desc: 'Se han quedado sin unidades disponibles.', cta: 'Ver productos', href: SHOPIFY_ADMIN_PRODUCTS });
}
if (ultimaSync && ultimaSync.errores > 0) {
  atencion.push({ icon: 'alertTri', color: '#DC2626', bg: '#FEF2F2', title: pl(ultimaSync.errores,'error','errores') + ' en la última sincronización', desc: 'Revisa qué productos fallaron al actualizarse.', cta: 'Revisar', page: 'actividad' });
}
if (fichasPendientes.length > 0) {
  atencion.push({ icon: 'fileText', color: '#2563EB', bg: '#EFF6FF', title: pl(fichasPendientes.length,'ficha creada por IA pendiente','fichas creadas por IA pendientes'), desc: 'Revisa y aprueba las fichas antes de publicarlas.', cta: 'Revisar fichas', page: 'catalogo' });
}
if (oportunidades.length > 0) {
  atencion.push({ icon: 'sparkles', color: '#7C3AED', bg: '#F5F3FF', title: pl(oportunidades.length,'oportunidad nueva sin revisar','oportunidades nuevas sin revisar'), desc: 'Productos con buen margen listos para evaluar.', cta: 'Ver oportunidades', page: 'oportunidades' });
}
const necesitanAtencionCount = atencion.length;
function attnBtn(a){
  if (a.href) return '<a class="btn-outline" href="' + a.href + '" target="_blank" rel="noopener">' + esc(a.cta) + ' ' + icon('chevron', 13) + '</a>';
  return '<a class="btn-outline" data-page="' + a.page + '" onclick="ir(this)">' + esc(a.cta) + ' ' + icon('chevron', 13) + '</a>';
}
const atencionHtml = atencion.length
  ? atencion.slice(0,3).map(a => '<div class="attn-card"><div class="attn-icon" style="background:'+a.bg+';color:'+a.color+'">' + icon(a.icon, 18) + '</div><div class="attn-title">' + esc(a.title) + '</div><div class="attn-desc">' + esc(a.desc) + '</div>' + attnBtn(a) + '</div>').join('')
  : '<div class="empty-state" style="grid-column:1/-1;">Todo al día. No hay nada que necesite tu atención ahora mismo.</div>';

function oppCard(c){
  const s = calcularScoreV3(enriquecerParaScoreV3(c));
  const payload = encodeURIComponent(JSON.stringify({ ref: c.ref, ean: c.ean, marca: c.marca, descripcion: c.descripcion, precio: c.precio, coste: c.coste, stock: c.stock }));
  return '<div class="opp-card" onclick="abrirCard(event,\'' + aftUrl(c.ref) + '\')" role="button" tabindex="0">' +
    '<div class="opp-photo"><img src="' + imgUrl(c.ref) + '" alt="" onerror="this.style.display=\'none\';this.parentElement.classList.add(\'opp-photo-empty\')"/></div>' +
    '<div class="opp-body">' +
      '<div class="opp-top"><h3>' + esc(titleCase(c.descripcion || c.ref)) + '</h3><div class="opp-score"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#E5E7EB" stroke-width="3"/><circle cx="20" cy="20" r="17" fill="none" stroke="#087F78" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (s.opportunity/100*106.8).toFixed(1) + ' 106.8" transform="rotate(-90 20 20)"/></svg><span>' + s.opportunity + '</span></div></div>' +
      '<div class="opp-sub">' + esc(titleCase(c.marca||'')) + ' · AFT tiene ' + esc(c.stock) + ' uds. · <strong>' + s.opportunityLabel + '</strong></div>' +
      '<div class="opp-stats"><div><span class="l">Coste</span><span class="v">' + eur(c.coste) + '</span></div><div><span class="l">PVP recomendado</span><span class="v">' + eur(c.precio) + '</span></div><div><span class="l">Margen</span><span class="v ok">' + esc(c.margenPct) + '%</span></div></div>' +
      '<div class="opp-confidence">Confidence: ' + s.confidenceLabel + (s.fuenteDemanda ? ' · Fuente: ' + s.fuenteDemanda : '') + '</div>' +
      '<details class="opp-desglose"><summary>Ver desglose del score</summary><div class="opp-desglose-grid"><span>Rentabilidad</span><span>' + s.desglose.rentabilidad + '/30</span><span>Demanda</span><span>' + s.desglose.demanda + '/25</span><span>Precio/competencia</span><span>' + s.desglose.competitividad + '/20</span><span>Stock</span><span>' + s.desglose.stock + '/15</span><span>Afinidad</span><span>' + s.desglose.afinidad + '/10</span></div></details>' +
      '<div class="opp-actions"><a class="btn-outline" href="' + aftUrl(c.ref) + '" target="_blank" rel="noopener">Ver análisis</a><button class="btn-solid" data-payload="' + payload + '" onclick="crearProducto(this)">Crear producto</button></div>' +
    '</div></div>';
}
const oportunidadesHtml = oportunidades.length
  ? oportunidades.slice(0,3).map(oppCard).join('')
  : '<div class="empty-state">Aún no hay oportunidades con margen suficiente. El sistema sigue analizando tu catálogo todos los días.</div>';

const estadoConexion = !ultimaSync
  ? { dot: 'dot-warn', texto: 'Sin datos aún' }
  : datosDesactualizados
    ? { dot: 'dot-warn', texto: 'Datos desactualizados' }
    : ultimaSync.errores > 0
      ? { dot: 'dot-err', texto: 'Con errores en la última sync' }
      : { dot: 'dot-ok', texto: 'Conectado' };
const integracionesHtml =
  '<div class="integ-card"><div class="integ-row"><span class="dot ' + estadoConexion.dot + '" id="aftEstadoDot"></span><div><div class="integ-name">AFT Grupo</div><div class="integ-sub">Catálogo de proveedor · según última sync</div></div><span class="integ-status" id="aftEstadoTexto">' + estadoConexion.texto + '</span></div>' +
  '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><button class="btn-solid btn-sm" onclick="importarAFT(this)">Importar AFT</button><span id="importarAFTResultado" class="integ-sub"></span></div></div>' +
  '<div class="integ-card"><div class="integ-row"><span class="dot ' + estadoConexion.dot + '"></span><div><div class="integ-name">Shopify</div><div class="integ-sub">herramitienda.es · según última sync</div></div><span class="integ-status">' + estadoConexion.texto + '</span></div></div>' +
  '<div class="integ-card"><div class="integ-row"><span class="dot dot-ok"></span><div><div class="integ-name">Última sincronización</div><div class="integ-sub">' + (ultimaSync ? ultimaSync.actualizados + ' actualizados · ' + ultimaSync.errores + ' errores · ' + ultimaSync.duracionMin + ' min' : 'Sin datos') + '</div></div><span class="integ-status">' + (ultimaSync ? esc(tiempoRelativo(ultimaSync.createdAt)) : '—') + '</span></div></div>';

const kpis = [
  { icon: 'box', bg:'#ECFDF5', color:'#059669', n: productosMonitorizados, l: 'Productos monitorizados', page: 'productos' },
  { icon: 'sparkles', bg:'#F5F3FF', color:'#7C3AED', n: oportunidades.length, l: 'Oportunidades', page: 'oportunidades' },
  { icon: 'alertTri', bg:'#FFFBEB', color:'#D97706', n: necesitanAtencionCount, l: 'Necesitan atención', page: null },
  { icon: 'fileText', bg:'#EFF6FF', color:'#2563EB', n: fichasPendientes.length, l: 'Fichas pendientes', page: 'catalogo' }
];
const kpiHtml = kpis.map(k => k.page
  ? '<div class="kpi kpi-clickable" data-page="' + k.page + '" onclick="ir(this)"><div class="kpi-icon" style="background:'+k.bg+';color:'+k.color+'">' + icon(k.icon, 18) + '</div><div class="kpi-n">' + k.n + '</div><div class="kpi-l">' + k.l + '</div></div>'
  : '<div class="kpi kpi-clickable" onclick="document.getElementById(\'attnSection\').scrollIntoView({behavior:\'smooth\'})"><div class="kpi-icon" style="background:'+k.bg+';color:'+k.color+'">' + icon(k.icon, 18) + '</div><div class="kpi-n">' + k.n + '</div><div class="kpi-l">' + k.l + '</div></div>'
).join('');

const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Herramitienda</title><style>' +
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
'.bell-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;color:var(--sub);cursor:pointer;}' +
'.avatar{width:32px;height:32px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12.5px;}' +
'.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:34px;}' +
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
'.opp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}' +
'.opp-card{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;transition:box-shadow 0.15s,border-color 0.15s;}' +
'.opp-card:hover{border-color:var(--brand);box-shadow:0 2px 10px rgba(0,0,0,0.06);}' +
'.row-clickable{cursor:pointer;}' +
'.row-clickable:hover{background:#FAFAFA;}' +
'.opp-photo{height:140px;background:#F1F2F4;display:flex;align-items:center;justify-content:center;}' +
'.opp-photo img{width:100%;height:100%;object-fit:contain;padding:14px;}' +
'.opp-photo-empty{background:linear-gradient(135deg,#F1F2F4,#E5E7EB);}' +
'.opp-body{padding:16px 18px 18px;}' +
'.opp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}' +
'.opp-top h3{font-size:13.5px;font-weight:700;line-height:1.35;}' +
'.opp-score{position:relative;width:40px;height:40px;flex-shrink:0;}' +
'.opp-score span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--brand-dark);}' +
'.opp-sub{font-size:11.5px;color:var(--sub);margin-top:4px;}' +
'.opp-confidence{font-size:10px;color:var(--sub);margin-top:6px;opacity:0.75;}' +
'.opp-desglose{margin-top:6px;}' +
'.opp-desglose summary{font-size:10.5px;color:var(--brand-dark);cursor:pointer;font-weight:600;list-style:none;}' +
'.opp-desglose summary::-webkit-details-marker{display:none;}' +
'.opp-desglose summary::before{content:"\\25B8 ";}' +
'.opp-desglose[open] summary::before{content:"\\25BE ";}' +
'.opp-desglose-grid{display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:10.5px;color:var(--sub);margin-top:5px;padding:6px 8px;background:#FAFAFA;border-radius:6px;}' +
'.opp-stats{display:flex;gap:14px;margin-top:14px;}' +
'.opp-stats .l{display:block;font-size:10.5px;color:var(--sub);}' +
'.opp-stats .v{display:block;font-weight:700;font-size:13.5px;margin-top:2px;}' +
'.opp-stats .v.ok{color:#059669;}' +
'.opp-actions{display:flex;gap:8px;margin-top:16px;}' +
'.opp-actions a,.opp-actions button{flex:1;font-family:inherit;}' +
'.bottom-grid{display:grid;grid-template-columns:65fr 35fr;gap:20px;align-items:start;}' +
'.panel-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:8px 20px;}' +
'.tl-row{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid var(--border);}' +
'.tl-row:last-child{border-bottom:none;}' +
'.tl-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;}' +
'.tl-text{font-size:13px;font-weight:500;}' +
'.tl-time{font-size:11.5px;color:var(--sub);margin-top:2px;}' +
'.task-row{display:flex;align-items:center;gap:11px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;}' +
'.task-row:hover{background:#FAFAFA;margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px;}' +
'.task-row:last-child{border-bottom:none;}' +
'.task-dot{width:7px;height:7px;border-radius:50%;background:var(--brand);flex-shrink:0;}' +
'.task-body{flex:1;}' +
'.task-text{font-size:12.5px;font-weight:500;line-height:1.35;}' +
'.task-meta{font-size:11px;color:var(--sub);margin-top:2px;}' +
'.task-when{font-size:10.5px;color:var(--sub);background:#F3F4F6;padding:2px 8px;border-radius:20px;font-weight:600;flex-shrink:0;}' +
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
'th{text-align:left;font-size:11.5px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:0.02em;padding:12px 16px;border-bottom:1px solid var(--border);background:#FAFAFA;}' +
'td{padding:12px 16px;font-size:13px;border-bottom:1px solid var(--border);}' +
'tr:last-child td{border-bottom:none;}' +
'td.num{text-align:right;font-variant-numeric:tabular-nums;}' +
'.ok{color:#059669;font-weight:600;}' +
'.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
'.table-note{font-size:12px;color:var(--sub);margin-bottom:10px;}' +
'.badge{font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;white-space:nowrap;}' +
'.badge-warn{background:#FFFBEB;color:#D97706;}' +
'.badge-ok{background:#ECFDF5;color:#059669;}' +
'.badge-off{background:#F3F4F6;color:var(--sub);}' +
'.btn-sm{padding:5px 10px;font-size:11.5px;margin-top:0;}' +
'.filterbar{display:flex;gap:10px;margin-bottom:14px;}' +
'.filter-select{font-size:12.5px;font-weight:500;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--ink);}' +
'.show-mobile-list{display:none;}' +
'.opp-mini-list{flex-direction:column;gap:10px;}' +
'.opp-mini{display:flex;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;cursor:default;}' +
'.opp-mini-photo{width:56px;height:56px;flex-shrink:0;border-radius:8px;background:#F1F2F4;display:flex;align-items:center;justify-content:center;overflow:hidden;}' +
'.opp-mini-photo img{width:100%;height:100%;object-fit:contain;padding:4px;}' +
'.opp-mini-body{flex:1;min-width:0;}' +
'.opp-mini-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}' +
'.opp-mini-name{font-size:13px;font-weight:700;line-height:1.3;}' +
'.opp-mini-score{background:var(--green-bg,#ECFDF5);color:#059669;font-weight:800;font-size:11px;padding:2px 7px;border-radius:6px;flex-shrink:0;}' +
'.opp-mini-sub{font-size:11px;color:var(--sub);margin-top:2px;}' +
'.opp-mini-stats{display:flex;gap:10px;margin-top:6px;font-size:11.5px;color:var(--sub);flex-wrap:wrap;}' +
'.opp-mini-stats .ok{color:#059669;font-weight:700;}' +
'.opp-mini .btn-sm{margin-top:8px;}' +
'.prod-mini-list{flex-direction:column;gap:10px;}' +
'.prod-mini{display:flex;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px;cursor:pointer;align-items:center;}' +
'.prod-mini:active{background:#FAFAFA;}' +
'.prod-mini-img{width:60px;height:60px;flex-shrink:0;border-radius:8px;object-fit:contain;background:#F1F2F4;padding:4px;}' +
'.prod-mini-img-empty{background:#F1F2F4;}' +
'.prod-mini-body{flex:1;min-width:0;}' +
'.prod-mini-name{font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}' +
'.prod-mini-marca{font-size:11px;color:var(--sub);margin-top:2px;}' +
'.prod-mini-row{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}' +
'.prod-mini-precio{font-size:13px;font-weight:800;}' +
'.prod-mini-stock{font-size:11px;color:var(--sub);}' +
'.stale-banner{display:flex;align-items:center;gap:10px;background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:24px;}' +
'.pagetitle{font-size:20px;font-weight:800;margin-bottom:20px;letter-spacing:-0.02em;}' +
'.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:-2px;}' +
'.spinner.dark{border:2px solid rgba(0,0,0,0.15);border-top-color:var(--ink);}' +
'@keyframes spin{to{transform:rotate(360deg);}}' +
'.hamburger{display:none;margin-left:auto;background:none;border:1px solid var(--border);border-radius:8px;width:32px;height:32px;font-size:16px;cursor:pointer;color:var(--ink);}' +
'@media(max-width:700px){table thead{display:none;}table,table tbody,table tr,table td{display:block;width:100%;}table tr{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;padding:4px 0;background:#fff;}table td{border-bottom:none;padding:6px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:right;}table td.num{text-align:right;}table td::before{content:attr(data-label);font-size:11px;color:var(--sub);font-weight:600;text-align:left;}table td:empty{display:none;}.table-scroll{overflow-x:visible;}.hide-mobile-table{display:none;}.show-mobile-list{display:flex;}}' +
'@media(max-width:900px){.kpi-row{grid-template-columns:repeat(2,1fr);}.attn-grid,.opp-grid{grid-template-columns:1fr;}.bottom-grid{grid-template-columns:1fr;}body{flex-direction:column;}.sidebar{width:100%;min-height:auto;position:relative;}.sb-logo{padding-right:16px;}.hamburger{display:block;}.sb-nav{display:none;margin-top:10px;}.sb-nav.open{display:block;}main{padding:20px;}}' +
'@media(max-width:480px){' +
  '.header{flex-direction:column;align-items:stretch;margin-bottom:18px;gap:8px;}' +
  '.header h1{font-size:19px;}' +
  '.header .sub{font-size:13px;}' +
  '.header-right{justify-content:flex-end;gap:10px;margin-top:2px;flex-wrap:wrap;}' +
  '.updated{font-size:11px;}' +
  '.sb-logo{padding:0 16px 4px;}' +
  '.sb-foot{display:none;}' +
  '.sidebar{padding:12px 0;}' +
  'main{padding:14px;}' +
  '.kpi-row{gap:10px;margin-bottom:22px;}' +
  '.kpi{padding:12px 14px;}' +
  '.kpi-icon{width:26px;height:26px;margin-bottom:7px;}' +
  '.kpi-n{font-size:21px;}' +
  '.kpi-l{font-size:11px;}' +
'}' +
'</style></head><body>' +

'<nav class="sidebar" id="sidebar">' +
'<div class="sb-logo"><div class="sb-logo-mark">H</div><div><div class="sb-brand">HERRAMITIENDA</div><div class="sb-sub">Commerce Intelligence</div></div><button class="hamburger" onclick="toggleNav()" aria-label="Abrir menú">☰</button></div>' +
'<div class="sb-nav" id="sbNav">' +
'<a class="sb-link active" data-page="inicio" onclick="ir(this)">' + icon('home',17) + '<span>Inicio</span></a>' +
'<a class="sb-link" data-page="oportunidades" onclick="ir(this)">' + icon('sparkles',17) + '<span>Oportunidades</span></a>' +
'<a class="sb-link" data-page="productos" onclick="ir(this)">' + icon('box',17) + '<span>Productos</span></a>' +
'<a class="sb-link" data-page="catalogo" onclick="ir(this)">' + icon('layers',17) + '<span>Catálogo</span></a>' +
'<a class="sb-link" data-page="tareas" onclick="ir(this)">' + icon('check',17) + '<span>Tareas</span></a>' +
'<a class="sb-link" data-page="actividad" onclick="ir(this)">' + icon('activity',17) + '<span>Actividad</span></a>' +
'<div class="sb-sep"></div>' +
'<a class="sb-link" data-page="integraciones" onclick="ir(this)">' + icon('plug',17) + '<span>Integraciones</span></a>' +
'<a class="sb-link" data-page="configuracion" onclick="ir(this)">' + icon('settings',17) + '<span>Configuración</span></a>' +
'</div>' +
'<div class="sb-foot"><div class="sb-foot-mark"></div><div><div class="name">Herramitienda</div><div class="status">' + icon('check',11) + ' AFT conectado</div></div></div>' +
'</nav>' +

'<main>' +

'<div class="page active" id="page-inicio">' +
(datosDesactualizados ? '<div class="stale-banner">' + icon('alertTri',16) + '<span>Los datos no se actualizan desde hace más de ' + HORAS_LIMITE_DESACTUALIZADO + ' horas' + (ultimaSync ? ' (última sync: ' + esc(tiempoRelativo(ultimaSync.createdAt)) + ')' : '') + '. Revisá el Agente 1 en n8n.</span></div>' : '') +
'<div class="header"><div><h1>Buenos días, Su 👋</h1><div class="sub">Aquí tienes lo que está pasando hoy en tu catálogo.</div></div>' +
'<div class="header-right">' + (ultimaActualizacionTxt ? '<div class="updated">Última actualización: ' + esc(ultimaActualizacionTxt) + '</div>' : '') + '<div class="bell-btn" role="button" tabindex="0" aria-label="Ir a Necesita tu atención" onclick="document.getElementById(\'attnSection\').scrollIntoView({behavior:\'smooth\'})">' + icon('bell',16) + '</div><div class="avatar">S</div></div></div>' +

'<div class="kpi-row">' + kpiHtml + '</div>' +

'<section class="block" id="attnSection"><div class="sec-head"><h2>Necesita tu atención</h2></div><div class="attn-grid">' + atencionHtml + '</div></section>' +

'<section class="block"><div class="sec-head"><h2>' + icon('sparkles',17) + ' Oportunidades encontradas</h2><a class="sec-link" data-page="oportunidades" onclick="ir(this)">Ver todas las oportunidades ' + icon('chevron',12) + '</a></div><div class="opp-grid">' + oportunidadesHtml + '</div></section>' +

'<div class="bottom-grid">' +
'<section class="block"><div class="sec-head"><h2>Actividad reciente</h2><a class="sec-link" data-page="actividad" onclick="ir(this)">Ver toda la actividad ' + icon('chevron',12) + '</a></div><div class="panel-card">' + timelineHtmlResumen + '</div></section>' +
'<section class="block"><div class="sec-head"><h2>Tareas pendientes</h2><a class="sec-link" data-page="tareas" onclick="ir(this)">Ver todas las tareas ' + icon('chevron',12) + '</a></div><div class="panel-card">' + tareasHtml + '</div></section>' +
'</div>' +
'</div>' +

'<div class="page" id="page-oportunidades"><div class="pagetitle">Oportunidades</div>' +
(function(){
  var visibles = candRows.filter(c => c.estado !== 'descartado');
  var marcas = Array.from(new Set(visibles.map(c => titleCase(c.marca||'')).filter(Boolean))).sort();
  var filtroHtml = '<div class="filterbar">' +
    '<select id="filtroMarca" class="filter-select" onchange="filtrarOportunidades()"><option value="">Todas las marcas</option>' + marcas.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('') + '</select>' +
    '<select id="filtroMargen" class="filter-select" onchange="filtrarOportunidades()"><option value="0">Cualquier margen</option><option value="20">20%+</option><option value="30">30%+</option><option value="40">40%+</option></select>' +
    '</div>';
  var nota = visibles.length ? '<div class="table-note">Mostrando ' + Math.min(visibles.length,50) + ' de ' + pl(visibles.length,'candidato','candidatos') + '.</div>' : '';
  function miniCard(c){
    const s = calcularScoreV3(enriquecerParaScoreV3(c));
    return '<div class="opp-mini" data-marca="' + esc(titleCase(c.marca||'')) + '" data-margen="' + c.margenPct + '">' +
      '<div class="opp-mini-photo"><img src="' + imgUrl(c.ref) + '" alt="" onerror="this.style.display=\'none\';this.parentElement.classList.add(\'opp-photo-empty\')"/></div>' +
      '<div class="opp-mini-body">' +
        '<div class="opp-mini-top"><span class="opp-mini-name">' + esc(titleCase(c.descripcion||c.ref)) + '</span><span class="opp-mini-score">' + s.opportunity + '</span></div>' +
        '<div class="opp-mini-sub">' + esc(titleCase(c.marca||'')) + ' · ' + s.opportunityLabel + '</div>' +
        '<div class="opp-mini-stats"><span>PVP ' + eur(c.precio) + '</span><span>coste ' + eur(c.coste) + '</span><span class="ok">' + esc(c.margenPct) + '%</span></div>' +
        '<div class="opp-confidence">Confidence: ' + s.confidenceLabel + (s.fuenteDemanda ? ' · ' + s.fuenteDemanda : '') + '</div>' +
        '<details class="opp-desglose"><summary>Ver desglose</summary><div class="opp-desglose-grid"><span>Rentabilidad</span><span>' + s.desglose.rentabilidad + '/30</span><span>Demanda</span><span>' + s.desglose.demanda + '/25</span><span>Precio/competencia</span><span>' + s.desglose.competitividad + '/20</span><span>Stock</span><span>' + s.desglose.stock + '/15</span><span>Afinidad</span><span>' + s.desglose.afinidad + '/10</span></div></details>' +
        '<button class="btn-sm btn-outline" onclick="descartarOportunidad(this,\'' + c.id + '\')">Descartar</button>' +
      '</div></div>';
  }
  var filas = visibles.length ? visibles.slice(0,50).map(c => '<tr data-marca="' + esc(titleCase(c.marca||'')) + '" data-margen="' + c.margenPct + '"><td data-label="Producto">' + esc(titleCase(c.descripcion||c.ref)) + '</td><td data-label="Proveedor">' + esc(titleCase(c.marca||'')) + '</td><td class="num" data-label="PVP">' + eur(c.precio) + '</td><td class="num" data-label="Coste">' + eur(c.coste) + '</td><td class="num ok" data-label="Margen">' + esc(c.margenPct) + '%</td><td data-label=""><button class="btn-sm btn-outline" onclick="descartarOportunidad(this,\'' + c.id + '\')">Descartar</button></td></tr>').join('') : '<tr><td colspan="6" class="empty-state">Sin candidatos todavía.</td></tr>';
  var cards = visibles.length ? visibles.slice(0,50).map(miniCard).join('') : '<div class="empty-state">Sin candidatos todavía.</div>';
  return filtroHtml + nota +
    '<div class="table-scroll hide-mobile-table"><table><thead><tr><th>Producto</th><th>Proveedor</th><th>PVP recomendado</th><th>Coste</th><th>Margen</th><th></th></tr></thead><tbody id="tablaOportunidadesBody">' + filas + '</tbody></table></div>' +
    '<div class="opp-mini-list show-mobile-list" id="oportunidadesCards">' + cards + '</div>';
})() +
'</div>' +

'<div class="page" id="page-productos"><div class="pagetitle">Productos</div>' +
(function(){
  var marcasProd = Array.from(new Set(shopifyProducts.map(p => p.marca).filter(Boolean))).sort();
  return '<div class="filterbar"><input type="text" id="buscarProducto" class="filter-select" placeholder="Buscar por nombre..." aria-label="Buscar productos" style="flex:1;max-width:280px;" oninput="filtrarProductos()"/>' +
  '<select id="filtroMarcaProducto" class="filter-select" onchange="filtrarProductos()"><option value="">Todas las marcas</option>' + marcasProd.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('') + '</select></div>';
})() +
(shopifyProducts.length ? '<div class="table-note" id="contadorProductos">Mostrando ' + shopifyProducts.length + ' de ' + pl(shopifyProducts.length,'producto','productos') + '.</div>' : '') +
'<div class="table-scroll hide-mobile-table"><table><thead><tr><th></th><th>Producto</th><th>Marca</th><th>Precio</th><th>Stock</th><th>Estado</th></tr></thead><tbody id="tablaProductosBody">' +
(shopifyProducts.length ? shopifyProducts.map(p => {
  const badge = p.estado !== 'ACTIVE' ? '<span class="badge badge-off">Borrador</span>' : (p.stock === 0 ? '<span class="badge badge-warn">Sin stock</span>' : '<span class="badge badge-ok">Activo</span>');
  const img = p.imagen ? '<img src="' + p.imagen + '" style="width:32px;height:32px;object-fit:contain;border-radius:6px;background:#F1F2F4;"/>' : '<div style="width:32px;height:32px;border-radius:6px;background:#F1F2F4;"></div>';
  const numId = (p.id || '').split('/').pop();
  const shopifyUrl = SHOPIFY_ADMIN_PRODUCTS + '/' + numId;
  return '<tr class="row-clickable" data-nombre="' + esc(p.titulo.toLowerCase()) + '" data-marca="' + esc(p.marca||'') + '" onclick="window.open(\'' + shopifyUrl + '\',\'_blank\')"><td data-label="">' + img + '</td><td data-label="Producto">' + esc(p.titulo) + '</td><td data-label="Marca">' + esc(p.marca) + '</td><td class="num" data-label="Precio">' + eur(p.precio) + '</td><td class="num" data-label="Stock">' + (p.stock === null || p.stock === undefined ? '—' : p.stock) + '</td><td data-label="Estado">' + badge + '</td></tr>';
}).join('') : '<tr><td colspan="6" class="empty-state">No se encontraron productos de tus marcas en Shopify.</td></tr>') +
'</tbody></table></div>' +
'<div class="prod-mini-list show-mobile-list" id="productosCards">' +
(shopifyProducts.length ? shopifyProducts.map(p => {
  const badge = p.estado !== 'ACTIVE' ? '<span class="badge badge-off">Borrador</span>' : (p.stock === 0 ? '<span class="badge badge-warn">Sin stock</span>' : '<span class="badge badge-ok">Activo</span>');
  const img = p.imagen ? '<img src="' + p.imagen + '" class="prod-mini-img"/>' : '<div class="prod-mini-img prod-mini-img-empty"></div>';
  const numId = (p.id || '').split('/').pop();
  const shopifyUrl = SHOPIFY_ADMIN_PRODUCTS + '/' + numId;
  return '<div class="prod-mini" data-nombre="' + esc(p.titulo.toLowerCase()) + '" data-marca="' + esc(p.marca||'') + '" onclick="window.open(\'' + shopifyUrl + '\',\'_blank\')">' +
    img +
    '<div class="prod-mini-body">' +
      '<div class="prod-mini-name">' + esc(p.titulo) + '</div>' +
      '<div class="prod-mini-marca">' + esc(p.marca) + '</div>' +
      '<div class="prod-mini-row"><span class="prod-mini-precio">' + eur(p.precio) + '</span><span class="prod-mini-stock">Stock: ' + (p.stock === null || p.stock === undefined ? '—' : p.stock) + '</span>' + badge + '</div>' +
    '</div></div>';
}).join('') : '<div class="empty-state">No se encontraron productos de tus marcas en Shopify.</div>') +
'</div></div>' +

'<div class="page" id="page-catalogo"><div class="pagetitle">Catálogo generado por IA</div>' +
'<div class="table-scroll">' +
'<table><thead><tr><th>Producto</th><th>SKU</th><th>Precio</th><th>Margen</th><th>Estado</th><th></th><th></th></tr></thead><tbody>' +
(draftRows.length ? draftRows.map(function(d){
  var est = d.estado || 'pendiente';
  var badge = est === 'aprobado' ? '<span class="badge badge-ok">Publicado</span>' : est === 'rechazado' ? '<span class="badge badge-off">Rechazado</span>' : '<span class="badge badge-warn">Pendiente de revisión</span>';
  var numId = (d.shopifyProductId || '').split('/').pop();
  var verFicha = numId ? '<a class="sec-link" href="' + SHOPIFY_ADMIN_PRODUCTS + '/' + numId + '" target="_blank" rel="noopener">Ver ficha ' + icon('chevron',11) + '</a>' : '';
  var acciones = est === 'pendiente'
    ? '<button class="btn-sm btn-solid" onclick="revisarFicha(this,\'' + d.shopifyProductId + '\',\'' + d.id + '\',\'aprobar\')">Aprobar</button> <button class="btn-sm btn-outline" onclick="revisarFicha(this,\'' + d.shopifyProductId + '\',\'' + d.id + '\',\'rechazar\')">Rechazar</button>'
    : '—';
  return '<tr><td data-label="Producto">' + esc(d.titulo) + '</td><td data-label="SKU">' + esc(d.sku) + '</td><td class="num" data-label="Precio">' + eur(d.precio) + '</td><td class="num ok" data-label="Margen">' + esc(d.margenPct) + '%</td><td data-label="Estado">' + badge + '</td><td data-label="">' + acciones + '</td><td data-label="">' + verFicha + '</td></tr>';
}).join('') : '<tr><td colspan="7" class="empty-state">Aún no se han generado fichas nuevas.</td></tr>') +
'</tbody></table>' +
'</div></div>' +

'<div class="page" id="page-tareas"><div class="pagetitle">Tareas</div><div class="panel-card">' + tareasHtml + '</div></div>' +

'<div class="page" id="page-actividad"><div class="pagetitle">Actividad</div><div class="panel-card">' + timelineHtml + '</div></div>' +

'<div class="page" id="page-integraciones"><div class="pagetitle">Integraciones</div>' + integracionesHtml + '</div>' +

'<div class="page" id="page-configuracion"><div class="pagetitle">Configuración</div><div class="empty-state">Próximamente: preferencias de notificaciones, umbral mínimo de margen, y gestión de marcas monitorizadas.</div></div>' +

'</main><script>' +
'function ir(btn){var id=btn.getAttribute("data-page");document.querySelectorAll(".sb-link").forEach(function(a){a.classList.remove("active");if(a.getAttribute("data-page")===id)a.classList.add("active");});document.querySelectorAll(".page").forEach(function(p){p.classList.remove("active")});document.getElementById("page-"+id).classList.add("active");window.scrollTo(0,0);document.getElementById("sbNav").classList.remove("open");}' +
'function toggleNav(){document.getElementById("sbNav").classList.toggle("open");}' +
'function abrirCard(event,url){if(event.target.closest("a,button"))return;window.open(url,"_blank");}' +
'function crearProducto(btn){var data=JSON.parse(decodeURIComponent(btn.getAttribute("data-payload")));btn.disabled=true;btn.innerHTML="<span class=\\"spinner\\"></span>Creando...";var params=new URLSearchParams(data).toString();fetch("/webhook/crear-ficha-panel?"+params).then(function(r){return r.json();}).then(function(res){if(res.ok){btn.textContent="✓ Creado como borrador";btn.style.background="#059669";btn.style.borderColor="#059669";}else{btn.textContent="Error, reintentar";btn.disabled=false;btn.style.background="#DC2626";btn.style.borderColor="#DC2626";}}).catch(function(){btn.textContent="Error de red";btn.disabled=false;});}' +
'function revisarFicha(btn,productId,rowId,accion){var row=btn.closest("tr");var otros=row.querySelectorAll("button");otros.forEach(function(b){b.disabled=true;});btn.innerHTML="<span class=\\"spinner dark\\"></span>"+(accion==="aprobar"?"Publicando...":"Rechazando...");var params=new URLSearchParams({productId:productId,rowId:rowId,action:accion}).toString();fetch("/webhook/revisar-ficha-panel?"+params).then(function(r){return r.json();}).then(function(res){if(res.ok){var estCell=row.children[4];if(accion==="aprobar"){estCell.innerHTML="<span class=\\"badge badge-ok\\">Publicado</span>";}else{estCell.innerHTML="<span class=\\"badge badge-off\\">Rechazado</span>";}row.children[5].textContent="—";}else{btn.textContent="Error";otros.forEach(function(b){b.disabled=false;});}}).catch(function(){btn.textContent="Error de red";otros.forEach(function(b){b.disabled=false;});});}' +
'function filtrarOportunidades(){var marca=document.getElementById("filtroMarca").value;var margen=parseFloat(document.getElementById("filtroMargen").value)||0;function aplica(sel){document.querySelectorAll(sel).forEach(function(r){if(!r.dataset.margen)return;var okMarca=!marca||r.dataset.marca===marca;var okMargen=parseFloat(r.dataset.margen)>=margen;r.style.display=(okMarca&&okMargen)?"":"none";});}aplica("#tablaOportunidadesBody tr");aplica("#oportunidadesCards .opp-mini");}' +
'function descartarOportunidad(btn,rowId){var row=btn.closest("tr");btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Descartando...";fetch("/webhook/descartar-oportunidad-panel?rowId="+encodeURIComponent(rowId)).then(function(r){return r.json();}).then(function(res){if(res.ok){row.style.opacity="0.4";row.querySelector("button").textContent="Descartada";}else{btn.textContent="Error";btn.disabled=false;}}).catch(function(){btn.textContent="Error de red";btn.disabled=false;});}' +
'function filtrarProductos(){var q=document.getElementById("buscarProducto").value.toLowerCase();var marca=document.getElementById("filtroMarcaProducto").value;var visibles=0;function aplica(sel){document.querySelectorAll(sel).forEach(function(r){if(!r.dataset.nombre)return;var okTexto=r.dataset.nombre.indexOf(q)>-1;var okMarca=!marca||r.dataset.marca===marca;var match=okTexto&&okMarca;r.style.display=match?"":"none";if(match)visibles++;});}aplica("#tablaProductosBody tr");visibles=0;aplica("#productosCards .prod-mini");var total=document.querySelectorAll("#tablaProductosBody tr[data-nombre]").length;var c=document.getElementById("contadorProductos");if(c)c.textContent="Mostrando "+visibles+" de "+total+(total===1?" producto.":" productos.");}' +
'var aftPollTimer=null;' +
'function pararPollAFT(){if(aftPollTimer){clearInterval(aftPollTimer);aftPollTimer=null;}}' +
'function formatearFaseAFT(run){if(!run)return "Iniciando...";if(run.status==="running"){var fase=run.fase||"procesando";var detalle="";if(fase==="productos")detalle=" ("+(run.productos_insertados||0)+"/"+(run.total_productos||0)+")";else if(fase==="stock")detalle=" ("+(run.stock_insertado||0)+"/"+(run.total_stock||0)+")";else if(fase==="categorias")detalle=" ("+(run.categorias_insertadas||0)+"/"+(run.total_categorias||0)+")";return "Importando: "+fase+detalle+"...";}if(run.status==="success"){return "Categor\\u00edas: "+(run.categorias_insertadas||0)+" \\u00b7 Productos: "+(run.productos_insertados||0)+" \\u00b7 Stock: "+(run.stock_insertado||0)+" \\u00b7 Incidencias: "+(run.incidencias||0)+(run.stock_huerfano?" \\u00b7 "+run.stock_huerfano+" sin producto":"");}if(run.status==="error"){return "Error: "+(run.error_message||"desconocido");}return "";}' +
'function pollAFTEstado(btn,out){pararPollAFT();aftPollTimer=setInterval(function(){fetch("/api/aft-import/estado").then(function(r){return r.json();}).then(function(data){var run=data.run;if(out)out.textContent=formatearFaseAFT(run);if(!run||run.status!=="running"){pararPollAFT();btn.disabled=false;btn.textContent="Importar AFT";if(run&&run.status==="success"){if(out)out.style.color="#059669";var dot=document.getElementById("aftEstadoDot");if(dot)dot.className="dot dot-ok";var txt=document.getElementById("aftEstadoTexto");if(txt)txt.textContent="Actualizado ahora mismo";}else if(out){out.style.color="#DC2626";}}}).catch(function(){});},2000);}' +
'function importarAFT(btn){pararPollAFT();btn.disabled=true;btn.innerHTML="<span class=\\"spinner dark\\"></span>Importando...";var out=document.getElementById("importarAFTResultado");if(out){out.textContent="";out.style.color="";}fetch("/api/aft-import",{method:"POST"}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===202&&res.data&&res.data.ok){pollAFTEstado(btn,out);}else if(res.status===409){if(out){out.textContent="Ya hay una importaci\\u00f3n en curso, mostrando su progreso...";out.style.color="#D97706";}pollAFTEstado(btn,out);}else{btn.disabled=false;btn.textContent="Importar AFT";if(out){out.textContent="Error: "+(res.data&&res.data.error?res.data.error:"desconocido");out.style.color="#DC2626";}}}).catch(function(){btn.disabled=false;btn.textContent="Importar AFT";if(out){out.textContent="Error de red al contactar con el servidor.";out.style.color="#DC2626";}});}' +
'</script></body></html>';

return html;


}

module.exports = { buildDashboardHtml };
