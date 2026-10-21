# AFT Intelligence (AFT 2.0)

Dashboard independiente de Herramitienda: importa catálogo/stock/categorías
de AFT, lee el catálogo completo de Shopify (solo lectura, paginado) y lo
compara por EAN con alternativa por SKU, calcula coste real y rentabilidad,
y muestra el resultado en un panel. No escribe en Shopify — ese código no
existe en este repositorio.

**Estado**: en producción, con dos ejecuciones reales completadas (importación
AFT e inventario completo, comparación Shopify ↔ AFT). El panel muestra
exclusivamente datos reales de esas ejecuciones — nada se simula ni se
muestra como activo si no lo está (ver "Qué no está conectado todavía").

## Qué verás en el panel

- **Inicio**: indicadores reales (referencias AFT analizadas, variantes
  Shopify leídas, coincidencias, cambios de stock/precio propuestos,
  propuestas a stock cero, incidencias), alertas destacadas cuando hay algo
  que revisar, y un resumen de actividad e integraciones.
- **Coincidencias**: tabla con buscador y filtro por estado de las
  referencias que AFT y Shopify tienen en común — **solo coincidencias
  fiables** (emparejadas por EAN, o por SKU cuando es inequívoco). Muestra
  la marca real del catálogo AFT (nunca el vendor de Shopify), cómo se
  encontró cada coincidencia (EAN/SKU), stock en AFT, stock en Shopify,
  diferencia, coste AFT (sin IVA y con impuestos), coste registrado en
  Shopify y PVP de ambos. Las coincidencias ambiguas (EAN duplicado,
  múltiples ubicaciones) no aparecen aquí — se gestionan como incidencia.
- **Oportunidades**: referencias de tus marcas/categorías comerciales que
  AFT tiene en stock y la última sincronización no encontró en Shopify,
  priorizando Wolfpack/Samurai/Maurer/Papillon/Saturnia (configurable vía
  `AFT_BRANDS_PRIORITARIAS`).
- **Productos**: catálogo completo de Shopify (todas las variantes, solo
  lectura) con 4 filtros independientes — proveedor identificado, marca
  (vendor de Shopify), estado (activo/borrador/archivado) y disponibilidad.
  "Proveedor: AFT" solo aparece cuando hubo una coincidencia fiable por
  EAN/SKU con el catálogo AFT; el resto se marca "Sin identificar" — nunca
  se adivina a partir del vendor de Shopify (que puede traer valores que no
  son marcas, como textos de envío) ni por similitud de nombre.
- **Rentabilidad** (prioridad 1): coste desglosado por referencia (sin IVA,
  con IVA/recargo, transporte al cliente, portes del proveedor AFT
  mostrados aparte), margen real (PVP de Shopify) o proyectado (PVP de AFT
  para oportunidades), y alertas explicadas de pérdida, margen bajo y
  diferencia de coste con Shopify, con su historial.
- **Actividad**: historial de ejecuciones e incidencias registradas
  (incluye las alertas de rentabilidad).
- **Integraciones**: estado real de los tres agentes que sí funcionan
  (importación AFT, comparación Shopify ↔ AFT, rentabilidad) con botón para
  lanzarlos y ver su progreso en vivo, un cuarto botón para encadenarlos en
  un solo pipeline, y una lista aparte y claramente marcada como "No
  conectado" de las funciones del panel original (fichas automáticas por
  IA, señales de demanda, scoring con datos externos) que no forman parte
  de este repositorio.

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

## Agente de rentabilidad

`src/rentabilidad.js` reutiliza el cálculo de coste/IVA/recargo ya validado
en `sync.js` (`calcularCosteYMargen`, sin tocarlo) y añade:

- **Transporte: el portes real de AFT por referencia, no una tarifa fija.**
  Confirmado con datos reales (`aft_catalogo.portes`): escaleras, andamios y
  accesorios llevan importes distintos por referencia (7,50€–23€ en los
  ejemplos verificados), no un valor único. Cuando el portes de una
  referencia es válido, es "envío directo de AFT" y se usa tal cual. **Ya
  no se usa una tarifa fija de 13€ para categorías/pesos grandes** ni se
  trata el antiguo valor de 4,41€ como si fuera el coste real de AFT — ese
  valor queda solo como tarifa propia de respaldo (`config_transporte_cliente`,
  regla `default`), y únicamente para referencias **sin** portes válido.
- **portes se interpreta como importe monetario, validado**: vacío (normal,
  cae al respaldo propio), formato inválido o valor negativo (anómalo —
  genera alerta `datos_incompletos` y también cae al respaldo, nunca se
  inventa un número).
