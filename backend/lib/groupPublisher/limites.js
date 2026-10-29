// Límites de ritmo, corte automático (breaker), guardia anti-duplicado y la
// decisión del disparador por fecha. La política pura (evaluarLimites) está
// separada de las lecturas de base (decisionActual) a propósito.
import { getDB } from '../../db/database.js';
import { fechaMs, toIsoUtc } from './util.js';
import { DEFAULT_AGENDA } from './config.js';
import { attemptTimesSince, countAttemptsSince, lastAttemptInfo, lastAttemptGapMs } from './estado.js';

// Todo lo de acá gira alrededor de una idea: el disparador por fecha NO puede
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
export function marcarIntentoAhora(cfg = null) {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    pc._ultimoIntento = { at: toIsoUtc(new Date()), ms: Date.now() };
    // En modo 'rango' se sortea ACÁ, una vez por publicación, y se guarda en la marca.
    const gapMs = sortearGapMs(cfg);
    if (gapMs) pc._ultimoIntento.gap_ms = gapMs;
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

// ----------------------------------------------------------- gap por rango ---
//
// El gap puede ser fijo (siempre `min_gap_min`) o un valor al azar dentro de
// [min_gap_min, gap_max_min]. Si fuera al azar, el valor se SORTEA UNA SOLA VEZ por
// publicación (al marcar el inicio del intento) y se guarda en la marca: el
// disparador corre cada minuto, y sortear en cada tick haría que el gap efectivo
// tendiera al mínimo del rango (cada minuto es otra oportunidad de sacar uno corto).

const minutosDe = (v, def) => Math.max(1, Number(v) || def);

/**
 * Sortea el gap (ms) para la PRÓXIMA publicación. null si el modo es fijo. `rand` se
 * inyecta para poder probarlo; devuelve un valor entre 0 y 1.
 */
export function sortearGapMs(cfg, rand = Math.random) {
  if (!cfg || cfg.gap_modo !== 'rango') return null;
  const minMs = minutosDe(cfg.min_gap_min, DEFAULT_AGENDA.min_gap_min) * 60000;
  const maxMs = Math.max(minMs, (Number(cfg.gap_max_min) || 0) * 60000);
  const r = Math.min(1, Math.max(0, Number(rand()) || 0));
  return Math.round((minMs + r * (maxMs - minMs)) / 1000) * 1000; // resolución de 1 s
}

/**
 * Gap (ms) que rige AHORA: el fijo, o el sorteado al registrar el último intento,
 * acotado al rango vigente (si el usuario cambió el rango después del sorteo, el
 * valor viejo no se sale de él). Sin sorteo guardado (recién pasado a 'rango') se
 * usa el máximo, el lado prudente, y solo por esa vez.
 */
export function gapEfectivoMs(cfg, gapMsGuardado = null) {
  const minMs = minutosDe(cfg?.min_gap_min, DEFAULT_AGENDA.min_gap_min) * 60000;
  if (!cfg || cfg.gap_modo !== 'rango') return minMs;
  const maxMs = Math.max(minMs, (Number(cfg.gap_max_min) || 0) * 60000);
  const g = Number(gapMsGuardado);
  if (Number.isFinite(g) && g > 0) return Math.min(maxMs, Math.max(minMs, g));
  return maxMs;
}

const fmtMin = (n) => String(Math.round(n * 10) / 10);

const VENTANA_TOPE_MS = 3600000; // el tope "por hora" es una ventana deslizante de 60 min

/**
 * Minutos que faltan para que el tope por hora vuelva a dejar salir. Con `n`
 * intentos en la ventana y tope `C`, se libera cuando el intento número (n - C + 1)
 * en orden de antigüedad cumple la hora y sale de la ventana: ahí el conteo baja a
 * C - 1. null si no hay datos o todavía no se llegó al tope. Mínimo 1 min, para no
 * decir "0 min" mientras sigue frenado.
 */
export function minutosParaTope(tiempos, tope, nowMs = Date.now(), ventanaMs = VENTANA_TOPE_MS) {
  if (!Array.isArray(tiempos) || !(tope >= 1) || tiempos.length < tope) return null;
  const ordenados = tiempos.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ordenados.length < tope) return null;
  // El conteo es inclusivo (published_at >= ahora - 60 min): un intento sale de la
  // ventana 1 ms DESPUÉS de cumplir la hora. Sin ese +1, justo en el borde el mensaje
  // diría "puede salir" y el tope seguiría frenando un minuto más.
  const sale = ordenados[ordenados.length - tope] + ventanaMs + 1;
  return Math.max(1, Math.ceil((sale - nowMs) / 60000));
}

