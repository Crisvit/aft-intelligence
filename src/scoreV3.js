// Score v3 — recuperado del sistema antiguo, SIN sus valores inventados.
//
// Pesos originales (suman 100): rentabilidad 30 · demanda 25 ·
// competitividad 20 · stock 15 · afinidad comercial 10.
//
// Diferencia deliberada con el sistema antiguo: allí, sin datos, la
// demanda valía 12,5/25 y la competitividad 10/20 (valores neutros que
// parecían una medición). Aquí, si no hay dato REAL, el componente es
// «Sin datos»: puntos = null, no suma nada, y el resumen lo dice. Nunca
// se rellena con un valor intermedio.
//
// Cómo se lee el resultado:
//   - puntos: suma de los puntos realmente medidos (sobre 100).
//   - puntosEvaluables: máximo alcanzable con los componentes que sí
//     tienen dato (p. ej. 55 si faltan demanda y competitividad).
//   - cobertura: puntosEvaluables / 100 (cuánto del score está medido).
//   - puntosNormalizados: puntos / puntosEvaluables × 100, para comparar
//     referencias con la misma cobertura.
//   - etiqueta: se calcula sobre puntosNormalizados, pero sin dato real de
//     demanda NUNCA pasa de «Analizar» (el sistema antiguo también topaba
//     el total en 59 sin evidencia).
// Función PURA: no toca base de datos ni red.

const PESOS = {
  rentabilidad: Number(process.env.SCORE_V3_PESO_RENTABILIDAD) || 30,
  demanda: Number(process.env.SCORE_V3_PESO_DEMANDA) || 25,
  competitividad: Number(process.env.SCORE_V3_PESO_COMPETITIVIDAD) || 20,
  stock: Number(process.env.SCORE_V3_PESO_STOCK) || 15,
  afinidad: Number(process.env.SCORE_V3_PESO_AFINIDAD) || 10
};

const MARGEN_REFERENCIA = 50;      // % a partir del cual el margen satura
const BENEFICIO_REFERENCIA = 40;   // € de beneficio a partir del cual satura
const VOLUMEN_REFERENCIA = 10000;  // búsquedas/mes a partir de las que la demanda satura

// Afinidad comercial con el negocio (listas del panel original).
const AFINIDAD_CORE = ['herramienta', 'electroportatil', 'amoladora', 'taladro', 'sierra', 'motosierra', 'desbrozador', 'hidrolimpiadora', 'compresor', 'generador', 'soldadora', 'disco de corte', 'disco abrasivo', 'lija', 'broca', 'poda'];
const AFINIDAD_MEDIA = ['llave', 'destornillador', 'nivel', 'manguera', 'riego', 'bomba de agua', 'malla de sombreo', 'soldar', 'pantalla', 'cubrefiltro'];
const AFINIDAD_BAJA = ['bota', 'ropa de trabajo'];
const PROPORCION_AFINIDAD = { core: 1, media: 0.6, baja: 0.3 };

function normalizarTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clasificarAfinidad(categoria) {
  const c = normalizarTxt(categoria);
  if (!c) return 'sin_dato';
  if (AFINIDAD_CORE.some((k) => c.includes(k))) return 'core';
  if (AFINIDAD_MEDIA.some((k) => c.includes(k))) return 'media';
  if (AFINIDAD_BAJA.some((k) => c.includes(k))) return 'baja';
  return 'baja'; // categoría conocida pero ajena al negocio principal
}

function sinDatos(max, fuente, porQue) {
  return { puntos: null, max, estado: 'Sin datos', fuente, explicacion: `Sin datos: ${porQue}. No suma puntos.` };
}

function componenteRentabilidad(input) {
  const max = PESOS.rentabilidad;
  const fuente = 'Cálculo propio con coste AFT y PVP recomendado (hmt-db)';
  const margen = input.margenPct != null ? Number(input.margenPct) : null;
  const precio = input.precio != null ? Number(input.precio) : null;
  const coste = input.coste != null ? Number(input.coste) : null;
  if (margen == null || !Number.isFinite(margen)) return sinDatos(max, fuente, 'margen proyectado no disponible');

  const margenScore = Math.min(1, Math.max(0, margen) / MARGEN_REFERENCIA);
  const beneficio = precio != null && coste != null ? precio - coste : null;
  // Sin precio/coste no se puede medir el beneficio absoluto: el margen decide solo.
  const beneficioScore = beneficio != null ? Math.min(1, Math.max(0, beneficio) / BENEFICIO_REFERENCIA) : null;
  const mezcla = beneficioScore != null ? 0.5 * margenScore + 0.5 * beneficioScore : margenScore;
  const puntos = round1(max * mezcla);
  const detalleBeneficio = beneficio != null ? `, beneficio ${round1(beneficio)}€ (satura en ${BENEFICIO_REFERENCIA}€)` : ', beneficio absoluto no disponible (solo cuenta el margen)';
  return {
    puntos, max, estado: 'ok', fuente,
    explicacion: `Margen proyectado ${margen}% (satura en ${MARGEN_REFERENCIA}%)${detalleBeneficio} → ${puntos}/${max} pts.`
  };
}

