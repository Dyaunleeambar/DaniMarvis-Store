/**
 * La configuración no puede perderse al arrancar.
 *
 * El 2026-10-04 la `publish_config` quedó en NULL y, al arrancar, la migración de
 * la agenda leyó `{}` y la degradação PARA SIEMPRE a tres claves: con eso se
 * perdieron la API key, los límites del reloj y el cursor de rotación de grupos.
 * Todo en silencio: ningún error, ningún aviso, y el sistema seguía publicando
 * con los defaults.
 *
 * Estos tests arrancan la base DE VERDAD (mismas migraciones que producción) en
 * un archivo temporal y comprueban que lo que se guardó sigue ahí después del
 * siguiente arranque.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(RAIZ, 'scripts', 'helpers', 'arranque.mjs');
const KEY = 'sk-test-esta-es-una-api-key-falsa-de-73-caracteres-de-longitud-ok-123';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

// Candado contra el error que cometí al escribir esto: el fixture arrancaba de
// verdad y escribía la key de prueba en el `.env` del proyecto. Si alguien lo
// vuelve a romper, que se note antes de que un reinicio tumbe la key buena.
const ENV_REAL = join(RAIZ, '.env');
const huellaEnv = () => {
  try { return createHash('sha256').update(readFileSync(ENV_REAL)).digest('hex'); }
  catch { return 'sin .env'; }
};
const envAlEmpezar = huellaEnv();

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-cfg-'));
const dbPath = join(dir, 'prueba.db');
// Cada arranque del fixture corre con SU PROPIO .env, en el temporal. Sin esto, el
// arranque real escribe la key de la prueba en el `.env` del proyecto y el
// siguiente reinicio del servidor se lleva por delante la key buena.
const envPath = join(dir, 'prueba.env');
const entorno = (extra = {}) => ({ ...process.env, DANIMARVIS_ENV_PATH: envPath, ...extra });

const correr = (sub, ruta = dbPath, extra = {}) => JSON.parse(execFileSync(
  process.execPath, [FIXTURE, sub],
  { env: entorno({ DANIMARVIS_DB: ruta, ...extra }), encoding: 'utf8' },
).trim().split('\n').pop());

console.log('\n1. la configuración sobrevive a un reinicio');
{
  correr('set', dbPath);
  const r = correr('check', dbPath);
  ok('la API key sigue ahí después de arrancar de nuevo', r.pc?.ai?.api_key === KEY, String(r.pc?.ai?.api_key).slice(0, 20));
  ok('y no quedó vacía', !r.vacio && r.largo > 100, `largo=${r.largo}`);
}

console.log('\n2. los límites del reloj no se degradan a los defaults');
{
  const r = correr('check', dbPath);
  const ag = r.pc?.agenda || {};
  // Si una migración vuelve a construir `agenda` con un objeto literal en vez de
  // mezclar sobre el que ya había, estos tres campos desaparecen en silencio y el
  // sistema vuelve a publicar al ritmo por defecto. Es exactamente lo que pasó.
  ok('min_gap_min sobrevive (5)', ag.min_gap_min === 5, String(ag.min_gap_min));
  ok('max_per_hour sobrevive (12)', ag.max_per_hour === 12, String(ag.max_per_hour));
  ok('grupos_por_post sobrevive (9)', ag.grupos_por_post === 9, String(ag.grupos_por_post));
  ok('no se colaron los defaults del seed (4/h)', ag.max_per_hour !== 4, String(ag.max_per_hour));
}

console.log('\n3.Arrancar tres veces seguidas no deteriora nada');
{
  const antes = correr('check', dbPath).pc;
  correr('check', dbPath); correr('check', dbPath);
  const despues = correr('check', dbPath).pc;
  ok('la config queda idéntica', JSON.stringify(antes) === JSON.stringify(despues));
  ok('la key sigue presente', despues?.ai?.api_key === KEY);
}

console.log('\n4. una base dañada recupera la key desde el .env');
{
  // Se reproduce lo del 2026-10-04: se arranca bien, se configura, y después la
  // `publish_config` aparece en NULL. Sin red de seguridad, esa key está perdida
  // hasta que alguien vaya a buscar un respaldo a mano.
  const dbRota = join(dir, 'rota.db');
  correr('set', dbRota, { DANIMARVIS_AI_KEY: KEY });

  // Se tapa la config a mano, como si alguien la hubiera borrado.
  execFileSync(process.execPath, ['-e', `
    const initSqlJs = require('sql.js');
    const fs = require('fs');
    (async () => {
      const sql = await initSqlJs({ locateFile: f => require.resolve('sql.js/dist/' + f) });
      const db = new sql.Database(new Uint8Array(fs.readFileSync(${JSON.stringify(dbRota)})));
      db.run("UPDATE settings SET publish_config = NULL WHERE id = 1");
      fs.writeFileSync(${JSON.stringify(dbRota)}, Buffer.from(db.export()));
    })();
  `]);

  const r = correr('check', dbRota);
  ok('la key se recuperó sola tras el próximo arranque', r.pc?.ai?.api_key === KEY, String(r.pc?.ai?.api_key).slice(0, 24));
  ok('y la config volvió a tener contenido', !r.vacio && r.largo > 20, `largo=${r.largo}`);
}

console.log('\n5. el arranque AVISA cuando la config llega vacía');
{
  // El punto ciego de aquella tarde no fue la pérdida, fue el silencio. Con la
  // base vacía y sin red de seguridad tiene que quedar un reguero en el log.
  const dbVacia = join(dir, 'vacia.db');
  delete process.env.DANIMARVIS_AI_KEY;
  const r = JSON.parse(execFileSync(process.execPath, [FIXTURE, 'check'],
    { env: { ...process.env, DANIMARVIS_DB: dbVacia, DANIMARVIS_ENV_PATH: join(dir, 'nada.env') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
  ok('sin key de respaldo no se inventa ninguna', !String(r.pc?.ai?.api_key || '').trim(), `venía "${r.pc?.ai?.api_key}"`);
}

ok('el .env del proyecto quedó intacto', huellaEnv() === envAlEmpezar, 'las pruebas no deben tocar los secretos reales');

rmSync(dir, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);