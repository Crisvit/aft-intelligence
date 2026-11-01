// Capa de presentación (Clean Architecture) — formateadores y componentes
// visuales puros y reutilizables, compartidos por src/buildDashboardHtml.js
// y por las vistas extraídas de src/views/*.js. Movidos tal cual desde
// src/buildDashboardHtml.js (fase 3, sin cambiar su comportamiento — ver
// test/buildDashboardHtml.characterization.test.js).
function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function eur(n) { return (n === undefined || n === null) ? '—' : Number(n).toFixed(2) + '€'; }
function pct(n) { return (n === undefined || n === null) ? '—' : Number(n).toFixed(1) + '%'; }
function num(n) { return (n === undefined || n === null) ? '—' : n; }
// \b\w solo reconoce límites de palabra ASCII, así que con una vocal con
// tilde (í, á, ó...) rompía el conteo de "inicio de palabra" y capitalizaba
// también la letra siguiente (p. ej. "Batería" -> "BateríA"). \p{L} con
// flag /u es Unicode-aware y evita ese error de presentación.
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s\-/.])(\p{L})/gu, (m, sep, letra) => sep + letra.toUpperCase()); }
function pl(n, singular, plural) { return n + ' ' + (n === 1 ? singular : plural); }

function tiempoRelativo(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  const ahora = new Date();
  const diffMin = Math.floor((ahora - fecha) / 60000);
  if (diffMin < 1) return 'Ahora mismo';
  if (diffMin < 60) return 'hace ' + diffMin + ' min';
  const esHoy = fecha.toDateString() === ahora.toDateString();
  const ayer = new Date(ahora); ayer.setDate(ayer.getDate() - 1);
  const esAyer = fecha.toDateString() === ayer.toDateString();
  const hora = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (esHoy) return hora;
  if (esAyer) return 'Ayer, ' + hora;
  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ', ' + hora;
}

const ICON = {
  home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  sparkles: '<path d="M12 3v4M12 17v4M5 12H3M8 8 5.5 5.5M8 16l-2.5 2.5M16 8l2.5-2.5M16 16l2.5 2.5M21 12h-2"/><circle cx="12" cy="12" r="2.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5M2 16l10 5 10-5"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8a2 2 0 0 1 2 2v2a8 8 0 0 1-8 8 8 8 0 0 1-8-8v-2a2 2 0 0 1 2-2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  alertTri: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  packageX: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8M8.5 5.5l7 4"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'
};
function icon(name, size, color) { return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>'; }

// AFT no tiene (todavía) una URL de producto pública confirmada — no se
// inventa una. Mientras no exista una URL real verificada, el único
// enlace a AFT que se ofrece es "Copiar referencia" para buscarla a mano
// en el ERP/portal de AFT.
function copiarReferenciaBtn(ref) {
  return '<button type="button" class="sec-link" style="background:none;border:none;cursor:pointer;padding:0;font:inherit;" onclick="copiarReferencia(this,\'' + esc(ref) + '\')" title="Copiar la referencia AFT al portapapeles">' +
    icon('copy', 11) + ' Copiar ref. AFT</button>';
}

module.exports = { esc, eur, pct, num, titleCase, pl, tiempoRelativo, ICON, icon, copiarReferenciaBtn };
