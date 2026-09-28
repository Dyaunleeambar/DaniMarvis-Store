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
 *     [--max-seconds 240]
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

const DEBUG_PORT = 9222;

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
const MAX_SECONDS = parseInt(val(args, '--max-seconds') || '300', 10) || 300;
const DEBUG = !!val(args, '--debug');

const splitList = (raw, sep = ';') => String(raw || '').split(sep).map(s => s.trim()).filter(Boolean);
const groups = splitList(GROUPS_RAW, ';');
const images = splitList(IMAGES_RAW, ';');

const text = (MESSAGE_FILE && fs.existsSync(MESSAGE_FILE))
  ? fs.readFileSync(MESSAGE_FILE, 'utf8')
  : MESSAGE;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

// Carga de adjuntos. Los tiempos están calculados para que el peor caso quepa en
// MAX_SECONDS (300s por grupo) incluso con 10 imágenes: 10 x 2 intentos x 6
// sondeos x 1s = 120s de espera de adjunto, y ensureMediaReady se lleva como
// máximo 33s. Antes una sola imagen agotaba 12s y una sola falla cortaba todo
// el loop, así que 6 imágenes no llegaban nunca.
const ATTACH_ATTEMPTS = 2;   // intentos por imagen, cada uno con input fresco
const ATTACH_POLL_MS = 1000; // intervalo entre sondeos de miniatura
const ATTACH_WAIT_POLLS = 6; // sondeos por intento (6s)
const READY_BASE_MS = 8000;  // presupuesto de "listo" = base + 2.5s x imagen
const READY_PER_IMAGE_MS = 2500;
const READY_MAX_MS = 45000;  // tope absoluto del presupuesto de "listo"

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

    const pick = byPh[0] || postCands[0] || null;
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
      editable = null;
      for (const el of document.querySelectorAll('[contenteditable="true"],[role="textbox"]')) {
        if (vis(el)) { editable = el; break; }
      }
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
  if (!images.length) return { images: 0, preview: false, attached: 0, failed: [], hasRemove: false };

  let indexBase = 0;
  let panel = null;
  const failed = [];
  // FB/React solo procesa el primer archivo de un upload múltiple en un mismo
  // evento change, así que subimos de a UNA imagen por input fresco y esperamos
  // a que el panel del compositor gane un adjunto visible antes del siguiente.
  //
  // Dos cambios con respecto a la versión anterior:
  //  - cada imagen tiene hasta ATTACH_ATTEMPTS intentos con input fresco, porque
  //    un solo intento fallaba con un input que FB ya había consumido;
  //  - una imagen que no se adjunta NO corta el loop. Antes un `break` dejaba
  //    las imágenes siguientes sin intentar, y como el gate de publicación
  //    exigía el total pedido, el post entero se caía.
  for (const file of images) {
    const ctx = await composerMediaContext(page);
    if (ctx.rect) panel = ctx.rect;
    const base = Math.max(indexBase, (await mediaAttachedCount(page, panel)).n);

    let done = false;
    for (let attempt = 1; attempt <= ATTACH_ATTEMPTS && !done; attempt++) {
      const input = await composerFileInput(page);
      if (!input) {
        if (attempt === ATTACH_ATTEMPTS) { failed.push(file); continue; }
        await sleep(1000 * attempt);
        continue;
      }
      try {
        // FB/React con multiple procesa solo el primer archivo del evento change;
        // se sube de a UNA imagen por input.
        await input.evaluate(el => { if (el.hasAttribute('multiple')) el.removeAttribute('multiple'); });
        await input.uploadFile(file);
      } catch (e) {
        console.error('[MEDIA] upload falló:', (e.message || '').slice(0, 120));
      }
      for (let i = 0; i < ATTACH_WAIT_POLLS; i++) {
        await sleep(ATTACH_POLL_MS);
        const now = (await mediaAttachedCount(page, panel)).n;
        if (now > base) { done = true; break; }
      }
    }
    indexBase = (await mediaAttachedCount(page, panel)).n;
    if (!done) {
      failed.push(file);
      console.error(`[MEDIA] ${path.basename(file)} no se adjuntó tras ${ATTACH_ATTEMPTS} intentos; se sigue con la siguiente.`);
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
    failed,
    hasRemove: st.hasRemove,
    detect: st,
  };
}

