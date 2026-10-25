// ---------------------------------------------------------------------------
// EXPERIMENTO (solo lectura / NUNCA publica): compara 4-5 formas de meter el
// texto publicitario en el compositor de un grupo de Facebook:
//
//   teclado           -> tipeo char a char (lo que hace hoy group_poster.js)
//   insertText        -> CDP Input.insertText (una sola llamada, sin portapapeles)
//   ctrlv             -> navigator.clipboard.writeText + Ctrl+V (pegado real)
//   ctrlv-contaminado -> igual que ctrlv, pero el portapapeles se pisa a mitad
//                        (simula que el usuario copia otra cosa) para demostrar
//                        el riesgo y probar la deteccion por lectura previa
//   pasteEvent        -> ClipboardEvent sintetico con DataTransfer (sin permisos)
//
// Mide fidelidad (saltos de linea, emojis, longitud) y tiempo, y NUNCA hace
// clic en "Publicar". Al final limpia el compositor y cierra la pestana.
//
// Uso:
//   node scripts/experimento-pegar.mjs
//   DEBUG_PORT=9222 GROUP_URL="https://www.facebook.com/groups/6166833830005702"
// ---------------------------------------------------------------------------

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEBUG_PORT = process.env.DEBUG_PORT || '9222';
const GROUP_URL = process.env.GROUP_URL || 'https://www.facebook.com/groups/6166833830005702';
const DB_PATH = process.env.DB_PATH || join(PROJECT_ROOT, 'backend', 'danimarvis.db');
// sql.js cargado desde el node_modules de la raíz (fuente única de deps).
const SQLJS = pathToFileURL(join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------- textos -----
async function cargarTextos() {
  const initSqlJs = (await import(SQLJS)).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql) => {
    const r = db.exec(sql);
    return r[0] ? r[0].values.map((v) => v[0]) : [];
  };
  const masLargo = q("SELECT variant_text FROM publication_queue WHERE variant_text IS NOT NULL AND variant_text<>'' ORDER BY length(variant_text) DESC LIMIT 1")[0];
  const tipico = q("SELECT variant_text FROM publication_queue WHERE variant_text IS NOT NULL AND variant_text<>'' AND length(variant_text) BETWEEN 700 AND 850 LIMIT 1")[0];
  db.close();
  return { masLargo, tipico };
}

// ------------------------------------------------------------ DOM helpers ---
async function findComposer(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"], div[role="textbox"][contenteditable]')).filter(vis);
    const isComment = (el) => {
      const label = norm(el.getAttribute('aria-label')) + ' ' + norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder'));
      if (/comentas como|comentario|escrib[eí] un coment|respond[eí]|reply|comenta como/.test(label)) return true;
      if (el.closest('[role="article"]') || el.closest('[role="feeditem"]')) return true;
      return false;
    };
    const postCands = cands.filter((el) => !isComment(el));
    const byPh = postCands.filter((el) => {
      const label = norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder')) + ' ' + norm(el.getAttribute('aria-label'));
      return /escrib[eí]|public[aá]|comparte|write something|compartir|algo/.test(label);
    });
    const enDialogo = (el) => !!el.closest('[role="dialog"]');
    const pick = byPh.find(enDialogo) || byPh[0] || postCands.find(enDialogo) || postCands[0] || null;
    if (!pick) return null;
    pick.dataset.pgpComposer = '1';
    pick.scrollIntoView({ block: 'center' });
    const r = pick.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 24) };
  });
}

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

async function cerrarPopups(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(250);
  }
}

async function clearComposer(page, coords) {
  if (coords) await page.mouse.click(coords.x, coords.y);
  await sleep(250);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await sleep(150);
  await page.keyboard.press('Backspace');
  await sleep(350);
}

// ------------------------------------------------------------ medicion ------
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
function contarEmojis(s) { return (String(s || '').match(EMOJI_RE) || []).length; }
function normalizar(s) {
  return String(s || '').replace(/\u00a0/g, ' ').split(/\r\n|\r|\n/).map((x) => x.replace(/\s+$/, '')).join('\n').trim();
}

