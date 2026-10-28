// Alertas de fallo — best-effort, nunca bloquea ni hace fallar al agente
// que las dispara: cualquier error al enviar la notificación se registra
// por consola y se descarta, nunca se propaga. Sin ALERT_WEBHOOK_URL
// configurado, notificarFallo() es un no-op — el comportamiento actual
// (solo console.error) no cambia hasta que se active explícitamente.
//
// Formato del payload: { text: "..." }, compatible con un webhook
// entrante de Slack sin configuración adicional. Para otro destino
// (email, Discord, un endpoint propio) basta con que acepte ese mismo
// POST JSON, o adaptar este archivo — es el único sitio que lo construye.
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

async function notificarFallo({ agente, mensaje, runId }) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    const etiquetaRun = runId ? ` (run #${runId})` : '';
    const payload = { text: `⚠️ AFT Intelligence — fallo en "${agente}"${etiquetaRun}: ${mensaje}` };
    const resp = await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      console.error(`[alertas] El webhook de alertas respondió ${resp.status} al notificar el fallo de "${agente}".`);
    }
  } catch (e) {
    console.error('[alertas] No se pudo enviar la notificación de fallo (el fallo original ya quedó en los logs):', e.message);
  }
}

module.exports = { notificarFallo };
