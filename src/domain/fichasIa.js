// Capa de dominio (Clean Architecture) — regla de negocio pura, sin
// PostgreSQL, sin fetch, sin ningún require de infraestructura. Movida
// tal cual desde src/fichasIa.js (fase 1 de la refactorización, sin
// cambiar su comportamiento — ver test/fichasIa.test.js).

// Reglas de calidad explícitas — cada una trazable a un motivo legible.
// Nunca "corrige" el dato, solo informa de qué falló.
function validarCalidad(row, datos) {
  const motivos = [];
  const titulo = String(datos.titulo || '');
  const descripcion = String(datos.descripcion || '');
  const metaTitulo = String(datos.meta_titulo || '');
  const metaDescripcion = String(datos.meta_descripcion || '');
  const marca = String(row.marca || '').toLowerCase();

  if (titulo.length < 10 || titulo.length > 70) motivos.push(`título fuera de rango (${titulo.length} caracteres, esperado 10-70)`);
  if (marca && !titulo.toLowerCase().includes(marca) && !descripcion.toLowerCase().includes(marca)) motivos.push('la marca real no aparece ni en el título ni en la descripción');
  if (descripcion.length < 80 || descripcion.length > 500) motivos.push(`descripción fuera de rango (${descripcion.length} caracteres, esperado 80-500)`);
  if (metaTitulo.length > 60) motivos.push(`meta_titulo demasiado largo (${metaTitulo.length} caracteres, máx. 60)`);
  if (metaDescripcion.length < 50 || metaDescripcion.length > 160) motivos.push(`meta_descripcion fuera de rango (${metaDescripcion.length} caracteres, esperado 50-160)`);
  if (!Array.isArray(datos.keywords_seo) || datos.keywords_seo.length === 0) motivos.push('sin keywords_seo');
  if (!datos.atributos || typeof datos.atributos !== 'object') motivos.push('sin atributos');

  const marcadoresRelleno = /\[.*?\]|TODO|XXX|lorem ipsum/i;
  if (marcadoresRelleno.test(titulo) || marcadoresRelleno.test(descripcion)) motivos.push('contiene marcadores de relleno sin completar');

  return { ok: motivos.length === 0, motivo: motivos.join('; ') || null };
}

module.exports = { validarCalidad };
