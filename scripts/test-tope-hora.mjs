// Tope por hora: el mensaje dice cuántos minutos faltan para que vuelva a salir.
//
// La invariante que importa: "faltan N min" es EXACTO. A ahora + N min el tope deja
// salir, y un minuto antes todavía frena. Si el mensaje mintiera, quien lo lee
// esperaría de más o de menos. El tope sigue siendo una ventana deslizante de 60 min.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-tope-'));
mkdirSync(dir, { recursive: true });
process.env.DANIMARVIS_DB = join(dir, 'prueba.db');
process.env.DANIMARVIS_ENV_PATH = join(dir, 'nada.env');

const { initDB, getDB } = await import('../backend/db/database.js');
const { minutosParaTope, evaluarLimites, decisionActual } = await import('../backend/lib/groupPublisher/index.js');
const { attemptTimesSince, countAttemptsSince } = await import('../backend/lib/groupPublisher/estado.js');
await initDB();

const MIN = 60000;
const HORA = 60 * MIN;
const ahora = Date.now();

console.log('\n1. minutosParaTope: cuándo sale el intento que libera el tope\n');
{
  // 20 s de más: con horas exactamente alineadas al minuto el borde inclusivo suma un minuto.
  const hace = (m) => ahora - m * MIN - 20000;
  const doce = Array.from({ length: 12 }, (_, i) => hace(55 - i * 4)); // de hace 55 a hace 11 min
  ok('12 de 12: espera hasta que el más viejo cumpla la hora (hace 55 -> 5 min)', minutosParaTope(doce, 12, ahora) === 5);
  ok('con 11 de 12 todavía no hay tope: null', minutosParaTope(doce.slice(1), 12, ahora) === null);
  const trece = [hace(58), hace(50), ...Array.from({ length: 11 }, (_, i) => hace(40 - i))];
  ok('13 de 12 (hubo extras manuales): hay que esperar a que salgan DOS (el 2.º más viejo, hace 50 -> 10 min)', minutosParaTope(trece, 12, ahora) === 10, String(minutosParaTope(trece, 12, ahora)));
  ok('no importa el orden en que lleguen las horas', minutosParaTope([...doce].reverse(), 12, ahora) === 5);
  ok('justo en el borde (la hora exacta) el intento todavía cuenta: dice 1 min más, no "ya sale"',
    minutosParaTope([ahora - HORA], 1, ahora) === 1 && minutosParaTope([ahora - HORA - 1], 1, ahora) === 1);
  ok('nunca dice 0: si ya casi sale, dice 1 min', minutosParaTope(Array.from({ length: 4 }, (_, i) => ahora - 60 * MIN + 1000 * (i + 1)), 4, ahora) === 1);
  ok('sin datos o tope inválido: null (se mantiene el mensaje de siempre)', minutosParaTope(null, 12, ahora) === null && minutosParaTope([], 12, ahora) === null && minutosParaTope(doce, 0, ahora) === null);
  ok('horas inválidas se ignoran sin romper', minutosParaTope([NaN, ...doce], 12, ahora) === 5);
}

console.log('\n2. evaluarLimites: el mensaje\n');
{
  const cfg = { min_gap_min: 1, max_per_hour: 4, gap_modo: 'fijo' };
  const tiempos = [ahora - 50 * MIN - 20000, ahora - 40 * MIN - 20000, ahora - 30 * MIN - 20000, ahora - 20 * MIN - 20000];
  const d = evaluarLimites({ cfg, nowMs: ahora, lastAttemptMs: ahora - 20 * MIN, intentosHora: 4, intentosTiempos: tiempos });
  ok('frena por tope_hora', !d.ok && d.codigo === 'tope_hora');
  ok('el mensaje dice cuánto falta', d.motivo === 'tope de 4 publicaciones por hora alcanzado — puede salir otra en 10 min', d.motivo);
  ok('y lo expone como número para la pantalla', d.esperaMin === 10);
  const sin = evaluarLimites({ cfg, nowMs: ahora, lastAttemptMs: ahora - 20 * MIN, intentosHora: 4 });
  ok('sin las horas, el mensaje de siempre (compatibilidad)', sin.motivo === 'tope de 4 publicaciones por hora alcanzado' && !('esperaMin' in sin), sin.motivo);
  const gap = evaluarLimites({ cfg: { ...cfg, min_gap_min: 5 }, nowMs: ahora, lastAttemptMs: ahora - 2 * MIN, intentosHora: 4, intentosTiempos: tiempos });
  ok('el gap sigue yendo antes que el tope (su mensaje no cambia)', gap.codigo === 'gap');
}

console.log('\n3. con la base real: el mensaje es EXACTO\n');
{
  const db = () => getDB();
  const sql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const iso = (ms) => new Date(ms).toISOString();
  const insertar = (id, estado, ms) => db().prepare(
    "INSERT INTO publication_queue (id, publication_id, group_name, status, published_at, updated_at) VALUES (?, 'p1', ?, ?, ?, ?)"
  ).run(id, 'G' + id, estado, estado === 'published' ? iso(ms) : null, sql(ms));
  // 3 publicados y 1 con error dentro de la hora; 1 publicado de hace 2 h (fuera de la ventana)
  insertar('a1', 'published', ahora - 50 * MIN - 20000);
  insertar('a2', 'published', ahora - 38 * MIN - 20000);
  insertar('a3', 'error', ahora - 30 * MIN - 20000);
  insertar('a4', 'published', ahora - 12 * MIN - 20000);
  insertar('viejo', 'published', ahora - 2 * HORA);

  const tiempos = attemptTimesSince(ahora - HORA);
  ok('las horas son las mismas filas que cuenta countAttemptsSince', tiempos.length === countAttemptsSince(ahora - HORA) && tiempos.length === 4, `${tiempos.length} vs ${countAttemptsSince(ahora - HORA)}`);
  ok('vienen ordenadas, de la más vieja a la más nueva', tiempos.every((t, i) => i === 0 || t >= tiempos[i - 1]));
  ok('el intento de hace 2 h no entra', !tiempos.some((t) => t < ahora - HORA - MIN));

  const cfg = { min_gap_min: 1, gap_modo: 'fijo', max_per_hour: 4, max_per_hour_dummy: 0, auto: true };
  const d = decisionActual(cfg, ahora);
  ok('con 4 en la hora y tope 4, frena por tope', !d.ok && d.codigo === 'tope_hora', JSON.stringify(d));
  ok('dice que faltan 10 min (el más viejo es de hace 50 min)', d.esperaMin === 10 && d.motivo.endsWith('puede salir otra en 10 min'), d.motivo);

  // LA invariante: a la hora que dice, sale; un minuto antes, todavía no
  const justo = decisionActual(cfg, ahora + d.esperaMin * MIN);
  ok('pasados esos minutos, el tope deja salir', justo.ok === true, JSON.stringify(justo));
  const antes = decisionActual(cfg, ahora + (d.esperaMin - 1) * MIN);
  ok('un minuto antes, todavía frena (el mensaje no miente por defecto)', !antes.ok && antes.codigo === 'tope_hora', JSON.stringify(antes));
  ok('y en ese momento ya dice 1 min', antes.esperaMin === 1, String(antes.esperaMin));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
