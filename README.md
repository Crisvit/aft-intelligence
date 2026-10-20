# AFT Intelligence (AFT 2.0)

Dashboard independiente de Herramitienda: importa catálogo/stock/categorías
de AFT, los compara contra Shopify (solo lectura) por EAN con alternativa por
SKU, calcula coste real y rentabilidad, y muestra el resultado en un panel.
No escribe en Shopify — ese código no existe en este repositorio.

## Qué es nuevo y qué se reutilizó

- **Reutilizado tal cual**: `src/buildDashboardHtml.js`, el motor de render
  del panel (HTML/CSS/JS), ya verificado en producción con datos reales de
  Herramitienda.
- **Reutilizada la lógica de negocio**, portada desde el workflow de n8n
  `AFT → Shopify: Sync diaria de stock y precio` (ya auditado): cálculo de
  coste real (IVA + recargo de equivalencia + portes), detección de
  variantes duplicadas/ubicaciones múltiples, cálculo de margen sin
  sobrescribir nunca el PVP.
- **Nuevo**: base de datos propia (`hmt-db`), independiente de n8n; fallback
  de emparejamiento por SKU cuando el EAN no encuentra nada y el resultado
  es inequívoco; incidencia explícita de stock negativo.

## Arquitectura

```
AFT API (solo lectura) ──┐
                          ├─> sync.js ──> hmt-db (Postgres) ──> server.js ──> dashboard
Shopify Admin API (solo lectura) ─┘
```

- Backend: Node.js + Express.
- Base de datos: PostgreSQL independiente (`hmt-db`), esquema en `sql/schema.sql`.
- Sin ninguna llamada de escritura a Shopify en todo el código (`src/shopifyClient.js`
  solo expone funciones de lectura: búsqueda de variantes y listado de productos).

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
| `GET /` | Dashboard (requiere Basic Auth) |
| `GET /status` | Estado de conexión a hmt-db y Shopify, sin exponer secretos |
| `GET /api/diff` | Informe JSON de diferencias de inventario (cambiarían, a cero, incidencias, no encontrados) |
| `POST /api/sync-run` | Lanza una comparación real de solo lectura y la guarda en hmt-db |
| `GET /healthz` | Health check sin autenticación |

## Garantías de seguridad

- Ningún token ni contraseña se escribe en este repositorio.
- `src/shopifyClient.js` no contiene ninguna mutación GraphQL.
- El panel exige Basic Auth (usuario + hash bcrypt de contraseña).
