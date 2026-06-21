// ─────────────────────────────────────────────────────────────────────────────
// background.js — Service worker de la extensión ContaIA DIAN
//
// LISTAR: lo hace directamente (no requiere captcha)
// DESCARGAR: lo delega al content script de la página DIAN (que tiene el captcha)
// ─────────────────────────────────────────────────────────────────────────────

const DIAN_HOST = "https://catalogo-vpfe.dian.gov.co";

async function getVerificationToken() {
  const res = await fetch(`${DIAN_HOST}/Document/Received`, {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  const html = await res.text();
  const match = html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
  return match ? match[1] : "";
}

async function listarFacturas(desde, hasta) {
  const rvt = await getVerificationToken();
  if (!rvt) throw new Error("No se pudo obtener el token. ¿Estás logueado en la DIAN?");

  const formBody = [
    "draw=1", "start=0", "length=500",
    "DocumentKey=", "SerieAndNumber=", "SenderCode=", "ReceiverCode=",
    "StartDate=" + encodeURIComponent(desde),
    "EndDate=" + encodeURIComponent(hasta),
    "DocumentTypeId=00", "Status=0", "IsNextPage=false",
    "FilterType=3", "blockIndex=0", "RadianStatus=0",
    "__RequestVerificationToken=" + encodeURIComponent(rvt),
  ].join("&");

  const res = await fetch(`${DIAN_HOST}/Document/GetDocumentsPageToken`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
    body: formBody,
  });

  const data = await res.json();
  const parseDate = v => {
    if (!v) return "";
    const m = String(v).match(/Date\((\d+)\)/);
    if (!m) return String(v).slice(0, 10);
    return new Date(parseInt(m[1])).toISOString().slice(0, 10);
  };

  return (data.data || []).map(doc => ({
    trackId:        doc.Id,
    fecha:          parseDate(doc.EmissionDate),
    fechaRecepcion: parseDate(doc.ReceptionDate),
    prefijo:        doc.Serie || "",
    nroDocumento:   doc.Number || "",
    tipo:           doc.DocumentTypeName || "",
    nitEmisor:      doc.SenderCode || "",
    emisor:         doc.SenderName || "",
    receptor:       doc.ReceiverName || "",
    resultado:      doc.StatusName || "",
    valor:          Math.round(doc.TotalAmount || 0),
    iva:            Math.round(doc.TaxAmountIva || 0),
    tokenConsulta:  doc.TokenConsulta || "",
    identifier:     doc.Identifier || "",
  }));
}

// Buscar una pestaña abierta del portal DIAN para delegarle la descarga
async function buscarTabDian() {
  const tabs = await chrome.tabs.query({ url: `${DIAN_HOST}/*` });
  return tabs.length > 0 ? tabs[0] : null;
}

// Delegar la descarga al content script de la pestaña DIAN (que tiene el captcha)
async function descargarViaTabDian(trackId) {
  const tab = await buscarTabDian();
  if (!tab) throw new Error("Abre el portal DIAN en una pestaña (Documentos Recibidos)");

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { tipo: "DESCARGAR_EN_DIAN", trackId }, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error("No se pudo comunicar con el portal DIAN. Recarga esa pestaña."));
      } else if (res && res.ok) {
        resolve(res);
      } else {
        reject(new Error(res?.error || "Error descargando"));
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING") {
        sendResponse({ ok: true, instalada: true, version: "1.1.0" });
      }
      else if (msg.tipo === "LISTAR") {
        const facturas = await listarFacturas(msg.desde, msg.hasta);
        sendResponse({ ok: true, facturas });
      }
      else if (msg.tipo === "DESCARGAR_ZIP") {
        const result = await descargarViaTabDian(msg.trackId);
        sendResponse({ ok: true, ...result });
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
