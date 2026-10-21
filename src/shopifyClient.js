// Cliente de SOLO LECTURA contra Shopify Admin API. Este archivo no contiene
// ninguna mutación GraphQL — a propósito, para que "no hay camino de
// escritura" sea cierto por construcción del código, no solo por un flag.

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || 'kb9i0z-da.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const SHOPIFY_TOKEN_URL = process.env.SHOPIFY_TOKEN_URL || `https://${SHOPIFY_SHOP}/admin/oauth/access_token`;

async function getShopifyToken() {
  const bodyJson = process.env.SHOPIFY_TOKEN_BODY_JSON;
  if (!bodyJson) {
    throw new Error('Falta SHOPIFY_TOKEN_BODY_JSON en el entorno (cuerpo del POST de token de Shopify).');
  }
  let bodyFields;
  try {
    bodyFields = JSON.parse(bodyJson);
  } catch (e) {
    throw new Error('SHOPIFY_TOKEN_BODY_JSON no es JSON válido.');
  }
  const resp = await fetch(SHOPIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyFields).toString()
  });
  if (!resp.ok) {
    throw new Error(`Shopify token request failed (${resp.status})`);
  }
  const json = await resp.json();
  if (!json.access_token) {
    throw new Error('Respuesta de Shopify sin access_token — revisa SHOPIFY_TOKEN_BODY_JSON');
  }
  return json.access_token;
}

async function shopifyGraphql(token, query, variables) {
  const resp = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });
  if (!resp.ok) {
    throw new Error(`Shopify GraphQL failed (${resp.status})`);
  }
  const json = await resp.json();
  if (json.errors) {
    throw new Error('Shopify GraphQL errors: ' + JSON.stringify(json.errors));
  }
  return json;
}

const VARIANT_QUERY = `query($q: String!) {
  productVariants(first: 10, query: $q) {
    edges {
      node {
        id
        barcode
        price
        sku
        product { title }
        inventoryItem {
          id
          unitCost { amount }
          inventoryLevels(first: 5) {
            edges {
              node {
                location { id name }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }
}`;

// Busca variante por código de barras (EAN). Solo lectura.
async function findVariantByBarcode(token, ean) {
  return shopifyGraphql(token, VARIANT_QUERY, { q: `barcode:${ean}` });
}

// Fallback por SKU — solo se usa cuando el EAN no encuentra nada.
async function findVariantBySku(token, sku) {
  return shopifyGraphql(token, VARIANT_QUERY, { q: `sku:${sku}` });
}

const DEFAULT_VARIANTS_PAGE_SIZE = Number(process.env.SHOPIFY_VARIANTS_PAGE_SIZE) || 25;
const MAX_REINTENTOS_THROTTLE = 5;

// No pide location.name a propósito: la app no tiene (todavía) el scope
// read_locations, y location.id ya es lo único que necesita el matching
// (comparar contra MAIN_LOCATION_ID). Pedir un campo sin permiso puede
// anular en cascada el nodo padre en la respuesta de Shopify; no pedirlo
// evita ese riesgo en vez de solo tolerarlo.
const ALL_VARIANTS_QUERY = `query($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        barcode
        sku
        price
        product { id title status vendor featuredMedia { preview { image { url } } } }
        inventoryItem {
          id
          unitCost { amount }
          inventoryLevels(first: 5) {
            edges {
              node {
                location { id }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage }
  }
}`;

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Igual que una llamada GraphQL normal, salvo que separa los errores de
// permisos (falta un scope) del resto: esos se devuelven para que quien
// llama decida qué hacer (informar, omitir ese dato) en vez de lanzar y
// abortar toda la lectura por un campo al que no se tiene acceso. Cualquier
// otro tipo de error sigue lanzando, igual que shopifyGraphql().
async function shopifyGraphqlTolerante(token, query, variables) {
  const resp = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get('Retry-After')) || 2;
    return { throttled: true, retryAfterMs: retryAfter * 1000 };
  }
  if (!resp.ok) {
    throw new Error(`Shopify GraphQL failed (${resp.status})`);
  }
  const json = await resp.json();
  const todosErrores = json.errors || [];
  const erroresPermiso = todosErrores.filter(
    (e) => (e.extensions && (e.extensions.code === 'ACCESS_DENIED' || e.extensions.code === 'FORBIDDEN')) || /access denied/i.test(e.message || '')
  );
  const erroresOtros = todosErrores.filter((e) => !erroresPermiso.includes(e));
  if (erroresOtros.length) {
    throw new Error('Shopify GraphQL errors: ' + JSON.stringify(erroresOtros));
  }
  return { throttled: false, data: json.data, cost: json.extensions && json.extensions.cost, erroresPermiso };
}

