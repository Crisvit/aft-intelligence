// [dashboard] Página Oportunidades — candidatos + Score v3. Fija el
// comportamiento pedido: «Solo candidatas» por defecto (con descartadas y su
// motivo disponibles), orden por Score v3, los 5 componentes con fuente y
// explicación, cobertura/datos pendientes diferenciados, y «Sin datos»
// nunca sustituido por un valor inventado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
  historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
  fichasBorradores: [], iaConectada: false
};

function componente(puntos, max, explicacion, fuente) {
  return { puntos, max, explicacion, fuente, estado: puntos == null ? 'Sin datos' : 'ok' };
}

function filaOportunidad(overrides) {
  return {
    ref: 'AFT-1', marca: 'Wolfpack', descripcion: 'Taladro percutor', categoria_nombre: 'Herramienta Electrica',
    stock: 12, coste: 20, precio: 50, margenPct: 40, score: 80, motivo: 'marca prioritaria + margen',
    es_candidato: true, motivo_descarte: null, ranking_categoria: 1,
    score_v3: 55, score_v3_cobertura: 0.55, score_v3_etiqueta: 'Analizar',
    score_v3_detalle: {
      resumen: 'Score v3 55/100 con 55% de datos medidos (Analizar, confianza Media)',
      confianza: 'Media',
      componentes: {
        rentabilidad: componente(20, 30, 'Margen proyectado 40% → 20/30 pts.', 'Cálculo propio con coste AFT y PVP recomendado (hmt-db)'),
        demanda: componente(null, 25, 'Sin datos: no hay volumen de búsqueda verificado para esta referencia. No suma puntos.', 'Volumen de búsqueda verificado (DataForSEO)'),
        competitividad: componente(null, 20, 'Sin datos: no hay precio de mercado verificado con el que comparar. No suma puntos.', 'Precio de mercado verificado'),
        stock: componente(12, 15, 'Stock AFT 12 uds. → 12/15 pts.', 'Stock AFT en hmt-db'),
        afinidad: componente(10, 10, 'Categoría «Herramienta Electrica»: línea principal → 10/10 pts.', 'Categoría AFT frente a las líneas del negocio')
      }
    },
    ...overrides
  };
}

test('[dashboard] por defecto el checkbox «Solo candidatas» existe y está marcado', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  assert.match(html, /id="filtroSoloCandidatas"[^>]*checked/);
});

test('[dashboard] una candidata muestra la insignia «Candidata» con su puesto en la categoría', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({ ranking_categoria: 2 })] });
  assert.match(html, /Candidata · #2 cat\./);
});

test('[dashboard] una descartada muestra la insignia «Descartada» y su motivo exacto, nunca oculto', () => {
  const fila = filaOportunidad({ ref: 'AFT-2', es_candidato: false, motivo_descarte: 'stock AFT 3 uds. < mínimo 10', score_v3: null, score_v3_cobertura: null, score_v3_etiqueta: null, score_v3_detalle: null });
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [fila] });
  assert.match(html, />Descartada</);
  assert.match(html, /Descartada: stock AFT 3 uds\. &lt; mínimo 10/);
});

test('[dashboard] las candidatas se ordenan por Score v3 descendente, antes que las descartadas', () => {
  const baja = filaOportunidad({ ref: 'AFT-BAJA', score_v3: 20 });
  const alta = filaOportunidad({ ref: 'AFT-ALTA', score_v3: 80 });
  const descartada = filaOportunidad({ ref: 'AFT-DESC', es_candidato: false, motivo_descarte: 'margen 5% < mínimo 20%', score_v3: 95 });
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [baja, descartada, alta] });
  const iAlta = html.indexOf('AFT-ALTA');
  const iBaja = html.indexOf('AFT-BAJA');
  const iDesc = html.indexOf('AFT-DESC');
  assert.ok(iAlta < iBaja, 'la candidata con más Score v3 debe aparecer antes');
  assert.ok(iBaja < iDesc, 'las candidatas (aunque con menos score) deben aparecer antes que las descartadas, pese a que la descartada tenga score_v3 más alto');
});

