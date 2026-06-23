// ─────────────────────────────────────────────────────────────────────────────
// background.js — Service worker de la extensión ContaIA DIAN
//
// v1.9.0 — DESCARGA EN CICLO con recarga entre cada factura.
// Patrón confirmado del portal DIAN: tras cada descarga el captcha se invalida
// y hay que RECARGAR la página (el captcha se auto-resuelve en 3-4s y la lista
// se mantiene con el mismo filtro). El background orquesta el ciclo y sobrevive
// a las recargas de la pestaña.
// ─────────────────────────────────────────────────────────────────────────────

const DIAN_HOST = "https://catalogo-vpfe.dian.gov.co";

async function buscarTabDian() {
  const tabs = await chrome.tabs.query({ url: `${DIAN_HOST}/*` });
  return tabs.length > 0 ? tabs[0] : null;
}

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

// Esperar a que la pestaña termine de cargar (status complete)
function esperarTabCargada(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        if (tab.status === "complete") { resolve(true); return; }
        if (Date.now() - inicio > timeoutMs) { resolve(false); return; }
        setTimeout(check, 400);
      });
    };
    check();
  });
}

// Confirmar que el content script responde en la pestaña (tras recarga)
async function esperarContentListo(tabId, maxMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    try {
      const res = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { tipo: "PING_DIAN" }, (r) => {
          if (chrome.runtime.lastError) resolve(null); else resolve(r);
        });
      });
      if (res && res.ok) return true;
    } catch (e) {}
    await new Promise(s => setTimeout(s, 500));
  }
  return false;
}

// ── DESCARGA EN CICLO: descargar una → recargar → esperar captcha → siguiente ──
async function descargarLote(facturas, onProgreso) {
  const tab = await buscarTabDian();
  if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");

  const resultados = [];
  const fallidas = [];

  for (let i = 0; i < facturas.length; i++) {
    const f = facturas[i];

    // 1) Asegurar que el content script está listo y el captcha cargado
    const listo = await esperarContentListo(tab.id, 20000);
    if (!listo) { fallidas.push({ ...f, error: "Portal no respondió" }); continue; }

    // 2) Esperar a que el captcha esté resuelto (token disponible)
    //    Damos margen: el captcha se auto-resuelve en 3-4s tras cargar
    await new Promise(s => setTimeout(s, 4500));

    // 3) Descargar ESTA factura (clic nativo en el portal)
    try {
      const res = await enviarATabDian(tab, {
        tipo: "DESCARGAR_EN_DIAN",
        trackId: f.trackId,
        identifier: f.identifier,
      });
      resultados.push({ ...f, ...res });
    } catch (e) {
      fallidas.push({ ...f, error: e.message });
    }

    if (onProgreso) onProgreso(i + 1, facturas.length);

    // 4) Si NO es la última, recargar la pestaña para renovar el captcha
    if (i < facturas.length - 1) {
      await chrome.tabs.reload(tab.id);
      await esperarTabCargada(tab.id, 30000);
      // pequeño respiro extra tras cargar el DOM
      await new Promise(s => setTimeout(s, 1500));
    }
  }

  return { resultados, fallidas };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING") {
        sendResponse({ ok: true, instalada: true, version: "1.9.0" });
      }
      else if (msg.tipo === "LISTAR") {
        const tab = await buscarTabDian();
        if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");
        const res = await enviarATabDian(tab, { tipo: "LISTAR", desde: msg.desde, hasta: msg.hasta });
        sendResponse({ ok: true, facturas: res.facturas });
      }
      else if (msg.tipo === "DESCARGAR_ZIP") {
        // Descarga individual (compatibilidad)
        const tab = await buscarTabDian();
        if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");
        const res = await enviarATabDian(tab, { tipo: "DESCARGAR_EN_DIAN", trackId: msg.trackId, identifier: msg.identifier });
        sendResponse({ ok: true, ...res });
      }
      else if (msg.tipo === "DESCARGAR_LOTE") {
        // Descarga en ciclo con recarga entre cada una
        const { resultados, fallidas } = await descargarLote(msg.facturas, (actual, total) => {
          // Notificar progreso a ContaIA vía content script de la app
          chrome.tabs.query({ url: "https://contaiaflex.netlify.app/*" }, (tabs) => {
            tabs.forEach(t => chrome.tabs.sendMessage(t.id, { tipo: "PROGRESO_LOTE", actual, total }, () => void chrome.runtime.lastError));
          });
        });
        sendResponse({ ok: true, resultados, fallidas });
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
