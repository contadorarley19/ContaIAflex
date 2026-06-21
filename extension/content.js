// ─────────────────────────────────────────────────────────────────────────────
// content.js — Puente entre el ContaIA web y la extensión
//
// Corre dentro de contaiaflex.netlify.app y expone una API que el ContaIA
// puede usar via window.postMessage. Reenvía las peticiones al background.js
// que tiene acceso a la sesión DIAN del navegador.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  // Anunciar que la extensión está instalada
  window.postMessage({ source: "DIAN_EXT", tipo: "EXTENSION_READY", version: "1.0.0" }, "*");

  // Escuchar peticiones del ContaIA
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "CONTAIA_APP") return;

    const responder = (payload) => {
      window.postMessage({ source: "DIAN_EXT", id: data.id, ...payload }, "*");
    };

    try {
      if (data.tipo === "PING") {
        chrome.runtime.sendMessage({ tipo: "PING" }, (res) => {
          responder(res || { ok: false, error: "Sin respuesta de la extensión" });
        });
      }
      else if (data.tipo === "LISTAR") {
        chrome.runtime.sendMessage(
          { tipo: "LISTAR", desde: data.desde, hasta: data.hasta },
          (res) => responder(res || { ok: false, error: "Sin respuesta" })
        );
      }
      else if (data.tipo === "DESCARGAR_XML") {
        chrome.runtime.sendMessage(
          { tipo: "DESCARGAR_XML", trackId: data.trackId },
          (res) => responder(res || { ok: false, error: "Sin respuesta" })
        );
      }
    } catch (e) {
      responder({ ok: false, error: e.message });
    }
  });
})();
