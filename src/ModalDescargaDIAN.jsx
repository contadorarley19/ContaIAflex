// ─────────────────────────────────────────────────────────────────────────────
// ModalDescargaDIAN.jsx
// Componente para integrar en ContaIA — descarga automática desde portal DIAN
//
// INSTRUCCIONES DE INTEGRACIÓN:
//   1. Copiar este archivo como src/ModalDescargaDIAN.jsx
//   2. En App.jsx importar:  import ModalDescargaDIAN from "./ModalDescargaDIAN";
//   3. Agregar estado:       const [modalDIAN, setModalDIAN] = useState(false);
//   4. Agregar en navbar:    <button onClick={() => setModalDIAN(true)}>📥 DIAN</button>
//   5. Agregar en render:
//        {modalDIAN && (
//          <ModalDescargaDIAN
//            empresaActual={empresaActual}
//            onClose={() => setModalDIAN(false)}
//            onXmlsDescargados={(xmlFiles) => {
//              // xmlFiles es un array de { nombre, contenido }
//              // Convertirlos a File objects y pasarlos al modal de tratamiento
//              const files = xmlFiles.map(x =>
//                new File([x.contenido], x.nombre, { type: "text/xml" })
//              );
//              setModalDIAN(false);
//              setModal({ archivos: files }); // abre el modal de tratamiento
//            }}
//          />
//        )}
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";

const DIAN_PROXY_URL = "/.netlify/functions/dian-proxy";

// ── Llamar al proxy ───────────────────────────────────────────────────────────
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

// ── Formatear pesos ───────────────────────────────────────────────────────────
const fmt = n => `$${Number(n || 0).toLocaleString("es-CO")}`;

// ── Formatear fecha YYYY-MM-DD a DD/MM/YYYY ──────────────────────────────────
const fmtFecha = f => {
  if (!f) return "";
  const [y, m, d] = f.split("-");
  return d ? `${d}/${m}/${y}` : f;
};

// ── Primer día del mes actual ─────────────────────────────────────────────────
const primerDiaMes = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
};

