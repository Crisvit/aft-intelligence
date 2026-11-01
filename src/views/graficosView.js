// Capa de presentación (Clean Architecture) — página "Gráficos" (fase 3).
// Construye el HTML de la sección y el <script> cliente que dibuja los
// gráficos con Chart.js (vendorizado localmente, ver
// public/vendor/chartjs-4.4.4/ y server.js). Cada gráfico tiene su propia
// tabla accesible (details/summary, sin JavaScript necesario para
// abrirla) con los mismos datos — nunca un gráfico sin alternativa
// tabular. Ningún dato se inventa aquí: una serie vacía se muestra como
// "sin datos", nunca como una línea plana en cero.
const { esc } = require('./helpers');

function fmtFechaCorta(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

const CHARTS = [
  { id: 'matches', titulo: 'Evolución de matches', fuente: 'sync_runs', historico: true },
  { id: 'ejecuciones', titulo: 'Ejecuciones correctas vs. fallidas', fuente: 'todos los agentes (*_runs)', historico: true },
  { id: 'oportunidades', titulo: 'Oportunidades: recomendadas vs. excedentes', fuente: 'snapshot diario de oportunidades', historico: false },
  { id: 'afinidad', titulo: 'Afinidad comercial (distribución actual)', fuente: 'snapshot diario de oportunidades (última foto)', historico: false },
  { id: 'stock', titulo: 'Variaciones de stock', fuente: 'snapshot diario de stock', historico: false },
  { id: 'rentabilidad', titulo: 'Rentabilidad por periodo', fuente: 'snapshot diario de rentabilidad', historico: false },
  { id: 'demanda', titulo: 'Demanda verificada (DataForSEO)', fuente: 'demanda_runs', historico: true }
];

function badgeFuente(c) {
  return c.historico
    ? '<span style="font-size:10.5px;color:#059669;background:#ECFDF5;display:inline-block;padding:2px 7px;border-radius:9px;font-weight:600;margin-bottom:8px;">Histórico ya disponible</span>'
    : '<span style="font-size:10.5px;color:#D97706;background:#FFFBEB;display:inline-block;padding:2px 7px;border-radius:9px;font-weight:600;margin-bottom:8px;">Snapshot diario — histórico desde la implementación</span>';
}

function tarjetaGrafico(c) {
  return '<div class="panel-card" style="padding:16px 18px;">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:2px;">' + esc(c.titulo) + '</div>' +
    badgeFuente(c) +
    '<div id="sinDatos-' + c.id + '" class="empty-state" style="display:none;padding:14px;">Sin datos en el periodo seleccionado.</div>' +
    '<canvas id="chart-' + c.id + '" height="110"></canvas>' +
    '<details class="grafico-tabla" style="margin-top:10px;">' +
      '<summary style="cursor:pointer;font-size:11.5px;color:var(--brand-dark);font-weight:600;">Ver datos en tabla</summary>' +
      '<div class="table-scroll" style="margin-top:8px;"><table><thead id="tablaHead-' + c.id + '"></thead><tbody id="tablaBody-' + c.id + '"></tbody></table></div>' +
    '</details>' +
    '<div style="font-size:10.5px;color:var(--sub);margin-top:8px;">Fuente: ' + esc(c.fuente) + '</div>' +
  '</div>';
}

function renderGraficosSection(data) {
  const primeraFecha = data.primeraFechaSnapshot ? fmtFechaCorta(data.primeraFechaSnapshot) : null;

  const html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:10px;">' +
      '<div style="font-size:12px;color:var(--sub);">Filtra el periodo visible en todos los gráficos a la vez.' +
        (primeraFecha ? ' Los snapshots diarios tienen datos desde el ' + esc(primeraFecha) + ' — no se inventa ningún histórico anterior.' : ' Los snapshots diarios todavía no tienen ningún día completo — se irán llenando a partir de la próxima ejecución correcta de cada agente.') +
      '</div>' +
      '<div id="filtroDiasGraficos" style="display:flex;background:#fff;border:1px solid var(--border);border-radius:8px;padding:3px;flex-shrink:0;">' +
        data.diasDisponibles.map((d, i) => '<button type="button" class="btn-dias-grafico" data-dias="' + d + '" style="padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:' + (i === data.diasDisponibles.length - 1 ? 'var(--brand)' : 'transparent') + ';color:' + (i === data.diasDisponibles.length - 1 ? '#fff' : 'var(--sub)') + ';" onclick="hmtGraficosFiltrar(' + d + ')">' + d + ' días</button>').join('') +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin-top:14px;">' +
      CHARTS.map(tarjetaGrafico).join('') +
    '</div>';

  const script = construirScript(data);
  return { html, script };
}

// El cliente recibe los datos crudos ya ordenados por fecha ascendente y
// hace él mismo el recorte por días — evita una petición de red por cada
// cambio de filtro. Chart.js se instancia de forma perezosa (solo la
// primera vez que se navega a la página "Gráficos", vía hmtGraficosInit)
// porque un <canvas> dentro de una página oculta (display:none) mide 0x0
// y Chart.js no lo dibujaría bien si se instanciara antes de verse.
function construirScript(data) {
  const payload = JSON.stringify({
    series: {
      matches: (data.historialSync || []).map((r) => ({ fecha: r.started_at, total_matched: r.total_matched, total_cambiarian: r.total_cambiarian, total_a_cero: r.total_a_cero })),
      ejecuciones: data.ejecucionesPorDia || [],
      oportunidades: (data.oportunidadesSnapshots || []).map((r) => ({ fecha: r.fecha, total_candidatos: r.total_candidatos, recomendadas: r.recomendadas, excedente_categoria: r.excedente_categoria, excedente_total: r.excedente_total })),
      stock: (data.stockSnapshots || []).map((r) => ({ fecha: r.fecha, matched: r.matched, con_diferencia: r.con_diferencia, a_cero: r.a_cero, sin_cambio: r.sin_cambio })),
      rentabilidad: (data.rentabilidadSnapshots || []).map((r) => ({ fecha: r.fecha, en_perdida: r.en_perdida, margen_bajo: r.margen_bajo, datos_incompletos: r.datos_incompletos })),
      demanda: (data.historialDemanda || []).map((r) => ({ fecha: r.started_at, total_keywords: r.total_keywords, verificadas: r.verificadas, sugeridas_sin_verificar: r.sugeridas_sin_verificar }))
    },
    afinidadUltima: (data.oportunidadesSnapshots && data.oportunidadesSnapshots.length)
      ? data.oportunidadesSnapshots[data.oportunidadesSnapshots.length - 1]
      : null
  }).replace(/</g, '\\u003c');

  return 'window.__GRAFICOS__ = ' + payload + ';\n' +
    'var hmtGraficosInstancias = {};\n' +
    'var hmtGraficosListos = false;\n' +
    'function hmtFmtFecha(iso){var d=new Date(iso);if(isNaN(d.getTime()))return "—";return d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit"});}\n' +
    'function hmtRecorta(lista,dias){var corte=Date.now()-dias*86400000;return (lista||[]).filter(function(p){var t=new Date(p.fecha).getTime();return !isNaN(t)&&t>=corte;});}\n' +
    'function hmtMostrarSinDatos(id,vacio){var el=document.getElementById("sinDatos-"+id);var cv=document.getElementById("chart-"+id);if(el)el.style.display=vacio?"block":"none";if(cv)cv.style.display=vacio?"none":"block";}\n' +
    'function hmtTabla(id,cols,filas){var head=document.getElementById("tablaHead-"+id);var body=document.getElementById("tablaBody-"+id);if(!head||!body)return;head.innerHTML="<tr>"+cols.map(function(c){return "<th>"+c[1]+"</th>";}).join("")+"</tr>";body.innerHTML=filas.map(function(f){return "<tr>"+cols.map(function(c){return "<td"+(c[0]==="fecha"?"":" class=\\"num\\"")+">"+(c[0]==="fecha"?hmtFmtFecha(f.fecha):(f[c[0]]==null?"—":f[c[0]])) +"</td>";}).join("")+"</tr>";}).join("");}\n' +
    'function hmtLineChart(id,filas,campos){var ctx=document.getElementById("chart-"+id);if(!ctx)return;if(hmtGraficosInstancias[id])hmtGraficosInstancias[id].destroy();hmtGraficosInstancias[id]=new Chart(ctx,{type:"line",data:{labels:filas.map(function(f){return hmtFmtFecha(f.fecha);}),datasets:campos.map(function(c){return {label:c[1],data:filas.map(function(f){return f[c[0]];}),borderColor:c[2],backgroundColor:c[2],tension:0.25,spanGaps:true};})},options:{responsive:true,plugins:{legend:{display:campos.length>1,labels:{boxWidth:10,font:{size:10.5}}}},scales:{y:{beginAtZero:true,ticks:{font:{size:10.5}}},x:{ticks:{font:{size:10.5}}}}}});}\n' +
    'function hmtBarChart(id,filas,campos,stacked){var ctx=document.getElementById("chart-"+id);if(!ctx)return;if(hmtGraficosInstancias[id])hmtGraficosInstancias[id].destroy();hmtGraficosInstancias[id]=new Chart(ctx,{type:"bar",data:{labels:filas.map(function(f){return hmtFmtFecha(f.fecha);}),datasets:campos.map(function(c){return {label:c[1],data:filas.map(function(f){return f[c[0]];}),backgroundColor:c[2]};})},options:{responsive:true,plugins:{legend:{labels:{boxWidth:10,font:{size:10.5}}}},scales:{y:{beginAtZero:true,stacked:!!stacked,ticks:{font:{size:10.5}}},x:{stacked:!!stacked,ticks:{font:{size:10.5}}}}}});}\n' +
    'function hmtHorizontalBar(id,etiquetas,valores,color){var ctx=document.getElementById("chart-"+id);if(!ctx)return;if(hmtGraficosInstancias[id])hmtGraficosInstancias[id].destroy();hmtGraficosInstancias[id]=new Chart(ctx,{type:"bar",data:{labels:etiquetas,datasets:[{data:valores,backgroundColor:color}]},options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{font:{size:10.5}}},y:{ticks:{font:{size:10.5}}}}}});}\n' +
    'function hmtGraficosFiltrar(dias){\n' +
    '  var sel=document.querySelectorAll("#filtroDiasGraficos .btn-dias-grafico");sel.forEach(function(b){var activo=Number(b.getAttribute("data-dias"))===dias;b.style.background=activo?"var(--brand)":"transparent";b.style.color=activo?"#fff":"var(--sub)";});\n' +
    '  var s=window.__GRAFICOS__.series;\n' +
    '  var matches=hmtRecorta(s.matches,dias);hmtMostrarSinDatos("matches",matches.length===0);if(matches.length)hmtLineChart("matches",matches,[["total_matched","Coincidencias","#087F78"],["total_cambiarian","Cambios propuestos","#D97706"],["total_a_cero","A stock cero","#DC2626"]]);hmtTabla("matches",[["fecha","Fecha"],["total_matched","Coincidencias"],["total_cambiarian","Cambios"],["total_a_cero","A cero"]],matches);\n' +
    '  var ejec=hmtRecorta(s.ejecuciones,dias);hmtMostrarSinDatos("ejecuciones",ejec.length===0);if(ejec.length)hmtBarChart("ejecuciones",ejec,[["correctas","Correctas","#059669"],["fallidas","Fallidas","#DC2626"]],true);hmtTabla("ejecuciones",[["fecha","Fecha"],["correctas","Correctas"],["fallidas","Fallidas"],["enCurso","En curso"]],ejec);\n' +
    '  var op=hmtRecorta(s.oportunidades,dias);hmtMostrarSinDatos("oportunidades",op.length===0);if(op.length)hmtBarChart("oportunidades",op,[["recomendadas","Recomendadas","#059669"],["excedente_categoria","Excedente categoría","#2563EB"],["excedente_total","Excedente total","#7C3AED"]],true);hmtTabla("oportunidades",[["fecha","Fecha"],["total_candidatos","Total"],["recomendadas","Recomendadas"],["excedente_categoria","Exc. categoría"],["excedente_total","Exc. total"]],op);\n' +
    '  var af=window.__GRAFICOS__.afinidadUltima;hmtMostrarSinDatos("afinidad",!af);if(af){hmtHorizontalBar("afinidad",["Principal","Complementaria","Estacional","Ambigua","Fuera de foco"],[af.afinidad_principal,af.afinidad_complementaria,af.afinidad_estacional,af.afinidad_ambigua,af.afinidad_fuera_de_foco],"#087F78");hmtTabla("afinidad",[["fecha","Fecha del snapshot"],["afinidad_principal","Principal"],["afinidad_complementaria","Complementaria"],["afinidad_estacional","Estacional"],["afinidad_ambigua","Ambigua"],["afinidad_fuera_de_foco","Fuera de foco"]],[af]);}\n' +
    '  var st=hmtRecorta(s.stock,dias);hmtMostrarSinDatos("stock",st.length===0);if(st.length)hmtLineChart("stock",st,[["matched","Coincidencias","#087F78"],["con_diferencia","Con diferencia","#D97706"],["a_cero","A cero","#DC2626"]]);hmtTabla("stock",[["fecha","Fecha"],["matched","Coincidencias"],["con_diferencia","Con diferencia"],["a_cero","A cero"],["sin_cambio","Sin cambio"]],st);\n' +
    '  var rent=hmtRecorta(s.rentabilidad,dias);hmtMostrarSinDatos("rentabilidad",rent.length===0);if(rent.length)hmtLineChart("rentabilidad",rent,[["en_perdida","En pérdida","#DC2626"],["margen_bajo","Margen bajo","#D97706"],["datos_incompletos","Datos incompletos","#6B7280"]]);hmtTabla("rentabilidad",[["fecha","Fecha"],["en_perdida","En pérdida"],["margen_bajo","Margen bajo"],["datos_incompletos","Datos incompletos"]],rent);\n' +
    '  var dem=hmtRecorta(s.demanda,dias);hmtMostrarSinDatos("demanda",dem.length===0);if(dem.length)hmtBarChart("demanda",dem,[["verificadas","Verificadas (real)","#059669"],["sugeridas_sin_verificar","Sugeridas, sin verificar","#9CA3AF"]],true);hmtTabla("demanda",[["fecha","Fecha"],["total_keywords","Total keywords"],["verificadas","Verificadas"],["sugeridas_sin_verificar","Sin verificar"]],dem);\n' +
    '}\n' +
    'function hmtGraficosInit(){if(hmtGraficosListos)return;if(typeof Chart==="undefined"){console.error("Chart.js no se cargó — revisa /vendor/chartjs-4.4.4/chart.umd.js");return;}hmtGraficosListos=true;hmtGraficosFiltrar(' + (data.diasDisponibles[data.diasDisponibles.length - 1]) + ');}\n' +
    'window.hmtGraficosInit=hmtGraficosInit;window.hmtGraficosFiltrar=hmtGraficosFiltrar;';
}

module.exports = { renderGraficosSection };
