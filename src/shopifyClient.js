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

module.exports = { getShopifyToken, findVariantByBarcode, findVariantBySku, listProducts };
