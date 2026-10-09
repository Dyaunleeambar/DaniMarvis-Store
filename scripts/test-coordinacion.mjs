// Coordinación A/B: cursores compartidos (lote y destino) + candado de turno.
//
// El coordinador (A) guarda todo en su propia base; el cliente (B) llama por
// HTTP. Aquí se prueba, en este orden:
//   1. La lógica local (= lo que corre en A): commit del lote, turno con lease
//      y el cursor de destino sobre facebook_groups.
//   2. Los endpoints HTTP reales (con y sin token).
//   3. La fachada cliente: con COORD_URL puesto, las mismas funciones viajan en
//      HTTP (fetch simulado) en vez de tocar la base.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Las dependencias del servidor viven en backend/node_modules (así lo resuelve
// backend/server.js). Desde scripts/ hay que pedirlas con un require anclado a
// backend/ para encontrarlas.
const requireBackend = createRequire(new URL('../backend/server.js', import.meta.url));

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

// La base va a un archivo temporal ANTES de importar database.js (lee el env al
// cargar). Sin COORD_URL para que esta instancia sea el coordinador.
const tmpDb = path.join(os.tmpdir(), `coord-test-${process.pid}-${Date.now()}.db`);
process.env.DANIMARVIS_DB = tmpDb;
process.env.COORD_TOKEN = 'token-de-prueba';
process.env.DANIMARVIS_AI_KEY = '';
delete process.env.COORD_URL;

const { initDB, getDB } = await import('../backend/db/database.js');
await initDB();
const coord = await import('../backend/lib/coordination.js');
const db = getDB();

function escribirTurno(owner, hasta) {
  const pc = JSON.parse(db.prepare('SELECT publish_config FROM settings WHERE id = 1').get().publish_config || '{}');
  pc.coordination = { ...(pc.coordination || {}), turno: { owner, hasta } };
  db.prepare('UPDATE settings SET publish_config = ? WHERE id = 1').run(JSON.stringify(pc));
}

console.log('coordinación: cursor de lote');
ok('arranca vacío', coord.localGetLote() === '');
coord.localCommitLote('Grupo Zeta');
ok('el commit persiste', coord.localGetLote() === 'Grupo Zeta');

console.log('coordinación: candado de turno');
ok('A toma el turno', coord.localClaimTurn('A').ok === true);
const intentoB = coord.localClaimTurn('B');
ok('B no lo toma mientras A lo tiene', intentoB.ok === false && intentoB.owner === 'A');
ok('A lo renueva (heartbeat)', coord.localClaimTurn('A').ok === true);
coord.localReleaseTurn('A');
ok('tras liberar, B lo toma', coord.localClaimTurn('B').ok === true);
coord.localReleaseTurn('B');
coord.localClaimTurn('A');
ok('release de quien no es dueño no lo quita',
  coord.localReleaseTurn('B').ok === false && coord.localClaimTurn('C').ok === false);
coord.localReleaseTurn('A');
escribirTurno('A', Date.now() - 1000);
ok('un lease vencido libera el turno', coord.localClaimTurn('B').ok === true);
coord.localReleaseTurn('B');

console.log('coordinación: cursor de destino (facebook_groups)');
['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].forEach((name, i) => {
  db.prepare('INSERT INTO facebook_groups (id, name, url, sort_order) VALUES (?, ?, ?, ?)')
    .run('g' + i, name, 'https://fb/g' + i, i);
});
ok('peek(2) da los dos primeros', coord.localPeekDestinos(2).grupos.map(g => g.name).join(',') === 'Alpha,Beta');
ok('peek no avanza el cursor', coord.localPeekDestinos(1).inicio === 0);
coord.localAdvanceDestinos(3);
ok('advance(3) mueve el cursor', coord.localPeekDestinos(1).inicio === 3);
ok('peek(4) da la vuelta', coord.localPeekDestinos(4).grupos.map(g => g.name).join(',') === 'Delta,Epsilon,Alpha,Beta');

console.log('coordinación: catálogo compartido (espejo de B)');
ok('localCatalogo lista los grupos',
  coord.localCatalogo().map(g => g.name).join(',') === 'Alpha,Beta,Gamma,Delta,Epsilon');
coord.upsertCatalogo([{ id: 'g0', name: 'Alpha 2', url: 'u', sort_order: 0 }, { id: 'gz', name: 'Zeta', url: 'zu', sort_order: 9 }]);
const cat = coord.localCatalogo();
ok('upsert actualiza por id sin duplicar', cat.filter(g => g.id === 'g0').length === 1 && cat.find(g => g.id === 'g0').name === 'Alpha 2');
ok('upsert agrega los nuevos', cat.some(g => g.id === 'gz' && g.name === 'Zeta'));

