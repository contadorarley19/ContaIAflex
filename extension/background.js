// ─────────────────────────────────────────────────────────────────────────────
// background.js — Service worker de la extensión ContaIA DIAN
//
// v1.5.0 — LISTAR y DESCARGAR se delegan a la pestaña del portal DIAN,
// porque solo ahí el fetch pasa por la sesión real que ya cruzó Cloudflare.
// El service worker NO hace fetch directo (Cloudflare lo bloquea con HTML).
// ─────────────────────────────────────────────────────────────────────────────

const DIAN_HOST = "https://catalogo-vpfe.dian.gov.co";

// Buscar una pestaña abierta del portal DIAN
async function buscarTabDian() {
  const tabs = await chrome.tabs.query({ url: `${DIAN_HOST}/*` });
  return tabs.length > 0 ? tabs[0] : null;
}

// Delegar una acción al content script de la pestaña DIAN
function enviarATabDian(tab, mensaje) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, mensaje, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error("No se pudo comunicar con el portal DIAN. Recarga esa pestaña."));
      } else if (res && res.ok) {
        resolve(res);
      } else {
        reject(new Error(res?.error || "Error en la operación"));
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING") {
        sendResponse({ ok: true, instalada: true, version: "1.5.0" });
      }
      else if (msg.tipo === "LISTAR") {
        const tab = await buscarTabDian();
        if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");
        const res = await enviarATabDian(tab, { tipo: "LISTAR", desde: msg.desde, hasta: msg.hasta });
        sendResponse({ ok: true, facturas: res.facturas });
      }
      else if (msg.tipo === "DESCARGAR_ZIP") {
        const tab = await buscarTabDian();
        if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");
        const res = await enviarATabDian(tab, { tipo: "DESCARGAR_EN_DIAN", trackId: msg.trackId, identifier: msg.identifier });
        sendResponse({ ok: true, ...res });
      }
      else {
        sendResponse({ ok: false, error: "Acción desconocida" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});
