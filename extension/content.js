// ─────────────────────────────────────────────────────────────────────────────
// content.js — Puente entre el ContaIA web y la extensión
// v1.9.0 — Soporta DESCARGAR_LOTE (ciclo con recarga) y reenvío de progreso.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const anunciar = () => window.postMessage({ source: "DIAN_EXT", tipo: "EXTENSION_READY", version: "1.9.0" }, "*");
  anunciar();
  setTimeout(anunciar, 500);
  setTimeout(anunciar, 1500);
  setTimeout(anunciar, 3000);

  // Recibir progreso del background durante el ciclo y reenviarlo a la app
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === "PROGRESO_LOTE") {
      window.postMessage({ source: "APP_PROG", tipo: "PROGRESO_LOTE_APP", actual: msg.actual, total: msg.total }, "*");
    }
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "CONTAIA_APP") return;

    const responder = (payload) => {
      window.postMessage({ source: "DIAN_EXT", id: data.id, ...payload }, "*");
    };

    try {
      if (data.tipo === "PING") {
        chrome.runtime.sendMessage({ tipo: "PING" }, (res) => responder(res || { ok: false, error: "Sin respuesta" }));
      }
      else if (data.tipo === "LISTAR") {
        chrome.runtime.sendMessage({ tipo: "LISTAR", desde: data.desde, hasta: data.hasta },
          (res) => responder(res || { ok: false, error: "Sin respuesta" }));
      }
      else if (data.tipo === "DESCARGAR_ZIP") {
        chrome.runtime.sendMessage({ tipo: "DESCARGAR_ZIP", trackId: data.trackId, identifier: data.identifier },
          (res) => responder(res || { ok: false, error: "Sin respuesta" }));
      }
      else if (data.tipo === "DESCARGAR_LOTE") {
        chrome.runtime.sendMessage({ tipo: "DESCARGAR_LOTE", facturas: data.facturas },
          (res) => responder(res || { ok: false, error: "Sin respuesta" }));
      }
    } catch (e) {
      responder({ ok: false, error: e.message });
    }
  });
})();
