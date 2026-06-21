// ─────────────────────────────────────────────────────────────────────────────
// background.js — Service worker de la extensión ContaIA DIAN
//
// Hace los requests a la DIAN DESDE EL NAVEGADOR del usuario (que ya pasó
// Cloudflare), no desde un servidor. Así evita el bloqueo de Cloudflare.
//
// Flujo:
//   1. content.js (en contaiaflex.netlify.app) pide listar/descargar
//   2. background.js hace fetch a la DIAN con las cookies de la sesión activa
//      (el navegador adjunta automáticamente las cookies del dominio DIAN)
//   3. devuelve los datos al content.js
// ─────────────────────────────────────────────────────────────────────────────

const DIAN_HOST = "https://catalogo-vpfe.dian.gov.co";

// Obtener el __RequestVerificationToken desde la página /Document/Received
async function getVerificationToken() {
  const res = await fetch(`${DIAN_HOST}/Document/Received`, {
    method: "GET",
    credentials: "include",  // adjunta cookies del dominio DIAN automáticamente
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

// Descargar el ZIP de una factura y extraer el XML
async function descargarXML(trackId) {
  const res = await fetch(`${DIAN_HOST}/Document/DownloadZipFiles?trackId=${trackId}`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Verificar que es un ZIP (firma PK)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("No es ZIP");

  // Extraer XML del ZIP usando la API de descompresión nativa
  const xml = await extraerXmlDeZip(bytes);
  if (!xml) throw new Error("Sin XML en el ZIP");
  return xml;
}

// Extraer XML de un ZIP (parser mínimo de ZIP con DecompressionStream)
async function extraerXmlDeZip(bytes) {
  const dv = new DataView(bytes.buffer);
  let pos = 0;
  while (pos < bytes.length - 4) {
    // Buscar firma de local file header: PK\x03\x04
    if (dv.getUint32(pos, true) === 0x04034b50) {
      const compMethod = dv.getUint16(pos + 8, true);
      const compSize   = dv.getUint32(pos + 18, true);
      const nameLen    = dv.getUint16(pos + 26, true);
      const extraLen   = dv.getUint16(pos + 28, true);
      const nameStart  = pos + 30;
      const name       = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLen));
      const dataStart  = nameStart + nameLen + extraLen;
      const compData   = bytes.slice(dataStart, dataStart + compSize);

      if (name.toLowerCase().endsWith(".xml")) {
        let content;
        if (compMethod === 0) {
          // Sin compresión
          content = new TextDecoder().decode(compData);
        } else if (compMethod === 8) {
          // Deflate — usar DecompressionStream nativo
          const ds = new DecompressionStream("deflate-raw");
          const stream = new Blob([compData]).stream().pipeThrough(ds);
          content = await new Response(stream).text();
        }
        return content;
      }
      pos = dataStart + compSize;
    } else {
      pos++;
    }
  }
  return null;
}

// Listener de mensajes desde content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING") {
        sendResponse({ ok: true, instalada: true, version: "1.0.0" });
      }
      else if (msg.tipo === "LISTAR") {
        const facturas = await listarFacturas(msg.desde, msg.hasta);
        sendResponse({ ok: true, facturas });
      }
      else if (msg.tipo === "DESCARGAR_XML") {
        const xml = await descargarXML(msg.trackId);
        sendResponse({ ok: true, xml });
      }
      else {
        sendResponse({ ok: false, error: "Acción desconocida" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // respuesta asíncrona
});