async function medir(handle, src) {
  const got = await handle.evaluate((el) => {
    let blocks = 0;
    for (const d of el.querySelectorAll('div')) {
      if (Array.from(d.childNodes).some((c) => c.nodeType === 3 || c.nodeName === 'BR')) blocks++;
    }
    // estructura interna: ¿párrafos reales o un nodo de texto con \n literales?
    let nlEnTexto = 0;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) nlEnTexto += (n.nodeValue.match(/\n/g) || []).length;
    const childTags = Array.from(el.children).map((c) => c.tagName).slice(0, 6);
    return {
      inner: el.innerText || '',
      blocks,
      ws: getComputedStyle(el).whiteSpace,
      childTags,
      pCount: el.querySelectorAll('p').length,
      nlEnTexto,
      html: (el.innerHTML || '').slice(0, 160),
    };
  }).catch(() => ({ inner: '', blocks: 0, ws: '?', childTags: [], pCount: -1, nlEnTexto: 0, html: '' }));

  const srcBreaks = (src.match(/\n/g) || []).length;
  const gotBreaks = (got.inner.match(/\n/g) || []).length;
  const srcEmoji = contarEmojis(src);
  const gotEmoji = contarEmojis(got.inner);
  return {
    lenSrc: src.length,
    lenGot: got.inner.length,
    breaksSrc: srcBreaks,
    breaksGot: gotBreaks,
    blocks: got.blocks,
    emojiSrc: srcEmoji,
    emojiGot: gotEmoji,
    exacto: normalizar(got.inner) === normalizar(src),
    vacio: got.inner.trim().length === 0,
    ws: got.ws,
    childTags: got.childTags,
    pCount: got.pCount,
    nlEnTexto: got.nlEnTexto,
    html: got.html,
  };
}

// ------------------------------------------------------------ metodos ------
async function mTeclado(page, handle, coords, text) {
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await handle.focus().catch(() => {});
  await sleep(250);
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay: 12 });
    if (i < lines.length - 1) {
      const open = await page.evaluate(() => {
        for (const el of document.querySelectorAll('[role="listbox"]')) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05) return true;
        }
        return false;
      }).catch(() => false);
      if (open) { await page.keyboard.press('Escape'); await sleep(150); }
      await page.keyboard.press('Enter');
      await sleep(90);
    }
  }
  await sleep(400);
  return { extra: {} };
}

async function mInsertText(page, handle, coords, text) {
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await handle.focus().catch(() => {});
  await sleep(250);
  await page.keyboard.sendCharacter(text);
  await sleep(400);
  return { extra: {} };
}

async function mCtrlV(page, handle, coords, text, contaminar = false) {
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await handle.focus().catch(() => {});
  await sleep(250);
  const escrito = await page.evaluate(async (t) => {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { return 'err:' + e.message; }
  }, text);
  // riesgo de contaminacion: alguien copia otra cosa justo ahora
  if (contaminar) {
    await page.evaluate(async () => { try { await navigator.clipboard.writeText('TEXTO AJENO QUE COPIO EL USUARIO MIENTRAS CORRIA LA CORRIDA'); } catch (e) {} });
  }
  // verificacion previa: leer el portapapeles y comparar antes de pegar.
  // OJO: Windows convierte \n -> \r\n al copiar, hay que normalizar.
  const leido = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'err:' + e.message; } });
  const normCL = (s) => String(s || '').replace(/\r\n/g, '\n');
  const clipboardOk = typeof leido === 'string' && normCL(leido) === normCL(text);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyV');
  await page.keyboard.up('Control');
  await sleep(400);
  return { extra: { clipboardEscrito: escrito === true, clipboardOk, leidoLen: typeof leido === 'string' ? leido.length : -1 } };
}

// Variante: insertText + Enter por linea (crea parrafos reales como el teclado,
// pero inserta cada linea de una sola vez en vez de char a char).
async function mInsertTextLineas(page, handle, coords, text) {
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await handle.focus().catch(() => {});
  await sleep(250);
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.sendCharacter(lines[i]);
    if (i < lines.length - 1) { await page.keyboard.press('Enter'); await sleep(40); }
  }
  await sleep(400);
  return { extra: {} };
}

async function mPasteEvent(page, handle, coords, text) {
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await handle.focus().catch(() => {});
  await sleep(250);
  const ok = await handle.evaluate((el, t) => {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      return el.dispatchEvent(ev);
    } catch (e) { return 'err:' + e.message; }
  }, text);
  await sleep(400);
  return { extra: { dispatch: ok === false ? 'cancelado(ok)' : ok } };
}

