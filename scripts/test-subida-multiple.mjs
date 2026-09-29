// Prueba real de la subida multiple en navegador, con Chrome de verdad.
// Genera un token contra la misma BD que usa el server y entra por sessionStorage
// en vez de pasar por el formulario de login.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import puppeteer from 'puppeteer-core';

// OJO: NO se usa initDB() de database.js. Cada run() que ejecuta llama a
// saveDB(), o sea que abrir la BD desde acá reescribiria el archivo mientras el
// server la tiene en memoria, y perderiamos lo que el server todavia no
// guardo. Se lee el archivo crudo, solo lectura.
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const dbFile = path.resolve('backend/danimarvis.db');
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbFile));
const secret = db.exec("SELECT auth_secret FROM settings WHERE id = 1")[0]?.values[0]?.[0];
db.close();
if (!secret) { console.log('FALTA no se pudo leer el auth_secret'); process.exit(1); }

const body = Buffer.from(JSON.stringify({ u: 'prueba-multimedia', exp: Date.now() + 900000 })).toString('base64url');
const sig = createHash('sha256').update(`${body}.${secret}`).digest('base64url');
const token = `${body}.${sig}`;

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

const errores = [];
page.on('pageerror', e => errores.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  // El test 4 aborta un upload a proposito y el navegador lo reporta como
  // ERR_FAILED. Contarlo seria marcar como bug algo que se provoco.
  if (/ERR_FAILED|net::ERR_/.test(m.text())) return;
  errores.push('console: ' + m.text());
});

await page.goto('http://localhost:3456/#/login', { waitUntil: 'networkidle2' });
await page.evaluate(t => {
  sessionStorage.setItem('dm_token', t);
  sessionStorage.setItem('dm_user', JSON.stringify({ username: 'prueba' }));
}, token);
await page.goto('http://localhost:3456/#/publications', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1500));

// El boton del Planificador abre el modal.
const abrio = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => /planificador/i.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
});
if (!abrio) { console.log('FALTA no se encontró el botón del Planificador'); await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 800));

const tieneMultiple = await page.$eval('#plan-file', el => el.multiple);
console.log(`  ${tieneMultiple ? 'OK ' : 'FALTA'} input con atributo multiple`);

const medir = async () => page.evaluate(() => ({
  thumbs: document.querySelectorAll('#plan-thumbs .img-thumb').length,
  label: document.getElementById('plan-file-label')?.textContent || '',
  toast: document.querySelector('.toast, .toast-msg, [class*=toast]')?.textContent?.trim() || '',
}));

const subir = async (paths) => {
  const input = await page.$('#plan-file');
  await input.uploadFile(...paths);
  // espera a que el label vuelva al texto normal (= se termino el lote)
  await page.waitForFunction(
    () => !/Subiendo/.test(document.getElementById('plan-file-label')?.textContent || ''),
    { timeout: 30000 },
  );
  await new Promise(r => setTimeout(r, 400));
};

// ── 1) cinco imagenes de una vez ──
console.log('\n1) subir 5 imagenes en una sola seleccion');
await subir(['tmp-test/p1.png', 'tmp-test/p2.png', 'tmp-test/p3.png', 'tmp-test/p4.png', 'tmp-test/p5.png']);
let m = await medir();
console.log(`  ${m.thumbs === 5 ? 'OK ' : 'FALTA'} 5 miniaturas (hay ${m.thumbs})`);
console.log(`  ${/5 imagenes subidas|5 imagenes/.test(m.toast) ? 'OK ' : 'FALTA'} aviso: "${m.toast}"`);

// ── 2) el maximo ──
console.log('\n2) intentar pasarse del maximo de 10');
await subir(['tmp-test/p6.png', 'tmp-test/p1.png', 'tmp-test/p2.png', 'tmp-test/p3.png',
             'tmp-test/p4.png', 'tmp-test/p5.png', 'tmp-test/p6.png']);
