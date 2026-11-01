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
//
// Fase 2 — afinidad comercial (src/domain/afinidad.js) como componente
// MÁS del score, en modo observación por defecto: OPORTUNIDADES_PESO_AFINIDAD=0
// significa que su contribución es matemáticamente 0 siempre, sin excepción
// — se calcula y se explica en "motivo" (para poder observarla), pero no
// puede cambiar ningún score mientras el peso siga en 0. Ver
// test/oportunidades.test.js para la prueba de regresión que lo confirma.
const { round2 } = require('./costeMargen');
const { clasificarAfinidadComercial } = require('./afinidad');

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
// Peso del componente de afinidad comercial — 0 por defecto (modo
// observación): se calcula y se muestra en "motivo", pero nunca aporta
// puntos mientras no se active a propósito.
const PESO_AFINIDAD = Number(process.env.OPORTUNIDADES_PESO_AFINIDAD) || 0;
// Multiplicador del peso de afinidad según la clase — 'fuera_de_foco' y
// 'ambigua' nunca aportan puntos, ni siquiera si se sube el peso por
// encima de 0 (no tendría sentido premiar una categoría fuera de foco o
// sin clasificar todavía).
const MULTIPLICADOR_AFINIDAD = { principal: 1, complementaria: 0.6, estacional: 0.5, fuera_de_foco: 0, ambigua: 0 };

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
  const afinidad = clasificarAfinidadComercial(row.categoria);

  const ptsMarca = prioritaria ? PESO_MARCA_PRIORITARIA : 0;
  const ptsMargen = margen != null ? round2(Math.max(0, Math.min(1, margen / MARGEN_REFERENCIA_SATURACION)) * PESO_MARGEN_MAX) : 0;
  const ptsStock = round2(Math.max(0, Math.min(1, stock / STOCK_REFERENCIA_SATURACION)) * PESO_STOCK_MAX);
  const ptsAfinidad = round2((MULTIPLICADOR_AFINIDAD[afinidad.clase] || 0) * PESO_AFINIDAD);
  const score = round2(ptsMarca + ptsMargen + ptsStock + ptsAfinidad);

  // Complementaria: margen proyectado no negativo y PVP recomendado bajo —
  // candidato a venta cruzada, nunca una señal de demanda real (no hay
  // ninguna fuente de demanda conectada en este cálculo).
  const esComplementaria = margen != null && margen >= 0 && pvp != null && pvp <= PVP_COMPLEMENTO_MAX;

  const partes = [];
  partes.push(prioritaria ? `marca prioritaria (${row.marca || '—'}, +${ptsMarca} pts)` : 'marca no prioritaria (+0 pts)');
  partes.push(margen != null ? `margen proyectado ${margen}% (+${ptsMargen} pts)` : 'margen proyectado no disponible (+0 pts)');
  partes.push(`stock AFT ${stock} uds. (+${ptsStock} pts)`);
  partes.push(`afinidad ${afinidad.clase} (+${ptsAfinidad} pts)`);
  if (esComplementaria) partes.push(`PVP ${pvp}€ ≤ ${PVP_COMPLEMENTO_MAX}€ — candidata a venta complementaria`);
  const motivo = 'Puntuación ' + score + '/100: ' + partes.join(' · ') + '.';

  return { score, esPrioritaria: prioritaria, esComplementaria, motivo, afinidad };
}

// Orden determinista: score DESC, margenPct DESC (sin dato al final), stock
// DESC, ref ASC — este último desempate garantiza unicidad siempre (ref es
// PK en oportunidades_resultados), así el orden nunca depende del orden de
// llegada de las filas ni de ningún valor ausente.
function compararCandidatos(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const margenA = a.margenPct != null ? Number(a.margenPct) : null;
  const margenB = b.margenPct != null ? Number(b.margenPct) : null;
  if (margenA !== margenB) {
    if (margenA == null) return 1;
    if (margenB == null) return -1;
    return margenB - margenA;
  }
  const stockA = a.stock != null ? Number(a.stock) : 0;
  const stockB = b.stock != null ? Number(b.stock) : 0;
  if (stockB !== stockA) return stockB - stockA;
  return String(a.ref || '').localeCompare(String(b.ref || ''));
}

// seleccionarRanking: NUNCA descarta ningún candidato — anota en cada uno
// cuál es su estado de elegibilidad, pero todos se devuelven (y por tanto se
// persisten todos en hmt-db; el recorte es solo informativo, nunca de datos).
// "excedente_categoria": válido pero supera el tope por categoría.
// "excedente_total": válido pero supera el tope global del ranking principal.
// "fuera_de_foco" / "ambigua_revision": según afinidad, SOLO cuando
// filtroAfinidadActivo=true — con el gate en false (por defecto, modo
// observación) la afinidad nunca decide elegibilidad, solo puntúa (y puntúa
// 0 mientras PESO_AFINIDAD siga en 0).
function seleccionarRanking(candidatos, opciones) {
  const opts = opciones || {};
  const maxPorCategoria = opts.maxPorCategoria != null ? opts.maxPorCategoria : 4;
  const maxCandidatosTotal = opts.maxCandidatosTotal != null ? opts.maxCandidatosTotal : 60;
  const filtroAfinidadActivo = !!opts.filtroAfinidadActivo;

  const ordenados = candidatos.slice().sort(compararCandidatos);
  const porCategoria = new Map();
  let totalRecomendadas = 0;

  return ordenados.map((c) => {
    const clase = c.afinidad && c.afinidad.clase;
    if (filtroAfinidadActivo && clase === 'fuera_de_foco') {
      return { ...c, estadoElegibilidad: 'fuera_de_foco' };
    }
    if (filtroAfinidadActivo && clase === 'ambigua') {
      return { ...c, estadoElegibilidad: 'ambigua_revision' };
    }

    const categoria = c.categoria || '';
    const countCategoria = porCategoria.get(categoria) || 0;
    if (countCategoria >= maxPorCategoria) {
      return { ...c, estadoElegibilidad: 'excedente_categoria' };
    }
    if (totalRecomendadas >= maxCandidatosTotal) {
      return { ...c, estadoElegibilidad: 'excedente_total' };
    }

    porCategoria.set(categoria, countCategoria + 1);
    totalRecomendadas += 1;
    return { ...c, estadoElegibilidad: 'recomendada' };
  });
}

module.exports = {
  calcularOportunidad,
  esMarcaPrioritaria,
  BRANDS_PRIORITARIAS,
  PVP_COMPLEMENTO_MAX,
  seleccionarRanking
};
