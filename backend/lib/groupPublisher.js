import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { resolveLocalUpload } from './imageUtils.js';
import { ensureDebugChrome, debugChromeReachable } from './chromeLauncher.js';
import { getAccountConfig, getUploadsDir } from './accountConfig.js';
import { claimTurn, releaseTurn, getLote, commitLote } from './coordination.js';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTER_JS = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'group_poster.js');
// Carpeta de uploads de esta instancia. A usa backend/uploads; B la suya, para
// no mezclar imágenes ni dejar temporales en la de A.
const UPLOADS_DIR = getUploadsDir();

export const DEFAULT_AUTO_PUBLISH = {
  enabled: false,
  mode: 'publish',      // 'publish' | 'prepare'
  daily_cap: 6,         // máx. publicaciones reales por día (conteo local)
  hours_from: 8,        // franja horaria local de actividad
  hours_to: 21,
  min_gap_min: 45,      // separación mínima entre publicaciones consecutivas
  worker_batch: 3,      // cuántos dispara el worker por tick
  tick_min: 5,          // cada cuánto mira la cola el worker
};

// El cooldown de 4h por grupo (antes `cooldown_min: 240` acá y
// `MIN_INTERVAL_MS = 4h` en routes/pubQueue.js) se eliminó a pedido del
// usuario: la separación entre publicaciones la pone él al agendar, en el
// calendario. Estas son las knobs del worker con límites, que sigue existiendo
// para el botón "Correr vencidos"; el disparo por fecha es otro reloj y no usa
// ninguna de estas.

// El disparador por fecha es un reloj DISTINTO del worker con límites, y sigue
// sin cap diario ni franja: la hora la eligió el usuario evento por evento, así
// que respetarla es el trabajo. Solo se pone a mirar cada minuto para que "18:00"
// signifique 18:00 y no "18:00 o 18:05 si la suerte acompaña".
//
// PERO el ritmo no es un detalle menor. El 2026-10-03 este disparador sacó 30
// publicaciones seguidas en 2 horas sin parar: el día estaba duplicado (190
// destinos) y él los iba tomando de a uno, ~17 por hora, porque no tenía ningún
// freno. Facebook dejó de aceptarlos a las 07:21 sin avisar (nada en pantalla,
// solo el compositor con el texto adentro), y como no había separación cada
// fallo era seguido del siguiente vencido. Así se ven 30 errores iguales en la
// cola. Los cuatro límites de abajo son el freno, y son chicos a propósito: es
// más fácil que los suba el usuario a tener que recuperar una cuenta que
// Facebook decidió cortar en silencio.
export const DEFAULT_AGENDA = {
  auto: true,          // arranca encendido: el usuario pidió disparo automático
  tick_min: 1,
  catchup_hours: 24,   // vencido hace más de esto NO se recupera solo
  grupos_por_post: 9,  // cuántos grupos se tildan por publicación en Facebook
  lote_desde: '',      // cursor: el último grupo del lote anterior ('' = desde el 0)
  min_gap_min: 5,      // separación mínima entre publicaciones, de INICIO a INICIO
  max_per_hour: 12,    // tope duro por hora, por si el gap se afloja
  dedupe_hours: 6,     // no repetir el mismo texto en el mismo grupo antes de esto (0 = no)
  breaker_failures: 3, // fallos seguidos que pausan el disparador
  breaker_cooldown_min: 60,
};

// Interruptor MAESTRO del publicador. Es una puerta aparte de autopublish.enabled
// y agenda.auto: mientras `on` sea false NO arranca NINGUNA corrida, ni del
// worker, ni del disparador por fecha, ni manual — sin importar cuántos ítems
// queden pendientes. Le da al usuario el control total de "el sistema sigue o
// no", exactamente para los periodos en que no quiere que salga nada.
//
// Está separado a propósito de los otros dos interruptores: apagar "auto" solo
// congela el disparador por fecha (los vencidos se acumulan), y apagar
// "enabled" solo congela el worker con límites. Este corta TODOS los caminos a
// la vez, manuales incluidos, como una sola llave general.
export const DEFAULT_MASTER = {
  on: true,
};

let running = false;
let lastResult = null;
// Progreso en vivo de la corrida en curso. Las rutas ya no esperan al run (el
// poster tiene --max-seconds=300 y entre posts hay 45-135s de separación), así
// que el frontend hace polling a /group-publish/status y lee esto. Sin esto no
// hay nada que mostrar hasta el final, que es justo lo que había que evitar.
let currentRun = null;

// ------------------------------------------------------------- utilidades ---
const pad = (n) => String(n).padStart(2, '0');
const localNow = () => new Date();

function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
  // La cola guarda published_at/created_at en ISO (UTC). Este formato es
  // comparable por string con lo que genera new Date().toISOString().
}

function toIsoUtc(d) {
  return d.toISOString();
}

function localDayBoundaries() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start: toIsoUtc(start), end: toIsoUtc(end) };
}

function getAutopublishConfig() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row?.publish_config || '{}'); } catch {}
  const cfg = { ...DEFAULT_AUTO_PUBLISH, ...(pc.autopublish || {}) };
  cfg.mode = cfg.mode === 'prepare' ? 'prepare' : 'publish';
  cfg.daily_cap = Math.max(1, Number(cfg.daily_cap) || DEFAULT_AUTO_PUBLISH.daily_cap);
  cfg.worker_batch = Math.max(1, Math.min(20, Number(cfg.worker_batch) || DEFAULT_AUTO_PUBLISH.worker_batch));
  // El intervalo del tick antes era una constante (5 min) y la UI prometía
  // "cada 5 minutos" sin forma de cambiarlo. Ahora sale de la config.
  cfg.tick_min = Math.max(1, Math.min(120, Number(cfg.tick_min) || DEFAULT_AUTO_PUBLISH.tick_min));
  cfg.min_gap_min = Math.max(5, Number(cfg.min_gap_min) || DEFAULT_AUTO_PUBLISH.min_gap_min);
  return cfg;
}

// El cursor del lote se guarda acá, y no en la cola. Razón: la cola tiene una
// fila por grupo CON estado, y el lote es un concepto de Facebook (posarse en
// 9 grupos a la vez) que no encaja en ella. Meter el cursor en la cola
// obligaría a inventar filas sintéticas, y cualquier consulta de "qué falta
// publicar" empezaría a devolver basura.
export function setLoteCursor(nombreGrupo) {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row?.publish_config || '{}'); } catch {}
  pc.agenda = { ...(pc.agenda || {}), lote_desde: typeof nombreGrupo === 'string' ? nombreGrupo : '' };
  db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(pc));
  return pc.agenda.lote_desde;
}

/**
 * Config del disparador por fecha. Vive aparte de `autopublish` a propósito: son
 * dos relojes con propósitos distintos y mezclarlos hacía que guardar un ajuste
 * del worker moviera el otro.
 */
export function getMasterConfig() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row?.publish_config || '{}'); } catch {}
  const cfg = { ...DEFAULT_MASTER, ...(pc.master || {}) };
  cfg.on = cfg.on !== false;
  return cfg;
}

export function getAgendaConfig() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row?.publish_config || '{}'); } catch {}
  const cfg = { ...DEFAULT_AGENDA, ...(pc.agenda || {}) };
  cfg.auto = cfg.auto !== false;
  cfg.tick_min = Math.max(1, Math.min(15, Number(cfg.tick_min) || DEFAULT_AGENDA.tick_min));
  // Number() devuelve NaN (no null/undefined) para un valor inválido, así que
  // el ?? de abajo no lo cubría y el clamp se propagaba como NaN: el tick
  // quedaba en NaN ms y el reloj publicaba en bucle o directamente no
  // publicaba. El `||` sí cubre NaN.
  cfg.catchup_hours = Math.max(0, Math.min(168, Number(cfg.catchup_hours) || DEFAULT_AGENDA.catchup_hours));
  // El cursor viene del texto de un nombre de grupo, así que puede llegar
  // cualquier cosa del JSON. Se fuerza a string: un null o un número sueltos
  // romperían el execFile de abajo y el lote entero dejaría de publicarse en
  // silencio, sin error en ninguna parte.
  cfg.grupos_por_post = Math.max(1, Math.min(30, Number(cfg.grupos_por_post) || DEFAULT_AGENDA.grupos_por_post));
  cfg.lote_desde = typeof cfg.lote_desde === 'string' ? cfg.lote_desde : '';
  // Límites de ritmo del disparador. Todos con clamp: vienen de un JSON que
  // edita a mano el usuario y un 0 suelto en `dedupe_hours` tiene que poder
  // DESACTIVAR la guardia, no caerse al default por el `||` (que también se
  // come los NaN). Por eso ese usa Number.isFinite y los demás el `||`.
  cfg.min_gap_min = Math.max(1, Math.min(1440, Number(cfg.min_gap_min) || DEFAULT_AGENDA.min_gap_min));
  cfg.max_per_hour = Math.max(1, Math.min(60, Number(cfg.max_per_hour) || DEFAULT_AGENDA.max_per_hour));
  const dd = Number(cfg.dedupe_hours);
  cfg.dedupe_hours = Number.isFinite(dd) ? Math.max(0, Math.min(168, dd)) : DEFAULT_AGENDA.dedupe_hours;
  cfg.breaker_failures = Math.max(1, Math.min(20, Number(cfg.breaker_failures) || DEFAULT_AGENDA.breaker_failures));
  cfg.breaker_cooldown_min = Math.max(5, Math.min(1440, Number(cfg.breaker_cooldown_min) || DEFAULT_AGENDA.breaker_cooldown_min));
  return cfg;
}

function lastPublishedInfo() {
  const db = getDB();
  const row = db.prepare(
    "SELECT published_at FROM publication_queue WHERE status = 'published' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
  ).get();
  return row?.published_at || null;
}

function countPublishedToday() {
  const db = getDB();
  const { start, end } = localDayBoundaries();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM publication_queue WHERE status = 'published' AND published_at >= ? AND published_at < ?"
  ).get(start, end);
  return Number(row?.c) || 0;
}

/**
 * Lee una fecha de la cola como milisegundos UTC, sea del formato que sea.
 *
 * En la base conviven DOS formatos y por eso esto no puede ser un `new Date(x)`
 * pelado: el código escribe ISO con 'Z' ('2026-10-03T15:16:14.660Z') pero los
 * `datetime('now')` de SQLite escriben '2026-10-03 15:15:33', sin 'T' y sin 'Z'.
// `new Date()` interpreta ese segundo formato como HORA LOCAL, así que según
// de dónde venga la fila el mismo instante salía corrido 4 horas. Peor: al
 * comparar dos fechas como texto, '2026-10-03 15:15' siempre ordena antes que
 * '2026-10-03T15:15' porque el espacio (0x20) va antes que la 'T', y el filtro
 * `updated_at >= '2026-10-03T13:00'` dejaba afuera justo las filas que SQLite
 * había escrito. Normalizar acá evita las dos trampas.
 */
