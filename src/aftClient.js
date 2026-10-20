// Cliente de solo lectura contra la API de AFT (apids.aftgrupo.com).
// El cuerpo exacto del POST de token nunca se escribe aquí: se pasa entero,
// ya con las credenciales reales, como la variable de entorno
// AFT_TOKEN_BODY_JSON (nunca se imprime ni se registra en logs).

const AFT_API_BASE = process.env.AFT_API_BASE || 'https://apids.aftgrupo.com';
const AFT_TOKEN_URL = process.env.AFT_TOKEN_URL || `${AFT_API_BASE}/token`;

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
  const resp = await fetch(AFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyFields).toString()
  });
  if (!resp.ok) {
    throw new Error(`AFT token request failed (${resp.status})`);
  }
  const json = await resp.json();
  if (!json.access_token) {
    throw new Error('Respuesta de AFT sin access_token — revisa AFT_TOKEN_BODY_JSON');
  }
  return json.access_token;
}

async function aftGet(token, path) {
  const resp = await fetch(`${AFT_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    throw new Error(`AFT GET ${path} failed (${resp.status})`);
  }
  return resp.json();
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
