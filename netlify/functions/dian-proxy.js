// netlify/functions/dian-proxy.js — versión corregida
// FIXES:
//   1. XML se envía SIEMPRE como base64 puro — elimina Unterminated string in JSON
//   2. Sanitización agresiva del XML antes de codificar (caracteres de control, surrogados)
//   3. Respuesta del batch truncada si supera 5.9MB (límite Netlify) → chunks parciales
//   4. Timeout de 24s con margen de seguridad por factura individual

const https = require("https");
const zlib  = require("zlib");

const DIAN_HOST_PROD = "catalogo-vpfe.dian.gov.co";
const DIAN_HOST_HAB  = "catalogo-vpfe-hab.dian.gov.co";

// Netlify Free: respuesta máx ~6MB. Con base64 cada XML ~3KB → 46 facturas ~140KB. OK.
// Si alguien tiene 200 facturas puede llegar al límite → cortar y avisar.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB de margen

function mergeCookies(existing, incoming) {
  if (!incoming) return existing || "";
  if (!existing)  return incoming;
  const map = {};
  [...existing.split(";"), ...incoming.split(";")]
    .map(c => c.trim()).filter(Boolean)
    .forEach(c => { const [k, ...v] = c.split("="); if (k.trim()) map[k.trim()] = v.join("="); });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function backoffMs(n) { return n === 0 ? 0 : Math.min(800 * Math.pow(2, n - 1), 8000); }

// ── Sanitizar XML para que sea JSON-safe ──────────────────────────────────────
// El problema "Unterminated string in JSON" ocurre porque el XML de algunas
// facturas DIAN contiene caracteres inválidos en JSON:
//   • Caracteres de control (0x00-0x1F excepto tab/lf/cr)
//   • Pares sustitutos UTF-16 sueltos (surrogates) que no son UTF-8 válido
//   • BOM (0xFEFF)
// SOLUCIÓN: convertir el contenido del XML a Buffer UTF-8 y codificar en base64.
// El base64 es 100% JSON-safe por definición — no puede contener comillas ni
// caracteres de control. El frontend decodifica con TextDecoder.
function sanitizarXmlBytes(rawBytes, encoding) {
  let content;
  try {
    if      (encoding === "latin1")   content = rawBytes.toString("latin1");
    else if (encoding === "utf16le")  content = rawBytes.toString("utf16le");
    else                              content = rawBytes.toString("utf8");
  } catch(e) {
    content = rawBytes.toString("latin1"); // fallback seguro
  }

  // Eliminar BOM
  content = content.replace(/^\uFEFF/, "");

  // Eliminar caracteres de control (excepto \t \n \r que son válidos en XML)
  // Incluye surrogates sueltos (\uD800-\uDFFF)
  // eslint-disable-next-line no-control-regex
  content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uD800-\uDFFF]/g, "");

  // Reconvertir a Buffer UTF-8 limpio y devolver base64
  return Buffer.from(content, "utf8").toString("base64");
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function dianRequest(path, cookies, method, bodyStr, host, timeoutMs = 28000) {
  method = method || "GET";
  host   = host   || DIAN_HOST_PROD;
  return new Promise((resolve, reject) => {
    const bodyBuf = bodyStr ? Buffer.from(bodyStr, "utf8") : null;
    const options = {
      hostname: host, port: 443, path, method,
      headers: {
        "Cookie":           cookies || "",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "Accept-Encoding":  "gzip, deflate, br",
        "Accept-Language":  "es-CO,es;q=0.9,en;q=0.8",
        "Referer":          `https://${host}/Document/Received`,
        "X-Requested-With": "XMLHttpRequest",
        "Connection":       "keep-alive",
        ...(bodyBuf ? {
          "Content-Type":   "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": String(bodyBuf.length),
        } : {}),
      },
    };
    const req = https.request(options, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const newCookies = setCookies.map(c => c.split(";")[0]).join("; ");
      const chunks = [];
      const enc = res.headers["content-encoding"];
      let stream = res;
      if (enc === "gzip")    stream = res.pipe(zlib.createGunzip());
      if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      if (enc === "br")      stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data",  chunk => chunks.push(chunk));
      stream.on("end",   ()    => resolve({ statusCode: res.statusCode, headers: res.headers, cookies: newCookies, body: Buffer.concat(chunks).toString("utf8") }));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout DIAN")); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function dianDownloadBinary(path, cookies, host, timeoutMs = 30000) {
  host = host || DIAN_HOST_PROD;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host, port: 443, path, method: "GET",
      headers: {
        "Cookie":           cookies || "",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":           "application/zip,application/octet-stream,*/*",
        "Referer":          `https://${host}/Document/Received`,
        "X-Requested-With": "XMLHttpRequest",
        "Connection":       "keep-alive",
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data",  chunk => chunks.push(chunk));
      res.on("end",   ()    => resolve({ statusCode: res.statusCode, headers: res.headers, rawBuffer: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout ZIP")); });
    req.end();
  });
}

// ── Descarga con reintentos ────────────────────────────────────────────────────

async function downloadConReintentos(trackId, cookies, host, maxIntentos = 4) {
  let ultimoError = null;
  for (let intento = 0; intento < maxIntentos; intento++) {
    if (intento > 0) await sleep(backoffMs(intento));
    try {
      const result = await dianDownloadBinary(
        `/Document/DownloadZipFiles?trackId=${trackId}`,
        cookies, host, 22000 + intento * 4000
      );
      if (result.statusCode === 502 || result.statusCode === 503 || result.statusCode === 504) {
        ultimoError = new Error(`HTTP ${result.statusCode}`);
        continue;
      }
      if (result.statusCode === 401 || result.statusCode === 403) throw new Error("Sesion expirada");
      if (result.statusCode !== 200) throw new Error(`HTTP ${result.statusCode}`);
      const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
      if (!isZip) {
        const preview = result.rawBuffer.slice(0, 200).toString("utf8");
        if (preview.toLowerCase().includes("session") || preview.toLowerCase().includes("login")) {
          throw new Error("Sesion expirada");
        }
        ultimoError = new Error("Respuesta no es ZIP");
        continue;
      }
      return result;
    } catch(e) {
      if (e.message === "Sesion expirada") throw e;
      ultimoError = e;
    }
  }
  throw ultimoError || new Error("Falló tras reintentos");
}

// ── Parseo ZIP — devuelve base64 directamente ─────────────────────────────────

function extractXmlBase64FromZip(buffer) {
  try {
    const PK_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const candidatos = []; // Recoger todos los XML/HTML del ZIP
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
      const ext               = filename.toLowerCase();

      if (ext.endsWith(".xml") || ext.endsWith(".html")) {
        try {
          let rawBytes;
          if      (compressionMethod === 0) rawBytes = compressedData;
          else if (compressionMethod === 8) rawBytes = zlib.inflateRawSync(compressedData);
          if (rawBytes && rawBytes.length > 0) {
            // Detectar encoding desde la declaración XML
            const head = rawBytes.slice(0, 300).toString("latin1");
            let encoding = "utf8";
            if      (head.match(/encoding=["']ISO-8859-1["']/i)) encoding = "latin1";
            else if (head.match(/encoding=["']UTF-16["']/i))     encoding = "utf16le";
            // Sanitizar y convertir a base64 JSON-safe
            const xmlB64 = sanitizarXmlBytes(rawBytes, encoding);
            candidatos.push({ filename, xmlB64, esXml: ext.endsWith(".xml") });
          }
        } catch(e) { /* ignorar y continuar */ }
      }
      pos = dataStart + Math.max(compressedSize, 1);
    }
    // Preferir .xml sobre .html
    const xml  = candidatos.find(c => c.esXml);
    const html = candidatos.find(c => !c.esXml);
    return (xml || html)?.xmlB64 || null;
  } catch(e) { return null; }
}

