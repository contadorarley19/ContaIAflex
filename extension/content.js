// ─────────────────────────────────────────────────────────────────────────────
// content.js — Puente entre el ContaIA web y la extensión
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  // Anunciar que la extensión está instalada (repetir por si el ContaIA carga después)
  const anunciar = () => window.postMessage({ source: "DIAN_EXT", tipo: "EXTENSION_READY", version: "1.0.1" }, "*");
  anunciar();
  setTimeout(anunciar, 500);
  setTimeout(anunciar, 1500);
  setTimeout(anunciar, 3000);

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
        chrome.runtime.sendMessage({ tipo: "DESCARGAR_ZIP", trackId: data.trackId },
          (res) => responder(res || { ok: false, error: "Sin respuesta" }));
      }
    } catch (e) {
      responder({ ok: false, error: e.message });
    }
  });
})();
