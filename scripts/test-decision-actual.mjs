// decisionActual: lee el estado REAL de la base (último intento, intentos en la
// última hora, corte automático) y devuelve la decisión del disparador por fecha.
//
// Hasta acá esa política solo se podía ejercitar en texto: evaluarLimites es
// pura y se testeaba con objetos armados a mano, pero el cableado —leer
// lastAttemptInfo, countAttemptsSince y leerBreaker de verdad— no se cubría en
// ningún lado. `decisionActual` era interna de la agenda y era el único punto
// donde las tres lecturas se juntaban. Ahora es pública, y este test la ejercita
// contra una base real.
//
// El patrón es el mismo que test-lote-nota.mjs: el singleton de la BD se fija por
// entorno ANTES de importar los módulos, y initDB() arma el esquema en un
// archivo temporal descartable.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-decision-'));
mkdirSync(dir, { recursive: true });
process.env.DANIMARVIS_DB = join(dir, 'prueba.db');
process.env.DANIMARVIS_ENV_PATH = join(dir, 'nada.env');

const { initDB, getDB } = await import('../backend/db/database.js');
const { decisionActual } = await import('../backend/lib/groupPublisher/index.js');
await initDB();

const CFG = { min_gap_min: 15, max_per_hour: 4, dedupe_hours: 6, breaker_failures: 3, breaker_cooldown_min: 60 };
const MIN = 60000;
const db = () => getDB();
const setPublishConfig = (pc) => db().prepare('UPDATE settings SET publish_config = ? WHERE id = 1').run(JSON.stringify(pc));

console.log('\ndecisionActual\n');

// 1. Base vacía: no hay intentos, no hay corte → puede salir.
{
  const d = decisionActual(CFG);
  ok('base vacía: sale', d.ok === true, JSON.stringify(d));
  ok('base vacía: código ok', d.codigo === 'ok', d.codigo);
  ok('siempre informa los intentos de la última hora', d.intentosHora === 0, String(d.intentosHora));
  ok('sin corte no hay motivo que explicar', d.motivo === '', JSON.stringify(d.motivo));
}

// 2. Tope por hora: los intentos reales de la última hora mandan.
{
  // `published_at` con 'Z' y con ' ' conviven en la base; se prueban los dos
  // formatos porque countAttemptsSince tiene que normalizarlos.
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const sql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  // Statement nuevo por fila: en sql.js reutilizar uno cerrado tira "Statement closed".
  const insertar = (id, g, ms) => db().prepare(
    "INSERT INTO publication_queue (id, publication_id, group_name, status, published_at, updated_at) VALUES (?, 'p1', ?, 'published', ?, ?)"
  ).run(id, g, iso(ms), sql(ms));
  insertar('a1', 'G1', ahora - 10 * MIN);
  insertar('a2', 'G2', ahora - 9 * MIN);
  insertar('a3', 'G3', ahora - 8 * MIN);
  insertar('a4', 'G4', ahora - 7 * MIN);
  insertar('a5', 'G5', ahora - 6 * MIN);

  // min_gap_min chico (1) para que el gap no tape el tope: se aísla el fallo.
  const d = decisionActual({ ...CFG, min_gap_min: 1, max_per_hour: 4 });
  ok('cuenta los 5 intentos de la última hora', d.intentosHora === 5, String(d.intentosHora));
  ok('con tope 4 y 5 intentos, frena por tope', d.ok === false && d.codigo === 'tope_hora', d.codigo);
  ok('el motivo dice el tope', /tope de 4 publicaciones por hora/.test(d.motivo), d.motivo);
}

// 3. Gap: si el último intento es muy reciente, no sale aunque tope y corte estén bien.
{
  setPublishConfig({ _ultimoIntento: { at: new Date(Date.now() - 2 * MIN).toISOString(), ms: Date.now() - 2 * MIN } });
  // max_per_hour alto y sin breaker para que SOLO el gap frene.
  const d = decisionActual({ ...CFG, min_gap_min: 15, max_per_hour: 100 }, Date.now());
  ok('frena por el gap', d.codigo === 'gap' && d.ok === false, d.codigo);
  ok('el motivo dice cuántos minutos faltan', /faltan \d+ min/.test(d.motivo), d.motivo);
}

// 4. Corte automático: frena en seco, antes que cualquier tope.
{
  setPublishConfig({ _breaker: { failures: 0, fallos: 3, until: Date.now() + 30 * MIN, reason: 'el texto sigue en el compositor', at: new Date().toISOString() } });
  // El último intento también es reciente: si el orden de comprobaciones
  // cambiara, el motivo sería 'gap' y no 'breaker'.
  setPublishConfig({
    _ultimoIntento: { at: new Date(Date.now() - 2 * MIN).toISOString(), ms: Date.now() - 2 * MIN },
    _breaker: { failures: 0, fallos: 3, until: Date.now() + 30 * MIN, reason: 'el texto sigue en el compositor', at: new Date().toISOString() },
  });
  const d = decisionActual({ ...CFG, min_gap_min: 15, max_per_hour: 100 });
  ok('el corte manda sobre el gap', d.codigo === 'breaker', d.codigo);
  ok('el motivo nombra el corte automático', /corte automático: 3 fallos/.test(d.motivo), d.motivo);
  ok('el motivo expone la causa guardada', /el texto sigue en el compositor/.test(d.motivo), d.motivo);
}

// 5. Un corte vencido ya no frena: vuelve a poder salir (el gap manda).
{
  setPublishConfig({ _breaker: { failures: 0, fallos: 3, until: Date.now() - 1 * MIN, reason: 'viejo', at: new Date(Date.now() - 60 * MIN).toISOString() } });
  const d = decisionActual({ ...CFG, min_gap_min: 1, max_per_hour: 100 });
  ok('un corte vencido no frena', d.codigo !== 'breaker', d.codigo);
  ok('sigue informando los intentos', typeof d.intentosHora === 'number' && d.intentosHora === 5, String(d.intentosHora));
}

rmSync(dir, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
