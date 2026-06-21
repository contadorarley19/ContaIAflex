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

  // ── LISTADO de facturas (corre en la página → pasa Cloudflare) ──
  async function getVerificationToken() {
    const res = await fetch("/Document/Received", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const html = await res.text();
    const m = html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/);
    return m ? m[1] : "";
  }

  async function listarFacturas(desde, hasta) {
    const rvt = await getVerificationToken();
    if (!rvt) throw new Error("No se pudo obtener el token. ¿Estás logueado en la DIAN?");

    const formBody = [
      "draw=1", "start=0", "length=500",
      "DocumentKey=", "SerieAndNumber=", "SenderCode=", "ReceiverCode=",
      "StartDate=" + encodeURIComponent(desde),
      "EndDate=" + encodeURIComponent(hasta),
      "DocumentTypeId=00", "Status=0", "IsNextPage=false",
      "FilterType=3", "blockIndex=0", "RadianStatus=0",
      "__RequestVerificationToken=" + encodeURIComponent(rvt),
    ].join("&");

    const res = await fetch("/Document/GetDocumentsPageToken", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
      },
      body: formBody,
    });

    const text = await res.text();
    if (text.trim().startsWith("<")) {
      throw new Error("La DIAN pidió verificación. Recarga el portal y reintenta.");
    }
    const data = JSON.parse(text);

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

  // Puente con el content script aislado
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "DIAN_CONTENT") return;

    const responder = (payload) => window.postMessage({ source: "DIAN_MAIN", id: d.id, ...payload }, "*");

    try {
      if (d.tipo === "PING_DIAN") {
        responder({ ok: true, enDian: true, captchaDisponible: !!obtenerToken(), widgetId: obtenerWidgetId() });
      } else if (d.tipo === "LISTAR") {
        const facturas = await listarFacturas(d.desde, d.hasta);
        responder({ ok: true, facturas });
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