m = await medir();
console.log(`  ${m.thumbs === 10 ? 'OK ' : 'FALTA'} se corta en 10 (hay ${m.thumbs})`);
console.log(`  ${/máximo de 10/.test(m.toast) ? 'OK ' : 'FALTA'} avisa lo omitido: "${m.toast}"`);

// ── 3) archivos que no son imagen ──
console.log('\n3) elegir un .txt junto a imagenes');
await page.evaluate(() => {
  document.querySelectorAll('#plan-thumbs .img-thumb-remove')
    .forEach(b => b.click());
});
await new Promise(r => setTimeout(r, 300));
await subir(['tmp-test/no-imagen.txt', 'tmp-test/p2.png']);
m = await medir();
console.log(`  ${m.thumbs === 1 ? 'OK ' : 'FALTA'} solo sube la imagen (hay ${m.thumbs})`);
console.log(`  ${/no eran im/.test(m.toast) ? 'OK ' : 'FALTA'} avisa lo omitido: "${m.toast}"`);

// ── 4) el texto de la imagen correcta ──
const srcOk = await page.$eval('#plan-thumbs .img-thumb img', el => el.getAttribute('src').startsWith('/uploads/'));
console.log(`  ${srcOk ? 'OK ' : 'FALTA'} la miniatura apunta a /uploads/`);

// ── 4) una imagen falla a mitad del lote ──
console.log('\n4) una imagen falla en medio del lote');
await page.evaluate(() => {
  document.querySelectorAll('#plan-thumbs .img-thumb-remove').forEach(b => b.click());
});
await new Promise(r => setTimeout(r, 300));
await page.setRequestInterception(true);
// Aborta el 2do upload del lote. Contar es seguro: el nombre del archivo viaja
// dentro del multipart y postData() no siempre lo expone.
let n = 0;
const handler = req => {
  if (req.url().includes('/api/upload') && ++n === 2) return req.abort();
  req.continue();
};
page.on('request', handler);
await subir(['tmp-test/p1.png', 'tmp-test/p2.png', 'tmp-test/p3.png', 'tmp-test/p4.png']);
page.off('request', handler);
await page.setRequestInterception(false);
m = await medir();
console.log(`  ${m.thumbs === 3 ? 'OK ' : 'FALTA'} las otras 3 se sublieron igual (hay ${m.thumbs})`);
console.log(`  ${/fallaron 1: p2\.png/.test(m.toast) ? 'OK ' : 'FALTA'} nombra la que fallo: "${m.toast}"`);

// ── 5) guardar de verdad y verificar que persiste ──
console.log('\n5) guardar la publicacion con las imagenes');
const guardado = await page.evaluate(async (tk) => {
  document.getElementById('plan-texto').value = 'PRUEBA MULTIMEDIA';
  document.getElementById('plan-texto').dispatchEvent(new Event('input', { bubbles: true }));
  const r = await fetch('/api/publications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify({
      product_id: null,
      publish_text: 'PRUEBA MULTIMEDIA',
      images: [...document.querySelectorAll('#plan-thumbs img')].map(i => i.getAttribute('src')),
      publication_date: new Date().toISOString(),
    }),
  });
  return { status: r.status, json: await r.json() };
}, token);
console.log(`  ${[200,201].includes(guardado.status) ? 'OK ' : 'FALTA'} creada (HTTP ${guardado.status})`);
const guardadas = guardado.json?.images?.length ?? 0;
console.log(`  ${guardadas === 3 ? 'OK ' : 'FALTA'} persiste ${guardadas} imagenes`);

// limpieza
await page.evaluate(async ({ tk, id }) => {
  await fetch('/api/publications/' + id, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + tk },
  });
}, { tk: token, id: guardado.json?.id });
console.log('  OK  publicacion de prueba borrada');

if (errores.length) {
  console.log('\nERRORES DE CONSOLA:');
  errores.forEach(e => console.log('  ' + e));
}
await browser.close();

const fallos = errores.length;
console.log(fallos ? `\n${fallos} error(es) de consola` : '\nsin errores de consola');
process.exit(fallos ? 1 : 0);
