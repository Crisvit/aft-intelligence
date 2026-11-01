// Capa de dominio (Clean Architecture) — regla de negocio pura, sin
// PostgreSQL, sin fetch, sin ningún require de infraestructura. Movida
// tal cual desde src/reposicion.js (fase 1 de la refactorización, sin
// cambiar su comportamiento — ver test/reposicion.test.js).

// Clasificación del cambio — puramente informativa para el historial, no
// cambia la decisión de escribir ni el valor escrito (siempre el stock_aft
// confirmado, como cantidad absoluta).
//  - 'producto_recuperado_stock_cero_negativo': Shopify estaba en 0 o
//    negativo y AFT confirma stock real > 0 — el caso más urgente.
//  - 'reposicion_detectada': Shopify ya tenía stock positivo, pero AFT
//    confirma más unidades de las que Shopify refleja.
//  - 'correccion_a_la_baja': AFT confirma MENOS unidades que Shopify
//    (incluido llegar a 0) — no es una reposición, es una corrección.
function clasificarEvento(antes, nuevo) {
  if (nuevo === antes) return 'sin_cambios';
  if (antes <= 0 && nuevo > 0) return 'producto_recuperado_stock_cero_negativo';
  if (nuevo > antes) return 'reposicion_detectada';
  return 'correccion_a_la_baja';
}

module.exports = { clasificarEvento };