// ── Hoy ───────────────────────────────────────────────────────────────────────
const hoy = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
export default function ModalDescargaDIAN({ empresaActual, onClose, onXmlsDescargados }) {
  // Pasos: "token" → "lista" → "descarga" → "listo"
  const [paso,        setPaso]        = useState("token");
  const [tokenUrl,    setTokenUrl]    = useState("");
  const [cookies,     setCookies]     = useState("");
  const [desde,       setDesde]       = useState(primerDiaMes());
  const [hasta,       setHasta]       = useState(hoy());
  const [facturas,    setFacturas]    = useState([]);
  const [seleccion,   setSeleccion]   = useState(new Set());
  const [cargando,    setCargando]    = useState(false);
  const [progreso,    setProgreso]    = useState({ actual: 0, total: 0 });
  const [logs,        setLogs]        = useState([]);
  const [error,       setError]       = useState("");
  const [xmlsDesc,    setXmlsDesc]    = useState([]);
  const logRef = useRef(null);

  const addLog = (msg, tipo = "info") => {
    const time = new Date().toLocaleTimeString("es-CO");
    setLogs(p => [...p, { time, msg, tipo }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  };

  // ── PASO 1: Autenticar con token ────────────────────────────────────────────
  const autenticar = async () => {
    if (!tokenUrl.includes("catalogo-vpfe.dian.gov.co")) {
      setError("Pega la URL completa que llegó al correo del representante legal");
      return;
    }
    setCargando(true);
    setError("");
    addLog("Conectando con el portal DIAN...", "info");
    try {
      const res = await dianProxy("auth", { tokenUrl });
      setCookies(res.cookies);
      addLog("✓ Sesión DIAN iniciada correctamente", "ok");
      setPaso("lista");
    } catch (e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`, "error");
    }
    setCargando(false);
  };

  // ── PASO 2: Listar facturas ─────────────────────────────────────────────────
  const listarFacturas = async () => {
    setCargando(true);
    setError("");
    addLog(`Consultando facturas del ${fmtFecha(desde)} al ${fmtFecha(hasta)}...`, "info");
    try {
      const res = await dianProxy("list", { cookies, desde, hasta });
      setCookies(res.cookies || cookies); // actualizar cookies si vienen nuevas
      setFacturas(res.facturas || []);
      // Seleccionar todas por defecto
      setSeleccion(new Set((res.facturas || []).map(f => f.trackId)));
      addLog(`✓ ${res.total} facturas encontradas`, "ok");
      if (res.total === 0) {
        addLog("Sin facturas en ese rango de fechas. Intenta con un rango más amplio.", "warn");
      }
      setPaso("lista");
    } catch (e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`, "error");
    }
    setCargando(false);
  };

  // ── PASO 3: Descargar XMLs seleccionados ────────────────────────────────────
  const descargar = async () => {
    const trackIds = Array.from(seleccion);
    if (trackIds.length === 0) {
      setError("Selecciona al menos una factura");
      return;
    }
    setCargando(true);
    setError("");
    setProgreso({ actual: 0, total: trackIds.length });
    setPaso("descarga");
    addLog(`Iniciando descarga de ${trackIds.length} facturas en paralelo...`, "info");

    const xmlsOk = [];
    const LOTE   = 5; // 5 simultáneas a la vez

    for (let i = 0; i < trackIds.length; i += LOTE) {
      const lote = trackIds.slice(i, i + LOTE);
      addLog(`Descargando lote ${Math.floor(i / LOTE) + 1}/${Math.ceil(trackIds.length / LOTE)} (${lote.length} facturas)...`, "info");

      try {
        const res = await dianProxy("download_batch", { cookies, trackIds: lote });

        // Procesar exitosos — decodificar base64 si es necesario
        (res.resultados || []).forEach(r => {
          const factura = facturas.find(f => f.trackId === r.trackId);
          const nombre  = `${factura?.emisor?.replace(/[^a-zA-Z0-9]/g, "_") || "factura"}_${r.trackId.slice(0, 8)}.xml`;
          // Decodificar base64 si el proxy lo envió así
          let contenido = r.xml;
          if (r.encoding === "base64") {
            try { contenido = atob(r.xml); } catch(e) { contenido = r.xml; }
          }
          xmlsOk.push({ nombre, contenido, trackId: r.trackId, factura });
          addLog(`✓ ${factura?.emisor || r.trackId.slice(0, 12)} — ${fmt(factura?.valor)}`, "ok");
        });

        // Reportar errores
        (res.errores || []).forEach(e => {
          const factura = facturas.find(f => f.trackId === e.trackId);
          addLog(`⚠ ${factura?.emisor || e.trackId.slice(0, 12)}: ${e.error}`, "warn");
        });

      } catch (e) {
        addLog(`✗ Error en lote: ${e.message}`, "error");
      }

      setProgreso({ actual: Math.min(i + LOTE, trackIds.length), total: trackIds.length });

      // Pausa entre lotes
      if (i + LOTE < trackIds.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    setXmlsDesc(xmlsOk);
    addLog(`─────────────────────────────────`, "info");
    addLog(`✓ ${xmlsOk.length}/${trackIds.length} XMLs descargados correctamente`, "ok");
    setCargando(false);
    setPaso("listo");
  };

  // ── Selección masiva ────────────────────────────────────────────────────────
  const toggleTodas = () => {
    if (seleccion.size === facturas.length) {
      setSeleccion(new Set());
    } else {
      setSeleccion(new Set(facturas.map(f => f.trackId)));
    }
  };

  const toggleFila = (trackId) => {
    const n = new Set(seleccion);
    n.has(trackId) ? n.delete(trackId) : n.add(trackId);
    setSeleccion(n);
  };

  // ── Total seleccionado ──────────────────────────────────────────────────────
  const totalSel = facturas
    .filter(f => seleccion.has(f.trackId))
    .reduce((s, f) => s + (f.valor || 0), 0);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,.92)",
      zIndex: 4000,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        background: "#0f1117",
        border: "1px solid #1e2a40",
        borderRadius: 16,
        width: "100%", maxWidth: 860,
        maxHeight: "92vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,.6)",
      }}>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div style={{
          background: "#0d101a",
          borderBottom: "1px solid #1e2235",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36,
            background: "linear-gradient(135deg, #0066ff, #00e5a0)",
            borderRadius: 9,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}>📥</div>
          <div>
            <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 15, color: "#fff" }}>
              Descarga automática DIAN
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
              {empresaActual?.nombre || "Sin empresa"} · {empresaActual?.nit || ""}
            </div>
          </div>

          {/* Indicador de pasos */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {[
              { id: "token",   label: "Token"    },
              { id: "lista",   label: "Facturas" },
              { id: "descarga",label: "Descarga" },
              { id: "listo",   label: "Listo"    },
            ].map((p, i, arr) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: paso === p.id
                    ? "linear-gradient(135deg,#0066ff,#00e5a0)"
                    : ["lista","descarga","listo"].indexOf(paso) > ["lista","descarga","listo"].indexOf(p.id) || paso === "listo"
                      ? "rgba(0,229,160,.15)"
                      : "#1e2235",
                  border: paso === p.id ? "none" : "1px solid #2d3352",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  color: paso === p.id ? "#000" : "#475569",
                  transition: "all .3s",
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 10, color: paso === p.id ? "#00e5a0" : "#475569" }}>{p.label}</span>
                {i < arr.length - 1 && <span style={{ color: "#2d3352", fontSize: 12 }}>→</span>}
              </div>
            ))}
          </div>

          <button onClick={onClose} style={{
            background: "transparent",
            border: "1px solid #2d3352",
            color: "#64748b",
            borderRadius: 6, padding: "4px 10px",
            cursor: "pointer", fontSize: 12,
            marginLeft: 8,
          }}>✕</button>
        </div>

        {/* ── BODY ───────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ERROR */}
          {error && (
            <div style={{
              background: "rgba(248,113,113,.08)",
              border: "1px solid rgba(248,113,113,.25)",
              borderRadius: 8, padding: "10px 14px",
              fontSize: 12, color: "#f87171",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>⚠</span> {error}
            </div>
          )}

          {/* ── PASO TOKEN ─────────────────────────────────────────────── */}
          {paso === "token" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{
                background: "rgba(0,102,255,.06)",
                border: "1px solid rgba(0,102,255,.2)",
                borderRadius: 10, padding: "14px 16px",
                fontSize: 12, color: "#60a5fa",
                lineHeight: 1.7,
              }}>
                <strong>¿Cómo funciona?</strong><br/>
                La DIAN envía un correo al representante legal con un link de acceso.
                Ese link contiene un token de un solo uso. Cópialo completo y pégalo aquí.
                El sistema se autentica automáticamente y descarga todas las facturas.
              </div>

              <div>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6, fontWeight: 600 }}>
                  URL del token DIAN
                </div>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 8 }}>
                  Ejemplo: https://catalogo-vpfe.dian.gov.co/User/AuthToken?pk=...&rk=...&token=...
                </div>
                <textarea
                  value={tokenUrl}
                  onChange={e => { setTokenUrl(e.target.value); setError(""); }}
                  placeholder="https://catalogo-vpfe.dian.gov.co/User/AuthToken?pk=...&token=..."
                  rows={3}
                  style={{
                    width: "100%",
                    background: "#0d101a",
                    border: `1px solid ${tokenUrl ? "#2d5a3d" : "#2d3352"}`,
                    color: "#e2e8f0",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontFamily: "monospace",
                    fontSize: 11,
                    outline: "none",
                    resize: "vertical",
                    lineHeight: 1.6,
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 5, fontWeight: 600 }}>Desde</div>
                  <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                    style={{ width: "100%", background: "#0d101a", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 5, fontWeight: 600 }}>Hasta</div>
                  <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                    style={{ width: "100%", background: "#0d101a", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", cursor: "pointer" }} />
                </div>
              </div>
            </div>
          )}

          {/* ── PASO LISTA ─────────────────────────────────────────────── */}
          {(paso === "lista" || paso === "descarga" || paso === "listo") && facturas.length > 0 && (
            <div>
              {/* Barra de selección */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 10, flexWrap: "wrap",
              }}>
                <button onClick={toggleTodas} style={{
                  background: "transparent",
                  border: "1px solid #2d3352",
                  color: "#94a3b8",
                  borderRadius: 5, padding: "4px 10px",
                  cursor: "pointer", fontSize: 11,
                }}>
                  {seleccion.size === facturas.length ? "Deseleccionar" : "Seleccionar"} todas
                </button>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  <span style={{ color: "#00e5a0", fontWeight: 700 }}>{seleccion.size}</span>/{facturas.length} seleccionadas
                </span>
                {seleccion.size > 0 && (
                  <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>
                    Total: {fmt(totalSel)}
                  </span>
                )}

                {/* Botón re-consultar */}
                {paso === "lista" && (
                  <button onClick={listarFacturas} disabled={cargando}
                    style={{ marginLeft: "auto", background: "transparent", border: "1px solid #2d3f6e", color: "#60a5fa", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>
                    🔄 Actualizar
                  </button>
                )}
              </div>

              {/* Tabla de facturas */}
              <div style={{
                background: "#0d101a",
                border: "1px solid #1e2235",
                borderRadius: 8, overflow: "hidden",
                maxHeight: 320, overflowY: "auto",
              }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#131620", position: "sticky", top: 0 }}>
                      <th style={{ width: 32, padding: "7px 10px" }}></th>
                      {["Fecha", "Proveedor", "NIT", "N° Factura", "Valor", "Estado"].map(h => (
                        <th key={h} style={{
                          padding: "7px 10px", textAlign: "left",
                          fontSize: 10, fontWeight: 600, color: "#475569",
                          textTransform: "uppercase", letterSpacing: ".05em",
                          borderBottom: "1px solid #1e2235",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.map((f, i) => {
                      const esSel = seleccion.has(f.trackId);
                      return (
                        <tr key={f.trackId} onClick={() => toggleFila(f.trackId)}
                          style={{
                            borderBottom: "1px solid rgba(30,34,53,.6)",
                            background: esSel ? "rgba(0,229,160,.04)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)",
                            cursor: "pointer",
                            transition: "background .15s",
                          }}>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <input type="checkbox" checked={esSel} onChange={() => toggleFila(f.trackId)}
                              onClick={e => e.stopPropagation()}
                              style={{ cursor: "pointer", accentColor: "#00e5a0" }} />
                          </td>
                          <td style={{ padding: "6px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtFecha(f.fecha)}</td>
                          <td style={{ padding: "6px 10px", color: "#e2e8f0", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.emisor || "—"}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#60a5fa" }}>{f.nitEmisor || "—"}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#64748b" }}>{f.prefijo ? `${f.prefijo}${f.nroDocumento}` : "—"}</td>
                          <td style={{ padding: "6px 10px", color: "#4ade80", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{f.valor ? fmt(f.valor) : "—"}</td>
                          <td style={{ padding: "6px 10px" }}>
                            {xmlsDesc.find(x => x.trackId === f.trackId) ? (
                              <span style={{ color: "#00e5a0", fontSize: 10, fontWeight: 700 }}>✓ XML</span>
                            ) : (
                              <span style={{ color: "#475569", fontSize: 10 }}>{f.resultado || "Pendiente"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sin facturas */}
          {paso === "lista" && facturas.length === 0 && !cargando && (
            <div style={{
              textAlign: "center", padding: "40px 20px",
              color: "#475569", fontSize: 13,
            }}>
              Sin facturas en ese rango de fechas.<br/>
              <span style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                Intenta ampliar el rango o verifica que la empresa recibe facturas electrónicas.
              </span>
            </div>
          )}

          {/* ── PROGRESO DESCARGA ─────────────────────────────────────── */}
          {(paso === "descarga" || (paso === "listo" && xmlsDesc.length > 0)) && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 5 }}>
                <span>Descargando XMLs...</span>
                <span style={{ color: "#00e5a0", fontWeight: 700 }}>{progreso.actual}/{progreso.total}</span>
              </div>
              <div style={{ height: 4, background: "#1e2235", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
                <div style={{
                  height: "100%",
                  width: `${progreso.total ? (progreso.actual / progreso.total) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #0066ff, #00e5a0)",
                  borderRadius: 2,
                  transition: "width .4s ease",
                }} />
              </div>
            </div>
          )}

          {/* ── RESULTADO FINAL ───────────────────────────────────────── */}
          {paso === "listo" && (
            <div style={{
              background: "linear-gradient(135deg, rgba(0,229,160,.06), rgba(0,102,255,.06))",
              border: "1px solid rgba(0,229,160,.2)",
              borderRadius: 10, padding: "16px 20px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
              <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 16, color: "#00e5a0", marginBottom: 6 }}>
                {xmlsDesc.length} facturas listas para contabilizar
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Los XMLs se procesarán automáticamente con ContaIA — retenciones, IVA y asiento contable.
              </div>
            </div>
          )}

          {/* ── LOG ───────────────────────────────────────────────────── */}
          {logs.length > 0 && (
            <div
              ref={logRef}
              style={{
                background: "#060810",
                border: "1px solid #1e2235",
                borderRadius: 8, padding: "10px 14px",
                maxHeight: 140, overflowY: "auto",
                fontSize: 10, lineHeight: 1.9,
                fontFamily: "monospace",
              }}
            >
              {logs.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span style={{ color: "#2d3f6e", flexShrink: 0 }}>{l.time}</span>
                  <span style={{
                    color: l.tipo === "ok" ? "#00e5a0" : l.tipo === "error" ? "#f87171" : l.tipo === "warn" ? "#fbbf24" : "#64748b",
                  }}>{l.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── FOOTER / ACCIONES ──────────────────────────────────────────────── */}
        <div style={{
          borderTop: "1px solid #1e2235",
          padding: "14px 20px",
          display: "flex", gap: 10, justifyContent: "flex-end",
          flexShrink: 0,
          background: "#0d101a",
        }}>
          <button onClick={onClose} style={{
            background: "transparent",
            border: "1px solid #2d3352",
            color: "#94a3b8",
            borderRadius: 6, padding: "9px 18px",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}>
            Cancelar
          </button>

          {/* Botón según el paso actual */}
          {paso === "token" && (
            <button
              onClick={autenticar}
              disabled={cargando || !tokenUrl}
              style={{
                background: cargando || !tokenUrl ? "#1e2235" : "linear-gradient(135deg, #0066ff, #0099ff)",
                color: cargando || !tokenUrl ? "#475569" : "#fff",
                border: "none", borderRadius: 6,
                padding: "9px 24px",
                cursor: cargando || !tokenUrl ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {cargando ? (
                <>
                  <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⚙</span>
                  Conectando...
                </>
              ) : "🔐 Autenticar con DIAN →"}
            </button>
          )}

          {paso === "lista" && facturas.length === 0 && (
            <button onClick={listarFacturas} disabled={cargando}
              style={{
                background: cargando ? "#1e2235" : "linear-gradient(135deg, #0066ff, #00e5a0)",
                color: cargando ? "#475569" : "#000",
                border: "none", borderRadius: 6,
                padding: "9px 24px",
                cursor: cargando ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700,
              }}>
              {cargando ? "Consultando..." : "🔍 Consultar facturas →"}
            </button>
          )}

          {paso === "lista" && facturas.length > 0 && (
            <button
              onClick={descargar}
              disabled={cargando || seleccion.size === 0}
              style={{
                background: cargando || seleccion.size === 0 ? "#1e2235" : "linear-gradient(135deg, #00cc88, #00e5a0)",
                color: cargando || seleccion.size === 0 ? "#475569" : "#000",
                border: "none", borderRadius: 6,
                padding: "9px 24px",
                cursor: cargando || seleccion.size === 0 ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {cargando ? (
                <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙</span> Consultando...</>
              ) : `📥 Descargar ${seleccion.size} facturas →`}
            </button>
          )}

          {paso === "descarga" && cargando && (
            <button disabled style={{
              background: "#1e2235", color: "#475569",
              border: "none", borderRadius: 6,
              padding: "9px 24px", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙</span>
              Descargando {progreso.actual}/{progreso.total}...
            </button>
          )}

          {paso === "listo" && xmlsDesc.length > 0 && (
            <button
              onClick={() => onXmlsDescargados(xmlsDesc)}
              style={{
                background: "linear-gradient(135deg, #00cc88, #00e5a0)",
                color: "#000",
                border: "none", borderRadius: 6,
                padding: "9px 28px",
                cursor: "pointer", fontSize: 14, fontWeight: 800,
                boxShadow: "0 4px 20px rgba(0,229,160,.3)",
              }}
            >
              ⚡ Contabilizar {xmlsDesc.length} facturas →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
