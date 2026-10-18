// Los DOS relojes del publicador: el worker con límites (cap, franja, gap) y el
// disparador por fecha (uno por evento, sin cap ni franja). Cada uno con su
// timer y su estado. No comparten nada entre sí.
import { getDB } from '../../db/database.js';
import { debugChromeReachable } from '../chromeLauncher.js';
import { toIsoUtc } from './util.js';
import { getAgendaConfig, getAutopublishConfig, getMasterConfig } from './config.js';
import { cuantosPorTick, decisionActual, leerBreaker, marcarDuplicados } from './limites.js';
import { getCurrentRun, getLastResult, isRunning, pickForRun, resolveGroupUrl, startGroupPublish } from './cola.js';

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

  if (isRunning()) return skip('ya hay una corrida en curso');

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
  const currentRun = getCurrentRun();
  return {
    running: isRunning(),
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
    lastResult: getLastResult(),
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

  if (isRunning()) return skip('ya hay una corrida en curso', 'ocupado');

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
