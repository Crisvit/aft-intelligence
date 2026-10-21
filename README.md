# AFT Intelligence (AFT 2.0)

Dashboard independiente de Herramitienda: importa catálogo/stock/categorías
de AFT, lee el catálogo completo de Shopify (solo lectura, paginado) y lo
compara por EAN con alternativa por SKU, calcula coste real y rentabilidad,
y muestra el resultado en un panel. No escribe en Shopify — ese código no
existe en este repositorio.

## Qué es nuevo y qué se reutilizó

- **Reutilizado tal cual**: `src/buildDashboardHtml.js`, el motor de render
  del panel (HTML/CSS/JS), ya verificado en producción con datos reales de
  Herramitienda.
- **Reutilizada la lógica de negocio**, portada desde el workflow de n8n
  `AFT → Shopify: Sync diaria de stock y precio` (ya auditado): cálculo de
  coste real (IVA + recargo de equivalencia + portes), detección de
  variantes duplicadas/ubicaciones múltiples, cálculo de margen sin
  sobrescribir nunca el PVP.
- **Nuevo**: base de datos propia (`hmt-db`), independiente de n8n; lectura
  paginada de todo el catálogo Shopify (no solo búsquedas puntuales);
  importación AFT por lotes con deduplicación e incidencias; fallback de
  emparejamiento por SKU cuando el EAN no encuentra nada (o no existe) y el
  resultado es inequívoco; incidencia explícita de stock negativo.
- **Control de inventario vs. oportunidades comerciales, separados a
  propósito**: el control de stock/precio (`runInventorySync`) cruza
  **todas** las referencias AFT contra Shopify, sin filtro de marca ni
  categoría — así no se deja de vigilar nada que ya esté vivo en la tienda.
  La detección de **oportunidades nuevas** (productos AFT no presentes en
  Shopify) sí sigue filtrada por las marcas y categorías comerciales de
  Herramitienda (`getCandidatosConCoste`). Ambas comparten el mismo cálculo
  de coste, pero una no condiciona a la otra.

## Arquitectura

```
AFT API (solo lectura) ──┐
                          ├─> sync.js ──> hmt-db (Postgres) ──> server.js ──> dashboard
Shopify Admin API (solo lectura, paginada) ─┘
```

- Backend: Node.js + Express.
- Base de datos: PostgreSQL independiente (`hmt-db`), esquema en `sql/schema.sql`.
- Sin ninguna llamada de escritura a Shopify en todo el código (`src/shopifyClient.js`
  solo expone funciones de lectura: paginación completa de variantes,
  búsqueda puntual por EAN/SKU y listado de productos).
- La importación AFT (`ingestAft`) y la comparación con Shopify
  (`runInventorySync`) corren en segundo plano (HTTP 202 + lock en BD) con
  progreso real consultable por polling — pensado para catálogos de miles
  de referencias sin depender de una única petición HTTP larga.

## Coste registrado en Shopify — pendiente de validar

`shopify_match.shopify_cost` es el coste tal cual está en la ficha de
Shopify (`inventoryItem.unitCost`), un número sin ninguna semántica de IVA
en la API de Shopify. El coste de AFT se guarda por separado y explícito en
dos columnas (`coste_aft_sin_iva`, `coste_aft_con_impuestos`) precisamente
para **no asumir** si el coste de Shopify incluye o no impuestos — el código
no calcula ninguna "diferencia de coste" automática entre ambos hasta que
se confirme esa convención con un par de productos reales comprobados a
mano en el admin de Shopify.

## Qué no está conectado todavía

- `draftRows` / `demandSignalsRows` / `scoresV3Rows` (fichas nuevas
  generadas automáticamente, señales de demanda, scoring v3) son parte del
  renderer original (`buildDashboardHtml.js`) pero vienen de otros agentes
  n8n (no de este repositorio) — no se han conectado a ninguna fuente real
  aquí porque haría falta decidir qué base de datos/tabla leer y confirmar
  que sea solo lectura. El panel los muestra vacíos hasta entonces.

## Variables de entorno

Ver `.env.example`. Se configuran en Easypanel, nunca en el repositorio.
Las credenciales reales de AFT y Shopify se pasan como el cuerpo exacto
(JSON) del POST de token — así este código nunca necesita conocer los
nombres de campo exactos que exige cada API.

## Puesta en marcha

```bash
npm install
npm run migrate     # aplica sql/schema.sql contra hmt-db (idempotente)
npm run sync        # ejecuta una comparación real AFT <-> Shopify, solo lectura
npm start            # levanta el dashboard en $PORT
```

El `Dockerfile` ejecuta `migrate` automáticamente antes de arrancar el
servidor en cada despliegue.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /` | Dashboard (requiere Basic Auth), ya conectado a datos reales (oportunidades, diferencias, histórico) |
| `GET /status` | Estado de conexión a hmt-db y Shopify, sin exponer secretos |
| `GET /api/diff` | Informe JSON de diferencias de inventario (cambiarían, a cero, incidencias, no encontrados) |
| `POST /api/aft-import` | Lanza la importación AFT en segundo plano (202 inmediato) |
| `GET /api/aft-import/estado` | Progreso/resultado de la última importación AFT |
| `POST /api/sync-run` | Lanza en segundo plano (202 inmediato) una comparación real AFT↔Shopify de solo lectura, sobre **todas** las referencias AFT |
| `GET /api/sync-run/estado` | Progreso/resultado de la última comparación (páginas Shopify leídas, fase, permisos incompletos) |
| `GET /healthz` | Health check sin autenticación |

## Garantías de seguridad

- Ningún token ni contraseña se escribe en este repositorio.
- `src/shopifyClient.js` no contiene ninguna mutación GraphQL.
- El panel exige Basic Auth (usuario + hash bcrypt de contraseña).