test('[dashboard] el desglose del Score v3 muestra los 5 componentes con puntos, fuente y explicación', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  assert.match(html, /Ver desglose del Score v3 \(5 componentes\)/);
  for (const nombre of ['Rentabilidad', 'Demanda', 'Competitividad', 'Stock', 'Afinidad comercial']) {
    assert.match(html, new RegExp(nombre));
  }
  assert.match(html, /Margen proyectado 40%/); // explicación de rentabilidad
  assert.match(html, /Fuente: Cálculo propio con coste AFT y PVP recomendado \(hmt-db\)/);
  assert.match(html, /Fuente: Volumen de búsqueda verificado \(DataForSEO\)/);
});

test('[dashboard] cuando falta demanda o competitividad real se muestra «Sin datos», nunca un número inventado', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  // Las dos componentes sin fuente conectada deben mostrar la insignia "Sin datos"
  // dentro del desglose, y nunca "0/25 pts" o "0/20 pts" en su lugar.
  assert.doesNotMatch(html, /0\/25 pts/);
  assert.doesNotMatch(html, /0\/20 pts/);
  assert.match(html, /Sin datos: no hay volumen de búsqueda verificado/);
  assert.match(html, /Sin datos: no hay precio de mercado verificado/);
});

test('[dashboard] diferencia puntuación obtenida, cobertura y datos pendientes', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  assert.match(html, /55\.0\/100/); // puntuación obtenida (score_v3)
  assert.match(html, />55%</); // cobertura de datos
  assert.match(html, /Datos pendientes \(no puntúan, nunca se inventan\): Demanda, Competitividad/);
});

test('[dashboard] una oportunidad sin score_v3 calculado muestra «Sin datos» en la columna, no un guion u otro valor', () => {
  const fila = filaOportunidad({ score_v3: null, score_v3_cobertura: null, score_v3_etiqueta: null, score_v3_detalle: null });
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [fila] });
  assert.match(html, /<td class="num" data-label="Score v3">\s*<span class="badge badge-off"[^>]*>Sin datos<\/span>/);
});

test('[dashboard] el filtro JS del cliente combina marca, margen y «solo candidatas»', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  assert.match(html, /function filtrarOportunidades\(\)/);
  assert.match(html, /filtroSoloCandidatas/);
  assert.match(html, /data-candidata/);
});

test('[dashboard] «Solo candidatas» se aplica DE VERDAD al cargar la página, no solo el checkbox marcado', () => {
  // Bug real encontrado en verificación manual: el checkbox se renderizaba
  // marcado por defecto, pero sin invocar el filtro al cargar la página
  // todas las filas (candidatas y descartadas) quedaban visibles hasta que
  // alguien tocara el filtro a mano — «por defecto» no era cierto todavía.
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({})] });
  const idxDef = html.indexOf('function filtrarOportunidades()');
  const idxCall = html.indexOf('filtrarOportunidades();', idxDef + 1);
  assert.ok(idxDef > -1, 'la función debe estar definida');
  assert.ok(idxCall > idxDef, 'debe invocarse de forma incondicional al cargar, después de definirse');
});

test('[dashboard] sin ninguna oportunidad se muestra el estado vacío, no una tabla rota', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [] });
  assert.match(html, /Ninguna referencia de tus marcas\/categorías comerciales está pendiente/);
  assert.doesNotMatch(html, /id="filtroSoloCandidatas"/);
});

test('[dashboard] el sistema de puntuación anterior (score\\/motivo) se conserva como nota informativa, sin desaparecer', () => {
  const html = buildDashboardHtml({ ...BASE, oportunidadRows: [filaOportunidad({ motivo: 'marca prioritaria + margen proyectado' })] });
  assert.match(html, /Sistema de puntuación anterior \(informativo, sin cambios\): marca prioritaria \+ margen proyectado/);
});
