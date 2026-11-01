// Capa de dominio (Clean Architecture) — reglas de negocio puras, sin
// PostgreSQL, sin fetch, sin ningún require de infraestructura. Movidas
// tal cual desde src/oportunidades.js (fase 1 de la refactorización, sin
// cambiar su comportamiento — ver test/oportunidades.test.js).
//
// Puntuación explicable, nunca una caja negra: score = marca prioritaria +
// margen proyectado + stock disponible, cada componente visible en
// "motivo". No se inventa ninguna señal de demanda externa aquí — eso es
// responsabilidad exclusiva del Agente 5, y solo con una fuente real
// conectada (ver src/demanda.js). Una referencia revisada por un backup
// real de la primera versión del panel (n8n) usaba exactamente este tipo
// de fabricación de "demanda" cuando no había datos reales (un valor por
// defecto de 12.5/25 puntos incluso sin ninguna señal) — ese patrón se
// descarta aquí a propósito: sin dato real, el componente vale 0, no un
// valor intermedio inventado.
//
// Nota de la fase 1: los pesos/umbrales y BRANDS_PRIORITARIAS se leen de
// process.env al cargar el módulo (igual que antes) — simplificación
// deliberada de esta fase; inyectar configuración es trabajo de la capa
// de aplicación, en una fase posterior.
const { round2 } = require('./costeMargen');

function listaDesdeEnv(nombreEnv, porDefecto) {
  const valor = process.env[nombreEnv];
  if (!valor) return porDefecto;
  return valor.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}
// BRANDS_PRIORITARIAS decide el orden/puntuación de las oportunidades
// (esas marcas primero), nunca filtra inclusión — eso lo decide BRANDS
// (src/domain/costeMargen.js), un universo deliberadamente distinto.
const BRANDS_PRIORITARIAS = listaDesdeEnv('AFT_BRANDS_PRIORITARIAS', ['WOLFPACK', 'SAMURAI', 'MAURER', 'PAPILLON', 'SATURNIA']);

const PVP_COMPLEMENTO_MAX = Number(process.env.OPORTUNIDADES_PVP_COMPLEMENTO_MAX) || 15;
const PESO_MARCA_PRIORITARIA = Number(process.env.OPORTUNIDADES_PESO_MARCA_PRIORITARIA) || 40;
const PESO_MARGEN_MAX = Number(process.env.OPORTUNIDADES_PESO_MARGEN_MAX) || 40;
const PESO_STOCK_MAX = Number(process.env.OPORTUNIDADES_PESO_STOCK_MAX) || 20;
// Unidades de stock AFT a partir de las cuales el componente de stock
// satura (no sigue sumando por tener aún más unidades).
const STOCK_REFERENCIA_SATURACION = Number(process.env.OPORTUNIDADES_STOCK_REFERENCIA) || 20;
// Margen proyectado (%) a partir del cual el componente de margen satura.
const MARGEN_REFERENCIA_SATURACION = Number(process.env.OPORTUNIDADES_MARGEN_REFERENCIA) || 50;

function esMarcaPrioritaria(marca) {
  return BRANDS_PRIORITARIAS.some((m) => String(marca || '').toUpperCase().includes(m));
}

// Cada componente del score es trazable a un dato real de hmt-db; el
// "motivo" concatena exactamente esos mismos números, nunca una
// explicación genérica desconectada del cálculo.
function calcularOportunidad(row) {
  const prioritaria = esMarcaPrioritaria(row.marca);
  const margen = row.margenPct != null ? Number(row.margenPct) : null;
  const stock = row.stock != null ? Number(row.stock) : 0;
  const pvp = row.precio != null ? Number(row.precio) : null;

  const ptsMarca = prioritaria ? PESO_MARCA_PRIORITARIA : 0;
  const ptsMargen = margen != null ? round2(Math.max(0, Math.min(1, margen / MARGEN_REFERENCIA_SATURACION)) * PESO_MARGEN_MAX) : 0;
  const ptsStock = round2(Math.max(0, Math.min(1, stock / STOCK_REFERENCIA_SATURACION)) * PESO_STOCK_MAX);
  const score = round2(ptsMarca + ptsMargen + ptsStock);

  // Complementaria: margen proyectado no negativo y PVP recomendado bajo —
  // candidato a venta cruzada, nunca una señal de demanda real (no hay
  // ninguna fuente de demanda conectada en este cálculo).
  const esComplementaria = margen != null && margen >= 0 && pvp != null && pvp <= PVP_COMPLEMENTO_MAX;

  const partes = [];
  partes.push(prioritaria ? `marca prioritaria (${row.marca || '—'}, +${ptsMarca} pts)` : 'marca no prioritaria (+0 pts)');
  partes.push(margen != null ? `margen proyectado ${margen}% (+${ptsMargen} pts)` : 'margen proyectado no disponible (+0 pts)');
  partes.push(`stock AFT ${stock} uds. (+${ptsStock} pts)`);
  if (esComplementaria) partes.push(`PVP ${pvp}€ ≤ ${PVP_COMPLEMENTO_MAX}€ — candidata a venta complementaria`);
  const motivo = 'Puntuación ' + score + '/100: ' + partes.join(' · ') + '.';

  return { score, esPrioritaria: prioritaria, esComplementaria, motivo };
}

module.exports = { calcularOportunidad, esMarcaPrioritaria, BRANDS_PRIORITARIAS, PVP_COMPLEMENTO_MAX };
