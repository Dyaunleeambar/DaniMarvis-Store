// Lecturas de estado de la cola que necesitan varios módulos (límites de ritmo
// y selección de candidatos). Solo leen la base; no deciden ni escriben.
import { getDB } from '../../db/database.js';
import { fechaMs, localDayBoundaries, localNow } from './util.js';

export function lastPublishedInfo() {
  const db = getDB();
  const row = db.prepare(
    "SELECT published_at FROM publication_queue WHERE status = 'published' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
  ).get();
  return row?.published_at || null;
}

export function countPublishedToday() {
  const db = getDB();
  const { start, end } = localDayBoundaries();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM publication_queue WHERE status = 'published' AND published_at >= ? AND published_at < ?"
  ).get(start, end);
  return Number(row?.c) || 0;
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

export function lastAttemptInfo() {
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
export function countAttemptsSince(msDesde) {
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

export function withinHoursWindow(cfg) {
  const h = localNow().getHours();
  return h >= (Number(cfg.hours_from) || 0) && h < (Number(cfg.hours_to) || 24);
}
