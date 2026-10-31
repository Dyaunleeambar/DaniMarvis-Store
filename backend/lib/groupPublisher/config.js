// Configuración del publicador: defaults, lectura desde `settings` y la técnica
// de texto configurable. Cada getter lee su propia porción de publish_config.
import { getDB } from '../../db/database.js';
import { resolverTiempos, tiemposParaPoster } from './tiempos.js';

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
  min_gap_min: 5,      // separación mínima entre publicaciones, de INICIO a INICIO (en modo 'rango', el mínimo del rango)
  gap_modo: 'fijo',    // 'fijo' = siempre min_gap_min | 'rango' = un valor al azar entre min_gap_min y gap_max_min
  // gap_max_min: máximo del rango (solo en modo 'rango'). Sin valor guardado es igual a
  // min_gap_min, y nunca queda por debajo de él (ver getAgendaConfig).
  max_per_hour: 12,    // tope duro por hora, por si el gap se afloja
  dedupe_hours: 6,     // no repetir el mismo texto en el mismo grupo antes de esto (0 = no)
  breaker_failures: 3, // fallos seguidos que pausan el disparador
  breaker_cooldown_min: 60,
  // Reintento automático de cualquier fallo (salvo 'revisar' y cancelados).
  // Se ejecutan en rondas de 2 intentos consecutivos sin gap entre ellos.
  // Si se agotan los 2 de una ronda y aún queda cupo, se espera `retry_delay_min`
  // minutos y se lanza otra ronda de 2, hasta llegar a `retry_max`.
  auto_retry: true,
  retry_max: 2,        // máximo de intentos totales por destino (1 a 6)
  retry_delay_min: 2,  // minutos de espera entre rondas de 2 intentos
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

// Técnica con la que el poster mete el texto en el compositor. Configurable en
// Ajustes > Publicaciones para poder comparar con publicaciones reales. El
// default `teclado` mantiene el comportamiento probado: nada cambia hasta que
// el usuario elija otra.
//
// Esta lista ESPEJA `METODOS_TEXTO` de utilidades/fb-ranking/metodo_texto.js
// (el poster es CJS y no comparte scope con este backend ESM). Si se agrega una
// técnica, hay que sumarla acá, en metodo_texto.js y en el <select> de Ajustes.
export const METODOS_TEXTO = ['teclado', 'insertText', 'ctrlv', 'pasteEvent'];
export const DEFAULT_METODO_TEXTO = 'teclado';

/** Elige la técnica a partir de la config ya parseada. Función pura (testeable). */
export function metodoTextoDeConfig(pc) {
  const metodo = String((pc && pc.metodo_texto) || '').trim();
  return METODOS_TEXTO.includes(metodo) ? metodo : DEFAULT_METODO_TEXTO;
}

function leerPublishConfig() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  try { return JSON.parse(row?.publish_config || '{}'); } catch { return {}; }
}

export function getAutopublishConfig() {
  const pc = leerPublishConfig();
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
 * Interruptor maestro del publicador. Mientras `on` sea false, ningún camino
 * (worker, agenda o manual) arranca una corrida.
 */
export function getMasterConfig() {
  const pc = leerPublishConfig();
  const cfg = { ...DEFAULT_MASTER, ...(pc.master || {}) };
  cfg.on = cfg.on !== false;
  return cfg;
}

export function getAgendaConfig() {
  const pc = leerPublishConfig();
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
  // Modo del gap: fijo, o un valor al azar dentro de [min_gap_min, gap_max_min]. Un modo
  // desconocido cae a fijo (lo de siempre) y el máximo nunca baja del mínimo.
  cfg.gap_modo = cfg.gap_modo === 'rango' ? 'rango' : 'fijo';
  const gMax = Number(cfg.gap_max_min);
  cfg.gap_max_min = Math.max(cfg.min_gap_min, Math.min(1440, Number.isFinite(gMax) && gMax > 0 ? gMax : cfg.min_gap_min));
  cfg.max_per_hour = Math.max(1, Math.min(60, Number(cfg.max_per_hour) || DEFAULT_AGENDA.max_per_hour));
  const dd = Number(cfg.dedupe_hours);
  cfg.dedupe_hours = Number.isFinite(dd) ? Math.max(0, Math.min(168, dd)) : DEFAULT_AGENDA.dedupe_hours;
  cfg.breaker_failures = Math.max(1, Math.min(20, Number(cfg.breaker_failures) || DEFAULT_AGENDA.breaker_failures));
  cfg.breaker_cooldown_min = Math.max(5, Math.min(1440, Number(cfg.breaker_cooldown_min) || DEFAULT_AGENDA.breaker_cooldown_min));
  // `auto_retry` es booleano; cualquier otra cosa se resuelve a true salvo un
  // false explícito, para que una config vieja (sin la clave) herede el default.
  cfg.auto_retry = cfg.auto_retry !== false;
  // 0 desactiva los auto-reintentos sin apagar el interruptor; el `||` se
  // comería el 0, así que va con Number.isFinite igual que dedupe_hours.
  const rm = Number(cfg.retry_max);
  cfg.retry_max = Number.isFinite(rm) ? Math.max(1, Math.min(6, rm)) : DEFAULT_AGENDA.retry_max;
  const rd = Number(cfg.retry_delay_min);
  cfg.retry_delay_min = Number.isFinite(rd) ? Math.max(1, Math.min(1440, rd)) : DEFAULT_AGENDA.retry_delay_min;
  return cfg;
}

/**
 * Técnica de pegado de texto elegida en Ajustes (publish_config.metodo_texto).
 * Cualquier valor que no sea una técnica conocida cae a `teclado`: así una
 * config corrupta no rompe el publicador, solo lo deja como estaba.
 */
export function getMetodoTexto() {
  const pc = leerPublishConfig();
  return metodoTextoDeConfig(pc);
}

/**
 * ¿Está activada la confirmación rápida por red? (publish_config.confirm_red).
 * Función pura (testeable). Solo `true` la activa: un valor ausente, "true" como
 * texto o basura cae a `false`, o sea al modo sombra (que solo mide y no cambia
 * cuándo se cierra la pestaña). Así una config rara nunca la enciende sola.
 */
export function confirmRedDeConfig(pc) {
  return resolverTiempos(pc).confirm_red === true;
}

/** Lee el interruptor en cada corrida: un cambio en Ajustes aplica sin reiniciar. */
export function getConfirmRed() {
  return confirmRedDeConfig(leerPublishConfig());
}

/**
 * Tiempos de Ajustes > Tiempos como JSON para `--tiempos=` del poster. Se lee en
 * cada corrida y ya viene validado (rangos) por tiempos.js.
 */
export function getTiemposPoster() {
  return JSON.stringify(tiemposParaPoster(leerPublishConfig()));
}
