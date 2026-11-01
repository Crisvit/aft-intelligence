// Filtro de candidatos a subir a Shopify (recuperado de la lógica del
// Agente 2 original, ahora configurable por entorno y explicable).
//
// Funciones PURAS: no tocan base de datos, AFT ni Shopify. No eliminan
// referencias del universo de oportunidades — solo marcan cuáles son
// candidatas y, para las que no lo son, dicen exactamente por qué (así el
// panel puede mostrarlo en vez de ocultarlo).
//
// Reglas (todas configurables, ver .env.example):
//   - stock AFT mínimo (por defecto 10 uds.)
//   - margen mínimo (por defecto 20 %)
//   - máximo de candidatos por categoría (por defecto 4)
//   - máximo total de candidatos (por defecto 60)
//   - exclusión de recambios/accesorios por texto en la descripción
//   - opcional: solo marcas prioritarias
// Dentro de cada categoría, las marcas prioritarias van primero y después
// por mayor margen proyectado.

function numeroDesdeEnv(nombre, porDefecto, { min = 0 } = {}) {
  const raw = process.env[nombre];
  if (raw === undefined || raw === null || String(raw).trim() === '') return porDefecto;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : porDefecto;
}

function listaDesdeEnv(nombre, porDefecto) {
  const raw = process.env[nombre];
  if (raw === undefined) return porDefecto;
  // Cadena vacía = lista vacía explícita (desactiva la exclusión).
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const ACCESORIOS_POR_DEFECTO = ['CADENA PARA', 'LIMA PARA', 'RECAMBIO', 'REPUESTO', 'FUNDA PARA', 'ADAPTADOR PARA'];

function configCandidatos() {
  return {
    stockMinimo: numeroDesdeEnv('OPORTUNIDADES_STOCK_MINIMO', 10),
    margenMinimoPct: numeroDesdeEnv('OPORTUNIDADES_MARGEN_MINIMO_PCT', 20),
    maxPorCategoria: numeroDesdeEnv('OPORTUNIDADES_MAX_POR_CATEGORIA', 4, { min: 1 }),
    maxCandidatos: numeroDesdeEnv('OPORTUNIDADES_MAX_CANDIDATOS', 60, { min: 1 }),
    excluirTextos: listaDesdeEnv('OPORTUNIDADES_EXCLUIR_TEXTOS', ACCESORIOS_POR_DEFECTO),
    soloMarcasPrioritarias: String(process.env.OPORTUNIDADES_SOLO_MARCAS_PRIORITARIAS || '').toLowerCase() === 'true'
  };
}

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Primer motivo por el que una referencia NO puede ser candidata, o null
// si cumple todos los criterios individuales. Orden fijo = motivo estable.
function motivoDescarteIndividual(row, cfg) {
  const stock = row.stock_aft != null ? Number(row.stock_aft) : (row.stock != null ? Number(row.stock) : 0);
  if (!(stock >= cfg.stockMinimo)) {
    return `stock AFT ${stock} uds. < mínimo ${cfg.stockMinimo}`;
  }

  const margen = row.margen_pct != null ? Number(row.margen_pct) : (row.margenPct != null ? Number(row.margenPct) : null);
  if (margen == null) return 'margen proyectado no disponible';
  if (margen < cfg.margenMinimoPct) {
    return `margen ${margen}% < mínimo ${cfg.margenMinimoPct}%`;
  }

  if (!row.categoria_nombre || !String(row.categoria_nombre).trim()) {
    return 'sin categoría (no se puede aplicar el tope por categoría)';
  }

  const desc = normalizar(row.descripcion);
  const texto = cfg.excluirTextos.find((t) => desc.includes(normalizar(t)));
  if (texto) return `descripción contiene «${texto}» (recambio/accesorio)`;

  if (cfg.soloMarcasPrioritarias && !row.es_marca_prioritaria) {
    return 'marca no prioritaria (modo solo marcas prioritarias activo)';
  }
  return null;
}

// Marca cada fila con { es_candidato, motivo_descarte, ranking_categoria }.
// No muta las filas de entrada; devuelve copias nuevas en el MISMO orden.
function seleccionarCandidatos(filas, cfg = configCandidatos()) {
  const resultado = filas.map((f) => ({ ...f, es_candidato: false, motivo_descarte: null, ranking_categoria: null }));

  const aptas = [];
  resultado.forEach((fila, idx) => {
    const motivo = motivoDescarteIndividual(fila, cfg);
    if (motivo) fila.motivo_descarte = motivo;
    else aptas.push(idx);
  });

  const porCategoria = new Map();
  for (const idx of aptas) {
    const cat = normalizar(resultado[idx].categoria_nombre);
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(idx);
  }

  const preseleccion = [];
  for (const [, indices] of porCategoria) {
    indices.sort((a, b) => {
      const A = resultado[a];
      const B = resultado[b];
      const pa = A.es_marca_prioritaria ? 1 : 0;
      const pb = B.es_marca_prioritaria ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ma = Number(A.margen_pct ?? A.margenPct ?? 0);
      const mb = Number(B.margen_pct ?? B.margenPct ?? 0);
      if (ma !== mb) return mb - ma;
      return String(A.ref).localeCompare(String(B.ref)); // desempate estable
    });
    indices.forEach((idx, pos) => {
      resultado[idx].ranking_categoria = pos + 1;
      if (pos < cfg.maxPorCategoria) preseleccion.push(idx);
      else resultado[idx].motivo_descarte = `fuera del top ${cfg.maxPorCategoria} de su categoría (puesto ${pos + 1})`;
    });
  }

  // Tope global: se queda con los mejores por prioridad y margen.
  preseleccion.sort((a, b) => {
    const A = resultado[a];
    const B = resultado[b];
    const pa = A.es_marca_prioritaria ? 1 : 0;
    const pb = B.es_marca_prioritaria ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ma = Number(A.margen_pct ?? A.margenPct ?? 0);
    const mb = Number(B.margen_pct ?? B.margenPct ?? 0);
    if (ma !== mb) return mb - ma;
    return String(A.ref).localeCompare(String(B.ref));
  });
  preseleccion.forEach((idx, pos) => {
    if (pos < cfg.maxCandidatos) resultado[idx].es_candidato = true;
    else resultado[idx].motivo_descarte = `fuera del tope global de ${cfg.maxCandidatos} candidatos`;
  });

  return resultado;
}

module.exports = {
  configCandidatos, seleccionarCandidatos, motivoDescarteIndividual, ACCESORIOS_POR_DEFECTO
};
