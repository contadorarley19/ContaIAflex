# Extensión ContaIA DIAN — Descarga Directa

Esta extensión permite descargar facturas de la DIAN usando tu propio navegador,
evitando el bloqueo de Cloudflare que afecta al servidor.

## Cómo instalarla (una sola vez)

1. Descomprime esta carpeta en algún lugar de tu computador (por ejemplo, Documentos)
2. Abre Chrome y ve a: `chrome://extensions`
3. Activa el interruptor **"Modo de desarrollador"** (arriba a la derecha)
4. Haz clic en **"Cargar descomprimida"** (Load unpacked)
5. Selecciona esta carpeta (la que contiene `manifest.json`)
6. Listo — verás la extensión "ContaIA DIAN" instalada

## Cómo usarla

1. Abre el portal DIAN en Chrome con tu token del correo (como siempre)
   - Esto deja tu sesión activa y pasa el Cloudflare
2. En otra pestaña abre ContaIA (contaiaflex.netlify.app)
3. Ve al módulo de Descarga DIAN
4. El ContaIA detectará la extensión automáticamente
5. Pon el rango de fechas y descarga — la extensión usa tu sesión activa

## Importante

- Debes estar logueado en la DIAN en el mismo Chrome para que funcione
- La extensión NO guarda ni envía tus datos a ningún lado — solo descarga las
  facturas y se las pasa al ContaIA en tu propia pantalla
- Si la sesión de la DIAN expira, vuelve a abrir el token del correo
