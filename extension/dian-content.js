// ─────────────────────────────────────────────────────────────────────────────
// dian-content.js — Se inyecta EN la página del portal DIAN
//
// Estrategia corregida:
//   - Primera descarga: usa el token que YA existe (sin reset, sin esperar)
//   - Descargas siguientes: el token cambió porque se consumió, espera el nuevo
//   - El reset se hace solo si después de descargar el token NO cambió solo
// ─────────────────────────────────────────────────────────────────────────────

function obtenerTurnstileValue() {
  const input = document.querySelector('input[name="cf-turnstile-response"]');
  return input ? input.value : "";
}

function resetTurnstile() {
  try {
    if (window.turnstile && typeof window.turnstile.reset === "function") {
      window.turnstile.reset();
      return true;
    }
  } catch(e) {}
  return false;
}

// Esperar a que el token sea distinto del que ya usamos
function esperarTokenDistinto(tokenUsado, maxMs = 12000) {
  return new Promise((resolve) => {
    const yaHay = obtenerTurnstileValue();
    if (yaHay && yaHay !== tokenUsado) return resolve(yaHay);

    const inicio = Date.now();
    const input = document.querySelector('input[name="cf-turnstile-response"]');

    let resuelto = false;
    const fin = (v) => {
      if (resuelto) return;
      resuelto = true;
      if (obs) obs.disconnect();
      clearInterval(poll);
      resolve(v);
    };

    let obs = null;
    if (input) {
      obs = new MutationObserver(() => {
        const v = obtenerTurnstileValue();
        if (v && v !== tokenUsado) fin(v);
      });
      obs.observe(input, { attributes: true, attributeFilter: ["value"] });
    }

    const poll = setInterval(() => {
      const v = obtenerTurnstileValue();
      if (v && v !== tokenUsado) fin(v);
      else if (Date.now() - inicio > maxMs) fin(v || tokenUsado);
      // A mitad de camino, forzar reset si no cambió solo
      else if (Date.now() - inicio > 3000) resetTurnstile();
    }, 300);
  });
}

let _tokenUsado = "";

async function descargarXmlConCaptcha(trackId) {
  // Determinar qué token usar
  let turnstileValue = obtenerTurnstileValue();

  // Si el token actual es el mismo que ya usamos antes, esperar uno nuevo
  if (_tokenUsado && turnstileValue === _tokenUsado) {
    turnstileValue = await esperarTokenDistinto(_tokenUsado);
  }

  if (!turnstileValue) {
    throw new Error("Captcha no disponible — recarga la página del portal DIAN");
  }

  const url = `/Document/DownloadZipFiles?trackId=${trackId}&captcha=${encodeURIComponent(turnstileValue)}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "*/*" },
  });

  // Marcar este token como usado
  _tokenUsado = turnstileValue;

  if (!res.ok) throw new Error("HTTP " + res.status);

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const texto = new TextDecoder().decode(bytes.slice(0, 200));
    if (texto.includes("<?xml") || texto.includes("<Invoice") || texto.includes("<AttachedDocument")) {
      return { tipo: "xml", contenido: new TextDecoder().decode(bytes) };
    }
    throw new Error("Captcha rechazado (HTTP " + res.status + ")");
  }

  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunk));
  }
  return { tipo: "zip", contenido: btoa(binary) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "PING_DIAN") {
        sendResponse({ ok: true, enDian: true, captchaDisponible: !!obtenerTurnstileValue() });
      }
      else if (msg.tipo === "DESCARGAR_EN_DIAN") {
        const result = await descargarXmlConCaptcha(msg.trackId);
        sendResponse({ ok: true, ...result });
      }
      else if (msg.tipo === "RESET_TOKEN") {
        _tokenUsado = "";
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

console.log("[ContaIA DIAN] Listo. Captcha inicial presente:", !!obtenerTurnstileValue());
