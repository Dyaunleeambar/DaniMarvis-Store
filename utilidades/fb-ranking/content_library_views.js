/**
 * content_library_views.js
 * Lee la Biblioteca de Contenido del Panel Profesional de Facebook (solo lectura),
 * recolecta todas las filas del grid (scroll adaptativo sobre contenedores reales),
 * filtra por fecha de publicación y agrega visualizaciones por grupo de distribución.
 *
 * Uso:
 *   node content_library_views.js [--date 2026-09-15] [--top 50] [--range 90|28|all] [--rounds 300]
 *
 * Precondición: Chrome abierto con --remote-debugging-port=9222 (perfil logueado en FB).
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.facebook.com/professional_dashboard/content/content_library/';
const DEBUG_PORT = 9222;

const args = process.argv.slice(2);
function val(list, flag) { const i = list.indexOf(flag); return i >= 0 ? list[i + 1] : null; }
const TARGET_DATE = (val(args, '--date') || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})());
const TOP = parseInt(val(args, '--top') || '50', 10) || 50;
const RANGE = val(args, '--range') || '90';
const ROUNDS = parseInt(val(args, '--rounds') || '300', 10) || 300;
const NO_NEW_BREAK = 10;

const NOW = new Date();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- parseo numérico ----------
function parseNumber(raw) {
  let s = String(raw || '').replace(/\s+/g, '').trim();
  if (!s || s === '--' || s === '‑‑' || s === '—' || s === '-') return 0;
  let mult = 1;
  const m = s.match(/^(.*?)\s*(mil|k|m|b)?$/i);
  if (m && m[2]) {
    const suf = m[2].toLowerCase();
    if (suf === 'mil' || suf === 'k') mult = 1000;
    else if (suf === 'm') mult = 1000000;
    else if (suf === 'b') mult = 1000000000;
    s = m[1];
  }
  s = s.replace(/[.,]\s*$/g, '');
  let n;
  const match = s.match(/(\d+)[.,](\d+)/);
  if (match && /[.,]/.test(s.replace(/\d+[.,]\d+/, ''))) {
    n = parseFloat(s.replace(/[.,]/g, '')) / Math.pow(10, s.split(/[.,]/).length - 1);
  } else if (match) {
    n = parseFloat(s.replace(/[.,]/g, '.').replace(/(\d)\.(\d{3})/, '$1$2'));
    if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) n = parseFloat(s.replace(',', '.'));
  } else {
    n = parseFloat(s.replace(/[.,]/g, ''));
  }
  if (Number.isNaN(n)) n = 0;
  return Math.round(n * mult);
}

// ---------- click por texto ----------
async function clickText(page, includes, not = []) {
  return page.evaluate((inc, nt) => {
    const norm = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    let best = null;
    const els = document.querySelectorAll('div[role="button"], span[role="button"], button, [role="menuitem"], [role="option"]');
    for (const el of els) {
      if (!visible(el)) continue;
      const text = norm(el.getAttribute('aria-label')) || norm(el.innerText) || '';
      if (!text) continue;
      const hit = inc.every(x => text.includes(x)) && !nt.some(x => text.includes(x));
      if (hit && (!best || (el.innerText || '').length < (best.el.innerText || '').length)) best = { el, text };
    }
    if (!best) return false;
    best.el.click();
    return true;
  }, includes.map(String), not.map(String));
}

// ---------- rango de fechas ----------
async function setRange(page) {
  if (RANGE === '28') return true;
  try {
    const opened = await clickText(page, ['últimos 28 días'], []);
    if (!opened) {
      opened = await clickText(page, ['últimos'], []);
    }
    if (!opened) return false;
    await sleep(1500);
    const opts = await page.evaluate(() => {
      const norm = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], div[role="button"]'))
        .map(e => ({ txt: norm(e.innerText), aria: norm(e.getAttribute('aria-label')) }))
        .filter(o => /últimos|d[ií]as|desde|inicio|historial|total|hoy|ayer|todo|año/.test(o.txt + ' ' + o.aria))
        .slice(0, 40);
    });
    console.log('  Opciones de rango:', opts.map(o => (o.aria || o.txt).slice(0, 40)).join(' | '));
    const target = RANGE === 'all'
      ? ['desde el inicio', 'historial completo', 'historial total', 'todo', 'desde siempre', 'historias'].find(s => opts.some(o => (o.txt + ' ' + o.aria).includes(s)))
      : ['últimos 90 días', 'últimos dos meses', 'últimos 60 días'].find(s => opts.some(o => (o.txt + ' ' + o.aria).includes(s)));
    if (target) {
      const ok = await clickText(page, [target], ['28 días']);
      if (ok) { console.log(`  Rango cambiado a: ${target}`); await sleep(3500); return true; }
    }
    console.log('  No se pudo ampliar el rango; seguimos con el actual.');
  } catch (e) {
    console.log('  (aviso) rango:', e.message);
  }
  return false;
}

// ---------- colección de filas ----------
const C = { 2: 'text', 4: 'views', 8: 'impressions', 10: 'dist' };

async function collectRows(page) {
  const rows = [];
  const seen = new Set();
  let noNew = 0;

  for (let r = 0; r < ROUNDS; r++) {
    const batch = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\u00a0/g, ' ');
      const out = [];
      for (const tr of document.querySelectorAll('tr[role="row"]')) {
        const cells = {};
        let link = '';
        const anchor = tr.querySelector('a[href*="/posts/"]');
        if (anchor) link = (anchor.getAttribute('href') || '').split('?')[0];
        for (const td of tr.querySelectorAll(':scope > td')) {
          const c = td.getAttribute('aria-colindex');
          if (c) cells[c] = clean(td.innerText);
        }
        out.push({ link, text: cells['2'] || '', viewsRaw: cells['4'] || '', imprRaw: cells['8'] || '', dist: cells['10'] || '' });
      }
      return out;
    });

    let added = 0;
    for (const b of batch) {
      const key = b.text + '@' + b.viewsRaw + '@' + b.dist;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, ...b, views: parseNumber(b.viewsRaw), impressions: parseNumber(b.imprRaw) });
      added++;
    }
    if (added > 0) { noNew = 0; } else if (++noNew >= NO_NEW_BREAK) break;

    if (r % 5 === 0) console.log(`  ...paso ${r}: ${rows.length} filas únicas`);

    // 3 barridos por pasada: grid + todos los contenedores con overflow + ventana
    for (let sweep = 0; sweep < 3; sweep++) {
      await page.evaluate(() => {
        const grid = document.querySelector('[role="grid"]');
        if (grid) grid.scrollTop += grid.clientHeight * 0.9;
        let n = 0;
        for (const el of document.querySelectorAll('div')) {
          if (el.scrollHeight > el.clientHeight + 30) { el.scrollTop += el.clientHeight * 0.9; n++; }
          if (n > 100) break;
        }
        window.scrollBy(0, window.innerHeight * 0.9);
      });
      await sleep(350 + Math.random() * 250);
    }
    await sleep(700 + Math.random() * 300);
  }
  return rows;
}

// ---------- grupo + fecha desde el pie del preview ----------
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\u00a0/g, ' ');
const MONTHS = { ene: 0, 'jan': 0, feb: 1, mar: 2, 'abr': 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, 'sep': 8, oct: 9, nov: 10, dic: 11, dec: 11 };

function extractGroupDate(text) {
  const t = (text || "");
  // footer REAL (verificado con dump hoy): "{Grupo} • Hoy a las 11:46"
  // UN solo separador. El grupo es lo que precede al ULTIMO "•"; la fecha lo que sigue.
  const idx = [];
  for (let i = 0; i < t.length; i++) if (t[i] === "•") idx.push(i);
  for (let k = idx.length - 1; k >= 0; k--) {
    const tail = clean(t.slice(idx[k] + 1));
    if (/^(hoy|ayer|hace d+|(?:els+)?d{1,2}(?:s(?:des+)?[a-zñáéíóúñ]+.?(?:sd{4})?)?s*(?:as+las)?s*d{1,2}:d{2}.*)$/i.test(tail)) {
      return { group: clean(t.slice(0, idx[k])).split(/s{2,}/).pop(), tail };
    }
  }
  // sin grupo: solo fecha al final
  const m2 = t.match(/(hoy|ayer|hace d+|(?:els+)?d{1,2}(?:s(?:des+)?[a-zñáéíóúñ]+.?)?s*(?:as+las)?s*d{1,2}:d{2}.*?)$/i);
  if (m2) return { group: "", tail: m2[1].trim() };
  return { group: "", tail: "" };
}

function parseDateEs(tail) {
  const s = tail.toLowerCase();
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  let m;
  if (/^hoy/.test(s)) { if (m = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m[1], +m[2]); }
  else if (/^ayer/.test(s)) { date.setDate(date.getDate() - 1); if (m = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m[1], +m[2]); }
  else if (m = s.match(/^hace (\d+) d/i)) { date.setDate(date.getDate() - (+m[1])); if (m2 = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m2[1], +m2[2]); }
  else if (m = s.match(/(\d{1,2})\s+(?:de\s+)?([a-zñáéíóú]+)\.?(?:\s+(\d{4}))?\s+a las (\d{1,2}):(\d{2})/)) {
    const mon = MONTHS[m[2].slice(0, 3)];
    if (mon !== undefined) {
      const yr = m[3] ? +m[3] : NOW.getFullYear();
      date.setFullYear(yr, mon, +m[1]); date.setHours(+m[4], +m[5]);
    }
  }
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { iso, day: date.getDate(), month: date.getMonth(), ts: date.getTime() };
}

function dateMatches(iso) { return iso === TARGET_DATE; }

// ---------- main ----------
(async () => {
  console.log('==============================================');
  console.log('  Contenido: Top grupos por visualizaciones');
  console.log('==============================================');
  console.log(`  Fecha objetivo: ${TARGET_DATE}`);
  console.log(`  Top: ${TOP} | Rango: ${RANGE} | Rounds: ${ROUNDS}`);

  const browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages[pages.length - 1];
  await page.bringToFront();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(6000);

  if (/login|checkpoint/i.test(page.url())) {
    console.log('!! SESIÓN REQUERIDA: abrí el perfil y logueáte en Facebook.');
    await browser.close();
    process.exit(1);
  }

  console.log('Ajustando rango de fechas...');
  await setRange(page);
  await sleep(2000);

  console.log('Recolectando filas (scroll adaptativo)...');
  const rows = await collectRows(page);
  console.log(`Filas únicas recolectadas: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No se encontraron filas. Revisá la página manualmente.');
    await browser.close();
    return;
  }

  // enriquecer filas con grupo + fecha
  for (const row of rows) {
    const { group, tail } = extractGroupDate(row.text);
    row.group = group || row.dist.replace(/-{1,2}/g, '').trim() || '(sin distribución)';
    row.dateRaw = tail;
    const p = parseDateEs(tail);
    row.iso = p.iso;
    row.ts = p.ts;
  }

  const targetRows = rows.filter(r => dateMatches(r.iso));
  console.log(`\nPosts del ${TARGET_DATE}: ${targetRows.length}`);

  // ver ventana de fechas disponible (debug)
  const byDate = new Map();
  for (const r of rows) byDate.set(r.iso, (byDate.get(r.iso) || 0) + 1);
  console.log('Distribución por fecha (muestra):', [...byDate.entries()].sort().slice(-8).map(([d, n]) => `${d}:${n}`).join(' '));

  if (targetRows.length === 0) {
    console.log('No hay posts de esa fecha: seguro que el rango cubre el día? Revisá el rango o aumentá --rounds.');
    fs.writeFileSync(path.join(__dirname, 'reporte_1509.json'), JSON.stringify({ error: 'no_rows', collected_posts: rows.length, byDate: Object.fromEntries(byDate) }, null, 2));
    await browser.close();
    return;
  }

  // agregación por grupo
  const agg = new Map();
  for (const r of targetRows) {
    const g = agg.get(r.group) || { group: r.group, posts: 0, views: 0, impressions: 0, max: 0, maxPost: null };
    g.posts++;
    g.views += r.views;
    g.impressions += r.impressions;
    if (r.views > g.max) { g.max = r.views; g.maxPost = r; }
    agg.set(r.group, g);
  }
  const groups = [...agg.values()].sort((a, b) => b.views - a.views);

  const report = {
    fecha: TARGET_DATE,
    generado: new Date().toISOString(),
    total_posts_fecha: targetRows.length,
    grupos: groups,
    top: groups.slice(0, TOP),
    posts: targetRows.map(r => ({ grupo: r.group, fecha: r.dateRaw, vistas: r.views, impresiones: r.impressions, texto: r.text.slice(0, 120), url: r.link })),
  };
  fs.writeFileSync(path.join(__dirname, 'reporte_1509.json'), JSON.stringify(report, null, 2));

  const totalViews = groups.reduce((a, g) => a + g.views, 0);
  console.log(`\n=== TOP ${Math.min(TOP, groups.length)} GRUPOS POR VISUALIZACIONES (${TARGET_DATE}) ===`);
  console.log(`Total posts: ${targetRows.length} | Vistas totales: ${totalViews.toLocaleString('es-ES')}`);
  console.log(`${'#'.padStart(3)} ${'Grupo'.padEnd(46)} ${'Posts'.padStart(5)} ${'Vistas'.padStart(9)} ${'Impres.'.padStart(9)} ${'Prom/Post'.padStart(9)} ${'Máx'.padStart(8)}`);
  groups.slice(0, TOP).forEach((g, i) => {
    const avg = g.posts ? Math.round(g.views / g.posts) : 0;
    const maxTxt = g.maxPost ? g.max.toLocaleString('es-ES') : '-';
    console.log(`${String(i + 1).padStart(3)} ${g.group.slice(0, 44).padEnd(46)} ${String(g.posts).padStart(5)} ${g.views.toLocaleString('es-ES').padStart(9)} ${g.impressions.toLocaleString('es-ES').padStart(9)} ${String(avg).padStart(9)} ${maxTxt.padStart(8)}`);
  });

  console.log(`\nReporte completo guardado en: reporte_1509.json`);
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });