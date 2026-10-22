// Agente 6 — Fichas de producto con IA. Genera un borrador (título,
// descripción, atributos, metadatos SEO) por referencia, a partir de datos
// reales de AFT y de la puntuación ya calculada por el Agente 4
// (src/oportunidades.js) — nunca a partir de una suposición. Solo genera
// si hay un proveedor de IA real conectado (ANTHROPIC_API_KEY); sin él,
// el run termina con status 'no_conectado' y CERO borradores — nunca se
// guarda una plantilla y se presenta como si fuera un resultado de IA.
//
// Aprobar / Rechazar / Editar son SIEMPRE cambios de estado en PostgreSQL
// (ver server.js) — ningún camino de este archivo ni del resto del agente
// llama a Shopify. La publicación real queda, a propósito, fuera de este
// repositorio y requiere una acción humana independiente.
//
// Calidad y validación: cada borrador generado se valida contra reglas
// concretas (longitud de título/meta, presencia de la marca real, ausencia
// de marcadores de relleno) ANTES de guardarse. Un borrador que no pasa
// la validación se guarda igualmente (para que una persona lo revise) pero
// marcado calidad_validada=false con el motivo exacto — nunca se descarta
// en silencio ni se "arregla" solo.
const { pool } = require('./db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const ANTHROPIC_API_VERSION = '2023-06-01';
// Límite de fichas generadas por ejecución y de tokens por llamada —
// control de coste explícito (nunca un bucle sin límite sobre el catálogo).
const MAX_FICHAS_POR_EJECUCION = Number(process.env.FICHAS_MAX_POR_EJECUCION) || 10;
const MAX_TOKENS_RESPUESTA = Number(process.env.FICHAS_MAX_TOKENS) || 1024;

function hayProveedorIaConfigurado() {
  return !!ANTHROPIC_API_KEY;
}

function construirPrompt(row) {
  return `Eres un redactor de ficha de producto para una tienda de ferretería/herramientas en España (Herramitienda). Genera SOLO un objeto JSON válido (sin texto antes ni después, sin markdown) con estos campos exactos:
{
  "titulo": "título de producto para Shopify, 10-70 caracteres, debe incluir la marca",
  "descripcion": "descripción comercial en español, 80-500 caracteres, basada solo en los datos dados, sin inventar características no mencionadas",
  "atributos": {"marca": "...", "categoria": "..."},
  "meta_titulo": "título SEO, máximo 60 caracteres",
  "meta_descripcion": "meta descripción SEO en español, 50-160 caracteres",
  "keywords_seo": ["keyword1", "keyword2"]
}

Datos reales del producto (no inventes nada que no esté aquí):
- Referencia AFT: ${row.ref}
- Marca: ${row.marca || 'desconocida'}
- Categoría: ${row.categoria_nombre || 'desconocida'}
- Descripción corta de AFT: ${row.descripcion || 'sin descripción'}
- PVP recomendado: ${row.pvp_recomendado != null ? row.pvp_recomendado + '€' : 'sin dato'}`;
}

async function generarBorradorConIa(row) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_API_VERSION
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS_RESPUESTA,
      messages: [{ role: 'user', content: construirPrompt(row) }]
    })
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Anthropic API respondió HTTP ${resp.status}: ${texto.slice(0, 200)}`);
  }
  const json = await resp.json();
  const texto = (json.content && json.content[0] && json.content[0].text) || '';
  let datos;
  try {
    // Tolera que el modelo envuelva el JSON en markdown pese a la instrucción.
    const limpio = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    datos = JSON.parse(limpio);
  } catch (e) {
    throw new Error('La respuesta de la IA no es JSON válido: ' + e.message);
  }
  return datos;
}

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

async function guardarBorrador(runId, row, datos, calidad) {
  await pool.query(
    `INSERT INTO fichas_borradores (run_id, ref, marca, titulo, descripcion, atributos, meta_titulo, meta_descripcion, keywords_seo, modelo, calidad_validada, motivo_calidad, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente')`,
    [runId, row.ref, row.marca, datos.titulo || null, datos.descripcion || null,
     datos.atributos ? JSON.stringify(datos.atributos) : null,
     datos.meta_titulo || null, datos.meta_descripcion || null,
     datos.keywords_seo ? JSON.stringify(datos.keywords_seo) : null,
     ANTHROPIC_MODEL, calidad.ok, calidad.motivo]
  );
}

