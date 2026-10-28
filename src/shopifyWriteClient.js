// ÚNICO archivo de todo el repositorio con capacidad real de ESCRITURA
// hacia Shopify — separado a propósito de shopifyClient.js (que sigue
// siendo 100% lectura) para que el único camino de escritura de todo el
// código sea fácil de auditar en un solo archivo pequeño.
//
// Las mutaciones (establecerStockDisponible) las usa exclusivamente
// src/reposicion.js (Agente 2 — reposición automática de stock). La
// consulta de solo lectura listarScopesConcedidos/tieneScopeEscrituraInventario
// también la llama server.js directamente, para el diagnóstico de scopes
// (GET /api/shopify-scopes) — nunca escribe nada, así que exponerla fuera
// de reposicion.js no abre ningún camino de escritura nuevo. Solo escribe
// de verdad si, en src/reposicion.js:
//   1. SHOPIFY_WRITE_ENABLED=true está definido explícitamente, Y
//   2. tieneScopeEscrituraInventario() confirma que la app tiene
//      concedido el scope write_inventory (se comprueba en cada
//      ejecución, nunca se asume ni se cachea).
// Mientras cualquiera de las dos condiciones no se cumpla, este archivo
// no se invoca — el Agente 2 solo SIMULA la escritura (dry run).
//
// Solo toca el inventario "available" (lo vendible), nunca on_hand,
// committed, reserved ni damaged — así no se puede pisar una reserva ya
// hecha ni provocar una sobreventa por tocar el bucket equivocado.
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || 'kb9i0z-da.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

async function shopifyGraphqlEscritura(token, query, variables) {
  const resp = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (!resp.ok) {
    throw new Error(`Shopify GraphQL (escritura) failed (${resp.status})`);
  }
  const json = await resp.json();
  if (json.errors) {
    throw new Error('Shopify GraphQL errors: ' + JSON.stringify(json.errors));
  }
  return json.data;
}

// Lista completa de scopes REALMENTE concedidos a la app — consulta de
// solo lectura (currentAppInstallation.accessScopes no es una mutación),
// pensada para poder comprobar el permiso write_inventory en cualquier
// momento sin necesidad de SHOPIFY_WRITE_ENABLED=true ni de lanzar ningún
// agente de escritura.
async function listarScopesConcedidos(token) {
  const query = `{ currentAppInstallation { accessScopes { handle } } }`;
  const data = await shopifyGraphqlEscritura(token, query);
  const scopes = (data.currentAppInstallation && data.currentAppInstallation.accessScopes) || [];
  return scopes.map((s) => s.handle);
}

// Comprueba los scopes REALMENTE concedidos a la app — nunca se asume que
// write_inventory está disponible solo porque SHOPIFY_WRITE_ENABLED=true.
// Si la app todavía no tiene ese permiso, el agente se queda en dry run
// aunque la variable de entorno esté activa.
async function tieneScopeEscrituraInventario(token) {
  const scopes = await listarScopesConcedidos(token);
  return scopes.includes('write_inventory');
}

const SET_QUANTITIES_MUTATION = `
  mutation ajustarInventarioDisponible($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup { createdAt reason changes { name delta quantityAfterChange } }
      userErrors { field message code }
    }
  }
`;

function generarClaveIdempotencia() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return require('crypto').randomUUID();
}

// Establece la cantidad "available" de una referencia en una ubicación
// concreta a un valor ABSOLUTO (name: "available") — nunca suma ni resta
// sobre lo que haya, sustituye el valor. Si se pasa cantidadEsperadaActual,
// Shopify solo aplica el cambio si el valor persistido coincide con ese
// (compare-and-set) — así, si el stock cambió entre la última lectura y
// este intento (p. ej. una venta de por medio), la escritura falla en vez
// de pisar un valor ya desactualizado.
async function establecerStockDisponible(token, { inventoryItemId, locationId, cantidad, cantidadEsperadaActual, motivo }) {
  const input = {
    name: 'available',
    reason: motivo || 'cycle_count_available',
    quantities: [{
      inventoryItemId,
      locationId,
      quantity: cantidad,
      ...(cantidadEsperadaActual != null ? { changeFromQuantity: cantidadEsperadaActual } : {})
    }]
  };
  const data = await shopifyGraphqlEscritura(token, SET_QUANTITIES_MUTATION, { input, idempotencyKey: generarClaveIdempotencia() });
  const payload = data.inventorySetQuantities;
  if (payload.userErrors && payload.userErrors.length) {
    throw new Error('inventorySetQuantities userErrors: ' + JSON.stringify(payload.userErrors));
  }
  return payload.inventoryAdjustmentGroup;
}

// Lectura posterior de verificación — deliberadamente una consulta aparte
// tras la escritura, nunca se confía solo en la respuesta de la mutación.
async function leerStockDisponible(token, { inventoryItemId, locationId }) {
  const query = `query($id: ID!, $locationId: ID!) {
    inventoryItem(id: $id) {
      inventoryLevel(locationId: $locationId) {
        quantities(names: ["available"]) { name quantity }
      }
    }
  }`;
  const data = await shopifyGraphqlEscritura(token, query, { id: inventoryItemId, locationId });
  const nivel = data.inventoryItem && data.inventoryItem.inventoryLevel;
  const q = nivel && nivel.quantities && nivel.quantities.find((x) => x.name === 'available');
  return q ? q.quantity : null;
}

module.exports = { tieneScopeEscrituraInventario, listarScopesConcedidos, establecerStockDisponible, leerStockDisponible };
