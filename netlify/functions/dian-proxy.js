// netlify/functions/dian-proxy.js
// ─────────────────────────────────────────────────────────────────────────────
// Proxy seguro para el portal DIAN catalogo-vpfe.dian.gov.co
// Endpoints que maneja:
//   POST /dian-proxy  { action: "auth",     tokenUrl: "https://..." }
//   POST /dian-proxy  { action: "list",     cookies: "...", desde: "2026-01-01", hasta: "2026-05-28" }
//   POST /dian-proxy  { action: "download", cookies: "...", trackId: "abc123..." }
// ─────────────────────────────────────────────────────────────────────────────

const https = require("https");
const zlib  = require("zlib");

const DIAN_HOST = "catalogo-vpfe.dian.gov.co";

// ── Hacer request HTTPS a la DIAN ────────────────────────────────────────────
function dianRequest(path, cookies, method = "GET", followRedirects = 5) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DIAN_HOST,
      port: 443,
      path,
      method,
      headers: {
        "Cookie":          cookies || "",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer":         `https://${DIAN_HOST}/`,
        "Sec-Fetch-Dest":  "document",
        "Sec-Fetch-Mode":  "navigate",
        "Sec-Fetch-Site":  "same-origin",
        "Upgrade-Insecure-Requests": "1",
      },
    };

    const req = https.request(options, (res) => {
      // Capturar cookies de la respuesta
      const setCookies = res.headers["set-cookie"] || [];
      const newCookies = setCookies.map(c => c.split(";")[0]).join("; ");

      // Manejar redireccionamientos
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) && followRedirects > 0) {
        const location = res.headers["location"] || "";
        const redirectPath = location.startsWith("http")
          ? new URL(location).pathname + new URL(location).search
          : location;
        const mergedCookies = mergeCookies(cookies, newCookies);
        return dianRequest(redirectPath, mergedCookies, "GET", followRedirects - 1)
          .then(result => resolve({ ...result, cookies: mergeCookies(mergedCookies, result.cookies) }))
          .catch(reject);
      }

      // Leer body con soporte gzip
      const chunks = [];
      const stream = res.headers["content-encoding"] === "gzip"
        ? res.pipe(zlib.createGunzip())
        : res;

      stream.on("data", chunk => chunks.push(chunk));
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode,
          headers:    res.headers,
          cookies:    newCookies,
          body,
          rawBuffer:  Buffer.concat(chunks),
        });
      });
      stream.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Timeout conectando a la DIAN")); });
    req.end();
  });
}

