// netlify/functions/dian-proxy.js
const https = require("https");
const zlib  = require("zlib");
// Host se determina dinámicamente según la URL del token
const DIAN_HOST_PROD = "catalogo-vpfe.dian.gov.co";
const DIAN_HOST_HAB  = "catalogo-vpfe-hab.dian.gov.co";

function mergeCookies(existing, incoming) {
  if (!incoming) return existing || "";
  if (!existing)  return incoming;
  const map = {};
  [...existing.split(";"), ...incoming.split(";")]
    .map(c => c.trim()).filter(Boolean)
    .forEach(c => { const [k, ...v] = c.split("="); if (k.trim()) map[k.trim()] = v.join("="); });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function dianRequest(path, cookies, method, bodyStr, host, isBrowser) {
  method = method || "GET";
  host = host || DIAN_HOST_PROD;
  return new Promise((resolve, reject) => {
    const bodyBuf = bodyStr ? Buffer.from(bodyStr, "utf8") : null;
    // isBrowser=true para auth (simula navegador real), false para XHR
    const browserHeaders = {
      "Cookie":          cookies || "",
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
      "Cache-Control":   "no-cache",
      "Pragma":          "no-cache",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest":  "document",
      "Sec-Fetch-Mode":  "navigate",
      "Sec-Fetch-Site":  "none",
      "Sec-Fetch-User":  "?1",
    };
    const xhrHeaders = {
      "Cookie":           cookies || "",
      "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Accept":           "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding":  "gzip, deflate, br",
      "Accept-Language":  "es-ES,es;q=0.9",
      "Referer":          "https://" + host + "/Document/Received",
      "X-Requested-With": "XMLHttpRequest",
      ...(bodyBuf ? {
        "Content-Type":   "application/x-www-form-urlencoded; charset=UTF-8",
        "Content-Length": String(bodyBuf.length)
      } : {}),
    };
    const options = {
      hostname: host, port: 443, path, method,
      headers: isBrowser ? browserHeaders : xhrHeaders,
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
    req.setTimeout(22000, () => { req.destroy(); reject(new Error("Timeout DIAN")); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function dianDownloadBinary(path, cookies, host) {
  host = host || DIAN_HOST_PROD;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host, port: 443, path, method: "GET",
      headers: {
        "Cookie":           cookies || "",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":           "application/zip,application/octet-stream,*/*",
        "Referer":          "https://" + host + "/Document/Received",
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
          let rawBytes;
          if (compressionMethod === 0) rawBytes = compressedData;
          else if (compressionMethod === 8) rawBytes = zlib.inflateRawSync(compressedData);
          
          let content;
          if (rawBytes) {
            // Detectar encoding desde el XML declaration
            const head = rawBytes.slice(0, 200).toString("latin1");
            if (head.includes('ISO-8859-1') || head.includes('iso-8859-1')) {
              content = rawBytes.toString("latin1");
            } else if (head.includes('UTF-16') || head.includes('utf-16')) {
              content = rawBytes.toString("utf16le");
            } else {
              content = rawBytes.toString("utf8");
            }
            // Limpiar caracteres de control que rompen JSON
            content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
          }
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
async function getVerificationToken(cookies, host) {
  host = host || DIAN_HOST_PROD;
  const result = await dianRequest("/Document/Received", cookies, "GET", null, host);
  const newCookies = mergeCookies(cookies, result.cookies);
  const match = result.body.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
  const token = match ? match[1] : "";
  return { token, cookies: newCookies };
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
      pos = dataStart + compressedSize;
    }
    return null;
  } catch(e) { return null; }
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
      // Decodificar SafeLinks de Outlook si es necesario
      let cleanUrl = tokenUrl.trim();
      if (cleanUrl.includes("safelinks.protection.outlook.com")) {
        try {
          const safeUrl = new URL(cleanUrl);
          const innerEncoded = safeUrl.searchParams.get("url") || "";
          // Doble decodificacion porque SafeLinks hace doble encoding
          cleanUrl = decodeURIComponent(decodeURIComponent(innerEncoded));
        } catch(e) {
          try {
            const match = cleanUrl.match(/[?&]url=([^&]+)/);
            if (match) cleanUrl = decodeURIComponent(decodeURIComponent(match[1]));
          } catch(e2) {}
        }
      }
      // También decodificar si viene con %3A%2F%2F (URL encoded completa)
      if (cleanUrl.includes("%3A%2F%2F") || cleanUrl.includes("%3A%2f%2f")) {
        cleanUrl = decodeURIComponent(cleanUrl);
      }

      const url  = new URL(cleanUrl);
      const path = url.pathname + url.search;
      // Detectar ambiente según el host del token
      const dianHost = url.hostname.includes("-hab") ? DIAN_HOST_HAB : DIAN_HOST_PROD;

      // Usar modo browser para auth (simula navegador real que la DIAN espera)
      let result = await dianRequest(path, "", "GET", null, dianHost, true);
      let cookies = result.cookies;

      // Seguir hasta 8 redirects (la DIAN puede tener más pasos ahora)
      let redirects = 0;
      while ((result.statusCode === 301 || result.statusCode === 302 || result.statusCode === 303) && redirects < 8) {
        const loc = result.headers["location"] || "";
        const rPath = loc.startsWith("http") ? (new URL(loc)).pathname + (new URL(loc)).search : loc;
        cookies = mergeCookies(cookies, result.cookies);
        console.log(`Redirect ${redirects+1}: ${rPath} (status ${result.statusCode})`);
        result = await dianRequest(rPath, cookies, "GET", null, dianHost, true);
        redirects++;
      }
      console.log(`Auth final status: ${result.statusCode}`);
      console.log(`Cookies obtenidas: ${cookies?.slice(0,200)}`);
      console.log(`Body primeros 500: ${result.body?.slice(0,500)}`);
      console.log(`Headers: ${JSON.stringify(result.headers).slice(0,300)}`);
      cookies = mergeCookies(cookies, result.cookies);

      // Verificar que se obtuvo alguna cookie de sesión
      // La DIAN puede cambiar el nombre de la cookie — aceptar cualquier cookie válida
      const cookieNames = cookies ? cookies.split(';').map(c => c.split('=')[0].trim()) : [];
      const hasSession = cookies && (
        cookies.includes("ASP.NET_SessionId") ||
        cookies.includes(".AspNet") ||
        cookies.includes("_ga") ||
        cookies.includes("auth") ||
        cookieNames.length > 0
      );
      console.log("Cookies obtenidas:", cookieNames.join(", "));
      console.log("Status final:", result.statusCode);
      if (!cookies || result.statusCode === 401 || result.statusCode === 403) {
        return { statusCode: 401, headers, body: JSON.stringify({ 
          error: "No se obtuvo sesion. El token expiro o ya fue usado.",
          debug: { status: result.statusCode, cookies: cookies?.slice(0,100), body: result.body?.slice(0,300) }
        }) };
      }

      // Extraer __RequestVerificationToken de la última página cargada
      // (que es /Document/Received después de los redirects)
      // Así el frontend puede pasarlo directamente a "list" sin otra llamada
      const rvtMatch = result.body.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
      const rvt = rvtMatch ? rvtMatch[1] : "";

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cookies, dianHost, rvt, mensaje: "Sesion DIAN iniciada" }) };
    }

    // ── GET TOKEN (llamada separada para evitar timeout Netlify 26s) ─────────
    if (action === "get_token") {
      const { cookies, dianHost: dh } = body;
      const dianHost = dh || DIAN_HOST_PROD;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };
      const tokenInfo = await getVerificationToken(cookies, dianHost);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token: tokenInfo.token, cookies: tokenInfo.cookies }) };
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { cookies, desde, hasta, dianHost: dh, rvt: rvtPre } = body;
      const dianHost = dh || DIAN_HOST_PROD;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };

      const startDate = desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
      const endDate   = hasta || new Date().toISOString().slice(0, 10);

      // Si ya viene el token pre-obtenido usarlo, si no obtenerlo (compatibilidad)
      let rvt, newCookies;
      if (rvtPre) {
        rvt = rvtPre;
        newCookies = cookies;
      } else {
        const tokenInfo = await getVerificationToken(cookies, dianHost);
        rvt = tokenInfo.token;
        newCookies = tokenInfo.cookies;
      }

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

      const result = await dianRequest("/Document/GetDocumentsPageToken", newCookies, "POST", formBody, dianHost);
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
      const { cookies, trackId, dianHost: dh2 } = body;
      const dianHost2 = dh2 || DIAN_HOST_PROD;
      if (!cookies || !trackId) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + trackId, cookies, dianHost2);
      if (result.statusCode !== 200) return { statusCode: result.statusCode, headers, body: JSON.stringify({ error: "Error " + result.statusCode }) };
      const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
      if (!isZip) return { statusCode: 422, headers, body: JSON.stringify({ error: "Respuesta no es ZIP. Sesion expirada." }) };
      const xmlContent = extractXmlFromZip(result.rawBuffer);
      if (!xmlContent) return { statusCode: 422, headers, body: JSON.stringify({ error: "Sin XML en ZIP" }) };
      const xmlB64 = Buffer.from(xmlContent, "utf8").toString("base64");
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, xml: xmlB64, encoding: "base64", trackId, zipSize: result.rawBuffer.length }) };
    }

    // ── DOWNLOAD BATCH ────────────────────────────────────────────────────────
    if (action === "download_batch") {
      const { cookies, trackIds, dianHost: dh3 } = body;
      const dianHost3 = dh3 || DIAN_HOST_PROD;
      if (!cookies || !Array.isArray(trackIds)) return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackIds[] requeridos" }) };
      const CONCURRENCY = 3;
      const resultados = [], errores = [];
      // Límite de tiempo total: 22s para no superar los 26s de Netlify
      const tStart = Date.now();
      const TIME_LIMIT = 22000;
      for (let i = 0; i < trackIds.length; i += CONCURRENCY) {
        // Si ya llevamos más de 22s, detener y reportar los restantes como error
        if (Date.now() - tStart > TIME_LIMIT) {
          trackIds.slice(i).forEach(tid => errores.push({ trackId: tid, error: "Tiempo limite alcanzado - reintentar" }));
          break;
        }
        const lote = trackIds.slice(i, i + CONCURRENCY);
        await Promise.all(lote.map(async (trackId) => {
          try {
            const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + trackId, cookies, dianHost3);
            if (result.statusCode !== 200) throw new Error("HTTP " + result.statusCode);
            const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
            if (!isZip) throw new Error("No es ZIP");
            const xmlContent = extractXmlFromZip(result.rawBuffer);
            if (!xmlContent) throw new Error("Sin XML");
            const xmlB64 = Buffer.from(xmlContent, "utf8").toString("base64");
            resultados.push({ trackId, xml: xmlB64, encoding: "base64", zipSize: result.rawBuffer.length });
          } catch(e) { errores.push({ trackId, error: e.message }); }
        }));
        if (i + CONCURRENCY < trackIds.length) await new Promise(r => setTimeout(r, 300));
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, resultados, errores, total: trackIds.length, exitosos: resultados.length }) };
    }


    // ── DOWNLOAD PDF BATCH ────────────────────────────────────────────────────
    if (action === "download_pdfs") {
      const { cookies, facturas } = body;
      if (!cookies || !Array.isArray(facturas)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y facturas[] requeridos" }) };
      }

      // Ordenar por fecha + prefijo+numero
      const ordenadas = [...facturas].sort((a, b) => {
        const fa = (a.fecha || "") + (a.prefijo || "") + (a.nroDocumento || "");
        const fb = (b.fecha || "") + (b.prefijo || "") + (b.nroDocumento || "");
        return fa.localeCompare(fb);
      });

      const CONCURRENCY = 3;
      const resultados = [], errores = [];

      for (let i = 0; i < ordenadas.length; i += CONCURRENCY) {
        const lote = ordenadas.slice(i, i + CONCURRENCY);
        await Promise.all(lote.map(async (f) => {
          try {
            const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + f.trackId, cookies);
            if (result.statusCode !== 200) throw new Error("HTTP " + result.statusCode);

            // Extraer PDF del ZIP
            const pdfData = extractPdfFromZip(result.rawBuffer);
            if (!pdfData) throw new Error("Sin PDF en ZIP");

            // Nombre ordenado: fecha_emisor_prefijo+numero.pdf
            const emisorLimpio = (f.emisor || "desconocido")
              .replace(/[^a-zA-Z0-9À-ɏ]/g, "_")
              .replace(/_+/g, "_")
              .substring(0, 30)
              .toUpperCase();
            const nombre = `${f.fecha || "0000-00-00"}_${emisorLimpio}_${(f.prefijo || "") + (f.nroDocumento || "")}.pdf`;

            // Enviar PDF como base64
            const pdfB64 = pdfData.toString("base64");
            resultados.push({ trackId: f.trackId, nombre, pdf: pdfB64, size: pdfData.length });
          } catch(e) {
            errores.push({ trackId: f.trackId, emisor: f.emisor, error: e.message });
          }
        }));
        if (i + CONCURRENCY < ordenadas.length) await new Promise(r => setTimeout(r, 400));
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, resultados, errores, total: ordenadas.length, exitosos: resultados.length }),
      };
    }


    // ── DOWNLOAD PDF SINGLE ───────────────────────────────────────────────────
    if (action === "download_pdf_single") {
      const { cookies, trackId } = body;
      if (!cookies || !trackId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      }
      const result = await dianDownloadBinary("/Document/DownloadZipFiles?trackId=" + trackId, cookies);
      if (result.statusCode !== 200) {
        return { statusCode: result.statusCode, headers, body: JSON.stringify({ error: "HTTP " + result.statusCode }) };
      }
      const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
      if (!isZip) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: "No es ZIP - sesion expirada" }) };
      }
      const pdfData = extractPdfFromZip(result.rawBuffer);
      if (!pdfData) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: "Sin PDF en ZIP" }) };
      }
      const pdfB64 = pdfData.toString("base64");
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pdf: pdfB64, trackId }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Accion desconocida: " + action }) };

  } catch(err) {
    console.error("[dian-proxy] Error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno" }) };
  }
};
