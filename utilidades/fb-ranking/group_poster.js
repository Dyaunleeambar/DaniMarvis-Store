/**
 * group_poster.js
 * Publica (o prepara) posts en grupos de Facebook usando el navegador Chrome ya
 * conectado por CDP (puerto 9222) y la sesión de Facebook logueada en el perfil.
 *
 * Uso:
 *   node group_poster.js \
 *     --groups "https://www.facebook.com/groups/AAA;https://www.facebook.com/groups/BBB" \
 *     --message "texto del post" \
 *     --message-file "C:/ruta/texto.txt" \
 *     --images "C:/ruta/1.jpg;C:/ruta/2.jpg" \
 *     --mode publish     (publish | prepare | dry-run)
 *     --label "Electrodomésticos Cuba"
 *     [--max-seconds 600]
 *     [--net-scale 0]   (0 = auto; 1 = forzar red rápida; >1 = forzar red lenta)
 *
 * Precondición: Chrome abierto con --remote-debugging-port=9222 (perfil logueado en FB).
 *
 * Salida: una línea JSON por grupo:
 *   {"group_url":"...","ok":true,"status":"published|prepared|dry-run","message":"...","post_url":"...","error":"..."}
 * En modo "prepare" la pestaña queda abierta con el post ya escrito/adjunto para
 * revisión manual (el proceso termina igual; las pestañas permanecen en Chrome).
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { elegirIndicesLote } = require('./lote_grupos.js');
const { pistaSinCompositor, decidirEnvio } = require('./diagnostico_fb.js');
const { METODOS_TEXTO, normMetodo, metricasDeInfo, verificarTexto, saltosPerdidos } = require('./metodo_texto.js');

const args = process.argv.slice(2);
function val(list, flag) {
  const exact = list.indexOf(flag);
  if (exact >= 0) return list[exact + 1] ?? null;
  const inline = list.find(a => a.startsWith(flag + '='));
  return inline ? inline.slice(flag.length + 1) : null;
}

const GROUPS_RAW = val(args, '--groups') || '';
const MESSAGE = val(args, '--message') || '';
const MESSAGE_FILE = val(args, '--message-file') || '';
const IMAGES_RAW = val(args, '--images') || '';
const MODE = (val(args, '--mode') || 'publish').toLowerCase();
const LABEL = val(args, '--label') || '';
const MAX_SECONDS = parseInt(val(args, '--max-seconds') || '600', 10) || 600;
const DEBUG = !!val(args, '--debug');
// Lote de grupos: cuántos tildar en "Añadir grupos" y desde dónde arrancar.
// El cursor es el NOMBRE del último grupo del lote anterior, no un índice:
// Facebook reordena la lista, y un índice guardaría una posición que ya no
// apunta al mismo grupo.
const LOTE_N = parseInt(val(args, '--lote-n') || '0', 10) || 0;
const LOTE_DESDE = val(args, '--lote-desde') || '';

// Técnica para meter el texto en el compositor. Configurable desde Ajustes
// (publish_config.metodo_texto) para poder comparar en publicaciones REALES,
// porque la fidelidad al publicar no se ve en el compositor:
//   teclado     tipeo char a char (lo de siempre, lento pero probado)
//   insertText  CDP Input.insertText (1 llamada; deja UN solo <p> con \n)
//   ctrlv       portapapeles + Ctrl+V real (pisa el portapapeles del sistema)
//   pasteEvent  evento paste sintético con DataTransfer (sin portapapeles)
// Si la técnica elegida no deja el texto completo, se cae a `teclado` (nunca
// peor que antes) y se registra el fallo.
const METODO_TEXTO = (val(args, '--metodo-texto') || 'teclado').trim();

// Puerto de depuración del Chrome de ESTA cuenta. A usa 9222 (default); B usa
// otro (p.ej. 9223). Se resuelve por argumento y, si no viene, por entorno. Así
// el poster se conecta al Chrome de la cuenta correcta y no siempre al de A.
const DEBUG_PORT = parseInt(val(args, '--debug-port') || process.env.FB_DEBUG_PORT || '9222', 10) || 9222;

const splitList = (raw, sep = ';') => String(raw || '').split(sep).map(s => s.trim()).filter(Boolean);
const groups = splitList(GROUPS_RAW, ';');
const images = splitList(IMAGES_RAW, ';');

const text = (MESSAGE_FILE && fs.existsSync(MESSAGE_FILE))
  ? fs.readFileSync(MESSAGE_FILE, 'utf8')
  : MESSAGE;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

// Carga de adjuntos. Los tiempos están calculados para que el peor caso quepa en
// MAX_SECONDS (600s por grupo) incluso con 10 imágenes: 10 x 2 intentos x 6
// sondeos x 1s = 120s de espera de adjunto, y ensureMediaReady se lleva como
// máximo 33s. A eso se suman la espera al botón Publicar (hasta 20s) y la
// confirmación del envío antes de cerrar la pestaña (hasta 120s). Antes una sola
// imagen agotaba 12s y una sola falla cortaba todo el loop, así que 6 imágenes
// no llegaban nunca. Con red lenta esos números se multiplican por el factor de
// `NET_SCALE_MAX` (3x), y el guard de --max-seconds (600s) sigue por encima del
// peor caso escalado.
// Los tiempos de arriba y los de más abajo son los valores para una conexión
// RÁPIDA. Con internet lento el bot declaraba "no se envió" aunque el post sí
// hubiera salido: el clic se hacía (botón habilitado) y el compositor tardaba
// más de 30s en vaciarse, o el botón seguía deshabilitado >20s procesando las
// imágenes por una subida lenta. En vez de subir los números a ciegas (que con
// red rápida desperdicia tiempo), cada página mide su latencia real y esas
// constantes se multiplican por un factor. Ver `medirRed` y `escalar`.
// El usuario puede fijar el factor a mano con --net-scale (0 = auto).
const NET_SCALE_ARG = Number(val(args, '--net-scale') || '0') || 0;
const ATTACH_ATTEMPTS = 2;   // intentos por imagen, cada uno con input fresco
const ATTACH_POLL_MS = 1000; // intervalo entre sondeos de miniatura
const ATTACH_WAIT_POLLS = 6; // sondeos por intento (6s)
const READY_BASE_MS = 8000;  // presupuesto de "listo" = base + 2.5s x imagen
const READY_PER_IMAGE_MS = 2500;
const READY_MAX_MS = 45000;  // tope absoluto del presupuesto de "listo"
// Cuánto esperar a que el botón Publicar exista y se habilite. Con imágenes,
// Facebook lo mantiene deshabilitado hasta terminar de procesarlas: una sola
// lectura (lo anterior) lo veía deshabilitado y devolvía "No se encontró el
// botón Publicar" aunque el post estuviera por salir.
const PUBLISH_WAIT_MS = 20000;
const PUBLISH_POLL_MS = 700;
// Tras el clic, cuánto esperar a que el envío termine de verdad antes de cerrar
// la pestaña. Con imágenes FB se toma su tiempo subiendo; cerrar antes aborta el
// post. El presupuesto es generoso pero con corte: si nunca se confirma, se
// sigue (no se cuelga la corrida entera).
const ENVIO_CONFIRM_MS = 120000;
const ENVIO_POLL_MS = 1000;
// Presupuesto del "vaciado" del compositor: cuánto se espera a que el editor
// quede vacío tras el clic. Es CORTO a propósito: normalmente se vacía en
// segundos. Si no se vacía, no es un fallo: `esperarEnvioConfirmado` comprueba
// contra el feed. Mantenerlo corto evita que la suma drain + confirmación
// desborde el guard de --max-seconds (que mataría el grupo por "Timeout").
const DRAIN_MS = 30000;

// Objeto MUTABLE con los presupuestos ya escalados. Se actualiza una vez por
// página tras medir la red (ver `escalar`). Usar T.* en el momento de esperar,
// porque los valores cambian entre grupos de una misma corrida.
const T = {
  attachWaitPolls: ATTACH_WAIT_POLLS,
  readyBaseMs: READY_BASE_MS,
  readyMaxMs: READY_MAX_MS,
  publishWaitMs: PUBLISH_WAIT_MS,
  envioConfirmMs: ENVIO_CONFIRM_MS,
  drainMs: DRAIN_MS,
};

// Tope del factor. La red puede medir peor de lo que realmente afecta al flujo
// (una navegación pesada con imágenes), así que se acota para no quedarse 15
// minutos por grupo: por encima de esto se asume "muy lento" y ya. El 3x deja el
// peor caso interno (confirmar envío 120s -> 360s) por debajo del guard de
// --max-seconds (600s) y del timeout del padre (660s), así el guard del poster
// sigue emitiendo su JSON limpio en vez de que el padre lo mate.
const NET_SCALE_MIN = 1;
const NET_SCALE_MAX = 3;

// Mide la latencia real de carga de la página y la convierte en factor de
// escala para los presupuestos de espera. Usa la Navigation Timing API (misma
// sesión, sin requests extra): responseStart es ~"primer byte" y domComplete es
// ~"todo el DOM listo". 1 = rápido; >1 = lento.
async function medirRed(page) {
  return page.evaluate(() => {
    try {
      const n = performance.getEntriesByType('navigation')[0] || {};
      const t = n.responseStart || n.domContentLoadedEventEnd || 0;
      const total = n.domComplete || n.loadEventEnd || t;
      return { ttfb: Math.round(t), total: Math.round(total) };
    } catch (_) { return { ttfb: 0, total: 0 }; }
  }).catch(() => ({ ttfb: 0, total: 0 }));
}

// Aplica el factor a los presupuestos (T) y avisa por consola si es >1.
function escalar(scale) {
  const s = (!scale || !isFinite(scale) || scale <= 0) ? NET_SCALE_MIN
    : Math.min(NET_SCALE_MAX, Math.max(NET_SCALE_MIN, scale));
  T.attachWaitPolls = Math.round(ATTACH_WAIT_POLLS * s);
  T.readyBaseMs = Math.round(READY_BASE_MS * s);
  T.readyMaxMs = Math.round(READY_MAX_MS * s);
  T.publishWaitMs = Math.round(PUBLISH_WAIT_MS * s);
  T.envioConfirmMs = Math.round(ENVIO_CONFIRM_MS * s);
  // El vaciado NO se escala: es una comprobación de UI (¿quedó texto?), no una
  // espera de red. Mantenerlo fijo deja el peor caso drain + confirmación por
  // debajo del guard de --max-seconds aunque la red esté en el tope del factor.
  T.drainMs = DRAIN_MS;
  if (s > 1.15) {
    console.log(`[NET] red lenta (factor x${s.toFixed(2)}): esperas escaladas (publicar=${T.publishWaitMs}ms, adjuntos=${T.readyMaxMs}ms, confirmar=${T.envioConfirmMs}ms)`);
  }
  return s;
}

// Determine el factor para una página: 1) si el usuario lo fijó, ese; 2) si no,
// auto (según la latencia medida) y lo cachea para las próximas páginas de la
// corrida, que comparten la misma conexión.
let escalaCache = NET_SCALE_ARG > 0 ? NET_SCALE_ARG : null;
async function factorRed(page) {
  let f;
  if (escalaCache) {
    f = escalaCache;
  } else {
    const m = await medirRed(page);
    // Referencias de una conexión normal: TTFB < 0.6s y DOM < 3s son "rápidos".
    // La peor de las dos razones manda; un suelo evita el sobreajuste por ruido.
    const sTtfb = m.ttfb > 0 ? Math.max(1, m.ttfb / 600) : 1;
    const sTotal = m.total > 0 ? Math.max(1, m.total / 3000) : 1;
    f = Math.max(NET_SCALE_MIN, sTtfb, sTotal);
    escalaCache = f;
  }
  return escalar(f);
}

// ---------------------------------------------------------------- helpers ---
function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

// Compositor de PUBLICACIÓN del grupo: primer contenteditable visible que NO
// sea una caja de comentarios/reply (los comentarios viven dentro de articles).
// Devuelve las coordenadas del centro para hacer clic real y darle foco.
async function findComposer(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"], div[role="textbox"][contenteditable]'))
      .filter(el => vis(el));

    const isComment = (el) => {
      const label = norm(el.getAttribute('aria-label')) + ' ' + norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder'));
      if (/comentas como|comentario|escrib[eí] un coment|respond[eí]|reply|comenta como/.test(label)) return true;
      if (el.closest('[role="article"]') || el.closest('[role="feeditem"]')) return true;
      return false;
    };

    const postCands = cands.filter(el => !isComment(el));
    const byPh = postCands.filter(el => {
      const label = norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder')) + ' ' + norm(el.getAttribute('aria-label'));
      return /escrib[eí]|public[aá]|comparte|write something|compartir|algo/.test(label);
    });

    // El compositor de post se abre como modal ([role="dialog"]). Preferir el
    // editor que vive DENTRO de un diálogo evita anclarse a la caja inline del
    // muro o a restos de comentarios que sobrevivieron al filtro isComment. El
    // 2026-10-16 el ancla cayó en cajas de comentarios ("Haz un comentario…") y
    // el fallo salía como "No se encontró el botón Publicar".
    const enDialogo = (el) => !!el.closest('[role="dialog"]');
    const pick = byPh.find(enDialogo) || byPh[0]
      || postCands.find(enDialogo) || postCands[0] || null;
    if (!pick) return null;
    pick.dataset.pgpComposer = '1';
    pick.scrollIntoView({ block: 'center' });
    const r = pick.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + Math.min(r.height / 2, 24),
      label: (pick.getAttribute('aria-label') || pick.getAttribute('aria-placeholder') || pick.tagName).slice(0, 50),
    };
  });
}

async function foundComposerHandle(page) {
  return page.$('[data-pgp-composer="1"]').catch(() => null);
}

// FB abre un typeahead de hashtags/menciones al escribir '#' o '@'. Si sigue
// abierto cuando pulsamos Enter, ese Enter selecciona la sugerencia y el salto
// de línea se PIERDE: el texto quedaba pegado ("#DaniMarvis_Storehttps://...").
// Si hay un listbox visible, se cierra con Escape antes de cortar la línea.
async function closeTypeahead(page) {
  const open = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="listbox"]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05) return true;
    }
    return false;
  }).catch(() => false);
  if (open) { await page.keyboard.press('Escape'); await sleep(150); }
}

// Cuenta los saltos de línea reales del compositor (divs de bloque en Lexical).
async function composerLineCount(handle) {
  if (!handle) return Promise.resolve(0);
  return handle.evaluate((el) => {
    const blocks = el.querySelectorAll('div');
    let n = 0;
    for (const d of blocks) {
      const hasOwn = Array.from(d.childNodes).some(c => c.nodeType === 3 || c.nodeName === 'BR');
      if (hasOwn) n++;
    }
    return n;
  }).catch(() => 0);
}

// Escribe el texto en el compositor con teclado nativo (compatible con el
// editor Lexical de FB — execCommand('insertText') genera artefactos como
// "[object HTMLDivElement]"). Se escribe LÍNEA por LÍNEA para poder cerrar el
// typeahead antes de cada Enter. Devuelve 'teclado' si el texto quedó, 'fail' si no.
async function typeText(page, handle, coords) {
  const t = String(text || '');
  if (!t) return 'vacio';
  if (coords) await page.mouse.click(coords.x, coords.y);
  await sleep(350);
  if (handle) await handle.focus().catch(() => {});
  await sleep(300);
  const before = await composerLenOf(handle);
  const lines = t.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay: 12 });
    if (i < lines.length - 1) {
      await closeTypeahead(page);
      await page.keyboard.press('Enter');
      await sleep(90);
    }
  }
  await sleep(500);
  const after = await composerLenOf(handle);
  if (after <= before) return 'fail';
  // diagnóstico: los saltos de línea perdidos son el fallo silencioso más grave
  const breaks = lines.length - 1;
  const gotBreaks = await composerLineCount(handle);
  if (breaks > 0 && gotBreaks > 0 && gotBreaks < breaks) {
    // `event` y NO `ok`: esto es un aviso intermedio, no el resultado del post.
    // groupPublisher.parsePosterOutput() solo toma líneas con status terminal
    // (published/prepared/dry-run/error). Antes esta línea llevaba `ok:true` y el
    // parseo tomaba la primera con `ok`, con lo que un post nunca publicado
    // quedaba marcado 'published' en la cola.
    console.log(JSON.stringify({
      event: 'warn', status: 'warn', mode: MODE,
      message: `saltos de linea: ${gotBreaks}/${breaks} — revisar texto pegado`,
    }));
  }
  return 'teclado';
}

// Limpia el compositor (Seleccionar todo + Suprimir) para reintentar.
async function clearComposer(page, coords) {
  if (coords) await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await sleep(200);
  await page.keyboard.press('Backspace');
  await sleep(400);
  return currentComposerLen(page);
}

function composerLenOf(handle) {
  if (!handle) return Promise.resolve(0);
  return handle.evaluate((el) => (el.innerText || '').trim().length).catch(() => 0);
}

// --------------------------------------------------- técnicas de pegado ---
// Enfoque común: clic físico (foco real) + focus() del handle.
async function enfocarCompositor(page, handle, coords) {
  if (coords) await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  if (handle) await handle.focus().catch(() => {});
  await sleep(250);
}

// A) CDP Input.insertText: una sola llamada, sin eventos de teclado y sin
// portapapeles. Rápido (~1s). En Lexical deja TODO en un único <p> con los \n
// como texto literal (se ve bien en el compositor por white-space: pre-wrap,
// pero hay que comprobar cómo sale el post publicado).
async function insertTextRapido(page, handle, coords) {
  const t = String(text || '');
  if (!t) return 'vacio';
  await enfocarCompositor(page, handle, coords);
  await page.keyboard.sendCharacter(t);
  await sleep(500);
  return 'insertText';
}

// C) Evento `paste` sintético con DataTransfer: mismo resultado que Ctrl+V real
// (Lexical reparte el texto en <p>) pero SIN tocar el portapapeles del sistema,
// así que no hay riesgo de contaminación.
async function pegarEventoSintetico(page, handle, coords) {
  const t = String(text || '');
  if (!t) return 'vacio';
  await enfocarCompositor(page, handle, coords);
  const r = await handle.evaluate((el, s) => {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', s);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return true;
    } catch (e) { return 'err:' + e.message; }
  }, t).catch((e) => 'err:' + e.message);
  await sleep(500);
  return r === true ? 'pasteEvent' : 'fail';
}

// B) Ctrl+V real: escribe el portapapeles del sistema y pega. Tiene una guarda
// anti-contaminación: si entre la escritura y el Ctrl+V el portapapeles cambió
// (el usuario copió otra cosa), NO se pega y se cae a teclado. Aun así, el
// portapapeles queda pisado por la corrida.
async function pegarConClipboard(page, handle, coords) {
  const t = String(text || '');
  if (!t) return 'vacio';
  await enfocarCompositor(page, handle, coords);
  const escrito = await page.evaluate(async (s) => {
    try { await navigator.clipboard.writeText(s); return true; } catch (e) { return 'err:' + e.message; }
  }, t).catch((e) => 'err:' + e.message);
  if (escrito !== true) {
    console.log(JSON.stringify({ event: 'warn', status: 'warn', mode: MODE, message: `portapapeles: no se pudo escribir (${escrito})` }));
    return 'fail';
  }
  // Guarda: releer y comparar (Windows convierte \n -> \r\n, hay que normalizar)
  const leido = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText(); } catch (e) { return 'err:' + e.message; }
  }).catch(() => '');
  const normCL = (s) => String(s || '').replace(/\r\n/g, '\n');
  if (normCL(leido) !== normCL(t)) {
    console.log(JSON.stringify({ event: 'warn', status: 'warn', mode: MODE, message: 'portapapeles contaminado: el contenido no coincide con el texto a pegar. Se evita pegar.' }));
    return 'fail';
  }
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyV');
  await page.keyboard.up('Control');
  await sleep(500);
  return 'ctrlv';
}

async function ejecutarMetodo(page, handle, coords, metodo) {
  switch (metodo) {
    case 'insertText': return insertTextRapido(page, handle, coords);
    case 'ctrlv': return pegarConClipboard(page, handle, coords);
    case 'pasteEvent': return pegarEventoSintetico(page, handle, coords);
    default: return typeText(page, handle, coords);
  }
}

// Métricas de fidelidad del compositor. Lee el DOM y delega la matemática en
// metodo_texto.js (función pura, testeable sin navegador).
async function composerMetrics(handle, sourceText) {
  const info = handle ? await handle.evaluate((el) => {
    let bloques = 0;
    for (const c of el.children) if (/^(P|DIV|LI|H[1-6])$/.test(c.tagName)) bloques++;
    let nlTexto = 0;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nlTexto += (n.nodeValue.match(/\n/g) || []).length;
    return { len: (el.innerText || '').trim().length, bloques, nlTexto };
  }).catch(() => ({ len: 0, bloques: 0, nlTexto: 0 })) : { len: 0, bloques: 0, nlTexto: 0 };
  return metricasDeInfo(info, sourceText);
}

// Aviso de saltos perdidos (incluye el caso silencioso de 0 saltos).
function avisarSaltos(m) {
  const per = saltosPerdidos(m);
  if (per) {
    console.log(JSON.stringify({ event: 'warn', status: 'warn', mode: MODE, message: `saltos de linea: ${per.gotBreaks}/${per.breaks} — revisar texto pegado` }));
  }
}

// Línea de métricas por post (no es terminal: parsePosterOutput la ignora).
function emitirMetricas(p) {
  console.log(JSON.stringify({
    event: 'metodo', status: 'metodo', mode: MODE, group_url: p.groupUrl || '',
    metodo_elegido: METODO_TEXTO, metodo: p.metodo, metodo_fallo: p.metodo_fallo || null,
    ms: p.ms, len: p.len, bloques: p.bloques, lineas: p.lineas, lineas_src: p.lineasSrc,
  }));
}

// Dispatcher: aplica la técnica elegida, verifica fidelidad y, si falla, cae a
// `teclado` (registrando el fallo). Devuelve el resultado + métricas.
async function ponerTexto(page, handle, coords, metodoElegido, groupUrl = '') {
  const elegido = normMetodo(metodoElegido);
  const t0 = Date.now();
  let usado = elegido;
  await ejecutarMetodo(page, handle, coords, elegido);
  let metrics = await composerMetrics(handle, text);
  let ok = verificarTexto(metrics);

  let metodoFallo = null;
  if (!ok && elegido !== 'teclado') {
    metodoFallo = elegido;
    await clearComposer(page, coords);
    usado = 'teclado';
    await ejecutarMetodo(page, handle, coords, 'teclado');
    metrics = await composerMetrics(handle, text);
    ok = verificarTexto(metrics);
    console.log(JSON.stringify({ event: 'metodo-fallo', status: 'warn', mode: MODE, group_url: groupUrl, metodo_fallo: metodoFallo }));
  }

  if (ok) avisarSaltos(metrics);
  return { ok, metodo: usado, metodo_fallo: metodoFallo, ms: Date.now() - t0, ...metrics, groupUrl };
}


// Miniaturas realmente adjuntas al compositor. FB envuelve los adjuntos en un
// contenedor role="group" aria-label="Contenido multimedia adjunto" (o el
// equivalente en inglés). Es el único selector estable: contar <img> por rect del
// panel arrastraba las fotos del feed de abajo (panel de 500x1500px) y daba falsos
// positivos. Un blob: cuenta como adjunto (FB ya aceptó la foto: el POST a
// upload.facebook.com responde 200 aunque la miniatura siga siendo local).
async function attachedThumbs(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    let holder = null;
    for (const el of document.querySelectorAll('[role="group"]')) {
      const l = (el.getAttribute('aria-label') || '').toLowerCase();
      if (/contenido multimedia adjunto|attached media|adjunto de la publicaci/.test(l)) { holder = el; break; }
    }
    const n = [];
    if (holder) {
      for (const img of holder.querySelectorAll('img')) {
        if (!vis(img)) continue;
        const r = img.getBoundingClientRect();
        if (r.width < 40) continue; // ignora iconos
        const src = img.currentSrc || img.src || '';
        if (/rsrc\.php|static\.xx\.fbcdn\.net/.test(src)) continue; // recursos de UI
        n.push({ w: Math.round(r.width), k: src.startsWith('blob:') ? 'blob' : 'cd' });
      }
    }
    const hasRemove = Array.from(document.querySelectorAll('[aria-label]'))
      .some(e => /suprimir adjunto|quitar foto|remove attachment/i.test(e.getAttribute('aria-label') || ''));
    return { thumbs: n, hasRemove };
  }).catch(() => ({ thumbs: [], hasRemove: false }));
}

// Localiza el input[type=file] del compositor y lo devuelve como ElementHandle
// REAL. Importante: un nodo DOM NO puede volver desde page.evaluate() (se
// serializa como {}), y sobre ese objeto input.evaluate() es undefined → el
// upload se lanzaba y el catch lo silenciaba, sin adjuntar nunca la imagen.
// Por eso el input se pide con page.evaluateHandle().
async function composerFileInput(page) {
  const handle = await page.evaluateHandle(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    // 1) El atributo histórico del compositor. Facebook lo sacó del DOM, pero
    //    se prueba primero por si vuelve.
    // 2) Fallback: cualquier contenteditable/role=textbox VISIBLE. El filtro de
    //    visibilidad importa: hay 2 candidatos en la página pero solo 1 es el
    //    compositor del grupo (el otro es oculto).
    let editable = document.querySelector('[data-pgp-composer="1"]');
    if (!editable || !vis(editable)) {
      editable = null;
      for (const el of document.querySelectorAll('[contenteditable="true"],[role="textbox"]')) {
        if (vis(el)) { editable = el; break; }
      }
    }
    if (editable) {
      let node = editable;
      while (node && node !== document.body) {
        node = node.parentElement;
        // los inputs file del compositor suelen estar ocultos (display:none), así
        // que NO se filtra por visibilidad — se garantiza por el ancestro (panel).
        const inputs = Array.from(node.querySelectorAll('input[type="file"]'));
        if (!inputs.length) continue;
        const r = node.getBoundingClientRect();
        // Solo se limita el ANCHO: el panel puede ser alto (500x1500 con texto +
        // adjuntos) y descartarlo dejaba al poster sin input, luego sin imágenes.
        if (r.width > 1300) continue;
        const img = inputs.find(i => {
          const a = (i.getAttribute('accept') || '').toLowerCase();
          return !a || a.includes('image');
        });
        return img || inputs[0];
      }
    }
    // 3) Último recurso: cualquier input de imagen de la página. Hay 3 con
    //    accept="image/*,image/heif,image/heic" y uno global en el BODY.
    const anyImg = Array.from(document.querySelectorAll('input[type="file"]'))
      .find(i => /image/i.test((i.getAttribute('accept') || '').toLowerCase()));
    return anyImg || null;
  });
  const el = handle.asElement();
  if (!el) { await handle.dispose().catch(() => {}); return null; }
  return el;
}

// Rect del panel multimedia DEL COMPOSITOR: sube por ancestros desde nuestro
// editor (marcado con data-pgp-composer) hasta el panel que contiene un input
// file. Solo se usa para confirmar que el panel existe; NUNCA toca inputs ajenos.
async function composerMediaContext(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    let editable = null;
    for (const el of document.querySelectorAll('[data-pgp-composer="1"]')) { if (vis(el)) { editable = el; break; } }
    if (!editable) return { rect: null };
    let node = editable;
    while (node && node !== document.body) {
      node = node.parentElement;
      const inputs = Array.from(node.querySelectorAll('input[type="file"]'));
      if (!inputs.length) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 1300) continue;
      return { rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    return { rect: null };
  }).catch(() => ({ rect: null }));
}

// Cuenta los <img> visibles DENTRO del rect del panel del compositor (si se
// pasa rect). Los thumbnails adjuntados nacen en ese panel; así un upload que
// se colara en la portada NO se cuenta aquí (nunca da "adjuntado").
function countImageElements(page, rect) {
  return page.evaluate((rect) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return rect ? (cx >= rect.left && cx <= rect.left + rect.width && cy >= rect.top && cy <= rect.top + rect.height) : true;
    };
    let n = 0;
    for (const el of document.querySelectorAll('img')) {
      if (vis(el) && el.getAttribute('src') && inside(el)) n++;
    }
    return n;
  }, rect).catch(() => 0);
}

function countMarkers(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    let n = 0;
    for (const el of document.querySelectorAll('div, span, img')) {
      if (!vis(el)) continue;
      const label = el.getAttribute && (el.getAttribute('aria-label') || '');
      if (label && /suprimir foto|remove photo|eliminar foto|quitar foto/i.test(label)) { n++; continue; }
      const cs = getComputedStyle(el);
      if (/^url\("?blob:/i.test(cs.backgroundImage) || /^url\("?data:image/i.test(cs.backgroundImage)) n++;
    }
    return n;
  }).catch(() => 0);
}

/**
 * Cuántos adjuntos hay realmente en el compositor.
 *
 * Antes esto se contaba con attachedThumbs() nomás, que depende de un único
 * selector de aria-label para encontrar el panel de adjuntos. Ese selector es
 * frágil: si FB cambia la etiqueta, el panel no se encuentra, thumbs queda
 * vacío y el conteo da 0 aunque las imágenes estén subidas y visibles. Con 0
 * el gate de publicación abortaba, y el mensaje decía "no se adjuntó ninguna"
 * sin que fuera cierto.
 *
 * Ahora se combinan dos señales y se queda con la MAYOR: el panel oficial de
 * adjuntos y los fondos blob:/data: de las miniaturas. Que una se rompa ya no
 * puede hundir el conteo a cero, que es lo que hacía fallar la publicación
 * entera.
 *
 * Se descartó una tercera señal (todos los <img> visibles dentro del rect del
 * compositor) porque sobrecuenta: el rect incluye el feed del grupo, así que
 * una corrida real con 6 imágenes dio 9. Con "máximo de tres", ese 9 hubiera
 * hecho creer que las 6 estaban puestas cuando quizá no lo estaban, y el
 * faltante —la única garantía de que no se pierde nada en silencio— se iba.
 * attachedThumbs filtra lo que sí es miniatura (descarta UI, <40px y recursos
 * de fbcdn), por eso es la señal principal.
 */
