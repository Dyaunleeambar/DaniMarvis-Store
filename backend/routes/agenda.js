import { Router } from 'express';
import { getDB } from '../db/database.js';
import { startGroupPublish, agendaSchedulerState } from '../lib/groupPublisher.js';

const router = Router();

// La agenda reemplaza a la "Cola de Publicaciones" como pantalla, pero la tabla
// publication_queue NO se tocó: sigue siendo el registro de destinos, uno por
// grupo. Lo que cambia es que el estado del calendario se DERIVA de esas filas
// en vez de guardarse en una columna nueva.
//
// Derivarlo y no almacenarlo importa por una razón práctica: una publicación
// que se desarma (el usuario la cancela, o la saca de la cola) tiene que volver
// a ser "material" sin que haya que acordarse de borrar un estado en dos lados.
// Con 'cancelled' como estado terminal, el evento sigue teniendo historial pero
// ya no cuenta como pendiente.

const MAX_IMAGES = 10;

/** Estados que un destino puede tener. 'cancelled' y 'omitted' los usa la agenda. */
const ACTIVE_STATUSES = ['pending', 'published', 'error'];

function parseImages(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_IMAGES) : [];
  } catch { return []; }
}

/**
 * Estado agregado de un evento, a partir de sus destinos.
 *
 * Se calcula acá y no en la BD porque depende de `now`: "Programada" y
 * "Vencida" son el mismo conjunto de filasPending en momentos distintos.
 */
function aggregateEstado(destinos, nowMs) {
  const st = destinos.map(d => d.status);
  const has = s => st.includes(s);

  const pendientes = destinos.filter(d => d.status === 'pending');
  const publicadas = destinos.filter(d => d.status === 'published');
  const errores = destinos.filter(d => d.status === 'error');
  const canceladas = destinos.filter(d => d.status === 'cancelled');
  const omitidas = destinos.filter(d => d.status === 'omitted');

  if (destinos.length === 0) return { estado: 'material', etiqueta: 'Material' };

  // Una publicación que se desarmó deja de contar, pero se muestra como tal.
  if (pendientes.length === 0 && publicadas.length === 0) {
    if (omitidas.length) return { estado: 'omitida', etiqueta: 'Omitida' };
    if (canceladas.length) return { estado: 'cancelada', etiqueta: 'Cancelada' };
  }

  if (publicadas.length === destinos.length) return { estado: 'publicada', etiqueta: 'Publicada' };
  if (errores.length && !pendientes.length) return { estado: 'error', etiqueta: 'Error' };

  // Quedan pendientes: vencida o programada según la hora.
  if (publicadas.length && pendientes.length) {
    const vencidas = pendientes.some(d => d._ms !== null && d._ms <= nowMs);
    return { estado: vencidas ? 'parcial_vencida' : 'parcial', etiqueta: vencidas ? 'Parcial · vencida' : 'Parcial' };
  }
  if (pendientes.length) {
    const vencidas = pendientes.filter(d => d._ms !== null && d._ms <= nowMs).length;
    if (vencidas && vencidas === pendientes.length) return { estado: 'vencida', etiqueta: 'Vencida' };
    if (vencidas) return { estado: 'parcial_vencida', etiqueta: 'Parcial · vencida' };
    return { estado: 'programada', etiqueta: 'Programada' };
  }
  return { estado: 'material', etiqueta: 'Material' };
}

/**
 * Agenda de un rango de fechas.
 *
 * `from`/`to` son días locales (YYYY-MM-DD). Se incluyen los eventos cuyo día
 * local caiga en el rango, usando la zona del servidor para no mover nada de
 * día por un offset.
 */
