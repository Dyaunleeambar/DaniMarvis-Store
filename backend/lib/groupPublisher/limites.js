// Límites de ritmo, corte automático (breaker), guardia anti-duplicado y la
// decisión del disparador por fecha. La política pura (evaluarLimites) está
// separada de las lecturas de base (decisionActual) a propósito.
import { getDB } from '../../db/database.js';
import { fechaMs, toIsoUtc } from './util.js';
import { DEFAULT_AGENDA } from './config.js';
import { countAttemptsSince, lastAttemptInfo } from './estado.js';

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
export function marcarIntentoAhora() {
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
    intentosHora,
    breaker: leerBreaker(),
  });
  return { ...decision, intentosHora };
}