/**
 * El ancla del compositor: el ancestro más cercano que contiene a la vez el
 * campo de texto editable y un input[type=file]. Es el mismo recorrido que usa
 * composerFileInput, y sirve para dos cosas: encontrar el input, y acotar el
 * conteo de adjuntos SOLO a lo que está dentro del panel del compositor.
 *
 * Ese acotado es lo que evita el error de la versión anterior: contar todos los
 * <img> de la página includes el feed, y una corrida real dio 9 con 6 pedidas.
 */
async function composerAnchor(page) {
  const h = await page.evaluateHandle(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    let editable = document.querySelector('[data-pgp-composer="1"]');
    if (!editable || !vis(editable)) {
      // Mismo criterio que findComposer: nada de cajas de comentarios (viven
      // dentro de articles/feeditems) y, si hay un diálogo abierto, el editor de
      // adentro. Antes caía al primer contenteditable visible y terminaba anclado
      // a la caja de comentarios del feed: el fallo "No se encontró el botón
      // Publicar" mostraba botones de "Haz un comentario…" (2026-10-16 10:29).
      const cands = Array.from(document.querySelectorAll('[contenteditable="true"],[role="textbox"]'))
        .filter(vis)
        .filter(el => !el.closest('[role="article"]') && !el.closest('[role="feeditem"]'));
      editable = cands.find(el => el.closest('[role="dialog"]')) || cands[0] || null;
    }
    if (!editable) return null;
    let node = editable;
    while (node && node !== document.body) {
      node = node.parentElement;
      const ins = Array.from(node.querySelectorAll('input[type="file"]'));
      if (!ins.length) continue;
      if (node.getBoundingClientRect().width > 1300) continue;
      return node;
    }
    return null;
  });
  return h.asElement();
}