router.get('/', (req, res) => {
  const db = getDB();
  const nowMs = Date.now();

  // Sin rango: se devuelve lo de este mes más lo pendiente, que es lo que
  // alcanza para pintar el calendario.
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const fromStr = typeof req.query.from === 'string' && req.query.from ? req.query.from : ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const toStr = typeof req.query.to === 'string' && req.query.to ? req.query.to : ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));

  // Los límites del rango se pasan a UTC ISO para comparar contra el
  // publication_date (que ya vive en UTC después de migratePubAgenda).
  // OJO con el `to`: el calendario pide un rango INCLUSIVO de días, así que
  // el corte tiene que ser el inicio del día SIGUIENTE. Con la medianoche del
  // mismo día `to` se perdía todo lo agendado después de las 00:00 (o sea,
  // casi todo el último día).
  const fromIso = new Date(`${fromStr}T00:00:00`).toISOString();
  const toExclusiveIso = new Date(new Date(`${toStr}T00:00:00`).getTime() + 86400000).toISOString();

  const pubs = db.prepare(`
    SELECT p.id, p.product_id, p.product_name, p.publish_text, p.images,
           p.publication_date, p.created_at, p.sort_order
    FROM publications p
    WHERE p.publication_date >= ? AND p.publication_date < ?
    ORDER BY p.publication_date ASC, p.sort_order ASC
  `).all(fromIso, toExclusiveIso);

  // Los destinos de todas esas publicaciones, en una sola consulta.
  const ids = pubs.map(p => p.id);
  const destinosPorPub = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const filas = db.prepare(`
      SELECT id, publication_id, group_name, group_url, status, scheduled_at,
             published_at, notes, images, variant_text, pending_approval, updated_at
      FROM publication_queue
      WHERE publication_id IN (${ids.map(() => '?').join(',')})
      ORDER BY scheduled_at ASC, created_at ASC
    `).all(...ids);
    for (const f of filas) {
      const arr = destinosPorPub.get(f.publication_id);
      if (!arr) continue;
      const ms = f.scheduled_at ? new Date(String(f.scheduled_at).replace(' ', 'T')).getTime() : null;
      arr.push({
        ...f,
        images: parseImages(f.images),
        _ms: Number.isNaN(ms) ? null : ms,
      });
    }
  }

  const eventos = pubs.map(p => {
    const destinos = destinosPorPub.get(p.id) || [];
    const { estado, etiqueta } = aggregateEstado(destinos, nowMs);
    const activos = destinos.filter(x => ACTIVE_STATUSES.includes(x.status));

    return {
      id: p.id,
      product_id: p.product_id,
      product_name: p.product_name,
      publish_text: p.publish_text,
      images: parseImages(p.images),
      // El calendario corre en hora local: se manda el día y la hora ya
      // resueltos acá para que el front no tenga que recomputar el offset y
      // no vuelva a aparecer el desfase de 4 horas.
      fecha: p.publication_date,
      dia_local: p.publication_date ? new Date(p.publication_date).getDate() : null,
      mes_local: p.publication_date ? new Date(p.publication_date).getMonth() : null,
      anio_local: p.publication_date ? new Date(p.publication_date).getFullYear() : null,
      hora_local: p.publication_date
        ? `${pad(new Date(p.publication_date).getHours())}:${pad(new Date(p.publication_date).getMinutes())}`
        : null,
      estado,
      estado_label: etiqueta,
      total_destinos: destinos.length,
      destinos_activos: activos.length,
      publicados: destinos.filter(x => x.status === 'published').length,
      errores: destinos.filter(x => x.status === 'error').length,
      omitidos: destinos.filter(x => x.status === 'omitted').length,
      destinos: destinos.map(x => ({
        id: x.id,
        group_name: x.group_name,
        group_url: x.group_url,
        status: x.status,
        scheduled_at: x.scheduled_at,
        published_at: x.published_at,
        notes: x.notes || '',
        images: x.images,
        variant_text: x.variant_text || '',
        pending_approval: !!x.pending_approval,
        updated_at: x.updated_at,
      })),
    };
  });

  // Destinos que quedaron sin publicación (se borran al reiniciar el server,
  // pero entre arranques existen). Son un peligro concreto: el worker legado
  // los agarra igual porque su SELECT es un LEFT JOIN, y publica un post sin
  // texto. Por eso el calendario los avisa en vez de dejarlos pasar.
  let huerfanos = 0;
  try {
    huerfanos = db.prepare(`
      SELECT COUNT(*) AS c
      FROM publication_queue pq
      LEFT JOIN publications p ON p.id = pq.publication_id
      WHERE pq.status <> 'published' AND p.id IS NULL
    `).get()?.c || 0;
  } catch { /* si la tabla no existe todavía, 0 */ }

  res.json({
    from: fromStr,
    to: toStr,
    server_now: new Date().toISOString(),
    huerfanos,
    disparador: (() => {
      // El estado del reloj se manda dentro de la respuesta de la agenda para
      // que el calendario pueda avisar "apagado" sin una segunda peticion: es
      // la informacion mas importante de la pantalla (si esto no dispara, el
      // usuario programa para nada).
      try { return agendaSchedulerState(); } catch { return null; }
    })(),
    eventos,
  });
});

