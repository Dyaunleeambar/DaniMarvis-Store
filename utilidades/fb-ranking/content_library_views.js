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
function val(list, flag) {
  const exact = list.indexOf(flag);
  if (exact >= 0) return list[exact + 1] ?? null;
  const inline = list.find(a => a.startsWith(flag + '='));
  return inline ? inline.slice(flag.length + 1) : null;
}
const TARGET_DATE = (val(args, '--date') || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})());
const DESDE = val(args, '--desde');
const HASTA = val(args, '--hasta');
const TOP = parseInt(val(args, '--top') || '50', 10) || 50;
const RANGE = val(args, '--range') || '90';
const ROUNDS = parseInt(val(args, '--rounds') || '300', 10) || 300;
const NO_NEW_BREAK = 16;
const PIN_DATE = !!val(args, '--pin-date');

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
    let opened = await clickText(page, ['últimos 28 días'], []);
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

// Amplía el rango a 90 días ASEGURÁNDOSE de que realmente se aplicó: FB a veces
// responde "Rango cambiado" sin cambiar nada y la tabla queda con 1-2 días
// (scrolpeak cortísimo) → los posts viejos JAMÁS cargan. Con la altura real
// scrolleable de la tabla detectamos si el rango amplio tomó efecto y reintentamos.
async function ensureRange(page, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await setRange(page);
    const depth = await page.evaluate(() => {
      const t = document.querySelector('table[role="grid"], [role="grid"]');
      if (!t) return 0;
      return (t.scrollHeight || 0) - (t.clientHeight || 0);
    }).catch(() => 0);
    if (depth >= 2000) { console.log(`  Rango verificado: ${depth}px scrolleables.`); return true; }
    console.log(`  (aviso) rango no aplicado aún: ${depth}px scrolleables (intento ${i + 1}/${attempts}), reintento...`);
    await sleep(2500);
  }
  return false;
}