/**
 * Cuántos adjuntos hay realmente en el compositor.
 *
 * Antes esto dependía de un único selector: un [role="group"] cuyo aria-label
 * dijera "contenido multimedia adjunto". Facebook sacó ese atributo, así que el
 * conteo daba 0 siempre y el gate abortaba la publicación. La señal de fondo
 * (blob:/data: en background-image) se mantiene como refuerzo, y se cuenta
 * además lo que el propio input de archivos aceptó, porque un upload que FB
 * todavía no pintó sigue siendo un archivo real que ya le pasamos.
 */
async function mediaAttachedCount(page, rect) {
  const [thumbs, st, anchor, inputCount] = await Promise.all([
    attachedThumbs(page).catch(() => ({ thumbs: [] })),
    composerMediaState(page, rect).catch(() => ({ bgThumbs: [] })),
    composerAnchor(page),
    page.evaluate(() => {
      let best = 0;
      for (const i of document.querySelectorAll('input[type="file"]')) {
        const n = i.files ? i.files.length : 0;
        if (n > best) best = n;
      }
      return best;
    }).catch(() => 0),
  ]);

  // Miniaturas dentro del ancla del compositor: el conteo principal.
  let inPanel = 0;
  if (anchor) {
    inPanel = await anchor.evaluate((root) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
      };
      let n = 0;
      for (const el of root.querySelectorAll('img')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 30) continue;              // iconos
        const s = el.currentSrc || el.src || '';
        if (/rsrc\.php|static\.xx\.fbcdn\.net/.test(s)) continue;  // recursos de UI
        n++;
      }
      return n;
    }).catch(() => 0);
  }

  const n = Math.max(
    inPanel,
    (thumbs && thumbs.thumbs ? thumbs.thumbs.length : 0),
    st && st.bgThumbs ? st.bgThumbs.length : 0,
    Number(inputCount) || 0,
  );
  const out = {
    n,
    panel: inPanel,
    thumbs: (thumbs && thumbs.thumbs ? thumbs.thumbs.length : 0),
    bg: (st && st.bgThumbs ? st.bgThumbs.length : 0),
    inputFiles: Number(inputCount) || 0,
    hasRemove: !!(thumbs && thumbs.hasRemove),
  };
  if (anchor) await anchor.dispose?.().catch?.(() => {});
  return out;
}

async function attachImages(page) {
  if (!images.length) return { images: 0, preview: false, attached: 0, enviadas: 0, failed: [], hasRemove: false };

  let panel = null;
  const failed = [];
  const enviadas = [];
  // FB/React con `multiple` procesa solo el primer archivo del evento change, así
  // que se sube de a UNA imagen por upload.
  //
  // REGLA CRÍTICA: un archivo se envía UNA SOLA VEZ. Reenviarlo duplica la foto en
  // el post, y ya pasó: el conteo de adjuntos quedó roto contra el DOM actual de
  // Facebook, así que la condición "el panel ganó un adjunto" nunca se cumplía, el
  // ciclo de reintentos se agotaba siempre y cada imagen salía dos veces.
  //
  // La Única razón para reintentar es que `uploadFile` lance: si lanza, el input
  // quedó vacío y no hay nada adjunto. Si NO lanza, el archivo entró al input y
  // no se vuelve a mandar, porque no hay forma honesta de saber si FB lo tomó.
  // Si FB lo descarta, la imagen falta en el post: preferimos eso a duplicarla.
  for (const file of images) {
    const ctx = await composerMediaContext(page);
    if (ctx.rect) panel = ctx.rect;

    let enviada = false;
    let ultimoError = null;
    for (let attempt = 1; attempt <= ATTACH_ATTEMPTS; attempt++) {
      const input = await composerFileInput(page);
      if (!input) {
        ultimoError = 'no se encontró el input de imágenes del compositor';
        await sleep(1000 * attempt);
        continue;
      }
      try {
        await input.evaluate(el => { if (el.hasAttribute('multiple')) el.removeAttribute('multiple'); });
        await input.uploadFile(file);
        enviada = true;
        break;
      } catch (e) {
        ultimoError = (e.message || '').slice(0, 120);
        console.error('[MEDIA] upload launchó error:', ultimoError);
        await sleep(1000 * attempt);
      }
    }
    if (enviada) {
      enviadas.push(file);
    } else {
      failed.push(file);
      console.error(`[MEDIA] ${path.basename(file)} no se pudo enviar: ${ultimoError}; se sigue con la siguiente.`);
    }

    // Espera de cadencia para que FB termine de procesar antes del siguiente
    // archivo. NO decide reintentos: solo evita que se le pisen encima.
    for (let i = 0; i < T.attachWaitPolls; i++) {
      await sleep(ATTACH_POLL_MS);
      const st = await mediaAttachedCount(page, panel);
      if (st.hasRemove || st.n > 0) break;
    }
  }
  // Recuento final. Se usa el conteo robusto (panel oficial + <img> del panel +
  // fondos blob), no solo el selector del panel. Un blob: ya está SUBIDO: el POST
  // a upload.facebook.com/ajax/.../photo/upload devuelve 200 aunque la miniatura
  // se siga sirviendo localmente, así que blob y CDN cuentan igual.
  const st = await mediaAttachedCount(page, panel);
  return {
    images: images.length,
    preview: st.n > 0,
    attached: st.n,
    enviadas: enviadas.length,
    failed,
    hasRemove: st.hasRemove,
    detect: st,
  };
}

