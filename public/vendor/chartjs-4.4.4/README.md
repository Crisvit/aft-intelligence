# Chart.js 4.4.4 (vendorizado)

Build UMD oficial, sin modificar, extraído del paquete npm `chart.js@4.4.4`
(`registry.npmjs.org`, paquete publicado por el proyecto Chart.js, licencia
MIT — ver `LICENSE.md` en esta misma carpeta).

Servido localmente vía `express.static` (ver `server.js`) para la página
"Gráficos" del dashboard — deliberadamente NO se carga desde un CDN externo
en producción, para no depender de un tercero en tiempo de ejecución.

Checksum SHA-256 de `chart.umd.js` en el momento de vendorizarlo:
`fed6a739f8d0f0687174de6cd14745fc0fc7809144ab113d22908a26bf0d7fea`

Para actualizar la versión: descargar el tarball oficial
(`npm pack chart.js@<version>`), extraer `dist/chart.umd.js` y
`LICENSE.md`, sustituir esta carpeta (o crear una nueva
`chartjs-<version>/` y actualizar la referencia en
`src/buildDashboardHtml.js`), y anotar aquí el nuevo checksum.
