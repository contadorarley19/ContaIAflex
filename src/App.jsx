import { useState, useCallback } from "react";

const API_URL = "/.netlify/functions/claude";

const PUC_EMPRESA = `plncod	plnnom
1	ACTIVO
11050501	Caja general
11051001	Caja menor
11100501	Puerto concordia
11100502	Cumaral
11100503	Cumaral colpatria
11100504	La macarena
11200501	Banco de bogota 351345202
13050501	Clientes
13300501	A proveedores
13353505	En garantia
13551501	1% contrato de obra
13551502	1% transporte de carga
13551510	10% honorarios
13551511	11% honorarios
13551535	3.5% compras
13551750	50% rete iva
13551801	Retencion de industri y comercio
14100508	Honorarios
14300501	Alquileres
14301002	Obras civiles
14301501	Servicios tecnicos
14301504	Aseo y vigilancia
14301601	Correo transportes y fletes
14301801	Mantenimiento y reparaciones
14301901	Adecuacion e instalacion
14302001	Instalaciones electricas
14305001	Transportes fletes y acarreos
14310501	Polizas
143505	COMPRAS
14350501	Compras para la construccion de obras
14450501	Transporte de carga
14456001	Telefono
14456002	Luz
14456003	Acueducto y alcantarillado
14530505	Gastos bancarios
14531001	Gravamen y movimiento financiero
14532001	Intereses
14550501	Alojamiento y manutencion
14952001	Elementos de aseo y cafeteria
14952101	Utiles papeleria y fotocopias
14953501	Combustibles y lubricantes
14959501	Otros
15200501	Maquinaria y equipo
15240501	Equipo de oficina
2	PASIVO
22050101	Proveedores
23352501	Honorarios
23353001	Servicios
23354001	Arrendamientos
23354501	Transportes fletes y acarreos
23651510	10% honorarios
23651511	11% honorarios
23652501	1% transporte
23652502	2% ser. vigilancia
23652504	4% servicios declarantes
23652506	6% servicios no declarantes
23652535	Transporte de pasajeros 3.5%
23653035	3.5% arriendo inmuebles
23653040	4% arriendo muebles
23654001	0.1% combustible
23654035	2.5% compras
23654036	Rete de 3.5%
23657001	1% contrato de obra
23657002	Obra 2%
23670101	Impuesto a las ventas retenido
24081010	Iva compras
24081501	Retencion de iva
25050501	Salarios por pagar
5	GASTOS
51100501	Honorarios
51353001	Energia electrica
51353501	Telefono
51354001	Mensajeria
51355001	Transporte flete y acarreo
51959901	Otros gastos
6	COSTO DE VENTAS
61100508	Honorarios
61157001	Iva transitorio compras
61157002	Iva de servicios
61201501	Alquileres maquinaria
61300501	Alquileres construccion
61301002	Obras civiles
61301501	Servicios tecnicos
61301502	Aseo y vigilancia
61301801	Mantenimiento y reparacion
61305001	Transportes fletes y acarreos
61310501	Polizas
613505	COMPRAS
61350501	Compras para la construccion de obras
61350502	Compra material reposicion 1%
61350503	Compra productos de señalizacion
61360501	Aseo y vigilancia
61360504	Telefono
61360505	Transporte fletes y acarreos
61360507	Acueducto y alcantarillado
61360509	Transporte de pasajeros
61360510	Transporte de carga
61361501	Asistencia tecnica
61400501	Notariales
61400502	Gastos legales
61450501	Transporte de carga
61455001	Mantenimiento y reparaciones
61550501	Alojamiento y manutencion
61552001	Pasajes terrestres
61952001	Elementos de aseo y cafeteria
61952101	Utiles de papeleria y fotocopias
61953501	Combustible
61953502	Lubricantes
61959901	Otros gastos`;