// Para descargar binarios (ZIP)
function dianDownloadBinary(path, cookies) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DIAN_HOST,
      port: 443,
      path,
      method: "GET",
      headers: {
        "Cookie":          cookies || "",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":          "application/zip,application/octet-stream,*/*",
        "Referer":         `https://${DIAN_HOST}/Document/Received`,
        "Sec-Fetch-Dest":  "document",
        "Sec-Fetch-Mode":  "navigate",
        "Sec-Fetch-Site":  "same-origin",
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode:  res.statusCode,
          headers:     res.headers,
          rawBuffer:   Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "",
        });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Timeout descargando ZIP")); });
    req.end();
  });
}

// ── Merge cookies (evitar duplicados) ────────────────────────────────────────
function mergeCookies(existing, incoming) {
  if (!incoming) return existing || "";
  if (!existing)  return incoming;
  const map = {};
  [...existing.split(";"), ...incoming.split(";")]
    .map(c => c.trim())
    .filter(Boolean)
    .forEach(c => {
      const [k, ...v] = c.split("=");
      if (k.trim()) map[k.trim()] = v.join("=");
    });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Extraer XML de un buffer ZIP ─────────────────────────────────────────────
// El ZIP de la DIAN contiene: {CUFE}.xml y {CUFE}.pdf (o .html)
// Usamos un parser manual simple para ZIPs (sin dependencias externas)
function extractXmlFromZip(buffer) {
  try {
    // Buscar Local File Header signatures (PK\x03\x04)
    const PK_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const files  = [];
    let pos      = 0;

    while (pos < buffer.length - 4) {
      const idx = buffer.indexOf(PK_SIG, pos);
      if (idx === -1) break;

      // Leer cabecera del archivo local
      const compressionMethod = buffer.readUInt16LE(idx + 8);
      const compressedSize    = buffer.readUInt32LE(idx + 18);
      const filenameLength    = buffer.readUInt16LE(idx + 26);
      const extraLength       = buffer.readUInt16LE(idx + 28);
      const filename          = buffer.slice(idx + 30, idx + 30 + filenameLength).toString("utf8");
      const dataStart         = idx + 30 + filenameLength + extraLength;
      const compressedData    = buffer.slice(dataStart, dataStart + compressedSize);

      if (filename.toLowerCase().endsWith(".xml") || filename.toLowerCase().endsWith(".html")) {
        try {
          let content;
          if (compressionMethod === 0) {
            // Sin compresión
            content = compressedData.toString("utf8");
          } else if (compressionMethod === 8) {
            // DEFLATE
            content = zlib.inflateRawSync(compressedData).toString("utf8");
          }
          if (content) files.push({ filename, content });
        } catch (e) {
          // Continuar con el siguiente archivo
        }
      }

      pos = dataStart + compressedSize;
    }

    // Preferir .xml sobre .html
    const xml = files.find(f => f.filename.toLowerCase().endsWith(".xml"));
    if (xml) return xml.content;
    const html = files.find(f => f.filename.toLowerCase().endsWith(".html"));
    if (html) return html.content;
    return null;
  } catch (e) {
    return null;
  }
}

// ── Parsear lista de facturas desde el HTML del portal ───────────────────────
function parseFacturasList(html) {
  const facturas = [];
  if (!html) return facturas;

  // El portal renderiza una tabla con los documentos
  // Buscamos los trackId / CUFE en los links de descarga
  const downloadRegex = /DownloadZipFiles\?trackId=([a-f0-9]+)/gi;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

  let match;
  const trackIds = new Set();

  // Extraer todos los trackIds únicos
  while ((match = downloadRegex.exec(html)) !== null) {
    trackIds.add(match[1]);
  }

  // Intentar extraer datos de las filas de la tabla
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(row => {
    // Saltar cabecera
    if (row.includes("<th")) return;

    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length < 5) return;

    const getText = td => td.replace(/<[^>]+>/g, "").trim();

    // Intentar extraer trackId de esta fila
    const trackMatch = row.match(/DownloadZipFiles\?trackId=([a-f0-9]+)/i);
    if (!trackMatch) return;

    const trackId     = trackMatch[1];
    const fechaRec    = getText(cells[1] || "") || "";
    const fecha       = getText(cells[2] || "") || "";
    const prefijo     = getText(cells[3] || "") || "";
    const nroDoc      = getText(cells[4] || "") || "";
    const tipo        = getText(cells[5] || "") || "";
    const nitEmisor   = getText(cells[6] || "") || "";
    const emisor      = getText(cells[7] || "") || "";
    const resultado   = getText(cells[9] || "") || "";
    const valorText   = getText(cells[cells.length - 1] || "") || "0";
    const valor       = parseInt(valorText.replace(/[^0-9]/g, "")) || 0;

    facturas.push({
      trackId,
      fechaRecepcion: fechaRec,
      fecha,
      prefijo,
      nroDocumento: nroDoc,
      tipo,
      nitEmisor: nitEmisor.replace(/[^0-9]/g, ""),
      emisor,
      resultado,
      valor,
    });
  });

  // Si no se parsearon filas pero sí hay trackIds, crear entradas mínimas
  if (facturas.length === 0 && trackIds.size > 0) {
    trackIds.forEach(trackId => {
      facturas.push({ trackId, prefijo: "", fecha: "", nitEmisor: "", emisor: "", valor: 0 });
    });
  }

  return facturas;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { action } = body;

  try {
    // ── ACCIÓN: AUTH ─────────────────────────────────────────────────────────
    if (action === "auth") {
      const { tokenUrl } = body;
      if (!tokenUrl || !tokenUrl.includes("catalogo-vpfe.dian.gov.co")) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "URL de token inválida" }) };
      }

      // Extraer el path de la URL
      const url      = new URL(tokenUrl);
      const path     = url.pathname + url.search;

      // Hacer la petición de autenticación
      const result   = await dianRequest(path, "", "GET");

      if (result.statusCode !== 200 && result.statusCode !== 302) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: `DIAN respondió ${result.statusCode}. El token puede haber expirado.` }) };
      }

      const cookies = result.cookies;
      if (!cookies || !cookies.includes("ASP.NET_SessionId")) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "No se obtuvo sesión. El token expiró o ya fue usado." }) };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, cookies, mensaje: "Sesión DIAN iniciada correctamente" }),
      };
    }

    // ── ACCIÓN: LIST ──────────────────────────────────────────────────────────
    if (action === "list") {
      const { cookies, desde, hasta } = body;
      if (!cookies) return { statusCode: 400, headers, body: JSON.stringify({ error: "Cookies requeridas" }) };

      // Construir query string con rango de fechas
      const params = new URLSearchParams({
        fechaInicio: desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        fechaFin:    hasta || new Date().toISOString().slice(0, 10),
      });

      const result = await dianRequest(`/Document/Received?${params}`, cookies);

      if (result.statusCode === 401 || result.statusCode === 302) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Sesión expirada. Solicita un nuevo token." }) };
      }

      const facturas = parseFacturasList(result.body);
      const newCookies = mergeCookies(cookies, result.cookies);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, facturas, total: facturas.length, cookies: newCookies }),
      };
    }

    // ── ACCIÓN: DOWNLOAD ─────────────────────────────────────────────────────
    if (action === "download") {
      const { cookies, trackId } = body;
      if (!cookies || !trackId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackId requeridos" }) };
      }

      const result = await dianDownloadBinary(`/Document/DownloadZipFiles?trackId=${trackId}`, cookies);

      if (result.statusCode !== 200) {
        return { statusCode: result.statusCode, headers, body: JSON.stringify({ error: `Error descargando ZIP: ${result.statusCode}` }) };
      }

      // Verificar que sea un ZIP real
      const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
      if (!isZip) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: "La respuesta no es un ZIP válido. Sesión puede haber expirado." }) };
      }

      // Extraer XML del ZIP
      const xmlContent = extractXmlFromZip(result.rawBuffer);
      if (!xmlContent) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: "No se encontró XML dentro del ZIP" }) };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, xml: xmlContent, trackId, zipSize: result.rawBuffer.length }),
      };
    }

    // ── ACCIÓN: DOWNLOAD_BATCH ────────────────────────────────────────────────
    // Descarga múltiples facturas en paralelo (máx 5 simultáneas)
    if (action === "download_batch") {
      const { cookies, trackIds } = body;
      if (!cookies || !Array.isArray(trackIds) || trackIds.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "cookies y trackIds[] requeridos" }) };
      }

      const CONCURRENCY = 5;
      const resultados  = [];
      const errores     = [];

      // Procesar en lotes de CONCURRENCY
      for (let i = 0; i < trackIds.length; i += CONCURRENCY) {
        const lote    = trackIds.slice(i, i + CONCURRENCY);
        const promesas = lote.map(async (trackId) => {
          try {
            const result = await dianDownloadBinary(`/Document/DownloadZipFiles?trackId=${trackId}`, cookies);
            if (result.statusCode !== 200) throw new Error(`HTTP ${result.statusCode}`);
            const isZip = result.rawBuffer[0] === 0x50 && result.rawBuffer[1] === 0x4b;
            if (!isZip) throw new Error("Respuesta no es ZIP");
            const xmlContent = extractXmlFromZip(result.rawBuffer);
            if (!xmlContent) throw new Error("Sin XML en ZIP");
            resultados.push({ trackId, xml: xmlContent, zipSize: result.rawBuffer.length });
          } catch (e) {
            errores.push({ trackId, error: e.message });
          }
        });
        await Promise.all(promesas);
        // Pequeña pausa entre lotes para no sobrecargar el servidor DIAN
        if (i + CONCURRENCY < trackIds.length) await new Promise(r => setTimeout(r, 500));
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, resultados, errores, total: trackIds.length, exitosos: resultados.length }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Acción desconocida: ${action}` }) };

  } catch (err) {
    console.error("[dian-proxy] Error:", err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: err.message || "Error interno del servidor" }),
    };
  }
};
