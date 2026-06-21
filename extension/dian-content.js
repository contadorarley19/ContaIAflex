// ─────────────────────────────────────────────────────────────────────────────
// dian-content.js — Se inyecta EN la página del portal DIAN
//
// El token Turnstile (captcha) es de UN SOLO USO. Después de cada descarga
// hay que esperar a que Cloudflare regenere uno nuevo en el input oculto.
// ─────────────────────────────────────────────────────────────────────────────

function obtenerTurnstileValue() {
  const input = document.querySelector('input[name="cf-turnstile-response"]');
  return input ? input.value : "";
}

// Forzar la regeneración del token Turnstile
function resetTurnstile() {
  try {
    if (window.turnstile && typeof window.turnstile.reset === "function") {
      window.turnstile.reset();
      return true;
    }
  } catch(e) {}
  return false;
}

// Esperar a que haya un token Turnstile NUEVO (distinto del anterior)
async function esperarNuevoToken(tokenAnterior, maxEsperaMs = 15000) {
  const inicio = Date.now();
  // Intentar resetear para forzar nuevo token
  resetTurnstile();
  while (Date.now() - inicio < maxEsperaMs) {
    const actual = obtenerTurnstileValue();
    if (actual && actual !== tokenAnterior) {
      return actual;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  // Si no se regeneró, devolver el que haya (puede que el mismo siga válido)
  return obtenerTurnstileValue();
}

let _ultimoToken = "";

async function descargarXmlConCaptcha(trackId) {
  // Obtener un token nuevo (distinto al usado en la descarga anterior)
  let turnstileValue;
  if (_ultimoToken) {
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
      return { tipo: "xml", contenido: new TextDecoder().decode(bytes) };
    }
    throw new Error("Captcha expirado o inválido");
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

console.log("[ContaIA DIAN] Listo en portal DIAN. Captcha:", !!obtenerTurnstileValue());
