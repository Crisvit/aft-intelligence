-- AFT 2.0 / hmt-db schema — independent Postgres database for the standalone
-- AFT <-> Shopify intelligence app. No PII, no order data. Read-only toward
-- Shopify by construction (this app never calls a Shopify mutation).

CREATE TABLE IF NOT EXISTS aft_categorias (
  id_categoria    TEXT PRIMARY KEY,
  nombre          TEXT,
  padre           TEXT,
  url_img         TEXT,
  ultima_sync     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aft_catalogo (
  ref                 TEXT PRIMARY KEY,
  ean                 TEXT,
  marca               TEXT,
  categoria_id        TEXT,
  categoria_nombre    TEXT,
  descripcion_corta   TEXT,
  descripcion_larga   TEXT,
  peso_gr             NUMERIC,
  alto_cm             NUMERIC,
  ancho_cm            NUMERIC,
  largo_cm            NUMERIC,
  portes              NUMERIC,
  tipo_iva            TEXT,
  por_iva             NUMERIC,
  ultima_sync         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aft_catalogo_ean ON aft_catalogo (ean);

CREATE TABLE IF NOT EXISTS aft_stock_precios (
  ref                       TEXT PRIMARY KEY REFERENCES aft_catalogo(ref) ON DELETE CASCADE,
  costo                     NUMERIC,
  pvp_sin_iva               NUMERIC,
  stock                     INTEGER,
  fecha_ultimo_cambio_aft   TIMESTAMPTZ,
  ultima_actualizacion_local TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resultado de comparar cada producto AFT candidato contra Shopify en la
-- última ejecución de sync. Es la foto actual (upsert por ref), no un historial.
CREATE TABLE IF NOT EXISTS shopify_match (
  ref                             TEXT PRIMARY KEY,
  ean                             TEXT,
  marca                           TEXT,
  shopify_variant_id              TEXT,
  shopify_inventory_item_id       TEXT,
  shopify_product_title           TEXT,
  shopify_price                   NUMERIC,
  shopify_stock                   INTEGER,
  shopify_cost                    NUMERIC,
  matched_by                      TEXT,        -- 'ean' | 'sku' | null
  num_variantes_encontradas       INTEGER,
  alerta_duplicado                BOOLEAN DEFAULT false,
  alerta_multiples_ubicaciones    BOOLEAN DEFAULT false,
  alerta_ubicacion_no_encontrada  BOOLEAN DEFAULT false,
  stock_aft                       INTEGER,
  stock_diferencia                INTEGER,
  coste_para_margen               NUMERIC,
  precio_venta_aft                NUMERIC,
  margen_actual_pct               NUMERIC,
  margen_con_precio_aft_pct       NUMERIC,
  diferencia_precio_pct           NUMERIC,
  recomendacion_precio            TEXT,
  bloquear_escritura               BOOLEAN DEFAULT false,
  estado                           TEXT,        -- 'cambiaria' | 'a_cero' | 'sin_cambio' | 'incidencia' | 'no_encontrado'
  checked_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id                 SERIAL PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL,
  finished_at        TIMESTAMPTZ,
  total_aft_candidatos INTEGER DEFAULT 0,
  total_matched      INTEGER DEFAULT 0,
  total_cambiarian   INTEGER DEFAULT 0,
  total_a_cero       INTEGER DEFAULT 0,
  total_sin_cambio   INTEGER DEFAULT 0,
  total_incidencias  INTEGER DEFAULT 0,
  total_no_encontrados INTEGER DEFAULT 0,
  status             TEXT NOT NULL,   -- 'running' | 'success' | 'error'
  error_message      TEXT
);

-- Progreso de la lectura paginada completa del catálogo de Shopify dentro de
-- cada sync_run (ver src/sync.js). shopify_lectura_completa solo se pone a
-- true cuando se ha terminado de paginar TODO productVariants (hasNextPage
-- = false en la última página) — el matching nunca se considera definitivo
-- antes de eso. permisos_incompletos/permisos_detalle registran campos a los
-- que la app no tiene acceso (p.ej. falta el scope read_locations) en vez de
-- inventar el dato que falta.
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS fase TEXT;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS shopify_paginas_leidas INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS shopify_variantes_leidas INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS shopify_lectura_completa BOOLEAN DEFAULT false;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS permisos_incompletos BOOLEAN DEFAULT false;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS permisos_detalle TEXT;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS comparacion_total INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS comparacion_procesadas INTEGER DEFAULT 0;

-- El control de inventario (ver src/sync.js) ahora cruza TODAS las
-- referencias AFT contra Shopify, no solo las de marcas/categorías
-- comerciales — es_oportunidad_comercial distingue, entre las no
-- encontradas en Shopify, cuáles son una oportunidad real (pasan el
-- filtro de marca/categoría) de las que simplemente están fuera de
-- nuestro interés comercial.
-- coste_aft_sin_iva / coste_aft_con_impuestos se guardan por separado de
-- shopify_cost a propósito: NO se asume si el coste registrado en Shopify
-- incluye o no IVA (sin confirmar con datos reales), así que no se calcula
-- ninguna "diferencia de coste" automática entre AFT y Shopify todavía.
ALTER TABLE shopify_match ADD COLUMN IF NOT EXISTS es_oportunidad_comercial BOOLEAN DEFAULT false;
ALTER TABLE shopify_match ADD COLUMN IF NOT EXISTS coste_aft_sin_iva NUMERIC;
ALTER TABLE shopify_match ADD COLUMN IF NOT EXISTS coste_aft_con_impuestos NUMERIC;

-- Catálogo completo de Shopify (TODAS las variantes, no solo 100 productos
-- ni la primera variante de cada uno), leído por el mismo paginador que ya
-- usa el matching (shopify.getAllVariants, ver src/sync.js). Reemplaza la
-- llamada en vivo que hacía la página "Productos" del dashboard. vendor_shopify
-- es el campo "vendor" tal cual lo da Shopify — nunca se usa para decidir si
-- un producto es de AFT (ver shopify_match.ref para eso, vía matching real
-- por EAN/SKU); solo sirve como dato informativo y como filtro aparte.
CREATE TABLE IF NOT EXISTS shopify_catalogo (
  shopify_variant_id         TEXT PRIMARY KEY,
  shopify_product_id         TEXT,
  shopify_inventory_item_id  TEXT,
  titulo                     TEXT,
  vendor_shopify              TEXT,
  estado                      TEXT,   -- 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  barcode                     TEXT,
  sku                         TEXT,
  precio                      NUMERIC,
  stock_ubicacion_principal   INTEGER,
  imagen_url                  TEXT,
  ultima_sync                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidencias (
  id             SERIAL PRIMARY KEY,
  ref            TEXT,
  ean            TEXT,
  tipo           TEXT NOT NULL,  -- 'ean_duplicado' | 'stock_negativo' | 'sin_correspondencia' | 'multiples_ubicaciones' | 'ubicacion_principal_no_encontrada'
  detalle        TEXT,
  detectado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado         TEXT NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE IF NOT EXISTS sync_lock (
  lock_key    TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  started_at  TIMESTAMPTZ
);

-- Progreso e historial de cada ejecución de la importación AFT en segundo
-- plano (sustituye el flag en memoria). Permite reintentos seguros: si el
-- servicio se reinicia a mitad de una importación, la fila queda en
-- 'running' y se recupera como obsoleta la siguiente vez que se solicita
-- una importación (ver server.js).
-- Tarifas de transporte AL CLIENTE, configurables por categoría, producto
-- (excepción) o peso — nunca una tarifa única universal. Orden de
-- resolución (ver src/rentabilidad.js): ref > categoría > peso mínimo >
-- valor por defecto (con umbral de envío gratis). Distinto de
-- aft_catalogo.portes (transporte del PROVEEDOR a Herramitienda) — ese
-- dato se muestra aparte en rentabilidad_resultados, sin sumarlo
-- automáticamente al coste total, porque no está confirmado si ya viene
-- incluido en aft_stock_precios.costo.
CREATE TABLE IF NOT EXISTS config_transporte_cliente (
  id                  SERIAL PRIMARY KEY,
  tipo                TEXT NOT NULL,              -- 'ref' | 'categoria' | 'peso_minimo' | 'default'
  clave               TEXT NOT NULL,              -- ref exacta, substring de categoría (mayúsculas), o etiqueta libre para peso_minimo/default
  umbral_peso_gr      NUMERIC,                    -- solo relevante para tipo='peso_minimo'
  tarifa              NUMERIC NOT NULL,
  umbral_envio_gratis NUMERIC,                    -- si el PVP >= este valor, tarifa=0 (NULL = nunca gratis con esta regla)
  nota                TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, clave)
);
INSERT INTO config_transporte_cliente (tipo, clave, tarifa, umbral_envio_gratis, nota) VALUES
  ('default', '_DEFAULT_', 4.41, 30, 'Tarifa estándar Herramitienda, gratis desde 30€ (valor heredado del cálculo anterior a este agente)')
  ON CONFLICT (tipo, clave) DO NOTHING;
INSERT INTO config_transporte_cliente (tipo, clave, tarifa, umbral_envio_gratis, nota) VALUES
  ('categoria', 'ESCALERA', 13, NULL, 'Producto pesado/voluminoso — tarifa fija confirmada, nunca envío gratis'),
  ('categoria', 'ANDAMIO', 13, NULL, 'Producto pesado/voluminoso — tarifa fija confirmada, nunca envío gratis')
  ON CONFLICT (tipo, clave) DO NOTHING;
INSERT INTO config_transporte_cliente (tipo, clave, umbral_peso_gr, tarifa, umbral_envio_gratis, nota) VALUES
  ('peso_minimo', 'PESO_20KG', 20000, 13, NULL, 'Productos pesados por peso (AFT peso_gr >= 20kg) sin categoría reconocida — misma tarifa fija que escaleras/andamios')
  ON CONFLICT (tipo, clave) DO NOTHING;

-- Progreso/historial del agente de rentabilidad.
CREATE TABLE IF NOT EXISTS rentabilidad_runs (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  fase              TEXT,
  total_analizados  INTEGER DEFAULT 0,
  procesados        INTEGER DEFAULT 0,
  en_perdida        INTEGER DEFAULT 0,
  margen_bajo       INTEGER DEFAULT 0,
  diferencia_coste  INTEGER DEFAULT 0,
  alertas_total     INTEGER DEFAULT 0,
  error_message     TEXT
);

-- Resultado de rentabilidad por referencia en la última ejecución del
-- agente (foto actual, se reemplaza entera cada run — como shopify_match).
CREATE TABLE IF NOT EXISTS rentabilidad_resultados (
  ref                        TEXT PRIMARY KEY,
  marca                      TEXT,
  descripcion                TEXT,
  coste_sin_iva              NUMERIC,
  iva_importe                NUMERIC,
  recargo_importe            NUMERIC,
  coste_con_impuestos        NUMERIC,
  portes_proveedor_aft       NUMERIC,   -- aft_catalogo.portes, informativo — NO sumado al coste total
  transporte_cliente         NUMERIC,
  transporte_cliente_origen  TEXT,      -- regla aplicada: 'ref:<ref>' | 'categoria:<clave>' | 'peso_minimo:<clave>' | 'default'
  coste_total_estimado       NUMERIC,   -- coste_con_impuestos + transporte_cliente
  pvp_real                   NUMERIC,
  pvp_es_real                BOOLEAN,   -- true = precio real de Shopify; false = precio AFT proyectado (sin coincidencia aún)
  margen_pct                 NUMERIC,
  margen_absoluto            NUMERIC,
  shopify_cost                NUMERIC,
  diferencia_coste_shopify   NUMERIC,   -- coste_total_estimado - shopify_cost (solo informativo)
  estado_rentabilidad        TEXT,      -- 'ok' | 'margen_bajo' | 'perdida' | 'sin_pvp'
  checked_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Corrección confirmada con datos reales de hmt-db: AFT sí da portes
-- específicos por referencia (aft_catalogo.portes) para envío directo al
-- cliente en productos grandes/pesados (escaleras, andamios...) — ya NO se
-- usa una tarifa fija (13€) para esas categorías/pesos, ni los 4,41€
-- anteriores como si fueran el coste real de transporte de AFT. Las reglas
-- de categoría/peso de config_transporte_cliente quedan desactivadas; la
-- regla "default" se conserva solo como respaldo propio para referencias
-- SIN portes válido de AFT (ver src/rentabilidad.js).
UPDATE config_transporte_cliente SET activo = false WHERE tipo IN ('categoria', 'peso_minimo');

ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS es_envio_directo_aft BOOLEAN DEFAULT false;
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS comision_venta_importe NUMERIC;
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS datos_incompletos BOOLEAN DEFAULT false;
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS datos_incompletos_motivo TEXT;

-- Confirmación comercial: AFT permite agrupar varios productos en un mismo
-- pedido, pero el coste del transporte agrupado depende del peso total y
-- NO hay todavía una tarifa verificada para ese escenario. Por eso NUNCA se
-- inventa un coste ni se suman los portes individuales como si fueran el
-- coste del pedido agrupado (eso sobrestimaría sistemáticamente, ya que un
-- pedido agrupado paga un único porte por el peso conjunto, no uno por
-- artículo) — solo se muestra el peso total y un estado explícito de
-- "pendiente de cotización" (ver resolverEscenarioAgrupado en
-- src/rentabilidad.js). escenario_agrupado_estado: 'pendiente_cotizacion'
-- (hay portes individual de AFT, pero no tarifa agrupada confirmada) |
-- 'no_aplica' (sin envío directo de AFT, no hay base para un escenario
-- agrupado todavía).
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS peso_gr NUMERIC;
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS escenario_agrupado_estado TEXT;

-- Clasificación de venta (solo informativa, no cambia coste/margen):
-- 'individual' (margen suficiente en escenario individual) |
-- 'complementaria' (PVP bajo, candidato a venta cruzada/complemento, ver
-- RENTABILIDAD_PVP_COMPLEMENTO_MAX) | 'margen_insuficiente' (perdida,
-- margen_bajo o sin_pvp) | 'datos_incompletos' (coste base no disponible).
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS clasificacion_venta TEXT;
ALTER TABLE rentabilidad_resultados ADD COLUMN IF NOT EXISTS es_candidato_complemento BOOLEAN DEFAULT false;

-- Historial (append-only) de alertas de rentabilidad, con explicación legible.
CREATE TABLE IF NOT EXISTS rentabilidad_alertas (
  id             SERIAL PRIMARY KEY,
  ref            TEXT,
  tipo           TEXT NOT NULL,  -- 'perdida' | 'margen_bajo' | 'diferencia_coste'
  detalle        TEXT NOT NULL,
  valor          NUMERIC,
  detectado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encadena importación AFT -> sincronización Shopify -> rentabilidad en una
-- sola ejecución (prioridad 2: automatización), con su propio lock/historial.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id                   SERIAL PRIMARY KEY,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  etapa                TEXT,    -- 'import_aft' | 'sync_shopify' | 'reposicion' | 'rentabilidad' | 'done'
  aft_import_run_id    INTEGER,
  sync_run_id          INTEGER,
  rentabilidad_run_id  INTEGER,
  error_message        TEXT
);
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS reposicion_run_id INTEGER;

CREATE TABLE IF NOT EXISTS aft_import_runs (
  id                      SERIAL PRIMARY KEY,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at             TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  fase                    TEXT,                              -- 'iniciando' | 'categorias' | 'productos' | 'stock' | 'done'
  total_categorias        INTEGER DEFAULT 0,
  categorias_insertadas   INTEGER DEFAULT 0,
  categorias_duplicadas   INTEGER DEFAULT 0,
  total_productos         INTEGER DEFAULT 0,
  productos_insertados    INTEGER DEFAULT 0,
  productos_duplicados    INTEGER DEFAULT 0,
  total_stock             INTEGER DEFAULT 0,
  stock_insertado         INTEGER DEFAULT 0,
  stock_duplicado         INTEGER DEFAULT 0,
  stock_huerfano          INTEGER DEFAULT 0,
  incidencias             INTEGER DEFAULT 0,
  errores_sql             INTEGER DEFAULT 0,
  error_message           TEXT
);

-- Reposición automática de stock (Agente 2, paso obligatorio tras la
-- comparación Shopify<->AFT): decide y, si está autorizado, escribe en
-- Shopify la cantidad "available" confirmada por AFT para cada coincidencia
-- FIABLE con diferencia de stock. DRY RUN por defecto (dry_run=true salvo
-- que SHOPIFY_WRITE_ENABLED=true Y la app tenga el scope write_inventory
-- concedido, comprobado en cada ejecución — ver src/reposicion.js y
-- src/shopifyWriteClient.js, el único archivo de todo el repositorio con
-- capacidad real de escritura hacia Shopify).
CREATE TABLE IF NOT EXISTS reposicion_runs (
  id                          SERIAL PRIMARY KEY,
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at                 TIMESTAMPTZ,
  status                      TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  fase                        TEXT,
  dry_run                     BOOLEAN NOT NULL DEFAULT true,
  total_candidatos            INTEGER DEFAULT 0,
  actualizados                INTEGER DEFAULT 0,
  recuperados_stock_cero      INTEGER DEFAULT 0,
  reposiciones_detectadas     INTEGER DEFAULT 0,
  correcciones_a_la_baja      INTEGER DEFAULT 0,
  sin_cambios                 INTEGER DEFAULT 0,
  errores                     INTEGER DEFAULT 0,
  verificaciones_fallidas     INTEGER DEFAULT 0,
  error_message               TEXT
);

-- Actualización controlada de UNA sola referencia (prioridad 3), separada
-- a propósito del lote diario completo: su propia variable de entorno
-- (SHOPIFY_WRITE_UNA_REF_ENABLED, nunca SHOPIFY_WRITE_ENABLED) y su propio
-- registro de quién la pidió, para quedar auditable como lo que es — una
-- escritura puntual y autorizada, no parte del lote automático.
ALTER TABLE reposicion_runs ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'lote'; -- 'lote' | 'referencia_unica'
ALTER TABLE reposicion_runs ADD COLUMN IF NOT EXISTS ref_solicitada TEXT; -- solo cuando modo='referencia_unica'
ALTER TABLE reposicion_runs ADD COLUMN IF NOT EXISTS iniciado_por TEXT; -- usuario del dashboard que lo lanzó

-- Historial (append-only) de cada candidato evaluado por el agente de
-- reposición, escrito o no — para que cada actualización (o la decisión de
-- no actualizar) quede auditable desde el dashboard.
CREATE TABLE IF NOT EXISTS reposicion_eventos (
  id                          SERIAL PRIMARY KEY,
  run_id                      INTEGER REFERENCES reposicion_runs(id),
  ref                         TEXT,
  ean                         TEXT,
  marca                       TEXT,
  shopify_variant_id          TEXT,
  shopify_inventory_item_id   TEXT,
  stock_shopify_antes         INTEGER,
  stock_aft                   INTEGER,
  stock_shopify_despues       INTEGER,  -- lo escrito (o lo que se habría escrito, en dry run)
  tipo_evento                 TEXT NOT NULL,  -- 'producto_recuperado_stock_cero_negativo' | 'reposicion_detectada' | 'correccion_a_la_baja' | 'sin_cambios' | 'error'
  dry_run                     BOOLEAN NOT NULL DEFAULT true,
  escrito                     BOOLEAN NOT NULL DEFAULT false,  -- true solo si se llamó de verdad a la mutación
  verificado                  BOOLEAN,  -- resultado de la lectura posterior; null si no aplica (dry run / sin cambios)
  detalle                     TEXT,
  detectado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agente 4 — Oportunidades comerciales como proceso independiente con su
-- propio historial, en vez de recalcularse en cada carga del dashboard
-- (como antes). Reutiliza exactamente el mismo universo ya calculado por
-- sync.js (shopify_match.es_oportunidad_comercial) — no se inventa ni
-- duplica ese filtro, solo se puntúa y explica.
CREATE TABLE IF NOT EXISTS oportunidades_runs (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  fase              TEXT,
  total_candidatos  INTEGER DEFAULT 0,
  prioritarias      INTEGER DEFAULT 0,
  complementarias   INTEGER DEFAULT 0,
  error_message     TEXT
);

-- Foto de la última ejecución (se reemplaza entera cada run, como
-- rentabilidad_resultados). "score" y "motivo" son siempre explicables a
-- partir de datos reales (marca, margen proyectado, stock) — nunca una
-- señal de demanda externa inventada (eso es el Agente 5, solo si hay una
-- fuente real conectada).
CREATE TABLE IF NOT EXISTS oportunidades_resultados (
  ref                          TEXT PRIMARY KEY,
  ean                          TEXT,
  marca                        TEXT,
  descripcion                  TEXT,
  categoria_nombre             TEXT,
  stock_aft                    INTEGER,
  coste                        NUMERIC,
  portes_proveedor_aft         NUMERIC,
  pvp_recomendado              NUMERIC,
  margen_pct                   NUMERIC,
  es_marca_prioritaria         BOOLEAN DEFAULT false,
  es_candidato_complementario  BOOLEAN DEFAULT false,
  score                        NUMERIC,
  motivo                       TEXT,
  checked_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS oportunidades_run_id INTEGER;

-- Agente 5 — Demanda y SEO. Genera candidatos de keyword a partir del
-- catálogo real (marca + categoría + descripción) para las oportunidades
-- ya detectadas por el Agente 4, y consulta volumen/competencia REAL solo
-- si hay una integración autorizada (DataForSEO) conectada — ver
-- src/demanda.js y DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD en .env.example.
-- Sin esa integración, status queda en 'no_conectado' (nunca 'success'
-- fingiendo tener datos reales) y los candidatos se guardan sin volumen ni
-- competencia (NULL, no un número inventado).
CREATE TABLE IF NOT EXISTS demanda_runs (
  id                     SERIAL PRIMARY KEY,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at            TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error' | 'no_conectado'
  fase                   TEXT,
  fuente                 TEXT,  -- 'dataforseo' | 'catalogo_interno'
  total_keywords         INTEGER DEFAULT 0,
  verificadas            INTEGER DEFAULT 0,
  sugeridas_sin_verificar INTEGER DEFAULT 0,
  error_message          TEXT
);

-- Historial (append-only) de candidatos de keyword por ejecución —
-- "verificado" distingue sin ambigüedad una métrica real de una sugerida.
CREATE TABLE IF NOT EXISTS demanda_resultados (
  id                SERIAL PRIMARY KEY,
  run_id            INTEGER REFERENCES demanda_runs(id),
  ref               TEXT,
  keyword           TEXT NOT NULL,
  origen            TEXT NOT NULL,  -- 'catalogo_interno' (derivada de marca+categoría+descripción, sin verificar) | 'dataforseo' (real)
  volumen_busqueda  INTEGER,        -- NULL si no hay fuente real conectada
  competencia       TEXT,           -- NULL si no hay fuente real conectada
  verificado        BOOLEAN NOT NULL DEFAULT false,  -- true SOLO si viene de una fuente real conectada
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS demanda_run_id INTEGER;

-- Agente 6 — Fichas de producto con IA. Usa datos reales de AFT y los
-- resultados ya puntuados del Agente 4 para generar un borrador (título,
-- descripción, atributos, metadatos SEO) SOLO si hay un proveedor de IA
-- conectado (ver ANTHROPIC_API_KEY en .env.example y src/fichasIa.js). Sin
-- esa conexión, status queda en 'no_conectado' y NO se genera ningún
-- borrador — nunca se presenta una plantilla como si fuera un resultado de
-- IA. Aprobar/Rechazar/Editar son SIEMPRE cambios de estado en PostgreSQL;
-- ningún camino de este agente llama a Shopify ni publica nada.
CREATE TABLE IF NOT EXISTS fichas_runs (
  id               SERIAL PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error' | 'no_conectado'
  fase             TEXT,
  modelo           TEXT,
  total_candidatos INTEGER DEFAULT 0,
  generados        INTEGER DEFAULT 0,
  con_avisos_calidad INTEGER DEFAULT 0,
  error_message    TEXT
);

-- Borradores — revisión humana obligatoria antes de cualquier publicación
-- (que, en cualquier caso, no ocurre desde este repositorio: "aprobar"
-- aquí solo marca el borrador como listo, nunca escribe en Shopify).
CREATE TABLE IF NOT EXISTS fichas_borradores (
  id                  SERIAL PRIMARY KEY,
  run_id              INTEGER REFERENCES fichas_runs(id),
  ref                 TEXT NOT NULL,
  marca               TEXT,
  titulo              TEXT,
  descripcion         TEXT,
  atributos           JSONB,
  meta_titulo         TEXT,
  meta_descripcion    TEXT,
  keywords_seo        JSONB,
  modelo              TEXT,
  calidad_validada    BOOLEAN NOT NULL DEFAULT false,
  motivo_calidad      TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'aprobado' | 'rechazado'
  editado             BOOLEAN NOT NULL DEFAULT false,
  revisado_por        TEXT,
  revisado_en         TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS fichas_run_id INTEGER;
