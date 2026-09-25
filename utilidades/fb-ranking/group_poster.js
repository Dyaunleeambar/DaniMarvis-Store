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

// Escribe el texto en el compositor con teclado nativo (compatible con el
// editor Lexical de FB — execCommand('insertText') genera artefactos como
// "[object HTMLDivElement]"). Devuelve 'teclado' si el texto quedó, 'fail' si no.
async function typeText(page, handle, coords) {
  const t = String(text || '');
  if (!t) return 'vacio';
  if (coords) await page.mouse.click(coords.x, coords.y);
  await sleep(350);
  if (handle) await handle.focus().catch(() => {});
  await sleep(300);
  const before = await composerLenOf(handle);
  await page.keyboard.type(t, { delay: 12 });
  await sleep(500);
  const after = await composerLenOf(handle);
  if (after <= before) return 'fail';
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

async function findPhotoInputs(page) {
  const ctx = await composerMediaContext(page);
  return ctx.inputs;
}

// Contexto multimedia DEL COMPOSITOR: sube por ancestros desde nuestro editor
// (marcado con data-pgp-composer) hasta el panel que contiene un input file.
// Devuelve { inputs, rect }. NUNCA toca inputs ajenos (foto de portada/perfil).
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
    if (!editable) return { inputs: [], rect: null };
    let node = editable;
    while (node && node !== document.body) {
      node = node.parentElement;
      // los inputs file del compositor suelen estar ocultos (display:none), así
      // que NO se filtra por visibilidad — se garantiza por el ancenstro (panel).
      const inputs = Array.from(node.querySelectorAll('input[type="file"]'));
      if (!inputs.length) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 1300 || r.height > 800) continue; // no trepar a contenedores de página
      const detected = inputs.find(i => {
        const a = (i.getAttribute('accept') || '').toLowerCase();
        return !a || a.includes('image');
      }) || inputs[0];
      return { inputs: [detected], rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    return { inputs: [], rect: null };
  }).catch(() => ({ inputs: [], rect: null }));
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

async function attachImages(page) {
  if (!images.length) return { images: 0, preview: false, attached: 0 };

  let indexBase = 0;
  let attached = 0;
  let panel = null;
  // FB/React solo procesa el primer archivo de un upload múltiple en un mismo
  // evento change, así que subimos de a UNA imagen por input fresco y esperamos
  // a que el panel del compositor gane <img> visibles antes del siguiente.
  for (const file of images) {
    const ctx = await composerMediaContext(page);
    if (!ctx.inputs.length) break;
    panel = ctx.rect;
    indexBase = await countImageElements(page, panel);
    let done = false;
    for (const input of ctx.inputs) {
      try {
        await input.evaluate(el => { if (el.hasAttribute('multiple')) el.removeAttribute('multiple'); });
        await input.uploadFile(file);
      } catch (_) { continue; }
      for (let i = 0; i < 10; i++) {
        await sleep(1200);
        const now = await countImageElements(page, panel);
        const markers = await countMarkers(page);
        if (now > indexBase || markers > attached) {
          attached = Math.max(attached + 1, markers);
          indexBase = Math.max(now, indexBase);
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (!done) break;
  }
  return { images: images.length, preview: attached > 0, attached };
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
async function ensureMediaReady(page, composer, expected) {
  if (!expected) return 0;
  let markers = 0;
  for (let s = 1; s <= 12; s++) {
    markers = await revealMarkers(page, composer);
    if (markers >= expected) break;
    await sleep(600);
  }
  if (markers < expected) return -1;
  // La subida termina cuando la miniatura del PANEL del compositor se sirve desde
  // la CDN real de FB (antes es blob:). Los spinners "Cargando…" del muro no
  // cuentan (falsos).
  const ctx = await composerMediaContext(page);
  let ready = false;
  for (let s = 1; s <= 15; s++) {
    const st = await composerMediaState(page, ctx.rect);
    const bigCd = st.imgs.filter(i => i.k === 'cd' && i.w >= 100).length;
    const bigBlob = st.imgs.filter(i => i.k === 'blob' && i.w >= 100).length + st.bgThumbs.length;
    if (bigBlob === 0 && bigCd > 0) { ready = true; break; }
    await sleep(600);
  }
  if (!ready) return -1;
  markers = await revealMarkers(page, composer);
  return markers >= expected ? markers : -1;
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
    // fallback: primera historia con enlace válido
    for (const a of anchors) {
      const href = (a.getAttribute('href') || '').split('?')[0];
      if (/\/groups\/\d+\/posts\/\d+/.test(href)) return href;
    }
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
      return out({ group_url: groupUrl, ok: true, status: 'prepared', message: 'Post preparado en pestaña (revisar y publicar manualmente).', imagen_adjunta: imgs.attached, texto_digits: lenBefore });
    }
    if (MODE === 'dry-run') {
      return out({ group_url: groupUrl, ok: true, status: 'dry-run', message: `Simulación ok: texto ${lenBefore} chars, ${imgs.images} imagen(es).`, texto_digits: lenBefore, imagen_adjunta: imgs.attached });
    }

    // En publish, esperamos a que FB termine de subir/procesar los adjuntos. Si
    // no quedaron listos abortamos para NO publicar un post sin imagen.
    let ready = 0;
    if (imgs.images > 0) {
      ready = await ensureMediaReady(page, composer, imgs.images);
      await debugMediaDump(page, `at_publish ready=${ready}`, mediaCtx.rect);
      if (ready < 1) {
        return out({ group_url: groupUrl, ok: false, status: 'error', message: 'Los adjuntos no quedaron subidos a tiempo en FB; no se publicó para evitar un post sin imagen.' });
      }
    }

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
      message: 'Publicado en el grupo.' + (ready ? ` (${ready} foto(s) adjunta(s)).` : ''),
      post_url: postUrl,
      imagen_adjunta: imgs.attached,
      texto_digits: lenBefore,
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