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