/**
 * Largo del texto que queda en el compositor del POST, para decidir si se envió.
 *
 * Antes tomaba `cands[0]`: el PRIMER `[contenteditable]` visible con texto de toda
 * la página. Ese no es necesariamente el compositor; puede ser un campo de
 * comentario, una búsqueda o el editor de otro post. Como ese campo nunca se
 * vacía, el chequeo-after-publicar daba falso negativo siempre y terminaba en
 * "Se hizo clic en Publicar pero el post no se envió" con el post ya publicado.
 *
 * Ahora se elige el editable visible con texto de MAYOR área: el compositor del
 * post es un panel grande, los campos de comentario son chicos. Es el mismo
 * criterio que ya usan el input de imágenes y el botón Publicar.
 *
 * Devuelve 0 si no queda ningún editable con texto, que es el caso bueno: se
 * envió todo.
 */
async function currentComposerLen(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const conTexto = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(el => vis(el) && (el.innerText || '').trim().length > 0)
      // Excluir cajas de comentarios: si el compositor se cerró al publicar pero
      // quedó un comentario con texto en el feed, contarlo daba "el texto sigue
      // en el compositor" y el post se marcaba como no enviado (2026-10-16).
      .filter(el => !el.closest('[role="article"]') && !el.closest('[role="feeditem"]'));
    if (!conTexto.length) return 0;
    let mejor = conTexto[0];
    let area = -1;
    for (const el of conTexto) {
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > area) { area = a; mejor = el; }
    }
    return (mejor.innerText || '').trim().length;
  });
}

// Mueve el puntero por encima del compositor para que FB revele los botones
// "Suprimir foto" de los adjuntos (solo aparecen con hover).
async function revealMarkers(page, composer) {
  const x = composer?.x ?? screenX;
  const startY = Math.max(40, ((composer?.y ?? 0) - 12));
  await page.mouse.move(x, startY);
  for (let dy = 0; dy < 3; dy++) { await page.mouse.move(x, startY - dy * 22); await sleep(120); }
  await sleep(350);
  return countMarkers(page);
}

// Estado real de los adjuntos del compositor: miniaturas (blob = preview local
// aun sin subir, cd = URL real de FB), miniaturas por background-image y spinners.
async function composerMediaState(page, rect) {
  return page.evaluate((rect) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return rect ? (cx >= rect.left && cx <= rect.left + rect.width && cy >= rect.top && cy <= rect.top + rect.height) : true;
    };
    const imgs = [];
    const bgThumbs = [];
    for (const el of document.querySelectorAll('img')) {
      if (!vis(el)) continue;
      const src = el.currentSrc || el.src || '';
      if (!src) continue;
      const r = el.getBoundingClientRect();
      if (rect && !inside(el)) continue;
      imgs.push({ w: Math.round(r.width), h: Math.round(r.height), k: src.startsWith('blob:') ? 'blob' : (/scontent|fbcdn/.test(src) ? 'cd' : 'x'), s: src.slice(0, 40) });
    }
    for (const el of document.querySelectorAll('div, span')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 40) continue;
      if (rect && !inside(el)) continue;
      const bs = getComputedStyle(el).backgroundImage || '';
      if (/^url\(["']?blob:/i.test(bs) || /^url\(["']?data:image/i.test(bs)) bgThumbs.push({ w: Math.round(r.width), k: bs.slice(6, 14) });
    }
    const spinners = [];
    for (const el of document.querySelectorAll('[role="progressbar"], [data-visualcompletion="loading-dynamic"], [aria-label*="Cargando" i], [aria-label*="Subiendo" i], [aria-label*="processing" i], [aria-label*="Procesando" i]')) {
      if (vis(el)) spinners.push((el.getAttribute('aria-label') || el.className || 'prog').toString().slice(0, 30));
    }
    return { imgs, bgThumbs, spinners };
  }, rect).catch(() => ({ imgs: [], bgThumbs: [], spinners: [] }));
}

const MEDIA_DEBUG = process.env.MEDIA_DEBUG || '';
async function debugMediaDump(page, tag, rect) {
  let st = null;
  try { st = await composerMediaState(page, rect); } catch (e) { st = { err: e.message }; }
  if (st && !st.err) {
    const compact = {
      tag,
      markers: await countMarkers(page).catch(() => -1),
      imgs: st.imgs.map(i => `${i.w}px:${i.k}`),
      bgBlob: st.bgThumbs.length,
      spinners: st.spinners,
      detect: await mediaAttachedCount(page, rect).catch(() => null),
    };
    console.error('[MEDIA] ' + JSON.stringify(compact));
  } else {
    console.error('[MEDIA] ' + tag + ' no disponible: ' + (st?.err || 'sin objeto'));
  }
  if (MEDIA_DEBUG) {
    try { await fs.promises.appendFile(MEDIA_DEBUG, `\n=== ${tag} ===\n` + JSON.stringify(st, null, 1)); } catch (_) {}
  }
}

// Espera hasta que la subida de las fotos HAYA TERMINADO:
// A) aparecen >= `expected` marcadores "Suprimir foto" (adjunto reconocido) y
// B) no quedan spinners de carga ni previsualización blob (la miniatura ya se
//    sirve desde la URL real de FB), estable 2 muestras seguidas.
// Devuelve el nº de adjuntos confirmados, o -1 si nunca llegó a estar listo.
async function ensureMediaReady(page, composer, expected, rect) {
  if (!expected) return 0;
  // La señal de "listo" es que el compositor tenga >= expected adjuntos. NO se
  // exige que la miniatura pase de blob: a scontent: FB acepta la foto (POST
  // upload.facebook.com = 200) pero sigue sirviendo la miniatura local, así que
  // exigir CDN abortaba publicaciones que sí iban con imagen.
  //
  // El presupuesto es proporcional a la cantidad de imágenes: 15 sondeos fijos
  // (10.5s) eran 10.5s para 1 imagen y los mismos 10.5s para 10, que no alcanzan
  // cuando hay varias subiendo en serie. Antes 10.5s era el techo y por eso un
  // post de 6 imágenes con 1MB nunca llegaba a contarse completo.
  const budgetMs = Math.min(T.readyMaxMs, T.readyBaseMs + expected * READY_PER_IMAGE_MS);
  const deadline = Date.now() + budgetMs;
  let last = { n: 0 };
  while (Date.now() < deadline) {
    last = await mediaAttachedCount(page, rect);
    if (last.n >= expected) return last.n;
    await sleep(700);
  }
  // Se devuelve el conteo real, no -1: el que llama necesita saber cuántas
  // quedaron para avisar con el número exacto y no con un mensaje genérico.
  return last.n;
}

// Click en "Publicar" + manejo del tooltip "Publicando como..."
/**
 * Busca el botón "Publicar" del compositor. Devuelve el botón con su rect o
 * null. La propiedad `enabled` distingue "existe pero está deshabilitado"
 * (Facebook todavía procesa las imágenes) de "no está": antes esa diferencia se
 * perdía en un `isPub` que exigía `aria-disabled !== 'true'`, y las dos cosas
 * terminaban en el mismo "No se encontró el botón Publicar".
 */
async function findPublishButton(page) {
  return page.evaluate(() => {
    // OJO: \s NO cubre el espacio de ancho cero (\u200b) ni otros invisibles que
    // Facebook mete en el texto de sus botones. Sin sacarlos, `innerText ===
    // 'publicar'` falla por un carácter que no se ve y el botón "no aparece"
    // aunque esté en pantalla. Es un fallo real: se pierde el clic y el post.
    const norm = (s) => (s || '')
      .replace(/[\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    // A propósito NO filtra por aria-disabled: se quiere encontrar también el
    // botón deshabilitado para poder informarlo y esperar a que se habilite.
    const isPub = (el) => {
      if (!vis(el)) return false;
      const t = norm(el.innerText), a = norm(el.getAttribute('aria-label'));
      return t === 'publicar' || a === 'publicar';
    };
    const info = (el, extra) => {
      const r = el.getBoundingClientRect();
      return Object.assign({
        label: 'publicar',
        aria: (el.getAttribute('aria-label') || '').slice(0, 40),
        dis: el.getAttribute('aria-disabled') || 'null',
        enabled: el.getAttribute('aria-disabled') !== 'true',
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        area: r.width * r.height,
      }, extra || {});
    };
    // 1) el editor al que escribimos (contenteditable visible con texto)
    let editable = null;
    for (const el of document.querySelectorAll('[contenteditable="true"]')) {
      if (!vis(el)) continue;
      const t = (el.innerText || '').trim();
      if (t.length >= 2) { editable = el; break; }
    }
    // 2) subir por ancestros hasta un panel que contenga un botón exacto
    // "publicar". Se prefiere el HABILITADO: si el del panel está deshabilitado
    // (Facebook procesando), se sigue subiendo por si hay uno habilitado y, si
    // no aparece ninguno, se guarda el deshabilitado para informarlo y esperar.
    let deshabilitado = null;
    if (editable) {
      let node = editable;
      while (node && node !== document.body) {
        node = node.parentElement;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.width > 2600 || r.height > 2600) continue;
        const pub = Array.from(node.querySelectorAll('div[role="button"], span[role="button"], button')).find(isPub);
        if (pub) {
          const found = info(pub, { scoped: true });
          if (found.enabled) return found;
          if (!deshabilitado) deshabilitado = found;
        }
      }
    }
    // 3) fallback global: exactos "publicar", el más pequeño. El habilitado gana
    // al deshabilitado aunque sea más grande.
    let habilitado = null;
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!isPub(el)) continue;
      const found = info(el, { scoped: false });
      if (found.enabled) {
        if (!habilitado || found.area < habilitado.area) habilitado = found;
      } else if (!deshabilitado || found.area < deshabilitado.area) {
        deshabilitado = found;
      }
    }
    return habilitado || deshabilitado || null;
  });
}

async function clickPublish(page, dryRun) {
  if (dryRun) return { clicked: false, tooltip: false, dry: true };
  // Sondea hasta T.publishWaitMs (escalado por red): el botón puede no estar
  // montado todavía o estar deshabilitado mientras Facebook termina de
  // subir/procesar las imágenes. Se corta apenas aparece habilitado; si solo se
  // ve deshabilitado se recuerda para el diagnóstico del fallo.
  let btn = null;
  let deshabilitado = null;
  const deadline = Date.now() + T.publishWaitMs;
  for (;;) {
    const found = await findPublishButton(page).catch(() => null);
    if (found && found.enabled) { btn = found; break; }
    if (found && !found.enabled) deshabilitado = found;
    if (Date.now() >= deadline) break;
    await sleep(PUBLISH_POLL_MS);
  }
  if (!btn) return { clicked: false, tooltip: false, disabled: !!deshabilitado, info: deshabilitado };
  console.error('[SUBMIT] ' + JSON.stringify(btn));
  // clic físico (eventos de puntero reales de Chromium), como haría una persona;
  // el clic sintético el.click() puede confirmar el post sin el adjunto.
  if (btn.w >= 6 && btn.h >= 6) {
    try {
      await page.mouse.move(btn.x, btn.y);
      await sleep(rand(150, 380));
      await page.mouse.click(btn.x, btn.y, { button: 'left', delay: rand(60, 190) });
    } catch (_) {
      await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, btn.x, btn.y);
    }
  }
  await sleep(rand(1400, 2200));

  const tooltip = await page.evaluate(() => {
    const norm = (s) => (s || '').trim().toLowerCase();
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const el of document.querySelectorAll('div[role="dialog"], div[role="tooltip"], [role="menu"]')) {
      if (!vis(el)) continue;
      const t = norm(el.innerText);
      if (!t || !t.includes('publicando')) continue;
      const pub = Array.from(el.querySelectorAll('div[role="button"], button'))
        .find(b => {
          const tx = norm(b.innerText) || norm(b.getAttribute('aria-label'));
          return tx && (tx.includes('publicar') || tx.includes('continuar'));
        });
      if (pub) { const r = pub.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }
    }
    return null;
  });
  let tooltipClicked = false;
  if (tooltip && tooltip.w >= 6 && tooltip.h >= 6) {
    try {
      await page.mouse.move(tooltip.x, tooltip.y);
      await sleep(rand(150, 320));
      await page.mouse.click(tooltip.x, tooltip.y, { button: 'left', delay: rand(60, 180) });
      tooltipClicked = true;
    } catch (_) {
      await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, tooltip.x, tooltip.y);
      tooltipClicked = true;
    }
  }
  await sleep(rand(2500, 4000));
  return { clicked: true, tooltip: tooltipClicked, label: btn.label, aria: btn.aria };
}

