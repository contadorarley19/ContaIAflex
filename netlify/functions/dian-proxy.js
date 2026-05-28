// netlify/functions/dian-proxy.js
const https = require("https");
const zlib  = require("zlib");
const DIAN_HOST = "catalogo-vpfe.dian.gov.co";

function mergeCookies(existing, incoming) {
  if (!incoming) return existing || "";
  if (!existing)  return incoming;
  const map = {};
  [...existing.split(";"), ...incoming.split(";")]
    .map(c => c.trim()).filter(Boolean)
    .forEach(c => { const [k, ...v] = c.split("="); if (k.trim()) map[k.trim()] = v.join("="); });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function dianRequest(path, cookies, method, bodyStr) {
  method = method || "GET";
  return new Promise((resolve, reject) => {
    const bodyBuf = bodyStr ? Buffer.from(bodyStr, "utf8") : null;
    const options = {
      hostname: DIAN_HOST, port: 443, path, method,
      headers: {
        "Cookie":           cookies || "",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "Accept-Encoding":  "gzip, deflate, br",
        "Accept-Language":  "es-ES,es;q=0.9",
        "Referer":          "https://" + DIAN_HOST + "/Document/Received",
        "X-Requested-With": "XMLHttpRequest",
        ...(bodyBuf ? {
          "Content-Type":   "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": String(bodyBuf.length)
        } : {}),
      },
    };
    const req = https.request(options, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const newCookies = setCookies.map(c => c.split(";")[0]).join("; ");
      const chunks = [];
      const enc = res.headers["content-encoding"];
      let stream = res;
      if (enc === "gzip")   stream = res.pipe(zlib.createGunzip());
      if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      if (enc === "br")      stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, cookies: newCookies, body: Buffer.concat(chunks).toString("utf8") });
      });
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Timeout DIAN")); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function dianDownloadBinary(path, cookies) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DIAN_HOST, port: 443, path, method: "GET",
      headers: {
        "Cookie":           cookies || "",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":           "application/zip,application/octet-stream,*/*",
        "Referer":          "https://" + DIAN_HOST + "/Document/Received",
        "X-Requested-With": "XMLHttpRequest",
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, rawBuffer: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Timeout ZIP")); });
    req.end();
  });
}

function extractXmlFromZip(buffer) {
  try {
    const PK_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const files = [];
    let pos = 0;
    while (pos < buffer.length - 4) {
      const idx = buffer.indexOf(PK_SIG, pos);
      if (idx === -1) break;
      const compressionMethod = buffer.readUInt16LE(idx + 8);
      const compressedSize    = buffer.readUInt32LE(idx + 18);
      const filenameLength    = buffer.readUInt16LE(idx + 26);
      const extraLength       = buffer.readUInt16LE(idx + 28);
      const filename          = buffer.slice(idx + 30, idx + 30 + filenameLength).toString("utf8");
      const dataStart         = idx + 30 + filenameLength + extraLength;
      const compressedData    = buffer.slice(dataStart, dataStart + compressedSize);
      const ext = filename.toLowerCase();
      if (ext.endsWith(".xml") || ext.endsWith(".html")) {
        try {
          let content;
          if (compressionMethod === 0) content = compressedData.toString("utf8");
          else if (compressionMethod === 8) content = zlib.inflateRawSync(compressedData).toString("utf8");
          if (content) files.push({ filename, content });
        } catch(e) {}
      }
      pos = dataStart + compressedSize;
    }
    const xml = files.find(f => f.filename.toLowerCase().endsWith(".xml"));
    if (xml) return xml.content;
    const html = files.find(f => f.filename.toLowerCase().endsWith(".html"));
    if (html) return html.content;
    return null;
  } catch(e) { return null; }
}

// Convertir timestamp DIAN /Date(1234567890000)/ a YYYY-MM-DD
function parseDianDate(val) {
  if (!val) return "";
  const m = String(val).match(/Date\((\d+)\)/);
  if (!m) return String(val).slice(0, 10);
  const d = new Date(parseInt(m[1]));
  return d.toISOString().slice(0, 10);
}

// Obtener el __RequestVerificationToken del HTML de la pagina
async function getVerificationToken(cookies) {
  const result = await dianRequest("/Document/Received", cookies, "GET", null);
  const newCookies = mergeCookies(cookies, result.cookies);
  const match = result.body.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
  const token = match ? match[1] : "";
  return { token, cookies: newCookies };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Metodo no permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON invalido" }) }; }

  const { action } = body;

  try {

    // ── AUTH ──────────────────────────────────────────────────────────────────
    if (action === "auth") {
      const { tokenUrl } = body;
      if (!tokenUrl || !tokenUrl.includes("catalogo-vpfe.dian.gov.co")) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "URL de token invalida" }) };
      }
      const url  = new URL(tokenUrl);
      const path = url.pathname + url.search;

      let result = await dianRequest(path, "", "GET", null);
      let cookies = result.cookies;

      // Seguir hasta 5 redirects
      let redirects = 0;
      while ((result.statusCode === 301 || result.statusCode === 302 || result.statusCode === 303) && redirects < 5) {
        const loc = result.headers["location"] || "";
        const rPath = loc.startsWith("http") ? (new URL(loc)).pathname + (new URL(loc)).search : loc;
        cookies = mergeCookies(cookies, result.cookies);
        result = await dianRequest(rPath, cookies, "GET", null);
        redirects++;
      }
      cookies = mergeCookies(cookies, result.cookies);

      if (!cookies || !cookies.includes("ASP.NET_SessionId")) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "No se obtuvo sesion. El token expiro o ya fue usado." }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cookies, mensaje: "Sesion DIAN iniciada" }) };
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { cookies, desde, hasta } = body;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };

      const startDate = desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
      const endDate   = hasta || new Date().toISOString().slice(0, 10);

      // Paso 1: obtener el __RequestVerificationToken de la pagina
      const tokenInfo = await getVerificationToken(cookies);
      const rvt = tokenInfo.token;
      const newCookies = tokenInfo.cookies;

      // Paso 2: llamar a GetDocumentsPageToken con los parametros exactos del portal
      const formBody = [
        "draw=1",
        "start=0",
        "length=500",       // traer hasta 500 facturas
        "DocumentKey=",
        "SerieAndNumber=",
        "SenderCode=",
        "ReceiverCode=",
        "StartDate=" + encodeURIComponent(startDate),
        "EndDate="   + encodeURIComponent(endDate),
        "DocumentTypeId=00",
        "Status=0",
        "IsNextPage=false",
        "FilterType=3",
        "blockIndex=0",
        "RadianStatus=0",
        "__RequestVerificationToken=" + encodeURIComponent(rvt),
      ].join("&");

      const result = await dianRequest("/Document/GetDocumentsPageToken", newCookies, "POST", formBody);
      const finalCookies = mergeCookies(newCookies, result.cookies);

      // Parsear el JSON de respuesta
      let data;
      try { data = JSON.parse(result.body); }
      catch(e) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, facturas: [], total: 0, cookies: finalCookies, error: "No se pudo parsear respuesta DIAN" }) };
      }

      // Mapear los registros al formato que usa el modal
      const facturas = (data.data || []).map(doc => ({
        trackId:        doc.Id,
        fecha:          parseDianDate(doc.EmissionDate),
        fechaRecepcion: parseDianDate(doc.ReceptionDate),
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

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          facturas,
          total: facturas.length,
          recordsTotal: data.recordsTotal || 0,
          cookies: finalCookies,
        }),
      };
    }

    // ── DOWNLOAD ──────────────────────────────────────────────────────────────
    if (action === "download") {
      const { cookies, trackId } = body;
      if (!cookies || !trackId) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + trackId, cookies);
      if (result.statusCode !== 200) return { statusCode: result.statusCode, headers, body: JSON.stringify({ error: "Error " + result.statusCode }) };
      const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
      if (!isZip) return { statusCode: 422, headers, body: JSON.stringify({ error: "Respuesta no es ZIP. Sesion expirada." }) };
      const xmlContent = extractXmlFromZip(result.rawBuffer);
      if (!xmlContent) return { statusCode: 422, headers, body: JSON.stringify({ error: "Sin XML en ZIP" }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, xml: xmlContent, trackId, zipSize: result.rawBuffer.length }) };
    }

    // ── DOWNLOAD BATCH ────────────────────────────────────────────────────────
    if (action === "download_batch") {
      const { cookies, trackIds } = body;
      if (!cookies || !Array.isArray(trackIds)) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackIds[] requeridos" }) };
      const CONCURRENCY = 5;
      const resultados = [], errores = [];
      for (let i = 0; i < trackIds.length; i += CONCURRENCY) {
        const lote = trackIds.slice(i, i + CONCURRENCY);
        await Promise.all(lote.map(async (trackId) => {
          try {
            const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + trackId, cookies);
            if (result.statusCode !== 200) throw new Error("HTTP " + result.statusCode);
            const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
            if (!isZip) throw new Error("No es ZIP");
            const xmlContent = extractXmlFromZip(result.rawBuffer);
            if (!xmlContent) throw new Error("Sin XML");
            resultados.push({ trackId, xml: xmlContent, zipSize: result.rawBuffer.length });
          } catch(e) { errores.push({ trackId, error: e.message }); }
        }));
        if (i + CONCURRENCY < trackIds.length) await new Promise(r => setTimeout(r, 500));
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, resultados, errores, total: trackIds.length, exitosos: resultados.length }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Accion desconocida: " + action }) };

  } catch(err) {
    console.error("[dian-proxy] Error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno" }) };
  }
};
