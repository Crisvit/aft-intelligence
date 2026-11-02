const { Pool } = require('pg');

// PGSSL=false desactiva TLS (solo para Postgres local de pruebas — nunca
// en producción, ver .env.example). Con TLS activo (el caso normal), por
// defecto NO se valida la cadena de certificados (rejectUnauthorized:
// false) — así funciona contra la mayoría de Postgres gestionados sin
// configuración adicional, pero deja la conexión expuesta a un
// intermediario con un certificado no firmado por una CA reconocida. Si el
// proveedor de Postgres expone una CA verificable, activa
// PGSSL_REJECT_UNAUTHORIZED=true para validar el certificado de verdad —
// desactivado por defecto a propósito, para no romper una conexión que ya
// funciona sin haber confirmado antes que el certificado real pasa esa
// validación.
const sslRejectUnauthorized = String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true';

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: sslRejectUnauthorized },
  max: 5
});

module.exports = { pool };