// Tilda `n` grupos del diálogo "Añadir grupos", arrancando después de `desde`
// y dando la vuelta al llegar al final. Devuelve los nombres efectivamente
// tildados para que el backend registre a dónde fue.
async function probeEtapa(page, tag) {
  try {
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(vis).map(el => ({ len: (el.innerText || '').trim().length, txt: (el.innerText || '').slice(0, 24).replace(/\n/g, ' ') }));
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(d => ({ t: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 55) }));
      const pubs = Array.from(document.querySelectorAll('div[role="button"],span[role="button"],button')).filter(e => vis(e) && (norm(e.getAttribute('aria-label')) === 'publicar' || norm(e.innerText) === 'publicar')).map(e => ({ dis: e.getAttribute('aria-disabled'), t: (e.innerText || '').trim().slice(0, 8) }));
      return { editors, dialogs, pubs };
    });
    console.log('[PROBE] ' + tag + ' ' + JSON.stringify(info));
  } catch (e) { console.log('[PROBE] ' + tag + ' error: ' + e.message); }
}

async function seleccionarLoteGrupos(page, { n, desde } = {}) {
  const cuantos = Math.max(1, Math.min(30, Number(n) || 9));
  if (cuantos <= 1) return { seleccionados: [], total: 0, sinBoton: false };

  // 1) el botón "Añadir grupos". Solo existe con al menos una imagen adjunta,
  //    y no trae aria-label: el texto es la única ancla estable. Las clases de
  //    sus ancestros son hashes de Facebook y cambian con cada rediseño.
  const buscarBoton = () => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const el = Array.from(document.querySelectorAll('div[role="button"]'))
      .filter(vis)
      .find(x => (x.textContent || '').trim() === 'Añadir grupos');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  // "Añadir grupos" puede tardar en montarse: Facebook lo muestra recién cuando
  // termina de procesar los adjuntos, y el texto del botón cambia con el rediseño.
  // Antes se buscaba UNA sola vez y si no estaba en ese instante el lote se daba
  // por perdido en silencio. El 2026-10-16, 9 de los 36 posts publicados no se
  // repartieron a los 9 grupos y quedaron registrados igual que un éxito. Se
  // sondea hasta ~15s antes de rendirse.
  let btn = null;
  for (let i = 0; i < 12 && !btn; i++) {
    btn = await buscarBoton();
    if (!btn) await sleep(1250);
  }
  if (!btn) return { seleccionados: [], total: 0, sinBoton: true };

  try {
    await page.mouse.move(btn.x, btn.y);
    await sleep(rand(120, 300));
    await page.mouse.click(btn.x, btn.y, { button: 'left', delay: rand(60, 160) });
  } catch (_) {
    await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, btn.x, btn.y);
  }
  await sleep(rand(2000, 3000));

  if (DEBUG) await probeEtapa(page, 'picker-abierto');

  // 2) esperar a que la lista de grupos APAREZCA. Facebook puebla el diálogo de
  //    forma asíncrona; con ~136 grupos puede tardar varios segundos bajo carga.
  //    Antes se entraba directo al bucle de scroll, que corta en la primera
  //    lectura vacía: si a los ~4s la lista todavía no había renderizado ningún
  //    checkbox, el lote se daba por perdido EN SILENCIO y el post salía SOLO al
  //    grupo destino. El 2026-10-19 eso pasó en 4 de los 12 posts del día,
  //    intercalados con éxitos, según lo lento que estuviera FB en ese momento.
  //    Se sondea como el botón: hasta ~15s antes de rendirse.
  const contarChecks = () => page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis).length;
  });
  let checksVisibles = 0;
  for (let i = 0; i < 12 && !checksVisibles; i++) {
    checksVisibles = await contarChecks();
    if (!checksVisibles) await sleep(1250);
  }
  if (!checksVisibles) return { seleccionados: [], total: 0, sinBoton: false };

  // 3) cargar la lista ENTERA. El picker es LAZY: arranca con ~20 checkables y
  //    suma más al scrollear el contenedor interno (no la ventana). Hasta el
  //    2026-10-19 esto andaba; desde ~16:13 de ese día el picker dejó de pasar
  //    de los primeros 20. La detección del contenedor (subir desde el primer
  //    checkbox exigiendo overflowY auto/scroll) dejó de encontrarlo, así que el
  //    lote se armaba SOLO con esos 20 y se repartía siempre a los mismos grupos.
  //    Ahora se scrollean TODOS los ancestros scrolleables del primer checkbox
  //    (sin exigir overflowY: Facebook puede usar overflow:clip y aún así
  //    scrollear por código) y, si no hay ninguno, el div scrolleable más grande
  //    dentro del diálogo. Se corta cuando varios scrolls seguidos no suman.
  const scrollLista = () => page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const chk = Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis);
    if (!chk.length) return { checks: 0, movidos: 0 };
    const cands = [];
    for (let n = chk[0]; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 4) cands.push(n);
    }
    if (!cands.length) {
      const root = chk[0].closest('[role="dialog"]') || document;
      let best = null;
      for (const el of root.querySelectorAll('div')) {
        if (!el.contains(chk[0]) || el.scrollHeight <= el.clientHeight + 4) continue;
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
      if (best) cands.push(best);
    }
    let movidos = 0;
    for (const c of cands) {
      if (c.scrollTop < c.scrollHeight - c.clientHeight - 2) {
        c.scrollTop = c.scrollHeight;
        c.dispatchEvent(new Event('scroll', { bubbles: true }));
        movidos++;
      }
    }
    return { checks: chk.length, movidos };
  });
  let cargados = checksVisibles, scrollsSinNovedad = 0;
  for (let i = 0; i < 60 && scrollsSinNovedad < 4; i++) {
    await scrollLista();
    await sleep(rand(1100, 1900));
    const n1 = await contarChecks();
    if (!n1) break;
    if (n1 > cargados) { cargados = n1; scrollsSinNovedad = 0; } else scrollsSinNovedad++;
  }

  // 4) nombres en orden de Facebook, que es el orden del DOM
  const items = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const chk = Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis);
    return chk.map(c => {
      // el checkbox no trae nombre en ningún atributo: hay que subir hasta el
      // contenedor que lo envuelve. Se corta el sufijo de "Última visita: ..."
      // que Facebook le pega a cada fila.
      let n = c, mejor = '';
      for (let i = 0; i < 7 && n; i++) {
        const t = (n.innerText || '').replace(/Última visita:.*/s, '').trim().replace(/\s+/g, ' ');
        if (t.length > mejor.length && t.length < 120) mejor = t;
        n = n.parentElement;
      }
      return mejor;
    });
  });
  const total = items.length;
  if (!total) return { seleccionados: [], total: 0, sinBoton: false };

  // 5) desde dónde arrancar. Con 121 grupos y lotes de 9, el último lote siempre
  //    termina en el final de la lista: se toman los que falten y se vuelve del
  //    principio, como pidió el usuario.
  const pedidos = elegirIndicesLote(items, cuantos, desde);

  // 6) tildar. Se hace con click de DOM y se verifica el.checked: si React no
  //    reacciona al click sintético, se cae a un click real por elemento.
  const hechos = await page.evaluate((idxs) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const chk = Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis);
    const out = [];
    for (const i of idxs) {
      const c = chk[i];
      if (!c) continue;
      if (!c.checked) c.click();
      out.push({ i, ok: c.checked });
    }
    return { out, marcados: chk.filter(c => c.checked).length };
  }, pedidos);

  const fallidos = hechos.out.filter(x => !x.ok).map(x => x.i);
  if (fallidos.length) {
    for (const i of fallidos) {
      try {
        const r = await page.evaluate((idx) => {
          const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const chk = Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis);
          const c = chk[idx]; if (!c) return null;
          c.scrollIntoView({ block: 'center' });
          const b = c.getBoundingClientRect();
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
        }, i);
        if (r) await page.mouse.click(r.x, r.y, { button: 'left', delay: rand(40, 110) });
      } catch (_) { /* si ni con click real se puede, se deja como está */ }
    }
    await sleep(rand(600, 1200));
  }

  const verificado = await page.evaluate((idxs) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const chk = Array.from(document.querySelectorAll('[role="dialog"] input[type=checkbox]')).filter(vis);
    return idxs.map(i => (chk[i] && chk[i].checked) ? i : -1).filter(i => i >= 0);
  }, pedidos);

  // 7) cerrar el diálogo con "Atrás", que es como lo cierra una persona. El
  //    picker es un modal ENCIMA del compositor: mientras está abierto, el
  //    editor de la página queda vacío en el DOM y su botón Publicar sale
  //    deshabilitado (habia botones con aria-disabled=true en todas las
  //    corridas). Cerrarlo devuelve el post al compositor con los grupos
  //    ya aplicados. "Atrás" es el botón del pie del diálogo (aria-label
  //    "Atrás"); también hay un botón "Cerrar cuadro de diálogo del editor",
  //    pero el usuario confirmó que el flujo real cierra con Atrás.
  const cerrado = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(vis);
    const picker = dialogs.find(d => (d.innerText || '').includes('Añadir grupos'));
    if (!picker) return { modo: 'sin-dialogo' };
    const btn = Array.from(picker.querySelectorAll('div[role="button"], button'))
      .find(e => vis(e) && /^atr[aá]s/i.test((e.getAttribute('aria-label') || e.innerText || '').trim()));
    if (!btn) return { modo: 'sin-atra' };
    const r = btn.getBoundingClientRect();
    return { modo: 'atras', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  if (cerrado.modo === 'atras') {
    const btnXY = { x: cerrado.x, y: cerrado.y };
    try {
      await page.mouse.move(btnXY.x, btnXY.y);
      await sleep(rand(150, 320));
      await page.mouse.click(btnXY.x, btnXY.y, { button: 'left', delay: rand(60, 160) });
    } catch (_) {
      await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, btnXY.x, btnXY.y);
    }
    await sleep(rand(2200, 3200));
  }

  if (DEBUG) await probeEtapa(page, 'picker-final');

  // El picker es un modal ENCIMA del compositor: si NO se cierra, tapa el botón
  // Publicar y el clic de publicar cae en el picker (el post queda con el texto
  // puesto y no sale; los fallos "no se envió" del 2026-10-16). Antes se intentaba
  // "Atrás" una vez y no se verificaba el resultado. Ahora se comprueba que el
  // diálogo se haya ido; si sigue, se fuerza con Escape.
  const pickerAbierto = () => page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return Array.from(document.querySelectorAll('[role="dialog"]')).filter(vis)
      .some(d => (d.innerText || '').includes('Añadir grupos'));
  }).catch(() => false);
  let cierreFinal = cerrado.modo;
  if (await pickerAbierto()) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(rand(1000, 1600));
    cierreFinal = (await pickerAbierto()) ? 'sigue-abierto' : 'escape';
  }

  return { seleccionados: verificado.map(i => items[i]), total, cargados, sinBoton: false, picker_cierre: cierreFinal };
}

