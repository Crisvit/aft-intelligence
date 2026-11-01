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
//   - 'ambigua': la categoría no coincide con ninguna lista configurada.
//     Nunca se trata como 'fuera_de_foco' por defecto.
//
// Listas configurables por entorno (mismo patrón que AFT_BRANDS en
// src/domain/costeMargen.js). AFINIDAD_ESTACIONAL y AFINIDAD_FUERA_DE_FOCO
// arrancan vacías a propósito — no hay ninguna categoría estacional ni
// "fuera de foco" confirmada por el negocio todavía; rellenarlas es una
// decisión comercial, no una suposición de este código.
function listaDesdeEnv(nombreEnv, porDefecto) {
  const valor = process.env[nombreEnv];
  if (!valor) return porDefecto;
  return valor.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// listas (opcional): para pruebas o para inyectar listas distintas de las
// de entorno sin tocar process.env. Si no se pasa, usa las de arriba.
function clasificarAfinidadComercial(categoria, listas) {
  const l = listas || {
    principal: AFINIDAD_PRINCIPAL,
    complementaria: AFINIDAD_COMPLEMENTARIA,
    estacional: AFINIDAD_ESTACIONAL,
    fueraDeFoco: AFINIDAD_FUERA_DE_FOCO
  };
  const categoriaTexto = String(categoria || '').trim();
  if (!categoriaTexto) {
    return { clase: 'ambigua', elegible: null, motivo: 'Sin categoría informada por AFT — requiere revisión humana.' };
  }
  const c = normalizar(categoriaTexto);

  const mPrincipal = buscarCoincidencia(c, l.principal);
  if (mPrincipal) return { clase: 'principal', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mPrincipal}" (afinidad principal).` };

  const mComplementaria = buscarCoincidencia(c, l.complementaria);
  if (mComplementaria) return { clase: 'complementaria', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mComplementaria}" (afinidad complementaria).` };

  const mEstacional = buscarCoincidencia(c, l.estacional);
  if (mEstacional) return { clase: 'estacional', elegible: true, motivo: `Categoría "${categoriaTexto}" coincide con "${mEstacional}" (afinidad estacional).` };

  const mFueraDeFoco = buscarCoincidencia(c, l.fueraDeFoco);
  if (mFueraDeFoco) return { clase: 'fuera_de_foco', elegible: false, motivo: `Categoría "${categoriaTexto}" coincide con "${mFueraDeFoco}" (fuera de foco comercial, configurado explícitamente).` };

  // No coincide con ninguna lista configurada: nunca se asume "fuera de
  // foco" ni "principal" — va a revisión humana, ni excluida ni recomendada.
  return { clase: 'ambigua', elegible: null, motivo: `Categoría "${categoriaTexto}" no coincide con ninguna lista de afinidad configurada — requiere revisión humana.` };
}

module.exports = { clasificarAfinidadComercial, AFINIDAD_PRINCIPAL, AFINIDAD_COMPLEMENTARIA, AFINIDAD_ESTACIONAL, AFINIDAD_FUERA_DE_FOCO };