function extractPdfFromZip(buffer) {
  try {
    const PK_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
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
      if (filename.toLowerCase().endsWith(".pdf")) {
        try {
          if (compressionMethod === 0) return compressedData;
          if (compressionMethod === 8) return zlib.inflateRawSync(compressedData);
        } catch(e) {}
      }
      pos = dataStart + Math.max(compressedSize, 1);
    }
    return null;
  } catch(e) { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDianDate(val) {
  if (!val) return "";
  const m = String(val).match(/Date\((\d+)\)/);
  if (!m) return String(val).slice(0, 10);
  return new Date(parseInt(m[1])).toISOString().slice(0, 10);
}

async function getVerificationToken(cookies, host) {
  host = host || DIAN_HOST_PROD;
  const result     = await dianRequest("/Document/Received", cookies, "GET", null, host, 20000);
  const newCookies = mergeCookies(cookies, result.cookies);
  const match      = result.body.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
  return { token: match ? match[1] : "", cookies: newCookies };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

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
      if (!tokenUrl || (!tokenUrl.includes("catalogo-vpfe.dian.gov.co") && !tokenUrl.includes("catalogo-vpfe-hab.dian.gov.co"))) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "URL de token inválida" }) };
      }
      let cleanUrl = tokenUrl.trim();
      if (cleanUrl.includes("safelinks.protection.outlook.com")) {
        try {
          const match = cleanUrl.match(/[?&]url=([^&]+)/);
          if (match) cleanUrl = decodeURIComponent(decodeURIComponent(match[1]));
        } catch(e) {}
      }
      if (cleanUrl.includes("%3A%2F%2F") || cleanUrl.includes("%3A%2f%2f")) {
        cleanUrl = decodeURIComponent(cleanUrl);
      }
      const url      = new URL(cleanUrl);
      const path     = url.pathname + url.search;
      const dianHost = url.hostname.includes("-hab") ? DIAN_HOST_HAB : DIAN_HOST_PROD;

      let result  = await dianRequest(path, "", "GET", null, dianHost);
      let cookies = result.cookies;
      let redirects = 0;
      while ((result.statusCode === 301 || result.statusCode === 302 || result.statusCode === 303) && redirects < 5) {
        const loc   = result.headers["location"] || "";
        const rPath = loc.startsWith("http") ? new URL(loc).pathname + new URL(loc).search : loc;
        cookies     = mergeCookies(cookies, result.cookies);
        result      = await dianRequest(rPath, cookies, "GET", null, dianHost);
        redirects++;
      }
      cookies = mergeCookies(cookies, result.cookies);
      if (!cookies || !cookies.includes("ASP.NET_SessionId")) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "No se obtuvo sesión. El token expiró o ya fue usado." }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cookies, dianHost, mensaje: "Sesión DIAN iniciada" }) };
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    // ── OBTENER TOKEN DE VERIFICACIÓN (llamada separada para evitar timeout) ──────
    if (action === "get_token") {
      const { cookies, dianHost: dh } = body;
      const dianHost = dh || DIAN_HOST_PROD;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };
      const tokenInfo = await getVerificationToken(cookies, dianHost);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token: tokenInfo.token, cookies: tokenInfo.cookies }) };
    }

    if (action === "list") {
      const { cookies, desde, hasta, dianHost: dh, verificationToken } = body;
      const dianHost = dh || DIAN_HOST_PROD;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };
      const startDate = desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
      const endDate   = hasta || new Date().toISOString().slice(0, 10);

      // Si ya viene el token, usarlo directamente; si no, obtenerlo (compatibilidad)
      let tokenInfo;
      if (verificationToken) {
        tokenInfo = { token: verificationToken, cookies };
      } else {
        tokenInfo = await getVerificationToken(cookies, dianHost);
      }
      const newCookies = tokenInfo.cookies;
      const formBody = [
        "draw=1","start=0","length=500",
        "DocumentKey=","SerieAndNumber=","SenderCode=","ReceiverCode=",
        `StartDate=${encodeURIComponent(startDate)}`,
        `EndDate=${encodeURIComponent(endDate)}`,
        "DocumentTypeId=00","Status=0","IsNextPage=false",
        "FilterType=3","blockIndex=0","RadianStatus=0",
        `__RequestVerificationToken=${encodeURIComponent(tokenInfo.token)}`,
      ].join("&");
      const result       = await dianRequest("/Document/GetDocumentsPageToken", newCookies, "POST", formBody, dianHost, 24000);
      const finalCookies = mergeCookies(newCookies, result.cookies);
      let data;
      try { data = JSON.parse(result.body); }
      catch(e) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, facturas: [], total: 0, cookies: finalCookies, error: "No se pudo parsear respuesta DIAN" }) };
      }
      const facturas = (data.data || []).map(doc => ({
        trackId:        doc.Id,
        fecha:          parseDianDate(doc.EmissionDate),
        fechaRecepcion: parseDianDate(doc.ReceptionDate),
        prefijo:        doc.Serie         || "",
        nroDocumento:   doc.Number        || "",
        tipo:           doc.DocumentTypeName || "",
        nitEmisor:      doc.SenderCode    || "",
        emisor:         doc.SenderName    || "",
        receptor:       doc.ReceiverName  || "",
        resultado:      doc.StatusName    || "",
        valor:          Math.round(doc.TotalAmount  || 0),
        iva:            Math.round(doc.TaxAmountIva || 0),
        tokenConsulta:  doc.TokenConsulta || "",
        identifier:     doc.Identifier   || "",
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, facturas, total: facturas.length, recordsTotal: data.recordsTotal || 0, cookies: finalCookies }) };
    }

    // ── DOWNLOAD SINGLE ───────────────────────────────────────────────────────
    if (action === "download") {
      const { cookies, trackId, dianHost: dh2 } = body;
      const dianHost2 = dh2 || DIAN_HOST_PROD;
      if (!cookies || !trackId) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      const result  = await downloadConReintentos(trackId, cookies, dianHost2);
      const xmlB64  = extractXmlBase64FromZip(result.rawBuffer);
      if (!xmlB64)  return { statusCode: 422, headers, body: JSON.stringify({ error: "Sin XML en ZIP" }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, xml: xmlB64, encoding: "base64", trackId, zipSize: result.rawBuffer.length }) };
    }

    // ── DOWNLOAD BATCH ────────────────────────────────────────────────────────
    if (action === "download_batch") {
      const { cookies, trackIds, dianHost: dh3 } = body;
      const dianHost3 = dh3 || DIAN_HOST_PROD;
      if (!cookies || !Array.isArray(trackIds)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackIds[] requeridos" }) };
      }

      const CONCURRENCY = 3;
      const resultados  = [];
      const errores     = [];
      let   sesionMuerta = false;
      let   bytesAcumulados = 0;
      let   truncado = false;

      for (let i = 0; i < trackIds.length; i += CONCURRENCY) {
        if (sesionMuerta) {
          trackIds.slice(i).forEach(tid => errores.push({ trackId: tid, error: "Sesion expirada" }));
          break;
        }
        if (truncado) {
          trackIds.slice(i).forEach(tid => errores.push({ trackId: tid, error: "Respuesta demasiado grande — procesar en lotes menores" }));
          break;
        }

        const lote       = trackIds.slice(i, i + CONCURRENCY);
        const erroresAnt = errores.length;

        await Promise.all(lote.map(async (trackId) => {
          try {
            const result = await downloadConReintentos(trackId, cookies, dianHost3, 4);
            const xmlB64 = extractXmlBase64FromZip(result.rawBuffer);
            if (!xmlB64) throw new Error("Sin XML en ZIP");
            // Verificar que no superamos el límite de respuesta
            bytesAcumulados += xmlB64.length;
            if (bytesAcumulados > MAX_RESPONSE_BYTES) {
              truncado = true;
              errores.push({ trackId, error: "Límite de respuesta alcanzado" });
              return;
            }
            resultados.push({ trackId, xml: xmlB64, encoding: "base64", zipSize: result.rawBuffer.length });
          } catch(e) {
            if (e.message === "Sesion expirada") sesionMuerta = true;
            errores.push({ trackId, error: e.message });
          }
        }));

        if (i + CONCURRENCY < trackIds.length && !sesionMuerta && !truncado) {
          const hubieronErrores = errores.length > erroresAnt;
          await sleep(hubieronErrores ? 2500 : 400);
        }
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, resultados, errores, total: trackIds.length, exitosos: resultados.length, sesionMuerta, truncado }),
      };
    }

    // ── DOWNLOAD PDF BATCH ─────────────────────────────────────────────────────
    if (action === "download_pdfs") {
      const { cookies, facturas } = body;
      if (!cookies || !Array.isArray(facturas)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y facturas[] requeridos" }) };
      }
      const ordenadas  = [...facturas].sort((a, b) => ((a.fecha||"")+(a.prefijo||"")).localeCompare((b.fecha||"")+(b.prefijo||"")));
      const CONCURRENCY = 3;
      const resultados = [], errores = [];
      let sesionMuerta = false;
      for (let i = 0; i < ordenadas.length; i += CONCURRENCY) {
        if (sesionMuerta) {
          ordenadas.slice(i).forEach(f => errores.push({ trackId: f.trackId, emisor: f.emisor, error: "Sesion expirada" }));
          break;
        }
        const lote       = ordenadas.slice(i, i + CONCURRENCY);
        const erroresAnt = errores.length;
        await Promise.all(lote.map(async (f) => {
          try {
            const result  = await downloadConReintentos(f.trackId, cookies, DIAN_HOST_PROD, 4);
            const pdfData = extractPdfFromZip(result.rawBuffer);
            if (!pdfData) throw new Error("Sin PDF en ZIP");
            const emisorLimpio = (f.emisor || "desconocido").replace(/[^a-zA-Z0-9À-ɏ]/g,"_").replace(/_+/g,"_").substring(0,30).toUpperCase();
            const nombre = `${f.fecha||"0000-00-00"}_${emisorLimpio}_${(f.prefijo||"")+(f.nroDocumento||"")}.pdf`;
            resultados.push({ trackId: f.trackId, nombre, pdf: pdfData.toString("base64"), size: pdfData.length });
          } catch(e) {
            if (e.message === "Sesion expirada") sesionMuerta = true;
            errores.push({ trackId: f.trackId, emisor: f.emisor, error: e.message });
          }
        }));
        if (i + CONCURRENCY < ordenadas.length && !sesionMuerta) {
          await sleep(errores.length > erroresAnt ? 2500 : 400);
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, resultados, errores, total: ordenadas.length, exitosos: resultados.length, sesionMuerta }) };
    }

    // ── DOWNLOAD PDF SINGLE ────────────────────────────────────────────────────
    if (action === "download_pdf_single") {
      const { cookies, trackId } = body;
      if (!cookies || !trackId) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      const result  = await downloadConReintentos(trackId, cookies, DIAN_HOST_PROD, 3);
      const pdfData = extractPdfFromZip(result.rawBuffer);
      if (!pdfData) return { statusCode: 422, headers, body: JSON.stringify({ error: "Sin PDF en ZIP" }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pdf: pdfData.toString("base64"), trackId }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Accion desconocida: ${action}` }) };

  } catch(err) {
    console.error("[dian-proxy] Error:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno" }) };
  }
};