async function grabPostUrl(page) {
  const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return page.evaluate((snippet) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const anchors = Array.from(document.querySelectorAll('a[href*="/posts/"]'));
    // primero: ancla cuya historia contenga el texto del post que acabamos de publicar
    for (const a of anchors) {
      const href = (a.getAttribute('href') || '').split('?')[0];
      if (!/\/groups\/\d+\/posts\/\d+/.test(href)) continue;
      const container = a.closest('[role="article"]');
      const ctx = norm(container ? container.innerText : '');
      if (snippet && ctx.includes(norm(snippet))) return href;
    }
    // SIN fallback: devolver "la primera historia con enlace" guardaba en la cola
    // el post de OTRO miembro como si fuera el nuestro (el feed tampoco siempre
    // renderiza en pestañas automatizadas). Mejor post_url vacío que URL ajena.
    return '';
  }, snippet);
}

async function debugComposer(page) {
  try {
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const act = document.activeElement;
      const cands = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => vis(el))
        .map((el, idx) => ({
          idx,
          aria: (el.getAttribute('aria-label') || '').slice(0, 50),
          ph: (el.getAttribute('aria-placeholder') || '').slice(0, 50),
          data: (el.getAttribute('data-placeholder') || '').slice(0, 50),
          len: (el.innerText || '').length,
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        }));
      return {
        active: act ? (act.getAttribute('contenteditable') ? `contenteditable ${(act.getAttribute('aria-label') || '').slice(0, 40)} len=${(act.innerText || '').length}` : act.tagName) : 'none',
        cands,
      };
    });
    console.log('DEBUG composer:', JSON.stringify(info, null, 2));
  } catch (e) { console.log('DEBUG composer error:', e.message); }
}

// En el layout actual de FB el compositor de post se abre con un botón
// "Escribe algo…". Lo clicamos para que se expanda/abra el editor.
async function clickComposerButton(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    // El texto del botón de compositor cambia según el tipo de grupo: los de
    // compra-venta dicen "Vender algo", otros "Crear publicación" o "¿Qué estás
    // pensando?". Antes solo se miraban 4 variantes y el resto terminaba en
    // "No se encontró el compositor del grupo". Se amplía la lista y se
    // descartan las cajas de comentarios del feed (viven dentro de un article).
    const CLAVES = [
      'escribe algo', 'escribir algo', 'write something', 'publicá algo', 'publica algo',
      'publicar algo', 'vender algo', 'crear publicación', 'crear publicacion',
      'crea una publicación', 'crea una publicacion', 'añadir algo', 'añade algo',
      'agregar algo', 'algo en mente', "what's on your mind", 'create post', 'comparte algo',
    ];
    let best = null;
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!vis(el)) continue;
      if (el.closest('[role="article"]') || el.closest('[role="feeditem"]')) continue;
      const t = norm(el.getAttribute('aria-label')) || norm(el.innerText) || '';
      if (!t) continue;
      if (!CLAVES.some((k) => t.includes(k))) continue;
      const len = (el.innerText || '').length;
      if (!best || len < best.len) best = { el, len };
    }
    if (!best) return false;
    best.el.click();
    return true;
  });
}

// ¿Ya hay un compositor de post abierto (como diálogo)? Si es así, NO hay que
// volver a clicar "Escribe algo…": cada clic de más abre OTRO compositor y deja
// varios modales apilados (el bug reportado el 2026-10-16 de "se abren dos
// compositores" en una misma corrida).
async function hayDialogoCompositor(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const d of Array.from(document.querySelectorAll('[role="dialog"]')).filter(vis)) {
      if (d.querySelector('input[type="file"]')) return true;
      const t = (d.innerText || '').toLowerCase();
      if (/escribe algo|escribir algo|crear publica|publica algo|add groups/.test(t)) return true;
    }
    return false;
  }).catch(() => false);
}

async function isLoginRequired(page) {
  if (/\/login|checkpoint|cookie_consent/i.test(page.url())) return true;
  // FB a veces muestra el muro de login como modal sobre el grupo SIN cambiar
  // la URL; antes eso se reportaba como "grupo cerrado". Se mira el texto
  // visible junto con la presencia real de campos de credenciales.
  return page.evaluate(() => {
    const t = (document.body ? document.body.innerText : '').toLowerCase();
    const campos = document.querySelectorAll('input[type="password"], input[name="pass"], input[name="email"]').length;
    return campos > 0 && /inicia sesi[oó]n|iniciar sesi[oó]n|log in|log into|contrase[nñ]a|password/.test(t);
  }).catch(() => false);
}

async function debugDump(page) {
  try {
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const editable = Array.from(document.querySelectorAll('[contenteditable], div[role="textbox"]')).map(el => ({
        tag: el.tagName,
        ce: el.getAttribute('contenteditable'),
        role: el.getAttribute('role'),
        aria: (el.getAttribute('aria-label') || '').slice(0, 60),
        ph: (el.getAttribute('aria-placeholder') || el.getAttribute('data-placeholder') || '').slice(0, 60),
        vis: vis(el),
      }));
      const buttons = [];
      for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
        if (!vis(el)) continue;
        const t = norm(el.innerText || el.getAttribute('aria-label'));
        if (t && /escrib|public|crear|algo|foto|video/.test(t)) buttons.push(t.slice(0, 50));
      }
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({
        vis: vis(d),
        aria: (d.getAttribute('aria-label') || '').slice(0, 60),
        len: (d.innerText || '').length,
      }));
      return {
        editable: editable.slice(0, 8),
        buttons: [...new Set(buttons)].slice(0, 12),
        dialogs: dialogs.slice(0, 4),
        words: [location.href, document.title],
      };
    });
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.log('DEBUG error:', e.message);
  }
}

/**
 * Recorte de lo que se ve en la página cuando algo falla: URL, título y las
 * primeras palabras del texto visible. Distingue "el grupo está cerrado" de "se
 * cayó la sesión" o de "Facebook bloqueó la cuenta por ritmo" sin depender de
 * mirar la captura a mano.
 */
async function resumenPagina(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();
      return { url: location.href, title: document.title, texto: txt.slice(0, 240) };
    });
  } catch (e) {
    return { url: page.url(), title: '', texto: '', error: e.message };
  }
}

/**
 * Volcado de los botones que SÍ están en el compositor cuando no se encontró el
 * de "Publicar".
 *
 * El error "No se encontró el botón Publicar" no dice NADA por sí solo: puede
 * ser que el botón diga otra cosa ("Publicar publicación", un ícono, o que
 * Facebook haya reemplazado el compositor por un aviso de límite). Sin ver qué
 * botones había, cada fallo obliga a adivinar. Con la lista en el log, el
 * siguiente fallo se explica solo.
 *
 * Acotado al ancla del compositor para no listar media página; si no hay ancla,
 * cae a un barrido global de los que huelan a "publicar".
 */
async function dumpPublishCandidates(page) {
  try {
    const anchor = await composerAnchor(page);
    const recoger = (root) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const salida = [];
      for (const el of root.querySelectorAll('div[role="button"], span[role="button"], button, [role="button"]')) {
        if (!vis(el)) continue;
        const t = norm(el.innerText);
        const a = norm(el.getAttribute('aria-label'));
        if (!t && !a) continue;
        const r = el.getBoundingClientRect();
        salida.push({ t: (t || ('aria:' + a)).slice(0, 30), dis: el.getAttribute('aria-disabled') || 'null', w: Math.round(r.width), h: Math.round(r.height) });
        if (salida.length >= 15) break;
      }
      return salida;
    };
    if (anchor) {
      const botones = await anchor.evaluate(recoger).catch(() => []);
      await anchor.dispose?.().catch?.(() => {});
      return { scoped: true, botones };
    }
    // Sin ancla: solo los que contengan "publicar" (global sería ruido puro).
    const botones = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const salida = [];
      for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button, [role="button"]')) {
        if (!vis(el)) continue;
        const t = norm(el.innerText).toLowerCase();
        const a = norm(el.getAttribute('aria-label')).toLowerCase();
        if (!t.includes('publicar') && !a.includes('publicar')) continue;
        const r = el.getBoundingClientRect();
        salida.push({ t: (norm(el.innerText) || ('aria:' + norm(el.getAttribute('aria-label')))).slice(0, 30), dis: el.getAttribute('aria-disabled') || 'null', w: Math.round(r.width), h: Math.round(r.height) });
        if (salida.length >= 15) break;
      }
      return salida;
    }).catch(() => []);
    return { scoped: false, botones };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

/**
 * Espera a que Facebook TERMINE de enviar el post, no solo a que se vacíe el
 * compositor.
 *
 * El compositor se vacía apenas se hace clic en Publicar, pero con imágenes la
 * subida sigue después (FB muestra "Publicando..." y recién ahí manda el post).
 * Si se cerraba la pestaña al ver el compositor vacío, se abortaba el envío a
 * mitad: el síntoma era "la pestaña se cierra mientras publica".
 *
 * Se considera enviado cuando:
 *  - el texto del post aparece en un [role="article"] del feed (confirmación
 *    fuerte), o
 *  - desaparecen los indicadores de subida/publicación Y el compositor sigue
 *    vacío, sostenido 2 muestras seguidas (evita el parpadeo del re-render).
 *
 * Devuelve { ok, motivo }. `ok:false` es "no se pudo confirmar en el tiempo",
 * que NO es lo mismo que "no se envió".
 */
async function esperarEnvioConfirmado(page, snippet, budgetMs) {
  const limite = Date.now() + (budgetMs || T.envioConfirmMs);
  let vacioSostenido = 0;
  let ultimo = { aparecio: false, enCurso: false, conTexto: 1 };
  while (Date.now() < limite) {
    ultimo = await page.evaluate((snip) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const s = norm(String(snip)).slice(0, 40);
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // 1) ¿ya aparece el post en el feed? Es la señal más confiable.
      let aparecio = false;
      if (s) {
        for (const art of document.querySelectorAll('[role="article"]')) {
          if (norm(art.innerText || '').includes(s)) { aparecio = true; break; }
        }
      }
      // 2) señales de que el envío sigue en curso.
      let enCurso = false;
      for (const el of document.querySelectorAll(
        '[role="progressbar"], [data-visualcompletion="loading-dynamic"], ' +
        '[aria-label*="Publicando" i], [aria-label*="Subiendo" i], [aria-label*="Cargando" i], ' +
        '[aria-label*="Procesando" i], [aria-label*="Uploading" i], [aria-label*="Posting" i]'
      )) {
        if (vis(el)) { enCurso = true; break; }
      }
      if (!enCurso) {
        for (const d of document.querySelectorAll('[role="dialog"]')) {
          if (vis(d) && /publicando|subiendo|enviando|posting|uploading/i.test(d.innerText || '')) { enCurso = true; break; }
        }
      }
      // 3) ¿quedó texto en algún compositor visible?
      const conTexto = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => vis(el) && (el.innerText || '').trim().length > 0).length;
      return { aparecio, enCurso, conTexto };
    }, snippet).catch(() => ({ aparecio: false, enCurso: true, conTexto: 1, error: true }));

    if (ultimo.aparecio) return { ok: true, motivo: 'el post apareció en el feed' };
    const paso = decidirEnvio(ultimo, vacioSostenido);
    vacioSostenido = paso.vacioSostenido;
    if (paso.done) return { ok: true, motivo: paso.motivo };
    await sleep(ENVIO_POLL_MS);
  }
  return { ok: false, motivo: 'no se pudo confirmar el envío a tiempo', ultimo };
}

// ---------------------------------------------------------------- grupos ---
// El grupo exige aprobación del administrador para las publicaciones de los
// miembros. No impide publicar, pero el post no es visible hasta que lo aprueben.
async function hasApprovalNotice(page) {
  return page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').toLowerCase();
    const body = norm(document.body ? document.body.innerText : '');
    if (/pendiente de la aprobaci[oó]n del administrador/.test(body)) return true;
    if (/tus publicaciones est[aá]n pendientes de aprobaci[oó]n/.test(body)) return true;
    if (/se requiere aprobaci[oó]n del administrador para publicar/.test(body)) return true;
    return false;
  }).catch(() => false);
}