const AUTORRETENEDORES = {
  "899999068":"ECOPETROL S.A.","899999082":"EMPRESA DE ENERGIA DE BOGOTA S.A. ESP",
  "899999094":"EMPRESA DE ACUEDUCTO ALCANTARILLADO Y ASEO DE BOGOTA ESP",
  "899999115":"EMPRESA DE TELECOMUNICACIONES DE BOGOTA SA ESP",
  "860016610":"INTERCONEXION ELECTRICA S.A. E.S.P","811000740":"ISAGEN S.A. E.S.P.",
  "890904996":"EMPRESAS PUBLICAS DE MEDELLIN E.S.P.","890905055":"EMPRESAS VARIAS DE MEDELLIN S.A. E.S.P",
  "800021272":"GASES DEL LLANO S.A ESP","800202395":"EFIGAS GAS NATURAL S.A. E.S.P.",
  "830045472":"GAS NATURAL CUNDIBOYACENSE S.A. E.S.P.","830037248":"CODENSA S.A. ESP",
  "860063875":"EMGESA S.A. ESP","830025205":"AES CHIVOR & CIA SCA ESP",
  "890903407":"SEGUROS GENERALES SURAMERICANA S.A.","890903790":"SEGUROS DE VIDA SURAMERICANA S.A.",
  "800087219":"ZURICH DE OCCIDENTE S.A","830054904":"MAPFRE COLOMBIA VIDA SEGUROS S.A.",
  "891700037":"MAPFRE SEGUROS GENERALES DE COLOMBIA S.A.","819001190":"COMPAÑIA DE SEGUROS DEL ESTADO S.A.",
  "860700198":"LA PREVISORA S.A. COMPAÑIA DE SEGUROS","888000286":"POSITIVA COMPAÑIA DE SEGUROS S.A.",
  "860001942":"BAYER S.A.","890900266":"GRUPO ARGOS S.A.","860002304":"GENERAL MOTORS COLMOTORES S.A.",
  "860002130":"NESTLE DE COLOMBIA S.A.","860005224":"BAVARIA S.A.","890900608":"ALMACENES ÉXITO S.A.",
  "860025900":"ALPINA PRODUCTOS ALIMENTICIOS S.A.","800153993":"COMUNICACIÓN CELULAR S.A COMCEL S.A.",
  "830122566":"COLOMBIA TELECOMUNICACIONES S.A. E.S.P.","800007813":"GAS NATURAL S.A - ESP",
  "860002518":"UNILEVER ANDINA COLOMBIA LTDA.","860005289":"ASCENSORES SCHINDLER DE COLOMBIA S.A.",
  "860074450":"QUALA S.A.","860002554":"EXXONMOBIL DE COLOMBIA S.A.",
  "860005223":"CHEVRON PETROLEUM COMPANY","890300546":"COLGATE PALMOLIVE COMPANIA",
  "860039561":"PFIZER S.A.","860002134":"ABBOTT LABORATORIES DE COLOMBIA S.A.",
  "830039568":"ASTRAZENECA COLOMBIA S.A.S.","860003216":"PRODUCTOS ROCHE S.A.",
  "800198591":"BRANCH OF MICROSOFT COLOMBIA INC","830035246":"DELL COLOMBIA INC.",
  "800241958":"HEWLETT PACKARD COLOMBIA LTDA","830065063":"LG ELECTRONICS COLOMBIA LIMITADA",
  "830028931":"SAMSUNG ELECTRONICS LATINOAMERICA S.A.","860031028":"SIEMENS SOCIEDAD ANONIMA",
  "860025285":"ERICSSON DE COLOMBIA S.A.","890300406":"CARTON DE COLOMBIA S.A.",
  "890900161":"PRODUCTOS FAMILIA S.A.","860015753":"COLOMBIANA KIMBERLY COLPAPEL S.A.",
  "830002366":"BIMBO DE COLOMBIA SA","890900535":"KELLOGG DE COLOMBIA S.A.",
  "890301884":"COLOMBINA S.A.","800242106":"SODIMAC COLOMBIA S.A.",
  "830067394":"MERCADOLIBRE COLOMBIA LTDA","900480569":"JERONIMO MARTINS COLOMBIA S.A.S.",
  "900155107":"EASY COLOMBIA S.A.","860013951":"G4S SECURE SOLUTIONS COLOMBIA S.A.",
  "860350234":"BRINKS DE COLOMBIA S.A.","830025104":"PROSEGUR TECNOLOGIA S.A.S",
};

const FACTURAS_TEST = [
  { nombre:"Ferretería (varios ítems)", desc:"Tornillos, puntillas, cemento · 02-mar", icono:"🔩", color:"#1e3a5f",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>FE-2026-1047</cbc:ID><cbc:IssueDate>2026-03-02</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900123456</cbc:CompanyID><cbc:RegistrationName>FERRETERÍA EL CLAVO DORADO S.A.S.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">47500</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">250000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">297500</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>100</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">50000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Puntillas 2 pulgadas</cbc:Description></cac:Item></cac:InvoiceLine><cac:InvoiceLine><cbc:InvoicedQuantity>50</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">75000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Tornillos autoperforantes 3/8</cbc:Description></cac:Item></cac:InvoiceLine><cac:InvoiceLine><cbc:InvoicedQuantity>5</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">125000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Cemento gris x 50kg</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Transporte nacional", desc:"Flete Bogotá-Medellín · 10-mar", icono:"🚛", color:"#1a2d1a",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>TRP-2026-0312</cbc:ID><cbc:IssueDate>2026-03-10</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800234567</cbc:CompanyID><cbc:RegistrationName>TRANSPORTES RÁPIDOS DEL NORTE LTDA.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">850000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">850000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Flete terrestre Bogotá-Medellín 500kg</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Honorarios profesional", desc:"Asesoría contable · 15-mar", icono:"👨‍💼", color:"#1a1a2e",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>HON-2026-0089</cbc:ID><cbc:IssueDate>2026-03-15</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>79654321</cbc:CompanyID><cbc:RegistrationName>CARLOS ANDRÉS GÓMEZ REYES</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">2000000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">2000000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Honorarios revisoría fiscal mayo 2026</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
  { nombre:"Bayer S.A. (autorretenedor)", desc:"NIT 860001942 · 20-mar", icono:"🔒", color:"#2d1a00",
    xml:`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>BAYER-FV-20260320</cbc:ID><cbc:IssueDate>2026-03-20</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>860001942</cbc:CompanyID><cbc:RegistrationName>BAYER S.A.</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:TaxTotal><cbc:TaxAmount currencyID="COP">285000</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">1785000</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:InvoicedQuantity>10</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">1500000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Productos farmacéuticos</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>` },
];

function parseXMLFactura(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText,"text/xml");
    const get = tag => doc.getElementsByTagNameNS("*",tag)[0]?.textContent?.trim()||"";
    const supplier = doc.getElementsByTagNameNS("*","AccountingSupplierParty")[0];
    const gf = (node,tag) => node?.getElementsByTagNameNS("*",tag)[0]?.textContent?.trim()||"";
    const items = Array.from(doc.getElementsByTagNameNS("*","InvoiceLine")).map(l=>({
      descripcion: l.getElementsByTagNameNS("*","Description")[0]?.textContent?.trim()||"",
      cantidad: parseFloat(l.getElementsByTagNameNS("*","InvoicedQuantity")[0]?.textContent||"1"),
      valor: parseFloat(l.getElementsByTagNameNS("*","LineExtensionAmount")[0]?.textContent||"0"),
    }));
    return {
      prefijo:get("ID"), fecha:get("IssueDate"),
      nitProveedor:gf(supplier,"CompanyID")||get("CompanyID"),
      razonSocial:gf(supplier,"RegistrationName")||get("RegistrationName"),
      direccion:gf(supplier,"Line"), ciudad:gf(supplier,"CityName"), departamento:gf(supplier,"CountrySubentity"),
      subtotal:parseFloat(get("LineExtensionAmount")||"0"),
      totalIva:parseFloat(get("TaxAmount")||"0"),
      total:parseFloat(get("PayableAmount")||"0"),
      items,
    };
  } catch { return null; }
}

