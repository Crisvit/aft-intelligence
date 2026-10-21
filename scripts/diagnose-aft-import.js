// Diagnóstico de SOLO LECTURA — no inserta, no actualiza, no borra nada,
// no escribe ningún archivo. Reutiliza aft.getAftToken()/getCategorias()/
// getProductos()/getStockPrecios() ya existentes, sin tocarlos.
//
// Ejecutar dentro del contenedor de hmt-intelligence (donde ya están las
// variables de entorno de AFT configuradas):
//   node scripts/diagnose-aft-import.js
//
// No imprime el token ni ninguna credencial — solo recuentos y nombres de
// campo. Si quieres, puedes redirigir la salida a un archivo local tuyo,
// pero este script no lo hace por sí mismo ni toca el repositorio.

const aft = require('../src/aftClient');

function toArray(x) {
  return Array.isArray(x) ? x : (x.items || x.data || []);
}

function isEmptyRef(ref) {
  return ref === null || ref === undefined || String(ref).trim() === '';
}

async function main() {
  const token = await aft.getAftToken();
  console.log('1. Token AFT obtenido: OK');

  const [categoriasRaw, productosRaw, stockRaw] = await Promise.all([
    aft.getCategorias(token),
    aft.getProductos(token),
    aft.getStockPrecios(token)
  ]);
  const categorias = toArray(categoriasRaw);
  const productos = toArray(productosRaw);
  const stock = toArray(stockRaw);

  console.log(`2. Recibidos de AFT: categorias=${categorias.length}, productos=${productos.length}, stockPrecios=${stock.length}`);

  // --- nombres de campo reales (sin valores, salvo 1 ejemplo acotado) ---
  console.log('\n3. Campos reales devueltos por AFT (claves del primer registro de cada lista):');
  console.log('   categorias[0] keys:', categorias[0] ? Object.keys(categorias[0]) : '(lista vacía)');
  console.log('   productos[0] keys:', productos[0] ? Object.keys(productos[0]) : '(lista vacía)');
  console.log('   stockPrecios[0] keys:', stock[0] ? Object.keys(stock[0]) : '(lista vacía)');

  const camposEsperadosProducto = ['ref', 'ean', 'marca', 'categorias', 'descripcioN_CORTA', 'descripcioN_LARGA', 'pesO_GR', 'altO_CM', 'anchO_CM', 'largO_CM', 'portes', 'tipO_IVA', 'poR_IVA'];
  const camposEsperadosStock = ['ref', 'costo', 'pvP_SINIVA', 'stock', 'fechA_ULTIMO_CAMBIO'];
  if (productos[0]) {
    const faltanProducto = camposEsperadosProducto.filter((k) => !(k in productos[0]));
    console.log('   Campos que sync.js espera en productos y NO existen en la respuesta real:', faltanProducto.length ? faltanProducto : '(ninguno, coinciden)');
  }
  if (stock[0]) {
    const faltanStock = camposEsperadosStock.filter((k) => !(k in stock[0]));
    console.log('   Campos que sync.js espera en stockPrecios y NO existen en la respuesta real:', faltanStock.length ? faltanStock : '(ninguno, coinciden)');
  }

  // --- 1. ref nulo/vacío ---
  const productosSinRef = productos.filter((p) => isEmptyRef(p.ref));
  const stockSinRef = stock.filter((s) => isEmptyRef(s.ref));
  console.log(`\n4. Productos con ref nulo/vacío: ${productosSinRef.length} de ${productos.length}`);
  console.log(`   Filas de stock con ref nulo/vacío: ${stockSinRef.length} de ${stock.length}`);

  // --- 2. referencias duplicadas ---
  function contarDuplicados(arr) {
    const counts = {};
    for (const x of arr) {
      if (isEmptyRef(x.ref)) continue;
      counts[x.ref] = (counts[x.ref] || 0) + 1;
    }
    const dup = Object.entries(counts).filter(([, n]) => n > 1);
    return { refsUnicas: Object.keys(counts).length, refsDuplicadas: dup.length, filasExtra: dup.reduce((s, [, n]) => s + (n - 1), 0) };
  }
  const dupProd = contarDuplicados(productos);
  const dupStock = contarDuplicados(stock);
  console.log(`\n5. Duplicados en catálogo (productos): ${dupProd.refsDuplicadas} refs repetidas (${dupProd.filasExtra} filas de más sobre ${dupProd.refsUnicas} refs únicas)`);
  console.log(`   Duplicados en stock: ${dupStock.refsDuplicadas} refs repetidas (${dupStock.filasExtra} filas de más sobre ${dupStock.refsUnicas} refs únicas)`);

  // --- cruce catálogo <-> stock (clave foránea aft_stock_precios.ref -> aft_catalogo.ref) ---
  const refsProductos = new Set(productos.filter((p) => !isEmptyRef(p.ref)).map((p) => p.ref));
  const stockSinCatalogo = stock.filter((s) => !isEmptyRef(s.ref) && !refsProductos.has(s.ref));
  console.log(`\n6. Filas de stock cuya ref NO existe en productos (romperían la FK aft_stock_precios->aft_catalogo): ${stockSinCatalogo.length} de ${stock.length}`);
  if (stockSinCatalogo.length) {
    console.log('   Ejemplo de ref de stock sin producto asociado:', stockSinCatalogo[0].ref);
  }

  // --- 4. tipos de datos: stock entero, costo/pvp numéricos, fecha parseable ---
  function esEnteroValido(v) {
    return v === null || v === undefined || Number.isInteger(Number(v));
  }
  function esNumeroValido(v) {
    return v === null || v === undefined || (typeof v === 'number' ? isFinite(v) : !isNaN(Number(v)));
  }
  function esFechaValida(v) {
    if (v === null || v === undefined || v === '') return true;
    return !isNaN(new Date(v).getTime());
  }

  const stockNoEntero = stock.filter((s) => !esEnteroValido(s.stock));
  const costoNoNumerico = stock.filter((s) => !esNumeroValido(s.costo));
  const pvpNoNumerico = stock.filter((s) => !esNumeroValido(s.pvP_SINIVA !== undefined ? s.pvP_SINIVA : s.pvp_siniva));
  const fechaInvalida = stock.filter((s) => !esFechaValida(s.fechA_ULTIMO_CAMBIO));

  console.log('\n7. Compatibilidad de tipos con PostgreSQL (tabla aft_stock_precios):');
  console.log(`   stock no es entero válido: ${stockNoEntero.length} filas`, stockNoEntero[0] ? `(ejemplo ref=${stockNoEntero[0].ref}, valor=${JSON.stringify(stockNoEntero[0].stock)})` : '');
  console.log(`   costo no es numérico válido: ${costoNoNumerico.length} filas`, costoNoNumerico[0] ? `(ejemplo ref=${costoNoNumerico[0].ref}, valor=${JSON.stringify(costoNoNumerico[0].costo)})` : '');
  console.log(`   pvP_SINIVA no es numérico válido: ${pvpNoNumerico.length} filas`);
  console.log(`   fechA_ULTIMO_CAMBIO no parseable como fecha: ${fechaInvalida.length} filas`, fechaInvalida[0] ? `(ejemplo ref=${fechaInvalida[0].ref}, valor=${JSON.stringify(fechaInvalida[0].fechA_ULTIMO_CAMBIO)})` : '');

  // --- 5. resumen de lo que haría ROLLBACK la transacción actual tal cual está hoy ---
  const totalFilasProblematicas = productosSinRef.length + stockSinRef.length + stockSinCatalogo.length + stockNoEntero.length;
  console.log('\n=== RESUMEN ===');
  console.log(`Filas que, tal como está sync.js hoy, bastan UNA sola para hacer ROLLBACK de toda la importación: ${totalFilasProblematicas}`);
  console.log(totalFilasProblematicas > 0
    ? '=> Esto confirma la hipótesis: con la transacción única actual, estas filas explican el catalogo=0 en /status.'
    : '=> No se encontraron filas que violen las restricciones actuales; la causa sería entonces el timeout HTTP/proxy, no un error SQL.');
}

main().catch((e) => {
  console.error('Error en el diagnóstico (no se ha escrito nada en la base):', e.message);
  process.exit(1);
});
