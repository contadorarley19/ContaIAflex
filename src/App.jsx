import { useState, useCallback, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

const API_URL = "/.netlify/functions/claude";
const CFG_URL = "/.netlify/functions/config";

// ─── CORRECCIÓN 1: TABLA DE RETENCIONES CON PERIODOS NORMATIVOS ──────────────
// Fuente: bases_retencion_DIAN_v3.xlsx
// UVT 2026 = $52.374 (Res.238/2025 DIAN)
// P1: hasta 2025-05-31      → Decreto 1625/2016
// P2: 2025-06-01→2026-05-07 → Decreto 0572/2025 (bases reducidas)
// P3: desde 2026-05-08      → Boletín DIAN 070/2026 (vuelve a bases originales)
// base_uvt=0 → desde el primer peso; base_uvt>0 → solo retiene si subtotal >= base_uvt × UVT_año

const RETENCIONES_TABLA = [
  // ── COMPRAS ────────────────────────────────────────────────────────────────
  {id:"c00",tipo:"compras",concepto:"Compras bienes muebles – declarante renta",         persona:"juridica",tarifa:2.5,base_uvt:27,fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"c01",tipo:"compras",concepto:"Compras bienes muebles – declarante renta",         persona:"juridica",tarifa:2.5,base_uvt:10,fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"c02",tipo:"compras",concepto:"Compras bienes muebles – declarante renta",         persona:"juridica",tarifa:2.5,base_uvt:27,fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"c03",tipo:"compras",concepto:"Compras bienes muebles – NO declarante renta",      persona:"natural", tarifa:3.5,base_uvt:27,fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"c04",tipo:"compras",concepto:"Compras bienes muebles – NO declarante renta",      persona:"natural", tarifa:3.5,base_uvt:10,fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"c05",tipo:"compras",concepto:"Compras bienes muebles – NO declarante renta",      persona:"natural", tarifa:3.5,base_uvt:27,fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  // ── SERVICIOS ─────────────────────────────────────────────────────────────
  {id:"s06",tipo:"servicios",concepto:"Servicios generales – PJ declarantes",            persona:"juridica",tarifa:4,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"s07",tipo:"servicios",concepto:"Servicios generales – PJ declarantes",            persona:"juridica",tarifa:4,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"s08",tipo:"servicios",concepto:"Servicios generales – PJ declarantes",            persona:"juridica",tarifa:4,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"s09",tipo:"servicios",concepto:"Servicios generales – PN declarantes",            persona:"natural", tarifa:4,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"s10",tipo:"servicios",concepto:"Servicios generales – PN declarantes",            persona:"natural", tarifa:4,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"s11",tipo:"servicios",concepto:"Servicios generales – PN declarantes",            persona:"natural", tarifa:4,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"s12",tipo:"servicios",concepto:"Servicios generales – PN NO declarantes",         persona:"natural", tarifa:6,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"s13",tipo:"servicios",concepto:"Servicios generales – PN NO declarantes",         persona:"natural", tarifa:6,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"s14",tipo:"servicios",concepto:"Servicios generales – PN NO declarantes",         persona:"natural", tarifa:6,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  // ── HONORARIOS (sin base mínima) ──────────────────────────────────────────
  {id:"h15",tipo:"honorarios",concepto:"Honorarios – personas jurídicas",                persona:"juridica",tarifa:11, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT 1625"},
  {id:"h16",tipo:"honorarios",concepto:"Honorarios – PN (≤3.300 UVT anuales)",           persona:"natural", tarifa:10, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT 1625"},
  {id:"h17",tipo:"honorarios",concepto:"Honorarios – PN (>3.300 UVT anuales)",           persona:"natural", tarifa:11, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.383 ET"},
  // ── ARRENDAMIENTOS ────────────────────────────────────────────────────────
  {id:"a18",tipo:"arrendamiento",concepto:"Arrendamiento bienes inmuebles",              persona:"ambas",   tarifa:3.5,base_uvt:27,fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"a19",tipo:"arrendamiento",concepto:"Arrendamiento bienes inmuebles",              persona:"ambas",   tarifa:3.5,base_uvt:10,fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"a20",tipo:"arrendamiento",concepto:"Arrendamiento bienes inmuebles",              persona:"ambas",   tarifa:3.5,base_uvt:27,fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"a21",tipo:"arrendamiento",concepto:"Arrendamiento bienes muebles",               persona:"ambas",   tarifa:4,  base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.4.10 DUT"},
  // ── TRANSPORTE DE CARGA ───────────────────────────────────────────────────
  {id:"t22",tipo:"transporte",concepto:"Transporte carga – personas naturales",          persona:"natural", tarifa:1,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Art.1.2.4.4.8 DUT"},
  {id:"t23",tipo:"transporte",concepto:"Transporte carga – personas naturales",          persona:"natural", tarifa:1,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"t24",tipo:"transporte",concepto:"Transporte carga – personas naturales",          persona:"natural", tarifa:1,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"t25",tipo:"transporte",concepto:"Transporte carga – personas jurídicas",          persona:"juridica",tarifa:1,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Art.1.2.4.4.8 DUT"},
  {id:"t26",tipo:"transporte",concepto:"Transporte carga – personas jurídicas",          persona:"juridica",tarifa:1,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"t27",tipo:"transporte",concepto:"Transporte carga – personas jurídicas",          persona:"juridica",tarifa:1,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  // ── CONSULTORÍA ───────────────────────────────────────────────────────────
  {id:"con28",tipo:"consultoria",concepto:"Consultoría – PJ declarantes",               persona:"juridica",tarifa:4,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"con29",tipo:"consultoria",concepto:"Consultoría – PJ declarantes",               persona:"juridica",tarifa:4,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"con30",tipo:"consultoria",concepto:"Consultoría – PJ declarantes",               persona:"juridica",tarifa:4,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  {id:"con31",tipo:"consultoria",concepto:"Consultoría – PN NO declarantes",            persona:"natural", tarifa:6,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Decreto 1625/2016"},
  {id:"con32",tipo:"consultoria",concepto:"Consultoría – PN NO declarantes",            persona:"natural", tarifa:6,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"con33",tipo:"consultoria",concepto:"Consultoría – PN NO declarantes",            persona:"natural", tarifa:6,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  // ── OBRA CIVIL (sin base) ─────────────────────────────────────────────────
  {id:"o34",tipo:"obra_civil",concepto:"Contratos construcción y obra civil",            persona:"ambas",   tarifa:2,  base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.4.3 DUT"},
  // ── VIGILANCIA / ASEO ────────────────────────────────────────────────────
  {id:"v35",tipo:"vigilancia",concepto:"Vigilancia, aseo y temporales (sobre AIU)",      persona:"juridica",tarifa:2,  base_uvt:4, fi:"2023-01-01",ff:"2025-05-31",norma:"Art.1.2.4.4.10 DUT"},
  {id:"v36",tipo:"vigilancia",concepto:"Vigilancia, aseo y temporales (sobre AIU)",      persona:"juridica",tarifa:2,  base_uvt:2, fi:"2025-06-01",ff:"2026-05-07",norma:"Decreto 0572/2025"},
  {id:"v37",tipo:"vigilancia",concepto:"Vigilancia, aseo y temporales (sobre AIU)",      persona:"juridica",tarifa:2,  base_uvt:4, fi:"2026-05-08",ff:"2099-12-31",norma:"Boletín DIAN 070/2026"},
  // ── COMISIONES (sin base) ─────────────────────────────────────────────────
  {id:"cm38",tipo:"comisiones",concepto:"Comisiones – personas jurídicas",               persona:"juridica",tarifa:11, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT"},
  {id:"cm39",tipo:"comisiones",concepto:"Comisiones – PN declarantes",                   persona:"natural", tarifa:10, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT"},
  {id:"cm40",tipo:"comisiones",concepto:"Comisiones – PN NO declarantes",                persona:"natural", tarifa:11, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT"},
  // ── COMBUSTIBLES (sin base) ───────────────────────────────────────────────
  {id:"cb41",tipo:"combustibles",concepto:"Combustibles derivados del petróleo",         persona:"ambas",   tarifa:0.1,base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.4.7 DUT"},
  // ── PROPIEDAD INTELECTUAL (sin base) ──────────────────────────────────────
  {id:"pi42",tipo:"prop_intelectual",concepto:"Propiedad intelectual/licencias – PJ",   persona:"juridica",tarifa:11, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT"},
  {id:"pi43",tipo:"prop_intelectual",concepto:"Propiedad intelectual/licencias – PN",   persona:"natural", tarifa:10, base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.1.2.4.3.1 DUT"},
  // ── RENDIMIENTOS (sin base) ───────────────────────────────────────────────
  {id:"rf44",tipo:"rendimientos",concepto:"Rendimientos financieros – entidades vigiladas SFC",persona:"juridica",tarifa:7,  base_uvt:0,fi:"2023-01-01",ff:"2099-12-31",norma:"Art.395 ET"},
  {id:"rf45",tipo:"rendimientos",concepto:"Rendimientos financieros – otras entidades",  persona:"juridica",tarifa:2.5,base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:"Art.395 ET"},
  // ── EXENTO ────────────────────────────────────────────────────────────────
  {id:"x46",tipo:"no_aplica",concepto:"No aplica / exento",                              persona:"ambas",   tarifa:0,  base_uvt:0, fi:"2023-01-01",ff:"2099-12-31",norma:""},
];

const UVT_POR_ANNO = {2021:36308,2022:38004,2023:42412,2024:47065,2025:49799,2026:52374};

// Obtiene la fila vigente + calcula base en pesos según año de la factura
function getRetencionVigente(tipo, fecha, subtotal, persona="juridica") {
  const anno = parseInt((fecha||"2026-01-01").slice(0,4)) || 2026;
  const uvt  = UVT_POR_ANNO[anno] || UVT_POR_ANNO[2026];
  const candidatos = RETENCIONES_TABLA.filter(r =>
    r.tipo === tipo &&
    (r.persona === "ambas" || r.persona === persona) &&
    fecha >= r.fi && fecha <= r.ff
  );
  if (!candidatos.length) return {tarifa:0, base_pesos:0, aplica:false, nota:"Concepto no encontrado"};
  const r = candidatos[0];
  const base_pesos = r.base_uvt > 0 ? Math.round(r.base_uvt * uvt) : 0;
  const aplica = base_pesos === 0 || subtotal >= base_pesos;
  return {
    tarifa: aplica ? r.tarifa : 0,
    base_pesos, aplica, norma: r.norma, concepto: r.concepto,
    nota: aplica
      ? (base_pesos > 0 ? `✓ Aplica ${r.tarifa}% (subtotal ≥ ${r.base_uvt} UVT × $${uvt.toLocaleString("es-CO")})` : `✓ Aplica ${r.tarifa}% (desde primer peso)`)
      : `✗ NO aplica — subtotal $${subtotal.toLocaleString("es-CO")} < base ${r.base_uvt} UVT ($${base_pesos.toLocaleString("es-CO")})`,
  };
}

// Genera el texto de retenciones para el prompt IA según la fecha y subtotal de la factura
function buildRetencionesTxt(fecha, subtotal, esJuridica) {
  const persona = esJuridica ? "juridica" : "natural";
  const anno = parseInt((fecha||"2026-01-01").slice(0,4)) || 2026;
  const uvt  = UVT_POR_ANNO[anno] || UVT_POR_ANNO[2026];
  const periodo = fecha <= "2025-05-31" ? "P1 (Decreto 1625/2016)" : fecha <= "2026-05-07" ? "P2 (Decreto 0572/2025 — bases reducidas)" : "P3 (Boletín DIAN 070/2026)";

  const vistos = new Set();
  const lineas = RETENCIONES_TABLA
    .filter(r => fecha >= r.fi && fecha <= r.ff && (r.persona==="ambas"||r.persona===persona))
    .filter(r => { const k=r.tipo; if(vistos.has(k)) return false; vistos.add(k); return true; })
    .map(r => {
      const base_pesos = r.base_uvt > 0 ? Math.round(r.base_uvt * uvt) : 0;
      const aplica = base_pesos === 0 || subtotal >= base_pesos;
      const baseStr = base_pesos > 0
        ? `SOLO si subtotal ≥ $${base_pesos.toLocaleString("es-CO")} (${r.base_uvt} UVT)`
        : "desde primer peso (sin base mínima)";
      return `  • [${r.tipo}] ${r.concepto}: ${r.tarifa}% — ${baseStr} → ${aplica?"✓ APLICA":"✗ NO APLICA"}`;
    });

  return [
    `RETENCIONES vigentes — fecha ${fecha} · Periodo ${periodo} · UVT año ${anno} = $${uvt.toLocaleString("es-CO")}`,
    `Proveedor detectado como persona: ${esJuridica?"JURÍDICA":"NATURAL"}`,
    "",
    ...lineas,
    "",
    "REGLA CRÍTICA: Si dice ✗ NO APLICA → retefuente_pct=0. Si dice ✓ APLICA → usa la tarifa.",
    "Busca la cuenta de retención en el PUC de la empresa (clase 23x). NUNCA uses códigos inventados.",
  ].join("\n");
}

// ─── DATOS POR DEFECTO ───────────────────────────────────────────────────────

const PUC_DEFAULT = [
  ["11050501","Caja general"],["11100501","Puerto concordia"],["11100502","Cumaral"],
  ["11100503","Cumaral colpatria"],["11100504","La macarena"],["11200501","Banco de bogota 351345202"],
  ["13050501","Clientes"],["13300501","A proveedores"],["13551501","1% contrato de obra"],
  ["13551502","1% transporte de carga"],["13551510","10% honorarios"],["13551511","11% honorarios"],
  ["13551535","3.5% compras"],["13551801","Retencion de industri y comercio"],
  ["14100508","Honorarios"],["14300501","Alquileres"],["14301002","Obras civiles"],
  ["14301501","Servicios tecnicos"],["14301504","Aseo y vigilancia"],
  ["14301601","Correo transportes y fletes"],["14301801","Mantenimiento y reparaciones"],
  ["14301901","Adecuacion e instalacion"],["14302001","Instalaciones electricas"],
  ["14305001","Transportes fletes y acarreos"],["14310501","Polizas"],
  ["14350501","Compras para la construccion de obras"],["14450501","Transporte de carga"],
  ["14456001","Telefono"],["14456002","Luz"],["14456003","Acueducto y alcantarillado"],
  ["14530505","Gastos bancarios"],["14531001","Gravamen y movimiento financiero"],
  ["14532001","Intereses"],["14550501","Alojamiento y manutencion"],
  ["14952001","Elementos de aseo y cafeteria"],["14952101","Utiles papeleria y fotocopias"],
  ["14953501","Combustibles y lubricantes"],["14959501","Otros"],
  ["15200501","Maquinaria y equipo"],["15240501","Equipo de oficina"],
  ["22050101","Proveedores"],["23352501","Honorarios por pagar"],["23353001","Servicios por pagar"],
  ["23354001","Arrendamientos por pagar"],["23354501","Transportes fletes por pagar"],
  ["23651510","10% honorarios"],["23651511","11% honorarios"],["23652501","1% transporte"],
  ["23652502","2% ser. vigilancia"],["23652504","4% servicios declarantes"],
  ["23652506","6% servicios no declarantes"],["23652535","Transporte de pasajeros 3.5%"],
  ["23653035","3.5% arriendo inmuebles"],["23653040","4% arriendo muebles"],
  ["23654001","0.1% combustible"],["23654035","2.5% compras"],["23654036","Rete de 3.5%"],
  ["23657001","1% contrato de obra"],["23657002","Obra 2%"],
  ["23670101","Impuesto a las ventas retenido"],["24081010","Iva compras"],
  ["24081501","Retencion de iva"],["25050501","Salarios por pagar"],
  ["51100501","Honorarios admon"],["51353001","Energia electrica"],["51353501","Telefono admon"],
  ["51354001","Mensajeria"],["51355001","Transporte flete admon"],["51959901","Otros gastos admon"],
  ["61100508","Honorarios obra"],["61157001","Iva transitorio compras"],["61157002","Iva de servicios"],
  ["61201501","Alquileres maquinaria"],["61300501","Alquileres construccion"],["61301002","Obras civiles"],
  ["61301501","Servicios tecnicos"],["61301502","Aseo y vigilancia"],["61301801","Mantenimiento y reparacion"],
  ["61305001","Transportes fletes y acarreos"],["61310501","Polizas"],
  ["61350501","Compras para la construccion de obras"],["61350502","Compra material reposicion 1%"],
  ["61350503","Compra productos de señalizacion"],["61360501","Aseo y vigilancia obra"],
  ["61360504","Telefono obra"],["61360505","Transporte fletes obra"],["61360507","Acueducto y alcantarillado"],
  ["61360509","Transporte de pasajeros"],["61360510","Transporte de carga"],["61361501","Asistencia tecnica"],
  ["61400501","Notariales"],["61400502","Gastos legales"],["61450501","Transporte de carga obra"],
  ["61455001","Mantenimiento y reparaciones obra"],["61550501","Alojamiento y manutencion obra"],
  ["61552001","Pasajes terrestres"],["61952001","Elementos de aseo cafeteria"],
  ["61952101","Utiles de papeleria"],["61953501","Combustible"],["61953502","Lubricantes"],
  ["61959901","Otros gastos obra"],
];

// RETENCIONES_DEFAULT se mantiene para compatibilidad con cfgGet("retenciones") legacy
// Ahora la lógica real usa RETENCIONES_TABLA + buildRetencionesTxt
const RETENCIONES_DEFAULT = [
  {id:"r01",concepto:"Honorarios persona jurídica",tarifa:11,base:1,cuenta:"23651511"},
  {id:"r02",concepto:"Honorarios persona natural no declarante",tarifa:10,base:1,cuenta:"23651510"},
  {id:"r03",concepto:"Compras declarante (≥27 UVT = $1.414.098)",tarifa:2.5,base:1414098,cuenta:"23654035"},
  {id:"r04",concepto:"Compras no declarante (≥27 UVT = $1.414.098)",tarifa:3.5,base:1414098,cuenta:"23654036"},
  {id:"r05",concepto:"Servicios declarante (≥4 UVT = $209.496)",tarifa:4,base:209496,cuenta:"23652504"},
  {id:"r06",concepto:"Servicios no declarante (≥4 UVT = $209.496)",tarifa:6,base:209496,cuenta:"23652506"},
  {id:"r07",concepto:"Transporte de carga (≥4 UVT = $209.496)",tarifa:1,base:209496,cuenta:"23652501"},
  {id:"r08",concepto:"Arrendamiento inmuebles (≥27 UVT = $1.414.098)",tarifa:3.5,base:1414098,cuenta:"23653035"},
  {id:"r09",concepto:"Arrendamiento bienes muebles (desde primer peso)",tarifa:4,base:1,cuenta:"23653040"},
  {id:"r10",concepto:"Contratos construcción y obra civil (desde primer peso)",tarifa:2,base:1,cuenta:"23657002"},
  {id:"r11",concepto:"Contratos de obra 1% (desde primer peso)",tarifa:1,base:1,cuenta:"23657001"},
  {id:"r12",concepto:"Vigilancia y aseo sobre AIU (≥4 UVT = $209.496)",tarifa:2,base:209496,cuenta:"23652502"},
  {id:"r13",concepto:"Combustibles derivados petróleo (desde primer peso)",tarifa:0.1,base:1,cuenta:"23654001"},
];

const AUTORRETENEDORES_DEFAULT = {"860001942":"BAYER S.A.","860002190":"SHELL COLOMBIA S.A.","860002302":"ETERNIT COLOMBIANA S.A.","860002304":"GENERAL MOTORS COLMOTORES S.A.","860026753":"ACERIAS DE COLOMBIA ACESCO & CIA S.C.A.","860005223":"CHEVRON PETROLEUM COMPANY","860005224":"BAVARIA S.A.","890925108":"PAPELES Y CARTONES S.A. 'PAPELSA'","890300005":"CARVAJAL S.A.","890300431":"ESPECIALIDADES ELECTRICAS S.A.S","890300440":"CENTRAL CASTILLA S.A.","860002554":"EXXONMOBIL DE COLOMBIA S.A.","890301690":"INDUSTRIAS DEL MAIZ S.A. - MAIZENA S.A.","890301884":"COLOMBINA S.A.","890300546":"COLGATE PALMOLIVE COMPANIA","890301163":"DISTRIBUIDORA COLOMBINA LTDA","890302546":"EVEREADY DE COLOMBIA S.A.","860002130":"NESTLE DE COLOMBIA S.A.","860002134":"ABBOTT LABORATORIES DE COLOMBIA S.A.","899999068":"ECOPETROL S.A.","860009808":"HOLCIM COLOMBIA S.A.","860002523":"CEMEX COLOMBIA S.A.","860002518":"UNILEVER ANDINA COLOMBIA LTDA.","860025900":"ALPINA PRODUCTOS ALIMENTICIOS S.A.","860002693":"3 M COLOMBIA S.A.","890900291":"SOLLA S.A.","890300466":"TECNOQUIMICAS S.A.","860005050":"PAVCO S.A.","860350697":"CONCRETOS ARGOS S.A.","890100251":"CEMENTOS ARGOS S.A.","860016610":"INTERCONEXION ELECTRICA S.A. E.S.P","800153993":"COMUNICACIÓN CELULAR S.A COMCEL S.A.","830095213":"ORGANIZACIÓN TERPEL","860512330":"SERVIENTREGA S.A.","890904996":"EMPRESAS PUBLICAS DE MEDELLIN E.S.P.","899999094":"EMPRESA DE ACUEDUCTO, ALCANTARILLADO Y ASEO DE BOGOTA ESP","860063875":"EMGESA S A ESP","830067394":"MERCADOLIBRE COLOMBIA LTDA","900320612":"SAP COLOMBIA SAS","800153993":"COMUNICACIÓN CELULAR S.A COMCEL S.A."};

const USUARIOS_DEFAULT = [
  {id:"u1", usuario:"admin", clave:"contai2026", rol:"admin"},
];

// ─── API CONFIG ───────────────────────────────────────────────────────────────
async function cfgGet(key) {
  try {
    const r = await fetch(`${CFG_URL}?key=${key}`);
    const d = await r.json();
    if (!d.value) return null;
    return typeof d.value === "string" ? JSON.parse(d.value) : d.value;
  } catch { return null; }
}
async function cfgSet(key, value) {
  try {
    await fetch(CFG_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"set",key,value}) });
  } catch {}
}

// ─── CORRECCIÓN 3: HOOK FACTURAS CON PERSISTENCIA localStorage ───────────────
// Las facturas sobreviven F5. Se guardan solo las del día actual.
function useFacturasPersistentes() {
  const [facturas, setFacturasState] = useState(() => {
    try {
      const raw = localStorage.getItem("contaia_facturas_v3");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const hoy = new Date().toISOString().slice(0,10);
      // Solo restaurar las de hoy
      return parsed.filter(f => (f.fechaCarga||"").startsWith(hoy));
    } catch { return []; }
  });

  const setFacturas = (updater) => {
    setFacturasState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        localStorage.setItem("contaia_facturas_v3", JSON.stringify(next));
      } catch(e) {
        // localStorage lleno — intentar con versión reducida sin XMLs de prueba
        try {
          const reducido = next.map(f => {
            const {xml:_, ...resto} = f; // eslint-disable-line no-unused-vars
            return resto;
          });
          localStorage.setItem("contaia_facturas_v3", JSON.stringify(reducido));
        } catch { /* si sigue sin caber, no guardar */ }
      }
      return next;
    });
  };

  const limpiar = () => {
    setFacturasState([]);
    localStorage.removeItem("contaia_facturas_v3");
  };

  return { facturas, setFacturas, limpiar };
}

// ─── HOOK: config global + multi-empresa ─────────────────────────────────────
function useConfig() {
  const [retenciones, setRetenciones] = useState(RETENCIONES_DEFAULT);
  const [autoRet, setAutoRet]         = useState(AUTORRETENEDORES_DEFAULT);
  const [empresas, setEmpresas]       = useState([]);
  const [empresaActual, setEmpresaActualState] = useState(null);
  const [puc, setPuc]                 = useState(PUC_DEFAULT);
  const [cargando, setCargando]       = useState(true);

  useEffect(() => {
    (async () => {
      const [r, a, emps] = await Promise.all([
        cfgGet("retenciones"), cfgGet("autorretenedores"), cfgGet("empresas")
      ]);
      if (r) setRetenciones(r);
      if (a) setAutoRet(a);
      if (emps && emps.length) {
        setEmpresas(emps);
        const ultima = localStorage.getItem("contaia_empresa");
        const found = ultima ? emps.find(e=>e.nit===ultima) : null;
        const emp = found || emps[0];
        setEmpresaActualState(emp);
        const p = await cfgGet(`puc_${emp.nit}`);
        if (p) setPuc(p); else setPuc(PUC_DEFAULT);
      }
      setCargando(false);
    })();
  }, []);

  const setEmpresaActual = async (emp) => {
    setEmpresaActualState(emp);
    localStorage.setItem("contaia_empresa", emp.nit);
    setCargando(true);
    const p = await cfgGet(`puc_${emp.nit}`);
    setPuc(p || PUC_DEFAULT);
    setCargando(false);
  };

  const savePuc = async (v, nit) => {
    setPuc(v);
    const n = nit || empresaActual?.nit;
    if (n) await cfgSet(`puc_${n}`, v);
  };
  const saveRetenciones = async (v) => { setRetenciones(v); await cfgSet("retenciones", v); };
  const saveAutoRet = async (v) => { setAutoRet(v); await cfgSet("autorretenedores", v); };
  const saveEmpresas = async (v) => { setEmpresas(v); await cfgSet("empresas", v); };

  return { puc, retenciones, autoRet, empresas, empresaActual, cargando,
           savePuc, saveRetenciones, saveAutoRet, saveEmpresas, setEmpresaActual };
}

// ─── HOOK: autenticación ──────────────────────────────────────────────────────
function useAuth() {
  const [logueado, setLogueado]       = useState(false);
  const [usuarioActual, setUsuarioActual] = useState(null);
  const [usuarios, setUsuarios]       = useState(USUARIOS_DEFAULT);

  useEffect(() => {
    (async () => {
      const u = await cfgGet("usuarios");
      if (u) setUsuarios(u);
    })();
  }, []);

  const login = (usuario, clave) => {
    const found = usuarios.find(u => u.usuario===usuario && u.clave===clave);
    if (found) { setLogueado(true); setUsuarioActual(found); return true; }
    return false;
  };
  const logout = () => { setLogueado(false); setUsuarioActual(null); };
  const saveUsuarios = async (v) => { setUsuarios(v); await cfgSet("usuarios", v); };
  return { logueado, usuarioActual, usuarios, login, logout, saveUsuarios };
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function calcularDV(nit) {
  const n = String(nit).trim().replace(/[^0-9]/g,"");
  if (!n) return "";
  const primos = [3,7,13,17,19,23,29,37,41,43,47];
  let suma = 0;
  n.split("").reverse().forEach((d,i) => { if(i<primos.length) suma += parseInt(d)*primos[i]; });
  const r = suma % 11;
  return String(r < 2 ? r : 11 - r);
}

function extraerTerceroDeFactura(datos) {
  const nit = (datos.nitProveedor||"").replace(/[^0-9]/g,"");
  if (!nit) return null;
  const razon = (datos.razonSocial||"").toUpperCase();
  const esJuridica = datos.schemeID==="31" ||
    /S\.A\.S|S\.A\.|LTDA|S\.C\.A|E\.U\.|INC\.|CORP|CIA|COMPAÑIA|EMPRESA|INDUSTRIA|COMERCIALIZADORA|DISTRIBUIDORA/.test(razon);
  const tlc = (datos.taxLevelCode||"").toUpperCase();
  let regimen = "Responsable IVA";
  if (tlc.includes("O-48")) regimen = "No Responsable IVA";
  if (tlc.includes("O-47")) regimen = "Régimen Simple";
  if (tlc.includes("O-13")) regimen = "Gran Contribuyente";
  return {
    NIT: nit, DigitoV: calcularDV(nit), RazonSocial: datos.razonSocial||"",
    Direccion: datos.direccion||"", Telefono: datos.telefono||"", Celular: "",
    Email: datos.email||"", Ciudad: datos.ciudad||"", Departamento: datos.departamento||"",
    Pais: "Colombia", Regimen: regimen, Persona: esJuridica?"Jurídica":"Natural",
    EsCliente:"0", EsProveedor:"1", EsEmpleado:"0",
    GranContribuyente: tlc.includes("O-13")?"1":"0",
    Autoretenedor: datos.esAutorretenedor?"1":"0",
  };
}

// ─── HOOK: terceros ───────────────────────────────────────────────────────────
function useTerceros() {
  const [terceros, setTerceros] = useState([]);
  useEffect(() => { (async()=>{ const t=await cfgGet("terceros"); if(t) setTerceros(t); })(); }, []);

  const upsertTercero = async (nuevo) => {
    if (!nuevo?.NIT) return;
    setTerceros(prev => {
      const idx = prev.findIndex(t => t.NIT === nuevo.NIT);
      let next;
      if (idx >= 0) {
        const merged = {...prev[idx]};
        Object.keys(nuevo).forEach(k => { if (!merged[k]||merged[k]==="") merged[k]=nuevo[k]; });
        next = [...prev]; next[idx] = merged;
      } else { next = [...prev, nuevo]; }
      cfgSet("terceros", next);
      return next;
    });
  };
  const updateTercero = async (nit,campo,valor) => {
    setTerceros(prev=>{ const next=prev.map(t=>t.NIT===nit?{...t,[campo]:valor}:t); cfgSet("terceros",next); return next; });
  };
  const deleteTercero = async (nit) => {
    setTerceros(prev=>{ const next=prev.filter(t=>t.NIT!==nit); cfgSet("terceros",next); return next; });
  };
  const exportarTercerosXLSX = (lista) => {
    const cols=["NIT","DigitoV","RazonSocial","Direccion","Telefono","Celular","Email","Ciudad","Departamento","Pais","Regimen","Persona","EsCliente","EsProveedor","EsEmpleado","GranContribuyente","Autoretenedor"];
    const wsData=[cols,...lista.map(t=>cols.map(c=>t[c]||""))];
    const ws=XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"]=cols.map((_,i)=>({wch:[12,8,40,30,14,14,30,20,20,12,20,12,10,10,10,16,14][i]||15}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Terceros");
    XLSX.writeFile(wb,`Terceros_${new Date().toISOString().slice(0,10)}.xlsx`);
  };
  return { terceros, upsertTercero, updateTercero, deleteTercero, exportarTercerosXLSX };
}

// ─── HOOK: aprendizaje de cuentas ────────────────────────────────────────────
function useAprendizaje() {
  const [memoria, setMemoria] = useState({});
  useEffect(()=>{ (async()=>{ const m=await cfgGet("aprendizaje"); if(m) setMemoria(m); })(); },[]);

  const registrar = async (descripcion, cuentaCodigo, cuentaNombre) => {
    if (!descripcion||!cuentaCodigo) return;
    const palabras = descripcion.toLowerCase().replace(/[^a-záéíóúñ\s]/gi," ").split(/\s+/).filter(p=>p.length>4);
    setMemoria(prev => {
      const next={...prev};
      palabras.forEach(p => {
        if (!next[p]) next[p]={codigo:cuentaCodigo,nombre:cuentaNombre,veces:0};
        if (next[p].codigo===cuentaCodigo) next[p]={...next[p],veces:next[p].veces+1};
        else if (next[p].veces<2) next[p]={codigo:cuentaCodigo,nombre:cuentaNombre,veces:1};
      });
      cfgSet("aprendizaje",next); return next;
    });
  };

  const sugerir = (descripcion) => {
    if (!descripcion||Object.keys(memoria).length===0) return null;
    const palabras=descripcion.toLowerCase().replace(/[^a-záéíóúñ\s]/gi," ").split(/\s+/).filter(p=>p.length>4);
    const votos={};
    palabras.forEach(p=>{ if(memoria[p]){ const k=memoria[p].codigo; if(!votos[k]) votos[k]={...memoria[p],score:0}; votos[k].score+=memoria[p].veces; }});
    const ganador=Object.values(votos).sort((a,b)=>b.score-a.score)[0];
    return ganador&&ganador.score>=2?ganador:null;
  };

  const contextoParaPrompt = (descripciones) => {
    const sug=[];
    descripciones.forEach(d=>{ const s=sugerir(d); if(s) sug.push(`"${d}" → cuenta ${s.codigo} (${s.nombre}), usado ${s.veces} veces`); });
    return sug.length>0?"\nHISTORIAL DE CUENTAS APROBADAS (usa como referencia preferente):\n"+sug.join("\n"):"";
  };

  return { memoria, registrar, sugerir, contextoParaPrompt };
}

// ─── XML / PDF / IA ───────────────────────────────────────────────────────────
function parseXMLFactura(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText,"text/xml");
    const get = tag => doc.getElementsByTagNameNS("*",tag)[0]?.textContent?.trim()||"";
    const getAttr = (tag,attr) => { const n=doc.getElementsByTagNameNS("*",tag)[0]; return n?.getAttribute?.(attr)||""; };
    const supplier = doc.getElementsByTagNameNS("*","AccountingSupplierParty")[0];
    const gf = (node,tag) => node?.getElementsByTagNameNS("*",tag)[0]?.textContent?.trim()||"";
    const gfa = (node,tag,attr) => { const n=node?.getElementsByTagNameNS("*",tag)[0]; return n?.getAttribute?.(attr)||""; };
    const items = Array.from(doc.getElementsByTagNameNS("*","InvoiceLine")).map(l=>({
      descripcion: l.getElementsByTagNameNS("*","Description")[0]?.textContent?.trim()||"",
      cantidad: parseFloat(l.getElementsByTagNameNS("*","InvoicedQuantity")[0]?.textContent||"1"),
      valor: Math.round(parseFloat(l.getElementsByTagNameNS("*","LineExtensionAmount")[0]?.textContent||"0")),
    }));
    const schemeID = gfa(supplier,"CompanyID","schemeID")||getAttr("CompanyID","schemeID");
    const rnd = v => Math.round(parseFloat(v||"0"));
    return {
      prefijo:get("ID"), fecha:get("IssueDate"),
      nitProveedor:gf(supplier,"CompanyID")||get("CompanyID"),
      razonSocial:gf(supplier,"RegistrationName")||get("RegistrationName"),
      direccion:gf(supplier,"Line"), ciudad:gf(supplier,"CityName"), departamento:gf(supplier,"CountrySubentity"),
      telefono:gf(supplier,"Telephone"), email:gf(supplier,"ElectronicMail"),
      taxLevelCode:gf(supplier,"TaxLevelCode"), schemeID,
      subtotal:rnd(get("LineExtensionAmount")), totalIva:rnd(get("TaxAmount")), total:rnd(get("PayableAmount")),
      items,
    };
  } catch { return null; }
}

async function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

async function callClaude(body, intento=0) {
  const res = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (res.status===429) {
    if (intento>=4) throw new Error("Límite de API alcanzado. Espera 1 minuto e intenta de nuevo.");
    await sleep((intento+1)*15000);
    return callClaude(body, intento+1);
  }
  if (!res.ok) { const txt=await res.text(); throw new Error(`HTTP ${res.status}: ${txt}`); }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message||JSON.stringify(data.error));
  return data;
}

async function parsePDFFactura(archivo) {
  const base64 = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=()=>rej(new Error("No se pudo leer el PDF")); r.readAsDataURL(archivo); });
  const data = await callClaude({ model:"claude-sonnet-4-5", max_tokens:1500, messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:`Lee esta factura y extrae los datos. Responde SOLO JSON sin markdown.\nFormato: {"prefijo":"","fecha":"YYYY-MM-DD","nitProveedor":"solo números","razonSocial":"","direccion":"","ciudad":"","departamento":"","subtotal":0,"totalIva":0,"total":0,"items":[{"descripcion":"","cantidad":1,"valor":0}]}`}]}] });
  const text = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
  const r = JSON.parse(text);
  const rnd = v => Math.round(parseFloat(v||0));
  return {...r, subtotal:rnd(r.subtotal), totalIva:rnd(r.totalIva), total:rnd(r.total),
    items:(r.items||[]).map(i=>({...i, valor:Math.round(parseFloat(i.valor||0))}))};
}

// ─── CORRECCIÓN 1 (cont): analizarConIA usa buildRetencionesTxt ───────────────
async function analizarConIA(datos, tratamiento, tratIva, puc, _retencionesLegacy=[], contextoAprendizaje="") {
  const pucTexto = puc.map(([c,n])=>`${c}\t${n}`).join("\n");
  const itemsTexto = datos.items?.length
    ? datos.items.map(i=>`- Cant ${i.cantidad} | ${i.descripcion} | $${i.valor.toLocaleString("es-CO")}`).join("\n")
    : "(sin ítems)";

  const instrTrat = tratamiento==="inventario"
    ? `TRATAMIENTO: INVENTARIO.
- Registra cada ítem de la factura por separado como una línea en lineas_contables.
- Para cada ítem busca en el PUC la cuenta auxiliar (8 dígitos) clase 1 (activos/inventario).
- NUNCA uses cuentas clase 5 o 6.
- Si no existe cuenta exacta, elige la más cercana y marca sin_cuenta_exacta:true.`
    : `TRATAMIENTO: COSTO O GASTO.
- Resume todos los ítems en UN solo concepto contable.
- Busca en el PUC la cuenta auxiliar (8 dígitos) clase 5 o 6 que mejor describa el gasto/costo.
- NUNCA uses cuentas clase 1 (activos).
- Elige la cuenta más específica disponible. No uses siempre la misma cuenta.`;

  const instrIva = tratIva==="descontable"
    ? `IVA DESCONTABLE: busca en el PUC la cuenta auxiliar de IVA descontable (cuentas 24x). Si no existe deja cuenta_iva_codigo vacío.`
    : `IVA AL GASTO (consorcio): busca en el PUC cuenta de IVA transitorio o IVA servicios (61x o 51x). Si no existe deja cuenta_iva_codigo vacío.`;

  // Detectar persona del proveedor para las retenciones
  const razon = (datos.razonSocial||"").toUpperCase();
  const esJuridica = datos.schemeID==="31" ||
    /S\.A\.S|S\.A\.|LTDA|S\.C\.A|E\.U\.|INC\.|CORP|CIA|COMPAÑIA|EMPRESA|INDUSTRIA|COMERCIALIZADORA|DISTRIBUIDORA/.test(razon);

  // CORRECCIÓN 1: usar buildRetencionesTxt con fecha y subtotal reales
  const retencionesTxt = buildRetencionesTxt(datos.fecha||"2026-01-01", datos.subtotal||0, esJuridica);

  const prompt = `Eres contador colombiano experto en PUC. Responde SOLO JSON válido sin texto adicional.

FACTURA:
Proveedor: ${datos.razonSocial} | NIT: ${datos.nitProveedor} | Fecha: ${datos.fecha}
Ítems:
${itemsTexto}
Subtotal: $${datos.subtotal?.toLocaleString("es-CO")} | IVA: $${datos.totalIva?.toLocaleString("es-CO")} | Total: $${datos.total?.toLocaleString("es-CO")}

PUC DE LA EMPRESA (SOLO puedes usar estas cuentas — son las únicas disponibles):
Código\tNombre
${pucTexto}

TRATAMIENTO CONTABLE:
${instrTrat}

${retencionesTxt}

IVA:
${instrIva}

${contextoAprendizaje}

REGLAS ESTRICTAS:
1. SOLO usa cuentas que existen en el PUC de la empresa. Nunca inventes códigos.
2. lineas_contables: SOLO cuentas de costo/gasto/inventario (6x, 5x, 14x). NUNCA 22x, 23x, 24x.
3. Las cuentas de retención van SOLO en cuenta_retefuente_codigo.
4. Si retefuente_tipo dice ✗ NO APLICA → retefuente_pct=0 y cuenta_retefuente_codigo="".
5. Elige la cuenta más específica disponible en el PUC.

Responde con este JSON exacto:
{"concepto_general":"","tipo_cuenta":"Inventario|Costo|Gasto","retefuente_tipo":"compras|servicios|honorarios|transporte|arrendamiento|obra_civil|vigilancia|comisiones|combustibles|prop_intelectual|no_aplica","retefuente_pct":0,"retefuente_descripcion":"","cuenta_retefuente_codigo":"","cuenta_retefuente_nombre":"","retica_por_mil":0,"advertencia_puc":"","cuenta_iva_codigo":"","cuenta_iva_nombre":"","lineas_contables":[{"descripcion":"","cantidad":1,"valor_base":0,"cuenta_debito_codigo":"","cuenta_debito_nombre":"","sin_cuenta_exacta":false}]}`;

  const data = await callClaude({ model:"claude-sonnet-4-5", max_tokens:2000, messages:[{role:"user",content:prompt}] });
  const text = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
  const ia = JSON.parse(text);

  // CORRECCIÓN 1 (validación post-IA): verificar que la retención respeta la base
  const esJur2 = esJuridica;
  const validacion = getRetencionVigente(ia.retefuente_tipo||"compras", datos.fecha||"2026-01-01", datos.subtotal||0, esJur2?"juridica":"natural");
  if (!validacion.aplica && ia.retefuente_pct > 0) {
    console.warn(`IA sugirió retener pero no aplica la base: ${validacion.nota}. Corrigiendo a 0.`);
    ia.retefuente_pct = 0;
    ia.cuenta_retefuente_codigo = "";
    ia.retefuente_descripcion = `No aplica — ${validacion.nota}`;
  }

  return ia;
}

// ─── FUNCIONES DE EXPORTACIÓN ─────────────────────────────────────────────────
function generarFilasContables(factura, docNum, config) {
  const { tpcCod, prfCod, docAux, ctoCod } = config;
  const fila = (plnCod, docDet, deb, cre) => ({ DocNum:docNum, DocFec:factura.fecha||"", TpcCod:tpcCod, PlnCod:plnCod, DocDet:docDet, TerNit:factura.nitProveedor||"", CtoCod:ctoCod, DocDeb:deb, DocCre:cre, PrfCod:prfCod, DocAux:docAux, SubCto:"" });
  const filas = [];
  if (factura.asiento?.length) factura.asiento.forEach(r => filas.push(fila(r.cuenta, r.descripcion, r.tipo==="debito"?Number(r.valor):"", r.tipo==="credito"?Number(r.valor):"")));
  return filas;
}

function exportarExcel(facturas, config, soloUna=null) {
  const lista = [...(soloUna?[soloUna]:facturas.filter(f=>f.aprobado&&!f.error))].sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  const headers = ["DocNum","DocFec","TpcCod","PlnCod","DocDet","TerNit","CtoCod","DocDeb","DocCre","PrfCod","DocAux","SubCto"];
  const wsData = [headers];
  let cons = parseInt(config.docNumInicio)||1;
  lista.forEach(f => { generarFilasContables(f,cons,config).forEach(r=>wsData.push(headers.map(h=>r[h]??""))); cons++; });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{wch:8},{wch:12},{wch:8},{wch:12},{wch:45},{wch:14},{wch:10},{wch:14},{wch:14},{wch:10},{wch:14},{wch:8}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comprobante");
  XLSX.writeFile(wb, soloUna?`comprobante_${soloUna.prefijo||soloUna.nitProveedor}.xlsx`:`comprobante_${config.tpcCod}_${config.docNumInicio}.xlsx`);
}

// ─── COMPONENTES UI ───────────────────────────────────────────────────────────
function CeldaEditable({ valor, onChange, tipo="text", style={} }) {
  const [editando, setEditando] = useState(false);
  const [tmp, setTmp] = useState(valor);
  const confirmar = () => { onChange(tipo==="number"?parseFloat(tmp)||0:tmp); setEditando(false); };
  if (editando) return <input autoFocus type={tipo} value={tmp} onChange={e=>setTmp(e.target.value)} onBlur={confirmar} onKeyDown={e=>{ if(e.key==="Enter")confirmar(); if(e.key==="Escape")setEditando(false); }} style={{background:"#0d101a",border:"1px solid #4f7cff",color:"#e2e8f0",borderRadius:4,padding:"2px 6px",fontFamily:"monospace",fontSize:11,width:"100%",outline:"none",...style}}/>;
  return <span onClick={()=>{setTmp(valor);setEditando(true);}} title="Clic para editar" style={{cursor:"pointer",borderBottom:"1px dashed #2d3352",paddingBottom:1,...style}}>{valor}</span>;
}

function ModalExport({ facturas, onClose }) {
  const aprobadas = facturas.filter(f=>f.aprobado&&!f.error).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  const [cfg, setCfg] = useState({ docNumInicio:"1", tpcCod:"CO", prfCod:"", docAux:"", ctoCod:"" });
  const set = (k,v) => setCfg(p=>({...p,[k]:v}));
  const preview = aprobadas.map((f,i)=>({...f, docNumAsignado:(parseInt(cfg.docNumInicio)||1)+i}));
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,padding:26,maxWidth:700,width:"100%"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <div>
            <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:16,color:"#fff"}}>⬇ Exportar comprobante contable</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{aprobadas.length} facturas aprobadas · ordenadas por fecha</div>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,marginBottom:18}}>
          {[{k:"docNumInicio",label:"DocNum — Consecutivo inicial",ph:"Ej: 29",help:"Suma +1 por factura"},{k:"tpcCod",label:"TpcCod — Tipo documento",ph:"Ej: CO",help:"Código comprobante"},{k:"prfCod",label:"PrfCod — Prefijo",ph:"Ej: COMP",help:"Prefijo"},{k:"ctoCod",label:"CtoCod — Centro de costo",ph:"Ej: CC001",help:"Centro de costo"},{k:"docAux",label:"DocAux — Auxiliar",ph:"Ej: OC-2026-01",help:"Referencia adicional"}].map(({k,label,ph,help})=>(
            <div key={k}>
              <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>{label}</div>
              <input value={cfg[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={{width:"100%",background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"7px 10px",fontFamily:"monospace",fontSize:12,outline:"none"}}/>
              <div style={{fontSize:10,color:"#475569",marginTop:2}}>{help}</div>
            </div>
          ))}
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>Vista previa</div>
          <div style={{background:"#0d101a",borderRadius:7,border:"1px solid #1e2235",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#131620"}}>{["DocNum","Fecha","Proveedor","N° Factura","Total","Neto"].map(h=><th key={h} style={{padding:"6px 9px",color:"#475569",fontSize:10,fontWeight:600,textAlign:"left",borderBottom:"1px solid #1e2235"}}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.length===0?<tr><td colSpan={6} style={{padding:"12px",color:"#475569",textAlign:"center"}}>Sin facturas aprobadas</td></tr>
                :preview.map((f,i)=>(
                  <tr key={f.id} style={{borderBottom:"1px solid #1e2235",background:i%2===0?"transparent":"#0a0d14"}}>
                    <td style={{padding:"6px 9px"}}><span style={{background:"#1e2a3a",color:"#60a5fa",padding:"2px 8px",borderRadius:4,fontFamily:"monospace",fontWeight:700}}>{cfg.tpcCod} {f.docNumAsignado}</span></td>
                    <td style={{padding:"6px 9px",color:"#94a3b8"}}>{f.fecha}</td>
                    <td style={{padding:"6px 9px",color:"#cbd5e1",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.razonSocial}</td>
                    <td style={{padding:"6px 9px",color:"#64748b",fontFamily:"monospace"}}>{f.prefijo}</td>
                    <td style={{padding:"6px 9px",color:"#4ade80",fontWeight:600}}>{fmt(f.total)}</td>
                    <td style={{padding:"6px 9px",color:"#fbbf24",fontWeight:600}}>{fmt((f.total||0)-(f.retefuente||0)-(f.retica||0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{borderTop:"1px solid #1e2235",paddingTop:14,display:"flex",gap:10,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center"}}>
          <div style={{fontSize:11,color:"#475569",flex:1}}>Archivo .xlsx — compatible con Excel y software contable</div>
          <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:130,overflowY:"auto",border:"1px solid #1e2235",borderRadius:6,padding:"6px 8px",minWidth:210}}>
            <div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:2}}>📄 Por factura:</div>
            {preview.map(f=><button key={f.id} onClick={()=>exportarExcel(facturas,cfg,f)} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:10,textAlign:"left",whiteSpace:"nowrap"}}>⬇ {cfg.tpcCod}{f.docNumAsignado} · {f.razonSocial?.slice(0,18)}</button>)}
          </div>
          <button onClick={()=>exportarExcel(facturas,cfg)} disabled={aprobadas.length===0} style={{background:aprobadas.length?"#4f7cff":"#1e2235",color:aprobadas.length?"#fff":"#475569",border:"none",borderRadius:8,padding:"10px 22px",cursor:aprobadas.length?"pointer":"not-allowed",fontSize:13,fontWeight:700}}>⬇ Descargar TODAS ({aprobadas.length})</button>
        </div>
      </div>
    </div>
  );
}

function ModalTratamiento({ archivos, empresaActual, empresas, onEmpresa, onConfirm, onCancel }) {
  const [tratamiento, setTratamiento] = useState(null);
  const [tratIva, setTratIva] = useState(null);
  const listo = tratamiento && tratIva && empresaActual;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,padding:26,maxWidth:540,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:26,marginBottom:8}}>📋</div>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:16,color:"#fff",marginBottom:4}}>¿Cómo se contabiliza?</div>
          <div style={{fontSize:11,color:"#64748b"}}>{archivos.length===1?`📄 ${archivos[0].name}`:`${archivos.length} archivos`}</div>
        </div>
        {!empresaActual && empresas.length > 0 && (
          <div style={{background:"#1e2a3a",border:"1px solid #4f7cff",borderRadius:8,padding:"10px 14px",marginBottom:16}}>
            <div style={{fontSize:11,color:"#60a5fa",marginBottom:6,fontWeight:600}}>🏢 Selecciona la empresa</div>
            <select defaultValue="" onChange={e=>{ const emp=empresas.find(x=>x.nit===e.target.value); if(emp) onEmpresa(emp); }} style={{width:"100%",background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"7px 10px",fontSize:12,cursor:"pointer",outline:"none"}}>
              <option value="" disabled>— elige empresa —</option>
              {empresas.map(e=><option key={e.nit} value={e.nit}>{e.nombre} · {e.nit}</option>)}
            </select>
          </div>
        )}
        {!empresaActual && empresas.length===0 && (
          <div style={{background:"#1a0a0a",border:"1px solid #3b1f1f",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#f87171"}}>
            ⚠ No hay empresas configuradas. Ve a ⚙️ Config y crea una primero.
          </div>
        )}
        {empresaActual && (
          <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:6,padding:"6px 12px",marginBottom:14,fontSize:11,color:"#4ade80"}}>
            🏢 <strong>{empresaActual.nombre}</strong> · {empresaActual.nit}
          </div>
        )}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Paso 1 — Tratamiento</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[{key:"inventario",icono:"📦",titulo:"Inventario",desc:"Ítem por ítem · cuentas 14x",color:"#1e3a5f",borde:"#3b6fd4"},{key:"gasto",icono:"📉",titulo:"Costo / Gasto",desc:"Concepto resumido · cuentas 61x/51x",color:"#2d1b4e",borde:"#8b5cf6"}].map(op=>(
              <button key={op.key} onClick={()=>setTratamiento(op.key)} style={{background:tratamiento===op.key?op.color:"#0f1117",border:`2px solid ${tratamiento===op.key?op.borde:"#232840"}`,borderRadius:10,padding:"13px",cursor:"pointer",textAlign:"left"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}><span style={{fontSize:17}}>{op.icono}</span><span style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#fff"}}>{op.titulo}</span>{tratamiento===op.key&&<span style={{marginLeft:"auto",color:op.borde}}>✓</span>}</div>
                <div style={{fontSize:11,color:"#94a3b8"}}>{op.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Paso 2 — IVA</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {[{key:"descontable",icono:"🔄",titulo:"IVA descontable",desc:"Activo · cuentas 24x",color:"#1e3a5f",borde:"#3b6fd4"},{key:"gasto",icono:"📉",titulo:"IVA al gasto (consorcio)",desc:"IA detecta 61157001 o 61157002",color:"#1a2d1a",borde:"#22c55e"}].map(op=>(
              <button key={op.key} onClick={()=>setTratIva(op.key)} style={{background:tratIva===op.key?op.color:"#0f1117",border:`2px solid ${tratIva===op.key?op.borde:"#232840"}`,borderRadius:9,padding:"10px 13px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:17,minWidth:22}}>{op.icono}</span>
                <div style={{flex:1}}><div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#fff",marginBottom:2}}>{op.titulo}</div><div style={{fontSize:11,color:"#94a3b8"}}>{op.desc}</div></div>
                {tratIva===op.key&&<span style={{fontSize:14,color:op.borde}}>✓</span>}
              </button>
            ))}
          </div>
        </div>
        <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:6,padding:"6px 12px",marginBottom:14,fontSize:11,color:"#4ade80"}}>✓ <strong>PUC integrado</strong> — la IA usará exclusivamente las cuentas de la empresa.</div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
          <button onClick={()=>listo&&onConfirm(tratamiento,tratIva)} disabled={!listo} style={{background:listo?"#4f7cff":"#1e2235",color:listo?"#fff":"#475569",border:"none",padding:"8px 22px",borderRadius:6,cursor:listo?"pointer":"not-allowed",fontSize:13,fontWeight:700}}>
            {listo?"Procesar →": !empresaActual?"Selecciona empresa primero":"Completa los 2 pasos"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FacturaCard({ f, idx, onUpdate, docNum, onAprender }) {
  const [expandido, setExpandido] = useState(true);
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;

  const construirAsiento = () => {
    if (!f.ia) return [];
    const filas = [];
    const mapaLineas = new Map();
    (f.ia.lineas_contables||[]).forEach(l => {
      const cta = l.cuenta_debito_codigo||"";
      if (!cta||cta.startsWith("22")||cta.startsWith("23")||cta.startsWith("24")) return;
      if (cta===f.ia.cuenta_iva_codigo) return;
      if (mapaLineas.has(cta)) { const e=mapaLineas.get(cta); e.valor_base+=(l.valor_base||0); if(l.sin_cuenta_exacta)e.sin_cuenta_exacta=true; }
      else mapaLineas.set(cta,{...l,valor_base:l.valor_base||0});
    });
    let lcIdx=0;
    mapaLineas.forEach((l,cta)=>filas.push({id:`lc${lcIdx++}`,tipo:"debito",descripcion:l.descripcion,valor:l.valor_base,cuenta:cta,editable:true,eliminable:true,advertencia:!!l.sin_cuenta_exacta}));
    if ((f.totalIva||0)>0&&f.ia.cuenta_iva_codigo) filas.push({id:"iva",tipo:"debito",descripcion:f.ia.cuenta_iva_nombre||"IVA",valor:f.totalIva,cuenta:f.ia.cuenta_iva_codigo,editable:true,eliminable:true,advertencia:false});
    if (!f.esAutorretenedor&&(f.retefuente||0)>0&&f.ia.cuenta_retefuente_codigo) filas.push({id:"rete",tipo:"credito",descripcion:f.ia.retefuente_descripcion||"Retención en la fuente",valor:f.retefuente,cuenta:f.ia.cuenta_retefuente_codigo,editable:true,eliminable:true,advertencia:false});
    if ((f.retica||0)>0) filas.push({id:"retica",tipo:"credito",descripcion:"Retención industria y comercio",valor:f.retica,cuenta:"13551801",editable:true,eliminable:true,advertencia:false});
    const deb=filas.filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0);
    const cre=filas.filter(r=>r.tipo==="credito").reduce((s,r)=>s+r.valor,0);
    filas.push({id:"prov",tipo:"credito",descripcion:`Proveedor — ${(f.razonSocial||"").slice(0,40)}`,valor:Math.max(0,deb-cre),cuenta:"22050101",editable:true,eliminable:false,advertencia:false,editadoManual:false});
    return filas;
  };

  const [filas, setFilas] = useState(()=>f.asiento||construirAsiento());
  const recalcProv = fs => { const deb=fs.filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0); const cre=fs.filter(r=>r.tipo==="credito"&&r.id!=="prov").reduce((s,r)=>s+r.valor,0); return fs.map(r=>r.id==="prov"&&!r.editadoManual?{...r,valor:Math.max(0,deb-cre)}:r); };
  const updFila = (id,campo,valor) => { const n=recalcProv(filas.map(r=>r.id===id?{...r,[campo]:valor,editadoManual:id==="prov"?true:r.editadoManual}:r)); setFilas(n); onUpdate(f.id,"asiento",n); };
  const elimFila = id => { const n=recalcProv(filas.filter(r=>r.id!==id)); setFilas(n); onUpdate(f.id,"asiento",n); };
  const addFila = () => { const n=recalcProv([...filas.filter(r=>r.id!=="prov"),{id:`x${Date.now()}`,tipo:"debito",descripcion:"Nueva línea",valor:0,cuenta:"",editable:true,eliminable:true,advertencia:true},...filas.filter(r=>r.id==="prov")]); setFilas(n); onUpdate(f.id,"asiento",n); };

  const totalDeb=filas.filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0);
  const totalCre=filas.filter(r=>r.tipo==="credito").reduce((s,r)=>s+r.valor,0);
  const cuadra=Math.abs(totalDeb-totalCre)<1;
  const neto=filas.find(r=>r.id==="prov")?.valor||0;
  const hayAdv=filas.some(r=>r.advertencia);
  const tratColor=f.tratamiento==="inventario"?"#60a5fa":"#c084fc";
  const tratBg=f.tratamiento==="inventario"?"#0e1825":"#120e1f";

  if (f.error) return <div style={{background:"#1a0a0a",border:"1px solid #3b1f1f",borderRadius:10,padding:"12px 18px",display:"flex",gap:10,alignItems:"center"}}><span style={{color:"#64748b",fontSize:11}}>#{(idx+1).toString().padStart(2,"0")}</span><span style={{color:"#f87171",fontSize:13}}>❌ {f.archivo}: {f.error}</span></div>;

  return (
    <div style={{background:"#161923",border:`1px solid ${f.aprobado?"#166534":cuadra?"#232840":"#7c3700"}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{background:tratBg,borderBottom:"1px solid #1e2235",padding:"8px 16px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"#475569",fontWeight:600}}>#{(idx+1).toString().padStart(2,"0")}</span>
        {docNum&&<span style={{background:"#1e2a3a",color:"#60a5fa",padding:"2px 9px",borderRadius:4,fontFamily:"monospace",fontSize:11,fontWeight:700}}>DocNum:{docNum}</span>}
        <span style={{display:"inline-flex",alignItems:"center",gap:4,background:f.tratamiento==="inventario"?"#1e3a5f":"#2d1b4e",color:tratColor,border:`1px solid ${tratColor}44`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>{f.tratamiento==="inventario"?"📦 Inventario":"📉 Costo/Gasto"}</span>
        {f.esAutorretenedor&&<span style={{background:"#2d1a00",color:"#fb923c",border:"1px solid #7c370066",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>🔒 Autorretenedor</span>}
        {hayAdv&&<span style={{background:"#2d2000",color:"#fbbf24",border:"1px solid #78570066",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>⚠ Verificar cuenta</span>}
        {!cuadra&&<span style={{background:"#3b1f1f",color:"#f87171",border:"1px solid #7c3700",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>⚡ Descuadrado</span>}
        {f.aprobado&&<span style={{background:"#14532d",color:"#86efac",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>✓ Aprobado</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button onClick={()=>setExpandido(e=>!e)} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:11}}>{expandido?"▲":"▼ Asiento"}</button>
          <button onClick={()=>{
            if(!cuadra){alert("El asiento está descuadrado. Revisa antes de aprobar.");return;}
            if(!f.aprobado && onAprender) filas.filter(r=>r.tipo==="debito"&&r.cuenta&&r.descripcion).forEach(r=>onAprender(r.descripcion,r.cuenta,""));
            onUpdate(f.id,"asiento",filas); onUpdate(f.id,"aprobado",!f.aprobado);
          }} style={{background:f.aprobado?"#14532d":"#4f7cff",color:f.aprobado?"#86efac":"#fff",border:"none",borderRadius:6,padding:"3px 14px",cursor:"pointer",fontSize:11,fontWeight:700}}>{f.aprobado?"✓ Aprobado":"Aprobar"}</button>
        </div>
      </div>
      <div style={{padding:"11px 16px",display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div style={{flex:2,minWidth:220}}>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:14,color:"#fff",marginBottom:2}}>{f.razonSocial||f.archivo}</div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#64748b"}}>
            {f.nitProveedor&&<span>NIT <span style={{color:"#94a3b8"}}>{f.nitProveedor}</span></span>}
            {f.prefijo&&<span>N° <span style={{color:"#94a3b8"}}>{f.prefijo}</span></span>}
            {f.fecha&&<span>📅 <span style={{color:"#94a3b8"}}>{f.fecha}</span></span>}
          </div>
          {f.ia?.concepto_general&&<div style={{marginTop:4,fontSize:12,color:tratColor,fontStyle:"italic"}}>«{f.ia.concepto_general}»</div>}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[{l:"Subtotal",v:f.subtotal,c:"#cbd5e1"},{l:"IVA",v:f.totalIva,c:"#60a5fa"},{l:"Total",v:f.total,c:"#4ade80",big:true},{l:"Neto",v:neto,c:"#fbbf24",big:true}].map(({l,v,c,big})=>(
            <div key={l} style={{background:"#0d101a",borderRadius:7,padding:"6px 10px",textAlign:"center",minWidth:72}}>
              <div style={{fontSize:9,color:"#475569",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:big?13:11,fontWeight:big?700:500,color:c,whiteSpace:"nowrap"}}>{fmt(v)}</div>
            </div>
          ))}
        </div>
      </div>
      {expandido&&f.ia&&(
        <div style={{borderTop:"1px solid #1e2235",padding:"12px 16px",background:"#0f1117"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em"}}>✏️ Asiento editable</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:11,color:cuadra?"#22c55e":"#f87171",fontWeight:600}}>{cuadra?"✓ Cuadrado":"⚡ Descuadrado"}</span>
              {!f.aprobado&&<button onClick={addFila} style={{background:"transparent",border:"1px solid #2d3f6e",color:"#60a5fa",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11}}>+ Línea</button>}
            </div>
          </div>
          <div style={{background:"#0d101a",borderRadius:7,overflow:"hidden",border:`1px solid ${cuadra?"#1e2235":"#7c3700"}`}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#131620"}}>{["Tipo","PlnCod","Descripción","Débito","Crédito",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 9px",color:"#475569",fontSize:10,fontWeight:600,textTransform:"uppercase",borderBottom:"1px solid #1e2235"}}>{h}</th>)}</tr></thead>
              <tbody>
                {filas.map(r=>(
                  <tr key={r.id} style={{borderBottom:"1px solid #1a1d27",background:r.advertencia?"#1a120022":r.id==="prov"?"#0a0d14":"transparent"}}>
                    <td style={{padding:"6px 9px"}}>
                      {!f.aprobado&&r.editable&&r.id!=="prov"
                        ?<select value={r.tipo} onChange={e=>updFila(r.id,"tipo",e.target.value)} style={{background:"#1e2235",border:"1px solid #2d3352",color:r.tipo==="debito"?"#4ade80":"#f87171",borderRadius:4,padding:"2px 6px",fontSize:10,cursor:"pointer"}}><option value="debito">DÉB</option><option value="credito">CRÉ</option></select>
                        :<span style={{fontSize:10,fontWeight:700,color:r.tipo==="debito"?"#4ade80":"#f87171",background:r.tipo==="debito"?"#0a2010":"#200a0a",padding:"2px 7px",borderRadius:4}}>{r.tipo==="debito"?"DÉB":"CRÉ"}</span>}
                    </td>
                    <td style={{padding:"6px 9px"}}>
                      {!f.aprobado&&r.editable?<CeldaEditable valor={r.cuenta} onChange={v=>updFila(r.id,"cuenta",v)} style={{fontFamily:"monospace",color:r.advertencia?"#fb923c":"#60a5fa",fontWeight:600}}/>:<span style={{fontFamily:"monospace",color:r.advertencia?"#fb923c":"#60a5fa",fontWeight:600}}>{r.cuenta}</span>}
                      {r.advertencia&&<span style={{marginLeft:4,fontSize:9,color:"#fbbf24"}}>⚠</span>}
                    </td>
                    <td style={{padding:"6px 9px",maxWidth:180}}>
                      {!f.aprobado&&r.editable?<CeldaEditable valor={r.descripcion} onChange={v=>updFila(r.id,"descripcion",v)} style={{color:"#cbd5e1"}}/>:<span style={{color:"#94a3b8"}}>{r.descripcion}</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"right"}}>
                      {r.tipo==="debito"?(!f.aprobado&&r.editable?<CeldaEditable valor={r.valor} onChange={v=>updFila(r.id,"valor",v)} tipo="number" style={{color:"#4ade80",fontWeight:600,textAlign:"right"}}/>:<span style={{color:"#4ade80",fontWeight:600}}>{fmt(r.valor)}</span>):<span style={{color:"#2d3352"}}>—</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"right"}}>
                      {r.tipo==="credito"?(!f.aprobado&&r.editable?<CeldaEditable valor={r.valor} onChange={v=>updFila(r.id,"valor",v)} tipo="number" style={{color:r.id==="prov"?"#fbbf24":"#f87171",fontWeight:600,textAlign:"right"}}/>:<span style={{color:r.id==="prov"?"#fbbf24":"#f87171",fontWeight:r.id==="prov"?700:600}}>{fmt(r.valor)}</span>):<span style={{color:"#2d3352"}}>—</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"center"}}>
                      {!f.aprobado&&r.eliminable?<button onClick={()=>elimFila(r.id)} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑</button>
                        :r.id==="prov"?<span style={{fontSize:10,color:r.editadoManual?"#fb923c":"#fbbf24"}}>{r.editadoManual?"editado":"auto"}</span>
                        :<span style={{fontSize:10,color:f.aprobado?"#22c55e":"#475569"}}>{f.aprobado?"🔒":""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{background:"#131620",borderTop:"2px solid #1e2235"}}>
                <td colSpan={3} style={{padding:"6px 9px",color:"#64748b",fontSize:11,fontWeight:600}}>TOTALES</td>
                <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:"#4ade80",fontSize:12}}>{fmt(totalDeb)}</td>
                <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:"#f87171",fontSize:12}}>{fmt(totalCre)}</td>
                <td style={{padding:"6px 9px",textAlign:"center"}}><span style={{fontWeight:700,color:cuadra?"#22c55e":"#f87171"}}>{cuadra?"✓":"✗"}</span></td>
              </tr></tfoot>
            </table>
          </div>
          {!f.aprobado&&<div style={{marginTop:7,fontSize:10,color:"#475569"}}>💡 Clic sobre cualquier valor para editar · <strong style={{color:"#fbbf24"}}>Proveedor</strong> se recalcula automáticamente.</div>}
        </div>
      )}
    </div>
  );
}

// ─── FACTURAS DE PRUEBA ───────────────────────────────────────────────────────
const FACTURAS_TEST = [
  { nombre:"Ferretería (varios ítems)", desc:"Tornillos, puntillas, cemento · 02-mar", icono:"🔩", color:"#1e3a5f",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>FE-2026-1047</cbc:ID><cbc:IssueDate>2026-03-02</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900123456</cbc:CompanyID><cbc:RegistrationName>FERRETERÍA EL CLAVO DORADO S.A.S.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">47500</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">250000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">297500</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>100</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">50000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Puntillas 2 pulgadas</cbc:Description></cac:Item></cac:InvoiceLine><cac:InvoiceLine><cbc:InvoicedQuantity>50</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">75000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Tornillos autoperforantes 3/8</cbc:Description></cac:Item></cac:InvoiceLine><cac:InvoiceLine><cbc:InvoicedQuantity>5</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">125000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Cemento gris x 50kg</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Transporte nacional", desc:"Flete Bogotá-Medellín · 10-mar", icono:"🚛", color:"#1a2d1a",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>TRP-2026-0312</cbc:ID><cbc:IssueDate>2026-03-10</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800234567</cbc:CompanyID><cbc:RegistrationName>TRANSPORTES RÁPIDOS DEL NORTE LTDA.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">850000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Flete terrestre Bogotá-Medellín 500kg</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Honorarios profesional", desc:"Asesoría contable · 15-mar", icono:"👨‍💼", color:"#1a1a2e",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>HON-2026-0089</cbc:ID><cbc:IssueDate>2026-03-15</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>79654321</cbc:CompanyID><cbc:RegistrationName>CARLOS ANDRÉS GÓMEZ REYES</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">2000000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Honorarios revisoría fiscal mayo 2026</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Bayer S.A. (autorretenedor)", desc:"NIT 860001942 · 20-mar · ReteFuente = $0", icono:"🔒", color:"#2d1a00",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>BAYER-FV-20260320</cbc:ID><cbc:IssueDate>2026-03-20</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>860001942</cbc:CompanyID><cbc:RegistrationName>BAYER S.A.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">285000</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">1785000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>10</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Productos farmacéuticos</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
];

function TestPanel({ onCargar }) {
  const [abierto, setAbierto] = useState(false);
  const lanzar = xmls => onCargar(xmls.map((t,i)=>new File([new Blob([t.xml],{type:"text/xml"})],`test-${i+1}.xml`,{type:"text/xml"})));
  return (
    <div style={{marginTop:10}}>
      <button onClick={()=>setAbierto(a=>!a)} style={{background:"transparent",border:"1px dashed #2d3f6e",color:"#60a5fa",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:600}}>🧪 {abierto?"Ocultar":"Panel de pruebas"} {abierto?"▲":"▼"}</button>
      {abierto&&(
        <div style={{background:"#0d101a",border:"1px dashed #2d3f6e",borderTop:"none",borderRadius:"0 0 9px 9px",padding:"11px 13px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
            <span style={{fontSize:10,color:"#475569"}}>4 facturas de prueba — validan retenciones, PUC y autorretenedores</span>
            <button onClick={()=>lanzar(FACTURAS_TEST)} style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:5,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>▶ Cargar las 4</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
            {FACTURAS_TEST.map(t=>(
              <div key={t.nombre} style={{background:t.color,border:"1px solid #1e2a3a",borderRadius:7,padding:"8px 10px",display:"flex",gap:7,alignItems:"flex-start"}}>
                <span style={{fontSize:17}}>{t.icono}</span>
                <div style={{flex:1}}><div style={{fontFamily:"sans-serif",fontWeight:600,fontSize:12,color:"#e2e8f0"}}>{t.nombre}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{t.desc}</div></div>
                <button onClick={()=>lanzar([t])} style={{background:"transparent",border:"1px solid #2d3f6e",color:"#60a5fa",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:10}}>▶</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModalTerceros({ terceros, onUpdate, onDelete, onExport, onClose }) {
  const [busq, setBusq] = useState("");
  const [editNit, setEditNit] = useState(null);
  const COLS = [
    {k:"NIT",label:"NIT",w:110,mono:true},{k:"DigitoV",label:"DV",w:30},
    {k:"RazonSocial",label:"Razón Social",w:220},{k:"Telefono",label:"Teléfono",w:110,mono:true},
    {k:"Celular",label:"Celular",w:110,mono:true},{k:"Email",label:"Email",w:170},
    {k:"Ciudad",label:"Ciudad",w:100},{k:"Departamento",label:"Dpto",w:100},
    {k:"Persona",label:"Persona",w:75},{k:"Regimen",label:"Régimen",w:120},
    {k:"GranContribuyente",label:"G.Cont.",w:55},{k:"Autoretenedor",label:"AutoRet",w:55},
  ];
  const EDITABLE = ["Telefono","Celular","Email","Ciudad","Departamento","Pais","Persona","Regimen","DigitoV","RazonSocial","Direccion","GranContribuyente","Autoretenedor"];
  const filtrados = terceros.filter(t=>t.NIT?.includes(busq)||t.RazonSocial?.toLowerCase().includes(busq.toLowerCase())||t.Ciudad?.toLowerCase().includes(busq.toLowerCase()));
  const s = {
    modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:3000,display:"flex",flexDirection:"column",padding:16},
    box:{background:"#161923",border:"1px solid #232840",borderRadius:16,flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
    input:{background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"5px 9px",fontFamily:"monospace",fontSize:11,outline:"none"},
    btn:(c)=>({background:c||"#4f7cff",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,fontWeight:600}),
  };
  return (
    <div style={s.modal}>
      <div style={s.box}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #1e2235",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div><div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#fff"}}>👥 Base de Terceros</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>{terceros.length} proveedores</div></div>
          <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="Buscar NIT, nombre, ciudad..." style={{...s.input,width:220}}/>
          <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:11,color:"#4ade80",background:"#0a1a0a",border:"1px solid #166534",borderRadius:5,padding:"3px 9px"}}>{filtrados.length} mostrados</span>
            <button onClick={()=>onExport(terceros)} style={s.btn("#166534")}>⬇ Exportar Excel</button>
            <button onClick={onClose} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:12}}>✕</button>
          </div>
        </div>
        <div style={{flex:1,overflowX:"auto",overflowY:"auto"}}>
          {terceros.length===0?(
            <div style={{padding:40,textAlign:"center",color:"#475569"}}>
              <div style={{fontSize:32,marginBottom:10}}>👥</div>
              <div style={{fontFamily:"sans-serif",fontWeight:600,color:"#64748b",marginBottom:6}}>Sin terceros aún</div>
              <div style={{fontSize:12}}>Se agregan automáticamente al procesar facturas</div>
            </div>
          ):(
            <table style={{borderCollapse:"collapse",fontSize:11,minWidth:"100%"}}>
              <thead><tr style={{background:"#0d101a",position:"sticky",top:0,zIndex:2}}>
                {COLS.map(c=><th key={c.k} style={{padding:"7px 8px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235",whiteSpace:"nowrap",minWidth:c.w}}>{c.label}</th>)}
                <th style={{padding:"7px 8px",color:"#475569",fontSize:10,borderBottom:"1px solid #1e2235"}}>Acc</th>
              </tr></thead>
              <tbody>
                {filtrados.map((t,i)=>(
                  <tr key={t.NIT} style={{borderBottom:"1px solid #1a1d27",background:i%2===0?"transparent":"#0a0d14"}}>
                    {COLS.map(c=>(
                      <td key={c.k} style={{padding:"5px 8px",maxWidth:c.w+40,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {EDITABLE.includes(c.k)&&editNit===t.NIT
                          ?<input value={t[c.k]||""} onChange={e=>onUpdate(t.NIT,c.k,e.target.value)} style={{...s.input,width:"100%",padding:"3px 6px"}}/>
                          :<span onClick={()=>setEditNit(t.NIT)} title={t[c.k]||""} style={{cursor:EDITABLE.includes(c.k)?"pointer":"default",color:c.k==="NIT"?"#60a5fa":c.k==="RazonSocial"?"#e2e8f0":"#94a3b8",fontFamily:c.mono?"monospace":"inherit",borderBottom:EDITABLE.includes(c.k)?"1px dashed #2d3352":"none"}}>
                            {c.k==="GranContribuyente"||c.k==="Autoretenedor"?(t[c.k]==="1"?<span style={{color:"#fb923c",fontWeight:700}}>✓</span>:<span style={{color:"#2d3352"}}>—</span>):(t[c.k]||<span style={{color:"#2d3352",fontStyle:"italic"}}>—</span>)}
                          </span>}
                      </td>
                    ))}
                    <td style={{padding:"5px 8px"}}>
                      <div style={{display:"flex",gap:4}}>
                        {editNit===t.NIT?<button onClick={()=>setEditNit(null)} style={{...s.btn("#166534"),padding:"3px 8px"}}>✓</button>:<button onClick={()=>setEditNit(t.NIT)} style={{background:"transparent",border:"1px solid #2d3352",color:"#64748b",borderRadius:4,padding:"3px 7px",cursor:"pointer",fontSize:10}}>✏</button>}
                        <button onClick={()=>onDelete(t.NIT)} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"3px 7px",cursor:"pointer",fontSize:10}}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{padding:"10px 20px",borderTop:"1px solid #1e2235",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{fontSize:10,color:"#475569"}}>💡 Clic en celda para editar</div>
          <div style={{marginLeft:"auto",fontSize:11,color:"#64748b"}}>Con contacto: <span style={{color:"#4ade80"}}>{terceros.filter(t=>t.Telefono||t.Email).length}</span></div>
        </div>
      </div>
    </div>
  );
}

function ModalConfig({ config, onClose }) {
  const { puc, retenciones, autoRet, empresas, empresaActual, savePuc, saveRetenciones, saveAutoRet, saveEmpresas } = config;
  const [tab, setTab] = useState("empresas");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [empsLocal, setEmpsLocal] = useState(empresas.map(e=>({...e})));
  const [empSel, setEmpSel] = useState(empresaActual?.nit||empsLocal[0]?.nit||"");
  const [pucLocal, setPucLocal] = useState([...puc]);
  const [busqPuc, setBusqPuc] = useState("");
  const [retLocal, setRetLocal] = useState(retenciones.map(r=>({...r})));
  const [autoLocal, setAutoLocal] = useState(Object.entries(autoRet));
  const [busqAuto, setBusqAuto] = useState("");
  const [mostrarFormNueva, setMostrarFormNueva] = useState(false);
  const [nuevaNit, setNuevaNit] = useState("");
  const [nuevaNombre, setNuevaNombre] = useState("");
  const [errNueva, setErrNueva] = useState("");

  const cargarPucEmpresa = async (nit) => { setEmpSel(nit); const p=await cfgGet(`puc_${nit}`); setPucLocal(p||PUC_DEFAULT); setBusqPuc(""); };
  const pucFiltrado = pucLocal.filter(([c,n])=>c.includes(busqPuc)||n.toLowerCase().includes(busqPuc.toLowerCase()));
  const autoFiltrado = autoLocal.filter(([nit,nom])=>nit.includes(busqAuto)||nom.toLowerCase().includes(busqAuto.toLowerCase()));
  const empActualObj = empsLocal.find(e=>e.nit===empSel);

  const guardar = async () => {
    setGuardando(true); setMsg("");
    if (tab==="empresas") { await saveEmpresas(empsLocal); if(empSel) await savePuc(pucLocal,empSel); }
    if (tab==="retenciones") await saveRetenciones(retLocal);
    if (tab==="autorretenedores") await saveAutoRet(Object.fromEntries(autoLocal));
    setGuardando(false); setMsg("✓ Guardado correctamente"); setTimeout(()=>setMsg(""),3000);
  };

  const restaurarPuc = async () => {
    if (!confirm("¿Restaurar PUC por defecto? Se perderán los cambios.")) return;
    setPucLocal([...PUC_DEFAULT]); if(empSel) await savePuc(PUC_DEFAULT,empSel);
    setMsg("✓ PUC restaurado"); setTimeout(()=>setMsg(""),3000);
  };

  const importarPucXLSX = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try {
        const wb=XLSX.read(ev.target.result,{type:"array"}); const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1}); if(!rows.length){setMsg("❌ Archivo vacío");return;}
        const header=rows[0].map(h=>String(h||"").toLowerCase().trim());
        const hasNivel=header.includes("nivel")||header.includes("level");
        const colNombre=hasNivel?2:1; const colNivel=hasNivel?1:-1;
        let nuevas=[];
        const dataRows=(String(rows[0][0]||"").toLowerCase().includes("cod")||String(rows[0][0]||"").toLowerCase()==="código")?rows.slice(1):rows;
        dataRows.forEach(r=>{
          const cod=String(r[0]||"").trim(); const nom=String(r[colNombre]||"").trim();
          const nivel=colNivel>=0?String(r[colNivel]||"").trim().toLowerCase():"";
          if(!cod||!nom) return;
          if(cod.toLowerCase()==="código"||cod.toLowerCase()==="codigo") return;
          if(hasNivel&&nivel!=="auxiliar") return;
          nuevas.push([cod,nom]);
        });
        if(nuevas.length){setPucLocal(nuevas);setMsg(`✓ ${nuevas.length} cuentas importadas — guarda para aplicar`);setTimeout(()=>setMsg(""),5000);}
        else setMsg("❌ No se encontraron cuentas. Verifica formato.");
      } catch(err){setMsg("❌ Error: "+err.message);}
    };
    reader.readAsArrayBuffer(file); e.target.value="";
  };

  const importarAutoXLSX = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try {
        const wb=XLSX.read(ev.target.result,{type:"array"}); const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1}); const nuevos=[];
        rows.forEach(r=>{ const nit=String(r[0]||"").trim().replace(/[^0-9]/g,""); const nom=String(r[1]||"").trim(); if(nit.length>=9&&nom) nuevos.push([nit,nom]); });
        if(nuevos.length){setAutoLocal(nuevos);setMsg(`✓ ${nuevos.length} autorretenedores cargados`);}
      } catch{setMsg("❌ Error leyendo el archivo");}
    };
    reader.readAsArrayBuffer(file); e.target.value="";
  };

  const agregarEmpresa = () => {
    if(!nuevaNit||nuevaNit.length<6){setErrNueva("NIT inválido");return;}
    if(!nuevaNombre.trim()){setErrNueva("Ingresa el nombre");return;}
    if(empsLocal.find(e=>e.nit===nuevaNit)){setErrNueva("Ya existe");return;}
    setEmpsLocal(p=>[...p,{nit:nuevaNit,nombre:nuevaNombre.trim()}]);
    setEmpSel(nuevaNit); setPucLocal([...PUC_DEFAULT]); setMostrarFormNueva(false);
    setNuevaNit(""); setNuevaNombre(""); setErrNueva("");
    setMsg("✓ Empresa creada — importa su PUC y guarda");
  };

  const s={
    modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:3000,display:"flex",alignItems:"stretch",justifyContent:"center",padding:16,overflowY:"auto"},
    box:{background:"#161923",border:"1px solid #232840",borderRadius:16,padding:0,maxWidth:960,width:"100%",display:"flex",flexDirection:"column",maxHeight:"95vh"},
    body:{flex:1,overflowY:"auto",padding:"16px 20px"},
    input:{background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"6px 10px",fontFamily:"monospace",fontSize:12,outline:"none"},
    btn:(c)=>({background:c||"#4f7cff",color:"#fff",border:"none",borderRadius:6,padding:"7px 16px",cursor:"pointer",fontSize:12,fontWeight:600}),
    tab:(act)=>({padding:"10px 18px",cursor:"pointer",fontSize:12,fontWeight:600,color:act?"#fff":"#64748b",background:act?"#0f1117":"transparent",borderBottom:act?"2px solid #4f7cff":"2px solid transparent",border:"none"}),
  };

  return (
    <div style={s.modal}>
      <div style={s.box}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid #1e2235",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:15,color:"#fff"}}>⚙️ Configuración</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>Datos guardados en Netlify Blobs</div></div>
          <button onClick={onClose} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>✕</button>
        </div>
        <div style={{display:"flex",gap:0,borderBottom:"1px solid #1e2235"}}>
          {[["empresas","🏢 Empresas & PUC"],["retenciones","% Retenciones"],["autorretenedores","🔒 Autorretenedores"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={s.tab(tab===k)}>{l}</button>
          ))}
        </div>
        <div style={s.body}>
          {tab==="empresas"&&(
            <div style={{display:"flex",gap:16,height:"100%"}}>
              <div style={{width:240,flexShrink:0}}>
                <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600,flex:1}}>Empresas ({empsLocal.length})</div>
                  <button onClick={()=>setMostrarFormNueva(v=>!v)} style={s.btn()}>+ Nueva</button>
                </div>
                {mostrarFormNueva&&(
                  <div style={{background:"#0d101a",border:"1px solid #4f7cff",borderRadius:8,padding:"10px",marginBottom:10}}>
                    <div style={{fontSize:10,color:"#60a5fa",fontWeight:600,marginBottom:8}}>Nueva empresa</div>
                    <input value={nuevaNit} onChange={e=>setNuevaNit(e.target.value.replace(/[^0-9]/g,""))} placeholder="NIT (solo números)" style={{...s.input,width:"100%",marginBottom:6}}/>
                    <input value={nuevaNombre} onChange={e=>setNuevaNombre(e.target.value)} placeholder="Nombre / Razón social" style={{...s.input,width:"100%",marginBottom:8}} onKeyDown={e=>{if(e.key==="Enter")agregarEmpresa();}}/>
                    {errNueva&&<div style={{fontSize:11,color:"#f87171",marginBottom:6}}>{errNueva}</div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={agregarEmpresa} style={{...s.btn(),flex:1,padding:"6px"}}>Agregar</button>
                      <button onClick={()=>{setMostrarFormNueva(false);setNuevaNit("");setNuevaNombre("");setErrNueva("");}} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:12}}>✕</button>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:420,overflowY:"auto"}}>
                  {empsLocal.length===0&&!mostrarFormNueva&&<div style={{fontSize:11,color:"#475569",padding:"12px 8px",textAlign:"center",background:"#0d101a",borderRadius:7,border:"1px dashed #2d3352"}}>Sin empresas.<br/>Usa "+ Nueva".</div>}
                  {empsLocal.map(e=>(
                    <div key={e.nit} onClick={()=>cargarPucEmpresa(e.nit)} style={{background:empSel===e.nit?"#1e2a3a":"#0d101a",border:`1px solid ${empSel===e.nit?"#4f7cff":"#1e2235"}`,borderRadius:8,padding:"9px 12px",cursor:"pointer"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:13}}>{empSel===e.nit?"🏢":"🏛"}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:empSel===e.nit?"#fff":"#cbd5e1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.nombre}</div>
                          <div style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>{e.nit}</div>
                        </div>
                        <button onClick={ev=>{ev.stopPropagation();const resto=empsLocal.filter(x=>x.nit!==e.nit);setEmpsLocal(resto);if(empSel===e.nit&&resto[0])cargarPucEmpresa(resto[0].nit);}} style={{background:"transparent",border:"none",color:"#475569",cursor:"pointer",fontSize:11,padding:"2px 4px"}}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{flex:1,minWidth:0}}>
                {!empSel&&<div style={{color:"#475569",fontSize:12,padding:20,textAlign:"center"}}>Selecciona o crea una empresa</div>}
                {empSel&&(
                  <>
                    <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
                      <div style={{fontSize:12,color:"#60a5fa",fontWeight:600,flex:1}}>📋 PUC — {empActualObj?.nombre||empSel}</div>
                      <input value={busqPuc} onChange={e=>setBusqPuc(e.target.value)} placeholder="Buscar..." style={{...s.input,width:160}}/>
                      <button onClick={()=>{setPucLocal(p=>[["","Nueva cuenta"],...p]);setBusqPuc("");}} style={s.btn()}>+ Cuenta</button>
                      <label style={{...s.btn("#166534"),cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5}}>
                        📥 Importar Excel<input type="file" accept=".xlsx,.xls" onChange={importarPucXLSX} style={{display:"none"}}/>
                      </label>
                      <span style={{fontSize:10,color:"#64748b"}}>{pucLocal.length} cuentas</span>
                    </div>
                    <div style={{fontSize:10,color:"#475569",marginBottom:6}}>Col A = código, col B = nombre. Si tiene columna Nivel, importa solo Auxiliar.</div>
                    <div id="puc-table" style={{background:"#0d101a",borderRadius:8,border:"1px solid #1e2235",overflow:"hidden",maxHeight:400,overflowY:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead style={{position:"sticky",top:0}}><tr style={{background:"#131620"}}>
                          {["Código","Nombre",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235"}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {pucFiltrado.slice(0,100).map(([cod,nom],i)=>{
                            const idx=pucLocal.findIndex(r=>r[0]===cod&&r[1]===nom);
                            return (
                              <tr key={i} style={{borderBottom:"1px solid #1a1d27"}}>
                                <td style={{padding:"5px 10px"}}><input value={cod} onChange={e=>{const n=[...pucLocal];n[idx]=[e.target.value,nom];setPucLocal(n);}} style={{...s.input,width:90}}/></td>
                                <td style={{padding:"5px 10px"}}><input value={nom} onChange={e=>{const n=[...pucLocal];n[idx]=[cod,e.target.value];setPucLocal(n);}} style={{...s.input,width:"100%"}}/></td>
                                <td style={{padding:"5px 10px",textAlign:"center"}}><button onClick={()=>setPucLocal(p=>p.filter((_,j)=>j!==idx))} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑</button></td>
                              </tr>
                            );
                          })}
                          {pucFiltrado.length>100&&<tr><td colSpan={3} style={{padding:"8px 10px",color:"#64748b",fontSize:11,textAlign:"center"}}>Mostrando 100 de {pucFiltrado.length} — usa el buscador</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {tab==="retenciones"&&(
            <div>
              <div style={{background:"#0d101a",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#60a5fa"}}>
                ℹ️ <strong>Nueva lógica 2026:</strong> Las retenciones se calculan automáticamente según la fecha de cada factura y los 3 periodos normativos (Dec. 1625, Dec. 0572/2025, Boletín DIAN 070/2026). Esta tabla es solo referencia visual — la IA usa RETENCIONES_TABLA con UVT dinámico.
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
                <button onClick={()=>setRetLocal(r=>[...r,{id:`r${Date.now()}`,concepto:"Nuevo concepto",tarifa:0,base:1,cuenta:""}])} style={s.btn()}>+ Retención</button>
                <div style={{fontSize:11,color:"#64748b"}}>{retLocal.length} conceptos</div>
              </div>
              <div style={{background:"#0d101a",borderRadius:8,border:"1px solid #1e2235",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#131620"}}>
                    {["Concepto","Tarifa %","Base mínima $",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {retLocal.map((r,i)=>(
                      <tr key={r.id} style={{borderBottom:"1px solid #1a1d27"}}>
                        <td style={{padding:"5px 10px"}}><input value={r.concepto} onChange={e=>{const n=[...retLocal];n[i]={...r,concepto:e.target.value};setRetLocal(n);}} style={{...s.input,width:"100%"}}/></td>
                        <td style={{padding:"5px 10px"}}><input type="number" value={r.tarifa} onChange={e=>{const n=[...retLocal];n[i]={...r,tarifa:parseFloat(e.target.value)||0};setRetLocal(n);}} style={{...s.input,width:70}}/></td>
                        <td style={{padding:"5px 10px"}}><input type="number" value={r.base} onChange={e=>{const n=[...retLocal];n[i]={...r,base:parseFloat(e.target.value)||0};setRetLocal(n);}} style={{...s.input,width:110}}/></td>
                        <td style={{padding:"5px 10px",textAlign:"center"}}><button onClick={()=>setRetLocal(r=>r.filter((_,j)=>j!==i))} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab==="autorretenedores"&&(
            <div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
                <input value={busqAuto} onChange={e=>setBusqAuto(e.target.value)} placeholder="Buscar NIT o razón social..." style={{...s.input,flex:1,minWidth:200}}/>
                <label style={{...s.btn("#166534"),display:"inline-block",cursor:"pointer"}}>📥 Importar Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={importarAutoXLSX} style={{display:"none"}}/></label>
                <button onClick={()=>setAutoLocal(a=>[["","Nueva empresa"],...a])} style={s.btn()}>+ Agregar</button>
                <div style={{fontSize:11,color:"#64748b"}}>{autoLocal.length} empresas</div>
              </div>
              <div style={{background:"#0d101a",borderRadius:8,border:"1px solid #1e2235",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#131620"}}>
                    {["NIT","Razón social",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#475569",fontSize:10,fontWeight:600,borderBottom:"1px solid #1e2235"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {autoFiltrado.slice(0,60).map(([nit,nom],i)=>{
                      const idx=autoLocal.findIndex(r=>r[0]===nit&&r[1]===nom);
                      return (
                        <tr key={i} style={{borderBottom:"1px solid #1a1d27"}}>
                          <td style={{padding:"5px 10px"}}><input value={nit} onChange={e=>{const n=[...autoLocal];n[idx]=[e.target.value,nom];setAutoLocal(n);}} style={{...s.input,width:110,fontFamily:"monospace"}}/></td>
                          <td style={{padding:"5px 10px"}}><input value={nom} onChange={e=>{const n=[...autoLocal];n[idx]=[nit,e.target.value];setAutoLocal(n);}} style={{...s.input,width:"100%"}}/></td>
                          <td style={{padding:"5px 10px",textAlign:"center"}}><button onClick={()=>setAutoLocal(a=>a.filter((_,j)=>j!==idx))} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑</button></td>
                        </tr>
                      );
                    })}
                    {autoFiltrado.length>60&&<tr><td colSpan={3} style={{padding:"8px 10px",color:"#64748b",fontSize:11,textAlign:"center"}}>Mostrando 60 de {autoFiltrado.length}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div style={{padding:"12px 20px",borderTop:"1px solid #1e2235",display:"flex",gap:10,alignItems:"center",justifyContent:"flex-end"}}>
          {msg&&<span style={{fontSize:12,color:msg.startsWith("❌")?"#f87171":"#22c55e",flex:1}}>{msg}</span>}
          {tab==="empresas"&&<button onClick={restaurarPuc} style={{background:"transparent",border:"1px solid #7c3700",color:"#fb923c",borderRadius:6,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>Restaurar PUC</button>}
          <button onClick={guardar} disabled={guardando} style={{background:guardando?"#1e2235":"#4f7cff",color:"#fff",border:"none",borderRadius:6,padding:"7px 16px",cursor:guardando?"not-allowed":"pointer",fontSize:12,fontWeight:600}}>{guardando?"Guardando...":"💾 Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave]     = useState("");
  const [error, setError]     = useState("");
  const [cargando, setCargando] = useState(false);
  const intentar = async () => {
    if (!usuario||!clave) { setError("Ingresa usuario y clave"); return; }
    setCargando(true); setError("");
    await new Promise(r=>setTimeout(r,300));
    const ok = onLogin(usuario,clave);
    if (!ok) { setError("Usuario o clave incorrectos"); setCargando(false); }
  };
  return (
    <div style={{fontFamily:"monospace",background:"#0f1117",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,padding:36,maxWidth:380,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:48,height:48,background:"linear-gradient(135deg,#4f7cff,#8b5cf6)",borderRadius:12,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:12}}>⚡</div>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:20,color:"#fff"}}>ContaIA DIAN</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:4}}>Contabilización automática con IA</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Usuario</div>
            <input value={usuario} onChange={e=>setUsuario(e.target.value)} onKeyDown={e=>e.key==="Enter"&&intentar()} placeholder="admin" autoFocus style={{width:"100%",background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:8,padding:"10px 14px",fontFamily:"monospace",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Clave</div>
            <input type="password" value={clave} onChange={e=>setClave(e.target.value)} onKeyDown={e=>e.key==="Enter"&&intentar()} placeholder="••••••••" style={{width:"100%",background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:8,padding:"10px 14px",fontFamily:"monospace",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          {error&&<div style={{background:"#1a0a0a",border:"1px solid #3b1f1f",borderRadius:6,padding:"8px 12px",fontSize:12,color:"#f87171"}}>⚠ {error}</div>}
          <button onClick={intentar} disabled={cargando} style={{background:cargando?"#1e2235":"#4f7cff",color:"#fff",border:"none",borderRadius:8,padding:"11px",cursor:cargando?"not-allowed":"pointer",fontSize:14,fontWeight:700,marginTop:4}}>{cargando?"Verificando...":"Ingresar →"}</button>
        </div>
        <div style={{marginTop:20,fontSize:10,color:"#475569",textAlign:"center"}}>Netlify Blobs · Multi-usuario · Multi-empresa</div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const config = useConfig();
  const { puc, retenciones, autoRet, cargando, empresas, empresaActual, setEmpresaActual } = config;
  const auth = useAuth();
  const { logueado, usuarioActual, login, logout } = auth;
  const { terceros, upsertTercero, updateTercero, deleteTercero, exportarTercerosXLSX } = useTerceros();
  const { registrar: registrarAprendizaje, contextoParaPrompt } = useAprendizaje();

  // CORRECCIÓN 3: usar hook con persistencia
  const { facturas, setFacturas, limpiar: limpiarFacturas } = useFacturasPersistentes();

  const [modal, setModal]           = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [progreso, setProgreso]     = useState({actual:0, total:0});
  const [modalExport, setModalExport]   = useState(false);
  const [modalConfig, setModalConfig]   = useState(false);
  const [modalTerceros, setModalTerceros] = useState(false);
  const [docNumInicio]              = useState("1");

  // CORRECCIÓN 2: ref para scroll de la lista de facturas
  const listaRef = useRef(null);

  if (!logueado) return <LoginScreen onLogin={login} />;

  const recibirArchivos = (lista) => {
    const v = Array.from(lista).filter(f=>f.name.endsWith(".xml")||f.name.endsWith(".pdf"));
    if (v.length) setModal({ archivos:v });
  };

  const confirmarTratamiento = async (tratamiento, tratIva) => {
    const { archivos } = modal;
    setModal(null); setProcesando(true);
    setProgreso({actual:0, total:archivos.length});
    for (let i=0; i<archivos.length; i++) {
      setProgreso({actual:i+1, total:archivos.length});
      await (async (archivo) => {
        try {
          let datos = {};
          if (archivo.name.toLowerCase().endsWith(".pdf")) datos = await parsePDFFactura(archivo);
          else { const t=await archivo.text(); datos=parseXMLFactura(t)||{}; }
          const descripciones = (datos.items||[]).map(i=>i.descripcion).filter(Boolean);
          const contextoAprendizaje = contextoParaPrompt(descripciones);
          // CORRECCIÓN 1: analizarConIA ahora usa buildRetencionesTxt internamente
          const ia = await analizarConIA(datos, tratamiento, tratIva, puc, retenciones, contextoAprendizaje);
          const nit = (datos.nitProveedor||"").replace(/[^0-9]/g,"");
          const esA = !!autoRet[nit];
          const terceroNuevo = extraerTerceroDeFactura({...datos, esAutorretenedor:esA});
          if (terceroNuevo) upsertTercero(terceroNuevo);
          const base = datos.subtotal||0;
          // CORRECCIÓN 1: validar retefuente con la tabla de periodos
          const retefuente_val = esA ? 0 : Math.round(base*(ia.retefuente_pct/100));
          setFacturas(prev=>[...prev,{
            id:Date.now()+Math.random(),
            fechaCarga: new Date().toISOString(), // para persistencia por día
            archivo:archivo.name, tratamiento, tratIva,
            empresa: empresaActual,
            ...datos, ia,
            retefuente: retefuente_val,
            retica: Math.round(base*(ia.retica_por_mil/1000)),
            esAutorretenedor:esA, nombreAutorret:autoRet[nit]||null,
            aprobado:false, asiento:null,
          }]);
        } catch(e) {
          setFacturas(prev=>[...prev,{id:Date.now()+Math.random(),fechaCarga:new Date().toISOString(),archivo:archivo.name,error:e.message}]);
        }
      })(archivos[i]);
      if (i < archivos.length-1) await sleep(2000);
    }
    setProcesando(false);
  };

  const upd = (id,k,v) => setFacturas(p=>p.map(f=>f.id===id?{...f,[k]:v}:f));
  const aprobadas = [...facturas].filter(f=>f.aprobado&&!f.error).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  const getDocNum = id => { const i=aprobadas.findIndex(f=>f.id===id); return i===-1?null:(parseInt(docNumInicio)||1)+i; };
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;

  return (
    <div style={{fontFamily:"monospace",background:"#0f1117",minHeight:"100vh",color:"#e2e8f0",
      // CORRECCIÓN 2: layout de altura fija para scroll independiente
      display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:#3a3f5c;border-radius:3px} .dz{border:2px dashed #2d3352;border-radius:14px;padding:44px 24px;text-align:center;transition:all .2s;cursor:pointer} .dz:hover,.dz.over{border-color:#4f7cff;background:rgba(79,124,255,.05)} @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {modal&&<ModalTratamiento archivos={modal.archivos} empresaActual={empresaActual} empresas={empresas} onEmpresa={setEmpresaActual} onConfirm={confirmarTratamiento} onCancel={()=>setModal(null)}/>}
      {modalExport&&<ModalExport facturas={facturas} onClose={()=>setModalExport(false)}/>}
      {modalConfig&&<ModalConfig config={config} onClose={()=>setModalConfig(false)}/>}
      {modalTerceros&&<ModalTerceros terceros={terceros} onUpdate={updateTercero} onDelete={deleteTercero} onExport={exportarTercerosXLSX} onClose={()=>setModalTerceros(false)}/>}

      {/* NAVBAR — altura fija */}
      <div style={{background:"#0d101a",borderBottom:"1px solid #1e2235",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:"linear-gradient(135deg,#4f7cff,#8b5cf6)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>⚡</div>
          <div>
            <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#fff"}}>ContaIA DIAN</div>
            <div style={{fontSize:9,color:"#64748b"}}>Contabilización automática</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flex:1,maxWidth:320,margin:"0 12px"}}>
          <span style={{fontSize:11,color:"#475569",whiteSpace:"nowrap"}}>🏢</span>
          {empresas.length===0
            ?<button onClick={()=>setModalConfig(true)} style={{background:"#1e2235",border:"1px dashed #4f7cff",color:"#60a5fa",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11}}>+ Crear empresa →</button>
            :<select value={empresaActual?.nit||""} onChange={e=>{const emp=empresas.find(x=>x.nit===e.target.value);if(emp){setEmpresaActual(emp);limpiarFacturas();}}} style={{flex:1,background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"5px 8px",fontSize:11,cursor:"pointer",outline:"none"}}>
              {empresas.map(e=><option key={e.nit} value={e.nit}>{e.nombre} · {e.nit}</option>)}
            </select>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          {cargando?<div style={{fontSize:11,color:"#64748b"}}>⏳</div>:empresaActual&&<div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:5,padding:"3px 9px",fontSize:10,color:"#4ade80",fontWeight:600}}>✓ {puc.length} PUC</div>}
          <div style={{fontSize:10,color:"#64748b"}}>👤 {usuarioActual?.usuario}</div>
          <button onClick={()=>setModalConfig(true)} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:11}}>⚙️</button>
          <button onClick={()=>setModalTerceros(true)} style={{background:"transparent",border:"1px solid #2d3352",color:"#60a5fa",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:11,fontWeight:600}} title="Base de terceros">
            👥{terceros.length>0&&<span style={{marginLeft:3,fontSize:10,color:"#4ade80"}}>{terceros.length}</span>}
          </button>
          <button onClick={logout} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:11,fontWeight:600}}>🚪</button>
          {facturas.length>0&&<div style={{fontSize:11,color:"#64748b"}}><span style={{color:"#4f7cff",fontWeight:700}}>{facturas.filter(f=>!f.error).length}</span>/<span style={{color:"#22c55e",fontWeight:700}}>{aprobadas.length}</span></div>}
          {aprobadas.length>0&&<button onClick={()=>setModalExport(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>⬇ Excel</button>}
          {facturas.length>0&&<button onClick={limpiarFacturas} style={{background:"transparent",border:"1px solid #2d3352",color:"#64748b",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>🗑</button>}
        </div>
      </div>

      {/* CORRECCIÓN 2: contenido con scroll propio */}
      <div ref={listaRef} style={{flex:1, overflowY:"auto", overflowX:"hidden"}}>
        <div style={{maxWidth:1040,margin:"0 auto",padding:"20px 16px"}}>

          {!empresaActual&&(
            <div style={{background:"#0f1a2e",border:"1px solid #4f7cff",borderRadius:10,padding:"16px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:22}}>🏢</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:"sans-serif",fontWeight:700,color:"#60a5fa",marginBottom:3}}>Configura tu primera empresa</div>
                <div style={{fontSize:12,color:"#64748b"}}>Ve a ⚙️ → "Empresas & PUC" para crear una empresa y subir su PUC.</div>
              </div>
              <button onClick={()=>setModalConfig(true)} style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:7,padding:"8px 16px",cursor:"pointer",fontSize:12,fontWeight:700}}>Configurar →</button>
            </div>
          )}

          {/* CORRECCIÓN 3: aviso de facturas restauradas */}
          {facturas.length>0&&facturas.some(f=>f.fechaCarga&&!f._new)&&(
            <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:7,padding:"7px 14px",marginBottom:12,fontSize:11,color:"#4ade80",display:"flex",alignItems:"center",gap:8}}>
              💾 {facturas.length} factura{facturas.length!==1?"s":""} restaurada{facturas.length!==1?"s":""} del día — los datos se guardan automáticamente
              <button onClick={limpiarFacturas} style={{marginLeft:"auto",background:"transparent",border:"1px solid #166534",color:"#4ade80",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10}}>Limpiar</button>
            </div>
          )}

          <div className="dz" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("over")}} onDragLeave={e=>e.currentTarget.classList.remove("over")} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove("over");recibirArchivos(e.dataTransfer.files)}} onClick={()=>document.getElementById("fi").click()}>
            <input id="fi" type="file" multiple accept=".xml,.pdf" style={{display:"none"}} onChange={e=>recibirArchivos(e.target.files)}/>
            {procesando
              ?<div>
                <div style={{fontSize:28,marginBottom:8,display:"inline-block",animation:"spin 1s linear infinite"}}>⚙️</div>
                <div style={{fontFamily:"sans-serif",fontSize:14,color:"#4f7cff",fontWeight:600}}>Procesando con IA…</div>
                {progreso.total>1&&<div style={{marginTop:6,fontSize:12,color:"#64748b"}}>{progreso.actual} de {progreso.total} facturas</div>}
                {progreso.total>1&&<div style={{marginTop:6,width:200,height:4,background:"#1e2235",borderRadius:2,margin:"6px auto 0"}}>
                  <div style={{width:`${(progreso.actual/progreso.total)*100}%`,height:"100%",background:"#4f7cff",borderRadius:2,transition:"width .3s"}}></div>
                </div>}
              </div>
              :<div>
                <div style={{fontSize:34,marginBottom:8}}>📂</div>
                <div style={{fontFamily:"sans-serif",fontSize:14,fontWeight:600,color:"#cbd5e1"}}>Arrastra facturas XML o PDF aquí</div>
                {empresaActual&&<div style={{fontSize:11,color:"#475569",marginTop:4}}>Empresa: <span style={{color:"#60a5fa"}}>{empresaActual.nombre}</span> · {puc.length} cuentas PUC</div>}
              </div>}
          </div>

          <TestPanel onCargar={recibirArchivos}/>

          {facturas.length>0&&(
            <div style={{marginTop:22,display:"flex",flexDirection:"column",gap:12}}>
              <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:14,color:"#fff"}}>
                Facturas <span style={{color:"#4f7cff"}}>({facturas.length})</span>
                {empresaActual&&<span style={{fontSize:11,color:"#64748b",fontWeight:400,marginLeft:10}}>· {empresaActual.nombre}</span>}
              </div>
              {[...aprobadas,...facturas.filter(f=>!f.aprobado||f.error)].map((f,i)=>(
                <FacturaCard key={f.id} f={f} idx={facturas.indexOf(f)} onUpdate={upd} docNum={f.aprobado&&!f.error?getDocNum(f.id):null} onAprender={registrarAprendizaje}/>
              ))}

              {/* CORRECCIÓN 2: resumen pegado al fondo del scroll, no flotante */}
              {aprobadas.length>0&&(
                <div style={{background:"#0f1a2e",border:"1px solid #1e3a5f",borderRadius:10,padding:"16px 20px",marginTop:4,marginBottom:20}}>
                  <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#60a5fa",marginBottom:12}}>📊 Resumen · {aprobadas.length} aprobadas</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
                    {[["Total facturado",fmt(aprobadas.reduce((s,f)=>s+(f.total||0),0)),"#4ade80"],["(−) ReteFuente",fmt(aprobadas.reduce((s,f)=>s+(f.retefuente||0),0)),"#f87171"],["(−) ReteICA",fmt(aprobadas.reduce((s,f)=>s+(f.retica||0),0)),"#f87171"],["Neto a pagar",fmt(aprobadas.reduce((s,f)=>s+(f.total||0)-(f.retefuente||0)-(f.retica||0),0)),"#fbbf24"]].map(([l,v,c])=>(
                      <div key={l} style={{background:"#0d1520",borderRadius:7,padding:"10px 13px"}}>
                        <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>{l}</div>
                        <div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end"}}>
                    <button onClick={()=>setModalExport(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",cursor:"pointer",fontSize:13,fontWeight:700}}>⬇ Exportar comprobante Excel</button>
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