// --------------------------------------------------------------- runner -----
async function prepComposer(page) {
  let coords = await findComposer(page);
  if (!coords) {
    const abierto = await hayDialogoCompositor(page);
    if (!abierto) await clickComposerButton(page);
    await sleep(1800);
    coords = await findComposer(page);
  }
  if (!coords) throw new Error('No se encontro el compositor');
  return coords;
}

async function correrMetodo(page, nombre, fn, text) {
  const coords = await prepComposer(page);
  let handle = await page.$('[data-pgp-composer="1"]');
  if (!handle) throw new Error('sin handle de compositor');
  const t0 = Date.now();
  let res;
  try {
    res = await fn(page, handle, coords, text);
  } catch (e) {
    res = { extra: { error: e.message } };
  }
  const ms = Date.now() - t0;
  handle = await page.$('[data-pgp-composer="1"]') || handle;
  const m = await medir(handle, text);
  await clearComposer(page, coords);
  await sleep(300);
  return { metodo: nombre, ms, ...m, ...res.extra };
}

async function main() {
  const { masLargo, tipico } = await cargarTextos();
  const textos = [['tipico', tipico], ['masLargo', masLargo]].filter(([, t]) => t);
  console.log('DEBUG_PORT=%s GROUP_URL=%s', DEBUG_PORT, GROUP_URL);
  for (const [n, t] of textos) console.log('texto %s: %d chars, %d saltos, %d emojis', n, t.length, (t.match(/\n/g) || []).length, contarEmojis(t));

  const browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null, protocolTimeout: 240000 });
  try {
    await browser.defaultBrowserContext().overridePermissions('https://www.facebook.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  } catch (e) { console.log('overridePermissions:', e.message); }

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  try {
    await page.bringToFront().catch(() => {});
    await page.goto(GROUP_URL, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await cerrarPopups(page);
    await prepComposer(page);

    const corridas = [];
    const filtro = (process.env.METH || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const [nombre, texto] of textos) {
      const metodos = [
        ['teclado', (p, h, c, t) => mTeclado(p, h, c, t)],
        ['insertText', (p, h, c, t) => mInsertText(p, h, c, t)],
        ['insertText-lineas', (p, h, c, t) => mInsertTextLineas(p, h, c, t)],
        ['ctrlv', (p, h, c, t) => mCtrlV(p, h, c, t, false)],
        ['ctrlv-contaminado', (p, h, c, t) => mCtrlV(p, h, c, t, true)],
        ['pasteEvent', (p, h, c, t) => mPasteEvent(p, h, c, t)],
      ].filter(([n]) => !filtro.length || filtro.includes(n));
      for (const [nombreMetodo, fn] of metodos) {
        process.stdout.write(`>> ${nombre} / ${nombreMetodo} ... `);
        const r = await correrMetodo(page, `${nombre}:${nombreMetodo}`, fn, texto);
        console.log(JSON.stringify(r));
        corridas.push(r);
      }
    }

    console.log('\n===== RESUMEN =====');
    console.log('metodo'.padEnd(28), 'ms'.padStart(7), 'lenSrc'.padStart(7), 'lenGot'.padStart(7), 'brkS/G'.padStart(8), 'pCnt'.padStart(5), 'nlTxt'.padStart(6), 'emoS/G'.padStart(8), 'exacto', 'ws', 'notas');
    for (const r of corridas) {
      console.log(
        String(r.metodo).padEnd(28),
        String(r.ms).padStart(7),
        String(r.lenSrc).padStart(7),
        String(r.lenGot).padStart(7),
        `${r.breaksSrc}/${r.breaksGot}`.padStart(8),
        String(r.pCount).padStart(5),
        String(r.nlEnTexto).padStart(6),
        `${r.emojiSrc}/${r.emojiGot}`.padStart(8),
        String(r.exacto).padStart(6),
        String(r.ws || ''),
        r.clipboardOk !== undefined ? `clipOk=${r.clipboardOk} leido=${r.leidoLen}` : (r.error ? 'ERR ' + r.error : (r.dispatch || '')),
      );
    }
    console.log('\n--- HTML (primeros 160 chars) por metodo ---');
    for (const r of corridas) console.log(String(r.metodo).padEnd(28), JSON.stringify(r.html));
  } finally {
    try { await clearComposer(page, await findComposer(page)); } catch (e) {}
    await page.close().catch(() => {});
    await browser.disconnect();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FALLO:', e); process.exit(1); });