/**
 * Avisos de separación para el Planificador.
 *
 * Ya no hay cooldown de 4h, así que la app no va a impedir nada: la decisión es
 * del usuario. Pero avisar es otra cosa y sigue siendo útil — varios posts al
 * mismo grupo en la misma hora es exactamente el patrón que Facebook castiga.
 * NO bloquea: devuelve advertencias y el modal las muestra.
 */
router.get('/conflicts', (req, res) => {
  const db = getDB();
  const at = typeof req.query.at === 'string' && req.query.at ? req.query.at : new Date().toISOString();
  const grupos = req.query.groups ? String(req.query.groups).split(',').map(s => s.trim()).filter(Boolean) : [];
  const ventanaMs = Math.max(0, Number(req.query.window_h) || 2) * 3600 * 1000;
  const excludePub = typeof req.query.exclude === 'string' ? req.query.exclude : '';

  if (!grupos.length) return res.json({ at, avisos: [] });

  const tMs = new Date(at).getTime();
  if (Number.isNaN(tMs)) return res.status(400).json({ error: 'Fecha inválida' });
  const desde = new Date(tMs - ventanaMs).toISOString();
  const hasta = new Date(tMs + ventanaMs).toISOString();

  const avisos = [];
  for (const g of grupos) {
    const filas = db.prepare(`
      SELECT pq.id, pq.publication_id, pq.scheduled_at, pq.published_at, pq.status,
             p.product_name, p.publication_date
      FROM publication_queue pq
      LEFT JOIN publications p ON p.id = pq.publication_id
      WHERE LOWER(pq.group_name) = LOWER(?)
        AND pq.publication_id <> ?
        AND pq.scheduled_at IS NOT NULL
        AND pq.scheduled_at BETWEEN ? AND ?
        AND pq.status IN ('pending','published')
      ORDER BY pq.scheduled_at ASC
    `).all(g, excludePub, desde, hasta);

    for (const f of filas) {
      const dif = Math.abs(new Date(String(f.scheduled_at).replace(' ', 'T')).getTime() - tMs) / 60000;
      avisos.push({
        group_name: g,
        publication_id: f.publication_id,
        product_name: f.product_name || 'Sin producto',
        scheduled_at: f.scheduled_at,
        status: f.status,
        minutos_de_diferencia: Math.round(dif),
      });
    }
  }
  avisos.sort((a, b) => a.minutos_de_diferencia - b.minutos_de_diferencia);
  res.json({ at, ventana_h: ventanaMs / 3600000, avisos });
});