async function callClaude(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function parsePDFFactura(archivo) {
  const base64 = await new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result.split(",")[1]);
    r.onerror = ()=>rej(new Error("No se pudo leer el PDF"));
    r.readAsDataURL(archivo);
  });
  const data = await callClaude({
    model:"claude-sonnet-4-5", max_tokens:1500,
    messages:[{role:"user",content:[
      {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
      {type:"text",text:`Lee esta factura y extrae los datos. Responde SOLO JSON sin markdown.
Formato: {"prefijo":"","fecha":"YYYY-MM-DD","nitProveedor":"solo números","razonSocial":"","direccion":"","ciudad":"","departamento":"","subtotal":0,"totalIva":0,"total":0,"items":[{"descripcion":"","cantidad":1,"valor":0}]}`}
    ]}]
  });
  const text = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
  return JSON.parse(text);
}

async function analizarConIA(datos, tratamiento, tratIva) {
  const itemsTexto = datos.items?.length
    ? datos.items.map(i=>`- Cant ${i.cantidad} | ${i.descripcion} | $${i.valor.toLocaleString("es-CO")}`).join("\n")
    : "(sin ítems)";
  const instrTrat = tratamiento==="inventario"
    ? `INVENTARIO: conserva cada ítem por separado. Usa SOLO cuentas 14x. NUNCA uses 61x ni 51x. Cuenta principal: 14350501. Una línea por ítem.`
    : `COSTO/GASTO: resume en UN solo concepto. Usa SOLO cuentas 61x o 51x. NUNCA uses cuentas 14x. Cuenta principal: 61350501.`;
  const instrIva = tratIva==="descontable"
    ? `IVA → 24081010 "Iva compras"`
    : `IVA → detecta: bienes físicos=61157001 "Iva transitorio compras", servicios=61157002 "Iva de servicios"`;

  const prompt = `Eres contador colombiano experto en PUC. Responde SOLO JSON válido.

FACTURA:
Proveedor: ${datos.razonSocial} | NIT: ${datos.nitProveedor} | Fecha: ${datos.fecha}
Ítems:
${itemsTexto}
Subtotal: $${datos.subtotal?.toLocaleString("es-CO")} | IVA: $${datos.totalIva?.toLocaleString("es-CO")} | Total: $${datos.total?.toLocaleString("es-CO")}

PUC EMPRESA (SOLO estas cuentas):
${PUC_EMPRESA}

${instrTrat}

RETENCIONES (usa solo cuentas del PUC):
23654035=2.5% compras | 23654036=3.5% compras no decl | 23652501=1% transporte
23652504=4% servicios decl | 23652506=6% servicios no decl
23651510=10% honorarios | 23651511=11% honorarios | 23653035=3.5% arriendos | 23657002=2% obra

${instrIva}

REGLAS CONTABLES ESTRICTAS — NUNCA las violes:
DÉBITO siempre: cuentas de costo (6x), gasto (5x), inventario/contratos (14x), IVA descontable (24081010), IVA al gasto (61157001, 61157002)
CRÉDITO siempre: proveedores (22x), retenciones (23x), IVA por pagar (24x excepto 24081010)
NUNCA pongas retenciones (23x) ni proveedores (22x) en débito.
NUNCA pongas costos/gastos (6x, 5x) en crédito.

JSON:
{"concepto_general":"","tipo_cuenta":"Inventario|Costo|Gasto","retefuente_pct":0,"retefuente_descripcion":"","cuenta_retefuente_codigo":"","cuenta_retefuente_nombre":"","retica_por_mil":0,"advertencia_puc":"","cuenta_iva_codigo":"","cuenta_iva_nombre":"","lineas_contables":[{"descripcion":"","cantidad":1,"valor_base":0,"cuenta_debito_codigo":"","cuenta_debito_nombre":"","sin_cuenta_exacta":false}]}

IMPORTANTE: lineas_contables debe contener SOLO líneas de costo/gasto/inventario. NO incluyas cuentas 22x ni 23x en lineas_contables.`;

  const data = await callClaude({
    model:"claude-sonnet-4-5", max_tokens:2000,
    messages:[{role:"user",content:prompt}],
  });
  const text = data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
  return JSON.parse(text);
}

function generarFilasContables(factura, docNum, config) {
  const { tpcCod, prfCod, docAux, ctoCod } = config;
  const fila = (plnCod, docDet, deb, cre) => ({
    DocNum:docNum, DocFec:factura.fecha||"", TpcCod:tpcCod,
    PlnCod:plnCod, DocDet:docDet, TerNit:factura.nitProveedor||"", CtoCod:ctoCod,
    DocDeb:deb||"", DocCre:cre||"", PrfCod:prfCod, DocAux:docAux, SubCto:"",
  });
  const filas = [];
  const asiento = factura.asiento;
  if (asiento?.length) {
    asiento.forEach(r => filas.push(fila(r.cuenta, r.descripcion, r.tipo==="debito"?r.valor:"", r.tipo==="credito"?r.valor:"")));
  }
  return filas;
}

function exportarExcel(facturas, config, soloUna=null) {
  const lista = [...(soloUna?[soloUna]:facturas)]
    .filter(f=>f.aprobado&&!f.error)
    .sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  const headers = ["DocNum","DocFec","TpcCod","PlnCod","DocDet","TerNit","CtoCod","DocDeb","DocCre","PrfCod","DocAux","SubCto"];
  const rows = [headers];
  let cons = parseInt(config.docNumInicio)||1;
  lista.forEach(f => {
    generarFilasContables(f,cons,config).forEach(r=>rows.push(headers.map(h=>r[h]??"")));
    cons++;
  });
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8,%EF%BB%BF"+encodeURIComponent(csv);
  a.download = soloUna ? `comprobante_${soloUna.prefijo||soloUna.nitProveedor}.csv` : `comprobante_${config.tpcCod}_${config.docNumInicio}.csv`;
  a.click();
}