function componenteDemanda(input) {
  const max = PESOS.demanda;
  const fuente = 'Volumen de búsqueda verificado (DataForSEO)';
  const volumen = input.volumenDemanda;
  if (volumen == null || !Number.isFinite(Number(volumen))) {
    return sinDatos(max, fuente, 'no hay volumen de búsqueda verificado para esta referencia (fuente de demanda no conectada o sin resultado)');
  }
  const v = Math.max(0, Number(volumen));
  const puntos = round1(max * Math.min(1, Math.log10(v + 1) / Math.log10(VOLUMEN_REFERENCIA)));
  return {
    puntos, max, estado: 'ok', fuente,
    explicacion: `Volumen de búsqueda verificado ${v}/mes (escala logarítmica, satura en ${VOLUMEN_REFERENCIA}) → ${puntos}/${max} pts.`
  };
}

function componenteCompetitividad(input) {
  const max = PESOS.competitividad;
  const fuente = 'Precio de mercado verificado';
  const mercado = input.precioMercado != null ? Number(input.precioMercado) : null;
  const precio = input.precio != null ? Number(input.precio) : null;
  if (mercado == null || !(mercado > 0) || precio == null) {
    return sinDatos(max, fuente, 'no hay precio de mercado verificado con el que comparar');
  }
  const posicion = precio / mercado;
  let proporcion;
  let lectura;
  if (posicion >= 0.8 && posicion <= 1.2) { proporcion = 1; lectura = 'en línea con el mercado'; }
  else if (posicion < 0.8) { proporcion = 0.85; lectura = 'por debajo del mercado'; }
  else if (posicion <= 1.5) { proporcion = 0.45; lectura = 'algo por encima del mercado'; }
  else { proporcion = 0.1; lectura = 'muy por encima del mercado'; }
  const puntos = round1(max * proporcion);
  return {
    puntos, max, estado: 'ok', fuente,
    explicacion: `Nuestro PVP ${precio}€ frente a ${mercado}€ de mercado (${Math.round(posicion * 100)}%, ${lectura}) → ${puntos}/${max} pts.`
  };
}

function componenteStock(input) {
  const max = PESOS.stock;
  const fuente = 'Stock AFT en hmt-db';
  if (input.stock == null || !Number.isFinite(Number(input.stock))) {
    return sinDatos(max, fuente, 'stock AFT no disponible');
  }
  const stock = Number(input.stock);
  let tramo;
  if (stock <= 0) tramo = 0;
  else if (stock <= 2) tramo = 0.2;
  else if (stock <= 5) tramo = 0.4;
  else if (stock <= 10) tramo = 0.6;
  else if (stock <= 25) tramo = 0.8;
  else tramo = 1;
  const puntos = round1(max * tramo);
  return { puntos, max, estado: 'ok', fuente, explicacion: `Stock AFT ${stock} uds. (tramos 2/5/10/25) → ${puntos}/${max} pts.` };
}

function componenteAfinidad(input) {
  const max = PESOS.afinidad;
  const fuente = 'Categoría AFT frente a las líneas del negocio';
  const clase = clasificarAfinidad(input.categoria);
  if (clase === 'sin_dato') return sinDatos(max, fuente, 'la referencia no tiene categoría');
  const puntos = round1(max * PROPORCION_AFINIDAD[clase]);
  const nombres = { core: 'línea principal', media: 'línea complementaria', baja: 'línea marginal o ajena' };
  return { puntos, max, estado: 'ok', fuente, explicacion: `Categoría «${input.categoria}»: ${nombres[clase]} → ${puntos}/${max} pts.` };
}

function etiquetaDe(normalizados, hayDemanda) {
  let etiqueta = normalizados >= 90 ? 'Excelente' : normalizados >= 70 ? 'Interesante' : normalizados >= 50 ? 'Analizar' : 'Baja prioridad';
  if (!hayDemanda && (etiqueta === 'Excelente' || etiqueta === 'Interesante')) etiqueta = 'Analizar';
  return etiqueta;
}

// input: { margenPct, precio, coste, volumenDemanda, precioMercado, stock, categoria }
function calcularScoreV3(input) {
  const componentes = {
    rentabilidad: componenteRentabilidad(input),
    demanda: componenteDemanda(input),
    competitividad: componenteCompetitividad(input),
    stock: componenteStock(input),
    afinidad: componenteAfinidad(input)
  };

  const medidos = Object.values(componentes).filter((c) => c.puntos != null);
  const puntos = round1(medidos.reduce((s, c) => s + c.puntos, 0));
  const puntosEvaluables = round1(medidos.reduce((s, c) => s + c.max, 0));
  const totalPesos = Object.values(PESOS).reduce((s, p) => s + p, 0);
  const cobertura = totalPesos > 0 ? round1((puntosEvaluables / totalPesos) * 100) / 100 : 0;
  const puntosNormalizados = puntosEvaluables > 0 ? round1((puntos / puntosEvaluables) * 100) : null;
  const hayDemanda = componentes.demanda.puntos != null;
  const etiqueta = puntosNormalizados == null ? 'Sin datos' : etiquetaDe(puntosNormalizados, hayDemanda);
  const confianza = cobertura >= 0.9 ? 'Alta' : cobertura >= 0.55 ? 'Media' : 'Baja';

  const sinDato = Object.entries(componentes).filter(([, c]) => c.puntos == null).map(([k]) => k);
  const resumen = `Score v3 ${puntos}/100 con ${Math.round(cobertura * 100)}% de datos medidos (${etiqueta}, confianza ${confianza})` +
    (sinDato.length ? `. Sin datos: ${sinDato.join(', ')} — no puntúan.` : '.');

  return { puntos, puntosEvaluables, cobertura, puntosNormalizados, etiqueta, confianza, resumen, componentes };
}

module.exports = {
  calcularScoreV3, clasificarAfinidad, PESOS
};