/**
 * Publicar un evento ahora, saltándose la espera.
 *
 * Destaca del disparador por fecha: no mira la hora, publica YA lo pendiente
 * del evento que se le pida. Es el botón "Publicar ahora" del detalle.
 *
 * No espera al run (devuelve 202 con el runId): el poster tiene --max-seconds
 * =300 y entre posts hay 45-135s de separación, así que una corrida son
 * minutos. El resultado se lee por polling en /api/group-publish/status.
 *
 * `ids` explícitos ⇒ runGroupPublish() los filtra sobre dueCandidates() y se
 * salta pickForRun(), o sea que no aplica cap, franja, gap ni cooldown.
 */
router.post('/:id/run', (req, res) => {
  const db = getDB();
  const pubId = req.params.id;
  const existe = db.prepare('SELECT id FROM publications WHERE id = ?').get(pubId);
  if (!existe) return res.status(404).json({ error: 'Publicación no encontrada' });

  const ids = db.prepare(
    "SELECT id FROM publication_queue WHERE publication_id = ? AND status = 'pending'"
  ).all(pubId).map(r => r.id);

  if (!ids.length) {
    return res.status(400).json({ error: 'Este evento no tiene destinos pendientes de publicar' });
  }

  // runNow: el evento puede estar agendado para más adelante, y "Publicar
  // ahora" tiene que salir igual. Sin esto, dueCandidates() filtraría los
  // destinos por scheduled_at <= now y la corrida terminaría vacía.
  const r = startGroupPublish({ auto: false, ids, runNow: true });
  if (r.skipped) return res.status(409).json(r);
  res.status(202).json(r);
});

/**
 * Reprogramar un evento: mueve la fecha del evento y de todos sus destinos
 * pendientes a la vez. Se actualiza publication_date (que es la fecha del
 * evento) y el scheduled_at de cada fila pendiente, para que el calendario y el
 * disparador no se contradigan.
 */
router.patch('/:id', (req, res) => {
  const db = getDB();
  const pubId = req.params.id;
  const existe = db.prepare('SELECT id FROM publications WHERE id = ?').get(pubId);
  if (!existe) return res.status(404).json({ error: 'Publicación no encontrada' });

  const { scheduled_at, status } = req.body || {};

  if (scheduled_at !== undefined) {
    const ms = new Date(scheduled_at).getTime();
    if (Number.isNaN(ms)) return res.status(400).json({ error: 'Fecha inválida' });
    const iso = new Date(ms).toISOString();
    db.prepare("UPDATE publications SET publication_date = ?, updated_at = datetime('now') WHERE id = ?")
      .run(iso, pubId);
    // Solo los que siguen pendientes: uno ya publicado no se toca (el
    // published_at es historial real y no se reescribe).
    db.prepare(`
      UPDATE publication_queue
      SET scheduled_at = ?, updated_at = datetime('now')
      WHERE publication_id = ? AND status = 'pending'
    `).run(iso, pubId);
  }

  if (status !== undefined) {
    if (!['cancelled'].includes(status)) {
      return res.status(400).json({ error: `Estado no permitido: ${status}` });
    }
    db.prepare(`
      UPDATE publication_queue
      SET status = 'cancelled', updated_at = datetime('now')
      WHERE publication_id = ? AND status = 'pending'
    `).run(pubId);
  }

  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(pubId);
  try { pub.images = JSON.parse(pub.images || '[]'); } catch { pub.images = []; }
  res.json(pub);
});

/**
 * Reintentar los destinos que fallaron: vuelven a 'pending' con la misma hora.
 * Los que llevan más de catchup_hours vencidos los vuelve a marcar 'omitted' en
 * el próximo tick, así que hay que reprogramarlos si llevan mucho esperando.
 */
router.post('/:id/retry', (req, res) => {
  const db = getDB();
  const pubId = req.params.id;
  const info = db.prepare(`
    UPDATE publication_queue
    SET status = 'pending', updated_at = datetime('now')
    WHERE publication_id = ? AND status IN ('error','omitted')
  `).run(pubId);
  res.json({ requeued: info });
});

export default router;
