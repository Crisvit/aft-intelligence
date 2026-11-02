// Comprobación de credenciales del panel — reutiliza exactamente el mismo
// usuario único + hash bcrypt que ya existía con Basic Auth
// (DASHBOARD_USER/DASHBOARD_PASSWORD_HASH), sin introducir un sistema de
// usuarios nuevo. Lo único que cambia es el transporte: en vez de mandar
// la contraseña en cada petición (Basic Auth), se verifica una vez y el
// resultado se guarda en una sesión de servidor (ver server.js).
const bcrypt = require('bcryptjs');

function credencialesValidas(usuario, password, { dashboardUser, dashboardPasswordHash }) {
  if (!dashboardUser || !dashboardPasswordHash) return false;
  if (typeof usuario !== 'string' || usuario !== dashboardUser) return false;
  return bcrypt.compareSync(String(password || ''), dashboardPasswordHash);
}

// Única página HTML protegida por sesión (el propio dashboard). El resto
// de rutas protegidas son JSON (API del panel, llamadas por fetch() desde
// su propio JavaScript, o /status para monitorización externa) — ahí un
// redirect a /login rompería la llamada sin que nadie lo viera; es mejor
// un 401 JSON explícito.
const RUTAS_PAGINA_HTML = new Set(['/']);
function esRutaPaginaHtml(path) {
  return RUTAS_PAGINA_HTML.has(path);
}

module.exports = { credencialesValidas, esRutaPaginaHtml };