/** "5 min" o "1–3 min (al azar)": para los logs y el estado. */
export function describirGap(cfg) {
  const min = minutosDe(cfg?.min_gap_min, DEFAULT_AGENDA.min_gap_min);
  if (cfg?.gap_modo === 'rango') {
    const max = Math.max(min, Number(cfg.gap_max_min) || 0);
    return `${fmtMin(min)}–${fmtMin(max)} min (al azar)`;
  }
  return `${fmtMin(min)} min`;
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
export function evaluarLimites({ cfg, nowMs = Date.now(), lastAttemptMs = null, intentosHora = 0, breaker = null, gapMsGuardado = null, intentosTiempos = null }) {
  const b = breaker || { failures: 0, until: 0, reason: '' };
  if (b.until && nowMs < b.until) {
    const min = Math.ceil((b.until - nowMs) / 60000);
    const n = b.fallos || b.failures;
    return { ok: false, motivo: `corte automático: ${n} fallo${n === 1 ? '' : 's'} seguido${n === 1 ? '' : 's'}`
      + (b.reason ? ` (${b.reason.slice(0, 60)})` : '')
      + ` — reintenta en ${min} min`, codigo: 'breaker' };
  }
  const gapMs = gapEfectivoMs(cfg, gapMsGuardado);
  if (lastAttemptMs) {
    const faltan = Math.ceil((lastAttemptMs + gapMs - nowMs) / 60000);
    if (faltan > 0) return { ok: false, motivo: `separación mínima de ${fmtMin(gapMs / 60000)} min: faltan ${faltan} min`, codigo: 'gap' };
  }
  const topeHora = Math.max(1, Number(cfg?.max_per_hour) || DEFAULT_AGENDA.max_per_hour);
  if (intentosHora >= topeHora) {
    // Con las horas de los intentos se dice cuánto falta; sin ellas, el mensaje de siempre.
    const falta = minutosParaTope(intentosTiempos, topeHora, nowMs);
    return {
      ok: false,
      motivo: `tope de ${topeHora} publicaciones por hora alcanzado`
        + (falta ? ` — puede salir otra en ${falta} min` : ''),
      codigo: 'tope_hora',
      ...(falta ? { esperaMin: falta } : {}),
    };
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

  // Los resultados 'revisar' (el clic se hizo pero no se pudo confirmar el envío:
  // típico de internet lento) NO quedan 'published', pero el post PUEDE haber
  // salido. Se cuentan como "posiblemente publicado" para no mandarlo dos veces:
  // es preferible un falso duplicado evitado que dos posts iguales en el grupo.
  // Se usa `updated_at` porque `published_at` es NULL en estas filas.
  const posibles = db.prepare(`
    SELECT pq.group_name, COALESCE(NULLIF(pq.variant_text,''), p.publish_text, '') AS texto,
           pq.updated_at AS published_at
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.notes LIKE '%auto:revisar%'
      AND replace(pq.updated_at,'T',' ') >= ?
  `).all(desdeSql);

  for (const r of posibles) yaSalieron.push(r);

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
export function marcarDuplicados(candidatos, cfg, ahoraMs = Date.now()) {
  try {
    return marcarDuplicadosEn(getDB(), candidatos, cfg, ahoraMs);
  } catch (err) {
    console.error('[agenda] no se pudo revisar duplicados:', err.message);
    return { omitidos: 0, ids: [] };
  }
}

/**
 * Lee el estado que necesita `evaluarLimites` desde la base y devuelve la
 * decisión del disparador con cuántos intentos hubo en la última hora.
 */
export function decisionActual(cfg, nowMs = Date.now()) {
  const intentosHora = countAttemptsSince(nowMs - 3600000);
  const decision = evaluarLimites({
    cfg,
    nowMs,
    lastAttemptMs: lastAttemptInfo(),
    gapMsGuardado: cfg?.gap_modo === 'rango' ? lastAttemptGapMs() : null,
    intentosHora,
    intentosTiempos: attemptTimesSince(nowMs - 3600000),
    breaker: leerBreaker(),
  });
  return { ...decision, intentosHora };
}
