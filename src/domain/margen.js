// Capa de dominio (Clean Architecture) — clasificación de margen en
// franjas de autorización comercial. Nueva (fase 2). Puramente
// informativa: NUNCA excluye nada ni entra en el cálculo del score de
// oportunidades (eso sigue siendo solo marca + margen proyectado + stock
// + afinidad, en src/domain/oportunidades.js) — es una columna adicional
// al lado, no un ingrediente del cálculo.
//
// Franjas (decisión comercial explícita, no una suposición de este código):
//   < 10%        -> 'autorizacion_excepcional' (requiere autorización excepcional)
//   10% a 15%     -> 'revision_comercial' (ambos extremos inclusive)
//   > 15%        -> 'apto_evaluacion'
//   >= 20%        -> además, prioridadAdicional=true (no es una franja aparte,
//                    es un extra dentro de 'apto_evaluacion')
//   null/undefined -> 'sin_dato', nunca se asume una franja sin el dato real.
function clasificarMargen(margenPct) {
  if (margenPct === null || margenPct === undefined || Number.isNaN(Number(margenPct))) {
    return { tier: 'sin_dato', prioridadAdicional: false, motivo: 'Sin margen calculado — no se asume ninguna franja.' };
  }
  const m = Number(margenPct);

  if (m < 10) {
    return { tier: 'autorizacion_excepcional', prioridadAdicional: false, motivo: `Margen ${m}% por debajo del 10% — requiere autorización excepcional.` };
  }
  if (m <= 15) {
    return { tier: 'revision_comercial', prioridadAdicional: false, motivo: `Margen ${m}% entre 10% y 15% — revisión comercial.` };
  }
  const prioridadAdicional = m >= 20;
  return {
    tier: 'apto_evaluacion',
    prioridadAdicional,
    motivo: prioridadAdicional
      ? `Margen ${m}% por encima del 15% — apto para evaluación, con prioridad comercial adicional (≥20%).`
      : `Margen ${m}% por encima del 15% — apto para evaluación.`
  };
}

module.exports = { clasificarMargen };
