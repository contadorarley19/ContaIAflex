// ─────────────────────────────────────────────────────────────────────────────
// dian-content.js — Se inyecta EN la página del portal DIAN
//
// Tiene acceso al input cf-turnstile-response que contiene el token captcha.
// Hace las descargas usando ese token, igual que el portal lo hace.
// ─────────────────────────────────────────────────────────────────────────────

// Leer el token Turnstile del input oculto de la página
function obtenerTurnstileValue() {
  const input = document.querySelector('input[name="cf-turnstile-response"]');
  return input ? input.value : "";
}

// Descargar XML usando el token captcha (igual que el portal en la línea 1569)
async function descargarXmlConCaptcha(trackId) {
  const turnstileValue = obtenerTurnstileValue();
  if (!turnstileValue) {
    throw new Error("Captcha no disponible — recarga la página del portal DIAN");
  }

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
    throw new Error("No es ZIP (captcha inválido o expirado)");
  }

  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunk));
  }
  return { tipo: "zip", contenido: btoa(binary) };
}

// Listener de mensajes desde el background
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
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

console.log("[ContaIA DIAN] Listo en el portal DIAN. Captcha:", !!obtenerTurnstileValue());
