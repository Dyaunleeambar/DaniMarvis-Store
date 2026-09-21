/**
 * Analyzer de la Biblioteca de Contenido profesional de Facebook.
 * Lee (SOLO LECTURA) qué grupos/publicaciones generan más visualizaciones.
 * Usa la misma técnica que leave_groups.js: Chrome abierto con --remote-debugging-port.
 *
 * Uso:
 *   1. Abrir Chrome con el perfil de depuración (fb-debug-profile), sesión iniciada
 *   2. node analyze_views.js [--range 90|all|28]
 *        --range 90  intenta cambiar el rango a "Últimos 90 días" (default)
 *        --range all intenta "Desde el inicio"
 *        --range 28  mantiene los últimos 28 días
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.facebook.com/professional_dashboard/content/content_library/';
const DEBUG_PORT = 9222;
const ROUNDS = 250;
const SCROLL_STEP = 0.9;
const args = process.argv.slice(2);

function val(list, flag) {
  const i = list.indexOf(flag);
  return i >= 0 ? list[i + 1] : null;
}
const RANGE = val(args, '--range') || '90';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseNumber(raw) {
  let s = String(raw || '').replace(/\s+/g, '').trim();
  if (!s || s === '--' || s === '‑‑' || s === '—') return 0;
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
  // separador decimal: si hay coma o punto, el último es decimal
  let match = s.match(/(\d+)[.,](\d+)/);
  let n;
  if (match && /[.,]/.test(s.replace(/\d+[.,]\d+/, ''))) {
    // múltiples separadores → miles + decimal
    const num = s.replace(/[.,]/g, '');
    n = parseFloat(num) / Math.pow(10, s.split(/[.,]/).length - 1);
  } else if (match) {
    n = parseFloat(s.replace(/[.,]/g, '.').replace(/(\d)\.(\d{3})/, '$1$2'));
    if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) n = parseFloat(s.replace(',', '.'));
  } else {
    n = parseFloat(s.replace(/[.,]/g, ''));
  }
  if (Number.isNaN(n)) n = 0;
  return Math.round(n * mult);
}

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
    const els = document.querySelectorAll('div[role="button"], span[role="button"], button, a, [role="menuitem"], [role="option"]');
    for (const el of els) {
      if (!visible(el)) continue;
      const text = norm(el.getAttribute('aria-label')) || norm(el.innerText) || '';
      if (!text) continue;
      const hit = inc.every(x => text.includes(x)) && !nt.some(x => text.includes(x));
      if (!hit) continue;
      if (!best || (el.innerText || '').length < (best.el.innerText || '').length) best = { el, text };
    }
    if (!best) return false;
    best.el.click();
    return true;
  }, includes.map(String), not.map(String));
}

async function applyRange(page) {
  if (RANGE === '28') return;
  try {
    const opened = await clickText(page, ['últimos 28 días'], []);
    if (!opened) return;
    await sleep(1500);
    const opts = await page.evaluate(() => {
      const norm = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], div[role="button"], span[role="button"]'))
        .map(e => norm(e.innerText))
        .filter(t => /d[ií]as|desde|inicio|historial|total|año|hoy|ayer/.test(t))
        .slice(0, 30);
    });
    console.log('Opciones de rango detectadas:', opts.join(' | '));
    const target = RANGE === 'all'
      ? ['desde el inicio', 'historial completo', 'total', 'todo', 'desde siempre'].find(s => opts.some(o => o.includes(s)))
      : ['últimos 90 días', 'últimos dos meses', 'últimos 60 días'].find(s => opts.some(o => o.includes(s)));
    if (target) {
      const ok = await clickText(page, [target], ['28 días']);
      if (ok) {
        console.log(`Rango cambiado a: ${target}`);
        await sleep(3000);
      }
    } else {
      console.log('No se pudo ampliar el rango; seguimos con el actual.');
    }
  } catch (e) {
    console.log('(aviso) no se pudo cambiar rango:', e.message);
  }
}

const COL_METRIC = {
  '4': 'visualizaciones',
  '5': 'espectadores',
  '6': 'interaccion',
  '7': 'seguidores',
  '8': 'impresiones',
  '9': 'comentarios',
};

async function collectRows(page) {
  const found = [];
  const seen = new Set();
  let roundsWithoutNew = 0;

  for (let r = 0; r < ROUNDS; r++) {
    const rows = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\u00a0/g, ' ');
      const out = [];
      for (const tr of document.querySelectorAll('tr[role="row"]')) {
        const byCol = {};
        for (const td of tr.querySelectorAll(':scope > td')) {
          const c = td.getAttribute('aria-colindex');
          if (c) byCol[c] = clean(td.innerText);
        }
        const postCell = byCol['2'] || '';
        const lines = postCell.split('\n').map(l => l.trim().replace(/\u00a0/g, ' ')).filter(Boolean);
        let label = '';
        let date = '';
        if (lines.length >= 2 && lines[lines.length - 2].endsWith('•')) {
          label = lines[lines.length - 2].replace(/•\s*$/, '').trim();
          date = lines[lines.length - 1];
        } else if (lines.length >= 2) {
          date = lines[lines.length - 1];
        }
        out.push({
          id: postCell,
          label,
          date,
          post: lines.slice(0, Math.max(0, lines.length - (label ? 2 : 1))).join(' ').slice(0, 90),
          m: {
            visualizaciones: (byCol['4'] || '0'),
            espectadores: (byCol['5'] || '0'),
            interaccion: (byCol['6'] || '0'),
            seguidores: (byCol['7'] || '0'),
            impresiones: (byCol['8'] || '0'),
            comentarios: (byCol['9'] || '0'),
          },
        });
      }
      return out;
    });

    let newCount = 0;
    for (const row of rows) {
      if (!row.id) continue;
      const key = row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      row.uniqueKey = key;
      row.m = Object.fromEntries(Object.entries(row.m).map(([k, v]) => [k, parseNumber(v)]));
      found.push(row);
      newCount++;
    }

    if (newCount === 0) {
      if (++roundsWithoutNew >= 6) break;
    } else {
      roundsWithoutNew = 0;
    }
    if (found.length > 0 && r % 4 === 0) {
      console.log(`  ...${found.length} filas únicas hasta ahora (paso ${r})`);
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await page.evaluate(() => {
      const grid = document.querySelector('[role="grid"]');
      if (grid) grid.scrollTop += grid.clientHeight * 0.9;
    });
    await sleep(1100 + Math.random() * 300);
  }
  return found;
}

(async () => {
  console.log('========================================');
  console.log('  Analyzer de visualizaciones por grupo');
  console.log('========================================');
  console.log(`  Conectando a Chrome en puerto ${DEBUG_PORT}...`);
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages[pages.length - 1];
  await page.bringToFront();

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(5000);

  if (/login|checkpoint|confirm/i.test(page.url())) {
    console.log('!! Sesión requerida. Abrí el perfil y logueáte.');
    await browser.close();
    return;
  }
  console.log(`URL: ${page.url()}`);

  await applyRange(page);
  await sleep(2000);

  console.log('Recolectando filas (scroll automático)...');
  const rows = await collectRows(page);
  console.log(`Filas únicas recolectadas: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No se encontraron filas. Revisá la página manualmente.');
    await browser.close();
    return;
  }

  // Agregación por etiqueta de distribución
  const agg = new Map();
  const CROSS = 'Publicación cruzada';
  for (const row of rows) {
    const label = row.label || '(sin etiqueta)';
    const a = agg.get(label) || { label, posts: 0, visualizaciones: 0, espectadores: 0, impresiones: 0, interaccion: 0, comentarios: 0, max: 0, maxRow: null };
    a.posts++;
    for (const k of ['visualizaciones', 'espectadores', 'impresiones', 'interaccion', 'comentarios']) a[k] += row.m[k] || 0;
    if (row.m.visualizaciones > a.max) { a.max = row.m.visualizaciones; a.maxRow = row; }
    agg.set(label, a);
  }

  const groups = [...agg.values()]
    .filter(a => a.label && a.label !== CROSS)
    .sort((a, b) => b.visualizaciones - a.visualizaciones);
  const cross = agg.get(CROSS);

  const report = {
    generated: new Date().toISOString(),
    range: RANGE,
    url: URL,
    total_posts: rows.length,
    grupos: groups,
    publicacion_cruzada: cross || null,
    top_publicaciones: [...rows].sort((a, b) => b.m.visualizaciones - a.m.visualizaciones).slice(0, 25),
  };
  const reportPath = path.join(__dirname, 'views_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReporte guardado en: ${reportPath}`);

  const fmt = (n) => n.toLocaleString('es-ES');
  console.log('\n=== VISUALIZACIONES POR GRUPO (últimas publicaciones) ===');
  console.log(`${'Grupo'.padEnd(48)} Publ.   Vistas      Impresiones  Promedio/Post   Máx`);
  for (const g of groups.slice(0, 30)) {
    const avg = g.posts ? Math.round(g.visualizaciones / g.posts) : 0;
    const maxTxt = g.maxRow ? `${fmt(g.max)} (${g.maxRow.date || ''})` : '-';
    console.log(
      `${g.label.slice(0, 46).padEnd(48)} ${String(g.posts).padEnd(5)} ${fmt(g.visualizaciones).padStart(9)} ${fmt(g.impresiones).padStart(10)}   ${String(avg).padStart(13)}   ${maxTxt}`
    );
  }
  if (cross) {
    console.log(`\nPublicación cruzada (perfil): ${cross.posts} posts, ${fmt(cross.visualizaciones)} vistas, ${fmt(cross.impresiones)} impresiones`);
  }

  console.log('\n=== TOP 15 PUBLICACIONES POR VISUALIZACIONES ===');
  for (const [i, p] of report.top_publicaciones.slice(0, 15).entries()) {
    console.log(`${String(i + 1).padStart(2)}. [${p.label || '?'}] ${fmt(p.m.visualizaciones).padStart(7)} vistas | ${p.date || ''} | ${String(p.post).slice(0, 70)}`);
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });