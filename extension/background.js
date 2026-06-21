// ─────────────────────────────────────────────────────────────────────────────
// background.js — Service worker de la extensión ContaIA DIAN
//
// Hace los requests a la DIAN DESDE EL NAVEGADOR del usuario (que ya pasó
// Cloudflare), no desde un servidor. Así evita el bloqueo de Cloudflare.
// ─────────────────────────────────────────────────────────────────────────────

const DIAN_HOST = "https://catalogo-vpfe.dian.gov.co";

// Obtener el __RequestVerificationToken desde la página /Document/Received
async function getVerificationToken() {
  const res = await fetch(`${DIAN_HOST}/Document/Received`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = await res.text();
  const match = html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
  return match ? match[1] : "";
}

// Listar facturas en un rango de fechas
async function listarFacturas(desde, hasta) {
  const rvt = await getVerificationToken();
  if (!rvt) throw new Error("No se pudo obtener el token de verificación. ¿Estás logueado en la DIAN?");

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

// Descargar el ZIP de una factura y devolverlo como base64
// (la extracción del XML la hace el ContaIA con JSZip que es más robusto)
async function descargarZipB64(trackId) {
  const res = await fetch(`${DIAN_HOST}/Document/DownloadZipFiles?trackId=${trackId}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "*/*",
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Verificar que es un ZIP (firma PK = 0x50 0x4b)
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // Puede ser que devolvió HTML de error o el XML directo
    const texto = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 200)));
    if (texto.includes("<?xml") || texto.includes("<Invoice") || texto.includes("<AttachedDocument")) {
      // Es XML directo, no ZIP
      return { tipo: "xml", contenido: new TextDecoder().decode(bytes) };
    }
    throw new Error("No es ZIP ni XML (HTTP " + res.status + ")");
  }

  // Convertir ZIP a base64 para mandarlo al ContaIA
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunk));
  }
  return { tipo: "zip", contenido: btoa(binary) };
}

// Listener de mensajes desde content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING") {
        sendResponse({ ok: true, instalada: true, version: "1.0.1" });
      }
      else if (msg.tipo === "LISTAR") {
        const facturas = await listarFacturas(msg.desde, msg.hasta);
        sendResponse({ ok: true, facturas });
      }
      else if (msg.tipo === "DESCARGAR_ZIP") {
        const result = await descargarZipB64(msg.trackId);
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
