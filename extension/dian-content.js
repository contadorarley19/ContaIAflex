// ─────────────────────────────────────────────────────────────────────────────
// dian-content.js — Puente (mundo AISLADO) en la página DIAN
//
// v1.5.0 — Este script ve chrome.runtime pero NO window.turnstile.
// Por eso delega el trabajo real a dian-main.js (mundo MAIN) vía postMessage.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  let _id = 0;
  const pendientes = {};

  // Recibir respuestas del script MAIN
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "DIAN_MAIN") return;
    const cb = pendientes[d.id];
    if (cb) { delete pendientes[d.id]; cb(d); }
  });

  // Enviar una petición al MAIN y esperar su respuesta
  function pedirAlMain(tipo, extra) {
    return new Promise((resolve) => {
      const id = ++_id;
      pendientes[id] = resolve;
      window.postMessage({ source: "DIAN_CONTENT", id, tipo, ...extra }, "*");
      // Timeout de seguridad
      setTimeout(() => {
        if (pendientes[id]) { delete pendientes[id]; resolve({ ok: false, error: "Sin respuesta del portal (timeout)" }); }
      }, 30000);
    });
  }

  // Recibir mensajes del background y delegarlos al MAIN
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg.tipo === "PING_DIAN") {
          sendResponse(await pedirAlMain("PING_DIAN", {}));
        } else if (msg.tipo === "LISTAR") {
          sendResponse(await pedirAlMain("LISTAR", { desde: msg.desde, hasta: msg.hasta }));
        } else if (msg.tipo === "DESCARGAR_EN_DIAN") {
          sendResponse(await pedirAlMain("DESCARGAR_EN_DIAN", { trackId: msg.trackId }));
        } else if (msg.tipo === "RESET_TOKEN") {
          sendResponse(await pedirAlMain("RESET_TOKEN", {}));
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  console.log("[ContaIA DIAN content] Puente listo (mundo aislado).");
})();
