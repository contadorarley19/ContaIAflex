// ─────────────────────────────────────────────────────────────────────────────
// dian-content.js — Se inyecta EN la página del portal DIAN
//
// Estrategia optimizada para el Turnstile de un solo uso:
//   1. Capturar el token actual y descargar inmediatamente
//   2. Apenas se usa, forzar reset() del widget para regenerar
//   3. Polling rápido (cada 200ms) para detectar el nuevo token apenas aparece
//   4. Observer del input para reaccionar al instante cuando cambia el valor
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

// Esperar a que el input tenga un token NUEVO usando MutationObserver (instantáneo)
function esperarNuevoToken(tokenAnterior, maxEsperaMs = 12000) {
  return new Promise((resolve) => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');

    // Si ya hay uno nuevo, devolverlo de inmediato
    const actual = obtenerTurnstileValue();
    if (actual && actual !== tokenAnterior) return resolve(actual);

    let resuelto = false;
    const finalizar = (val) => {
      if (resuelto) return;
      resuelto = true;
      if (observer) observer.disconnect();
      clearInterval(poller);
      clearTimeout(timeout);
      resolve(val);
    };

    // Observer: reacciona apenas el input cambia de valor
    let observer = null;
    if (input) {
      observer = new MutationObserver(() => {
        const v = obtenerTurnstileValue();
        if (v && v !== tokenAnterior) finalizar(v);
      });
      observer.observe(input, { attributes: true, attributeFilter: ["value"] });
    }

    // Poller de respaldo cada 200ms (algunos cambios de value no disparan mutación)
    const poller = setInterval(() => {
      const v = obtenerTurnstileValue();
      if (v && v !== tokenAnterior) finalizar(v);
    }, 200);

    // Timeout: si no se regeneró, devolver lo que haya
    const timeout = setTimeout(() => finalizar(obtenerTurnstileValue()), maxEsperaMs);

    // Forzar regeneración
    resetTurnstile();
  });
}

let _ultimoToken = "";

async function descargarXmlConCaptcha(trackId) {
  let turnstileValue;
  if (_ultimoToken) {
    // Esperar token nuevo (rápido gracias al observer)
    turnstileValue = await esperarNuevoToken(_ultimoToken);
  } else {
    turnstileValue = obtenerTurnstileValue();
  }

  if (!turnstileValue) {
    throw new Error("Captcha no disponible — recarga la página del portal DIAN");
  }
  _ultimoToken = turnstileValue;

  const url = `/Document/DownloadZipFiles?trackId=${trackId}&captcha=${encodeURIComponent(turnstileValue)}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "*/*" },
  });

  if (!res.ok) throw new Error("HTTP " + res.status);

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const texto = new TextDecoder().decode(bytes.slice(0, 200));
    if (texto.includes("<?xml") || texto.includes("<Invoice") || texto.includes("<AttachedDocument")) {
      // Inmediatamente forzar regeneración para la siguiente
      resetTurnstile();
      return { tipo: "xml", contenido: new TextDecoder().decode(bytes) };
    }
    throw new Error("Captcha expirado o inválido");
  }

  // Forzar regeneración del token para la siguiente descarga
  resetTurnstile();

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
        _ultimoToken = "";
        resetTurnstile();
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

console.log("[ContaIA DIAN] Listo en portal DIAN. Captcha inicial:", !!obtenerTurnstileValue());