// ---------- seleccionar UN día exacto en la Biblioteca ----------
// FB solo permite el día específico por "Personalizado"; abro el menú, elijo
// Personalizado y relleno ambos extremos con TARGET_DATE (fecha ∈ único día).
// Los fallos no bloquean la corrida: se sigue con el rango actual.
async function setTargetDate(page) {
  const open = async () => {
    let ok = await clickText(page, ['últimos'], ['exportar']);
    if (!ok) ok = await clickText(page, ['rango'], []);
    await sleep(1500);
    let cust = await clickText(page, ['personalizado'], []);
    if (!cust) {
      cust = await page.evaluate(() => {
        const norm = (s) => (s || '').toLowerCase();
        for (const el of document.querySelectorAll('[role="menuitem"], [role="option"], div[role="button"]')) {
          const t = norm(el.innerText) || norm(el.getAttribute('aria-label'));
          if (t && t.indexOf('personalizado') === 0) { el.click(); return true; }
        }
        return false;
      });
    }
    return cust;
  };
  try {
    if (!(await open())) { console.log('  (aviso) no se pudo abrir Personalizado.'); return false; }
    await sleep(2500);
    const filled = await page.evaluate((dt) => {
      const inputs = [];
      for (const el of document.querySelectorAll('input')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const t = (el.type || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (t === 'date' || aria.includes('fecha') || aria.includes('date')) inputs.push(el);
      }
      const setVal = (el, v) => {
        let d = Object.getOwnPropertyDescriptor(window.HTMLInputElement && el.constructor && el.constructor.prototype, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (d && d.set) d.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      let n = 0;
      if (inputs.length >= 2) { setVal(inputs[0], dt); setVal(inputs[1], dt); n = 2; }
      else if (inputs.length === 1) { setVal(inputs[0], dt); n = 1; }
      return { count: n, found: inputs.length, types: inputs.map(i => i.type) };
    }, TARGET_DATE);
    console.log('  Fechas Personalizado rellenadas:', JSON.stringify(filled));
    if (!filled.count) { console.log('  (aviso) no aparecieron inputs de fecha; seguimos con el rango actual.'); return false; }
    await sleep(400);
    await clickText(page, ['aplicar'], []);
    await sleep(4000);
    return true;
  } catch (e) {
    console.log('  (aviso) personalizado:', e.message);
    return false;
  }
}

// ---------- colección de filas ----------
const C = { 2: 'text', 4: 'views', 8: 'impressions', 10: 'dist' };

function wheelSafe(mouse, deltaY) {
  // FB solo responde a eventos REALES de rueda sobre la tabla. El dispatch por
  // CDP a veces se cuelga: cap de 6s para no estancar el proceso.
  return Promise.race([
    mouse.wheel({ deltaY }).then(() => true).catch(() => false),
    sleep(6000).then(() => false),
  ]);
}

async function findSpot(page) {
  try {
    return await page.evaluate(() => {
      for (const el of document.querySelectorAll('[role="grid"], div[role="table"], div')) {
        const r = el.getBoundingClientRect();
        if (r.width > 500 && r.height > 250 && r.bottom < window.innerHeight + 50) {
          return { x: r.left + r.width / 2, y: r.top + Math.min(r.height * 0.55, 380) };
        }
      }
      return { x: window.innerWidth / 2, y: 260 };
    });
  } catch (_) {
    return { x: 700, y: 300 };
  }
}

async function collectRows(page, mouse) {
  const rows = [];
  const seen = new Set();
  let noNew = 0;
  const recent = [];

  let spot = await findSpot(page);
  await mouse.move(spot.x, spot.y);

  for (let r = 0; r < ROUNDS; r++) {
    const batch = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\u00a0/g, ' ');
      const out = [];
      for (const tr of document.querySelectorAll('tr[role="row"]')) {
        const cells = {};
        let rawText = '';
        let link = '';
        const anchor = tr.querySelector('a[href*="/posts/"]');
        if (anchor) link = (anchor.getAttribute('href') || '').split('?')[0];
        for (const td of tr.querySelectorAll(':scope > td')) {
          const c = td.getAttribute('aria-colindex');
          if (c) cells[c] = clean(td.innerText);
          if (c === '2') rawText = td.innerText;
        }
        // filas fantasma (placeholder del grid virtualizado) sin contenido ni enlace
        if (!cells['2'] && !link) continue;
        out.push({
          link,
          text: cells['2'] || '',
          rawText,
          viewsRaw: cells['4'] || '',
          imprRaw: cells['8'] || '',
          dist: cells['10'] || '',
        });
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

    // un flick de rueda por pasada; si no produce filas nuevas, insistir con
    // recentrado (el hover de FB puede perderse y la rueda cae en el fondo).
    const t0 = Date.now();
    const ok = await wheelSafe(mouse, 380 + Math.random() * 160);
    recent.push(ok); if (recent.length > 8) recent.shift();
    await sleep(550 + Math.random() * 250);
    const rate = recent.filter(Boolean).length / recent.length;

    if (added === 0) {
      // empujón DOM como respaldo: el grid virtualizado avanza aunque la rueda
      // haya aterrizado en el fondo de la página. El contenedor real se detecta
      // ascendiendo desde las filas (el [role=grid] no suele ser el que scrollea).
      await page.evaluate(() => {
        let el = document.querySelector('tr[role="row"]');
        while (el) {
          const cs = getComputedStyle(el);
          if (el.scrollHeight > el.clientHeight + 50 && /(auto|scroll)/.test(cs.overflowY)) break;
          el = el.parentElement;
        }
        const sc = el || document.scrollingElement;
        sc.scrollTop = Math.min(sc.scrollTop + Math.max(sc.clientHeight * 0.85, 700), sc.scrollHeight);
      }).catch(() => {});
      await sleep(450);
      spot = await findSpot(page);
      await mouse.move(spot.x, spot.y).catch(() => {});
    }

    if (added > 0) { noNew = 0; }
    else if (ok) { if (++noNew >= NO_NEW_BREAK) break; }
    // sin filas nuevas PERO la rueda falló seguido: probable hover perdido
    else if (recent.length >= 4 && rate < 0.35) {
      spot = await findSpot(page);
      await mouse.move(spot.x, spot.y);
      await sleep(500);
    }

    // re-centrado periódico por seguridad
    if (r > 0 && r % 12 === 0 && rate < 0.8) {
      spot = await findSpot(page);
      await mouse.move(spot.x, spot.y);
    }

    // ruedas muertas (8 fallos seguidos) o tiempo total agotado: terminar
    if (recent.length === 8 && rate === 0) break;
    if (Date.now() - t0 > 260000) break;

    if (r % 5 === 0) console.log(`  ...paso ${r}: ${rows.length} filas únicas (wheelOk=${recent.reduce((a, b) => a + (b ? 1 : 0), 0)}/${recent.length})`);
  }
  return rows;
}

// ---------- grupo + fecha desde el pie del preview ----------
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\u00a0/g, ' ');
const MONTHS = { ene: 0, 'jan': 0, feb: 1, mar: 2, 'abr': 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, 'sep': 8, oct: 9, nov: 10, dic: 11, dec: 11 };

function isDateTail(tail) {
  const s = clean(tail).toLowerCase();
  // "hoy", "hoy a las 8:24", "ayer", "ayer a las 20:00"
  if (/^(hoy|ayer)( a las \d{1,2}:\d{2})?$/.test(s)) return true;
  // "hace 5 d"
  if (/^hace \d+ d$/.test(s)) return true;
  // "15 sep", "15 sep a las 8:24", "el 15 de septiembre a las ...", "15/9"
  if (/^(el\s+)?\d{1,2}(\/\d{1,2})?(\s+de\s+|\s+)?[a-zñáéíóúñ]+\.?(\s+\d{4})?(\s+a las \d{1,2}:\d{2})?$/.test(s)) return true;
  return false;
}

function extractGroupDate(text) {
  const t = (text || "");
  // Estructura real del footer (verificado en vivo): el grupo viene en una LÍNEA
  // previa terminada en "•", y la fecha en la línea siguiente:
  //   "... #EnvíoGratis"
  //   "VARADERO Vende •"
  //   "Hoy a las 20:33"
  const lines = t.split(/\r?\n/).map(l => clean(l)).filter(Boolean);
  for (let i = lines.length - 1; i >= 1; i--) {
    const prev = lines[i - 1];
    if (/\u2022\s*$/.test(prev) && isDateTail(lines[i])) {
      return { group: prev.replace(/\u2022\s*$/, '').trim().split(/\s{2,}/).pop() || prev.replace(/\u2022\s*$/, '').trim(), tail: lines[i] };
    }
  }
  // fallback: "•" dentro de una línea única (último "•"); la fecha lo que sigue
  for (let k = lines.length - 1; k >= 0; k--) {
    const line = lines[k];
    const m = line.match(/^(.*)\s*\u2022\s*([^•\n]+)$/);
    if (m && isDateTail(m[2])) {
      const g = m[1].trim();
      return { group: g.split(/\s{2,}/).pop() || g, tail: clean(m[2]) };
    }
  }
  // sin grupo: solo fecha al final
  for (let k = lines.length - 1; k >= 0; k--) {
    if (isDateTail(lines[k])) return { group: '', tail: lines[k] };
  }
  return { group: '', tail: '' };
}

function parseDateEs(tail) {
  const s = tail.toLowerCase();
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  let m;
  if (/^hoy/.test(s)) { if (m = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m[1], +m[2]); }
  else if (/^ayer/.test(s)) { date.setDate(date.getDate() - 1); if (m = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m[1], +m[2]); }
  else if (m = s.match(/^hace (\d+) d/i)) { date.setDate(date.getDate() - (+m[1])); if (m2 = s.match(/a las (\d{1,2}):(\d{2})/)) date.setHours(+m2[1], +m2[2]); }
  else if (m = s.match(/(\d{1,2})\s+(?:de\s+)?([a-zñáéíóú]+)\.?(?:\s+(\d{4}))?(?:\s*a las\s+(\d{1,2}):(\d{2}))?/)) {
    const mon = MONTHS[m[2].slice(0, 3)];
    if (mon !== undefined) {
      const yr = m[3] ? +m[3] : NOW.getFullYear();
      date.setFullYear(yr, mon, +m[1]);
      if (m[4] && m[5]) date.setHours(+m[4], +m[5]);
    }
  }
  // Fechas de mes sin hora ("22 sep", "12 ago.") y años corriente: si la fecha
  // calculada queda en el futuro (caso "15 dic" con hoy = septiembre) es del
  // año anterior.
  if (date.getTime() > NOW.getTime() + 86400000) date.setFullYear(date.getFullYear() - 1);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { iso, day: date.getDate(), month: date.getMonth(), ts: date.getTime() };
}

function dateMatches(iso) {
  if (DESDE && HASTA) return iso >= DESDE && iso <= HASTA;
  if (DESDE) return iso >= DESDE;
  if (HASTA) return iso <= HASTA;
  return iso === TARGET_DATE;
}

// ---------- main ----------
(async () => {
  console.log('==============================================');
  console.log('  Contenido: Top grupos por visualizaciones');
  console.log('==============================================');
  console.log(`  Fecha objetivo: ${TARGET_DATE}`);
  console.log(`  Top: ${TOP} | Rango: ${RANGE} | Rounds: ${ROUNDS}`);

  const browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null, protocolTimeout: 240000 });
  // pestaña nueva dedicada: renderer limpio (el DOM pesado de otras pestañas
  // degrada el dispatch de rueda por CDP) y no molesto la que tiene el usuario.
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000 });
  const mouse = page.mouse;
  await page.bringToFront();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(6000);

  if (/login|checkpoint/i.test(page.url())) {
    console.log('!! SESIÓN REQUERIDA: abrí el perfil y logueáte en Facebook.');
    await page.close().catch(() => {});
    await browser.disconnect();
    process.exit(1);
  }

