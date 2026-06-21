// ─────────────────────────────────────────────────────────────────────────────
// dian-main.js — Corre en el MUNDO MAIN de la página DIAN
//
// Solo este contexto ve window.turnstile (confirmado en el portal real).
// Hace el trabajo con Turnstile y la descarga, y se comunica con el content
// script aislado (dian-content.js) por window.postMessage.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  // widgetId limpio (el elemento del DOM termina en _response; la API lo quiere sin él)
  function obtenerWidgetId() {
    const el = document.querySelector('[id^="cf-chl-widget-"]');
    return el && el.id ? el.id.replace("_response", "") : null;
  }

  function obtenerToken() {
    const wid = obtenerWidgetId();
    if (wid && window.turnstile && typeof window.turnstile.getResponse === "function") {
      try {
        const v = window.turnstile.getResponse(wid);
        if (v) return v;
      } catch (e) {}
    }
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : "";
  }

  function tokenExpirado() {
    const wid = obtenerWidgetId();
    if (wid && window.turnstile && typeof window.turnstile.isExpired === "function") {
      try { return window.turnstile.isExpired(wid); } catch (e) {}
    }
    return false;
  }

  function resetTurnstile() {
    const wid = obtenerWidgetId();
    if (wid && window.turnstile && typeof window.turnstile.reset === "function") {
      try { window.turnstile.reset(wid); return true; } catch (e) {}
    }
    return false;
  }

  // Esperar token nuevo (distinto al usado) y no expirado
  function esperarTokenFresco(tokenUsado, maxMs = 15000) {
    return new Promise((resolve) => {
      const inicio = Date.now();
      let reseteado = false;

      const fresco = () => {
        const v = obtenerToken();
        return (v && v !== tokenUsado && !tokenExpirado()) ? v : null;
      };

      const ya = fresco();
      if (ya) return resolve(ya);

      resetTurnstile(); reseteado = true;

      const poll = setInterval(() => {
        const v = fresco();
        if (v) { clearInterval(poll); resolve(v); }
        else if (Date.now() - inicio > maxMs) {
          clearInterval(poll);
          resolve(obtenerToken() || tokenUsado);
        } else if (Date.now() - inicio > 4000) {
          resetTurnstile();
        }
      }, 250);
    });
  }

  let _tokenUsado = "";

  async function descargar(trackId) {
    let token = obtenerToken();
    if (!token || token === _tokenUsado || tokenExpirado()) {
      token = await esperarTokenFresco(_tokenUsado);
    }
    if (!token) throw new Error("Captcha no disponible — recarga la página del portal DIAN");

    const url = `/Document/DownloadZipFiles?trackId=${trackId}&captcha=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method: "GET", credentials: "include", headers: { "Accept": "*/*" } });

    _tokenUsado = token;
    resetTurnstile(); // regenerar para la próxima

    if (!res.ok) throw new Error("HTTP " + res.status);

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      const txt = new TextDecoder().decode(bytes.slice(0, 200));
      if (txt.includes("<?xml") || txt.includes("<Invoice") || txt.includes("<AttachedDocument")) {
        return { tipo: "xml", contenido: new TextDecoder().decode(bytes) };
      }
      throw new Error("Captcha rechazado (HTTP " + res.status + ")");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
    }
    return { tipo: "zip", contenido: btoa(binary) };
  }

  // Puente con el content script aislado
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "DIAN_CONTENT") return;

    const responder = (payload) => window.postMessage({ source: "DIAN_MAIN", id: d.id, ...payload }, "*");

    try {
      if (d.tipo === "PING_DIAN") {
        responder({ ok: true, enDian: true, captchaDisponible: !!obtenerToken(), widgetId: obtenerWidgetId() });
      } else if (d.tipo === "DESCARGAR_EN_DIAN") {
        const r = await descargar(d.trackId);
        responder({ ok: true, ...r });
      } else if (d.tipo === "RESET_TOKEN") {
        _tokenUsado = ""; resetTurnstile();
        responder({ ok: true });
      }
    } catch (e) {
      responder({ ok: false, error: e.message });
    }
  });

  console.log("[ContaIA DIAN main] Listo. widgetId:", obtenerWidgetId(), "| token:", !!obtenerToken());
})();