async function currentComposerLen(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(el => vis(el) && (el.innerText || '').trim());
    return cands.length ? (cands[0].innerText || '').trim().length : 0;
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
  const budgetMs = Math.min(READY_MAX_MS, READY_BASE_MS + expected * READY_PER_IMAGE_MS);
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
async function clickPublish(page, dryRun) {
  if (dryRun) return { clicked: false, tooltip: false, dry: true };
  const btn = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const isPub = (el) => {
      if (!vis(el) || el.getAttribute('aria-disabled') === 'true') return false;
      const t = norm(el.innerText), a = norm(el.getAttribute('aria-label'));
      return t === 'publicar' || a === 'publicar';
    };
    const rectInfo = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    };
    // 1) el editor al que escribimos (contenteditable visible con texto)
    let editable = null;
    for (const el of document.querySelectorAll('[contenteditable="true"]')) {
      if (!vis(el)) continue;
      const t = (el.innerText || '').trim();
      if (t.length >= 2) { editable = el; break; }
    }
    // 2) subir por ancestros hasta un panel que contenga un botón exacto "publicar"
    if (editable) {
      let node = editable;
      while (node && node !== document.body) {
        node = node.parentElement;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.width > 2600 || r.height > 2600) continue;
        const pub = Array.from(node.querySelectorAll('div[role="button"], span[role="button"], button')).find(isPub);
        if (pub) {
          return Object.assign({ label: 'publicar', aria: (pub.getAttribute('aria-label') || '').slice(0, 40), dis: pub.getAttribute('aria-disabled') || 'null', scoped: true }, rectInfo(pub));
        }
      }
    }
    // 3) fallback global: exactos "publicar", el más pequeño
    let best = null;
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!isPub(el)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (!best || area < best.area) best = Object.assign({ label: 'publicar', aria: (el.getAttribute('aria-label') || '').slice(0, 40), dis: el.getAttribute('aria-disabled') || 'null', scoped: false, area }, rectInfo(el));
    }
    return best || null;
  });
  if (!btn) return { clicked: false, tooltip: false };
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
    let best = null;
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!vis(el)) continue;
      const t = norm(el.getAttribute('aria-label')) || norm(el.innerText) || '';
      if (!t) continue;
      const hit = t.includes('escribe algo') || t.includes('escribir algo') || t.includes('write something') || t.includes('publicá algo');
      if (hit && (!best || (el.innerText || '').length < (best.el.innerText || '').length)) best = { el };
    }
    if (!best) return false;
    best.el.click();
    return true;
  });
}

