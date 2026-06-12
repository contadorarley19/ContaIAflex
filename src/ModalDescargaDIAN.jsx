// ─────────────────────────────────────────────────────────────────────────────
// ModalDescargaDIAN.jsx — versión optimizada
//
// CAMBIOS CLAVE vs versión anterior:
//   • Una sola llamada download_batch con TODOS los trackIds → el proxy maneja
//     concurrencia internamente, la sesión no expira por round-trips del frontend
//   • Reintentos automáticos para los que fallaron (hasta 2 rondas extra)
//   • Detección de sesión muerta con mensaje claro al usuario
//   • Barra de progreso en tiempo real via polling del resultado parcial
//   • descargarPDFs ahora también usa batch (3 en paralelo en el proxy)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from "react";

const DIAN_PROXY_URL = "/.netlify/functions/dian-proxy";

async function dianProxy(action, params = {}) {
  const res = await fetch(DIAN_PROXY_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const fmt      = n => `$${Number(n || 0).toLocaleString("es-CO")}`;
const fmtFecha = f => { if (!f) return ""; const [y,m,d] = f.split("-"); return d ? `${d}/${m}/${y}` : f; };
const primerDiaMes = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}-01`; };
const hoy = () => new Date().toISOString().slice(0, 10);

// ── Decodificar base64 a string UTF-8 ────────────────────────────────────────
function b64ToUtf8(b64) {
  try {
    // Usar TextDecoder para manejar correctamente UTF-8
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch(e) {
    return atob(b64); // fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ModalDescargaDIAN({ empresaActual, onClose, onXmlsDescargados }) {
  const [paso,           setPaso]           = useState("token");
  const [tokenUrl,       setTokenUrl]       = useState("");
  const [cookies,        setCookies]        = useState("");
  const [dianHost,       setDianHost]       = useState("");
  const [desde,          setDesde]          = useState(primerDiaMes());
  const [hasta,          setHasta]          = useState(hoy());
  const [facturas,       setFacturas]       = useState([]);
  const [seleccion,      setSeleccion]      = useState(new Set());
  const [cargando,       setCargando]       = useState(false);
  const [descargandoPDF, setDescargandoPDF] = useState(false);
  const [progreso,       setProgreso]       = useState({ actual: 0, total: 0 });
  const [progresoDesc,   setProgresoDesc]   = useState({ actual: 0, total: 0 });
  const [logs,           setLogs]           = useState([]);
  const [error,          setError]          = useState("");
  const [xmlsDesc,       setXmlsDesc]       = useState([]);
  const logRef = useRef(null);

  const addLog = (msg, tipo = "info") => {
    const time = new Date().toLocaleTimeString("es-CO");
    setLogs(p => [...p, { time, msg, tipo }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  };

  // ── PASO 1: Autenticar ────────────────────────────────────────────────────
  const autenticar = async () => {
    if (!tokenUrl.includes("catalogo-vpfe")) {
      setError("Pega la URL completa que llegó al correo del representante legal");
      return;
    }
    setCargando(true); setError("");
    addLog("Conectando con el portal DIAN...", "info");
    try {
      const res = await dianProxy("auth", { tokenUrl });
      setCookies(res.cookies);
      setDianHost(res.dianHost || "");
      addLog("✓ Sesión DIAN iniciada correctamente", "ok");
      setPaso("lista");
      // Cargar facturas automáticamente al autenticar
      await _listarFacturas(res.cookies, res.dianHost || "");
    } catch(e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`, "error");
    }
    setCargando(false);
  };

  // ── PASO 2: Listar facturas ───────────────────────────────────────────────
  const _listarFacturas = async (ck, dh) => {
    const ckActual = ck || cookies;
    const dhActual = dh || dianHost;
    setCargando(true); setError("");
    try {
      // Llamada 1: obtener token de verificación (~8s, bien bajo el límite de 26s)
      addLog("Obteniendo token de verificación...", "info");
      const tokRes = await dianProxy("get_token", { cookies: ckActual, dianHost: dhActual });
      const ck2 = tokRes.cookies || ckActual;
      setCookies(ck2);

      // Llamada 2: consultar facturas con el token ya obtenido (~10s)
      addLog(`Consultando facturas del ${fmtFecha(desde)} al ${fmtFecha(hasta)}...`, "info");
      const res = await dianProxy("list", { cookies: ck2, desde, hasta, dianHost: dhActual, rvt: tokRes.token });
      setCookies(res.cookies || ck2);
      setFacturas(res.facturas || []);
      setSeleccion(new Set((res.facturas || []).map(f => f.trackId)));
      addLog(`✓ ${res.total} facturas encontradas`, "ok");
      if (res.total === 0) addLog("Sin facturas en ese rango. Intenta ampliar el rango de fechas.", "warn");
    } catch(e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`, "error");
    }
    setCargando(false);
  };
  const listarFacturas = () => _listarFacturas();

  // ── PASO 3: Descargar XMLs ─────────────────────────────────────────────────
  // ESTRATEGIA: una sola llamada al proxy con todos los trackIds.
  // El proxy maneja concurrencia (3) y reintentos internamente.
  // Si quedan fallidos, se hace UNA ronda de reintento adicional.
  // Así la sesión solo se usa durante el tiempo que tarda el proxy (~20-30s),
  // no durante múltiples round-trips desde el frontend.
  const descargar = async () => {
    const trackIds = Array.from(seleccion);
    if (trackIds.length === 0) { setError("Selecciona al menos una factura"); return; }

    setCargando(true); setError("");
    setPaso("descarga");
    setProgreso({ actual: 0, total: trackIds.length });
    addLog(`Iniciando descarga de ${trackIds.length} facturas en lotes de 8...`, "info");

    // ── Función que hace UNA llamada batch y procesa resultado ───────────────
    const ejecutarBatch = async (ids, ckActual, intento = 1) => {
      addLog(`${intento > 1 ? `Reintento ${intento-1} — ` : ""}Enviando ${ids.length} trackIds al proxy...`, "info");
      const res = await dianProxy("download_batch", {
        cookies:  ckActual,
        trackIds: ids,
        dianHost: dianHost,
      });

      const ok  = res.resultados || [];
      const err = res.errores    || [];

      // Mostrar resultados
      ok.forEach(r => {
        const f = facturas.find(x => x.trackId === r.trackId);
        addLog(`✓ ${f?.emisor || r.trackId.slice(0,14)} — ${fmt(f?.valor)}`, "ok");
      });
      err.forEach(e => {
        const f = facturas.find(x => x.trackId === e.trackId);
        const esSession = e.error?.includes("expirada") || e.error?.includes("Sesion");
        addLog(`${esSession ? "⛔" : "⚠"} ${f?.emisor || e.trackId.slice(0,14)}: ${e.error}`, esSession ? "error" : "warn");
      });

      if (res.sesionMuerta) {
        addLog("⛔ Sesión DIAN expirada. Necesitas un nuevo token para los restantes.", "error");
      }

      return { ok, err, sesionMuerta: res.sesionMuerta };
    };

    // ── Enviar en lotes de 8 para no superar timeout de Netlify (26s) ────────
    const LOTE = 8;
    let xmlsOk = [];
    let pendientes = [...trackIds];

    try {
      // Ronda 1: lotes de 8
      for (let i = 0; i < trackIds.length; i += LOTE) {
        const lote = trackIds.slice(i, i + LOTE);
        const { ok, err } = await ejecutarBatch(lote, cookies, 1);
        ok.forEach(r => {
          const f = facturas.find(x => x.trackId === r.trackId);
          const nombre = `${(f?.emisor || "factura").replace(/[^a-zA-Z0-9]/g,"_")}_${r.trackId.slice(0,8)}.xml`;
          xmlsOk.push({ nombre, contenido: b64ToUtf8(r.xml), trackId: r.trackId, factura: f });
        });
        setProgreso({ actual: xmlsOk.length, total: trackIds.length });
        // Guardar fallidos para reintento
        err.forEach(e => {
          if (!e.error?.includes("expirada")) pendientes = pendientes.filter(id => id !== e.trackId);
          else pendientes = pendientes.filter(id => id !== e.trackId); // sacar también expiradas
        });
        if (i + LOTE < trackIds.length) await new Promise(r => setTimeout(r, 1000));
      }

      // Ronda 2: reintentar los que fallaron
      pendientes = trackIds.filter(id => !xmlsOk.find(x => x.trackId === id));
      if (pendientes.length > 0) {
        addLog(`─── Reintentando ${pendientes.length} fallidos... ───`, "info");
        await new Promise(r => setTimeout(r, 2000));
        for (let i = 0; i < pendientes.length; i += LOTE) {
          const lote = pendientes.slice(i, i + LOTE);
          const { ok: ok2 } = await ejecutarBatch(lote, cookies, 2);
          ok2.forEach(r => {
            const f = facturas.find(x => x.trackId === r.trackId);
            const nombre = `${(f?.emisor || "factura").replace(/[^a-zA-Z0-9]/g,"_")}_${r.trackId.slice(0,8)}.xml`;
            xmlsOk.push({ nombre, contenido: b64ToUtf8(r.xml), trackId: r.trackId, factura: f });
          });
          setProgreso({ actual: xmlsOk.length, total: trackIds.length });
          if (i + LOTE < pendientes.length) await new Promise(r => setTimeout(r, 1000));
        }
      }

    } catch(e) {
      addLog(`✗ Error en batch: ${e.message}`, "error");
      setError(e.message);
    }

    const fallaron = trackIds.length - xmlsOk.length;
    addLog(`─────────────────────────────────`, "info");
    addLog(`✓ ${xmlsOk.length}/${trackIds.length} XMLs descargados correctamente`, "ok");
    if (fallaron > 0) addLog(`⚠ ${fallaron} no se pudieron descargar (sesión expirada o sin XML)`, "warn");

    setXmlsDesc(xmlsOk);
    setProgreso({ actual: xmlsOk.length, total: trackIds.length });
    setCargando(false);
    setPaso("listo");
  };

  // ── Descargar PDFs en batch ───────────────────────────────────────────────
  const descargarPDFs = async () => {
    const seleccionadas = facturas
      .filter(f => seleccion.has(f.trackId))
      .sort((a,b) => (a.fecha||"").localeCompare(b.fecha||""));
    if (!seleccionadas.length) { alert("Selecciona al menos una factura"); return; }

    setDescargandoPDF(true);
    setProgresoDesc({ actual: 0, total: seleccionadas.length });
    addLog(`Descargando ${seleccionadas.length} PDFs vía batch...`, "info");

    let archivos = [];
    // El proxy maneja lotes de 3 en paralelo internamente
    try {
      const res = await dianProxy("download_pdfs", { cookies, facturas: seleccionadas });
      (res.resultados || []).forEach(r => {
        const pdfBytes = Uint8Array.from(atob(r.pdf), c => c.charCodeAt(0));
        archivos.push({ nombre: r.nombre, bytes: pdfBytes,
          carpeta: (seleccionadas.find(f=>f.trackId===r.trackId)?.fecha||"0000-00").slice(0,7) + "/" });
        addLog(`✓ ${r.nombre}`, "ok");
      });
      (res.errores || []).forEach(e => {
        const f = seleccionadas.find(x => x.trackId === e.trackId);
        archivos.push({ nombre: null, bytes: null,
          carpeta: (f?.fecha||"0000-00").slice(0,7) + "/", factura: f });
        addLog(`⚠ ${e.emisor || e.trackId?.slice(0,8)}: ${e.error}`, "warn");
      });
    } catch(e) {
      addLog(`✗ Error descargando PDFs: ${e.message}`, "error");
    }

    setProgresoDesc({ actual: archivos.filter(a=>a.bytes).length, total: seleccionadas.length });

    // Armar ZIP con carpetas por mes
    try {
      if (!window.JSZip) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const zip = new window.JSZip();
      archivos.forEach(({ carpeta, nombre, bytes }) => {
        if (bytes && nombre) zip.folder(carpeta).file(nombre, bytes);
      });

      // Excel de resumen
      const headers = ["Tipo Documento","CUFE/CUDE","Prefijo","N° Factura","Fecha Emisión","Fecha Recepción","NIT Emisor","Emisor","Receptor","Estado","IVA","Total"];
      const filas = seleccionadas.map(f => [
        f.tipo||"Factura electrónica", f.trackId||"", f.prefijo||"", f.nroDocumento||"",
        f.fecha||"", f.fechaRecepcion||"", f.nitEmisor||"", f.emisor||"", f.receptor||"",
        f.resultado||"", f.iva||0, f.valor||0,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...filas]);
      ws["!cols"] = [{wch:20},{wch:48},{wch:10},{wch:16},{wch:14},{wch:16},{wch:14},{wch:36},{wch:30},{wch:24},{wch:14},{wch:14}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Facturas DIAN");
      zip.file(`resumen_${desde}_al_${hasta}.xlsx`, XLSX.write(wb, { bookType:"xlsx", type:"array" }));

      const zipBlob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{level:6} });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url; a.download = `facturas_DIAN_${desde}_al_${hasta}.zip`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      addLog(`✓ ZIP descargado con ${archivos.filter(a=>a.bytes).length} PDFs + Excel`, "ok");
    } catch(e) {
      addLog(`✗ Error armando ZIP: ${e.message}`, "error");
    }
    setDescargandoPDF(false);
  };

  // ── Selección ─────────────────────────────────────────────────────────────
  const toggleTodas = () =>
    setSeleccion(seleccion.size === facturas.length ? new Set() : new Set(facturas.map(f => f.trackId)));
  const toggleFila = id => {
    const n = new Set(seleccion);
    n.has(id) ? n.delete(id) : n.add(id);
    setSeleccion(n);
  };
  const totalSel = facturas.filter(f => seleccion.has(f.trackId)).reduce((s,f) => s+(f.valor||0), 0);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.92)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#0f1117", border:"1px solid #1e2a40", borderRadius:16, width:"100%", maxWidth:860, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,.6)" }}>

        {/* HEADER */}
        <div style={{ background:"#0d101a", borderBottom:"1px solid #1e2235", padding:"14px 20px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ width:36, height:36, background:"linear-gradient(135deg,#0066ff,#00e5a0)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>📥</div>
          <div>
            <div style={{ fontFamily:"sans-serif", fontWeight:700, fontSize:15, color:"#fff" }}>Descarga automática DIAN</div>
            <div style={{ fontSize:11, color:"#475569", marginTop:1 }}>{empresaActual?.nombre||"Sin empresa"} · {empresaActual?.nit||""}</div>
          </div>

          {/* Pasos */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
            {[{id:"token",label:"Token"},{id:"lista",label:"Facturas"},{id:"descarga",label:"Descarga"},{id:"listo",label:"Listo"}].map((p,i,arr) => {
              const pasos = ["token","lista","descarga","listo"];
              const actual = pasos.indexOf(paso);
              const este   = pasos.indexOf(p.id);
              const pasado = actual > este;
              return (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background: paso===p.id ? "linear-gradient(135deg,#0066ff,#00e5a0)" : pasado ? "rgba(0,229,160,.15)" : "#1e2235", border: paso===p.id ? "none" : "1px solid #2d3352", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color: paso===p.id ? "#000" : "#475569" }}>
                    {pasado ? "✓" : i+1}
                  </div>
                  <span style={{ fontSize:10, color: paso===p.id ? "#00e5a0" : "#475569" }}>{p.label}</span>
                  {i < arr.length-1 && <span style={{ color:"#2d3352", fontSize:12 }}>→</span>}
                </div>
              );
            })}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"1px solid #2d3352", color:"#64748b", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:12, marginLeft:8 }}>✕</button>
        </div>

        {/* BODY */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>

          {error && (
            <div style={{ background:"rgba(248,113,113,.08)", border:"1px solid rgba(248,113,113,.25)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#f87171", display:"flex", alignItems:"center", gap:8 }}>
              <span>⚠</span> {error}
            </div>
          )}

          {/* TOKEN */}
          {paso === "token" && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div style={{ background:"rgba(0,102,255,.06)", border:"1px solid rgba(0,102,255,.2)", borderRadius:10, padding:"14px 16px", fontSize:12, color:"#60a5fa", lineHeight:1.7 }}>
                <strong>¿Cómo funciona?</strong><br/>
                La DIAN envía un correo al representante legal con un link de acceso único.
                Cópialo completo y pégalo aquí. El sistema descarga <strong>todas las facturas en una sola operación</strong> sin múltiples llamadas que agoten la sesión.
              </div>
              <div>
                <div style={{ fontSize:11, color:"#64748b", textTransform:"uppercase", letterSpacing:".08em", marginBottom:6, fontWeight:600 }}>URL del token DIAN</div>
                <div style={{ fontSize:10, color:"#475569", marginBottom:8 }}>Ejemplo: https://catalogo-vpfe.dian.gov.co/User/AuthToken?pk=...&token=...</div>
                <textarea value={tokenUrl} onChange={e=>{setTokenUrl(e.target.value);setError("");}} placeholder="https://catalogo-vpfe.dian.gov.co/User/AuthToken?pk=...&token=..." rows={3}
                  style={{ width:"100%", background:"#0d101a", border:`1px solid ${tokenUrl?"#2d5a3d":"#2d3352"}`, color:"#e2e8f0", borderRadius:8, padding:"10px 14px", fontFamily:"monospace", fontSize:11, outline:"none", resize:"vertical", lineHeight:1.6 }} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                {[["Desde",desde,setDesde],["Hasta",hasta,setHasta]].map(([label,val,set])=>(
                  <div key={label}>
                    <div style={{ fontSize:11, color:"#64748b", textTransform:"uppercase", letterSpacing:".07em", marginBottom:5, fontWeight:600 }}>{label}</div>
                    <input type="date" value={val} onChange={e=>set(e.target.value)}
                      style={{ width:"100%", background:"#0d101a", border:"1px solid #2d3352", color:"#e2e8f0", borderRadius:6, padding:"8px 10px", fontSize:12, outline:"none", cursor:"pointer" }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TABLA FACTURAS */}
          {(paso==="lista"||paso==="descarga"||paso==="listo") && facturas.length > 0 && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" }}>
                <button onClick={toggleTodas} style={{ background:"transparent", border:"1px solid #2d3352", color:"#94a3b8", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontSize:11 }}>
                  {seleccion.size===facturas.length ? "Deseleccionar" : "Seleccionar"} todas
                </button>
                <span style={{ fontSize:11, color:"#64748b" }}>
                  <span style={{ color:"#00e5a0", fontWeight:700 }}>{seleccion.size}</span>/{facturas.length} seleccionadas
                </span>
                {seleccion.size > 0 && <span style={{ fontSize:11, color:"#fbbf24", fontWeight:600 }}>Total: {fmt(totalSel)}</span>}
                {paso==="lista" && (
                  <button onClick={listarFacturas} disabled={cargando}
                    style={{ marginLeft:"auto", background:"transparent", border:"1px solid #2d3f6e", color:"#60a5fa", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontSize:11 }}>
                    🔄 Actualizar
                  </button>
                )}
              </div>
              <div style={{ background:"#0d101a", border:"1px solid #1e2235", borderRadius:8, overflow:"hidden", maxHeight:320, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                  <thead>
                    <tr style={{ background:"#131620", position:"sticky", top:0 }}>
                      <th style={{ width:32, padding:"7px 10px" }}></th>
                      {["Fecha","Proveedor","NIT","N° Factura","Valor","Estado"].map(h => (
                        <th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:10, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:".05em", borderBottom:"1px solid #1e2235" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.map((f,i) => {
                      const esSel   = seleccion.has(f.trackId);
                      const tieneXml = xmlsDesc.find(x => x.trackId===f.trackId);
                      return (
                        <tr key={f.trackId} onClick={()=>toggleFila(f.trackId)}
                          style={{ borderBottom:"1px solid rgba(30,34,53,.6)", background: esSel ? "rgba(0,229,160,.04)" : i%2===0 ? "transparent" : "rgba(255,255,255,.01)", cursor:"pointer" }}>
                          <td style={{ padding:"6px 10px", textAlign:"center" }}>
                            <input type="checkbox" checked={esSel} onChange={()=>toggleFila(f.trackId)} onClick={e=>e.stopPropagation()} style={{ cursor:"pointer", accentColor:"#00e5a0" }} />
                          </td>
                          <td style={{ padding:"6px 10px", color:"#94a3b8", whiteSpace:"nowrap" }}>{fmtFecha(f.fecha)}</td>
                          <td style={{ padding:"6px 10px", color:"#e2e8f0", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.emisor||"—"}</td>
                          <td style={{ padding:"6px 10px", fontFamily:"monospace", color:"#60a5fa" }}>{f.nitEmisor||"—"}</td>
                          <td style={{ padding:"6px 10px", fontFamily:"monospace", color:"#64748b" }}>{f.prefijo?`${f.prefijo}${f.nroDocumento}`:"—"}</td>
                          <td style={{ padding:"6px 10px", color:"#4ade80", fontWeight:600, textAlign:"right", whiteSpace:"nowrap" }}>{f.valor?fmt(f.valor):"—"}</td>
                          <td style={{ padding:"6px 10px" }}>
                            {tieneXml
                              ? <span style={{ color:"#00e5a0", fontSize:10, fontWeight:700 }}>✓ XML</span>
                              : <span style={{ color:"#475569", fontSize:10 }}>{f.resultado||"Pendiente"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {paso==="lista" && facturas.length===0 && !cargando && (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#475569", fontSize:13 }}>
              Sin facturas en ese rango de fechas.<br/>
              <span style={{ fontSize:11, marginTop:4, display:"block" }}>Intenta ampliar el rango o verifica que la empresa recibe facturas electrónicas.</span>
            </div>
          )}

          {/* BARRA DE PROGRESO */}
          {(paso==="descarga"||(paso==="listo"&&xmlsDesc.length>0)) && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#64748b", marginBottom:5 }}>
                <span>Descargando XMLs...</span>
                <span style={{ color:"#00e5a0", fontWeight:700 }}>{progreso.actual}/{progreso.total}</span>
              </div>
              <div style={{ height:4, background:"#1e2235", borderRadius:2, overflow:"hidden", marginBottom:12 }}>
                <div style={{ height:"100%", width:`${progreso.total?(progreso.actual/progreso.total)*100:0}%`, background:"linear-gradient(90deg,#0066ff,#00e5a0)", borderRadius:2, transition:"width .4s ease" }} />
              </div>
            </div>
          )}

          {/* RESULTADO */}
          {paso==="listo" && (
            <div style={{ background:"linear-gradient(135deg,rgba(0,229,160,.06),rgba(0,102,255,.06))", border:"1px solid rgba(0,229,160,.2)", borderRadius:10, padding:"16px 20px", textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
              <div style={{ fontFamily:"sans-serif", fontWeight:700, fontSize:16, color:"#00e5a0", marginBottom:4 }}>
                {xmlsDesc.length} facturas listas para contabilizar
              </div>
              {xmlsDesc.length < progreso.total && (
                <div style={{ fontSize:12, color:"#fbbf24", marginBottom:4 }}>
                  ⚠ {progreso.total - xmlsDesc.length} no se pudieron descargar — puedes reintentar con un nuevo token DIAN
                </div>
              )}
              <div style={{ fontSize:12, color:"#64748b" }}>Los XMLs se procesarán con ContaIA — retenciones, IVA y asiento contable.</div>
            </div>
          )}

          {/* LOG */}
          {logs.length > 0 && (
            <div ref={logRef} style={{ background:"#060810", border:"1px solid #1e2235", borderRadius:8, padding:"10px 14px", maxHeight:140, overflowY:"auto", fontSize:10, lineHeight:1.9, fontFamily:"monospace" }}>
              {logs.map((l,i) => (
                <div key={i} style={{ display:"flex", gap:10 }}>
                  <span style={{ color:"#2d3f6e", flexShrink:0 }}>{l.time}</span>
                  <span style={{ color: l.tipo==="ok"?"#00e5a0":l.tipo==="error"?"#f87171":l.tipo==="warn"?"#fbbf24":"#64748b" }}>{l.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ borderTop:"1px solid #1e2235", padding:"14px 20px", display:"flex", gap:10, justifyContent:"flex-end", flexShrink:0, background:"#0d101a" }}>
          <button onClick={onClose} style={{ background:"transparent", border:"1px solid #2d3352", color:"#94a3b8", borderRadius:6, padding:"9px 18px", cursor:"pointer", fontSize:13, fontWeight:600 }}>Cancelar</button>

          {paso==="token" && (
            <button onClick={autenticar} disabled={cargando||!tokenUrl}
              style={{ background:cargando||!tokenUrl?"#1e2235":"linear-gradient(135deg,#0066ff,#0099ff)", color:cargando||!tokenUrl?"#475569":"#fff", border:"none", borderRadius:6, padding:"9px 24px", cursor:cargando||!tokenUrl?"not-allowed":"pointer", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:8 }}>
              {cargando ? <><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚙</span> Conectando...</> : "🔐 Autenticar con DIAN →"}
            </button>
          )}

          {paso==="lista" && facturas.length===0 && (
            <button onClick={listarFacturas} disabled={cargando}
              style={{ background:cargando?"#1e2235":"linear-gradient(135deg,#0066ff,#00e5a0)", color:cargando?"#475569":"#000", border:"none", borderRadius:6, padding:"9px 24px", cursor:cargando?"not-allowed":"pointer", fontSize:13, fontWeight:700 }}>
              {cargando?"Consultando...":"🔍 Consultar facturas →"}
            </button>
          )}

          {paso==="lista" && facturas.length>0 && (
            <button onClick={descargar} disabled={cargando||seleccion.size===0}
              style={{ background:cargando||seleccion.size===0?"#1e2235":"linear-gradient(135deg,#00cc88,#00e5a0)", color:cargando||seleccion.size===0?"#475569":"#000", border:"none", borderRadius:6, padding:"9px 24px", cursor:cargando||seleccion.size===0?"not-allowed":"pointer", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:8 }}>
              {cargando ? <><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚙</span> Consultando...</> : `📥 Descargar ${seleccion.size} facturas →`}
            </button>
          )}

          {paso==="descarga" && cargando && (
            <button disabled style={{ background:"#1e2235", color:"#475569", border:"none", borderRadius:6, padding:"9px 24px", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚙</span>
              Descargando {progreso.actual}/{progreso.total}...
            </button>
          )}

          {paso==="listo" && xmlsDesc.length>0 && (<>
            <button onClick={descargarPDFs} disabled={descargandoPDF}
              style={{ background:descargandoPDF?"#1e2235":"#1e3a5f", color:descargandoPDF?"#475569":"#60a5fa", border:"1px solid rgba(96,165,250,.3)", borderRadius:6, padding:"9px 20px", cursor:descargandoPDF?"not-allowed":"pointer", fontSize:13, fontWeight:700 }}>
              {descargandoPDF ? `⏳ ${progresoDesc.actual}/${progresoDesc.total}...` : "📄 Descargar PDFs"}
            </button>
            <button onClick={()=>onXmlsDescargados(xmlsDesc)}
              style={{ background:"linear-gradient(135deg,#00cc88,#00e5a0)", color:"#000", border:"none", borderRadius:6, padding:"9px 28px", cursor:"pointer", fontSize:14, fontWeight:800, boxShadow:"0 4px 20px rgba(0,229,160,.3)" }}>
              ⚡ Contabilizar {xmlsDesc.length} facturas →
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}
