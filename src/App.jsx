import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const API_URL   = "/.netlify/functions/claude";
const SB_URL    = "https://znqsbadwcfgunwndtswd.supabase.co";
const SB_KEY    = "sb_publishable_YeXUE354536RJ5VjOmgeYw_dBPI45Nc";
const UVT       = { 2023:42412, 2024:47065, 2025:49799, 2026:52374 };

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
async function sbGet(table, filters = {}) {
  try {
    let url = `${SB_URL}/rest/v1/${table}?select=*`;
    Object.entries(filters).forEach(([k,v]) => { url += `&${k}=eq.${encodeURIComponent(v)}`; });
    const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function sbUpsert(table, data) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    return r.ok;
  } catch { return false; }
}

// ─── TABLA DE RETENCIONES (REGLAS EN CÓDIGO) ──────────────────────────────────
// P1: hasta 2025-05-31  → Decreto 1625/2016
// P2: 2025-06-01→2026-05-07 → Decreto 0572/2025
// P3: desde 2026-05-08  → Boletín DIAN 070/2026
const TABLA_RETE = [
  // tipo, persona, tarifa%, base_uvt, fi, ff
  // COMPRAS
  { t:"compras",   p:"juridica", r:2.5, b:27, fi:"2023-01-01", ff:"2025-05-31" },
  { t:"compras",   p:"juridica", r:2.5, b:10, fi:"2025-06-01", ff:"2026-05-07" },
  { t:"compras",   p:"juridica", r:2.5, b:27, fi:"2026-05-08", ff:"2099-12-31" },
  { t:"compras",   p:"natural",  r:3.5, b:27, fi:"2023-01-01", ff:"2025-05-31" },
  { t:"compras",   p:"natural",  r:3.5, b:10, fi:"2025-06-01", ff:"2026-05-07" },
  { t:"compras",   p:"natural",  r:3.5, b:27, fi:"2026-05-08", ff:"2099-12-31" },
  // SERVICIOS
  { t:"servicios", p:"juridica", r:4,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"servicios", p:"juridica", r:4,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"servicios", p:"juridica", r:4,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  { t:"servicios", p:"natural",  r:4,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"servicios", p:"natural",  r:4,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"servicios", p:"natural",  r:4,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  { t:"servicios", p:"no_decl",  r:6,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"servicios", p:"no_decl",  r:6,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"servicios", p:"no_decl",  r:6,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  // HONORARIOS (sin base)
  { t:"honorarios",p:"juridica", r:11,  b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  { t:"honorarios",p:"natural",  r:10,  b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  // TRANSPORTE
  { t:"transporte",p:"juridica", r:1,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"transporte",p:"juridica", r:1,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"transporte",p:"juridica", r:1,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  { t:"transporte",p:"natural",  r:1,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"transporte",p:"natural",  r:1,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"transporte",p:"natural",  r:1,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  // ARRENDAMIENTO
  { t:"arrend_inmueble", p:"ambas", r:3.5, b:27, fi:"2023-01-01", ff:"2025-05-31" },
  { t:"arrend_inmueble", p:"ambas", r:3.5, b:10, fi:"2025-06-01", ff:"2026-05-07" },
  { t:"arrend_inmueble", p:"ambas", r:3.5, b:27, fi:"2026-05-08", ff:"2099-12-31" },
  { t:"arrend_mueble",   p:"ambas", r:4,   b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  // OBRA CIVIL (sin base)
  { t:"obra_civil",p:"ambas",   r:2,   b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  // VIGILANCIA/ASEO (sobre AIU)
  { t:"vigilancia",p:"juridica",r:2,   b:4,  fi:"2023-01-01", ff:"2025-05-31" },
  { t:"vigilancia",p:"juridica",r:2,   b:2,  fi:"2025-06-01", ff:"2026-05-07" },
  { t:"vigilancia",p:"juridica",r:2,   b:4,  fi:"2026-05-08", ff:"2099-12-31" },
  // COMBUSTIBLES (sin base)
  { t:"combustibles",p:"ambas", r:0.1, b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  // COMISIONES (sin base)
  { t:"comisiones",p:"juridica",r:11,  b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  { t:"comisiones",p:"natural", r:10,  b:0,  fi:"2023-01-01", ff:"2099-12-31" },
  // NO APLICA
  { t:"no_aplica", p:"ambas",   r:0,   b:0,  fi:"2023-01-01", ff:"2099-12-31" },
];

// MAPA: tipo → códigos de cuenta de retención según persona (busca en PUC de la empresa)
// Patrones de búsqueda en nombre de cuenta del PUC
const RETE_CUENTA_PATRON = {
  compras_juridica:      ["2.5%", "compras", "declarante"],
  compras_natural:       ["3.5%", "compras", "no declarante"],
  servicios_juridica:    ["4%", "servicio", "declarante"],
  servicios_natural:     ["4%", "servicio", "declarante"],
  servicios_no_decl:     ["6%", "servicio", "no declarante"],
  honorarios_juridica:   ["11%", "honorario"],
  honorarios_natural:    ["10%", "honorario"],
  transporte_juridica:   ["1%", "transporte", "carga"],
  transporte_natural:    ["1%", "transporte", "carga"],
  arrend_inmueble_ambas: ["3.5%", "arrend", "inmueble"],
  arrend_mueble_ambas:   ["4%", "arrend", "mueble"],
  obra_civil_ambas:      ["2%", "obra"],
  vigilancia_juridica:   ["2%", "vigilancia", "aseo"],
  combustibles_ambas:    ["0.1%", "combustible"],
  comisiones_juridica:   ["11%", "comision"],
  comisiones_natural:    ["10%", "comision"],
};

// Calcular retención con REGLAS EN CÓDIGO
function calcularRetencion(tipo, persona, fecha, subtotal, pucCuentas, esAutorretenedor) {
  if (esAutorretenedor) return { pct: 0, valor: 0, cuenta: null, aplica: false, nota: "Autorretenedor — ReteFuente $0" };

  const anno  = parseInt((fecha || "2026-01-01").slice(0,4)) || 2026;
  const uvt   = UVT[anno] || UVT[2026];
  const pNorm = persona === "juridica" ? "juridica" : persona === "natural_no_decl" ? "no_decl" : "natural";

  // Buscar fila vigente
  const fila = TABLA_RETE.find(r =>
    r.t === tipo &&
    (r.p === "ambas" || r.p === pNorm) &&
    fecha >= r.fi && fecha <= r.ff
  );
  if (!fila || fila.r === 0) return { pct: 0, valor: 0, cuenta: null, aplica: false, nota: "No aplica retención" };

  const basePesos = fila.b > 0 ? Math.round(fila.b * uvt) : 0;
  const aplica    = basePesos === 0 || subtotal >= basePesos;
  if (!aplica) return { pct: 0, valor: 0, cuenta: null, aplica: false, nota: `No aplica — subtotal $${subtotal.toLocaleString("es-CO")} < base ${fila.b} UVT ($${basePesos.toLocaleString("es-CO")})` };

  const valor = Math.round(subtotal * fila.r / 100);

  // Buscar cuenta retención en PUC — tabla directa por tipo+persona+tarifa
  // Busca cuentas 23x cuyo nombre contenga la tarifa y el concepto
  let cuenta = null;
  if (pucCuentas.length > 0) {
    const cands23 = pucCuentas.filter(c => c.codigo.startsWith("23"));
    const tarifaStr = String(fila.r).replace(".", ",");
    const tarifaStr2 = String(fila.r);

    // Función de búsqueda por coincidencia en nombre
    const buscar = (terminos) => cands23.find(c => {
      const nom = (c.nombre || "").toLowerCase();
      return terminos.every(t => nom.includes(t.toLowerCase()));
    });

    // Buscar por nombre exacto según PUC real de la empresa
    // Patrones basados en nombres reales: "compras del 2.5% persona juridica"
    if (tipo === "compras" && pNorm === "juridica")
      cuenta = buscar(["2.5","juridica"]) || buscar(["2.5","compra"]) || buscar(["compra","juridica"]);
    else if (tipo === "compras" && pNorm === "natural")
      cuenta = buscar(["2.5","natural"]) || buscar(["3.5","natural"]) || buscar(["compra","natural"]);
    else if (tipo === "compras" && pNorm === "no_decl")
      cuenta = buscar(["3.5","natural"]) || buscar(["3.5","compra"]) || buscar(["compra","natural"]);
    else if (tipo === "honorarios" && pNorm === "juridica")
      cuenta = buscar(["11","honor","juridica"]) || buscar(["11","honor"]);
    else if (tipo === "honorarios")
      cuenta = buscar(["10","honor","natural"]) || buscar(["10","honor"]);
    else if (tipo === "servicios" && pNorm === "juridica")
      cuenta = buscar(["4","serv","juridica"]) || buscar(["4","serv"]);
    else if (tipo === "servicios")
      cuenta = buscar(["4","serv","natural"]) || buscar(["6","serv"]) || buscar(["serv","natural"]);
    else if (tipo === "transporte" && pNorm === "juridica")
      cuenta = buscar(["1","transport","juridica"]) || buscar(["1","carga","juridica"]) || buscar(["transport"]);
    else if (tipo === "transporte")
      cuenta = buscar(["1","transport","natural"]) || buscar(["1","carga"]) || buscar(["transport"]);
    else if (tipo === "arrend_inmueble")
      cuenta = buscar(["3.5","arrend"]) || buscar(["arrend","inmueble"]) || buscar(["arrend"]);
    else if (tipo === "arrend_mueble")
      cuenta = buscar(["4","arrend"]) || buscar(["mueble","arrend"]);
    else if (tipo === "obra_civil")
      cuenta = buscar(["2","obra"]) || buscar(["obra"]);
    else if (tipo === "vigilancia")
      cuenta = buscar(["2","vigil"]) || buscar(["aseo","vigil"]) || buscar(["vigil"]);
    else if (tipo === "combustibles" && pNorm === "juridica")
      cuenta = buscar(["0.1","juridica"]) || buscar(["0.1","combust"]) || buscar(["combustible","juridica"]);
    else if (tipo === "combustibles")
      cuenta = buscar(["0.1","natural"]) || buscar(["0.1","combust"]) || buscar(["combustible","natural"]);
    else if (tipo === "comisiones" && pNorm === "juridica")
      cuenta = buscar(["11","comis","juridica"]) || buscar(["11","comis"]);
    else if (tipo === "comisiones")
      cuenta = buscar(["10","comis","natural"]) || buscar(["10","comis"]);

    // Fallback: buscar por tarifa exacta en cuentas 23x
    if (!cuenta) cuenta = buscar([tarifaStr2,"juridica"]) || buscar([tarifaStr2,"natural"]) || buscar([tarifaStr2]);
  }

  return {
    pct: fila.r, valor, aplica: true,
    cuenta: cuenta ? { codigo: cuenta.codigo, nombre: cuenta.nombre } : null,
    nota: `${fila.r}% sobre $${subtotal.toLocaleString("es-CO")} = $${valor.toLocaleString("es-CO")}${basePesos > 0 ? ` (base ${fila.b} UVT)` : " (primer peso)"}`,
  };
}

// Detectar persona jurídica/natural
// Regla: NIT de 9+ dígitos SIEMPRE es jurídica (Colombia)
// Cédula tiene máximo 10 dígitos pero NIT empresarial tiene exactamente 9
// AdditionalAccountID puede venir mal en algunos XMLs — NIT es más confiable
function detectarPersona(nitStr, razonSocial, schemeID, additionalAccountID) {
  const nit = (nitStr || "").replace(/[^0-9]/g, "");
  const razon = (razonSocial || "").toUpperCase();

  // NIT exactamente 9 dígitos = empresa jurídica (regla Colombia)
  if (nit.length === 9) return "juridica";

  // schemeID cédula → natural (solo si NIT no es de 9 dígitos)
  const schemeCed = ["6","13"];
  if (schemeCed.includes(schemeID)) return "natural";

  // AdditionalAccountID
  if (additionalAccountID === "2" && nit.length < 9) return "natural";
  if (additionalAccountID === "1") return "juridica";

  // Razón social
  if (/S\.A\.S|S\.A\b|LTDA|S\.C\.A|E\.U\.|E\.S\.P|S\.E\.M|INC\.|CORP\b|CIA\b|COMPAÑIA|EMPRESA|INDUSTRIA|COMERCIALIZADORA|DISTRIBUIDORA|CONSTRUCTORA|INGENIERIA|COLOMBIA|CONSORCIO|TEMPORAL|FUNDACION|COOPERATIVA|ASOCIACION|GRUPO/.test(razon)) return "juridica";

  // NIT largo (10 dígitos con DV) también es jurídica
  if (nit.length >= 9) return "juridica";

  return "natural";
}

// ─── TERCEROS ─────────────────────────────────────────────────────────────────
function calcularDV(nit) {
  const n = String(nit).trim().replace(/[^0-9]/g,"");
  if (!n) return "";
  const primos = [3,7,13,17,19,23,29,37,41,43,47];
  let suma = 0;
  n.split("").reverse().forEach((d,i) => { if(i<primos.length) suma += parseInt(d)*primos[i]; });
  const r = suma % 11;
  return String(r < 2 ? r : 11 - r);
}

function extraerTercero(datos, persona, esAutorretenedor, empresaId) {
  const nit = (datos.nitProveedor||"").replace(/[^0-9]/g,"");
  if (!nit) return null;
  const tlc = (datos.taxLevelCode||"").toUpperCase();
  let regimen = "Responsable IVA";
  if (tlc.includes("O-48")||tlc.includes("R-99")) regimen = "No Responsable IVA";
  if (tlc.includes("O-47")) regimen = "Régimen Simple";
  if (tlc.includes("O-13")) regimen = "Gran Contribuyente";
  // tipo_doc: 31=NIT (jurídica), 13=cédula (natural)
  const tipo_doc = persona === "juridica" ? "31" : "13";
  return {
    empresa_id:           empresaId,
    tipo_doc,
    numero:               nit,
    digito_verificacion:  calcularDV(nit),
    razon_social:         datos.razonSocial||"",
    nombre:               datos.razonSocial||"",
    direccion:            datos.direccion||"",
    telefono:             datos.telefono||"",
    celular:              "",
    email:                datos.email||"",
    ciudad:               datos.ciudad||"",
    departamento:         datos.departamento||"",
    pais:                 "Colombia",
    persona:              persona === "juridica" ? "Jurídica" : "Natural",
    regimen,
    es_cliente:           false,
    es_proveedor:         true,
    es_empleado:          false,
    gran_contribuyente:   tlc.includes("O-13"),
    autoretenedor:        esAutorretenedor,
    agente_retencion_iva: tlc.includes("O-15"),
    del_exterior:         false,
  };
}

async function upsertTerceroSB(tercero) {
  if (!tercero?.numero || !tercero?.empresa_id) return;
  try {
    // Verificar si existe por numero + empresa_id
    const existe = await sbGet("terceros", { numero: tercero.numero, empresa_id: tercero.empresa_id });
    if (existe && existe.length > 0) {
      // Solo completar campos vacíos — no sobreescribir datos existentes
      const actual = existe[0];
      const update = { id: actual.id, numero: tercero.numero, empresa_id: tercero.empresa_id };
      Object.keys(tercero).forEach(k => {
        const val = tercero[k];
        if (val !== undefined && val !== "" && val !== null && (!actual[k] || actual[k] === "")) {
          update[k] = val;
        }
      });
      await sbUpsert("terceros", update);
    } else {
      await sbUpsert("terceros", tercero);
    }
  } catch(e) { console.warn("upsertTercero error:", e.message); }
}

// ─── PARSE XML ────────────────────────────────────────────────────────────────
// Campos clave según XMLs reales DIAN:
// AdditionalAccountID: 1=jurídica, 2=natural
// CompanyID schemeID: 1,2,3,8,9=NIT(jurídica) | 6,13=cédula(natural)
// TaxLevelCode: O-13=Gran Contribuyente, O-15=Autorretenedor IVA
function parseXML(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const ns  = (tag) => doc.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";
    const sup = doc.getElementsByTagNameNS("*", "AccountingSupplierParty")[0];
    const gn  = (node, tag) => node?.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";
    const ga  = (node, tag, attr) => { const n = node?.getElementsByTagNameNS("*", tag)[0]; return n?.getAttribute?.(attr) || ""; };
    const rnd = v => Math.round(parseFloat(v || "0"));

    // AdditionalAccountID del proveedor: 1=jurídica, 2=natural
    const additionalAccountID = gn(sup, "AdditionalAccountID") ||
      sup?.parentElement?.querySelector?.("AdditionalAccountID")?.textContent?.trim() ||
      doc.getElementsByTagNameNS("*", "AdditionalAccountID")[0]?.textContent?.trim() || "1";

    // schemeID del CompanyID del proveedor
    const companyIDNode = sup?.getElementsByTagNameNS("*", "CompanyID")[0];
    const schemeID = companyIDNode?.getAttribute("schemeID") || "";

    const taxLevelCode = gn(sup, "TaxLevelCode");

    const items = Array.from(doc.getElementsByTagNameNS("*", "InvoiceLine")).map(l => ({
      descripcion: l.getElementsByTagNameNS("*", "Description")[0]?.textContent?.trim() || "",
      cantidad:    parseFloat(l.getElementsByTagNameNS("*", "InvoicedQuantity")[0]?.textContent || "1"),
      valor:       rnd(l.getElementsByTagNameNS("*", "LineExtensionAmount")[0]?.textContent),
    }));

    return {
      prefijo:      ns("ID"),
      fecha:        ns("IssueDate"),
      nitProveedor: gn(sup, "CompanyID") || ns("CompanyID"),
      razonSocial:  gn(sup, "RegistrationName") || ns("RegistrationName"),
      schemeID,           // schemeID del CompanyID
      additionalAccountID, // 1=jurídica, 2=natural
      taxLevelCode,        // O-13=GC, O-15=AutoRetIVA, R-99-PN=no responsable
      esGranContribuyente: taxLevelCode.includes("O-13"),
      esAutorretenedorIVA: taxLevelCode.includes("O-15"),
      direccion:    gn(sup, "Line"),
      ciudad:       gn(sup, "CityName"),
      departamento: gn(sup, "CountrySubentity"),
      telefono:     gn(sup, "Telephone"),
      email:        gn(sup, "ElectronicMail"),
      subtotal:     rnd(ns("LineExtensionAmount")),
      totalIva:     rnd(ns("TaxAmount")),
      total:        rnd(ns("PayableAmount")),
      items,
    };
  } catch { return null; }
}

// ─── CALL CLAUDE ──────────────────────────────────────────────────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callClaude(body, intento = 0) {
  const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // 429 = rate limit, 529 = overloaded — ambos se reintentan con backoff
  if (res.status === 429 || res.status === 529) {
    if (intento >= 5) throw new Error("Claude sobrecargado. Espera 2 minutos e intenta de nuevo.");
    const espera = (intento + 1) * 20000; // 20s, 40s, 60s, 80s, 100s
    console.log(`[ContaIA] Claude ${res.status} — reintento ${intento+1} en ${espera/1000}s`);
    await sleep(espera);
    return callClaude(body, intento + 1);
  }
  if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t}`); }
  const data = await res.json();
  if (data.error) {
    // overloaded_error desde el body también se reintenta
    if (data.error?.type === "overloaded_error" && intento < 5) {
      const espera = (intento + 1) * 20000;
      console.log(`[ContaIA] overloaded_error — reintento ${intento+1} en ${espera/1000}s`);
      await sleep(espera);
      return callClaude(body, intento + 1);
    }
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data;
}

// ─── ANALIZAR CON IA (solo tipo de gasto + cuenta de costo) ──────────────────
// La IA YA NO calcula retenciones ni asigna cuentas de retención.
// Solo identifica: tipo de transacción y cuenta de costo/gasto del PUC.
async function analizarConIA(datos, tratamiento, tratIva, pucCuentas) {
  if (!pucCuentas || pucCuentas.length === 0) throw new Error("PUC vacío — configura el PUC de la empresa en Supabase.");

  const pucTexto = pucCuentas
    .filter(c => {
      const cod = c.codigo || "";
      if (tratamiento === "inventario") return cod.startsWith("1");
      return cod.startsWith("6") || cod.startsWith("5");
    })
    .map(c => `${c.codigo}\t${c.nombre}`)
    .join("\n");

  const itemsTexto = (datos.items || []).map(i => `- ${i.descripcion} | $${i.valor.toLocaleString("es-CO")}`).join("\n") || "(sin ítems)";

  const cuentasIva = pucCuentas.filter(c => {
    const cod = c.codigo || "";
    if (tratIva === "descontable") return cod.startsWith("24");
    return cod.startsWith("61") || cod.startsWith("51");
  }).filter(c => /iva|impuesto.*venta/i.test(c.nombre)).map(c => `${c.codigo}\t${c.nombre}`).join("\n");

  const prompt = `Contador colombiano. SOLO JSON, sin texto extra.

FACTURA: ${datos.razonSocial} | ${datos.fecha}
ITEMS: ${itemsTexto}
SUBTOTAL: $${(datos.subtotal||0).toLocaleString("es-CO")} | IVA: $${(datos.totalIva||0).toLocaleString("es-CO")}
TRATAMIENTO: ${tratamiento === "inventario" ? "INVENTARIO-cuentas 1x" : "GASTO-cuentas 6x/5x"}

PUC (SOLO estas cuentas):
${pucTexto || "(vacío)"}

IVA (SOLO estas):
${cuentasIva || "(ninguna)"}

tipo_retencion: compras|servicios|honorarios|transporte|arrend_inmueble|arrend_mueble|obra_civil|vigilancia|combustibles|comisiones|no_aplica

JSON:
{"concepto_general":"","tipo_retencion":"compras","lineas_contables":[{"descripcion":"","valor":0,"cuenta_codigo":"","cuenta_nombre":""}],"cuenta_iva_codigo":"","cuenta_iva_nombre":"","advertencia":""}`;

  const data = await callClaude({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: prompt }] });
  const text = data.content?.map(b => b.text || "").join("").replace(/\`\`\`json|\`\`\`/g, "").trim();
  return JSON.parse(text);
}

// ─── CONSTRUIR ASIENTO (CÓDIGO, no IA) ───────────────────────────────────────
function construirAsiento(datos, ia, rete, pucCuentas, esAutorretenedor, tratIva) {
  const filas = [];
  let totalDeb = 0;

  // 1. Líneas de costo/gasto/inventario
  (ia.lineas_contables || []).forEach((l, i) => {
    const val = Math.round(l.valor || 0);
    if (!val) return;
    filas.push({ id: `lc${i}`, tipo: "debito", cuenta: l.cuenta_codigo || "", descripcion: l.descripcion || ia.concepto_general, valor: val, editable: true, eliminable: true, advertencia: !l.cuenta_codigo });
    totalDeb += val;
  });

  // Si no hay líneas, usar subtotal completo con advertencia
  if (filas.length === 0) {
    filas.push({ id: "lc0", tipo: "debito", cuenta: "", descripcion: ia.concepto_general || "Gasto / Costo", valor: datos.subtotal || 0, editable: true, eliminable: true, advertencia: true });
    totalDeb = datos.subtotal || 0;
  }

  // 2. IVA
  if ((datos.totalIva || 0) > 0 && ia.cuenta_iva_codigo) {
    filas.push({ id: "iva", tipo: "debito", cuenta: ia.cuenta_iva_codigo, descripcion: ia.cuenta_iva_nombre || "IVA", valor: datos.totalIva, editable: true, eliminable: true, advertencia: false });
    totalDeb += datos.totalIva;
  }

  // 3. Retención (calculada por CÓDIGO, no por IA)
  let totalCre = 0;
  if (!esAutorretenedor && rete.valor > 0 && rete.cuenta) {
    filas.push({ id: "rete", tipo: "credito", cuenta: rete.cuenta.codigo, descripcion: `ReteFuente ${rete.pct}% — ${ia.tipo_retencion}`, valor: rete.valor, editable: true, eliminable: true, advertencia: false });
    totalCre += rete.valor;
  }

  // 4. Proveedor (diferencia)
  const neto = Math.max(0, totalDeb - totalCre);
  // Buscar cuenta proveedores en PUC — código completo 8 dígitos
  const ctaProv = pucCuentas.find(c => /proveedor/i.test(c.nombre) && c.codigo.startsWith("22") && c.codigo.length === 8)
    || pucCuentas.find(c => /proveedor/i.test(c.nombre) && c.codigo.startsWith("22"))
    || { codigo: "22050101", nombre: "Proveedores nacionales" };
  filas.push({ id: "prov", tipo: "credito", cuenta: ctaProv.codigo, descripcion: `Proveedor — ${(datos.razonSocial || "").slice(0, 40)}`, valor: neto, editable: true, eliminable: false, advertencia: false, editadoManual: false });

  return filas;
}

// ─── HOOK: datos desde Supabase ───────────────────────────────────────────────
function useSupabase() {
  const [empresas,       setEmpresas]       = useState([]);
  const [empresaActual,  setEmpresaActualSt] = useState(null);
  const [pucCuentas,     setPucCuentas]     = useState([]);
  const [autorretenedores, setAutorretenedores] = useState({});
  const [cargando,       setCargando]       = useState(true);

  useEffect(() => {
    (async () => {
      const [emps, autos] = await Promise.all([
        sbGet("empresas"),
        sbGet("dian_autorretenedores"),
      ]);
      setEmpresas(emps || []);
      const autoMap = {};
      (autos || []).forEach(a => { autoMap[a.nit] = a.razon_social; });
      setAutorretenedores(autoMap);

      // Cargar última empresa usada
      const ultNit = localStorage.getItem("contaia_empresa_nit");
      const emp = (emps || []).find(e => e.nit === ultNit) || (emps || [])[0];
      if (emp) {
        setEmpresaActualSt(emp);
        const puc = await sbGet("puc_auxiliares", { empresa_id: emp.id });
        setPucCuentas(puc || []);
      }
      setCargando(false);
    })();
  }, []);

  const setEmpresaActual = async (emp) => {
    setEmpresaActualSt(emp);
    localStorage.setItem("contaia_empresa_nit", emp.nit);
    setCargando(true);
    const puc = await sbGet("puc_auxiliares", { empresa_id: emp.id });
    setPucCuentas(puc || []);
    setCargando(false);
  };

  return { empresas, empresaActual, setEmpresaActual, pucCuentas, autorretenedores, cargando };
}

// ─── HOOK: facturas con persistencia ─────────────────────────────────────────
function useFacturas() {
  const [facturas, setFacturasRaw] = useState(() => {
    try {
      const raw = localStorage.getItem("contaia_facturas_v4");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const hoy = new Date().toISOString().slice(0, 10);
      return parsed.filter(f => (f.fechaCarga || "").startsWith(hoy));
    } catch { return []; }
  });

  const setFacturas = (upd) => {
    setFacturasRaw(prev => {
      const next = typeof upd === "function" ? upd(prev) : upd;
      try { localStorage.setItem("contaia_facturas_v4", JSON.stringify(next)); } catch { }
      return next;
    });
  };
  const limpiar = () => { setFacturasRaw([]); localStorage.removeItem("contaia_facturas_v4"); };
  return { facturas, setFacturas, limpiar };
}

// ─── COMPONENTE: CeldaEditable ────────────────────────────────────────────────
function CeldaEditable({ valor, onChange, tipo = "text", style = {} }) {
  const [editando, setEditando] = useState(false);
  const [tmp, setTmp] = useState(valor);
  const ok = () => { onChange(tipo === "number" ? parseFloat(tmp) || 0 : tmp); setEditando(false); };
  if (editando) return <input autoFocus type={tipo} value={tmp} onChange={e => setTmp(e.target.value)} onBlur={ok} onKeyDown={e => { if (e.key === "Enter") ok(); if (e.key === "Escape") setEditando(false); }} style={{ background: "#0d101a", border: "1px solid #4f7cff", color: "#e2e8f0", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", fontSize: 11, width: "100%", outline: "none", ...style }} />;
  return <span onClick={() => { setTmp(valor); setEditando(true); }} title="Clic para editar" style={{ cursor: "pointer", borderBottom: "1px dashed #2d3352", paddingBottom: 1, ...style }}>{valor}</span>;
}

// ─── COMPONENTE: FacturaCard ──────────────────────────────────────────────────
function FacturaCard({ f, idx, docNum, onUpdate, onAprender }) {
  const [expandido, setExpandido] = useState(true);
  const fmt = n => `$${Number(n || 0).toLocaleString("es-CO")}`;

  const recalcProv = fs => {
    const deb = fs.filter(r => r.tipo === "debito").reduce((s, r) => s + r.valor, 0);
    const cre = fs.filter(r => r.tipo === "credito" && r.id !== "prov").reduce((s, r) => s + r.valor, 0);
    return fs.map(r => r.id === "prov" && !r.editadoManual ? { ...r, valor: Math.max(0, deb - cre) } : r);
  };

  const [filas, setFilas] = useState(() => f.asiento || []);
  const updFila  = (id, campo, valor) => { const n = recalcProv(filas.map(r => r.id === id ? { ...r, [campo]: valor, editadoManual: id === "prov" ? true : r.editadoManual } : r)); setFilas(n); onUpdate(f.id, "asiento", n); };
  const elimFila = id => { const n = recalcProv(filas.filter(r => r.id !== id)); setFilas(n); onUpdate(f.id, "asiento", n); };
  const addFila  = () => { const n = recalcProv([...filas.filter(r => r.id !== "prov"), { id: `x${Date.now()}`, tipo: "debito", descripcion: "Nueva línea", valor: 0, cuenta: "", editable: true, eliminable: true, advertencia: true }, ...filas.filter(r => r.id === "prov")]); setFilas(n); onUpdate(f.id, "asiento", n); };

  const totalDeb = filas.filter(r => r.tipo === "debito").reduce((s, r) => s + r.valor, 0);
  const totalCre = filas.filter(r => r.tipo === "credito").reduce((s, r) => s + r.valor, 0);
  const cuadra   = Math.abs(totalDeb - totalCre) < 1;
  const neto     = filas.find(r => r.id === "prov")?.valor || 0;
  const hayAdv   = filas.some(r => r.advertencia);

  if (f.error) return (
    <div style={{ background: "#1a0a0a", border: "1px solid #3b1f1f", borderRadius: 10, padding: "12px 18px", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ color: "#64748b", fontSize: 11 }}>#{String(idx + 1).padStart(2, "0")}</span>
      <span style={{ color: "#f87171", fontSize: 13 }}>❌ {f.archivo}: {f.error}</span>
    </div>
  );

  return (
    <div id={`factura-${f.id}`} style={{ background: "#161923", border: `1px solid ${f.aprobado ? "#166534" : cuadra ? "#232840" : "#7c3700"}`, borderRadius: 12, overflow: "hidden" }}>
      {/* Cabecera */}
      <div style={{ background: "#0d101a", borderBottom: "1px solid #1e2235", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>#{String(idx + 1).padStart(2, "0")}</span>
        {docNum && <span style={{ background: "#1e2a3a", color: "#60a5fa", padding: "2px 9px", borderRadius: 4, fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>DocNum:{docNum}</span>}
        <span style={{ background: f.tratamiento === "inventario" ? "#1e3a5f" : "#2d1b4e", color: f.tratamiento === "inventario" ? "#60a5fa" : "#c084fc", border: "1px solid #44", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>{f.tratamiento === "inventario" ? "📦 Inventario" : "📉 Costo/Gasto"}</span>
        {f.esAutorretenedor && <span style={{ background: "#2d1a00", color: "#fb923c", border: "1px solid #7c370066", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>🔒 Autorretenedor</span>}
        {hayAdv && <span style={{ background: "#2d2000", color: "#fbbf24", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>⚠ Verificar cuenta</span>}
        {!cuadra && <span style={{ background: "#3b1f1f", color: "#f87171", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>⚡ Descuadrado</span>}
        {f.aprobado && <span style={{ background: "#14532d", color: "#86efac", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>✓ Aprobado</span>}
        {f.enviado && <span style={{ background: "#2d1b4e", color: "#c084fc", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>🚀 Enviada</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => setExpandido(e => !e)} style={{ background: "transparent", border: "1px solid #2d3352", color: "#94a3b8", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>{expandido ? "▲" : "▼ Asiento"}</button>
          {f.enviado && (
            <button onClick={() => { if(confirm("¿Eliminar esta factura? Ya fue enviada a ContaFlex.")) onUpdate(f.id, "_eliminar", true); }}
              style={{ background: "transparent", border: "1px solid #3b1f1f", color: "#f87171", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>🗑</button>
          )}
          <button onClick={() => {
            if (!cuadra) { alert("El asiento está descuadrado. Revisa antes de aprobar."); return; }
            onUpdate(f.id, "asiento", filas);
            const nuevoEstado = !f.aprobado;
            onUpdate(f.id, "aprobado", nuevoEstado);
            // Guardar en Supabase dian_facturas al aprobar
            if (nuevoEstado) {
              const registro = {
                empresa_nit:   f.empresa?.nit || "",
                archivo:       f.archivo || "",
                prefijo:       f.prefijo || "",
                fecha:         f.fecha || "",
                nit_proveedor: f.nitProveedor || "",
                razon_social:  f.razonSocial || "",
                subtotal:      f.subtotal || 0,
                iva:           f.totalIva || 0,
                total:         f.total || 0,
                retefuente:    f.retefuente || 0,
                retica:        f.retica || 0,
                tratamiento:   f.tratamiento || "",
                concepto:      f.ia?.concepto_general || "",
                asiento:       filas,
                aprobado:      true,
                fecha_carga:   new Date().toISOString(),
              };
              sbUpsert("dian_facturas", registro).catch(() => {});
            }
          }} style={{ background: f.aprobado ? "#14532d" : "#4f7cff", color: f.aprobado ? "#86efac" : "#fff", border: "none", borderRadius: 6, padding: "3px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{f.aprobado ? "✓ Aprobado" : "Aprobar"}</button>
        </div>
      </div>

      {/* Info factura */}
      <div style={{ padding: "11px 16px", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 220 }}>
          <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 14, color: "#fff", marginBottom: 2 }}>{f.razonSocial || f.archivo}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "#64748b" }}>
            {f.nitProveedor && <span>NIT <span style={{ color: "#94a3b8" }}>{f.nitProveedor}</span></span>}
            {f.prefijo && <span>N° <span style={{ color: "#94a3b8" }}>{f.prefijo}</span></span>}
            {f.fecha && <span>📅 <span style={{ color: "#94a3b8" }}>{f.fecha}</span></span>}
            {f.persona && <span style={{ color: f.persona === "juridica" ? "#60a5fa" : "#fb923c" }}>{f.persona === "juridica" ? "PJ" : "PN"}</span>}
          </div>
          {f.ia?.concepto_general && <div style={{ marginTop: 4, fontSize: 12, color: "#c084fc", fontStyle: "italic" }}>«{f.ia.concepto_general}»</div>}
          {f.reteInfo && <div style={{ marginTop: 3, fontSize: 11, color: f.reteInfo.aplica ? "#fbbf24" : "#475569" }}>📋 {f.reteInfo.nota}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[{ l: "Subtotal", v: f.subtotal, c: "#cbd5e1" }, { l: "IVA", v: f.totalIva, c: "#60a5fa" }, { l: "Total", v: f.total, c: "#4ade80", big: true }, { l: "Neto", v: neto, c: "#fbbf24", big: true }].map(({ l, v, c, big }) => (
            <div key={l} style={{ background: "#0d101a", borderRadius: 7, padding: "6px 10px", textAlign: "center", minWidth: 72 }}>
              <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>{l}</div>
              <div style={{ fontSize: big ? 13 : 11, fontWeight: big ? 700 : 500, color: c, whiteSpace: "nowrap" }}>{fmt(v)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Asiento editable */}
      {expandido && f.ia && (
        <div style={{ borderTop: "1px solid #1e2235", padding: "12px 16px", background: "#0f1117" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".07em" }}>✏️ Asiento editable</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: cuadra ? "#22c55e" : "#f87171", fontWeight: 600 }}>{cuadra ? "✓ Cuadrado" : "⚡ Descuadrado"}</span>
              {!f.aprobado && <button onClick={addFila} style={{ background: "transparent", border: "1px solid #2d3f6e", color: "#60a5fa", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 11 }}>+ Línea</button>}
            </div>
          </div>
          <div style={{ background: "#0d101a", borderRadius: 7, overflow: "hidden", border: `1px solid ${cuadra ? "#1e2235" : "#7c3700"}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#131620" }}>{["Tipo", "PlnCod", "Descripción", "Débito", "Crédito", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 9px", color: "#475569", fontSize: 10, fontWeight: 600, textTransform: "uppercase", borderBottom: "1px solid #1e2235" }}>{h}</th>)}</tr></thead>
              <tbody>
                {filas.map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #1a1d27", background: r.advertencia ? "#1a120022" : r.id === "prov" ? "#0a0d14" : "transparent" }}>
                    <td style={{ padding: "6px 9px" }}>
                      {!f.aprobado && r.editable && r.id !== "prov"
                        ? <select value={r.tipo} onChange={e => updFila(r.id, "tipo", e.target.value)} style={{ background: "#1e2235", border: "1px solid #2d3352", color: r.tipo === "debito" ? "#4ade80" : "#f87171", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}><option value="debito">DÉB</option><option value="credito">CRÉ</option></select>
                        : <span style={{ fontSize: 10, fontWeight: 700, color: r.tipo === "debito" ? "#4ade80" : "#f87171", background: r.tipo === "debito" ? "#0a2010" : "#200a0a", padding: "2px 7px", borderRadius: 4 }}>{r.tipo === "debito" ? "DÉB" : "CRÉ"}</span>}
                    </td>
                    <td style={{ padding: "6px 9px" }}>
                      {!f.aprobado && r.editable ? <CeldaEditable valor={r.cuenta} onChange={v => updFila(r.id, "cuenta", v)} style={{ fontFamily: "monospace", color: r.advertencia ? "#fb923c" : "#60a5fa", fontWeight: 600 }} /> : <span style={{ fontFamily: "monospace", color: r.advertencia ? "#fb923c" : "#60a5fa", fontWeight: 600 }}>{r.cuenta}</span>}
                      {r.advertencia && <span style={{ marginLeft: 4, fontSize: 9, color: "#fbbf24" }}>⚠</span>}
                    </td>
                    <td style={{ padding: "6px 9px", maxWidth: 180 }}>
                      {!f.aprobado && r.editable ? <CeldaEditable valor={r.descripcion} onChange={v => updFila(r.id, "descripcion", v)} style={{ color: "#cbd5e1" }} /> : <span style={{ color: "#94a3b8" }}>{r.descripcion}</span>}
                    </td>
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>
                      {r.tipo === "debito" ? (!f.aprobado && r.editable ? <CeldaEditable valor={r.valor} onChange={v => updFila(r.id, "valor", v)} tipo="number" style={{ color: "#4ade80", fontWeight: 600, textAlign: "right" }} /> : <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmt(r.valor)}</span>) : <span style={{ color: "#2d3352" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>
                      {r.tipo === "credito" ? (!f.aprobado && r.editable ? <CeldaEditable valor={r.valor} onChange={v => updFila(r.id, "valor", v)} tipo="number" style={{ color: r.id === "prov" ? "#fbbf24" : "#f87171", fontWeight: 600, textAlign: "right" }} /> : <span style={{ color: r.id === "prov" ? "#fbbf24" : "#f87171", fontWeight: r.id === "prov" ? 700 : 600 }}>{fmt(r.valor)}</span>) : <span style={{ color: "#2d3352" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 9px", textAlign: "center" }}>
                      {!f.aprobado && r.eliminable ? <button onClick={() => elimFila(r.id)} style={{ background: "transparent", border: "1px solid #3b1f1f", color: "#f87171", borderRadius: 4, padding: "2px 7px", cursor: "pointer", fontSize: 11 }}>🗑</button>
                        : r.id === "prov" ? <span style={{ fontSize: 10, color: r.editadoManual ? "#fb923c" : "#fbbf24" }}>{r.editadoManual ? "editado" : "auto"}</span>
                          : <span style={{ fontSize: 10, color: f.aprobado ? "#22c55e" : "#475569" }}>{f.aprobado ? "🔒" : ""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: "#131620", borderTop: "2px solid #1e2235" }}>
                <td colSpan={3} style={{ padding: "6px 9px", color: "#64748b", fontSize: 11, fontWeight: 600 }}>TOTALES</td>
                <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: "#4ade80", fontSize: 12 }}>{fmt(totalDeb)}</td>
                <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: "#f87171", fontSize: 12 }}>{fmt(totalCre)}</td>
                <td style={{ padding: "6px 9px", textAlign: "center" }}><span style={{ fontWeight: 700, color: cuadra ? "#22c55e" : "#f87171" }}>{cuadra ? "✓" : "✗"}</span></td>
              </tr></tfoot>
            </table>
          </div>
          {!f.aprobado && <div style={{ marginTop: 7, fontSize: 10, color: "#475569" }}>💡 Clic sobre cualquier valor para editar · <strong style={{ color: "#fbbf24" }}>Proveedor</strong> se recalcula automáticamente.</div>}
        </div>
      )}
    </div>
  );
}

// ─── MODAL TRATAMIENTO ────────────────────────────────────────────────────────
function ModalTratamiento({ archivos, empresaActual, empresas, onEmpresa, onConfirm, onCancel }) {
  const [tratamiento, setTratamiento] = useState(null);
  const [tratIva,     setTratIva]     = useState(null);
  const listo = tratamiento && tratIva && empresaActual;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#161923", border: "1px solid #232840", borderRadius: 16, padding: 26, maxWidth: 540, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📋</div>
          <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4 }}>¿Cómo se contabiliza?</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>{archivos.length === 1 ? `📄 ${archivos[0].name}` : `${archivos.length} archivos`}</div>
        </div>
        {!empresaActual && empresas.length > 0 && (
          <div style={{ background: "#1e2a3a", border: "1px solid #4f7cff", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#60a5fa", marginBottom: 6, fontWeight: 600 }}>🏢 Selecciona la empresa</div>
            <select defaultValue="" onChange={e => { const emp = empresas.find(x => x.nit === e.target.value); if (emp) onEmpresa(emp); }} style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 12, cursor: "pointer", outline: "none" }}>
              <option value="" disabled>— elige empresa —</option>
              {empresas.map(e => <option key={e.nit} value={e.nit}>{e.nombre} · {e.nit}</option>)}
            </select>
          </div>
        )}
        {empresaActual && <div style={{ background: "#0a1a0a", border: "1px solid #166534", borderRadius: 6, padding: "6px 12px", marginBottom: 14, fontSize: 11, color: "#4ade80" }}>🏢 <strong>{empresaActual.nombre}</strong> · {empresaActual.nit}</div>}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Paso 1 — Tratamiento</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[{ key: "inventario", icono: "📦", titulo: "Inventario", desc: "Ítem por ítem · cuentas 1x", color: "#1e3a5f", borde: "#3b6fd4" }, { key: "gasto", icono: "📉", titulo: "Costo / Gasto", desc: "Concepto resumido · cuentas 6x/5x", color: "#2d1b4e", borde: "#8b5cf6" }].map(op => (
              <button key={op.key} onClick={() => setTratamiento(op.key)} style={{ background: tratamiento === op.key ? op.color : "#0f1117", border: `2px solid ${tratamiento === op.key ? op.borde : "#232840"}`, borderRadius: 10, padding: "13px", cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}><span style={{ fontSize: 17 }}>{op.icono}</span><span style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 13, color: "#fff" }}>{op.titulo}</span>{tratamiento === op.key && <span style={{ marginLeft: "auto", color: op.borde }}>✓</span>}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{op.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Paso 2 — IVA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[{ key: "descontable", icono: "🔄", titulo: "IVA descontable", desc: "Activo · cuentas 24x", color: "#1e3a5f", borde: "#3b6fd4" }, { key: "gasto", icono: "📉", titulo: "IVA al gasto (consorcio)", desc: "Cuentas 61157001 / 61157002", color: "#1a2d1a", borde: "#22c55e" }].map(op => (
              <button key={op.key} onClick={() => setTratIva(op.key)} style={{ background: tratIva === op.key ? op.color : "#0f1117", border: `2px solid ${tratIva === op.key ? op.borde : "#232840"}`, borderRadius: 9, padding: "10px 13px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 17, minWidth: 22 }}>{op.icono}</span>
                <div style={{ flex: 1 }}><div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 13, color: "#fff", marginBottom: 2 }}>{op.titulo}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{op.desc}</div></div>
                {tratIva === op.key && <span style={{ fontSize: 14, color: op.borde }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
        <div style={{ background: "#0a1a0a", border: "1px solid #166534", borderRadius: 6, padding: "6px 12px", marginBottom: 14, fontSize: 11, color: "#4ade80" }}>✓ <strong>Retenciones calculadas por código</strong> — no por IA. Reglas DIAN exactas.</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "transparent", border: "1px solid #2d3352", color: "#94a3b8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
          <button onClick={() => listo && onConfirm(tratamiento, tratIva)} disabled={!listo} style={{ background: listo ? "#4f7cff" : "#1e2235", color: listo ? "#fff" : "#475569", border: "none", padding: "8px 22px", borderRadius: 6, cursor: listo ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700 }}>{listo ? "Procesar →" : !empresaActual ? "Selecciona empresa primero" : "Completa los 2 pasos"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL EXPORT ─────────────────────────────────────────────────────────────
function ModalExport({ facturas, onClose, pucCuentas = [] }) {
  const aprobadas = facturas.filter(f => f.aprobado && !f.error).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));

  // Verificador pre-exportación
  const errores = [];
  aprobadas.forEach(f => {
    (f.asiento||[]).forEach(r => {
      if (!r.cuenta) { errores.push(`${f.razonSocial}: línea sin cuenta`); return; }
      if (pucCuentas.length > 0 && !pucCuentas.find(c => c.codigo === r.cuenta))
        errores.push(`${f.razonSocial}: cuenta ${r.cuenta} no existe en PUC`);
    });
    const deb = (f.asiento||[]).filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0);
    const cre = (f.asiento||[]).filter(r=>r.tipo==="credito").reduce((s,r)=>s+r.valor,0);
    if (Math.abs(deb-cre)>1) errores.push(`${f.razonSocial}: asiento descuadrado ($${deb.toLocaleString("es-CO")} vs $${cre.toLocaleString("es-CO")})`);
  });
  const [cfg, setCfg] = useState({ docNumInicio: "1", tpcCod: "CO", prfCod: "", docAux: "", ctoCod: "" });
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));
  const fmt = n => `$${Number(n || 0).toLocaleString("es-CO")}`;
  const headers = ["DocNum", "DocFec", "TpcCod", "PlnCod", "DocDet", "TerNit", "CtoCod", "DocDeb", "DocCre", "PrfCod", "DocAux", "SubCto"];

  const exportar = (soloUna = null) => {
    const lista = soloUna ? [soloUna] : aprobadas;
    const wsData = [headers];
    lista.forEach((f, fi) => {
      const docNum = (parseInt(cfg.docNumInicio) || 1) + fi;
      (f.asiento || []).forEach(r => {
        wsData.push([docNum, f.fecha || "", cfg.tpcCod, r.cuenta, r.descripcion, f.nitProveedor || "", cfg.ctoCod, r.tipo === "debito" ? r.valor : "", r.tipo === "credito" ? r.valor : "", cfg.prfCod, cfg.docAux, ""]);
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{wch:8},{wch:12},{wch:8},{wch:12},{wch:45},{wch:14},{wch:10},{wch:14},{wch:14},{wch:10},{wch:14},{wch:8}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Comprobante");
    XLSX.writeFile(wb, soloUna ? `comprobante_${soloUna.prefijo || soloUna.nitProveedor}.xlsx` : `comprobante_${cfg.tpcCod}_${cfg.docNumInicio}.xlsx`);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#161923", border: "1px solid #232840", borderRadius: 16, padding: 26, maxWidth: 700, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div><div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 16, color: "#fff" }}>⬇ Exportar comprobante contable</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{aprobadas.length} facturas aprobadas</div></div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #2d3352", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 18 }}>
          {[{ k: "docNumInicio", label: "DocNum inicial", ph: "1" }, { k: "tpcCod", label: "TpcCod", ph: "CO" }, { k: "prfCod", label: "PrfCod", ph: "COMP" }, { k: "ctoCod", label: "Centro de costo", ph: "CC001" }, { k: "docAux", label: "DocAux", ph: "OC-2026" }].map(({ k, label, ph }) => (
            <div key={k}><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 3 }}>{label}</div><input value={cfg[k]} onChange={e => set(k, e.target.value)} placeholder={ph} style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontFamily: "monospace", fontSize: 12, outline: "none" }} /></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 130, overflowY: "auto", border: "1px solid #1e2235", borderRadius: 6, padding: "6px 8px", minWidth: 210 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, marginBottom: 2 }}>📄 Por factura:</div>
            {aprobadas.map((f, i) => <button key={f.id} onClick={() => exportar(f)} style={{ background: "transparent", border: "1px solid #2d3352", color: "#94a3b8", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 10, textAlign: "left", whiteSpace: "nowrap" }}>⬇ {cfg.tpcCod}{(parseInt(cfg.docNumInicio) || 1) + i} · {(f.razonSocial || "").slice(0, 18)}</button>)}
          </div>
          <div style={{flex:1}}>
            {errores.length > 0 && (
              <div style={{background:"#1a0a0a",border:"1px solid #7c3700",borderRadius:8,padding:"10px 14px",maxHeight:120,overflowY:"auto"}}>
                <div style={{fontSize:11,color:"#f87171",fontWeight:600,marginBottom:6}}>⚠ {errores.length} problema{errores.length>1?"s":""} detectado{errores.length>1?"s":""} — revisar antes de exportar:</div>
                {errores.map((e,i)=><div key={i} style={{fontSize:10,color:"#fb923c",marginBottom:2}}>• {e}</div>)}
              </div>
            )}
            {errores.length === 0 && aprobadas.length > 0 && (
              <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:8,padding:"8px 14px",fontSize:11,color:"#4ade80"}}>✓ Todo verificado — {aprobadas.length} facturas listas para ContaFlex</div>
            )}
          </div>
          <button onClick={() => { if(errores.length>0&&!confirm(`Hay ${errores.length} problema(s). ¿Exportar de todas formas?`)) return; exportar(); }} disabled={aprobadas.length === 0} style={{ background: aprobadas.length ? (errores.length>0?"#f59e0b":"#4f7cff") : "#1e2235", color: aprobadas.length ? "#fff" : "#475569", border: "none", borderRadius: 8, padding: "10px 22px", cursor: aprobadas.length ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700 }}>⬇ Exportar a ContaFlex ({aprobadas.length})</button>
        </div>
      </div>
    </div>
  );
}

// ─── PANTALLA LOGIN ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [clave,   setClave]   = useState("");
  const [error,   setError]   = useState("");
  const intentar = async () => {
    if (!usuario || !clave) { setError("Ingresa usuario y clave"); return; }
    // Verificar contra tabla empresas de Supabase
    const rows = await sbGet("empresas", { usuario });
    const found = rows.find(r => r.clave === clave);
    if (found) { onLogin(found); return; }
    // Fallback admin local
    if (usuario === "admin" && clave === "contai2026") { onLogin({ usuario: "admin", nombre: "Administrador", id: "admin" }); return; }
    setError("Usuario o clave incorrectos");
  };
  return (
    <div style={{ fontFamily: "monospace", background: "#0f1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#161923", border: "1px solid #232840", borderRadius: 16, padding: 36, maxWidth: 380, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, background: "linear-gradient(135deg,#4f7cff,#8b5cf6)", borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 12 }}>⚡</div>
          <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 20, color: "#fff" }}>ContaIA DIAN</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Contabilización automática con IA</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 5 }}>Usuario</div><input value={usuario} onChange={e => setUsuario(e.target.value)} onKeyDown={e => e.key === "Enter" && intentar()} placeholder="admin" autoFocus style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 13, outline: "none", boxSizing: "border-box" }} /></div>
          <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 5 }}>Clave</div><input type="password" value={clave} onChange={e => setClave(e.target.value)} onKeyDown={e => e.key === "Enter" && intentar()} placeholder="••••••••" style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 13, outline: "none", boxSizing: "border-box" }} /></div>
          {error && <div style={{ background: "#1a0a0a", border: "1px solid #3b1f1f", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#f87171" }}>⚠ {error}</div>}
          <button onClick={intentar} style={{ background: "#4f7cff", color: "#fff", border: "none", borderRadius: 8, padding: "11px", cursor: "pointer", fontSize: 14, fontWeight: 700, marginTop: 4 }}>Ingresar →</button>
        </div>
        <div style={{ marginTop: 20, fontSize: 10, color: "#475569", textAlign: "center" }}>Supabase · Multi-empresa · ContaFlex</div>
      </div>
    </div>
  );
}

// ─── FACTURAS DE PRUEBA ───────────────────────────────────────────────────────
const FACTURAS_TEST = [
  { nombre: "Ferretería (materiales)", icono: "🔩", color: "#1e3a5f", xml: `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>FE-2026-1047</cbc:ID><cbc:IssueDate>2026-03-02</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID schemeID="31">900123456</cbc:CompanyID><cbc:RegistrationName>FERRETERÍA EL CLAVO DORADO S.A.S.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">47500</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">250000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">297500</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>5</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">125000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Cemento gris x 50kg</cbc:Description></cac:Item></cac:InvoiceLine><cac:InvoiceLine><cbc:InvoicedQuantity>100</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">125000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Varilla corrugada 1/2 pulgada</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre: "Transporte de carga", icono: "🚛", color: "#1a2d1a", xml: `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>TRP-2026-0312</cbc:ID><cbc:IssueDate>2026-03-10</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID schemeID="31">800234567</cbc:CompanyID><cbc:RegistrationName>TRANSPORTES RÁPIDOS DEL NORTE LTDA.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">850000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Flete terrestre Bogotá-Villavicencio 3 toneladas</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre: "Honorarios persona natural", icono: "👨‍💼", color: "#1a1a2e", xml: `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>HON-2026-0089</cbc:ID><cbc:IssueDate>2026-03-15</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID schemeID="13">79654321</cbc:CompanyID><cbc:RegistrationName>CARLOS ANDRÉS GÓMEZ REYES</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">2000000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Honorarios revisoría fiscal marzo 2026</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre: "Bayer S.A. (autorretenedor)", icono: "🔒", color: "#2d1a00", xml: `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>BAYER-FV-20260320</cbc:ID><cbc:IssueDate>2026-03-20</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID schemeID="31">860001942</cbc:CompanyID><cbc:RegistrationName>BAYER S.A.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">285000</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">1785000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>10</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Productos químicos construcción</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
];

// ─── PANEL CORRECCIÓN MASIVA ──────────────────────────────────────────────────
function PanelCorreccion({ facturas, pucCuentas, onUpdate, onClose }) {
  // Recopilar todas las cuentas usadas en el lote
  const cuentasUsadas = {};
  facturas.filter(f => !f.error && f.asiento).forEach(f => {
    (f.asiento || []).forEach(r => {
      if (!r.cuenta || r.id === "prov") return;
      if (!cuentasUsadas[r.cuenta]) {
        const enPuc = pucCuentas.find(c => c.codigo === r.cuenta);
        cuentasUsadas[r.cuenta] = {
          codigo: r.cuenta,
          descripcion: r.descripcion,
          count: 0,
          enPuc: !!enPuc,
          nombrePuc: enPuc?.nombre || "",
          facturas: []
        };
      }
      cuentasUsadas[r.cuenta].count++;
      if (!cuentasUsadas[r.cuenta].facturas.includes(f.id))
        cuentasUsadas[r.cuenta].facturas.push(f.id);
    });
  });

  const lista = Object.values(cuentasUsadas).sort((a,b) => (a.enPuc===b.enPuc)?0:a.enPuc?1:-1);
  const [correcciones, setCorrecciones] = useState({});
  const [verFacturas, setVerFacturas] = useState(null); // cuenta seleccionada para ver facturas

  const aplicarCorrecciones = () => {
    Object.entries(correcciones).forEach(([cuentaVieja, cuentaNueva]) => {
      if (!cuentaNueva || cuentaNueva === cuentaVieja) return;
      const enPuc = pucCuentas.find(c => c.codigo === cuentaNueva);
      facturas.forEach(f => {
        if (!f.asiento) return;
        const nuevasFila = f.asiento.map(r =>
          r.cuenta === cuentaVieja ? { ...r, cuenta: cuentaNueva, descripcion: enPuc?.nombre || r.descripcion, advertencia: !enPuc } : r
        );
        if (JSON.stringify(nuevasFila) !== JSON.stringify(f.asiento))
          onUpdate(f.id, "asiento", nuevasFila);
      });
    });
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,maxWidth:800,width:"100%",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #1e2235",display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#fff"}}>🔧 Corrección masiva de cuentas</div>
          <span style={{fontSize:11,color:"#64748b"}}>{lista.length} cuentas usadas en este lote</span>
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button onClick={aplicarCorrecciones} style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:6,padding:"6px 16px",cursor:"pointer",fontSize:12,fontWeight:700}}>✓ Aplicar correcciones</button>
            <button onClick={onClose} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>✕</button>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px 20px"}}>
          <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>
            Las cuentas en <span style={{color:"#f87171"}}>rojo</span> no existen en el PUC. Corrígelas aquí y se actualizan en todas las facturas del lote.
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#0d101a"}}>
              {["Cuenta actual","Nombre PUC","Facturas","¿En PUC?","Corregir a"].map(h =>
                <th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235"}}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {lista.map(c => (
                <tr key={c.codigo} style={{borderBottom:"1px solid #1a1d27",background:!c.enPuc?"#1a0a0a":"transparent"}}>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",color:c.enPuc?"#60a5fa":"#f87171",fontWeight:600}}>{c.codigo}</td>
                  <td style={{padding:"6px 10px",color:"#94a3b8",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.nombrePuc||c.descripcion}</td>
                  <td style={{padding:"6px 10px",textAlign:"center"}}>
                    <button onClick={() => setVerFacturas(verFacturas===c.codigo?null:c.codigo)}
                      style={{background:"#1e2a3a",border:"1px solid #2d3f6e",color:"#60a5fa",borderRadius:5,padding:"2px 10px",cursor:"pointer",fontSize:11,fontWeight:600}}>
                      {c.count} ver
                    </button>
                  </td>
                  <td style={{padding:"6px 10px",textAlign:"center"}}>{c.enPuc?<span style={{color:"#22c55e"}}>✓</span>:<span style={{color:"#f87171"}}>✗</span>}</td>
                  <td style={{padding:"6px 10px"}}>
                    <select onChange={e => setCorrecciones(p => ({...p,[c.codigo]:e.target.value}))}
                      style={{background:"#0f1117",border:`1px solid ${!c.enPuc?"#f87171":"#2d3352"}`,color:"#e2e8f0",borderRadius:5,padding:"3px 7px",fontSize:11,width:"100%",cursor:"pointer",outline:"none"}}>
                      <option value="">— sin cambio —</option>
                      {pucCuentas.filter(p=>p.codigo.startsWith(c.codigo.slice(0,2))).map(p=>
                        <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.nombre}</option>
                      )}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {verFacturas && (
          <div style={{background:"#0a0d14",border:"1px solid #2d3f6e",borderRadius:8,margin:"8px 0",padding:"10px 14px"}}>
            <div style={{fontSize:11,color:"#60a5fa",fontWeight:600,marginBottom:8}}>
              Facturas usando cuenta <span style={{fontFamily:"monospace"}}>{verFacturas}</span>:
            </div>
            {facturas.filter(f => f.asiento && (f.asiento||[]).some(r=>r.cuenta===verFacturas)).map(f=>(
              <div key={f.id} style={{display:"flex",gap:10,padding:"5px 0",borderBottom:"1px solid #1a1d27",fontSize:11,alignItems:"center"}}>
                <span style={{fontFamily:"monospace",color:"#94a3b8",minWidth:100}}>{f.prefijo||f.archivo?.slice(0,15)}</span>
                <span style={{color:"#cbd5e1",flex:1}}>{f.razonSocial||f.archivo}</span>
                <span style={{color:"#64748b",minWidth:80}}>{f.fecha}</span>
                <span style={{fontFamily:"monospace",color:"#4ade80",minWidth:100,textAlign:"right"}}>${(f.total||0).toLocaleString("es-CO")}</span>
                <span style={{background:f.aprobado?"#14532d":"#1e2a3a",color:f.aprobado?"#86efac":"#60a5fa",borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:600}}>{f.aprobado?"✓ Aprobada":"Pendiente"}</span>
                <button onClick={() => { onClose(); setTimeout(() => { const el=document.getElementById("factura-"+f.id); if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.outline="2px solid #4f7cff";setTimeout(()=>el.style.outline="",2000);} },200); }}
                  style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:5,padding:"2px 9px",cursor:"pointer",fontSize:10,fontWeight:700}}>→ Ver</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ENVIAR A CONTAFLEX ───────────────────────────────────────────────────────
function generarId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({length:8}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}

async function enviarAContaFlex(facturas, empresaActual, tipoCod = "CO") {
  if (!empresaActual?.id) throw new Error("No hay empresa seleccionada");

  // Ordenar por fecha
  const aprobadas = [...facturas]
    .filter(f => f.aprobado && !f.error && f.asiento)
    .sort((a,b) => (a.fecha||"").localeCompare(b.fecha||""));

  if (aprobadas.length === 0) throw new Error("No hay facturas aprobadas para enviar");

  // Obtener último consecutivo por año
  const porAnno = {};
  aprobadas.forEach(f => {
    const anno = (f.fecha||"2026").slice(0,4);
    if (!porAnno[anno]) porAnno[anno] = [];
    porAnno[anno].push(f);
  });

  const resultados = [];
  let errores = [];

  for (const [anno, facts] of Object.entries(porAnno)) {
    // Consultar último número de ese año y tipo
    let url = `${SB_URL}/rest/v1/comprobantes?select=numero&empresa_id=eq.${empresaActual.id}&tipo_doc=eq.${tipoCod}&fecha=gte.${anno}-01-01&fecha=lte.${anno}-12-31&order=numero.desc&limit=1`;
    let ultimoNum = 0;
    try {
      const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
      const rows = await r.json();
      if (rows && rows.length > 0) {
        const n = parseInt(String(rows[0].numero).replace(/[^0-9]/g,"")) || 0;
        ultimoNum = n;
      }
    } catch(e) { console.warn("Error consultando consecutivo:", e); }

    // Insertar cada factura
    for (const f of facts) {
      ultimoNum++;
      const nit = (f.nitProveedor||"").replace(/[^0-9]/g,"");
      const subtotal = f.subtotal || 0;
      const iva      = f.totalIva || 0;
      const rete     = f.retefuente || 0;
      const reteica  = f.retica || 0;
      const neto     = (f.total||0) - rete - reteica;

      // Buscar cuenta retención del asiento
      const filaRete = (f.asiento||[]).find(r => r.id === "rete");
      const filaIva  = (f.asiento||[]).find(r => r.id === "iva");

      // Construir detalles en formato JSON de ContaFlex
      const detallesJson = (f.asiento||[]).map(r => ({
        id:            generarId(),
        cuenta:        r.cuenta || "",
        detalle:       r.descripcion || "",
        documento:     f.prefijo || "",
        tercero_nit:   nit,
        tercero_nombre: f.razonSocial || "",
        debito:        r.tipo === "debito" ? r.valor : 0,
        credito:       r.tipo === "credito" ? r.valor : 0,
      }));

      const comprobante = {
        id:               generarId(),
        empresa_id:       empresaActual.id,
        tipo_doc:         tipoCod,
        numero:           String(ultimoNum),
        fecha:            f.fecha || new Date().toISOString().slice(0,10),
        tercero_nit:      nit,
        tercero_nombre:   f.razonSocial || "",
        concepto:         f.ia?.concepto_general || f.razonSocial || "",
        estado:           "activo",
        valor_bruto:      subtotal,
        base_retefuente:  rete > 0 ? subtotal : 0,
        tarifa_retefuente: f.rete?.pct || 0,
        valor_retefuente: rete,
        cuenta_retefuente: filaRete?.cuenta || "",
        base_iva:         iva > 0 ? subtotal : 0,
        tarifa_iva:       iva > 0 ? 19 : 0,
        valor_iva:        iva,
        cuenta_iva:       filaIva?.cuenta || "",
        base_reteiva:     0, tarifa_reteiva: 0, valor_reteiva: 0, cuenta_reteiva: "",
        base_reteica:     reteica > 0 ? subtotal : 0,
        tarifa_reteica:   0, valor_reteica: reteica, cuenta_reteica: "",
        neto_pagar:       neto,
        detalles:         JSON.stringify(detallesJson),
      };

      // Insertar comprobante — usamos el id que generamos nosotros
      const compId = comprobante.id;
      const rComp = await fetch(`${SB_URL}/rest/v1/comprobantes`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(comprobante)
      });

      if (!rComp.ok) {
        const err = await rComp.text();
        errores.push(`${f.razonSocial}: ${err}`);
        continue;
      }

      // Insertar detalles del asiento usando el mismo compId
      const detalles = (f.asiento||[]).map(r => ({
        comprobante_id: compId,
        cuenta:         r.cuenta,
        descripcion:    r.descripcion,
        debito:         r.tipo === "debito" ? r.valor : 0,
        credito:        r.tipo === "credito" ? r.valor : 0,
      }));

      // Los detalles ya van dentro del JSON en comprobante.detalles
      resultados.push({ ...f, compNumero: ultimoNum });
    }
  }

  return { resultados, errores };
}

// ─── MODAL ENVIAR A CONTAFLEX ─────────────────────────────────────────────────
function ModalEnviar({ facturas, empresaActual, onClose, onEnviado }) {
  const aprobadas = facturas.filter(f => f.aprobado && !f.error && f.asiento)
    .sort((a,b) => (a.fecha||"").localeCompare(b.fecha||""));
  const [tipoCod,   setTipoCod]   = useState("CO");
  const [enviando,  setEnviando]  = useState(false);
  const [resultado, setResultado] = useState(null);
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;

  const enviar = async () => {
    setEnviando(true);
    try {
      const res = await enviarAContaFlex(facturas, empresaActual, tipoCod);
      setResultado(res);
      if (res.resultados.length > 0) onEnviado(res.resultados);
    } catch(e) {
      setResultado({ resultados:[], errores:[e.message] });
    }
    setEnviando(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,maxWidth:700,width:"100%",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #1e2235",display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#fff"}}>🚀 Enviar a ContaFlex</div>
          <span style={{fontSize:11,color:"#64748b"}}>{aprobadas.length} facturas aprobadas</span>
          <button onClick={onClose} style={{marginLeft:"auto",background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
          {!resultado ? (
            <>
              <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#4ade80"}}>
                ✓ Las facturas se insertarán en <strong>comprobantes</strong> y <strong>comprobante_detalles</strong> de ContaFlex, ordenadas por fecha con consecutivo automático.
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Tipo de comprobante</div>
                <div style={{display:"flex",gap:8}}>
                  {["CO","FC","CE"].map(t => (
                    <button key={t} onClick={() => setTipoCod(t)} style={{background:tipoCod===t?"#1e2a3a":"#0f1117",border:`2px solid ${tipoCod===t?"#4f7cff":"#232840"}`,color:tipoCod===t?"#60a5fa":"#64748b",borderRadius:8,padding:"8px 20px",cursor:"pointer",fontSize:13,fontWeight:700}}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{background:"#0d101a",borderRadius:8,border:"1px solid #1e2235",overflow:"hidden",marginBottom:16}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#131620"}}>
                    {["Fecha","Proveedor","N° Factura","Total","Neto"].map(h =>
                      <th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235"}}>{h}</th>
                    )}
                  </tr></thead>
                  <tbody>
                    {aprobadas.map((f,i) => (
                      <tr key={f.id} style={{borderBottom:"1px solid #1a1d27",background:i%2===0?"transparent":"#0a0d14"}}>
                        <td style={{padding:"5px 10px",color:"#94a3b8"}}>{f.fecha}</td>
                        <td style={{padding:"5px 10px",color:"#cbd5e1",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.razonSocial}</td>
                        <td style={{padding:"5px 10px",color:"#64748b",fontFamily:"monospace"}}>{f.prefijo}</td>
                        <td style={{padding:"5px 10px",color:"#4ade80",fontWeight:600}}>{fmt(f.total)}</td>
                        <td style={{padding:"5px 10px",color:"#fbbf24",fontWeight:600}}>{fmt((f.total||0)-(f.retefuente||0)-(f.retica||0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{background:"#0f1a2e",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#60a5fa"}}>
                <strong>Empresa:</strong> {empresaActual?.nombre} · {empresaActual?.nit}<br/>
                <strong>Tipo doc:</strong> {tipoCod} · <strong>Consecutivo:</strong> automático por año de fecha factura<br/>
                <strong>Ordenado por:</strong> fecha ascendente
              </div>
            </>
          ) : (
            <div>
              {resultado.resultados.length > 0 && (
                <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#4ade80",marginBottom:8}}>✓ {resultado.resultados.length} facturas enviadas a ContaFlex</div>
                  {resultado.resultados.map(f => (
                    <div key={f.id} style={{fontSize:11,color:"#94a3b8",marginBottom:3}}>
                      {tipoCod}-{String(f.compNumero).padStart(4,"0")} · {f.fecha} · {f.razonSocial} · {fmt(f.total)}
                    </div>
                  ))}
                </div>
              )}
              {resultado.errores.length > 0 && (
                <div style={{background:"#1a0a0a",border:"1px solid #7c3700",borderRadius:8,padding:"12px 16px"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#f87171",marginBottom:8}}>✗ {resultado.errores.length} errores</div>
                  {resultado.errores.map((e,i) => <div key={i} style={{fontSize:11,color:"#fb923c",marginBottom:3}}>• {e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{padding:"12px 20px",borderTop:"1px solid #1e2235",display:"flex",gap:10,justifyContent:"flex-end"}}>
          {!resultado ? (
            <>
              <button onClick={onClose} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
              <button onClick={enviar} disabled={enviando||aprobadas.length===0} style={{background:enviando?"#1e2235":"#22c55e",color:"#fff",border:"none",borderRadius:6,padding:"8px 22px",cursor:enviando?"not-allowed":"pointer",fontSize:13,fontWeight:700}}>
                {enviando ? "Enviando..." : `🚀 Enviar ${aprobadas.length} facturas`}
              </button>
            </>
          ) : (
            <button onClick={onClose} style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:6,padding:"8px 22px",cursor:"pointer",fontSize:13,fontWeight:700}}>Cerrar</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [usuarioActual, setUsuarioActual] = useState(null);
  const { empresas, empresaActual, setEmpresaActual, pucCuentas, autorretenedores, cargando } = useSupabase();
  const { facturas, setFacturas, limpiar } = useFacturas();
  const [modal,        setModal]        = useState(null);
  const [procesando,   setProcesando]   = useState(false);
  const [progreso,     setProgreso]     = useState({ actual: 0, total: 0 });
  const [modalExport,  setModalExport]  = useState(false);
  const [testAbierto,  setTestAbierto]  = useState(false);
  const [modalTerceros,   setModalTerceros]   = useState(false);
  const [modalCorreccion, setModalCorreccion] = useState(false);
  const [modalEnviar,    setModalEnviar]    = useState(false);
  const [tercerosList,  setTercerosList]  = useState([]);

  // Cargar terceros al montar
  useEffect(() => {
    if (!empresaActual?.id) return;
    sbGet("terceros", { empresa_id: empresaActual.id }).then(t => setTercerosList(t || []));
  }, [empresaActual?.id]);

  if (!usuarioActual) return <LoginScreen onLogin={setUsuarioActual} />;

  const recibirArchivos = (lista) => {
    const v = Array.from(lista).filter(f => f.name.endsWith(".xml") || f.name.endsWith(".pdf"));
    if (v.length) setModal({ archivos: v });
  };

  const confirmarTratamiento = async (tratamiento, tratIva) => {
    const { archivos } = modal;
    setModal(null); setProcesando(true);
    setProgreso({ actual: 0, total: archivos.length });

    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ actual: i + 1, total: archivos.length });
      await (async (archivo) => {
        try {
          let datos = {};

          // Pre-validar duplicado antes de procesar
          if (archivo.name.toLowerCase().endsWith(".xml")) {
            const xmlText = await archivo.text();
            const datosPreview = parseXML(xmlText) || {};
            if (datosPreview.prefijo && datosPreview.nitProveedor) {
              const nit_prev = (datosPreview.nitProveedor||"").replace(/[^0-9]/g,"");
              const dup = await sbGet("dian_facturas", {
                prefijo: datosPreview.prefijo,
                nit_proveedor: nit_prev,
                empresa_nit: empresaActual?.nit || ""
              });
              if (dup && dup.length > 0) {
                const d = dup[0];
                const diasAtras = Math.floor((Date.now() - new Date(d.fecha_carga)) / 86400000);
                setFacturas(prev => [...prev, {
                  id: Date.now()+Math.random(), fechaCarga: new Date().toISOString(),
                  archivo: archivo.name,
                  error: `⚠️ DUPLICADO — Esta factura ya fue contabilizada hace ${diasAtras} días (${d.fecha_carga?.slice(0,10)}). Proveedor: ${d.razon_social}. Total: $${(d.total||0).toLocaleString("es-CO")}.`
                }]);
                return;
              }
            }
          }

          if (archivo.name.toLowerCase().endsWith(".pdf")) {
            const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("No se pudo leer PDF")); r.readAsDataURL(archivo); });
            const d = await callClaude({ model: "claude-sonnet-4-5", max_tokens: 1500, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, { type: "text", text: `Extrae datos de esta factura. SOLO JSON sin markdown: {"prefijo":"","fecha":"YYYY-MM-DD","nitProveedor":"","razonSocial":"","schemeID":"31","subtotal":0,"totalIva":0,"total":0,"items":[{"descripcion":"","cantidad":1,"valor":0}]}` }] }] });
            datos = JSON.parse(d.content.map(b => b.text || "").join("").replace(/```json|```/g, "").trim());
          } else {
            const t = await archivo.text(); datos = parseXML(t) || {};
          }

          // REGLAS EN CÓDIGO: detectar persona y autorretenedor
          const nit         = (datos.nitProveedor || "").replace(/[^0-9]/g, "");
          // Autorretenedor: verificar en tabla Supabase O por taxLevelCode XML
          const esAutoRet   = !!autorretenedores[nit] || !!datos.esAutorretenedorIVA;
          // Persona: usar AdditionalAccountID del XML (más confiable que schemeID)
          const persona     = detectarPersona(nit, datos.razonSocial, datos.schemeID, datos.additionalAccountID);

          // REGLAS EN CÓDIGO: la IA solo identifica tipo y cuenta de costo
          const ia = await analizarConIA(datos, tratamiento, tratIva, pucCuentas);

          // REGLAS EN CÓDIGO: calcular retención exacta
          const rete = calcularRetencion(ia.tipo_retencion, persona, datos.fecha || "2026-01-01", datos.subtotal || 0, pucCuentas, esAutoRet);

          // Guardar tercero en Supabase
          const tercero = extraerTercero(datos, persona, esAutoRet, empresaActual?.id);
          if (tercero) upsertTerceroSB(tercero).catch(()=>{});

          // CÓDIGO: construir asiento completo
          const asiento = construirAsiento(datos, ia, rete, pucCuentas, esAutoRet, tratIva);

          setFacturas(prev => [...prev, {
            id: Date.now() + Math.random(), fechaCarga: new Date().toISOString(),
            archivo: archivo.name, tratamiento, tratIva, empresa: empresaActual,
            ...datos, nit, persona, ia, rete, reteInfo: rete,
            retefuente: rete.valor, esAutorretenedor: esAutoRet,
            aprobado: false, asiento,
          }]);
        } catch (e) {
          setFacturas(prev => [...prev, { id: Date.now() + Math.random(), fechaCarga: new Date().toISOString(), archivo: archivo.name, error: e.message }]);
        }
      })(archivos[i]);
      // Espera entre facturas — 3s siempre para evitar rate limit
      if (i < archivos.length - 1) await sleep(3000);
    }
    setProcesando(false);
  };

  const upd = (id, k, v) => {
    if (k === "_eliminar") { setFacturas(p => p.filter(f => f.id !== id)); return; }
    setFacturas(p => p.map(f => f.id === id ? { ...f, [k]: v } : f));
  };
  const aprobadas = facturas.filter(f => f.aprobado && !f.error).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  const fmt = n => `$${Number(n || 0).toLocaleString("es-CO")}`;

  return (
    <div style={{ fontFamily: "monospace", background: "#0f1117", color: "#e2e8f0", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <style>{`*{box-sizing:border-box} ::-webkit-scrollbar{width:10px;height:10px} ::-webkit-scrollbar-track{background:#0d101a;border-radius:6px} ::-webkit-scrollbar-thumb{background:#3a3f5c;border-radius:6px;border:2px solid #0d101a} ::-webkit-scrollbar-thumb:hover{background:#4f7cff} .dz{border:2px dashed #2d3352;border-radius:14px;padding:44px 24px;text-align:center;transition:all .2s;cursor:pointer} .dz:hover,.dz.over{border-color:#4f7cff;background:rgba(79,124,255,.05)} @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {modal && <ModalTratamiento archivos={modal.archivos} empresaActual={empresaActual} empresas={empresas} onEmpresa={setEmpresaActual} onConfirm={confirmarTratamiento} onCancel={() => setModal(null)} />}
      {modalExport && <ModalExport facturas={facturas} onClose={() => setModalExport(false)} pucCuentas={pucCuentas} />}
      {modalEnviar && <ModalEnviar facturas={facturas} empresaActual={empresaActual} onClose={() => setModalEnviar(false)} onEnviado={(res) => {
          setModalEnviar(false);
          // Marcar facturas como enviadas en el estado local
          res.forEach(f => upd(f.id, "enviado", true));
        }} />}
      {modalCorreccion && <PanelCorreccion facturas={facturas} pucCuentas={pucCuentas} onUpdate={upd} onClose={() => setModalCorreccion(false)} />}
      {modalTerceros && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:3000,display:"flex",flexDirection:"column",padding:16}}>
          <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"14px 20px",borderBottom:"1px solid #1e2235",display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#fff"}}>👥 Terceros</div>
              <span style={{fontSize:11,color:"#4ade80",background:"#0a1a0a",border:"1px solid #166534",borderRadius:5,padding:"2px 9px"}}>{tercerosList.length} proveedores</span>
              <button onClick={() => {
                const headers = ["tipo_doc","numero","digito_verificacion","razon_social","nombre","direccion","telefono","celular","email","ciudad","departamento","pais","persona","regimen","es_cliente","es_proveedor","es_empleado","gran_contribuyente","autoretenedor","agente_retencion_iva","del_exterior"];
                const ws = XLSX.utils.aoa_to_sheet([headers,...tercerosList.map(t=>headers.map(h=>t[h]||""))]);
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Terceros");
                XLSX.writeFile(wb,`Terceros_${new Date().toISOString().slice(0,10)}.xlsx`);
              }} style={{background:"#166534",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:600,marginLeft:"auto"}}>⬇ Excel</button>
              <button onClick={() => setModalTerceros(false)} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>✕</button>
            </div>
            <div style={{flex:1,overflowX:"auto",overflowY:"auto"}}>
              {tercerosList.length === 0
                ? <div style={{padding:40,textAlign:"center",color:"#475569"}}>Sin terceros aún — se agregan al procesar facturas</div>
                : <table style={{borderCollapse:"collapse",fontSize:11,minWidth:"100%"}}>
                    <thead><tr style={{background:"#0d101a",position:"sticky",top:0}}>
                      {["NIT","DV","Razón Social","Teléfono","Email","Ciudad","Persona","Régimen","AutoRet"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235",whiteSpace:"nowrap"}}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {tercerosList.map((t,i)=>(
                        <tr key={t.numero} style={{borderBottom:"1px solid #1a1d27",background:i%2===0?"transparent":"#0a0d14"}}>
                          <td style={{padding:"5px 10px",fontFamily:"monospace",color:"#60a5fa"}}>{t.numero}</td>
                          <td style={{padding:"5px 10px",color:"#64748b"}}>{t.digito_verificacion}</td>
                          <td style={{padding:"5px 10px",color:"#e2e8f0",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.razon_social}</td>
                          <td style={{padding:"5px 10px",color:"#94a3b8"}}>{t.telefono}</td>
                          <td style={{padding:"5px 10px",color:"#94a3b8",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.email}</td>
                          <td style={{padding:"5px 10px",color:"#94a3b8"}}>{t.ciudad}</td>
                          <td style={{padding:"5px 10px",color:t.persona==="Jurídica"?"#60a5fa":"#fb923c"}}>{t.persona}</td>
                          <td style={{padding:"5px 10px",color:"#64748b",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.regimen}</td>
                          <td style={{padding:"5px 10px",textAlign:"center"}}>{t.autoretenedor?<span style={{color:"#fb923c",fontWeight:700}}>🔒</span>:<span style={{color:"#2d3352"}}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
            </div>
          </div>
        </div>
      )}

      {/* NAVBAR */}
      <div style={{ background: "#0d101a", borderBottom: "1px solid #1e2235", padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#4f7cff,#8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>⚡</div>
          <div><div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 13, color: "#fff" }}>ContaIA DIAN</div><div style={{ fontSize: 9, color: "#64748b" }}>Supabase · Reglas DIAN</div></div>
        </div>

        {/* Selector empresa */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, maxWidth: 360, margin: "0 12px" }}>
          <span style={{ fontSize: 11, color: "#475569" }}>🏢</span>
          {empresas.length === 0
            ? <span style={{ fontSize: 11, color: "#f87171" }}>Sin empresas en Supabase</span>
            : <select value={empresaActual?.nit || ""} onChange={e => { const emp = empresas.find(x => x.nit === e.target.value); if (emp) setEmpresaActual(emp); }} style={{ flex: 1, background: "#0f1117", border: "1px solid #2d3352", color: "#e2e8f0", borderRadius: 6, padding: "5px 8px", fontSize: 11, cursor: "pointer", outline: "none" }}>
              {empresas.map(e => <option key={e.nit} value={e.nit}>{e.nombre} · {e.nit}</option>)}
            </select>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          {cargando && <span style={{ fontSize: 11, color: "#64748b" }}>⏳</span>}
          {!cargando && empresaActual && <div style={{ background: "#0a1a0a", border: "1px solid #166534", borderRadius: 5, padding: "3px 9px", fontSize: 10, color: "#4ade80", fontWeight: 600 }}>✓ {pucCuentas.length} cuentas PUC</div>}
          <div style={{ fontSize: 10, color: "#64748b" }}>👤 {usuarioActual?.usuario || usuarioActual?.nombre}</div>
          {facturas.length > 0 && <div style={{ fontSize: 11, color: "#64748b" }}><span style={{ color: "#4f7cff", fontWeight: 700 }}>{facturas.filter(f => !f.error).length}</span>/<span style={{ color: "#22c55e", fontWeight: 700 }}>{aprobadas.length}</span></div>}
          {facturas.filter(f => !f.error && f.asiento).length > 0 && (
            <button onClick={() => setModalCorreccion(true)} style={{ background: "transparent", border: "1px solid #f59e0b", color: "#f59e0b", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🔧 Cuentas</button>
          )}
          {facturas.filter(f => !f.aprobado && !f.error && f.asiento).length > 0 && (
            <button onClick={() => {
              const cuadradas = facturas.filter(f => !f.aprobado && !f.error && f.asiento);
              cuadradas.forEach(f => { upd(f.id, "aprobado", true); });
            }} style={{ background: "#4f7cff", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✓ Aprobar todas</button>
          )}
          {aprobadas.length > 0 && <button onClick={() => setModalExport(true)} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>⬇ Excel</button>}
          {aprobadas.length > 0 && <button onClick={() => setModalEnviar(true)} style={{ background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🚀 ContaFlex</button>}
          {aprobadas.length > 0 && (
            <button onClick={() => { setFacturas(prev => prev.filter(f => !f.aprobado)); }} style={{ background: "transparent", border: "1px solid #166534", color: "#4ade80", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Eliminar facturas aprobadas">🗑 Aprobadas</button>
          )}
          {facturas.some(f => f.enviado) && (
            <button onClick={() => { if(confirm("¿Eliminar las facturas ya enviadas a ContaFlex?")) setFacturas(p => p.filter(f => !f.enviado)); }}
              style={{ background: "transparent", border: "1px solid #166534", color: "#4ade80", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Eliminar enviadas a ContaFlex">🗑 Enviadas</button>
          )}
          {facturas.length > 0 && <button onClick={limpiar} style={{ background: "transparent", border: "1px solid #2d3352", color: "#64748b", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }} title="Limpiar todo">🗑 Todo</button>}
          <button onClick={() => setModalTerceros(true)} style={{ background: "transparent", border: "1px solid #2d3352", color: "#60a5fa", borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600 }} title="Ver terceros">👥</button>
          <button onClick={() => { setUsuarioActual(null); limpiar(); }} style={{ background: "transparent", border: "1px solid #3b1f1f", color: "#f87171", borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>🚪</button>
        </div>
      </div>

      {/* CONTENIDO */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px" }}>

          {/* Drop zone */}
          <div className="dz" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }} onDragLeave={e => e.currentTarget.classList.remove("over")} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("over"); recibirArchivos(e.dataTransfer.files); }} onClick={() => document.getElementById("fi").click()}>
            <input id="fi" type="file" multiple accept=".xml,.pdf" style={{ display: "none" }} onChange={e => recibirArchivos(e.target.files)} />
            {procesando
              ? <div><div style={{ fontSize: 28, marginBottom: 8, display: "inline-block", animation: "spin 1s linear infinite" }}>⚙️</div><div style={{ fontFamily: "sans-serif", fontSize: 14, color: "#4f7cff", fontWeight: 600 }}>Procesando con IA…</div>{progreso.total > 1 && <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{progreso.actual} de {progreso.total}</div>}</div>
              : <div><div style={{ fontSize: 34, marginBottom: 8 }}>📂</div><div style={{ fontFamily: "sans-serif", fontSize: 14, fontWeight: 600, color: "#cbd5e1" }}>Arrastra facturas XML o PDF aquí</div>{empresaActual && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Empresa: <span style={{ color: "#60a5fa" }}>{empresaActual.nombre}</span> · {pucCuentas.length} cuentas · {Object.keys(autorretenedores).length} autorretenedores</div>}</div>}
          </div>

          {/* Panel de pruebas */}
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setTestAbierto(a => !a)} style={{ background: "transparent", border: "1px dashed #2d3f6e", color: "#60a5fa", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>🧪 {testAbierto ? "Ocultar" : "Panel de pruebas"} {testAbierto ? "▲" : "▼"}</button>
            {testAbierto && (
              <div style={{ background: "#0d101a", border: "1px dashed #2d3f6e", borderTop: "none", borderRadius: "0 0 9px 9px", padding: "11px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>4 facturas de prueba — validan reglas DIAN y PUC Supabase</span>
                  <button onClick={() => recibirArchivos(FACTURAS_TEST.map((t, i) => new File([new Blob([t.xml], { type: "text/xml" })], `test-${i + 1}.xml`, { type: "text/xml" })))} style={{ background: "#4f7cff", color: "#fff", border: "none", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>▶ Cargar las 4</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {FACTURAS_TEST.map(t => (
                    <div key={t.nombre} style={{ background: t.color, border: "1px solid #1e2a3a", borderRadius: 7, padding: "8px 10px", display: "flex", gap: 7, alignItems: "center" }}>
                      <span style={{ fontSize: 17 }}>{t.icono}</span>
                      <div style={{ flex: 1, fontSize: 12, color: "#e2e8f0", fontFamily: "sans-serif", fontWeight: 600 }}>{t.nombre}</div>
                      <button onClick={() => recibirArchivos([new File([new Blob([t.xml], { type: "text/xml" })], `test.xml`, { type: "text/xml" })])} style={{ background: "transparent", border: "1px solid #2d3f6e", color: "#60a5fa", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 10 }}>▶</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Lista facturas */}
          {facturas.length > 0 && (
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 14, color: "#fff" }}>
                Facturas <span style={{ color: "#4f7cff" }}>({facturas.length})</span>
                {empresaActual && <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400, marginLeft: 10 }}>· {empresaActual.nombre}</span>}
              </div>
              {[...aprobadas, ...facturas.filter(f => !f.aprobado || f.error)].map((f, i) => (
                <FacturaCard key={f.id} f={f} idx={facturas.indexOf(f)} onUpdate={upd} docNum={f.aprobado && !f.error ? (parseInt("1") || 1) + aprobadas.findIndex(a => a.id === f.id) : null} onAprender={() => {}} />
              ))}

              {aprobadas.length > 0 && (
                <div style={{ background: "#0f1a2e", border: "1px solid #1e3a5f", borderRadius: 10, padding: "16px 20px", marginTop: 4, marginBottom: 20 }}>
                  <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 13, color: "#60a5fa", marginBottom: 12 }}>📊 Resumen · {aprobadas.length} aprobadas</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
                    {[["Total facturado", fmt(aprobadas.reduce((s, f) => s + (f.total || 0), 0)), "#4ade80"], ["(−) ReteFuente", fmt(aprobadas.reduce((s, f) => s + (f.retefuente || 0), 0)), "#f87171"], ["(−) ReteICA", fmt(aprobadas.reduce((s, f) => s + (f.retica || 0), 0)), "#f87171"], ["Neto a pagar", fmt(aprobadas.reduce((s, f) => s + (f.total || 0) - (f.retefuente || 0) - (f.retica || 0), 0)), "#fbbf24"]].map(([l, v, c]) => (
                      <div key={l} style={{ background: "#0d1520", borderRadius: 7, padding: "10px 13px" }}>
                        <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>{l}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setModalExport(true)} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 7, padding: "9px 22px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>⬇ Exportar comprobante Excel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
