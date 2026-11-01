// Capa de presentación (Clean Architecture) — página "Aprobaciones"
// (fase 3). Tres secciones DELIBERADAMENTE separadas, sin compartir
// tabla ni campo entre ellas: resolución de incidencias de afinidad
// ambigua, autorizaciones comerciales excepcionales de margen <10%, y una
// tarjeta explicativa (sin ningún botón operativo) sobre la
// preautorización de productos nuevos — ese flujo todavía no tiene
// backend, así que aquí nunca se ofrece un botón que lo prometa.
const { esc, titleCase, tiempoRelativo } = require('./helpers');

const CLASES_RESOLUBLES = ['principal', 'complementaria', 'estacional', 'fuera_de_foco'];
const CLASE_LABEL = { principal: 'Principal', complementaria: 'Complementaria', estacional: 'Estacional', fuera_de_foco: 'Fuera de foco' };

function selectClases(idPrefix) {
  return '<select id="' + idPrefix + '-clase" class="filter-select" style="width:170px;">' +
    '<option value="">Clasificar como…</option>' +
    CLASES_RESOLUBLES.map((c) => '<option value="' + c + '">' + CLASE_LABEL[c] + '</option>').join('') +
    '</select>';
}

function filaIncidenciaCategoria(grupo) {
  const idSeguro = 'cat-' + Buffer.from(grupo.categoria_normalizada).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  const categoriaTexto = grupo.categoria_original || grupo.categoria_normalizada;
  // La categoría viaja en un atributo data-* (siempre HTML-escapado por
  // esc()), nunca interpolada dentro del propio onclick: evita cualquier
  // problema de comillas con texto real de AFT (acentos, comillas,
  // apóstrofes) — el handler la lee de el.dataset, nunca la reconstruye
  // como código JS.
  return '<div class="panel-card" style="padding:14px 18px;margin-bottom:10px;" id="' + idSeguro + '">' +
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:220px;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(categoriaTexto) + '</div>' +
        '<div style="font-size:11.5px;color:var(--sub);margin-top:2px;">' + grupo.total_refs + ' ' + (grupo.total_refs === 1 ? 'referencia afectada' : 'referencias afectadas') + ' · detectada ' + esc(tiempoRelativo(grupo.detectado_en)) + '</div>' +
      '</div>' +
      selectClases(idSeguro) +
      '<input type="text" id="' + idSeguro + '-motivo" class="filter-select" placeholder="Motivo de la resolución" style="width:220px;"/>' +
      '<button class="btn-sm btn-solid" data-categoria="' + esc(categoriaTexto) + '" onclick="hmtResolverAfinidad(\'' + idSeguro + '\', this)">Guardar resolución</button>' +
      '<span id="' + idSeguro + '-resultado" class="integ-sub"></span>' +
    '</div>' +
  '</div>';
}

function filaHistorialAfinidad(h) {
  const estadoTxt = h.estado === 'activa'
    ? '<span class="badge badge-ok">Vigente</span>'
    : '<span class="badge badge-off">Revocada</span>';
  return '<div class="tl-row"><div class="tl-dot" style="background:' + (h.estado === 'activa' ? '#059669' : '#9CA3AF') + '"></div>' +
    '<div class="tl-body"><div class="tl-text">' + esc(h.categoria_original || h.categoria_normalizada) + ' → <strong>' + (CLASE_LABEL[h.clase] || esc(h.clase)) + '</strong> ' + estadoTxt + '</div>' +
    '<div class="tl-time">por ' + esc(h.resuelto_por) + ' · ' + esc(tiempoRelativo(h.resuelto_en)) + (h.revocado_por ? ' · revocada por ' + esc(h.revocado_por) + ' ' + esc(tiempoRelativo(h.revocado_en)) : '') + '</div></div></div>';
}

