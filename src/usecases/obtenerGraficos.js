// Capa de casos de uso (Clean Architecture) — orquesta las consultas de
// src/repositories/graficosRepo.js y src/repositories/snapshotsRepo.js
// para la página "Gráficos" (fase 3). No construye ningún HTML — eso es
// responsabilidad exclusiva de src/views/graficosView.js. No inventa
// ningún dato: cuando una serie no tiene filas en el rango pedido, se
// devuelve vacía tal cual, y la vista/el cliente son quienes deciden cómo
// señalarlo ("sin datos"), nunca este módulo.
//
// Se consulta siempre la ventana máxima (90 días, el filtro más amplio
// que ofrece el dashboard) UNA sola vez por carga de página; el filtro de
// 7/30/90 días se aplica después, en el cliente, recortando estos mismos
// datos ya embebidos — evita una petición de red por cada cambio de
// filtro, igual que el resto de filtros del dashboard (ver
// filtrarOportunidades en src/buildDashboardHtml.js).
const { fechaHaceNDias, fechaMadrid } = require('../domain/fecha');
const graficosRepo = require('../repositories/graficosRepo');
const snapshotsRepo = require('../repositories/snapshotsRepo');

const DIAS_PERMITIDOS = [7, 30, 90];
const VENTANA_MAXIMA_DIAS = 90;

// Agrega el historial de ejecuciones (de todos los agentes, ya unificado
// por graficosRepo.historialEjecuciones) a conteos por día de calendario
// (Madrid) y estado — 'running' se cuenta aparte, nunca como éxito ni
// como fallo.
function agregarEjecucionesPorDia(filas) {
  const porDia = new Map();
  for (const f of filas) {
    const dia = fechaMadrid(new Date(f.started_at));
    if (!porDia.has(dia)) porDia.set(dia, { fecha: dia, correctas: 0, fallidas: 0, enCurso: 0 });
    const bucket = porDia.get(dia);
    if (f.status === 'success') bucket.correctas++;
    else if (f.status === 'error') bucket.fallidas++;
    else bucket.enCurso++;
  }
  return Array.from(porDia.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function obtenerGraficos() {
  const desdeFecha = fechaHaceNDias(VENTANA_MAXIMA_DIAS); // 'YYYY-MM-DD', para columnas DATE (snapshots)
  const desdeTimestamp = new Date(Date.now() - VENTANA_MAXIMA_DIAS * 86400000); // para columnas TIMESTAMPTZ (*_runs)

  const [
    historialSync, historialDemanda, historialEjecuciones,
    stockSnapshots, oportunidadesSnapshots, rentabilidadSnapshots,
    primeraFechaSnapshot
  ] = await Promise.all([
    graficosRepo.historialSyncRuns(desdeTimestamp),
    graficosRepo.historialDemandaRuns(desdeTimestamp),
    graficosRepo.historialEjecuciones(desdeTimestamp),
    snapshotsRepo.listarStockSnapshots(desdeFecha),
    snapshotsRepo.listarOportunidadesSnapshots(desdeFecha),
    snapshotsRepo.listarRentabilidadSnapshots(desdeFecha),
    snapshotsRepo.primeraFechaDisponible()
  ]);

  return {
    diasDisponibles: DIAS_PERMITIDOS, ventanaMaximaDias: VENTANA_MAXIMA_DIAS,
    historialSync, historialDemanda,
    ejecucionesPorDia: agregarEjecucionesPorDia(historialEjecuciones),
    stockSnapshots, oportunidadesSnapshots, rentabilidadSnapshots,
    primeraFechaSnapshot
  };
}

module.exports = { obtenerGraficos, DIAS_PERMITIDOS, VENTANA_MAXIMA_DIAS, agregarEjecucionesPorDia };
