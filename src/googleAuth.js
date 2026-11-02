// Autenticación de cuenta de servicio de Google (Service Account, RFC 7523 —
// JWT firmado intercambiado por un access_token) para Search Console y GA4
// Data API. Mismo criterio que src/demanda.js: fetch plano, sin SDK pesada
// ni dependencia nueva — solo el módulo crypto de Node para firmar el JWT.
//
// GOOGLE_SERVICE_ACCOUNT_JSON contiene el JSON completo de la clave de
// cuenta de servicio descargada en Google Cloud Console (client_email +
// private_key), pegado tal cual como variable de entorno en Easypanel.
// Nunca se piden estas credenciales por chat.

const crypto = require('crypto');

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Función pura (no cachea ni valida contra red) — solo decide si el valor
// del entorno tiene forma de credencial de cuenta de servicio utilizable.
function leerCredenciales(jsonCrudo = GOOGLE_SERVICE_ACCOUNT_JSON) {
  if (!jsonCrudo) return null;
  let json;
  try {
    json = JSON.parse(jsonCrudo);
  } catch (e) {
    return null;
  }
  if (!json || !json.client_email || !json.private_key) return null;
  return json;
}

function hayCredencialesConfiguradas() {
  return leerCredenciales() !== null;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Construye y firma el JWT de autorización de cuenta de servicio. Función
// pura salvo por la hora actual, inyectable para pruebas (`ahora`). `exp`
// a 1 hora es el máximo que Google acepta para este flujo.
function construirJwtFirmado(credenciales, scopes, ahora = new Date()) {
  const iat = Math.floor(ahora.getTime() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: credenciales.client_email, scope: scopes.join(' '), aud: TOKEN_URL, iat, exp };
  const parteFirmada = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  const firma = crypto.createSign('RSA-SHA256').update(parteFirmada).sign(credenciales.private_key);
  return { jwt: parteFirmada + '.' + base64url(firma), header, payload };
}

// Intercambia el JWT firmado por un access_token real (válido ~1h). Lanza
// si falta la credencial o si Google rechaza la petición — quien llama
// decide cómo degradar (nunca se inventa un token ni se sigue como si la
// consulta estuviera autenticada).
async function obtenerAccessToken(scopes) {
  const credenciales = leerCredenciales();
  if (!credenciales) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no configurado o no es un JSON de cuenta de servicio válido.');
  }
  const { jwt } = construirJwtFirmado(credenciales, scopes);
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    throw new Error(`Google OAuth respondió HTTP ${resp.status}: ${json.error_description || json.error || 'sin detalle'}`);
  }
  return json.access_token;
}

module.exports = { hayCredencialesConfiguradas, obtenerAccessToken, construirJwtFirmado, leerCredenciales, base64url, TOKEN_URL };