function filaMargenPendiente(c) {
  return '<div class="panel-card" style="padding:14px 18px;margin-bottom:10px;" id="margen-' + esc(c.ref) + '">' +
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:220px;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(titleCase(c.descripcion || c.ref)) + '</div>' +
        '<div style="font-size:11.5px;color:var(--sub);margin-top:2px;">Margen proyectado: <strong style="color:#DC2626;">' + (c.margen_pct != null ? Number(c.margen_pct).toFixed(1) + '%' : '—') + '</strong> · ref ' + esc(c.ref) + (c.marca ? ' · ' + esc(titleCase(c.marca)) : '') + '</div>' +
      '</div>' +
      '<input type="text" id="margen-' + esc(c.ref) + '-motivo" class="filter-select" placeholder="Motivo" style="width:220px;"/>' +
      '<button class="btn-sm btn-outline" data-ref="' + esc(c.ref) + '" data-margen="' + (c.margen_pct != null ? Number(c.margen_pct) : '') + '" onclick="hmtDecidirMargen(this,\'rechazar\')">Rechazar</button>' +
      '<button class="btn-sm btn-solid" data-ref="' + esc(c.ref) + '" data-margen="' + (c.margen_pct != null ? Number(c.margen_pct) : '') + '" onclick="hmtDecidirMargen(this,\'autorizar\')">Autorizar excepción</button>' +
      '<span id="margen-' + esc(c.ref) + '-resultado" class="integ-sub"></span>' +
    '</div>' +
    '<div style="font-size:10.5px;color:#9CA3AF;margin-top:8px;">Autorización comercial — no crea ninguna ficha de producto ni publica nada en Shopify.</div>' +
  '</div>';
}

function filaHistorialMargen(h) {
  const badge = h.estado === 'autorizada'
    ? (h.vigente ? '<span class="badge badge-ok">Autorizada</span>' : '<span class="badge badge-off">Autorizada (sustituida)</span>')
    : (h.vigente ? '<span class="badge badge-off" style="background:#FEF2F2;color:#DC2626;">Rechazada</span>' : '<span class="badge badge-off">Rechazada (sustituida)</span>');
  return '<div class="tl-row"><div class="tl-dot" style="background:' + (h.estado === 'autorizada' ? '#059669' : '#DC2626') + '"></div>' +
    '<div class="tl-body"><div class="tl-text">' + esc(h.ref) + ' (margen ' + (h.margen_pct != null ? Number(h.margen_pct).toFixed(1) + '%' : '—') + ') ' + badge + '</div>' +
    '<div class="tl-time">por ' + esc(h.decidido_por) + ' · ' + esc(tiempoRelativo(h.decidido_en)) + ' · ' + esc(h.motivo) + '</div></div></div>';
}