console.log('Ajustando rango de fechas...');
    await ensureRange(page);
    await sleep(2000);
    // IMPORTANTE: fijar el día con "Personalizado" colapsa las filas de
    // DESTINO (una por grupo, "Grupo • fecha") a UNA fila por post con pie de
    // formato ("Publicación cruzada • / Publicada •") → el ranking degenera a
    // 2 grupos. Por defecto NO tocamos el filtro en la UI: las filas de destino
    // quedan completas y el día se filtra luego por el pie de cada fila
    // (dateMatches). Solo se pincha en la UI si se pide explícito (--pin-date=1).
    if (TARGET_DATE && !DESDE && !HASTA && PIN_DATE) {
      console.log('Intentando enfocar el día objetivo (Personalizado)...');
      await setTargetDate(page);
    }

  console.log('Recolectando filas (wheel sobre el grid)...');
  const rows = await collectRows(page, mouse);
  console.log(`Filas únicas recolectadas: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No se encontraron filas. Revisá la página manualmente.');
    await page.close().catch(() => {});
    await browser.disconnect();
    return;
  }

  // enriquecer filas con grupo + fecha
  for (const row of rows) {
    const { group, tail } = extractGroupDate(row.rawText || row.text);
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
    fs.writeFileSync(path.join(__dirname, 'reporte_POC_fechas.json'), JSON.stringify({ error: 'no_rows', collected_posts: rows.length, byDate: Object.fromEntries(byDate) }, null, 2));
    await page.close().catch(() => {});
    await browser.disconnect();
    return;
  }

  // agregación por grupo
  const agg = new Map();
  for (const r of targetRows) {
    const g = agg.get(r.group) || { group: r.group, posts: 0, views: 0, impressions: 0, max: 0, maxPost: null, fechas: [] };
    g.posts++;
    g.views += r.views;
    g.impressions += r.impressions;
    if (r.views > g.max) { g.max = r.views; g.maxPost = r; }
    if (r.iso) g.fechas.push(r.iso);
    agg.set(r.group, g);
  }
  const groups = [...agg.values()].sort((a, b) => b.views - a.views).map(g => ({
    ...g,
    promedio: g.posts ? Math.round(g.views / g.posts) : 0,
    ultima_fecha: g.fechas.sort().pop() || '',
  }));

  const snapshotFecha = (TARGET_DATE && !DESDE && !HASTA) ? TARGET_DATE : '';

  const report = {
    fecha: snapshotFecha,
    generado: new Date().toISOString(),
    total_posts_fecha: targetRows.length,
    grupos: groups.map(({ fechas, maxPost, ...g }) => g),
    top: groups.slice(0, TOP).map(({ fechas, maxPost, ...g }) => g),
    posts: targetRows.map(r => ({ grupo: r.group, fecha_iso: r.iso, fecha: r.dateRaw, vistas: r.views, impresiones: r.impressions, texto: r.text.slice(0, 120), url: r.link })),
  };
  fs.writeFileSync(path.join(__dirname, 'reporte_POC_fechas.json'), JSON.stringify(report, null, 2));

  const totalViews = groups.reduce((a, g) => a + g.views, 0);
  console.log(`\n=== TOP ${Math.min(TOP, groups.length)} GRUPOS POR VISUALIZACIONES (${TARGET_DATE}) ===`);
  console.log(`Total posts: ${targetRows.length} | Vistas totales: ${totalViews.toLocaleString('es-ES')}`);
  console.log(`${'#'.padStart(3)} ${'Grupo'.padEnd(46)} ${'Posts'.padStart(5)} ${'Vistas'.padStart(9)} ${'Impres.'.padStart(9)} ${'Prom/Post'.padStart(9)} ${'Máx'.padStart(8)}`);
  groups.slice(0, TOP).forEach((g, i) => {
    const avg = g.posts ? Math.round(g.views / g.posts) : 0;
    const maxTxt = g.maxPost ? g.max.toLocaleString('es-ES') : '-';
    console.log(`${String(i + 1).padStart(3)} ${g.group.slice(0, 44).padEnd(46)} ${String(g.posts).padStart(5)} ${g.views.toLocaleString('es-ES').padStart(9)} ${g.impressions.toLocaleString('es-ES').padStart(9)} ${String(avg).padStart(9)} ${maxTxt.padStart(8)}`);
  });

  console.log(`\nReporte completo guardado en: reporte_POC_fechas.json`);
  await page.close().catch(() => {});
  await browser.disconnect();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });