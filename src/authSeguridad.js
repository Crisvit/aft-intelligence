// Refuerzos de seguridad para basicAuth (server.js) — dos defectos reales
// encontrados en la auditoría de seguridad, ninguno de los dos una
// funcionalidad nueva del panel:
//
// 1) Comparación de usuario en tiempo variable: antes, `user !== DASHBOARD_USER`
//    cortocircuitaba ANTES de llamar a bcrypt cuando el usuario no coincidía,
//    así que un intento con el usuario correcto tardaba ~bcrypt (decenas de
//    ms) y uno con el usuario incorrecto volvía casi al instante — una fuga
//    de tiempo que permite adivinar el usuario correcto sin saber la
//    contraseña. Ahora bcrypt.compareSync se ejecuta SIEMPRE (contra un hash
//    fijo de relleno cuando el usuario no coincide), así que el tiempo de
//    respuesta no depende de si el usuario era correcto.
//
// 2) Sin ningún límite de intentos: el panel protege datos reales de
//    inventario y rentabilidad detrás de una única contraseña estática, sin
//    límite de intentos — un atacante con la URL podía probar contraseñas
//    sin límite. limiteIntentos() es un limitador en memoria, por IP,
//    ventana deslizante — suficiente para un único contenedor (el modelo de
//    despliegue real de este proyecto, ver Dockerfile), sin dependencia
//    nueva ni estado compartido que no exista ya.
const bcrypt = require('bcryptjs');

// Hash de relleno válido (bcrypt de una cadena fija, nunca la contraseña
// real) — solo para que bcrypt.compareSync tenga siempre un hash real con
// el que trabajar y tarde lo mismo, nunca para autenticar con él.
const HASH_RELLENO = bcrypt.hashSync('relleno-tiempo-constante', 10);

// Función pura (salvo por bcrypt, que es determinista en el resultado):
// nunca toca red ni base de datos.
function credencialesValidas(usuario, password, { dashboardUser, dashboardPasswordHash }) {
  const usuarioCoincide = typeof usuario === 'string' && usuario === dashboardUser;
  const hashContraComparar = usuarioCoincide && dashboardPasswordHash ? dashboardPasswordHash : HASH_RELLENO;
  const passwordCoincide = bcrypt.compareSync(String(password || ''), hashContraComparar);
  // El AND se evalúa después de llamar a bcrypt siempre con un hash real,
  // así que esta línea no reintroduce el cortocircuito que se quería evitar.
  return usuarioCoincide && passwordCoincide;
}

const VENTANA_MS = Number(process.env.AUTH_RATE_LIMIT_VENTANA_MS) || 5 * 60 * 1000; // 5 minutos
const MAX_INTENTOS = Number(process.env.AUTH_RATE_LIMIT_MAX_INTENTOS) || 10;
const intentosPorIp = new Map(); // ip -> { intentos, ventanaInicio }

// Limpia entradas ya expiradas — evita crecimiento sin límite en memoria
// con el tiempo, sin necesitar un temporizador aparte.
function limpiarExpirados(ahora) {
  for (const [ip, estado] of intentosPorIp) {
    if (ahora - estado.ventanaInicio > VENTANA_MS) intentosPorIp.delete(ip);
  }
}

// true si esta IP puede intentar autenticarse ahora mismo (por debajo del
// límite de intentos fallidos en la ventana actual).
function puedeIntentar(ip, ahora = Date.now()) {
  limpiarExpirados(ahora);
  const estado = intentosPorIp.get(ip);
  if (!estado) return true;
  if (ahora - estado.ventanaInicio > VENTANA_MS) return true;
  return estado.intentos < MAX_INTENTOS;
}

function registrarIntentoFallido(ip, ahora = Date.now()) {
  const estado = intentosPorIp.get(ip);
  if (!estado || ahora - estado.ventanaInicio > VENTANA_MS) {
    intentosPorIp.set(ip, { intentos: 1, ventanaInicio: ahora });
  } else {
    estado.intentos++;
  }
}

function registrarExito(ip) {
  intentosPorIp.delete(ip);
}

// Solo para pruebas — vacía el estado en memoria entre tests.
function _resetParaPruebas() {
  intentosPorIp.clear();
}

module.exports = {
  credencialesValidas, puedeIntentar, registrarIntentoFallido, registrarExito,
  _resetParaPruebas, VENTANA_MS, MAX_INTENTOS
};