// Lee TODO el catálogo de variantes paginando productVariants (sin filtro de
// búsqueda), respetando el bucket de coste de Shopify (throttleStatus) y
// reintentando ante un 429 real en vez de abortar. `onPage(edges, info)` se
// llama tras cada página leída con éxito para poder ir guardando progreso
// real (página, variantes acumuladas, permisos que faltan) sin esperar a
// que termine toda la lectura. Solo lectura — no existe ninguna mutación.
async function getAllVariants(token, { pageSize = DEFAULT_VARIANTS_PAGE_SIZE, onPage } = {}) {
  let after = null;
  let pagina = 0;
  let totalVariantes = 0;
  const permisosFaltantes = new Set();
  let hasNextPage = true;

  while (hasNextPage) {
    let intento = 0;
    let resultado;
    for (;;) {
      resultado = await shopifyGraphqlTolerante(token, ALL_VARIANTS_QUERY, { first: pageSize, after });
      if (!resultado.throttled) break;
      intento++;
      if (intento > MAX_REINTENTOS_THROTTLE) {
        throw new Error('Shopify: demasiados 429 seguidos leyendo variantes, abortando la lectura.');
      }
      await dormir(resultado.retryAfterMs * intento);
    }

    for (const err of resultado.erroresPermiso) {
      permisosFaltantes.add(JSON.stringify({ mensaje: err.message, ruta: err.path }));
    }

    const conexion = resultado.data.productVariants;
    pagina++;
    totalVariantes += conexion.edges.length;
    hasNextPage = conexion.pageInfo.hasNextPage;
    if (conexion.edges.length) after = conexion.edges[conexion.edges.length - 1].cursor;

    if (onPage) {
      await onPage(conexion.edges, { pagina, totalVariantes, hasNextPage, cost: resultado.cost, permisosFaltantes: [...permisosFaltantes] });
    }

    // Respeta el bucket de coste: si queda poco margen, espera a que se
    // restaure antes de pedir la siguiente página en vez de arriesgarse a un 429.
    const throttle = resultado.cost && resultado.cost.throttleStatus;
    if (throttle && hasNextPage) {
      const margenSeguridad = (resultado.cost.requestedQueryCost || 0) * 2;
      if (throttle.currentlyAvailable < margenSeguridad) {
        const faltante = margenSeguridad - throttle.currentlyAvailable;
        const esperaMs = Math.ceil((faltante / throttle.restoreRate) * 1000);
        await dormir(Math.max(esperaMs, 250));
      }
    }
  }

  return { paginas: pagina, totalVariantes, permisosFaltantes: [...permisosFaltantes] };
}

// Listado ligero de productos (para la vista "Productos" del dashboard).
async function listProducts(token, queryFilter) {
  const query = `query($q: String) {
    products(first: 100, query: $q) {
      edges {
        node {
          id title vendor status
          featuredMedia { preview { image { url } } }
          variants(first: 1) { edges { node { price inventoryQuantity sku } } }
        }
      }
    }
  }`;
  return shopifyGraphql(token, query, { q: queryFilter || null });
}

module.exports = { getShopifyToken, findVariantByBarcode, findVariantBySku, listProducts, getAllVariants };
