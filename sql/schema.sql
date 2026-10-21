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