function CeldaEditable({ valor, onChange, tipo="text", style={} }) {
  const [editando, setEditando] = useState(false);
  const [tmp, setTmp] = useState(valor);
  const confirmar = () => { onChange(tipo==="number"?parseFloat(tmp)||0:tmp); setEditando(false); };
  if (editando) return (
    <input autoFocus type={tipo} value={tmp}
      onChange={e=>setTmp(e.target.value)}
      onBlur={confirmar}
      onKeyDown={e=>{ if(e.key==="Enter")confirmar(); if(e.key==="Escape")setEditando(false); }}
      style={{background:"#0d101a",border:"1px solid #4f7cff",color:"#e2e8f0",borderRadius:4,padding:"2px 6px",fontFamily:"monospace",fontSize:11,width:"100%",outline:"none",...style}}
    />
  );
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
          {[
            {k:"docNumInicio",label:"DocNum — Consecutivo inicial",ph:"Ej: 29",help:"Suma +1 por factura en orden de fecha"},
            {k:"tpcCod",label:"TpcCod — Tipo de documento",ph:"Ej: CO",help:"Código del comprobante en tu software"},
            {k:"prfCod",label:"PrfCod — Prefijo",ph:"Ej: COMP",help:"Prefijo del comprobante"},
            {k:"ctoCod",label:"CtoCod — Centro de costo",ph:"Ej: CC001",help:"Código del centro de costo"},
            {k:"docAux",label:"DocAux — Auxiliar / Referencia",ph:"Ej: OC-2026-01",help:"Referencia adicional (opcional)"},
          ].map(({k,label,ph,help})=>(
            <div key={k}>
              <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>{label}</div>
              <input value={cfg[k]} onChange={e=>set(k,e.target.value)} placeholder={ph}
                style={{width:"100%",background:"#0f1117",border:"1px solid #2d3352",color:"#e2e8f0",borderRadius:6,padding:"7px 10px",fontFamily:"monospace",fontSize:12,outline:"none"}}/>
              <div style={{fontSize:10,color:"#475569",marginTop:2}}>{help}</div>
            </div>
          ))}
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>Vista previa</div>
          <div style={{background:"#0d101a",borderRadius:7,border:"1px solid #1e2235",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"#131620"}}>
                  {["DocNum","Fecha","Proveedor","N° Factura","Total","Neto"].map(h=>(
                    <th key={h} style={{padding:"6px 9px",color:"#475569",fontSize:10,fontWeight:600,textAlign:"left",borderBottom:"1px solid #1e2235"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.length===0
                  ? <tr><td colSpan={6} style={{padding:"12px",color:"#475569",textAlign:"center"}}>Sin facturas aprobadas</td></tr>
                  : preview.map((f,i)=>(
                    <tr key={f.id} style={{borderBottom:"1px solid #1e2235",background:i%2===0?"transparent":"#0a0d14"}}>
                      <td style={{padding:"6px 9px"}}><span style={{background:"#1e2a3a",color:"#60a5fa",padding:"2px 8px",borderRadius:4,fontFamily:"monospace",fontWeight:700}}>{cfg.tpcCod} {f.docNumAsignado}</span></td>
                      <td style={{padding:"6px 9px",color:"#94a3b8"}}>{f.fecha}</td>
                      <td style={{padding:"6px 9px",color:"#cbd5e1",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.razonSocial}</td>
                      <td style={{padding:"6px 9px",color:"#64748b",fontFamily:"monospace"}}>{f.prefijo}</td>
                      <td style={{padding:"6px 9px",color:"#4ade80",fontWeight:600}}>{fmt(f.total)}</td>
                      <td style={{padding:"6px 9px",color:"#fbbf24",fontWeight:600}}>{fmt((f.total||0)-(f.retefuente||0)-(f.retica||0))}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
        <div style={{borderTop:"1px solid #1e2235",paddingTop:14,display:"flex",gap:10,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center"}}>
          <div style={{fontSize:11,color:"#475569",flex:1}}>CSV compatible con Excel e importación contable</div>
          <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:130,overflowY:"auto",border:"1px solid #1e2235",borderRadius:6,padding:"6px 8px",minWidth:210}}>
            <div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:2}}>📄 Por factura:</div>
            {preview.map(f=>(
              <button key={f.id} onClick={()=>exportarExcel(facturas,cfg,f)}
                style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:10,textAlign:"left",whiteSpace:"nowrap"}}>
                ⬇ {cfg.tpcCod}{f.docNumAsignado} · {f.razonSocial?.slice(0,18)}
              </button>
            ))}
          </div>
          <button onClick={()=>exportarExcel(facturas,cfg)} disabled={aprobadas.length===0}
            style={{background:aprobadas.length?"#4f7cff":"#1e2235",color:aprobadas.length?"#fff":"#475569",border:"none",borderRadius:8,padding:"10px 22px",cursor:aprobadas.length?"pointer":"not-allowed",fontSize:13,fontWeight:700}}>
            ⬇ Descargar TODAS ({aprobadas.length})
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalTratamiento({ archivos, onConfirm, onCancel }) {
  const [tratamiento, setTratamiento] = useState(null);
  const [tratIva, setTratIva] = useState(null);
  const listo = tratamiento && tratIva;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"}}>
      <div style={{background:"#161923",border:"1px solid #232840",borderRadius:16,padding:26,maxWidth:540,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:26,marginBottom:8}}>📋</div>
          <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:16,color:"#fff",marginBottom:4}}>¿Cómo se contabiliza?</div>
          <div style={{fontSize:11,color:"#64748b"}}>{archivos.length===1?`📄 ${archivos[0].name}`:`${archivos.length} archivos`}</div>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Paso 1 — Tratamiento</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              {key:"inventario",icono:"📦",titulo:"Inventario",desc:"Ítem por ítem · cta 1435",color:"#1e3a5f",borde:"#3b6fd4"},
              {key:"gasto",icono:"📉",titulo:"Costo / Gasto",desc:"Concepto resumido · cta 6135",color:"#2d1b4e",borde:"#8b5cf6"},
            ].map(op=>(
              <button key={op.key} onClick={()=>setTratamiento(op.key)}
                style={{background:tratamiento===op.key?op.color:"#0f1117",border:`2px solid ${tratamiento===op.key?op.borde:"#232840"}`,borderRadius:10,padding:"13px",cursor:"pointer",textAlign:"left"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                  <span style={{fontSize:17}}>{op.icono}</span>
                  <span style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#fff"}}>{op.titulo}</span>
                  {tratamiento===op.key&&<span style={{marginLeft:"auto",color:op.borde}}>✓</span>}
                </div>
                <div style={{fontSize:11,color:"#94a3b8"}}>{op.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Paso 2 — IVA</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {[
              {key:"descontable",icono:"🔄",titulo:"IVA descontable",desc:"Activo · 24081010",color:"#1e3a5f",borde:"#3b6fd4"},
              {key:"gasto",icono:"📉",titulo:"IVA al gasto (consorcio)",desc:"Sin IVA generado · IA detecta 61157001 o 61157002",color:"#1a2d1a",borde:"#22c55e"},
            ].map(op=>(
              <button key={op.key} onClick={()=>setTratIva(op.key)}
                style={{background:tratIva===op.key?op.color:"#0f1117",border:`2px solid ${tratIva===op.key?op.borde:"#232840"}`,borderRadius:9,padding:"10px 13px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:17,minWidth:22}}>{op.icono}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#fff",marginBottom:2}}>{op.titulo}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{op.desc}</div>
                </div>
                {tratIva===op.key&&<span style={{fontSize:14,color:op.borde}}>✓</span>}
              </button>
            ))}
          </div>
        </div>
        <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:6,padding:"6px 12px",marginBottom:14,fontSize:11,color:"#4ade80"}}>
          ✓ <strong>PUC integrado</strong> — la IA usará exclusivamente las cuentas de la empresa.
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
          <button onClick={()=>listo&&onConfirm(tratamiento,tratIva)} disabled={!listo}
            style={{background:listo?"#4f7cff":"#1e2235",color:listo?"#fff":"#475569",border:"none",padding:"8px 22px",borderRadius:6,cursor:listo?"pointer":"not-allowed",fontSize:13,fontWeight:700}}>
            {listo?"Procesar →":"Completa los 2 pasos"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FacturaCard({ f, idx, onUpdate, docNum }) {
  const [expandido, setExpandido] = useState(true);
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;

  const asientoInicial = useCallback(() => {
    if (!f.ia) return [];
   const lineasUnicas = [];
    const cuentasVistas = new Set();
    (f.ia.lineas_contables||[]).forEach((l)=>{
      const cta = l.cuenta_debito_codigo||"";
      if (!cta || cta==="22050101" || cuentasVistas.has(cta)) return;
      cuentasVistas.add(cta);
      const esPasivo = cta.startsWith("22")||cta.startsWith("23")||cta.startsWith("24");
      lineasUnicas.push({id:`lc${cuentasVistas.size}`,tipo:esPasivo?"credito":"debito",descripcion:l.descripcion,valor:l.valor_base,cuenta:cta,editable:true,eliminable:true,advertencia:l.sin_cuenta_exacta});
    });
    filas.push(...lineasUnicas);
    });
    if (f.totalIva>0 && f.ia.cuenta_iva_codigo)
      filas.push({id:"iva",tipo:"debito",descripcion:f.ia.cuenta_iva_nombre||"IVA",valor:f.totalIva,cuenta:f.ia.cuenta_iva_codigo,editable:true,eliminable:true,advertencia:false});
    // CRÉDITOS — retenciones y proveedor
    if (!f.esAutorretenedor && (f.retefuente||0)>0 && f.ia.cuenta_retefuente_codigo)
      filas.push({id:"rete",tipo:"credito",descripcion:f.ia.retefuente_descripcion||"Retención en la fuente",valor:f.retefuente,cuenta:f.ia.cuenta_retefuente_codigo,editable:true,eliminable:true,advertencia:false});
    if ((f.retica||0)>0)
      filas.push({id:"retica",tipo:"credito",descripcion:"Retención industria y comercio",valor:f.retica,cuenta:"13551801",editable:true,eliminable:true,advertencia:false});
    const neto = (f.total||0)-(f.esAutorretenedor?0:(f.retefuente||0))-(f.retica||0);
    filas.push({id:"prov",tipo:"credito",descripcion:`Proveedor — ${(f.razonSocial||"").slice(0,40)}`,valor:neto,cuenta:"22050101",editable:true,eliminable:false,advertencia:false});
    return filas;
  },[f]);

  const [filas, setFilas] = useState(()=> f.asiento || asientoInicial());
  const recalcProv = useCallback(fs => {
    const deb = fs.filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0);
    const cre = fs.filter(r=>r.tipo==="credito"&&r.id!=="prov").reduce((s,r)=>s+r.valor,0);
    return fs.map(r=>r.id==="prov"?{...r,valor:Math.max(0,deb-cre)}:r);
  },[]);

  const updFila = (id,campo,valor) => { const n=recalcProv(filas.map(r=>r.id===id?{...r,[campo]:valor}:r)); setFilas(n); onUpdate(f.id,"asiento",n); };
  const elimFila = id => { const n=recalcProv(filas.filter(r=>r.id!==id)); setFilas(n); onUpdate(f.id,"asiento",n); };
  const addFila = () => {
    const n=recalcProv([...filas.filter(r=>r.id!=="prov"),{id:`x${Date.now()}`,tipo:"debito",descripcion:"Nueva línea",valor:0,cuenta:"",editable:true,eliminable:true,advertencia:true},...filas.filter(r=>r.id==="prov")]);
    setFilas(n); onUpdate(f.id,"asiento",n);
  };

  const totalDeb = filas.filter(r=>r.tipo==="debito").reduce((s,r)=>s+r.valor,0);
  const totalCre = filas.filter(r=>r.tipo==="credito").reduce((s,r)=>s+r.valor,0);
  const cuadra   = Math.abs(totalDeb-totalCre)<1;
  const neto     = filas.find(r=>r.id==="prov")?.valor||0;
  const hayAdv   = filas.some(r=>r.advertencia);
  const tratColor= f.tratamiento==="inventario"?"#60a5fa":"#c084fc";
  const tratBg   = f.tratamiento==="inventario"?"#0e1825":"#120e1f";

  if (f.error) return (
    <div style={{background:"#1a0a0a",border:"1px solid #3b1f1f",borderRadius:10,padding:"12px 18px",display:"flex",gap:10,alignItems:"center"}}>
      <span style={{color:"#64748b",fontSize:11}}>#{(idx+1).toString().padStart(2,"0")}</span>
      <span style={{color:"#f87171",fontSize:13}}>❌ {f.archivo}: {f.error}</span>
    </div>
  );

  return (
    <div style={{background:"#161923",border:`1px solid ${f.aprobado?"#166534":cuadra?"#232840":"#7c3700"}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{background:tratBg,borderBottom:"1px solid #1e2235",padding:"8px 16px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"#475569",fontWeight:600}}>#{(idx+1).toString().padStart(2,"0")}</span>
        {docNum&&<span style={{background:"#1e2a3a",color:"#60a5fa",padding:"2px 9px",borderRadius:4,fontFamily:"monospace",fontSize:11,fontWeight:700}}>DocNum:{docNum}</span>}
        <span style={{display:"inline-flex",alignItems:"center",gap:4,background:f.tratamiento==="inventario"?"#1e3a5f":"#2d1b4e",color:tratColor,border:`1px solid ${tratColor}44`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>
          {f.tratamiento==="inventario"?"📦 Inventario":"📉 Costo/Gasto"}
        </span>
        {f.esAutorretenedor&&<span style={{background:"#2d1a00",color:"#fb923c",border:"1px solid #7c370066",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>🔒 Autorretenedor</span>}
        {hayAdv&&<span style={{background:"#2d2000",color:"#fbbf24",border:"1px solid #78570066",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>⚠ Verificar cuenta</span>}
        {!cuadra&&<span style={{background:"#3b1f1f",color:"#f87171",border:"1px solid #7c3700",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>⚡ Descuadrado</span>}
        {f.aprobado&&<span style={{background:"#14532d",color:"#86efac",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600}}>✓ Aprobado</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button onClick={()=>setExpandido(e=>!e)} style={{background:"transparent",border:"1px solid #2d3352",color:"#94a3b8",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:11}}>{expandido?"▲":"▼ Asiento"}</button>
          <button onClick={()=>{ if(!cuadra){alert("El asiento está descuadrado.");return;} onUpdate(f.id,"aprobado",!f.aprobado); }}
            style={{background:f.aprobado?"#14532d":"#4f7cff",color:f.aprobado?"#86efac":"#fff",border:"none",borderRadius:6,padding:"3px 14px",cursor:"pointer",fontSize:11,fontWeight:700}}>
            {f.aprobado?"✓ Aprobado":"Aprobar"}
          </button>
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
              <thead>
                <tr style={{background:"#131620"}}>
                  {["Tipo","PlnCod","Descripción","Débito","Crédito",""].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"6px 9px",color:"#475569",fontSize:10,fontWeight:600,textTransform:"uppercase",borderBottom:"1px solid #1e2235"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map(r=>(
                  <tr key={r.id} style={{borderBottom:"1px solid #1a1d27",background:r.advertencia?"#1a120022":r.id==="prov"?"#0a0d14":"transparent"}}>
                    <td style={{padding:"6px 9px"}}>
                      {!f.aprobado&&r.editable&&r.id!=="prov"
                        ? <select value={r.tipo} onChange={e=>updFila(r.id,"tipo",e.target.value)} style={{background:"#1e2235",border:"1px solid #2d3352",color:r.tipo==="debito"?"#4ade80":"#f87171",borderRadius:4,padding:"2px 6px",fontSize:10,cursor:"pointer"}}><option value="debito">DÉB</option><option value="credito">CRÉ</option></select>
                        : <span style={{fontSize:10,fontWeight:700,color:r.tipo==="debito"?"#4ade80":"#f87171",background:r.tipo==="debito"?"#0a2010":"#200a0a",padding:"2px 7px",borderRadius:4}}>{r.tipo==="debito"?"DÉB":"CRÉ"}</span>}
                    </td>
                    <td style={{padding:"6px 9px"}}>
                      {!f.aprobado&&r.editable
                        ? <CeldaEditable valor={r.cuenta} onChange={v=>updFila(r.id,"cuenta",v)} style={{fontFamily:"monospace",color:r.advertencia?"#fb923c":"#60a5fa",fontWeight:600}}/>
                        : <span style={{fontFamily:"monospace",color:r.advertencia?"#fb923c":"#60a5fa",fontWeight:600}}>{r.cuenta}</span>}
                      {r.advertencia&&<span style={{marginLeft:4,fontSize:9,color:"#fbbf24"}}>⚠</span>}
                    </td>
                    <td style={{padding:"6px 9px",maxWidth:180}}>
                      {!f.aprobado&&r.editable
                        ? <CeldaEditable valor={r.descripcion} onChange={v=>updFila(r.id,"descripcion",v)} style={{color:"#cbd5e1"}}/>
                        : <span style={{color:"#94a3b8"}}>{r.descripcion}</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"right"}}>
                      {r.tipo==="debito"
                        ? (!f.aprobado&&r.editable ? <CeldaEditable valor={r.valor} onChange={v=>updFila(r.id,"valor",v)} tipo="number" style={{color:"#4ade80",fontWeight:600,textAlign:"right"}}/> : <span style={{color:"#4ade80",fontWeight:600}}>{fmt(r.valor)}</span>)
                        : <span style={{color:"#2d3352"}}>—</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"right"}}>
                      {r.tipo==="credito"
                        ? (!f.aprobado&&r.editable ? <CeldaEditable valor={r.valor} onChange={v=>updFila(r.id,"valor",v)} tipo="number" style={{color:r.id==="prov"?"#fbbf24":"#f87171",fontWeight:600,textAlign:"right"}}/> : <span style={{color:r.id==="prov"?"#fbbf24":"#f87171",fontWeight:r.id==="prov"?700:600}}>{fmt(r.valor)}</span>)
                        : <span style={{color:"#2d3352"}}>—</span>}
                    </td>
                    <td style={{padding:"6px 9px",textAlign:"center"}}>
                      {!f.aprobado&&r.eliminable
                        ? <button onClick={()=>elimFila(r.id)} style={{background:"transparent",border:"1px solid #3b1f1f",color:"#f87171",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑</button>
                        : r.id==="prov" ? <span style={{fontSize:10,color:"#fbbf24"}}>auto</span>
                        : <span style={{fontSize:10,color:f.aprobado?"#22c55e":"#475569"}}>{f.aprobado?"🔒":""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:"#131620",borderTop:"2px solid #1e2235"}}>
                  <td colSpan={3} style={{padding:"6px 9px",color:"#64748b",fontSize:11,fontWeight:600}}>TOTALES</td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:"#4ade80",fontSize:12}}>{fmt(totalDeb)}</td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:"#f87171",fontSize:12}}>{fmt(totalCre)}</td>
                  <td style={{padding:"6px 9px",textAlign:"center"}}><span style={{fontWeight:700,color:cuadra?"#22c55e":"#f87171"}}>{cuadra?"✓":"✗"}</span></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!f.aprobado&&<div style={{marginTop:7,fontSize:10,color:"#475569"}}>💡 Clic sobre cualquier valor para editar · <strong style={{color:"#fbbf24"}}>Proveedor</strong> se recalcula automáticamente.</div>}
        </div>
      )}
    </div>
  );
}

function TestPanel({ onCargar }) {
  const [abierto, setAbierto] = useState(false);
  const lanzar = xmls => onCargar(xmls.map((t,i)=>new File([new Blob([t.xml],{type:"text/xml"})],`test-${i+1}.xml`,{type:"text/xml"})));
  return (
    <div style={{marginTop:10}}>
      <button onClick={()=>setAbierto(a=>!a)} style={{background:"transparent",border:"1px dashed #2d3f6e",color:"#60a5fa",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:600}}>
        🧪 {abierto?"Ocultar":"Panel de pruebas"} {abierto?"▲":"▼"}
      </button>
      {abierto&&(
        <div style={{background:"#0d101a",border:"1px dashed #2d3f6e",borderTop:"none",borderRadius:"0 0 9px 9px",padding:"11px 13px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
            <span style={{fontSize:10,color:"#475569"}}>4 facturas de prueba con fechas distintas</span>
            <button onClick={()=>lanzar(FACTURAS_TEST)} style={{background:"#4f7cff",color:"#fff",border:"none",borderRadius:5,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>▶ Cargar las 4</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
            {FACTURAS_TEST.map(t=>(
              <div key={t.nombre} style={{background:t.color,border:"1px solid #1e2a3a",borderRadius:7,padding:"8px 10px",display:"flex",gap:7,alignItems:"flex-start"}}>
                <span style={{fontSize:17}}>{t.icono}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"sans-serif",fontWeight:600,fontSize:12,color:"#e2e8f0"}}>{t.nombre}</div>
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>{t.desc}</div>
                </div>
                <button onClick={()=>lanzar([t])} style={{background:"transparent",border:"1px solid #2d3f6e",color:"#60a5fa",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:10}}>▶</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [facturas, setFacturas]       = useState([]);
  const [modal, setModal]             = useState(null);
  const [procesando, setProcesando]   = useState(false);
  const [modalExport, setModalExport] = useState(false);
  const [docNumInicio]                = useState("1");

  const recibirArchivos = useCallback(lista => {
    const v = Array.from(lista).filter(f=>f.name.endsWith(".xml")||f.name.endsWith(".pdf"));
    if (v.length) setModal({ archivos:v });
  },[]);

  const confirmarTratamiento = useCallback(async (tratamiento, tratIva) => {
    const { archivos } = modal;
    setModal(null); setProcesando(true);
    for (let i=0; i<archivos.length; i+=4) {
      await Promise.all(archivos.slice(i,i+4).map(async archivo => {
        try {
          let datos = {};
          if (archivo.name.toLowerCase().endsWith(".pdf")) datos = await parsePDFFactura(archivo);
          else { const t=await archivo.text(); datos=parseXMLFactura(t)||{}; }
          const ia  = await analizarConIA(datos,tratamiento,tratIva);
          const nit = (datos.nitProveedor||"").replace(/[^0-9]/g,"");
          const esA = !!AUTORRETENEDORES[nit];
          const base= datos.subtotal||0;
          setFacturas(prev=>[...prev,{
            id:Date.now()+Math.random(), archivo:archivo.name, tratamiento, tratIva,
            ...datos, ia,
            retefuente:esA?0:+(base*(ia.retefuente_pct/100)).toFixed(0),
            retica:+(base*(ia.retica_por_mil/1000)).toFixed(0),
            esAutorretenedor:esA, nombreAutorret:AUTORRETENEDORES[nit]||null,
            aprobado:false, asiento:null,
          }]);
        } catch(e) {
          setFacturas(prev=>[...prev,{id:Date.now()+Math.random(),archivo:archivo.name,error:e.message}]);
        }
      }));
    }
    setProcesando(false);
  },[modal]);

  const upd = (id,k,v) => setFacturas(p=>p.map(f=>f.id===id?{...f,[k]:v}:f));
  const aprobadas = [...facturas].filter(f=>f.aprobado&&!f.error).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  const getDocNum = id => { const i=aprobadas.findIndex(f=>f.id===id); return i===-1?null:(parseInt(docNumInicio)||1)+i; };
  const fmt = n => `$${Number(n||0).toLocaleString("es-CO")}`;

  return (
    <div style={{fontFamily:"monospace",background:"#0f1117",minHeight:"100vh",color:"#e2e8f0"}}>
      <style>{`*{box-sizing:border-box} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:#3a3f5c;border-radius:3px} .dz{border:2px dashed #2d3352;border-radius:14px;padding:44px 24px;text-align:center;transition:all .2s;cursor:pointer} .dz:hover,.dz.over{border-color:#4f7cff;background:rgba(79,124,255,.05)} @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {modal&&<ModalTratamiento archivos={modal.archivos} onConfirm={confirmarTratamiento} onCancel={()=>setModal(null)}/>}
      {modalExport&&<ModalExport facturas={facturas} onClose={()=>setModalExport(false)}/>}

      <div style={{background:"#0d101a",borderBottom:"1px solid #1e2235",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:32,height:32,background:"linear-gradient(135deg,#4f7cff,#8b5cf6)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚡</div>
          <div>
            <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:14,color:"#fff"}}>ContaIA DIAN</div>
            <div style={{fontSize:10,color:"#64748b"}}>Contabilización automática · PUC integrado</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{background:"#0a1a0a",border:"1px solid #166534",borderRadius:5,padding:"4px 10px",fontSize:10,color:"#4ade80",fontWeight:600}}>✓ PUC cargado</div>
          {facturas.length>0&&<div style={{fontSize:11,color:"#64748b"}}><span style={{color:"#4f7cff",fontWeight:700}}>{facturas.filter(f=>!f.error).length}</span> facturas · <span style={{color:"#22c55e",fontWeight:700}}>{aprobadas.length}</span> aprobadas</div>}
          {aprobadas.length>0&&<button onClick={()=>setModalExport(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}>⬇ Exportar Excel</button>}
          {facturas.length>0&&<button onClick={()=>setFacturas([])} style={{background:"transparent",border:"1px solid #2d3352",color:"#64748b",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:11}}>🗑</button>}
        </div>
      </div>

      <div style={{maxWidth:1040,margin:"0 auto",padding:"24px 16px"}}>
        <div className="dz"
          onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("over")}}
          onDragLeave={e=>e.currentTarget.classList.remove("over")}
          onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove("over");recibirArchivos(e.dataTransfer.files)}}
          onClick={()=>document.getElementById("fi").click()}>
          <input id="fi" type="file" multiple accept=".xml,.pdf" style={{display:"none"}} onChange={e=>recibirArchivos(e.target.files)}/>
          {procesando
            ? <div><div style={{fontSize:28,marginBottom:8,display:"inline-block",animation:"spin 1s linear infinite"}}>⚙️</div><div style={{fontFamily:"sans-serif",fontSize:14,color:"#4f7cff",fontWeight:600}}>Procesando con IA…</div></div>
            : <div><div style={{fontSize:34,marginBottom:8}}>📂</div><div style={{fontFamily:"sans-serif",fontSize:14,fontWeight:600,color:"#cbd5e1"}}>Arrastra facturas XML o PDF aquí</div><div style={{fontSize:11,color:"#64748b",marginTop:4}}>Se preguntará el tratamiento antes de procesar</div></div>}
        </div>

        <TestPanel onCargar={recibirArchivos}/>

        {facturas.length>0&&(
          <div style={{marginTop:22,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:14,color:"#fff"}}>
              Facturas <span style={{color:"#4f7cff"}}>({facturas.length})</span>
            </div>
            {[...aprobadas,...facturas.filter(f=>!f.aprobado||f.error)].map((f,i)=>(
              <FacturaCard key={f.id} f={f} idx={facturas.indexOf(f)} onUpdate={upd} docNum={f.aprobado&&!f.error?getDocNum(f.id):null}/>
            ))}
            {aprobadas.length>0&&(
              <div style={{background:"#0f1a2e",border:"1px solid #1e3a5f",borderRadius:10,padding:"16px 20px",marginTop:4}}>
                <div style={{fontFamily:"sans-serif",fontWeight:700,fontSize:13,color:"#60a5fa",marginBottom:12}}>📊 Resumen · {aprobadas.length} aprobadas</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
                  {[
                    ["Total facturado",fmt(aprobadas.reduce((s,f)=>s+(f.total||0),0)),"#4ade80"],
                    ["(−) ReteFuente",fmt(aprobadas.reduce((s,f)=>s+(f.retefuente||0),0)),"#f87171"],
                    ["(−) ReteICA",fmt(aprobadas.reduce((s,f)=>s+(f.retica||0),0)),"#f87171"],
                    ["Neto a pagar",fmt(aprobadas.reduce((s,f)=>s+(f.total||0)-(f.retefuente||0)-(f.retica||0),0)),"#fbbf24"],
                  ].map(([l,v,c])=>(
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
  );
}