async function processGroup(browser, groupUrl, label) {
  const t0 = Date.now();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 960 });
  await page.bringToFront();
  // La pestaña se cierra SIEMPRE en el finally, salvo en modo prepare, que
  // existe justamente para dejarle el post armado al usuario. Antes el cierre
  // estaba pegado al return de éxito: las otras 8 salidas (compositor no
  // encontrado, sin sesión, texto que no entró, botón Publicar ausente, error
  // inesperado) dejaban la pestaña abierta, y cada una se acumulaba con su
  // diálogo "Crear publicación" vivo. Con varias pestañas viejas, la corrida
  // siguiente encuentra diálogos ajenos y falla ella también: bola de nieve
  // que se veía como "el grupo está cerrado" cuando el grupo estaba bien.
  let dejarPestana = false;
  try {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    // Medir la red de ESTA página y escalar los presupuestos de espera antes de
    // empezar. Con internet lento, el resto del flujo espera más; con red rápida
    // los valores quedan iguales que siempre.
    const escala = await factorRed(page);
    const esperaInicial = Math.round(rand(4000, 7000) + (escala - 1) * 2500);
    await sleep(esperaInicial);

    if (await isLoginRequired(page)) {
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'Sesión de Facebook requerida. Abrí el perfil logueado y reintentá.' });
    }

    // Grupos con moderation: FB avisa "Pendiente de la aprobación del
    // administrador". El post se publica igual, pero queda en revisión, así que
    // lo marcamos para poder avisarlo en la lista y el historial.
    const needsApproval = await hasApprovalNotice(page);

    let composer = await findComposer(page);
    for (let attempt = 0; attempt < 6 && !composer; attempt++) {
      // Si ya hay un compositor abierto, NO clicar otra vez: cada clic de más
      // abre OTRO compositor. Antes el loop clicaba a ciegas varias veces y
      // dejaba varios modales apilados (el "más de un compositor" del 2026-10-16).
      if (await hayDialogoCompositor(page)) {
        await sleep(rand(1200, 2000));
      } else {
        await clickComposerButton(page);
        await sleep(rand(2200, 3200) * escala);
      }
      composer = await findComposer(page);
    }
    if (!composer) {
      if (DEBUG) { console.log('--- DEBUG: no composer encontrado ---'); await debugDump(page); }
      // Antes esta salida no dejaba NINGUNA evidencia (ni captura ni texto): la
      // causa más frecuente hoy no se podía distinguir de un grupo cerrado. Se
      // captura la pantalla y se anota URL/título/recorte del texto visible.
      const pag = await resumenPagina(page);
      if (pag.texto) console.error('[NO-COMPOSER] ' + JSON.stringify(pag));
      let captura = '';
      try {
        const nombre = 'danimarvis_fallo_composer.png';
        await page.screenshot({ path: require('path').join(require('os').tmpdir(), nombre) });
        captura = nombre;
      } catch (_) { /* la captura es un extra */ }
      return out({
        group_url: groupUrl, ok: false, status: 'error',
        message: 'No se encontró el compositor del grupo (¿grupo cerrado/archivado?).' + pistaSinCompositor(pag.texto),
        page_url: pag.url || '', page_title: pag.title || '',
        screenshot: captura,
      });
    }

    // clic físico sobre el compositor de post (foco real para el typing)
    await page.mouse.click(composer.x, composer.y);
    await sleep(rand(800, 1400));

    const composerHandle = await foundComposerHandle(page);
    // Técnica de pegado configurable (Ajustes > Publicaciones). ponerTexto ya
    // cae a `teclado` si la técnica elegida no deja el texto; acá queda un
    // reintento extra por si el fallo fue transitorio.
    let puesto = await ponerTexto(page, composerHandle, composer, METODO_TEXTO, groupUrl);
    emitirMetricas(puesto);
    if (!puesto.ok) {
      await clearComposer(page, composer);
      puesto = await ponerTexto(page, composerHandle, composer, METODO_TEXTO, groupUrl);
      emitirMetricas(puesto);
    }
    const lenBefore = puesto.len;
    if (!puesto.ok || lenBefore === 0) {
      const detalle = puesto.metodo_fallo ? ` (la técnica ${puesto.metodo_fallo} falló)` : '';
      return out({ group_url: groupUrl, ok: false, status: 'error', message: `El texto no quedó en el compositor.${detalle}`, metodo_texto: puesto.metodo, metodo_fallo: puesto.metodo_fallo || '' });
    }
    const imgs = await attachImages(page);
    const mediaCtx = await composerMediaContext(page);
    await debugMediaDump(page, 'after_attach', mediaCtx.rect);
    await sleep(rand(1200, 2400));

    // Lote de grupos. Va ACÁ, después de adjuntar y antes del botón Publicar,
    // porque "Añadir grupos" solo existe cuando hay al menos una imagen puesta:
    // con el texto solo, Facebook no lo muestra. En prepare deja los 9 ya
    // tildados para que el usuario solo tenga que darle Publicar, y en
    // dry-run los reporta sin publicar nada.
    let lote = { seleccionados: [], total: 0, sinBoton: false };
    // Estado del lote para que el backend y el panel distingan "no aplica" (sin
    // imágenes o lote apagado) de "se intentó y falló". Sin este campo, un post
    // que salió solo al grupo destino se registraba idéntico a uno repartido a
    // nueve: el 2026-10-16 quedó asentado como 'published' sin recoger el fallo.
    let loteEstado = 'no-aplicable';
    if (LOTE_N > 1 && imgs.images > 0) {
      lote = await seleccionarLoteGrupos(page, { n: LOTE_N, desde: LOTE_DESDE });
      loteEstado = lote.seleccionados.length ? 'ok' : (lote.sinBoton ? 'sin-boton' : 'sin-grupos');
      if (lote.sinBoton) {
        console.log(`[${label}] el boton "Añadir grupos" no apareció.`);
      } else if (!lote.seleccionados.length) {
        console.log(`[${label}] no se pudo tildar ningún grupo (picker_cierre=${lote.picker_cierre || '?'}).`);
      } else {
        console.log(`[${label}] LOTE (${lote.seleccionados.length}/${lote.total}): ${lote.seleccionados.join(' | ')}`);
      }
      await sleep(rand(800, 1600));
    }
    // Campos del lote que viajan en TODOS los resultados terminales de este post
    // (publicado, preparado, dry-run y los fallos posteriores al lote), para que
    // la cola pueda decir si se repartió o no.
    const loteCampos = { lote_grupos: lote.seleccionados, grupos_en_lista: lote.total, lote_estado: loteEstado };
    const loteTexto = lote.seleccionados.length
      ? ` Lote de ${lote.seleccionados.length} grupo(s) tildado(s).`
      : '';

    if (MODE === 'prepare') {
      console.log(`[${label}] post listo en pestaña (modo preparar).`);
      dejarPestana = true;   // acá NO se cierra: el usuario publica a mano
      // Si se pidieron imágenes y no hay ninguna en el contenedor de adjuntos,
      // avisar: el texto está pero la foto NO se adjuntó (FB la rechazó).
      const aviso = imgs.images > 0 && imgs.attached === 0
        ? ` ATENCIÓN: se pidieron ${imgs.images} imagen(es) y NO se adjuntó ninguna.`
        : '';
      return out({ group_url: groupUrl, ok: true, status: 'prepared', message: 'Post preparado en pestaña (revisar y publicar manualmente).' + aviso + loteTexto, imagen_adjunta: imgs.attached, imagenes_pedidas: imgs.images, texto_digits: lenBefore, metodo_texto: puesto.metodo, ...loteCampos });
    }
    if (MODE === 'dry-run') {
      return out({ group_url: groupUrl, ok: true, status: 'dry-run', message: `Simulación ok: texto ${lenBefore} chars, ${imgs.images} imagen(es).${loteTexto}`, texto_digits: lenBefore, imagen_adjunta: imgs.attached, metodo_texto: puesto.metodo, ...loteCampos });
    }

    // Damos a FB su tiempo para terminar de procesar los adjuntos y PUBLICAMOS
    // SIEMPRE. Las imagenes ya no pueden impedir que el post salga.
    //
    // El abort que habia antes (si el conteo no llegaba al total pedido) era el
    // bug, no la proteccion. La proteccion real contra publicar sin imagenes es
    // que el resultado quede REGISTRADO y visible, y eso se hace mas abajo con
    // el booleano `adjuntos_confirmados` y con la nota que escribe updateQueue.
    let ready = 0;
    if (imgs.images > 0) {
      ready = await ensureMediaReady(page, composer, imgs.images, mediaCtx.rect);
      await debugMediaDump(page, `at_publish ready=${ready}/${imgs.images}`, mediaCtx.rect);
    }
    // Lo que SÍ se puede afirmar con confianza es si FB tomó los adjuntos: si
    // aparecen los controles de "quitar foto", hay adjuntos. El conteo exacto
    // no se puede sostener: se midió y da 0 con los adjuntos presentes, porque
    // el panel de adjuntos no es un <img> dentro del ancla del compositor (FB lo
    // monta aparte) y el <img> real es una miniatura de 64x80 que se confunde
    // con las del feed. Por eso el resultado lleva un booleano y no un número:
    // preferable decir "no pude verificar" a anotar "0 de 6" y mentir.
    const confirmados = imgs.images === 0 ? true : !!imgs.hasRemove;

    const pub = await clickPublish(page, false);

    // Esperar a que el compositor se vacíe (post publicado). El bucle es por
    // TIEMPO, no por número fijo de vueltas: antes eran 20 x 1.5s = 30s fijos y
    // con internet lento el compositor tardaba más en vaciarse → se declaraba el
    // falso "no se envió" aunque el post sí hubiera salido. El presupuesto del
    // vaciado es CORTO a propósito: el editor normal se vacía en segundos, y si
    // no lo hace, NO se falla de una — se deja que `esperarEnvioConfirmado` (más
    // abajo) confirme contra el feed, que es la prueba de verdad. Así el peor
    // caso es DRAIN_MS + ENVIO_CONFIRM_MS, no 2x ENVIO_CONFIRM_MS: dos esperas
    // largas en serie reventaban el guard de --max-seconds y el grupo moría por
    // "Timeout de la operación".
    let len = lenBefore;
    let cleared = false;
    const drainDeadline = Date.now() + T.drainMs;
    while (Date.now() < drainDeadline) {
      len = await currentComposerLen(page);
      if (len === 0) { cleared = true; break; }
      await sleep(1500);
    }
    if (!pub.clicked) {
      // Mismo trato que el fallo de abajo: si no se encontró el botón, la
      // pantalla es la evidencia. Este caso también apareció en el 2026-10-03
      // (6 veces) y quedó sin ninguna pista de por qué.
      let captura = '';
      try {
        const nombre = 'danimarvis_fallo_check.png';
        await page.screenshot({ path: require('path').join(require('os').tmpdir(), nombre) });
        captura = nombre;
      } catch (_) { /* nunca romper el resultado por una captura */ }
      const detalle = pub.disabled
        ? ` El botón "Publicar" estaba DESHABILITADO (aria-disabled=${pub.info?.dis ?? 'true'}) después de ${Math.round(T.publishWaitMs / 1000)}s: Facebook seguía procesando las imágenes o no aceptó el texto.`
        : '';
      // Qué botones había de verdad: sin esto, "no se encontró Publicar" no dice
      // si el compositor no se abrió, si el botón dice otra cosa, o si Facebook
      // lo reemplazó por un aviso. Va al stderr para que quede en las notas.
      const cand = await dumpPublishCandidates(page);
      if (!cand.error) console.error('[SUBMIT-CAND] ' + JSON.stringify(cand));
      const pistaCand = cand && cand.botones && cand.botones.length
        ? ` Botones en el compositor: ${cand.botones.map(b => `"${b.t}"${b.dis === 'true' ? '(deshab.)' : ''}`).join(', ')}.`
        : ' No se encontró ningún botón dentro del compositor.';
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'No se encontró el botón Publicar.' + detalle + pistaCand, clicks: pub, screenshot: captura, candidatos: cand, ...loteCampos });
    }
    if (!cleared) {
      // El compositor no se vació dentro del presupuesto. Antes esto se daba por
      // fallado en seco, pero con red lenta el post SÍ puede haber salido y el
      // editor tardar en vaciarse. Así que primero se mira el feed con la misma
      // verificación del camino feliz: si el post está publicado, es un éxito (la
      // lectura del editor llegó tarde), no un error.
      const envioTarde = await esperarEnvioConfirmado(page, text).catch(() => ({ ok: false, motivo: 'error al verificar el envío' }));
      console.error('[ENVIO-TARDE] ' + JSON.stringify(envioTarde));
      if (envioTarde.ok) {
        return out({ group_url: groupUrl, ok: true, status: 'published',
          message: 'Publicado (el compositor tardó en vaciarse; se confirmó en el feed).' + loteTexto,
          post_url: envioTarde.postUrl || '', imagen_adjunta: imgs.attached, imagenes_pedidas: imgs.images,
          adjuntos_confirmados: confirmados ? 1 : 0, texto_digits: lenBefore, metodo_texto: puesto.metodo, toral_ms: Date.now() - t0, ...loteCampos });
      }
      // Diagnóstico para que el error diga POR QUÉ no se ve el envío y no haya
      // que adivinar. Se separa el caso "el texto sigue en el compositor" (FB no
      // lo tomó: límite, verificación, o el clic no_registryó) del caso "no
      // quedó texto en ningún editor" (el compositor ni se encontró al releer).
      const diag = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const cs = getComputedStyle(el);
          return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
        };
        const edits = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(vis);
        const conTexto = edits.filter(el => (el.innerText || '').trim().length > 0);
        let mayor = 0;
        for (const el of conTexto) {
          const r = el.getBoundingClientRect();
          mayor = Math.max(mayor, r.width * r.height);
        }
        // texto de bloqueo que FB muestra en el compositor o encima.
        //
        // OJO con el alcance de esta búsqueda: antes miraba SOLO
        // [role="alert"], y de los 34 fallos del 2026-10-03 ninguno trae aviso.
        // Facebook no siempre marca el cartel como alert: si rechaza el envío
        // por ritmo lo muestra como toast o diálogo suelto, y entonces esta
        // búsqueda volvía con null y el error decía "no se encontró nada", que
        // es lo mismo que decir "no miré donde tocaba". Ahora se mira todo lo
        // visible que parezca un cartel, y se devuelve el TEXTO, no solo la
        // palabra clave: "no se encontró ningún aviso" y "FB dijo tal cosa" son
        // dos datos distintos y solo el segundo sirve para actuar.
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const normLow = (s) => norm(s).toLowerCase();
        const posibles = Array.from(document.querySelectorAll(
          'div[role="alert"], span[role="alert"], div[role="dialog"], [data-testid*="Dialog"]'
        )).filter(vis)
          .map(el => norm(el.innerText))
          .filter(t => t && t.length < 400);
        const palabras = ['no puedes publicar', 'límite', 'limite', 'intenta de nuevo más tarde',
          'intenta de nuevo mas tarde', 'verificación', 'verificacion', 'confirmá tu cuenta',
          'confirma tu cuenta', 'sugerencia', 'error', 'bloqueado', 'demasiado', 'espera un momento',
          'lo siento', 'no pudimos', 'intenta de nuevo'];
        const conAviso = posibles.find(t => palabras.some(k => normLow(t).includes(k)));
        const bloqueo = conAviso ? conAviso.slice(0, 160)
          : (palabras.find(k => posibles.some(t => normLow(t).includes(k))) || null);
        return {
          editables: edits.length,
          conTexto: conTexto.length,
          areaMax: Math.round(mayor),
          bloqueo: bloqueo || null,
          // Para el log: cuántos carteles había, aunque ninguno fuera un aviso.
          carteles: posibles.length,
        };
      }).catch((e) => ({ error: e.message || String(e) }));
      // Un post largo o con 6+ imágenes necesita bastante más que 30 s para
      // aparecer; el tiempo de espera era el otro mitad del problema.
      const otra = await currentComposerLen(page);
      if (otra === 0) {
        return out({ group_url: groupUrl, ok: true, status: 'published',
          message: 'Publicado (el compositor se vació, la primera lectura llegó tarde).' + loteTexto,
          post_url: '', imagen_adjunta: imgs.attached, imagenes_pedidas: imgs.images,
          adjuntos_confirmados: confirmados ? 1 : 0, texto_digits: lenBefore, metodo_texto: puesto.metodo, toral_ms: Date.now() - t0, ...loteCampos });
      }
      const porQuien = diag.bloqueo
        ? ` FB mostró un aviso: "${diag.bloqueo}".`
        : (diag.conTexto
            ? ' El texto sigue en el compositor: el post probablemente NO se envió.'
            : ' No se encontró el compositor al releer, así que no se puede confirmar el envío.');
      // Si el propio diagnóstico falló (p.ej. la página navegó justo después del
      // clic y se destruyó el contexto de ejecución), el "0 editores" NO prueba
      // que el compositor esté vacío — es al revés: no se pudo mirar. Se anota
      // para no volver a confundir "no miré" con "no hay".
      const avisoDiag = diag.error ? ` (diagnóstico no disponible: ${diag.error})` : '';
      // Captura del FALLO. Antes solo se fotografiaba el éxito, que es justo lo
      // que no hace falta: cuando algo sale mal, la imagen de la pantalla es
      // often the only thing that shows a dialog, a spinner, a disabled button or
      // an unexpected page. Va al mismo tempdir que la del éxito para que el
      // usuario la pueda abrir sin buscar nada.
      let captura = '';
      try {
        const nombre = 'danimarvis_fallo_check.png';
        await page.screenshot({ path: require('path').join(require('os').tmpdir(), nombre) });
        captura = nombre;
      } catch (_) { /* la captura es un extra: nunca debe romper el resultado */ }
      // Si Facebook NO mostró ningún aviso, no se puede afirmar que el post "no
      // se envió": con red lenta el compositor puede quedarse con el texto un
      // rato DESPUÉS de que el post ya salió. Antes eso se contaba como error y
      // alimentaba el breaker (3 fallos → cortar), generando falsos negativos que
      // descartaban posts que SÍ salieron. Ahora, sin aviso de FB, el veredicto
      // es INDETERMINADO: se registra para que el usuario lo revise, pero no
      // corta la corrida ni se suma al contador de fallos del breaker.
      const indeterminado = !diag.bloqueo && !diag.error;
      if (indeterminado) {
        return out({
          group_url: groupUrl, ok: false, status: 'revisar',
          message: `Se hizo clic en Publicar y no se pudo confirmar el envío (${diag.conTexto || 0} editor(es) con texto, el mayor de ${diag.areaMax || 0}px²).${porQuien} Revisá el grupo por si quedó publicado; si salió, no lo republiques.`,
          clicks: pub,
          alert_text: '',
          carteles: diag.carteles || 0,
          screenshot: captura,
          ...loteCampos,
        });
      }
      return out({
        group_url: groupUrl, ok: false, status: 'error',
        message: `Se hizo clic en Publicar pero el post no se envió (${diag.conTexto || 0} editor(es) con texto, el mayor de ${diag.areaMax || 0}px²).${porQuien}${avisoDiag}`,
        clicks: pub,
        alert_text: diag.bloqueo || '',
        carteles: diag.carteles || 0,
        screenshot: captura,
        ...loteCampos,
      });
    }
    // El compositor quedó vacío, pero eso NO garantiza que Facebook haya
    // terminado de enviar: con imágenes el editor se vacía y la subida sigue
    // después. Antes se cerraba la pestaña (en el finally) a los pocos segundos,
    // abortando el envío a mitad: se veía como "la pestaña se cierra mientras
    // publica". Se espera a que el envío termine de verdad.
    const envio = await esperarEnvioConfirmado(page, text).catch(() => ({ ok: false, motivo: 'error al verificar el envío' }));
    console.error('[ENVIO] ' + JSON.stringify(envio));
    // diagnosticar el post recién publicado (¿trae la foto?) en esta misma pestaña
    try {
      // La espera de arriba ya le dio tiempo a FB: solo un respiro mínimo antes
      // de releer, no los 6s de antes.
      await sleep(1200);
      const fresh = await page.evaluate((snippet) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const s = norm(String(snippet)).slice(0, 40);
        for (const art of document.querySelectorAll('[role="article"]')) {
          const t = norm(art.innerText || '');
          if (s && t.includes(s)) {
            const media = [];
            for (const img of art.querySelectorAll('img')) {
              const src = img.currentSrc || img.src || '';
              if (!src || src.includes('rsrc.php')) continue;
              const r = img.getBoundingClientRect();
              if (Math.max(r.width, parseInt(img.getAttribute('width') || 0, 10) || 0) >= 90) media.push({ w: Math.round(r.width), s: src.slice(0, 40) });
            }
            return { found: true, txt: t.slice(0, 60), mediaCount: media.length, media };
          }
        }
        return { found: false, articles: document.querySelectorAll('[role="article"]').length };
      }, text).catch(() => ({}));
      console.error('[FRESH] ' + JSON.stringify(fresh));
      await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'danimarvis_published_check.png') }).catch(() => {});
    } catch (_) {}
    const postUrl = await grabPostUrl(page);
    return out({
      group_url: groupUrl, ok: true, status: 'published',
      message: 'Publicado en el grupo.'
        + (imgs.images === 0 ? '' : (confirmados
            ? ` (FB tomó los ${imgs.images} adjunto(s); el conteo exacto no se pudo verificar).`
            : ` ATENCIÓN: se pidieron ${imgs.images} imagen(es) y FB no mostró los controles de quitar foto, o sea que probablemente no las tomó.`))
        + (needsApproval ? ' Queda pendiente de aprobación del administrador.' : '')
        + (envio.ok ? '' : ` (no se pudo confirmar el envío en el tiempo: ${envio.motivo}; revisá el grupo por si quedó publicado)` )
        + loteTexto,
      post_url: postUrl,
      envio_confirmado: envio.ok ? 1 : 0,
      lote_grupos: lote.seleccionados,
      grupos_en_lista: lote.total,
      lote_estado: loteEstado,
      imagen_adjunta: imgs.attached,
      imagenes_pedidas: imgs.images,
      adjuntos_confirmados: confirmados ? 1 : 0,
      texto_digits: lenBefore,
      metodo_texto: puesto.metodo,
      requiere_aprobacion: needsApproval ? 1 : 0,
      toral_ms: Date.now() - t0,
    });
  } catch (err) {
    return out({ group_url: groupUrl, ok: false, status: 'error', message: (err.message || '').slice(0, 200) });
  } finally {
    if (!dejarPestana) await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- main ---
(async () => {
  console.log('==============================================');
  console.log(`  Group poster | mode=${MODE} | grupos: ${groups.length}`);
  console.log(`  Mensaje: ${text.length} chars | Imágenes: ${images.length}`);
  console.log(`  Técnica de texto: ${METODOS_TEXTO.includes(METODO_TEXTO) ? METODO_TEXTO : 'teclado (inválida: ' + METODO_TEXTO + ')'}`);
  console.log('==============================================');

  if (!groups.length) {
    console.log('FALTA: --groups ...');
    process.exit(1);
  }

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null, protocolTimeout: 240000 });
  } catch (e) {
    console.log('ERROR: No se pudo conectar a Chrome en el puerto 9222: ' + e.message);
    process.exit(1);
  }

  // Permisos de portapapeles para la técnica `ctrlv` (no hacen nada si se usa
  // otra técnica). Sin esto, navigator.clipboard.writeText falla por falta de
  // permiso y la técnica B caería siempre a teclado.
  try {
    await browser.defaultBrowserContext().overridePermissions('https://www.facebook.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  } catch (e) {
    console.log('AVISO: no se pudieron conceder permisos de portapapeles: ' + e.message);
  }

  for (const [i, groupUrl] of groups.entries()) {
    const remaining = MAX_SECONDS;
    console.log(`\n[${LABEL} #${i + 1}/${groups.length}] ${groupUrl}`);
    const started = Date.now();
    const guard = sleep(remaining * 1000).then(() => {
      out({ group_url: groupUrl, ok: false, status: 'error', message: 'Timeout de la operación en el grupo.' });
    });
    const worker = processGroup(browser, groupUrl, `${LABEL}#${i + 1}`)
      .catch(err => out({ group_url: groupUrl, ok: false, status: 'error', message: (err.message || '').slice(0, 200) }));
    await Promise.race([worker, guard]);
    await sleep(rand(2000, 4000));
    if (Date.now() - started > remaining * 1000) break;
  }

  browser.disconnect().catch(() => {});
  console.log('\nTerminado.');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });