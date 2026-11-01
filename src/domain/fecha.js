// Capa de dominio (Clean Architecture) — fecha de calendario en hora de
// Madrid, pura (no toca process.env salvo leer el reloj del sistema, que
// es la única impureza inevitable de "ahora"; por eso acepta un Date
// opcional para poder probarla con un instante fijo). Usada por los
// snapshots diarios (fase 3) para que "qué día es hoy" se decida siempre
// por la fecha de Madrid, no la del servidor (normalmente UTC) — así una
// ejecución que corre pasada la medianoche UTC pero todavía de tarde en
// Madrid (o al revés) queda en el día que un usuario en España esperaría.
function fechaMadrid(ahora) {
  const d = ahora || new Date();
  // en-CA produce YYYY-MM-DD directamente, formato que Postgres entiende
  // sin ambigüedad como DATE.
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

// Fecha de calendario (Madrid) de hace "dias" días — para acotar las
// consultas de snapshots diarios a una ventana de 7/30/90 días sin asumir
// cuántas filas existen realmente (una ventana sin datos suficientes
// simplemente devuelve menos filas, nunca se rellena).
function fechaHaceNDias(dias, ahora) {
  const base = ahora || new Date();
  const corrida = new Date(base.getTime() - Number(dias) * 86400000);
  return fechaMadrid(corrida);
}

module.exports = { fechaMadrid, fechaHaceNDias };
