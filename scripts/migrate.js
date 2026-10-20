// Aplica sql/schema.sql contra hmt-db. Idempotente (todo CREATE TABLE IF NOT EXISTS).
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Esquema aplicado correctamente en hmt-db.');
  await pool.end();
}

main().catch((e) => {
  console.error('Error aplicando el esquema:', e.message);
  process.exit(1);
});