// ---------------------------------------------------------------------------
// Universo: mejores oportunidades (Agente 4) que todavía no tienen un
// borrador pendiente o aprobado — evita regenerar fichas ya en revisión o
// ya aceptadas. Acotado a MAX_FICHAS_POR_EJECUCION (control de coste).
// ---------------------------------------------------------------------------
async function ejecutarGeneracionFichas(existingRunId) {
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE fichas_runs SET fase = 'iniciando', modelo = $2 WHERE id = $1`, [runId, ANTHROPIC_MODEL]);
  } else {
    const { rows } = await pool.query(`INSERT INTO fichas_runs (status, fase, modelo) VALUES ('running', 'iniciando', $1) RETURNING id`, [ANTHROPIC_MODEL]);
    runId = rows[0].id;
  }

  try {
    const { rows: candidatos } = await pool.query(
      `SELECT o.ref, o.marca, o.categoria_nombre, o.descripcion, o.pvp_recomendado
       FROM oportunidades_resultados o
       WHERE NOT EXISTS (
         SELECT 1 FROM fichas_borradores f WHERE f.ref = o.ref AND f.estado IN ('pendiente', 'aprobado')
       )
       ORDER BY o.score DESC NULLS LAST
       LIMIT $1`,
      [MAX_FICHAS_POR_EJECUCION]
    );

    await pool.query(`UPDATE fichas_runs SET fase = 'generando', total_candidatos = $2 WHERE id = $1`, [runId, candidatos.length]);

    if (!hayProveedorIaConfigurado()) {
      await pool.query(
        `UPDATE fichas_runs SET status = 'no_conectado', finished_at = now(), fase = 'done',
           total_candidatos = $2, generados = 0, con_avisos_calidad = 0,
           error_message = 'ANTHROPIC_API_KEY no configurada — no se genera ningún borrador (nunca se simula un resultado de IA).'
         WHERE id = $1`,
        [runId, candidatos.length]
      );
      return { runId, totalCandidatos: candidatos.length, generados: 0, conAvisosCalidad: 0, conectado: false };
    }

    let generados = 0, conAvisos = 0, errores = 0;
    for (const row of candidatos) {
      try {
        const datos = await generarBorradorConIa(row);
        const calidad = validarCalidad(row, datos);
        if (!calidad.ok) conAvisos++;
        await guardarBorrador(runId, row, datos, calidad);
        generados++;
      } catch (e) {
        errores++;
        console.error(`[fichasIa] Error generando ficha para ${row.ref}: ${e.message}`);
      }
    }

    await pool.query(
      `UPDATE fichas_runs SET status = 'success', finished_at = now(), fase = 'done',
         generados = $2, con_avisos_calidad = $3,
         error_message = $4
       WHERE id = $1`,
      [runId, generados, conAvisos, errores > 0 ? `${errores} referencia(s) fallaron al generar (ver logs del servicio).` : null]
    );

    return { runId, totalCandidatos: candidatos.length, generados, conAvisosCalidad: conAvisos, errores, conectado: true };
  } catch (e) {
    await pool.query(
      `UPDATE fichas_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

// Aprobar/Rechazar/Editar — solo cambian el estado en PostgreSQL. Ninguna
// de estas funciones llama a Shopify ni a ninguna API externa.
async function revisarBorrador(id, accion, revisadoPor) {
  if (!['aprobado', 'rechazado'].includes(accion)) throw new Error('Acción de revisión no válida.');
  const { rows } = await pool.query(
    `UPDATE fichas_borradores SET estado = $2, revisado_por = $3, revisado_en = now() WHERE id = $1 RETURNING *`,
    [id, accion, revisadoPor || null]
  );
  if (!rows.length) throw new Error('Borrador no encontrado.');
  return rows[0];
}

async function editarBorrador(id, cambios, revisadoPor) {
  const campos = ['titulo', 'descripcion', 'meta_titulo', 'meta_descripcion'];
  const sets = [];
  const valores = [id];
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(cambios, campo)) {
      valores.push(cambios[campo]);
      sets.push(`${campo} = $${valores.length}`);
    }
  }
  if (!sets.length) throw new Error('Nada que editar.');
  valores.push(revisadoPor || null);
  const { rows } = await pool.query(
    `UPDATE fichas_borradores SET ${sets.join(', ')}, editado = true, revisado_por = $${valores.length}, revisado_en = now() WHERE id = $1 RETURNING *`,
    valores
  );
  if (!rows.length) throw new Error('Borrador no encontrado.');
  return rows[0];
}

module.exports = {
  ejecutarGeneracionFichas, hayProveedorIaConfigurado, validarCalidad,
  revisarBorrador, editarBorrador, ANTHROPIC_MODEL
};
