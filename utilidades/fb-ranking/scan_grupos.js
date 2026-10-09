/**
 * scan_grupos.js
 * Sondea los grupos de Facebook a los que el usuario está suscrito y escribe
 * un JSON para importarlo con POST /api/groups/import.
 *
 * Por qué no funciona un scrape ingenuo (las dos trampas reales, medidas):
 *
 * 1) El viewport. Con la ventana chica que deja CDP por defecto, el primer
 *    render traía 27 grupos. Con 1600x1000 traía 37. Si no se fija el viewport,
 *    el resultado depende del tamaño de pantalla y parece aleatorio.
 *
 * 2) El scroll NO es el de la ventana. La página tiene muy poco overflow propio
 *    (3993 de alto contra 3393 de ventana) y scrollear window.scrollBy no carga
 *    NADA más: el conteo se queda clavado en 27. La lista vive en un div
 *    scrolleable propio, y es scrollear ESE div lo que trae el resto. Con el
 *    scroll correcto se pasó de 37 a 123 grupos.
 *
 * Uso:  node utilidades/fb-ranking/scan_grupos.js [--out grupos.json] [--dry]
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const URL_JOINS = 'https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added';

const args = process.argv.slice(2);
// Puerto del Chrome de ESTA cuenta: A usa 9222; B usa otro. Por argumento o entorno.
const portArg = args.find(a => a.startsWith('--debug-port='))?.slice('--debug-port='.length);
const DEBUG_PORT = parseInt(portArg || process.env.FB_DEBUG_PORT || '9222', 10) || 9222;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const dry = args.includes('--dry');
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? args[outArg + 1] : path.join(process.cwd(), 'grupos-suscritos.json');

const MAX_PASOS = 60;        // tope de scrolls, por si la página nunca se estanca
const ESPERA_MS = 2200;      // margen para que Facebook cargue el siguiente tranche
const ESTANCOS = 3;          // pasos sin crecer antes de cortar

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Extrae {fbId -> nombre} de los links a grupos que haya en el DOM. */
const recolectar = (page) => page.evaluate(() => {
  const out = new Map();
  for (const a of document.querySelectorAll('a[href*="/groups/"]')) {
    const m = a.href.match(/facebook\.com\/groups\/(\d+)/);
    if (!m) continue;
    const fbId = m[1];
    // El texto del anchor trae el nombre del grupo en la primera línea, pero a
    // veces es "19 mil · Miembros" o un placeholder: se descarta lo que no parezca
    // un nombre de grupo.
    const bruto = (a.innerText || a.getAttribute('aria-label') || '').trim();
    const nombre = bruto.split('\n')[0]
      .replace(/^\s*\d+[.,]?\d*\s*(mil|K)?\s*·?\s*/i, '')
      .trim()
      .slice(0, 90);
    if (!nombre || nombre.length < 3) continue;
    if (/^(grupos|groups|ver más|ver mas|más|miembros)$/i.test(nombre)) continue;
    if (!out.has(fbId)) out.set(fbId, nombre);
  }
  return Object.fromEntries(out);
});

/** Scrollea el div scrolleable que contiene la lista, NO la ventana. */
const bajar = (page) => page.evaluate(() => {
  let target = null;
  for (const e of document.querySelectorAll('div')) {
    const cs = getComputedStyle(e);
    if (!/auto|scroll/.test(cs.overflowY)) continue;
    if (!e.querySelector('a[href*="/groups/"]')) continue;
    if (!target || e.scrollHeight > target.scrollHeight) target = e;
  }
  if (!target) return { ok: false, motivo: 'sin contenedor scrolleable' };
  const antes = target.scrollTop;
  const max = target.scrollHeight - target.clientHeight;
  target.scrollTop = antes + Math.floor(target.clientHeight * 0.8);
  return { ok: true, alFondo: target.scrollTop >= max - 5, total: target.scrollHeight };
});

const browser = await puppeteer.connect({ browserURL: DEBUG_URL });
const page = await browser.newPage();

try {
  // Lección 1: sin esto el scrape devuelve menos y no se sabe por qué.
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(URL_JOINS, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);   // la lista tarda en aparecer; 4 s daba 27 en vez de 37

  const { url } = await page.evaluate(() => ({ url: location.href }));
  if (/login|checkpoint/i.test(url)) {
    console.error('La sesión de Facebook no está activa. Entrá en el perfil del puerto 9222 y volvé a correr.');
    process.exit(1);
  }

  let mapa = await recolectar(page);
  let prev = Object.keys(mapa).length;
  console.log(`render inicial: ${prev} grupos`);

  let estancos = 0;
  for (let i = 1; i <= MAX_PASOS; i++) {
    const r = await bajar(page);
    if (!r.ok) { console.log(`  sin contenedor scrolleable: ${r.motivo}`); break; }
    await sleep(ESPERA_MS);
    mapa = await recolectar(page);
    const ahora = Object.keys(mapa).length;
    const delta = ahora - prev;
    console.log(`  paso ${String(i).padStart(2)}: ${ahora} (+${delta})${r.alFondo ? ' [al fondo]' : ''}`);
    if (delta <= 0) { if (++estancos >= ESTANCOS) { console.log('  se estancó'); break; } }
    else estancos = 0;
    prev = ahora;
  }

  const grupos = Object.entries(mapa).map(([fbId, name]) => ({
    name,
    fb_id: fbId,
    url: `https://www.facebook.com/groups/${fbId}/`,
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  console.log(`\ntotal: ${grupos.length} grupos`);
  if (dry) {
    grupos.slice(0, 25).forEach(g => console.log(`  ${g.name.slice(0, 55).padEnd(57)} ${g.fb_id}`));
    if (grupos.length > 25) console.log(`  ... y ${grupos.length - 25} más`);
    console.log('\n(--dry: no se escribió archivo)');
  } else {
    fs.writeFileSync(OUT, JSON.stringify(grupos, null, 2), 'utf8');
    console.log(`escrito: ${OUT}`);
    console.log(`\nPara importarlos al Planificador:`);
    console.log(`  node -e "fetch('http://localhost:3456/api/groups/import',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer <token>'},body:JSON.stringify({groups:require('./${path.basename(OUT)}')})}).then(r=>r.json()).then(console.log)"`);
  }
} finally {
  await page.close().catch(() => {});
  await browser.disconnect().catch(() => {});
}