console.log('coordinación: reparto en huecos (distribuir)');
const t = (s) => new Date(s).getTime();
db.prepare("INSERT INTO publication_queue (id, publication_id, group_name, status, scheduled_at) VALUES ('qa1','pa','G1','pending','2026-10-05 10:00:00')").run();
db.prepare("INSERT INTO publication_queue (id, publication_id, group_name, status, scheduled_at) VALUES ('qa2','pa','G2','pending','2026-10-05 10:20:00')").run();
const dist = coord.localDistribuir({ ini: t('2026-10-05T09:00:00'), fin: t('2026-10-05T11:00:00'), cantidad: 2 });
ok('reparte 2 de B en los huecos de A',
  JSON.stringify(dist.dentro) === JSON.stringify([t('2026-10-05T09:30:00'), t('2026-10-05T10:40:00')]));
ok('sin excedente cuando entran todas', dist.excedente === 0 && dist.tiemposA_en_ventana === 2);

console.log('coordinación: endpoints HTTP del coordinador');
const express = requireBackend('express');
const { default: coordinationRouter } = await import('../backend/routes/coordination.js');
const app = express();
app.use(express.json());
app.use('/api/coordination', coordinationRouter);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}/api/coordination`;
const tok = { 'X-Coord-Token': 'token-de-prueba' };

ok('sin token responde 401', (await fetch(base + '/estado')).status === 401);
ok('token inválido responde 401', (await fetch(base + '/estado', { headers: { 'X-Coord-Token': 'otro' } })).status === 401);
const estado = await fetch(base + '/estado', { headers: tok });
const estadoJson = await estado.json();
ok('con token responde 200 y dice coordinador', estado.status === 200 && estadoJson.role === 'coordinador');
ok('GET /lote devuelve el cursor',
  (await (await fetch(base + '/lote', { headers: tok })).json()).lote_desde === 'Grupo Zeta');
const claimHttp = await (await fetch(base + '/turno/claim', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...tok },
  body: JSON.stringify({ account: 'B' }),
})).json();
ok('POST /turno/claim responde ok', claimHttp.ok === true);
const distHttp = await (await fetch(base + '/distribuir', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...tok },
  body: JSON.stringify({ ini: t('2026-10-05T09:00:00'), fin: t('2026-10-05T11:00:00'), cantidad: 2 }),
})).json();
ok('POST /distribuir devuelve los horarios', Array.isArray(distHttp.dentro) && distHttp.dentro.length === 2);
const catHttp = await (await fetch(base + '/catalogo', { headers: tok })).json();
ok('GET /catalogo devuelve los grupos', Array.isArray(catHttp.grupos) && catHttp.grupos.length >= 5);

console.log('coordinación: fachada cliente (B) por HTTP');
process.env.COORD_URL = 'http://coord.local:9999';
let ultimo = null;
const originalFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  ultimo = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
  return { ok: true, status: 200, json: async () => ({ lote_desde: 'W', ok: true, owner: 'B', grupos: [{ id: 'k', name: 'K' }], cursor: 0, total: 0 }) };
};
const loteCliente = await coord.getLote();
ok('cliente GET /lote con token', loteCliente === 'W'
  && ultimo.url === 'http://coord.local:9999/api/coordination/lote'
  && ultimo.headers['X-Coord-Token'] === 'token-de-prueba');
await coord.claimTurn('B');
ok('cliente POST /turno/claim', ultimo.url.endsWith('/turno/claim') && JSON.parse(ultimo.body).account === 'B');
await coord.commitLote('Nuevo');
ok('cliente POST /lote/commit', ultimo.url.endsWith('/lote/commit') && JSON.parse(ultimo.body).ultimo === 'Nuevo');
await coord.advanceDestinos(2);
ok('cliente POST /destinos/advance', ultimo.url.endsWith('/destinos/advance') && JSON.parse(ultimo.body).k === 2);
const catCliente = await coord.catalogo();
ok('cliente GET /catalogo', ultimo.url.endsWith('/catalogo') && catCliente.grupos[0].name === 'K');
global.fetch = fetch;
delete process.env.COORD_URL;

await new Promise((r) => server.close(r));
try { fs.unlinkSync(tmpDb); } catch { /* nada */ }

console.log(fallos === 0 ? '\ncoordinación OK' : `\ncoordinación: ${fallos} fallas`);
process.exit(fallos ? 1 : 0);
