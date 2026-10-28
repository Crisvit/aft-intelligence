// Cliente de solo lectura contra la API de AFT (apids.aftgrupo.com).
// El cuerpo exacto del POST de token nunca se escribe aquí: se pasa entero,
// ya con las credenciales reales, como la variable de entorno
// AFT_TOKEN_BODY_JSON (nunca se imprime ni se registra en logs).

const AFT_API_BASE = process.env.AFT_API_BASE || 'https://apids.aftgrupo.com';
const AFT_TOKEN_URL = process.env.AFT_TOKEN_URL || `${AFT_API_BASE}/token`;

// Reintentos con backoff — solo para fallos TRANSITORIOS (error de red, o
// un 429/5xx de AFT), nunca para un 4xx que no sea 429 (credenciales
// inválidas, endpoint mal formado, etc. deben fallar rápido, reintentar
// no los arregla). AFT_RETRY_INTENTOS=1 desactiva los reintentos.
const AFT_RETRY_INTENTOS = Math.max(1, parseInt(process.env.AFT_RETRY_INTENTOS, 10) || 3);
const AFT_RETRY_ESPERA_MS = Math.max(0, parseInt(process.env.AFT_RETRY_ESPERA_MS, 10) || 1000);

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esReintentable(error) {
  // Error de red (fetch nunca llegó a tener respuesta) — siempre reintentable.
  if (!error || !error.aftHttpStatus) return true;
  // 429 (rate limit) o cualquier 5xx de AFT — transitorio, reintentable.
  return error.aftHttpStatus === 429 || error.aftHttpStatus >= 500;
}

// Ejecuta fetchFn (una función sin argumentos que hace el fetch y devuelve
// la Response) con reintento y backoff exponencial simple (esperaBaseMs,
// esperaBaseMs*2, esperaBaseMs*4, ...). contexto es solo para el mensaje
// de error final, no cambia el comportamiento.
async function fetchConReintentos(fetchFn, contexto) {
  let ultimoError;
  for (let intento = 1; intento <= AFT_RETRY_INTENTOS; intento++) {
    try {
      return await fetchFn();
    } catch (e) {
      ultimoError = e;
      if (intento >= AFT_RETRY_INTENTOS || !esReintentable(e)) break;
      console.error(`[aft] ${contexto}: intento ${intento}/${AFT_RETRY_INTENTOS} falló (${e.message}) — reintentando en ${AFT_RETRY_ESPERA_MS * intento}ms.`);
      await dormir(AFT_RETRY_ESPERA_MS * intento);
    }
  }
  throw ultimoError;
}

async function getAftToken() {
  const bodyJson = process.env.AFT_TOKEN_BODY_JSON;
  if (!bodyJson) {
    throw new Error('Falta AFT_TOKEN_BODY_JSON en el entorno (cuerpo del POST de token de AFT).');
  }
  let bodyFields;
  try {
    bodyFields = JSON.parse(bodyJson);
  } catch (e) {
    throw new Error('AFT_TOKEN_BODY_JSON no es JSON válido.');
  }
  return fetchConReintentos(async () => {
    const resp = await fetch(AFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyFields).toString()
    });
    if (!resp.ok) {
      const err = new Error(`AFT token request failed (${resp.status})`);
      err.aftHttpStatus = resp.status;
      throw err;
    }
    const json = await resp.json();
    if (!json.access_token) {
      // Respuesta 2xx pero sin access_token: no es un fallo transitorio de
      // red, sino de configuración (credenciales/cuerpo del POST) —
      // reintentar no lo arregla.
      const err = new Error('Respuesta de AFT sin access_token — revisa AFT_TOKEN_BODY_JSON');
      err.aftHttpStatus = resp.status;
      throw err;
    }
    return json.access_token;
  }, 'obtener token');
}

async function aftGet(token, path) {
  return fetchConReintentos(async () => {
    const resp = await fetch(`${AFT_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
      const err = new Error(`AFT GET ${path} failed (${resp.status})`);
      err.aftHttpStatus = resp.status;
      throw err;
    }
    return resp.json();
  }, `GET ${path}`);
}

async function getCategorias(token) {
  return aftGet(token, '/Catalogo/ListaCategorias');
}

async function getProductos(token) {
  return aftGet(token, '/Catalogo/ListaProductos');
}

async function getStockPrecios(token) {
  return aftGet(token, '/Catalogo/ListaStockPrecios');
}

module.exports = { getAftToken, getCategorias, getProductos, getStockPrecios };
