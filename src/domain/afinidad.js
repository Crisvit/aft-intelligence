// Capa de dominio (Clean Architecture) — clasificación de afinidad
// comercial, pura y configurable. Nueva (fase 2), reemplaza en diseño —
// nunca en comportamiento activo por defecto — al "afinidad de categoría"
// de Score v3 (backup real de n8n): ahí, cualquier categoría que no
// coincidía con sus listas CORE/MEDIA/BAJA caía en silencio en 'baja', el
// mismo cajón que lo explícitamente marcado como baja afinidad. Aquí eso
// nunca pasa: lo que no coincide con ninguna lista configurada es
// 'ambigua' — ni se excluye, ni se recomienda, va a revisión humana.
//
// Cinco clases:
//   - 'principal', 'complementaria', 'estacional': elegibles para el
//     ranking comercial habitual.
//   - 'fuera_de_foco': excluida del ranking habitual (pero trazable en
//     hmt-db, nunca borrada) — SOLO si está explícitamente en esa lista.
//   - 'ambigua': la categoría no coincide con ninguna lista configurada
//     NI tiene una resolución humana persistida (ver "resolucion" más
//     abajo). Nunca se trata como 'fuera_de_foco' por defecto.
//
// Listas configurables por entorno (mismo patrón que AFT_BRANDS en
// src/domain/costeMargen.js). AFINIDAD_ESTACIONAL y AFINIDAD_FUERA_DE_FOCO
// arrancan vacías a propósito — no hay ninguna categoría estacional ni
// "fuera de foco" confirmada por el negocio todavía; rellenarlas es una
// decisión comercial, no una suposición de este código.
//
// Fase 3 — normalización simétrica: la categoría recibida de AFT Y cada
// entrada de lista (por defecto o de entorno) pasan por EXACTAMENTE la
// misma normalizarCategoria() antes de comparar. Antes de este cambio
// solo se normalizaba el texto de entrada, nunca las listas — una lista
// configurada con tildes ("JARDÍN") nunca coincidía con una categoría de
// AFT normalizada ("JARDIN"), cayendo siempre en 'ambigua' en silencio.
// normalizarCategoria() también recorta espacios y colapsa espacios
// internos repetidos, para que la misma categoría con espacios distintos
// (copiada/pegada, o tecleada a mano al resolver una incidencia) se trate
// siempre como la misma clave — esto es lo que usa también la resolución
// persistida de src/domain/afinidadResolucion.js.
function normalizarCategoria(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function listaDesdeEnv(nombreEnv, porDefecto) {
  const valor = process.env[nombreEnv];
  const lista = valor ? valor.split(',') : porDefecto;
  return lista.map((s) => normalizarCategoria(s)).filter(Boolean);
}

// Punto de partida: las listas CORE/MEDIA de Score v3 (confirmadas contra
// el backup real de n8n), reasignadas a 'principal'/'complementaria'. La
// antigua lista BAJA de Score v3 NO se reutiliza como 'fuera_de_foco' por
// defecto — ese era precisamente el cajón por defecto que se quiere evitar;
// 'fuera_de_foco' solo existe si el negocio la define explícitamente.
const AFINIDAD_PRINCIPAL = listaDesdeEnv('AFINIDAD_PRINCIPAL', [
  'HERRAMIENTA', 'ELECTROPORTATIL', 'AMOLADORA', 'TALADRO', 'SIERRA', 'MOTOSIERRA',
  'DESBROZADOR', 'HIDROLIMPIADORA', 'COMPRESOR', 'GENERADOR', 'SOLDADORA',
  'DISCO DE CORTE', 'DISCO ABRASIVO', 'LIJA', 'BROCA', 'PODA'
]);
const AFINIDAD_COMPLEMENTARIA = listaDesdeEnv('AFINIDAD_COMPLEMENTARIA', [
  'LLAVE', 'DESTORNILLADOR', 'NIVEL', 'MANGUERA', 'RIEGO', 'BOMBA DE AGUA',
  'MALLA DE SOMBREO', 'SOLDAR', 'PANTALLA', 'CUBREFILTRO'
]);
const AFINIDAD_ESTACIONAL = listaDesdeEnv('AFINIDAD_ESTACIONAL', []);
const AFINIDAD_FUERA_DE_FOCO = listaDesdeEnv('AFINIDAD_FUERA_DE_FOCO', []);

function buscarCoincidencia(categoriaNorm, lista) {
  return lista.find((k) => categoriaNorm.indexOf(k) !== -1) || null;
}

// elegiblePorClase: única fuente de verdad para si una clase es elegible
// para el ranking habitual (true), excluida explícitamente (false), o
// pendiente de revisión humana (null) — la usan tanto la clasificación
// automática como la resolución persistida, para que ambas rutas
// devuelvan exactamente la misma forma.
function elegiblePorClase(clase) {
  if (clase === 'principal' || clase === 'complementaria' || clase === 'estacional') return true;
  if (clase === 'fuera_de_foco') return false;
  return null; // 'ambigua'
}

// listas (opcional): para pruebas o para inyectar listas distintas de las
// de entorno sin tocar process.env. Si no se pasa, usa las de arriba.
//
// resolucion (opcional, fase 3): una decisión humana persistida para esta
// categoría exacta (ver src/domain/afinidadResolucion.js), con la forma
// { clase, motivo, resueltoPor, resueltoEn }. Cuando se pasa, SIEMPRE
// prevalece sobre la clasificación automática — una decisión humana nunca
// se sobrescribe por una coincidencia de lista, ni al revés: solo quien
// llama a esta función decide si hay una resolución vigente para esa
// categoría (esta función es pura, no consulta nada).
//
// categoriaOriginal se devuelve siempre tal cual llegó (sin normalizar,
// solo recortada) para poder mostrarla en el dashboard exactamente como
// la informa AFT, nunca su forma normalizada en mayúsculas sin tildes.
function clasificarAfinidadComercial(categoria, listas, resolucion) {
  const l = listas || {
    principal: AFINIDAD_PRINCIPAL,
    complementaria: AFINIDAD_COMPLEMENTARIA,
    estacional: AFINIDAD_ESTACIONAL,
    fueraDeFoco: AFINIDAD_FUERA_DE_FOCO
  };
  // Normaliza también las listas aquí, no solo en listaDesdeEnv: así una
  // lista inyectada directamente (tests, o cualquier otro llamador futuro)
  // queda igual de protegida frente a tildes/espacios que las que vienen
  // de entorno — nunca depende de que quien la construyó se acordara de
  // normalizarla primero.
  const listaPrincipal = (l.principal || []).map(normalizarCategoria);
  const listaComplementaria = (l.complementaria || []).map(normalizarCategoria);
  const listaEstacional = (l.estacional || []).map(normalizarCategoria);
  const listaFueraDeFoco = (l.fueraDeFoco || []).map(normalizarCategoria);
  const categoriaTexto = String(categoria || '').trim();
  const categoriaOriginal = categoriaTexto || null;

  if (resolucion && resolucion.clase) {
    return {
      clase: resolucion.clase,
      elegible: elegiblePorClase(resolucion.clase),
      motivo: `Categoría "${categoriaTexto || '(sin categoría)'}" resuelta manualmente como "${resolucion.clase}"` +
        (resolucion.resueltoPor ? ` por ${resolucion.resueltoPor}` : '') +
        (resolucion.resueltoEn ? ` el ${resolucion.resueltoEn}` : '') +
        (resolucion.motivo ? ` — ${resolucion.motivo}` : '') +
        ' (anula la clasificación automática mientras la resolución esté vigente).',
      categoriaOriginal,
      resuelta: true
    };
  }

  if (!categoriaTexto) {
    return { clase: 'ambigua', elegible: null, motivo: 'Sin categoría informada por AFT — requiere revisión humana.', categoriaOriginal, resuelta: false };
  }
  const c = normalizarCategoria(categoriaTexto);

  const mPrincipal = buscarCoincidencia(c, listaPrincipal);
  if (mPrincipal) return { clase: 'principal', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mPrincipal}" (afinidad principal).`, categoriaOriginal, resuelta: false };

  const mComplementaria = buscarCoincidencia(c, listaComplementaria);
  if (mComplementaria) return { clase: 'complementaria', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mComplementaria}" (afinidad complementaria).`, categoriaOriginal, resuelta: false };

  const mEstacional = buscarCoincidencia(c, listaEstacional);
  if (mEstacional) return { clase: 'estacional', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mEstacional}" (afinidad estacional).`, categoriaOriginal, resuelta: false };

  const mFueraDeFoco = buscarCoincidencia(c, listaFueraDeFoco);
  if (mFueraDeFoco) return { clase: 'fuera_de_foco', elegible: false, motivo: `Categoría "${categoriaTexto}" coincide con "${mFueraDeFoco}" (fuera de foco comercial, configurado explícitamente).`, categoriaOriginal, resuelta: false };

  // No coincide con ninguna lista configurada: nunca se asume "fuera de
  // foco" ni "principal" — va a revisión humana, ni excluida ni recomendada.
  return { clase: 'ambigua', elegible: null, motivo: `Categoría "${categoriaTexto}" no coincide con ninguna lista de afinidad configurada — requiere revisión humana.`, categoriaOriginal, resuelta: false };
}

module.exports = {
  clasificarAfinidadComercial, normalizarCategoria, elegiblePorClase,
  AFINIDAD_PRINCIPAL, AFINIDAD_COMPLEMENTARIA, AFINIDAD_ESTACIONAL, AFINIDAD_FUERA_DE_FOCO
};