async function isLoginRequired(page) {
  return /\/login|checkpoint|cookie_consent/i.test(page.url());
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
  try {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(rand(5000, 8000));

    if (await isLoginRequired(page)) {
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'Sesión de Facebook requerida. Abrí el perfil logueado y reintentá.' });
    }

    // Grupos con moderation: FB avisa "Pendiente de la aprobación del
    // administrador". El post se publica igual, pero queda en revisión, así que
    // lo marcamos para poder avisarlo en la lista y el historial.
    const needsApproval = await hasApprovalNotice(page);

    let composer = await findComposer(page);
    for (let attempt = 0; attempt < 4 && !composer; attempt++) {
      await clickComposerButton(page);
      await sleep(rand(2200, 3200));
      composer = await findComposer(page);
    }
    if (!composer) {
      if (DEBUG) { console.log('--- DEBUG: no composer encontrado ---'); await debugDump(page); }
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'No se encontró el compositor del grupo (¿grupo cerrado/archivado?).' });
    }

    // clic físico sobre el compositor de post (foco real para el typing)
    await page.mouse.click(composer.x, composer.y);
    await sleep(rand(800, 1400));

    const composerHandle = await foundComposerHandle(page);
    const typing = await typeText(page, composerHandle, composer);
    let lenBefore = await composerLenOf(composerHandle);
    const expected = Math.max(8, String(text || '').length - 12);
    if (lenBefore < expected) {
      // el texto no quedó completo: limpiar y reintentar una vez por teclado
      await clearComposer(page, composer);
      const typing2 = await typeText(page, composerHandle, composer);
      lenBefore = await composerLenOf(composerHandle);
      const ok2 = typing2 !== 'fail' && lenBefore >= expected;
      if (!ok2 && typing === 'fail') {
        return out({ group_url: groupUrl, ok: false, status: 'error', message: 'El texto no quedó en el compositor.' });
      }
      if (!ok2 && typing2 === 'fail') {
        return out({ group_url: groupUrl, ok: false, status: 'error', message: 'El texto no quedó en el compositor (reintento fallido).' });
      }
    }
    if (lenBefore === 0) {
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'El texto no quedó en el compositor.' });
    }
    const imgs = await attachImages(page);
    const mediaCtx = await composerMediaContext(page);
    await debugMediaDump(page, 'after_attach', mediaCtx.rect);
    await sleep(rand(1200, 2400));

    if (MODE === 'prepare') {
      console.log(`[${label}] post listo en pestaña (modo preparar).`);
      // Si se pidieron imágenes y no hay ninguna en el contenedor de adjuntos,
      // avisar: el texto está pero la foto NO se adjuntó (FB la rechazó).
      const aviso = imgs.images > 0 && imgs.attached === 0
        ? ` ATENCIÓN: se pidieron ${imgs.images} imagen(es) y NO se adjuntó ninguna.`
        : '';
      return out({ group_url: groupUrl, ok: true, status: 'prepared', message: 'Post preparado en pestaña (revisar y publicar manualmente).' + aviso, imagen_adjunta: imgs.attached, imagenes_pedidas: imgs.images, texto_digits: lenBefore });
    }
    if (MODE === 'dry-run') {
      return out({ group_url: groupUrl, ok: true, status: 'dry-run', message: `Simulación ok: texto ${lenBefore} chars, ${imgs.images} imagen(es).`, texto_digits: lenBefore, imagen_adjunta: imgs.attached });
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

    // esperar a que el compositor se vacíe (post publicado)
    let len = lenBefore;
    let cleared = false;
    for (let i = 0; i < 20; i++) {
      len = await currentComposerLen(page);
      if (len === 0) { cleared = true; break; }
      await sleep(1500);
    }
    if (!pub.clicked) {
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'No se encontró el botón Publicar.' });
    }
    if (!cleared) {
      return out({ group_url: groupUrl, ok: false, status: 'error', message: 'Se hizo clic en Publicar pero el post no se envió (posible limitación o mensaje de verificacion).', clicks: pub });
    }
    // diagnosticar el post recién publicado (¿trae la foto?) en esta misma pestaña
    try {
      await sleep(6000);
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
    // en modo publish cerramos la pestaña (ya no hace falta)
    const postUrl = await grabPostUrl(page);
    await page.close().catch(() => {});
    return out({
      group_url: groupUrl, ok: true, status: 'published',
      message: 'Publicado en el grupo.'
        + (imgs.images === 0 ? '' : (confirmados
            ? ` (FB tomó los ${imgs.images} adjunto(s); el conteo exacto no se pudo verificar).`
            : ` ATENCIÓN: se pidieron ${imgs.images} imagen(es) y FB no mostró los controles de quitar foto, o sea que probablemente no las tomó.`))
        + (needsApproval ? ' Queda pendiente de aprobación del administrador.' : ''),
      post_url: postUrl,
      imagen_adjunta: imgs.attached,
      imagenes_pedidas: imgs.images,
      adjuntos_confirmados: confirmados ? 1 : 0,
      texto_digits: lenBefore,
      requiere_aprobacion: needsApproval ? 1 : 0,
      toral_ms: Date.now() - t0,
    });
  } catch (err) {
    return out({ group_url: groupUrl, ok: false, status: 'error', message: (err.message || '').slice(0, 200) });
  }
}

// ---------------------------------------------------------------- main ---
(async () => {
  console.log('==============================================');
  console.log(`  Group poster | mode=${MODE} | grupos: ${groups.length}`);
  console.log(`  Mensaje: ${text.length} chars | Imágenes: ${images.length}`);
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