- **Transporte del proveedor vs. transporte al cliente, sin duplicar**:
  cuando AFT envía directo (portes válido) no se suma ninguna tarifa propia
  encima — nunca ambos a la vez.
- **Comisión de venta**, diferenciada como su propia línea del desglose —
  0€ por defecto (sin inventar un porcentaje) hasta configurar
  `RENTABILIDAD_COMISION_VENTA_PCT` con un dato real.
- **Coste final siempre marcado "(estimado)"**: el tratamiento fiscal de
  portes (si el importe ya incluye IVA) todavía no está confirmado.
- **Alertas explicadas**: pérdida (margen negativo), margen bajo (por
  debajo de `RENTABILIDAD_MARGEN_BAJO_PCT`, 15% por defecto), diferencia de
  coste con Shopify (por encima de `RENTABILIDAD_DIFERENCIA_COSTE_PCT`, 20%
  por defecto) y datos incompletos (coste/PVP de AFT faltante, o portes con
  formato/valor inválido) — cada una con el detalle legible de por qué
  saltó, guardada en `rentabilidad_alertas` (historial, no se borra entre
  ejecuciones). La pestaña Rentabilidad ordena por riesgo: pérdida primero,
  después datos incompletos, después margen bajo.

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

El panel distingue explícitamente, en la página Integraciones, entre lo que
funciona y lo que no — nunca se muestra una función pendiente como si
estuviera activa:

- **Operativos (reales)**: importación de catálogo/stock de AFT, comparación
  de inventario Shopify ↔ AFT (control de stock y detección de
  oportunidades), rentabilidad, y el pipeline que encadena los tres.
- **Pendientes de recuperar (no conectados)**: fichas nuevas generadas
  automáticamente por IA, señales de demanda/keywords, y un scoring de
  oportunidades que incorpore demanda de mercado externa (el ranking actual
  de Oportunidades ya es real — marca prioritaria + margen — pero sin esa
  demanda externa). Existían en el panel original pero dependen de otros
  agentes (n8n, fuera de este repositorio) — no se han conectado aquí porque
  haría falta decidir qué base de datos/tabla leer, en modo solo lectura, y
  con qué agente. El panel los señala como "No conectado" en vez de simular
  sus resultados.

## Variables de entorno

Ver `.env.example`. Se configuran en Easypanel, nunca en el repositorio.
Las credenciales reales de AFT y Shopify se pasan como el cuerpo exacto
(JSON) del POST de token — así este código nunca necesita conocer los
nombres de campo exactos que exige cada API.

## Automatización (prioridad 2)

El pipeline completo (`POST /api/pipeline-run`, o el botón "Ejecutar
pipeline completo" en Integraciones) encadena importación AFT →
sincronización Shopify (solo lectura) → rentabilidad, en ese orden, en
segundo plano. La programación automática está **desactivada por defecto**:
solo se activa si defines `PIPELINE_SCHEDULE_HOURS` explícitamente — sin
esa variable, desplegar este código no ejecuta nada por sí solo.

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
| `POST /api/rentabilidad-run` | Lanza el agente de rentabilidad en segundo plano (202 inmediato) — solo lee hmt-db, no llama a AFT ni a Shopify |
| `GET /api/rentabilidad-run/estado` | Progreso/resultado del último análisis de rentabilidad |
| `POST /api/pipeline-run` | Encadena importación AFT → sincronización Shopify → rentabilidad en segundo plano (202 inmediato) |
| `GET /api/pipeline-run/estado` | Progreso/resultado del último pipeline completo (qué etapa va, run_id de cada una) |
| `GET /healthz` | Health check sin autenticación |

Los cuatro agentes (`aft-import`, `sync-run`, `rentabilidad-run`, `pipeline-run`)
comparten un único candado: lanzar cualquiera de ellos falla con `409` si
cualquier otro sigue `running` — nunca se ejecutan dos a la vez, dentro del
mismo agente o entre agentes distintos. Un proceso `running` más antiguo de
2 horas se trata como interrumpido (p. ej. por un reinicio del servicio) y
se desbloquea solo, marcándose como error.

## Garantías de seguridad

- Ningún token ni contraseña se escribe en este repositorio.
- `src/shopifyClient.js` no contiene ninguna mutación GraphQL — Shopify se
  trata estrictamente en modo lectura en todo el código: no se actualizan
  existencias, costes ni precios desde esta aplicación.
- El panel exige Basic Auth (usuario + hash bcrypt de contraseña).
- El panel es utilizable desde el móvil (diseño responsive, sin funciones
  que dependan solo de ratón/pantalla grande).