function renderAprobacionesSection(data) {
  const incidenciasAgrupadas = data.incidenciasAgrupadas || [];
  const autorizacionesPendientes = data.autorizacionesPendientes || [];
  const historialAfinidad = data.historialAfinidad || [];
  const historialMargen = data.historialMargen || [];

  const seccionAfinidad =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
      '<div style="font-size:15px;font-weight:700;">Incidencias de afinidad ambigua</div>' +
      (incidenciasAgrupadas.length ? '<span class="badge badge-warn">' + incidenciasAgrupadas.length + ' ' + (incidenciasAgrupadas.length === 1 ? 'categoría pendiente' : 'categorías pendientes') + '</span>' : '<span class="badge badge-ok">Sin pendientes</span>') +
    '</div>' +
    '<div style="font-size:12px;color:var(--sub);margin-bottom:12px;">Categorías de AFT que no coinciden con ninguna lista configurada. Resolver aquí se aplica a TODAS las referencias de esa categoría — ya y en el futuro — mientras la resolución esté vigente; nunca activa por sí solo ningún filtro comercial todavía en modo observación.</div>' +
    (incidenciasAgrupadas.length
      ? incidenciasAgrupadas.map(filaIncidenciaCategoria).join('')
      : '<div class="empty-state">No hay categorías de afinidad ambigua pendientes de resolver.</div>') +
    (historialAfinidad.length
      ? '<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:12px;color:var(--brand-dark);font-weight:600;">Historial de resolución (' + historialAfinidad.length + ')</summary><div class="panel-card" style="margin-top:8px;">' + historialAfinidad.map(filaHistorialAfinidad).join('') + '</div></details>'
      : '');

  const seccionMargen =
    '<div style="display:flex;align-items:center;gap:8px;margin:28px 0 4px;">' +
      '<div style="font-size:15px;font-weight:700;">Excepciones comerciales por margen &lt;10%</div>' +
      (autorizacionesPendientes.length ? '<span class="badge badge-off" style="background:#FEF2F2;color:#DC2626;">' + autorizacionesPendientes.length + ' pendientes</span>' : '<span class="badge badge-ok">Sin pendientes</span>') +
    '</div>' +
    '<div style="font-size:12px;color:var(--sub);margin-bottom:12px;">Autorización comercial independiente — nunca comparte tabla ni campo con la resolución de incidencias de afinidad.</div>' +
    (autorizacionesPendientes.length
      ? autorizacionesPendientes.map(filaMargenPendiente).join('')
      : '<div class="empty-state">No hay productos con margen por debajo del 10% pendientes de autorización.</div>') +
    (historialMargen.length
      ? '<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:12px;color:var(--brand-dark);font-weight:600;">Historial de decisiones (' + historialMargen.length + ')</summary><div class="panel-card" style="margin-top:8px;">' + historialMargen.map(filaHistorialMargen).join('') + '</div></details>'
      : '');

  const seccionPreautorizacion =
    '<div style="font-size:15px;font-weight:700;margin:28px 0 4px;">Preautorización de productos nuevos</div>' +
    '<div style="font-size:12px;color:var(--sub);margin-bottom:14px;">Todavía sin backend — se muestra como hoja de ruta, no como una función operativa. Tres etapas con dueño distinto cada una; nunca un solo botón que las mezcle.</div>' +
    '<div class="panel-card" style="padding:20px;">' +
      '<div style="display:flex;align-items:flex-start;gap:0;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:150px;text-align:center;">' +
          '<div style="width:30px;height:30px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-weight:700;font-size:12px;">1</div>' +
          '<div style="font-size:12px;font-weight:700;">Aprobación comercial</div>' +
          '<div style="font-size:10.5px;color:#9CA3AF;margin-top:3px;">Decide si el producto merece entrar al catálogo — requisito futuro, no implementado todavía</div>' +
        '</div>' +
        '<div style="width:40px;height:2px;background:#E5E7EB;margin-top:15px;"></div>' +
        '<div style="flex:1;min-width:150px;text-align:center;">' +
          '<div style="width:30px;height:30px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-weight:700;font-size:12px;">2</div>' +
          '<div style="font-size:12px;font-weight:700;">Creación de borrador (Fichas IA)</div>' +
          '<div style="font-size:10.5px;color:#9CA3AF;margin-top:3px;">Ya existe como función separada — nunca publica, solo genera el borrador</div>' +
        '</div>' +
        '<div style="width:40px;height:2px;background:#E5E7EB;margin-top:15px;"></div>' +
        '<div style="flex:1;min-width:150px;text-align:center;">' +
          '<div style="width:30px;height:30px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-weight:700;font-size:12px;">3</div>' +
          '<div style="font-size:12px;font-weight:700;color:#9CA3AF;">Publicación en Shopify</div>' +
          '<div style="font-size:10.5px;color:#9CA3AF;margin-top:3px;">Fuera de alcance de este panel — manual, bajo autorización explícita aparte</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  const html = seccionAfinidad + seccionMargen + seccionPreautorizacion;

  const script =
    'function hmtResultado(id,ok,msg){var el=document.getElementById(id+"-resultado");if(!el)return;el.textContent=msg;el.style.color=ok?"#059669":"#DC2626";}\n' +
    'function hmtResolverAfinidad(idSeguro,btn){var categoria=btn.getAttribute("data-categoria");var clase=document.getElementById(idSeguro+"-clase").value;var motivo=document.getElementById(idSeguro+"-motivo").value;if(!clase){hmtResultado(idSeguro,false,"Elige una clasificación.");return;}if(!motivo){hmtResultado(idSeguro,false,"Escribe un motivo.");return;}hmtResultado(idSeguro,true,"Guardando...");fetch("/api/aprobaciones/afinidad/resolver",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({categoria:categoria,clase:clase,motivo:motivo})}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===200&&res.data&&res.data.ok){location.reload();}else{hmtResultado(idSeguro,false,"Error: "+(res.data&&res.data.error?res.data.error:"desconocido"));}}).catch(function(){hmtResultado(idSeguro,false,"Error de red.");});}\n' +
    'function hmtDecidirMargen(btn,accion){var ref=btn.getAttribute("data-ref");var margenAttr=btn.getAttribute("data-margen");var margenPct=margenAttr?parseFloat(margenAttr):null;var idSeguro="margen-"+ref;var motivo=document.getElementById(idSeguro+"-motivo").value;if(!motivo){hmtResultado(idSeguro,false,"Escribe un motivo.");return;}hmtResultado(idSeguro,true,(accion==="autorizar"?"Autorizando...":"Rechazando..."));fetch("/api/aprobaciones/margen/"+encodeURIComponent(ref)+"/"+accion,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({motivo:motivo,margenPct:margenPct})}).then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});}).then(function(res){if(res.status===200&&res.data&&res.data.ok){location.reload();}else{hmtResultado(idSeguro,false,"Error: "+(res.data&&res.data.error?res.data.error:"desconocido"));}}).catch(function(){hmtResultado(idSeguro,false,"Error de red.");});}';

  return { html, script };
}

module.exports = { renderAprobacionesSection };