function fechaMs(valor) {
  if (!valor) return NaN;
  let s = String(valor).trim();
  if (!s.includes('T')) s = s.replace(' ', 'T');
  // Sin 'Z' ni offset, `new Date` lo leería como local. SQLite siempre guarda UTC.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

/**
 * Cuándo fue el último INTENTO del bot, haya servido o no.
 *
 * La separación entre publicaciones se midió siempre contra la última
 * `published_at`, o sea contra el último ACIERTO, y eso la volvía inútil
 * justamente cuando hacía falta: si la cola entera viene fallando, ese valor
 * queda congelado en el último éxito, la diferencia con "ahora" crece, y el
 * límite de separación nunca muerde. El 2026-10-03 fue exactamente eso: 30
 * intentos en 2 horas. La separación tiene que contar desde el último intento,
* que es lo que de verdad consume ritmo.
 *
 * El anclaje es el INICIO del último intento, no su `published_at`.
 *
 * Función pura para poder testearla sin base: la trampa es que `published_at`
 * siempre es posterior al arranque del post que la escribió, así que quedarse con
 * el más nuevo de los dos (un `max`) equivale a medir desde el final, que es
 * justo lo contrario de lo pedido. Con un ciclo de ~2.5 min y gap de 5, eso
 * rendía ~8 publicaciones por hora en vez de 12.
 */
export function elegirAnclaIntento({ marca, finMs }) {
  const crudo = Number(marca?.ms);
  const desdeMs = Number.isFinite(crudo) && crudo > 0 ? crudo : fechaMs(marca?.at);
  if (!Number.isNaN(desdeMs) && desdeMs > 0) return desdeMs;
  return Number.isNaN(finMs) || finMs === null || finMs === undefined ? null : finMs;
}

function lastAttemptInfo() {
  const db = getDB();
  const row = db.prepare(`
    SELECT MAX(t) AS t FROM (
      SELECT published_at AS t FROM publication_queue WHERE published_at IS NOT NULL
      UNION ALL
      SELECT updated_at AS t FROM publication_queue WHERE status = 'error' AND updated_at IS NOT NULL
    )
  `).get();
  const ms = fechaMs(row?.t);

  let marca = null;
  try {
    const cfgRow = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    marca = JSON.parse(cfgRow?.publish_config || '{}')._ultimoIntento;
  } catch { /* sin marca: se cae al plan B */ }

  return elegirAnclaIntento({ marca, finMs: Number.isNaN(ms) ? null : ms });
}

/** Intentos (aciertos o fallos) en la última hora, para el tope por hora. */
function countAttemptsSince(msDesde) {
  const db = getDB();
  const desde = new Date(msDesde).toISOString();
  const desdeSql = desde.replace('T', ' ');
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM publication_queue
    WHERE status IN ('published','error')
      AND (
        (published_at IS NOT NULL AND replace(published_at,'T',' ') >= ?)
        OR (status = 'error' AND replace(updated_at,'T',' ') >= ?)
      )
  `).get(desdeSql, desdeSql);
  return Number(row?.c) || 0;
}

// `lastPublishedForGroup()` vivía acá para el cooldown de 4h por grupo. Se fue
// con el cooldown: la separación entre posts la define el usuario al agendar.

function withinHoursWindow(cfg) {
  const h = localNow().getHours();
  return h >= (Number(cfg.hours_from) || 0) && h < (Number(cfg.hours_to) || 24);
}

// ------------------------------------------------------- límites de ritmo ---
//
// Todo lo de abajo gira alrededor de una idea: el disparador por fecha NO puede
// convertir un día de 190 destinos en 17 publicaciones por hora. Facebook no
// avisa cuando deja de aceptar, así que la única defensa es no llegar a ese
// ritmo y, cuando algo sale mal, frenar en vez de seguir insistiendo.

/** Estado del corte automático. Vive en la config para sobrevivir reinicios. */
export function leerBreaker() {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    const b = pc._breaker;
    if (!b || typeof b !== 'object') return { failures: 0, until: 0, reason: '' };
    return {
      failures: Number(b.failures) || 0,
      fallos: Number(b.fallos) || 0,
      until: Number(b.until) || 0,
      reason: typeof b.reason === 'string' ? b.reason : '',
      at: typeof b.at === 'string' ? b.at : '',
    };
  } catch {
    return { failures: 0, until: 0, reason: '' };
  }
}

function escribirBreaker(b) {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    pc._breaker = b;
    // Va arriba del todo de publish_config y no adentro de `agenda` a propósito:
    // al guardar la config desde la UI, `agenda` se reemplaza entero (merge
    // raso), así que un estado guardado adentro se perdería en cada guardado.
    db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(pc));
  } catch (err) {
    console.error('[agenda] no se pudo guardar el corte automático:', err.message);
  }
}

/**
 * Momento en que EMPEZÓ el último post, para medir el gap de inicio a inicio.
 *
 * Va en `settings.publish_config` y no en `agenda` por lo mismo que
 * `_breaker`: al guardar la config desde la UI, `agenda` se reemplaza entero.
 * Sobrevive a reinicios, que es lo que importa: si se perdiera, el primer post
 * después de apagar el panel se saltaría el gap sin que nadie lo notara.
 */
function marcarIntentoAhora() {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    pc._ultimoIntento = { at: toIsoUtc(new Date()), ms: Date.now() };
    db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(pc));
  } catch (err) {
    // Si no se puede guardar, el gap se mide contra `published_at` (el plan B de
    // lastAttemptInfo). Perder la marca degrada el ritmo, no lo rompe.
    console.error('[agenda] no se pudo marcar el inicio del intento:', err.message);
  }
}

/** Suma un fallo. Al llegar al tope, pausa el disparador un rato. */
export function registrarFallo(cfg, mensaje) {
  const prev = leerBreaker();
  const failures = (prev.failures || 0) + 1;
  const tope = Math.max(1, Number(cfg?.breaker_failures) || DEFAULT_AGENDA.breaker_failures);
  if (failures < tope) {
    escribirBreaker({ ...prev, failures });
    return { paused: false, failures };
  }
  const minutos = Math.max(5, Number(cfg?.breaker_cooldown_min) || DEFAULT_AGENDA.breaker_cooldown_min);
  const until = Date.now() + minutos * 60000;
  escribirBreaker({ failures: 0, fallos: failures, until, reason: String(mensaje || '').slice(0, 160), at: toIsoUtc(new Date()) });
  console.error(`[agenda] CORTE AUTOMÁTICO: ${failures} fallos seguidos. Pausa ${minutos} min. Último: ${String(mensaje || '').slice(0, 120)}`);
  return { paused: true, failures, until };
}

/** Un acierto limpia la cuenta de fallos seguidos: el canal vuelve a estar bien. */
export function limpiarFallos() {
  const prev = leerBreaker();
  if (!prev.failures) return;
  escribirBreaker({ ...prev, failures: 0 });
}

/**
 * Decide si el disparador puede salir ahora, y por qué no si no puede.
 *
 * Función pura a propósito: recibe el estado ya leído de la base y devuelve la
 * decisión, para poder testear la política (qué pasa con 3 fallos, con el tope
 * de la hora, con el gap medido desde el último intento) sin montar nada.
 * El orden de las comprobaciones es el que se ve en los mensajes: primero lo
 * que frena en seco (el corte), después los topes.
 */
export function evaluarLimites({ cfg, nowMs = Date.now(), lastAttemptMs = null, intentosHora = 0, breaker = null }) {
  const b = breaker || { failures: 0, until: 0, reason: '' };
  if (b.until && nowMs < b.until) {
    const min = Math.ceil((b.until - nowMs) / 60000);
    const n = b.fallos || b.failures;
    return { ok: false, motivo: `corte automático: ${n} fallo${n === 1 ? '' : 's'} seguido${n === 1 ? '' : 's'}`
      + (b.reason ? ` (${b.reason.slice(0, 60)})` : '')
      + ` — reintenta en ${min} min`, codigo: 'breaker' };
  }
  const gapMin = Math.max(1, Number(cfg?.min_gap_min) || DEFAULT_AGENDA.min_gap_min);
  if (lastAttemptMs) {
    const faltan = Math.ceil((lastAttemptMs + gapMin * 60000 - nowMs) / 60000);
    if (faltan > 0) return { ok: false, motivo: `separación mínima de ${gapMin} min: faltan ${faltan} min`, codigo: 'gap' };
  }
  const topeHora = Math.max(1, Number(cfg?.max_per_hour) || DEFAULT_AGENDA.max_per_hour);
  if (intentosHora >= topeHora) {
    return { ok: false, motivo: `tope de ${topeHora} publicaciones por hora alcanzado`, codigo: 'tope_hora' };
  }
  return { ok: true, motivo: '', codigo: 'ok' };
}

/**
 * Cuántos destinos puede sacar el tick de ahora. Siempre uno: el tick corre cada
 * minuto y el gap manda, así que dos de golpe solo servirían para saltarse el
 * ritmo que se está procurando respetuar.
 */
export function cuantosPorTick({ decision }) {
  return decision?.ok ? 1 : 0;
}


// ------------------------------------------------------- anti-duplicado ---
//
// El 2026-10-03, con el día duplicado, el mismo texto llegó a "DE TODO EN
// REMEDIOS" tres veces en 7 minutos y a otros grupos dos veces en la hora. No es
// un problema de Facebook: es un problema de que la cola tenía el triple de lo
// que debía y nadie miraba qué se había mandado ya. Con `dedupe_hours` en 0 la
// guardia se apaga entera (para quien quiera publicar el mismo texto a propósito
// en el mismo grupo).

/** Clave de comparación: mismo grupo + mismo texto, sin que estorben acentos, espacios ni mayúsculas. */
export function claveDuplicado(grupo, texto) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${norm(grupo)}\u0000${norm(texto).slice(0, 400)}`;
}

/**
 * Aparta los destinos que repiten un texto que ya salió en ese grupo hace poco.
 *
 * No borra nada: los deja en 'cancelled' con la hora del envío anterior en las
 * notas, para que el usuario vea la decisión y pueda revertirla desde el
 * calendario. Escribir en vez de omitir en silencio importa: si se omitiera sin
 * rastro, la cola parecería más corta y nadie sabría que hubo un descarte.
 *
 * Recibe `db` como parámetro (no usa el getDB() del módulo) para poder testear
 * la política contra una base en memoria, igual que hace duplicarDia.js.
 */
export function marcarDuplicadosEn(db, candidatos, cfg, ahoraMs = Date.now()) {
  const horas = Math.max(0, Number(cfg?.dedupe_hours) || 0);
  if (!horas || !candidatos.length) return { omitidos: 0, ids: [] };
  const desde = new Date(ahoraMs - horas * 3600000).toISOString();
  const desdeSql = desde.replace('T', ' ');
  const yaSalieron = db.prepare(`
    SELECT pq.group_name, COALESCE(NULLIF(pq.variant_text,''), p.publish_text, '') AS texto, pq.published_at
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.status = 'published' AND pq.published_at IS NOT NULL
      AND replace(pq.published_at,'T',' ') >= ?
  `).all(desdeSql);

  const vistos = new Map();
  for (const r of yaSalieron) {
    const k = claveDuplicado(r.group_name, r.texto);
    const prev = vistos.get(k);
    if (!prev || String(r.published_at) > String(prev.published_at)) vistos.set(k, r);
  }

  const omitidos = [];
  for (const c of candidatos) {
    const texto = c.variant_text || c.publish_text || '';
    if (!String(texto).trim()) continue;
    const prev = vistos.get(claveDuplicado(c.group_name, texto));
    if (!prev) continue;
    const cuando = fechaMs(prev.published_at);
    const haceMin = Number.isNaN(cuando) ? null : Math.round((ahoraMs - cuando) / 60000);
    const nota = `omitido por duplicado: este mismo texto ya se publicó en este grupo`
      + (haceMin !== null ? ` hace ${haceMin} min` : '')
      + ` (límite ${horas} h). Si lo querés igual, reprogramalo desde el calendario.`;
    try {
      // El `AND status = 'pending'` es lo que impide pisar un destino que el
      // usuario ya resolvió entre que se armó la lista y se escribió esto. Por
      // eso el conteo mira las filas REALES que cambió el UPDATE y no las que
      // se intentaron: si se contaran las candidatas, el tick informaría "3
      // duplicados apartados" con dos que siguen en 'pending' como estaban, y
      // además los sacaría de la lista de este tick sin motivo.
      const cambiadas = db.prepare(`
        UPDATE publication_queue
        SET status = 'cancelled',
            notes = TRIM(COALESCE(notes,'') || ' | ' || ?),
            updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).run(nota, c.id);
      if (cambiadas) omitidos.push(c.id);
    } catch (err) {
      console.error('[agenda] no se pudo apartar un duplicado:', err.message);
    }
  }
  return { omitidos: omitidos.length, ids: omitidos };
}

/** Envoltorio con la base del servidor, para el tick. */
function marcarDuplicados(candidatos, cfg, ahoraMs = Date.now()) {
  try {
    return marcarDuplicadosEn(getDB(), candidatos, cfg, ahoraMs);
  } catch (err) {
    console.error('[agenda] no se pudo revisar duplicados:', err.message);
    return { omitidos: 0, ids: [] };
  }
}


// ------------------------------------------------------- resolución inputs ---
function resolveGroupUrl(item) {
  if (item.group_url && /^https?:\/\//i.test(item.group_url)) return item.group_url;
  const db = getDB();
  const name = String(item.group_name || '').trim();
  if (!name) return null;
  const row = db.prepare('SELECT url FROM facebook_groups WHERE LOWER(name) = LOWER(?) LIMIT 1').get(name)
    || db.prepare('SELECT url FROM facebook_groups WHERE name LIKE ? LIMIT 1').get(`%${name}%`);
  return row?.url || null;
}

async function downloadToUploads(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = path.extname(new URL(url).pathname).replace(/[^\w.]/g, '') || '.jpg';
    const rel = `pgp_dl_${uuid().slice(0, 8)}${ext}`;
    const file = path.join(UPLOADS_DIR, rel);
    fs.writeFileSync(file, buf);
    return file;
  } catch {
    return null;
  }
}

async function resolveImages(imagesArr) {
  const out = [];
  // dueCandidates() entrega "images" como el texto JSON tal cual del DB;
  // normalizamos a array real antes de recorrer (string => JSON.parse o split).
  let list = imagesArr;
  if (typeof list === 'string') {
    const s = String(list || '').trim();
    try { list = JSON.parse(s); } catch { list = s.split(','); }
  }
  if (!Array.isArray(list)) list = [];
  for (const img of list) {
    if (!img) continue;
    if (/^https?:\/\//i.test(img)) {
      const local = await downloadToUploads(img);
      if (local && fs.existsSync(local)) out.push(await toFacebookFriendly(local));
    } else {
      const local = resolveLocalUpload(img);
      if (local) out.push(await toFacebookFriendly(local));
    }
    if (out.length >= 10) break;
  }
  return out;
}

// Facebook NO acepta .webp en las publicaciones: el input del compositor
// rechaza el archivo y el post se publica sin foto. Se convierte a JPG antes de
// subirlo. El archivo temporal se limpia al terminar (deleteTempFiles).
const FB_UNSUPPORTED = new Set(['.webp']);
async function toFacebookFriendly(file) {
  const ext = path.extname(file).toLowerCase();
  if (!FB_UNSUPPORTED.has(ext)) return file;
  try {
    const { default: sharp } = await import('sharp');
    const out = path.join(UPLOADS_DIR, `pgp_conv_${uuid().slice(0, 8)}.jpg`);
    await sharp(file).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(out);
    return out;
  } catch (e) {
    console.error('[publish] no se pudo convertir', path.basename(file), 'a jpg:', e.message);
    return file;
  }
}

function fillTemplateText(text, pub) {
  const map = {
    '{FECHA}': isoLocal(localNow()).slice(0, 10),
    '{NOMBRE}': pub?.product_name || '',
    '{PRECIO}': pub?.product_price ? `$${Number(pub.product_price).toLocaleString('es-CO')}` : '',
    '{PUBLISH_TEXT}': pub?.publish_text || '',
  };
  // Solo se reemplaza lo que tiene dato detrás. Sin publicación asociada
  // (redacción propia) {NOMBRE}/{PRECIO}/{PUBLISH_TEXT} no tienen fuente, y
  // antes se convertían en '' y '$0': un post salía publicado con el precio
  // en $0 sin ningún error. Ahora quedan literales, que es visible.
  return Object.entries(map)
    .filter(([, v]) => v !== '')
    .reduce((acc, [k, v]) => acc.split(k).join(v), text || '');
}

// --------------------------------------------------------- selección due ---
function dueCandidates({ ignoreSchedule = false } = {}) {
  const db = getDB();
  const now = toIsoUtc(new Date());
  // ignoreSchedule se usa solo para el botón "Publicar ahora" de un evento que
  // todavía tiene hora futura: el usuario está pidiendo explícitamente que
  // salga ya, así que la hora no debe filtrarlo. Ningún otro camino lo activa.
  return db.prepare(`
    SELECT pq.id, pq.publication_id, pq.group_name, pq.group_url, pq.variant_text,
           pq.scheduled_at, p.publish_text, COALESCE(pq.images, p.images) AS images,
           p.publication_date,
           -- fillTemplateText() lee product_name/price del objeto que le llega.
           -- Sin esto, {NOMBRE} salía vacío y {PRECIO} en $0 para todos los
           -- ítems, tuvieran o no publicación asociada. Ojo: publications NO
           -- tiene columna de precio — el precio vive en products y se une por
           -- product_id, igual que routes/publications.js. Se aliasea a
           -- product_price porque así lo espera fillTemplateText().
           p.product_name, pd.price AS product_price
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    LEFT JOIN products pd ON pd.id = p.product_id
    WHERE pq.status = 'pending'
      AND (? = 1 OR pq.scheduled_at IS NULL OR pq.scheduled_at <= ?)
    ORDER BY COALESCE(pq.scheduled_at, pq.created_at) ASC
  `).all(ignoreSchedule ? 1 : 0, now);
}

function pickForRun(cfg, { auto, force }) {
  const now = Date.now();
  const candidates = dueCandidates().filter(c => resolveGroupUrl(c));
  const rows = [];
  const todayCount = countPublishedToday();

  for (const c of candidates) {
    if (rows.length >= (auto ? cfg.worker_batch : 30)) break;

    const groupUrl = resolveGroupUrl(c);
    // SIN cooldown por grupo: la separación la fija el usuario al agendar. Lo
    // que sigue son los límites del worker con límites (el que usa "Correr
    // vencidos"), que no aplica al disparador por fecha: ese tiene los suyos,
    // en `evaluarLimites()`, porque ni siquiera pasa por acá (manda `ids`).
    // franja horaria (solo worker)
    if (auto && !force && !withinHoursWindow(cfg)) continue;
    // cap diario (solo auto)
    if (auto && !force && todayCount + rows.length >= cfg.daily_cap) continue;
    // gap mínimo entre consecutivos (auto). Se mide contra el último INTENTO
    // (último acierto o último fallo), no solo contra el último publicado: con
    // la cola fallando, `lastPublishedInfo()` se congela en el último éxito y
    // el gap deja de existir justo cuando más hace falta. `lastAttemptInfo()`
    // ya incluye los `published_at`, así que sustituye al otro.
    if (auto && !force) {
      const ultimo = lastAttemptInfo();
      if (ultimo !== null && now - ultimo < cfg.min_gap_min * 60000) continue;
    }

    rows.push(c);
    if (!force) todayCount += 0;
  }
  return rows;
}

// -------------------------------------------------------- ejecución/run ---
function writeMessageFile(item) {
  const content = fillTemplateText(item.variant_text || item.publish_text, item);
  const file = path.join(UPLOADS_DIR, `pgp_msg_${uuid().slice(0, 8)}.txt`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// Estados que el poster emite como resultado FINAL de un grupo. Cualquier otra
// línea de stdout (banner, logs, avisos 'warn') es intermedia y NO debe tocar la
// cola. Antes el parseo acceptaba cualquier objeto con clave `ok`, y el poster
// emite un `ok:true, status:'warn'` ANTES del resultado final cuando pierde
// saltos de línea: eso hacía que un ítem quedara marcado 'published' en la BD
// sin haberse publicado nunca, mientras el resumen de la corrida contaba 0.
const TERMINAL_STATUSES = new Set(['published', 'prepared', 'dry-run', 'error']);

/**
 * Convierte la salida del poster en un único resultado. Función pura (no toca
 * ni Chrome ni la BD) para poder testear el contrato con fixtures.
 */
export function parsePosterOutput(stdout, { err = null, allText = '' } = {}) {
  const objs = String(stdout || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x && typeof x === 'object' && !Array.isArray(x));

  // Los avisos se acumulan aparte: son diagnósticos valiosos ("faltaron saltos
  // de línea al escribir") pero no son el resultado del post. Antes se perdían
  // porque el parseo cortaba en el primero.
  const warnings = objs
    .filter(x => x.status === 'warn' || x.event === 'warn')
    .map(x => x.message || 'aviso sin detalle');

  // .find y no el último a propósito: el guard de timeout del poster no se
  // cancela cuando el worker gana la carrera, así que tras un publish OK puede
  // llegar una línea de error después. El primer terminal es el bueno.
  const line = objs.find(x => TERMINAL_STATUSES.has(x.status));

  if (line) {
    const imgA = typeof line.imagen_adjunta === 'number' ? line.imagen_adjunta : null;
    if (imgA !== null) line.img_adjunta = imgA;
    const imgP = typeof line.imagenes_pedidas === 'number' ? line.imagenes_pedidas : null;
    if (imgP !== null) line.img_pedidas = imgP;
    // `adjuntos_confirmados` es el campo de confianza del poster. Va aparte de
    // img_adjunta porque aquel numero no se puede sostener contra el DOM actual
    // de FB (da 0 con los adjuntos presentes). Este si: se apoya en que
    // aparezcan los controles de "quitar foto".
    if (typeof line.adjuntos_confirmados === 'number') line.img_confirmados = line.adjuntos_confirmados;
    if (warnings.length) line.warnings = warnings;
    return line;
  }
  return {
    ok: false,
    status: 'error',
    message: (err?.message || allText || 'Sin salida del poster').slice(0, 300),
    ...(warnings.length ? { warnings } : {}),
  };
}

function spawnPoster({ groupUrl, messageFile, imageFiles, mode, label, debug = false, loteN = 0, loteDesde = '', debugPort = 0 }) {
  return new Promise((resolve) => {
    // El poster es un proceso hijo: sin el puerto explícito siempre se conecta
    // al 9222 (el Chrome de A). Acá se le pasa el de ESTA cuenta para que la
    // cuenta B hable con su propio Chrome.
    const port = Number(debugPort) || getAccountConfig().debugPort;
    const args = [
      '--no-sandbox',
      '--groups=' + groupUrl,
      '--message-file=' + messageFile,
      '--mode=' + mode,
      '--label=' + label,
      '--max-seconds=300',
      '--debug-port=' + port,
    ];
    if (debug) args.push('--debug=1');
    if (imageFiles.length) args.push('--images=' + imageFiles.join(';'));
    // El lote solo se pide si hay imágenes que adjuntar: "Añadir grupos" no
    // existe en el compositor con texto solo, y el poster lo comprueba igual.
    if (loteN > 1) {
      args.push('--lote-n=' + loteN);
      if (loteDesde) args.push('--lote-desde=' + loteDesde);
    }
    execFile(process.execPath, [POSTER_JS, ...args], { timeout: 280000 }, (err, stdout, stderr) => {
      const parsed = parsePosterOutput(stdout, { err, allText: `${stdout || ''}\n${stderr || ''}` });
      // El poster escribe en stderr justo lo que uno necesita para entender un
      // fallo: la línea [SUBMIT] con el botón que encontró (si estaba deshabilitado,
      // de qué tamaño era, si venía del panel del compositor o de un fallback
      // global) y la captura del fallo. Hasta ahora eso se juntaba en `allText`,
      // que solo se usa cuando el proceso no devolvió NADA — y como siempre
      // devuelve el JSON del resultado, se descartaba. Por eso el error del
      // 2026-10-03 decía "el texto sigue en el compositor" sin decir por qué.
      const diag = parsePosterDiag(stderr);
      if (diag && Object.keys(diag).length) Object.assign(parsed, diag);
      resolve(parsed);
    });
  });
}

/**
 * Saca del stderr del poster lo que sirve para diagnosticar un fallo.
 * Función pura: se puede testear con un stderr fixture.
 */
export function parsePosterDiag(stderr) {
  const txt = String(stderr || '');
  if (!txt) return {};
  const out = {};
  const submit = txt.split('\n').map(l => l.trim()).find(l => l.startsWith('[SUBMIT]'));
  if (submit) {
    try {
      const b = JSON.parse(submit.slice('[SUBMIT]'.length).trim());
      out.submit = {
        aria_disabled: b.dis ?? null,
        etiqueta: b.label ?? null,
        aria: b.aria ?? null,
        del_panel: !!b.scoped,
        tam: b.w && b.h ? `${b.w}x${b.h}` : null,
      };
    } catch { /* la línea vino corrupta: no es motivo para perder el resultado */ }
  }
  const fresh = txt.split('\n').map(l => l.trim()).find(l => l.startsWith('[FRESH]'));
  if (fresh) {
    try {
      const fr = JSON.parse(fresh.slice('[FRESH]'.length).trim());
      // [FRESH] sale en el camino de éxito: sirve para distinguir "no seMandó" de
      // "se mand\u00f3 pero no lo vimos", que antes eran el mismo error.
      if (fr && typeof fr === 'object') out.fresh = { encontrados: fr.found ?? null, articulos: fr.articles ?? null };
    } catch { /* idem */ }
  }
  return out;
}

/**
 * La evidencia del clic, en las notas del destino que falló.
 *
 * Sin esto, un "no se envió" no distingue tres cosas muy distintas: el botón
 * estaba deshabilitado y el clic no hizo nada (Facebook no lo tomó), el clic
 * cayó en un diálogo equivocado, o el post salió y no lo supimos leer. Con la
 * línea [SUBMIT] y la captura se puede decir cuál, sin adivinar.
 */
function notaDiagnostico(result) {
  const s = result?.submit;
  const partes = [];
  if (s) {
    partes.push('botón ' + (s.del_panel ? 'del panel del compositor' : 'de la página (fallback)'));
    if (s.tam) partes.push(`de ${s.tam}`);
    if (s.aria_disabled === 'true') partes.push('DESHABILITADO: el clic no hacía nada');
    else if (s.aria_disabled) partes.push(`aria-disabled=${s.aria_disabled}`);
  }
  const aviso = String(result?.alert_text || '').trim();
  if (aviso) partes.push(`FB mostró: "${aviso.slice(0, 90)}"`);
  if (result?.screenshot) partes.push(`captura: ${result.screenshot}`);
  if (result?.fresh && result.fresh.encontrados === false) {
    partes.push('el post no aparece entre los artículos del grupo');
  }
  return partes.length ? ` | ${partes.join('; ')}` : '';
}

/**
 * Nota con los grupos del lote que el poster.tickó de verdad en el compositor.
 *
 * El poster siempre devuelve `lote_grupos` (y `grupos_en_lista`), pero en un
 * post exitoso `result.message` no se guarda en la cola, y ahí era donde venía
 * el texto del lote. La propagación a los N grupos quedaba invisible: no se
 * podía confirmar ni desde la cola ni desde los logs, porque el stdout del
 * poster se descarta y solo se parsean sus líneas JSON.
 *
 * Se escribe incluso con la lista vacía a propósito: "se pidió lote y no se
 * ticked ningún grupo" es justo lo que distingue un post que salió a un grupo
 * de uno que salió a nueve. Sin ese dato, un fallo de propagación se ve
 * idéntico a un éxito.
 *
 * Función pura: se testea sin base ni navegador.
 */
export function notaLote(result) {
  if (!Array.isArray(result?.lote_grupos)) return '';
  const grupos = result.lote_grupos.filter(Boolean);
  const enLista = Number(result.grupos_en_lista) || 0;
  if (!grupos.length) return ' | lote: NO se tildó ningún grupo extra';
  // El tope es 240 y no 300 a propósito: `notes` se corta a 500 chars al final y
  // con 300 el lote se comía la nota de imágenes. El conteo va primero, así que
  // si trunca, lo que sobrevive es el dato que importa ("salió a 9 grupos").
  return ` | lote: ${grupos.length}${enLista ? '/' + enLista : ''} grupos [${grupos.join(' | ')}]`.slice(0, 240);
}

function updateQueue(item, result, mode) {
  const db = getDB();
  const now = toIsoUtc(new Date());
  const base = (item.notes || '').trim();
  // grupo con moderation: el post sale pero espera al administrador
  const pending = result.requiere_aprobacion ? 1 : 0;
  // Avisos no terminales del poster (p.ej. saltos de línea perdidos). Antes el
  // parseo los descartaba; ahora quedan registrados aunque el post salga bien.
  const avisos = Array.isArray(result.warnings) && result.warnings.length
    ? ` | aviso: ${result.warnings.join('; ')}` : '';
  // El poster publica aunque falten imágenes (para que un problema de adjuntos
  // nunca impida que el post salga), pero informa si FB las tomó. El conteo exacto
  // no es confiable contra el DOM actual de FB, así que la nota dice "confirmado"
  // o "no confirmado" en vez de inventar un "3 de 6": un número falso en la cola
  // es peor que una advertencia honesta, porque nadie lo va a cuestionar.
  const pedidas = Number(result.imagenes_pedidas) || 0;
  const confirmadas = Number(result.adjuntos_confirmados) || 0;
  const imgNota = pedidas > 0
    ? (confirmadas
        ? ` | imágenes: FB confirmó los adjuntos (${pedidas} pedidas; conteo exacto no verificado)`
        : ` | ATENCIÓN imágenes: se pidieron ${pedidas} y FB no mostró los controles de quitar foto; probablemente no las tomó`)
    : '';
  // Lote de grupos: cuáles se ticked de verdad en el compositor. El poster ya
  // lo devolvía como `lote_grupos` y el backend lo botaba: en un post exitoso
  // `result.message` no se guarda, y ahí era donde venía el texto del lote. O
  // sea que la propagación a los N grupos era invisible — no se podía confirmar
  // ni desde la cola ni desde los logs (el stdout del poster se descarta).
  const loteNota = notaLote(result);
  let notes;
  if (result.ok) {
    const tag = mode === 'prepare' ? 'preparado' : 'publicado';
    notes = [base, `auto:${tag} ${now.slice(0, 19)}`.trim()].filter(Boolean).join(' | ');
    if (pending) notes += ' | pendiente de aprobación del administrador';
    notes += loteNota;
    notes += imgNota;
  } else {
    notes = [base, `auto:error ${result.message || ''}`.trim()].filter(Boolean).join(' | ').slice(0, 500);
    notes = (notes + notaDiagnostico(result) + loteNota).slice(0, 500);
  }
  notes = (notes + avisos).slice(0, 500);

  // Estado real de la fila ahora mismo. Hace falta porque entre que se tomó el
  // ítem y que terminó de publicarse (2-4 min) el usuario puede haberlo
  // cancelado desde el calendario, y el UPDATE de abajo se lo pisaba sin
  // preguntar: el 2026-10-03 un destino cancelado a las 11:13 quedó 'published'
  // a las 11:16 y el post realmente había salido. Perder "publicó de verdad" es
  // peor que perder una cancelación, así que las dos cosas van con su regla.
  let estadoPrevio = 'pending';
  try {
    estadoPrevio = db.prepare('SELECT status FROM publication_queue WHERE id = ?').get(item.id)?.status || 'pending';
  } catch { /* si no se puede leer, se asume el peor caso */ }
  const fueCancelado = ['cancelled', 'omitted'].includes(estadoPrevio);

  if (result.ok && mode === 'publish') {
    // Un post que SALIÓ se registra siempre, se haya cancelado en el medio o no:
    // el historial real de Facebook no se puede dejar en 'cancelled'. Se deja
    // asentado que la cancelación llegó tarde.
    if (fueCancelado) {
      notes = `${notes} | OJO: se canceló desde el calendario mientras se publicaba y el post igual salió`.slice(0, 500);
    }
    db.prepare("UPDATE publication_queue SET status = 'published', notes = ?, published_at = ?, pending_approval = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, now, pending, item.id);
  } else if (result.ok && mode === 'prepare') {
    db.prepare("UPDATE publication_queue SET status = 'prepared', notes = ?, pending_approval = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, pending, item.id);
  } else {
    // OJO: antes esta rama solo escribía las notas y dejaba el status en
    // 'pending'. Como dueCandidates() filtra por 'pending', el worker volvía a
    // agarrar el ítem en cada tick, fallaba igual y repetía para siempre, sin
    // contador de intentos ni backoff. Por eso un fallo de red se veía en la UI
    // como "quedó esperando" indefinidamente. Ahora el ítem queda en 'error' y
    // la UI lo muestra en su propio balde, con reintento manual.
    //
    // Y si mientras tanto lo cancelaron, el cancelado gana: un fallo no puede
    // resucitar un destino que el usuario ya Sacó de la cola.
    db.prepare("UPDATE publication_queue SET status = 'error', notes = ?, published_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(notes, item.id);
    if (fueCancelado) return { aplicado: false, estadoPrevio };
  }
  return { aplicado: true, estadoPrevio };
}

async function deleteTempFiles(files) {
  for (const f of files) {
    try {
      if (fs.existsSync(f) && /pgp_(msg|dl|conv)_/.test(path.basename(f))) fs.unlinkSync(f);
    } catch (_) {}
  }
}

/**
 * Clasifica por qué falló un post, para que la UI no muestre un "error" pelado.
 * Mismo criterio que usa dailyRanking.js para separar sesión de navegador:
 *  - 'noBrowser': no hay Chrome escuchando en 9222
 *  - 'sesion':    el perfil de Facebook venció y hay muro de login
 */
/**
 * Pista accionable según la causa. Sin esto la UI muestra el mensaje crudo del
 * poster y el usuario no tiene ni idea de si reintentar sirve.
 */
export const CAUSAS = {
  noBrowser: 'No se pudo abrir Chrome. Prendé el navegador con depuración en el puerto 9222.',
  sesion: 'La sesión de Facebook venció o cambió. Entrá de nuevo y reintentá.',
  compositor: 'El compositor de Facebook no apareció, o el post no confirmó. Suele ser Facebook lento o un diálogo viejo tapándolo, no el grupo. Reintentá en un rato.',
  // Esta es la causa del 2026-10-03 y merece su propia línea. El compositor
  // aparece, se escribe el texto, se hace clic en "Publicar"... y no pasa nada.
  // Facebook no muestra ningún aviso, así que no es un error visible: es un
  // rechazo silencioso. Salió 30 veces seguidas en 2 horas y el corte automático
  // ahora frena esa cascada, pero mientras tanto la pista útil es otra: si el
  // botón salió deshabilitado, el clic fue a la nada y el problema es el ritmo.
  compositor_texto: 'Se hizo clic en Publicar y el texto se quedó en el compositor: Facebook no aceptó el envío y no mostró aviso. Casi siempre es que rechazó el ritmo de publicaciones. Bajá el ritmo y esperá antes de reintentar.',
};

function classifyFailure(message) {
  const m = String(message || '');
  if (/no se pudo conectar a chrome|puerto 9222|localhost:9222|failed to fetch browser websocket|econnrefused|could not connect to chrome/i.test(m)) return 'noBrowser';
  if (/sesi[oó]n de facebook requerida|sesi[oó]n (expirada|venci[oó]da)|\/login|checkpoint|cookie_consent/i.test(m)) return 'sesion';
  // Va antes que 'compositor' y es más específica: el texto quedó adentro, o sea
  // que el compositor SÍ apareció y el clic no surtió efecto. Antes esto caía en
  // el mismo cajón que "no encontramos el compositor", que es otro problema.
  if (/se hizo clic en publicar pero el post no se envi[oó]|pero el post no se envi[oó]|sigue en el compositor/i.test(m)) return 'compositor_texto';
  // El poster no comprueba si el grupo está cerrado: solo que no halló el
  // compositor. Sin esta línea la UI lo muestra como "Error" pelado y el
  // usuario no tiene ni idea de que reintentar a ciegas no va a servir.
  if (/no se encontr[oó] el compositor|no se encontr[oó] el bot[oó]n publicar|el texto no qued[oó] en el compositor|pero el post no se envi[oó]|sigue en el compositor/i.test(m)) return 'compositor';
  return null;
}

export { classifyFailure };

/**
 * Trabajo real de la corrida. NO await-ear desde una ruta: usar
 * startGroupPublish(), que devuelve de inmediato. Va dejando el avance en
 * currentRun para que groupPublishStatus() lo sirva por polling.
 */
async function runGroupPublish({ runId = null, auto = false, force = false, ids = [], mode = null, debug = false, runNow = false, origen = 'manual' } = {}) {
  const cfg = getAutopublishConfig();
  // El lote va en el reloj de agenda, no en el worker con límites. `grupos_por_post`
  // y `lote_desde` son del disparador por fecha; usarlos del autopublish daba
  // undefined, la condición `loteN > 1` era falsa y el lote nunca se pedía.
  const agendaCfg = getAgendaConfig();
  const effectiveMode = mode || cfg.mode;
  const startedAt = toIsoUtc(new Date()).slice(0, 19);
  currentRun = {
    runId, started: startedAt, startedMs: Date.now(), finished: null,
    phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: effectiveMode, results: [],
    sesion: false, noBrowser: false, error: null,
    // `origen` viene del `startGroupPublish` y hay que reusarlo acá: este objeto
    // REEMPLAZA al que arma ahí, y sin copiarlo el log de cierre salía con
    // `origen=?` justo cuando sí importaba (lo detectó una corrida real).
    origen: currentRun && currentRun.origen ? currentRun.origen : 'manual',
  };

  try {
    // Garantiza Chrome con debugging remoto (puerto 9222) y el perfil con la
    // sesión de Facebook ANTES de publicar. Antes esto solo sondeaba el puerto
    // y abortaba: había que abrirlo a mano. Si el puerto ya responde no se toca
    // nada (no interfiere con el Chrome del usuario ni con el scraper).
    currentRun.phase = 'starting_chrome';
    const chrome = await ensureDebugChrome({ launch: true });
    if (!chrome.ok) {
      const r = { ok: false, error: `Chrome no disponible (${chrome.error || chrome.status}). Se necesita Chrome con --remote-debugging-port=9222 y la sesión de Facebook abierta en ese perfil.`, noBrowser: true, started: startedAt };
      lastResult = r;
      currentRun.phase = 'error';
      currentRun.noBrowser = true;
      currentRun.error = r.error;
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }

    currentRun.phase = 'picking';
    const items = (ids && ids.length)
      ? dueCandidates({ ignoreSchedule: runNow }).filter(c => ids.includes(c.id))
      : pickForRun(cfg, { auto, force });

    if (items.length === 0) {
      const r = { ok: true, processed: 0, message: 'No hay publicaciones vencidas para publicar ahora.', reason: !auto ? 'na' : (withinHoursWindow(cfg) ? 'fuera de franja o sin vencidas' : 'fuera de franja horaria'), started: startedAt };
      lastResult = r;
      currentRun.phase = 'empty';
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }

    currentRun.total = items.length;
    currentRun.phase = 'publishing';
    // Candado de turno (A/B): solo una cuenta publica a la vez. A lo pide local;
    // B lo pide por HTTP al coordinador. `claimTurn` renueva el lease cuando ya
    // es nuestro (heartbeat). Si lo tiene la otra cuenta, esta corrida se aborta
    // SIN tocar la cola: se reintenta en el próximo tick, cuando la otra libere.
    const accountId = getAccountConfig().id;
    let turno;
    try {
      turno = await claimTurn(accountId);
    } catch (err) {
      turno = { ok: false, error: `no se pudo consultar el turno (${err.message})` };
    }
    if (!turno.ok) {
      const r = { ok: true, processed: 0, message: `Turno ocupado por ${turno.owner || 'la otra cuenta'}${turno.retry_min ? ` (~${turno.retry_min} min)` : ''}: se espera para no publicar en simultáneo.`, reason: 'turno', started: startedAt };
      lastResult = r;
      currentRun.phase = 'waiting_turn';
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }
    const results = [];
    const temps = [];
    let pausedByMaster = false;
    for (const item of items) {
      // Corte a mitad de corrida: si el usuario apagó el interruptor mientras
      // corría, NO se procesa el siguiente ítem. Entre post y post hay 45-135s
      // de separación, así que el corte es casi inmediato en la práctica. Lo que
      // queda sin procesar NO se toca: sigue en 'pending' y se publica cuando se
      // prende de nuevo.
      if (!getMasterConfig().on) {
        pausedByMaster = true;
        break;
      }
      currentRun.current_group = item.group_name;
      // El reloj del gap arranca AQUÍ, cuando el post empieza a escribirse, y no
      // cuando termina. Medirlo contra `published_at` hacía que el ritmo real
      // fuera 1/(gap + duración de la corrida): con 1m35s de media, un gap de
      // 8 min daba 6,3/h y el tope de 6/h era el que nunca mandaba.
      marcarIntentoAhora();
      // Heartbeat del turno: renueva el lease mientras dure la corrida para que
      // la otra cuenta no lo reclame por vencimiento a mitad de camino.
      try { await claimTurn(accountId); } catch { /* el próximo ítem reintenta */ }
      const groupUrl = resolveGroupUrl(item);
      const imageFiles = await resolveImages(item.images);
      const messageFile = writeMessageFile(item);
      temps.push(messageFile, ...imageFiles);

      const result = await spawnPoster({
        groupUrl,
        messageFile,
        imageFiles,
        mode: effectiveMode,
        label: item.group_name,
        debug,
        loteN: agendaCfg.grupos_por_post,
        loteDesde: await getLote(),
      });
      // El cursor avanza SOLO si el lote se tildó de verdad. Si el botón no
      // apareció, o si no se pudo tildar nada, se deja donde estaba: avanzar a
      // ciegas saltaría 9 grupos y el reparto perdería ese tramo para siempre.
      // Se commitea al coordinador para que el próximo lote (lo publique A o B)
      // siga desde acá. Como el turno es exclusivo, no hay carrera.
      if (Array.isArray(result.lote_grupos) && result.lote_grupos.length) {
        await commitLote(result.lote_grupos[result.lote_grupos.length - 1]);
      }
      const escritura = updateQueue(item, result, effectiveMode);
      // Corte automático: cuenta fallos CONSECUTIVOS de cualquier origen (worker,
      // disparador o clic manual), porque lo que se rompió es el canal de
      // Facebook, no quién apretó el botón. Al llegar al tope el disparador queda
      // pausado un rato en vez de seguir sacando destinos de a uno. Sin esto, el
      // 2026-10-03, la cola se consumió entera en 2 horas y Facebook dejó de
      // aceptar los envíos sin decir nada.
      if (result.ok) limpiarFallos();
      else registrarFallo(agendaCfg, result.message);
      const avisos = Array.isArray(result.warnings) && result.warnings.length
        ? result.warnings.join('; ') : '';
      const row = {
        item_id: item.id,
        group: item.group_name,
        url: groupUrl,
        mode: effectiveMode,
        ok: result.ok,
        status: result.status,
        message: ((result.message || '') + (escritura && escritura.aplicado === false ? ' | el destino ya no estaba pendiente: no se sobrescribió' : '') + (avisos ? ` | aviso: ${avisos}` : '') + (result.img_adjunta !== undefined ? ` | img_adjunta:${result.img_adjunta}` : '') + (result.img_pedidas !== undefined ? ` de ${result.img_pedidas}` : '')).slice(0, 220),
        post_url: result.post_url || '',
        // El lote va explícito en el row: `notaLote` lo persiste en las notas,
        // pero el log necesita el dato crudo para no tener que parsear texto.
        lote: Array.isArray(result.lote_grupos) ? result.lote_grupos.length : null,
        lote_total: result.grupos_en_lista || null,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
      // El aviso de sesión/Chrome puede aparecer en cualquier ítem: se marca
      // para que la UI lo diga aunque el run siga y termine con otros errores.
      if (!result.ok) {
        const cause = classifyFailure(result.message);
        if (cause) currentRun[cause] = true;
      }
      results.push(row);
      currentRun.results.push(row);
      currentRun.done += 1;
      if (result.ok) currentRun.ok += 1; else currentRun.errors += 1;
      currentRun.current_group = null;
      // separación natural entre posts consecutivos (simula flujo humano)
      if (results.length < items.length) {
        currentRun.phase = 'waiting';
        await new Promise(r => setTimeout(r, (45000 + Math.random() * 90000)));
        currentRun.phase = 'publishing';
      }
    }

    // Liberar el turno para que la otra cuenta publique en el próximo hueco.
    // Si no se llega aquí (excepción), el lease vence solo y no queda trabado.
    try { await releaseTurn(accountId); } catch { /* el lease expira solo */ }

    deleteTempFiles(temps);
    const r = {
      ok: true,
      mode: effectiveMode,
      grabbed: items.length,
      published: results.filter(x => x.ok && x.status === 'published').length,
      prepared: results.filter(x => x.ok && x.status === 'prepared').length,
      errors: results.filter(x => !x.ok).length,
      sesion: currentRun.sesion,
      noBrowser: currentRun.noBrowser,
      results,
      started: startedAt,
    };
    if (pausedByMaster) {
      r.pausado_por_interruptor = true;
      r.restantes = items.length - results.length;
      r.message = `Se apagó el interruptor maestro a mitad de corrida. Quedan ${r.restantes} pendiente(s) en la cola, sin tocar.`;
    }
    lastResult = r;
    currentRun.phase = 'done';
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    logFinCorrida(r);
    return r;
  } catch (err) {
    const r = { ok: false, error: err.message.slice(0, 300), started: startedAt };
    lastResult = r;
    currentRun.phase = 'error';
    currentRun.error = r.error;
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    logFinCorrida(r);
    return r;
  } finally {
    running = false;
  }
}

/**
 * Cierre de la corrida en el log: qué salió, cuánto tardó y cuántos grupos del
 * lote quedaron ticked de verdad.
 *
 * El lote se lee del campo `lote`/`lote_total` de cada resultado, no parseando
 * las notas: es dato crudo y no depende de que el texto no se haya cortado.
 * `estado` es inyectable solo para poder testear el formato sin abrir Chrome.
 */
export function logFinCorrida(r, estado = null) {
  const c = estado || currentRun;
  if (!c) return;
  // Se estampa acá porque `lastResult` es la MISMA referencia que `r` en los
  // cuatro caminos de salida, y `/api/publish/status` lo expone: así el origen
  // de la última corrida queda disponible para la UI y para auditar, sin depender
  // de parsear el log.
  if (r && typeof r === 'object') r.origen = c.origen || 'manual';
  const dur = c.startedMs ? Math.round((Date.now() - c.startedMs) / 1000) : 0;
  const mins = Math.floor(dur / 60);
  const resumen = (c.results || []).map((x) => {
    const lote = x.lote === null || x.lote === undefined ? '' : ` (lote ${x.lote}${x.lote_total ? '/' + x.lote_total : ''})`;
    return `${x.group || '?'}:${x.ok ? (x.status === 'prepared' ? 'preparado' : 'ok') : 'FALLÓ'}${lote}`;
  }).join(', ');
  const sinLote = (c.results || []).filter((x) => x.lote === 0).length;
  console.log(`[publish] FIN    corrida=${String(c.runId).slice(0, 8)} origen=${c.origen || '?'}`
    + ` dur=${mins ? mins + 'm' : ''}${dur % 60}s ok=${c.ok || 0} err=${c.errors || 0}`
    + (r && r.pausado_por_interruptor ? ' PAUSADO_POR_INTERRUPTOR' : '')
    + (sinLote ? ` SIN_LOTE=${sinLote}` : '')
    + (resumen ? `  ${resumen}` : '')
    + (r && r.error ? `  error="${String(r.error).slice(0, 90)}"` : ''));
}

/**
 * Dispara una corrida y devuelve DE INMEDIATO con el runId (la ruta responde
 * 202). El resultado se consulta por polling en GET /group-publish/status.
 *
 * Antes la ruta awaiteaba el run entero: con --max-seconds=300 del poster y 45-135s
 * entre posts eso son minutos, y api.js no tiene timeout, así que el botón
 * quedaba en "Corriendo..." sin que nadie supiera si colgó o estaba trabajando.
 */
export function startGroupPublish({ auto, force = false, ids = [], mode = null, debug = false, runNow = false, origen = null } = {}) {
  // Interruptor maestro: llave general de todo el publicador. Si está apagado
  // no arranca NADA, ni lo automático ni un clic en "Publicar ahora": esa es la
  // gracia del interruptor (decidir periodos en que el sistema no funciona).
  // Se chequea ANTES de `running` para que apagar no dé una falsa sensación de
  // "estaba corriendo": la razón es clara y el estado no se ensucia.
  let master;
  try { master = getMasterConfig(); } catch { master = { on: true }; }
  if (!master.on) {
    return { accepted: false, skipped: true, reason: 'interruptor maestro apagado' };
  }
  if (running) {
    return { accepted: false, skipped: true, reason: 'Ya hay una corrida de publicador en curso', current: currentRun, lastResult };
  }
  const cfg = getAutopublishConfig();
  const isAuto = auto ?? !(ids && ids.length);
  if (isAuto && !cfg.enabled) {
    return { accepted: false, skipped: true, reason: 'auto-publicado deshabilitado' };
  }

  running = true;
  const runId = uuid();
  const started = toIsoUtc(new Date()).slice(0, 19);
  // `origen` es explícito en los cuatro call sites porque la agenda y un clic
  // manual llamaban los DOS con `auto: false`. Sin esto, el log no distinguía un
  // post que salió por el reloj de uno que salió porque el usuario lo pidió, y
  // un post 2 min después de un error (fuera del gap) era imposible de
  // auditar: podía ser un clic o un hole del freno.
  const quien = origen || (auto === true ? 'worker' : 'manual');
  const origenes = { agenda: 'reloj de agenda', worker: 'worker con límites', manual: 'clic del usuario' };
  // se siembra acá para que el primer poll ya vea la corrida, aunque el Chrome
  // todavía esté arrancando
  currentRun = {
    runId, started, startedMs: Date.now(), finished: null, phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: mode || cfg.mode, results: [], sesion: false, noBrowser: false, error: null,
    origen: quien,
  };

  // El log por corrida.Va al principio y no solo al final porque si el proceso
  // se cae a mitad de camino, el log igual dice qué se había tomado y por qué.
  console.log(`[publish] INICIO corrida=${runId.slice(0, 8)} origen=${quien} (${origenes[quien] || quien})`
    + ` modo=${mode || cfg.mode} destinos=${ids.length || 'todos'} ${force ? 'forzado' : ''}${runNow ? ' runNow' : ''}`);

  // fire-and-forget: los errores ya quedan en lastResult/currentRun
  runGroupPublish({ auto: isAuto, force, ids, mode, debug, runId, runNow, origen: quien }).catch((err) => {
    console.error('[publish] corrida falló:', err);
    lastResult = { ok: false, error: err.message.slice(0, 300), started };
    if (currentRun && currentRun.runId === runId) {
      currentRun.phase = 'error';
      currentRun.error = err.message.slice(0, 300);
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    }
    running = false;
  });

  return { accepted: true, runId, started, total: ids.length || cfg.worker_batch };
}

// ----------------------------------------------------------- worker auto ---
// El worker que faltaba. La etiqueta de Ajustes promete "cada 5 minutos" pero
// no había nada que disparara la corrida sola: startGroupPublish() solo se
// llamaba desde las rutas, o sea que publicar era 100% manual.
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

/** Intervalo efectivo del tick, leído de la config (cae al default si no se puede leer). */
function schedulerIntervalMs() {
  try {
    return getAutopublishConfig().tick_min * 60 * 1000;
  } catch {
    return SCHEDULER_INTERVAL_MS;
  }
}

let schedulerTimer = null;
let lastTickAt = null;
let nextTickAt = null;
let lastTickResult = null;

// Exportado para poder ejercitarlo en tests: con enabled=false el tick corta
// antes de pickForRun y antes de tocar Chrome, así que es seguro invocarlo.
export function runSchedulerTick() {
  lastTickAt = toIsoUtc(new Date());
  nextTickAt = toIsoUtc(new Date(Date.now() + schedulerIntervalMs()));

  const skip = (reason) => {
    lastTickResult = { skipped: true, reason, at: lastTickAt };
    return lastTickResult;
  };

  if (running) return skip('ya hay una corrida en curso');

  let cfg;
  try {
    cfg = getAutopublishConfig();
  } catch (err) {
    // getDB() puede fallar si la BD aún no cargó; no se debe matar el interval.
    return skip(`config ilegible: ${err.message.slice(0, 120)}`);
  }
  if (!cfg.enabled) return skip('auto-publicado deshabilitado');

  // Interruptor maestro: corta ANTES de mirar la cola o abrir Chrome.
  try {
    if (!getMasterConfig().on) return skip('interruptor maestro apagado', 'maestro_apagado');
  } catch (err) {
    return skip(`no se pudo leer el interruptor: ${err.message.slice(0, 120)}`, 'maestro_ilegible');
  }

  // Clave: NO arrancar la corrida "a ciegas". runGroupPublish() llama a
  // ensureDebugChrome({launch:true}) al principio, así que sin este chequeo el
  // worker abriría Chrome cada 5 minutos aunque no haya nada que publicar.
  // pickForRun con auto=true ya aplica franja, cap diario, gap y cooldown.
  let hayTrabajo = 0;
  try {
    hayTrabajo = pickForRun(cfg, { auto: true, force: false }).length;
  } catch (err) {
    return skip(`no se pudo evaluar la cola: ${err.message.slice(0, 120)}`);
  }
  if (hayTrabajo === 0) return skip('no hay publicaciones vencidas');

  const res = startGroupPublish({ auto: true, origen: 'worker' });
  lastTickResult = res.accepted
    ? { started: true, runId: res.runId, queued: hayTrabajo, at: lastTickAt }
    : { skipped: true, reason: res.reason, at: lastTickAt };
  if (res.accepted) {
    console.log(`[publish] worker: corrida ${res.runId.slice(0, 8)} con ${hayTrabajo} pendiente(s)`);
  } else {
    console.log(`[publish] worker: se saltea el tick — ${res.reason}`);
  }
  return lastTickResult;
}

export async function groupPublishStatus() {
  const cfg = getAutopublishConfig();
  return {
    running,
    // Llave general: la UI puede pintar "apagado" arriba, por encima de auto y
    // del worker, porque este manda sobre ambos.
    master: getMasterConfig(),
    // antes esto era null salvo que el ÚLTIMO run hubiera fallado por 9222, así
    // que la UI no podía anticipar "no hay navegador". Ahora es un sondeo real.
    chrome: await debugChromeReachable(),
    config: cfg,
    // elapsed_s se calcula acá y no en el browser: `started` viene recortado a
    // 19 chars sin la Z, así que el JS del front lo parsearía como hora local
    // (4h desfasado en Venezuela).
    current: currentRun
      ? { ...currentRun, elapsed_s: currentRun.startedMs ? Math.round((Date.now() - currentRun.startedMs) / 1000) : null }
      : null,
    lastResult,
    scheduler: schedulerState(),
  };
}

/**
 * Estado del worker automático, para que la UI pueda mostrar la próxima corrida
 * en vez de un "cada 5 minutos" que no existía.
 *
 * Exportada además para `server.js`, que la consulta antes de guardar la config
 * para saber si el worker estaba activo (y no encenderlo de paso).
 */
export function schedulerState() {
  return {
    active: Boolean(schedulerTimer),
    interval_ms: schedulerIntervalMs(),
    last_tick: lastTickAt,
    next_tick: nextTickAt,
    last_tick_result: lastTickResult,
  };
}

export function startGroupPublishScheduler() {
  if (schedulerTimer) {
    console.log('[publish] worker automático ya estaba activo');
    return schedulerState();
  }
  const every = schedulerIntervalMs();
  schedulerTimer = setInterval(runSchedulerTick, every);
  // unref: el timer no debe impedir que el proceso baje limpio. El http server
  // lo mantiene vivo igual.
  schedulerTimer.unref?.();
  nextTickAt = toIsoUtc(new Date(Date.now() + every));
  // enabled solo se lee para el log. Se aísla porque si la BD no está lista el
  // arranque del timer no debería caer: el worker decides igual en cada tick.
  let enabled = '?';
  try { enabled = getAutopublishConfig().enabled; } catch { /* sin BD */ }
  console.log(`[publish] worker automático cada ${Math.round(every / 60000)} min (enabled=${enabled}). Primera corrida en ${Math.round(every / 60000)} min.`);
  return schedulerState();
}

export function stopGroupPublishScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  nextTickAt = null;
  return schedulerState();
}

/**
 * Re-arma el timer cuando cambia el intervalo o el interruptor.
 *
 * El `setInterval` se creaba una sola vez al arrancar el server con una
 * constante, así que cambiar el temporizador desde Ajustes no se notaba hasta
 * reiniciar. Ahora se rearma solo, y solo si el intervalo cambió de verdad:
 * guardar cualquier otro ajuste no reinicia la cuenta del próximo tick.
 *
 * `wasActive` viene del estado anterior, así que un worker apagado no se
 * enciende solo por guardar la config.
 */
export function rescheduleGroupPublish({ wasActive = true } = {}) {
  const before = schedulerTimer ? schedulerState().interval_ms : null;
  const after = schedulerIntervalMs();

  if (!wasActive || before === null) {
    // el worker estaba apagado: no lo levantamos por guardar la config
    if (schedulerTimer) stopGroupPublishScheduler();
    return { rescheduled: false, reason: wasActive ? 'no_active' : 'was_off', state: schedulerState() };
  }
  if (before === after) {
    return { rescheduled: false, reason: 'same_interval', state: schedulerState() };
  }
  stopGroupPublishScheduler();
  const state = startGroupPublishScheduler();
  // La config se lee acá y no antes, solo para el log: pedirla antes obliga a que
  // la BD esté inicializada y hace que esta función no se pueda probar sola.
  let enabled = '?';
  try { enabled = getAutopublishConfig().enabled; } catch { /* sin BD */ }
  console.log(`[publish] temporizador del worker cambiado a ${Math.round(after / 60000)} min (enabled=${enabled})`);
  return { rescheduled: true, from_ms: before, to_ms: after, state };
}

export { getAutopublishConfig }; // reúso desde server.js / worker
// alias explicito: server.js lo usa para leer si el worker estaba activo antes de
// guardar la config, y asi un guardado no enciende un worker apagado.
export { schedulerState as groupPublishSchedulerState };

// ══════════════════════════════ disparador por fecha ════════════════════════
// El worker de arriba mira la cola cada 5 min y con sus límites (cap, franja,
// gap). El disparador por fecha es OTRO reloj, y no comparte nada con él: el
// usuario ya eligió la hora evento por evento en el calendario, así que lo
// único que hay que hacer es respectarla.
//
// Deliberadamente NO lleva cap, ni franja, ni gap, ni cooldown: bloquear una
// publicación porque se pasó del cap diario o porque ya van seis en la franja
// sería traicionar la hora que el usuario escribió. Si él quiere separar los
// posts, los separa él al agendarlos.
const AGENDA_TICK_FALLBACK_MS = 60 * 1000;

let agendaTimer = null;
let lastAgendaTickAt = null;
let nextAgendaTickAt = null;
let lastAgendaResult = null;
// Firma del último "no hice nada" para no repetir la misma línea cada minuto: el
// tick dispara cada 60 s y, si escribiera en cada salto, el log tendría ~1.400
// líneas por día y enterraría justo lo que se viene a buscar. Se loguea al
// CAMBIAR de motivo, que es cuando a uno le interesa saber que el planificador
// se frenó, y al reiniciar el proceso.
let ultimoSaltoAgenda = null;
// El intervalo REAL con el que quedó armado el setInterval. Se guarda aparte
// porque leer la config otra vez ya devuelve el valor NUEVO, y comparar eso
// contra sí mismo daría "same_interval" para siempre: el temporizador nunca se
// rearmaría al cambiar el intervalo. Es el mismo error que tenía
// rescheduleGroupPublish(), evitado acá desde el diseño.
let agendaLiveIntervalMs = null;

function agendaIntervalMs() {
  try { return getAgendaConfig().tick_min * 60 * 1000; }
  catch { return AGENDA_TICK_FALLBACK_MS; }
}

/**
 * Ítems vencidos del disparador por fecha, con la guarda de recuperación.
 *
 * Un ítem es 'pending' con scheduled_at ya pasado. Lo que no hace es filtrar
 * por `isNaN`: `scheduled_at` es texto libre y se Comparaba por string contra
 * un ISO UTC, así que un valor con formato distinto (o vacío) se colaba o se
 * perdía silenciosamente. Ahora se parsea y se descarta lo ilegible.
 */
function dueAgendaItems(nowMs = Date.now()) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT pq.id, pq.publication_id, pq.group_name, pq.group_url, pq.scheduled_at,
           p.publish_text, COALESCE(pq.images, p.images) AS images,
           p.product_name, pd.price AS product_price
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    LEFT JOIN products pd ON pd.id = p.product_id
    WHERE pq.status = 'pending' AND pq.scheduled_at IS NOT NULL
    ORDER BY pq.scheduled_at ASC
  `).all();

  const vencidos = [];
  const ilegibles = [];
  for (const r of rows) {
    const ms = new Date(String(r.scheduled_at).replace(' ', 'T')).getTime();
    if (Number.isNaN(ms)) { ilegibles.push(r); continue; }
    if (ms <= nowMs) vencidos.push({ ...r, _ms: ms });
  }
  return { vencidos, ilegibles };
}

/**
 * Marca como 'omitted' lo que venció hace demasiado.
 *
 * Sin esto, prender el server después de un fin de semana con el.server caído
 * dispararía de golpe todo lo que se acumuló. Pasado `catchup_hours` el post
 * queda esperando decisión humana en el calendario en vez de salir solo y, de
 * paso,athacando un grupo con un post viejo.
 */
function quarantineStale(catchupHours, nowMs = Date.now()) {
  if (catchupHours <= 0) return { count: 0, ids: [] };
  const db = getDB();
  const limite = new Date(nowMs - catchupHours * 3600 * 1000).toISOString();
  // Se toman los ids ANTES de cambiar el estado: el llamador usa esta lista
  // para no intentar publicar filas que ya quedaron en 'omitted'.
  const ids = db.prepare(
    "SELECT id FROM publication_queue WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at < ?"
  ).all(limite).map(r => r.id);
  if (!ids.length) return { count: 0, ids: [] };
  db.prepare(`
    UPDATE publication_queue
    SET status = 'omitted',
        notes = TRIM(COALESCE(notes,'') || ' | omitido: venció más de ' || ? || 'h atrás y no se publica solo; programalo de nuevo o publicalo a mano'),
        updated_at = datetime('now')
    WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at < ?
  `).run(catchupHours, limite);
  return { count: ids.length, ids };
}

/** Estado para la UI: qué dispara, cuándo y por qué saltó el último tick. */
export function agendaSchedulerState() {
  let cfg = null;
  try { cfg = getAgendaConfig(); } catch {}
  let proximos = 0;
  let proximo = null;
  try {
    const { vencidos } = dueAgendaItems();
    proximos = vencidos.length;
    if (vencidos.length) {
      proximo = new Date(vencidos[0]._ms).toISOString();
    }
  } catch { /* la BD puede no estar lista */ }

  // Los límites y el corte automático viajan en el estado para que el calendario
  // pueda explicar el silencio. Sin esto, cuando los topes frenan el disparador
  // la UI muestra lo mismo que cuando no hay nada vencido: nada. Y "no está
  // publicando" sin motivo es justo lo que hace que un usuario lo toque todo.
  let limites = {};
  try {
    const decision = decisionActual(cfg || getAgendaConfig());
    limites = {
      decision: decision.codigo,
      motivo: decision.motivo,
      min_gap_min: cfg ? cfg.min_gap_min : null,
      max_per_hour: cfg ? cfg.max_per_hour : null,
      dedupe_hours: cfg ? cfg.dedupe_hours : null,
      breaker_failures: cfg ? cfg.breaker_failures : null,
      breaker_cooldown_min: cfg ? cfg.breaker_cooldown_min : null,
      corte_hasta: decision.codigo === 'breaker' ? toIsoUtc(new Date(leerBreaker().until)) : null,
      intentos_ultima_hora: decision.intentosHora,
    };
  } catch { /* la BD puede no estar lista */ }

  return {
    active: Boolean(agendaTimer),
    auto: cfg ? cfg.auto : null,
    // El estado del interruptor maestro viaja en la respuesta de la agenda para
    // que el calendario pueda avisar "apagado" sin una segunda peticion: es tan
    // importante como auto, y manda sobre él.
    master_on: (() => { try { return getMasterConfig().on; } catch { return null; } })(),
    interval_ms: agendaIntervalMs(),
    catchup_hours: cfg ? cfg.catchup_hours : null,
    due: proximos,
    next_due_at: proximo,
    last_tick: lastAgendaTickAt,
    next_tick: nextAgendaTickAt,
    last_tick_result: lastAgendaResult,
    limites,
  };
}

/**
 * Loguea un "no hice nada" SOLO cuando el motivo cambió.
 *
 * El tick corre cada minuto y casi siempre se salta por algo (nada vencido, gap,
 * tope, breaker). Escribir en cada salto llena el log de ruido y esconde lo
 * importante; pero callarse del todo tiene un costo peor: si el planificador se
 * muere o se queda apagado, el log queda idéntico al de "no hay nada que hacer",
 * que es justo la confusión que se vino a diagnosticar el 2026-10-04.
 */
function logSaltoAgenda(codigo, motivo, extra = '') {
  const firma = `${codigo}|${motivo}|${extra}`;
  if (firma === ultimoSaltoAgenda) return;
  ultimoSaltoAgenda = firma;
  console.log(`[agenda] SIN PUBLICAR (${codigo}) ${motivo}${extra ? ' — ' + extra : ''}`);
}

/** Lee el estado que necesita `evaluarLimites` desde la base. */
function decisionActual(cfg, nowMs = Date.now()) {
  const intentosHora = countAttemptsSince(nowMs - 3600000);
  const decision = evaluarLimites({
    cfg,
    nowMs,
    lastAttemptMs: lastAttemptInfo(),
    intentosHora,
    breaker: leerBreaker(),
  });
  return { ...decision, intentosHora };
}

/**
 * Un tick del disparador por fecha.
 *
 * Igual que el worker, NO arranca la corrida "a ciegas": `startGroupPublish()`
 * abre Chrome de inmediato, así que sin este chequeo se abriría el navegador
 * cada minuto aunque no haya nada vencido.
 */
export function runAgendaTick() {
  lastAgendaTickAt = toIsoUtc(new Date());
  nextAgendaTickAt = toIsoUtc(new Date(Date.now() + agendaIntervalMs()));

  const skip = (reason, codigo = 'motivo', extra = '') => {
    lastAgendaResult = { skipped: true, reason, motivo: codigo, at: lastAgendaTickAt };
    logSaltoAgenda(codigo, reason, extra);
    return lastAgendaResult;
  };

  if (running) return skip('ya hay una corrida en curso', 'ocupado');

  let cfg;
  try { cfg = getAgendaConfig(); }
  catch (err) { return skip(`config ilegible: ${err.message.slice(0, 120)}`, "config"); }

  if (!cfg.auto) return skip('disparador por fecha apagado', 'auto_apagado');

  // Interruptor maestro: mismo criterio que el worker. Corta sin mirar la cola,
  // así los vencidos se siguen acumulando en 'pending' para cuando se prenda.
  try {
    if (!getMasterConfig().on) return skip('interruptor maestro apagado');
  } catch (err) {
    return skip(`no se pudo leer el interruptor: ${err.message.slice(0, 120)}`);
  }

  const { vencidos, ilegibles } = dueAgendaItems();
  for (const r of ilegibles) {
    // Una fecha que no se puede leer no se va a publicar nunca sola ni a mano:
    // se aparta y se avisa, en vez de quedar 'pending' para siempre.
    try {
      getDB().prepare(
        "UPDATE publication_queue SET status='omitted', notes=TRIM(COALESCE(notes,'') || ' | omitido: scheduled_at ilegible (' || ? || ')'), updated_at=datetime('now') WHERE id=?"
      ).run(String(r.scheduled_at), r.id);
    } catch { /* no insistir */ }
  }

  const { ids: descartadosIds, count: descartados } = quarantineStale(cfg.catchup_hours);
  const quitados = new Set(descartadosIds);
  for (const id of ilegibles) quitados.add(id.id);

  // Se filtran los que acaban de quedar en 'omitted'. No es cosmético: si
  // llegaran a startGroupPublish se abriría Chrome para una corrida que no
  // tiene nada que hacer (runGroupPublish los vuelve a leer de la BD y los
  // descarta, pero igual paga el arranque del navegador).
  const publicables = vencidos.filter(c => resolveGroupUrl(c) && !quitados.has(c.id));
  if (publicables.length === 0) {
    return skip('no hay publicaciones vencidas', 'nada_vencido', `quarantinados=${descartados}`);
  }

  // La guardia de duplicados va PRIMERO y antes de cualquier decisión de ritmo,
  // y por eso escribe: aparta lo que ya salió y recién después se ve si toca
  // publicar. Si fuera al revés, un tick frenado por el gap dejaría pasar
  // duplicados para el siguiente, y en 15 minutos se acumulaban 4.
  const dup = marcarDuplicados(publicables, cfg);
  if (dup.omitidos) {
    console.log(`[agenda] ${dup.omitidos} destino(s) repetidos apartados (mismo texto en el mismo grupo hace menos de ${cfg.dedupe_hours} h)`);
  }
  const trasDup = dup.ids.length ? publicables.filter(c => !dup.ids.includes(c.id)) : publicables;
  if (trasDup.length === 0) {
    lastAgendaResult = { skipped: true, reason: 'todos los vencidos eran repetidos', motivo: 'duplicados', at: lastAgendaTickAt, quarantined: descartados, duplicados: dup.omitidos };
    logSaltoAgenda('duplicados', 'todos los vencidos eran repetidos', `apartados=${dup.omitidos}`);
    return lastAgendaResult;
  }

  // Límites de ritmo. Este es el freno que faltaba: hasta acá el tick pasaba
  // TODOS los vencidos como `ids` y runGroupPublish los iba sacando de a uno con
  // 45-135 s de pausa entre ellos, sin tope de ninguno. Con el día duplicado
  // (190 destinos) eso son ~17 publicaciones por hora hasta que Facebook dejó de
  // aceptarlas en silencio. Ahora se decide una vez por tick y se pasa UN
  // destino, como mucho.
  const decision = decisionActual(cfg);
  const cuantos = cuantosPorTick({ decision });
  if (cuantos === 0) {
    lastAgendaResult = {
      skipped: true,
      reason: decision.motivo,
      motivo: decision.codigo,
      at: lastAgendaTickAt,
      pendientes: trasDup.length,
    };
    // El freno dejó pasar cero destinos. Va al log porque es la línea que
    // explica un post que no salió a su hora, y `pendientes` es lo que dice
    // cuánta cola se está atrasando mientras tanto.
    logSaltoAgenda(decision.codigo, decision.motivo, `${trasDup.length} pendiente(s)`);
    return lastAgendaResult;
  }
  const elegidas = trasDup.slice(0, cuantos);

  // `ids` explícitos: runGroupPublish() los filtra directo sobre dueCandidates()
  // y se salta pickForRun(), o sea que no pasa por cap/franja/gap/cooldown del
  // worker. Por eso los límites de arriba son los únicos que protegen este camino.
  const res = startGroupPublish({ ids: elegidas.map(c => c.id), auto: false, origen: 'agenda' });
  lastAgendaResult = res.accepted
    ? {
      started: true, runId: res.runId, queued: elegidas.length, at: lastAgendaTickAt,
      quarantined: descartados, duplicados: dup.omitidos,
      pendientes: trasDup.length - elegidas.length,
      proximo_min_gap: cfg.min_gap_min,
    }
    : { skipped: true, reason: res.reason, at: lastAgendaTickAt };

  if (res.accepted) {
    // Se limpia la firma del salto anterior: si el próximo tick vuelve a frenarse
    // por el MISMO motivo, tiene que volver a aparecer en el log. Sin esto, un
    // freno que se alterna con publicaciones se leería como uno solo y se
    // perderían las pausas.
    ultimoSaltoAgenda = null;
    console.log(`[agenda] vencidas: ${elegidas.length} de ${trasDup.length} (corrida ${res.runId.slice(0, 8)}) — gap ${cfg.min_gap_min} min, tope ${cfg.max_per_hour}/h`);
    // Por qué se pudo publicar AHORA y no en el tick anterior. Antes el log decía
    // solo "vencidas: 1 de 4", y sin el motivo no había forma de distinguir un
    // tick que obeyed el freno de uno que lo pasó por alto.
    for (const c of elegidas) {
      console.log(`[agenda] ELEGIDO destino=${c.id.slice(0, 8)} prog=${c.scheduled_at}`
        + ` grupo="${(c.group_name || '?').slice(0, 46)}" motivo=${decision.codigo} (${decision.motivo})`
        + ` intentos_ultima_hora=${decision.intentosHora}/${cfg.max_per_hour}`);
    }
  } else {
    console.log(`[agenda] tick saltado — ${res.reason}`);
  }
  return lastAgendaResult;
}

export function startAgendaScheduler() {
  if (agendaTimer) return agendaSchedulerState();
  const every = agendaIntervalMs();
  agendaTimer = setInterval(runAgendaTick, every);
  agendaTimer.unref?.();
  agendaLiveIntervalMs = every;
  nextAgendaTickAt = toIsoUtc(new Date(Date.now() + every));
  let auto = '?';
  try { auto = getAgendaConfig().auto; } catch { /* sin BD */ }
  console.log(`[agenda] disparador cada ${Math.round(every / 60000)} min (auto=${auto}).`);
  return agendaSchedulerState();
}

export function stopAgendaScheduler() {
  if (agendaTimer) {
    clearInterval(agendaTimer);
    agendaTimer = null;
  }
  agendaLiveIntervalMs = null;
  nextAgendaTickAt = null;
  return agendaSchedulerState();
}

/**
 * Re-arma el reloj del disparador cuando cambian `tick_min` o `auto`.
 *
 * Ojo con el bug que ya se cometió una vez en `rescheduleGroupPublish()`: el
 * "antes" tiene que ser el intervalo REAL con el que quedó armado el timer, no
 * el que devuelve la config leída en este momento (que ya es el nuevo). Por eso
 * acá se guarda `agendaIntervalMs()` en el momento de armar el setInterval.
 */
export function rescheduleAgenda({ wasActive = true } = {}) {
  const after = agendaIntervalMs();
  const before = agendaTimer ? agendaLiveIntervalMs : null;

  if (!wasActive || before === null) {
    if (agendaTimer) stopAgendaScheduler();
    return { rescheduled: false, reason: wasActive ? 'no_active' : 'was_off', state: agendaSchedulerState() };
  }
  if (before === after) {
    return { rescheduled: false, reason: 'same_interval', state: agendaSchedulerState() };
  }
  stopAgendaScheduler();
  const state = startAgendaScheduler();
  console.log(`[agenda] temporizador cambiado a ${Math.round(after / 60000)} min`);
  return { rescheduled: true, from_ms: before, to_ms: after, state };
}
