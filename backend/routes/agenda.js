import { Router } from 'express';
import { createRequire } from 'module';
import { v4 as uuid } from 'uuid';
import { getDB, transaccion } from '../db/database.js';
import { startGroupPublish, agendaSchedulerState, classifyFailure, CAUSAS } from '../lib/groupPublisher.js';
import { registrarPlan } from '../lib/plans.js';
import { planDuplicacionDia, duplicarPublicacion, acotarPlan, deshacerDuplicacion } from '../lib/duplicarDia.js';
import { aggregateEstado } from '../lib/agendaEstado.js';

// La normalización de nombres de grupo vive en el compositor (es la que hace
// que el cursor encuentre el grupo aunque cambie de emoji o acento). Se importa
// el archivo tal cual en vez de reimplementarla acá: si el compositor y la
// agenda no normalizan igual, el cursor se descoloca en silencio. Va por
// createRequire porque ese archivo es CommonJS (lo comparte el poster) y este
// backend es ESM.
const require_ = createRequire(import.meta.url);
const { normGrupo } = require_('../../utilidades/fb-ranking/lote_grupos.js');

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

  // Horarios que la publicación tuvo antes de reprogramarse a mano. Van aparte
  // de los destinos: la distribución crea un clon por franja, pero el
  // reprogramado manual sólo deja rastro del horario, no de los grupos.
  const planesPorPub = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const planes = db.prepare(`
      SELECT id, publication_id, fecha, origen, created_at
      FROM publication_plans
      WHERE publication_id IN (${ids.map(() => '?').join(',')})
      ORDER BY fecha DESC
    `).all(...ids);
    for (const pl of planes) {
      const arr = planesPorPub.get(pl.publication_id);
      if (arr) arr.push(pl);
    }
  }

  const eventos = pubs.map(p => {
    const destinos = destinosPorPub.get(p.id) || [];
    const { estado, etiqueta } = aggregateEstado(destinos, nowMs);
    const activos = destinos.filter(x => ACTIVE_STATUSES.includes(x.status));
    // `total_destinos` cuenta SOLO la planificación actual: lo que quedó
    // archivado (reprogramado como nueva planificación) es histórico y se
    // muestra aparte en el detalle.
    const historico = destinos.filter(x => x.status === 'archived').length;

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
      total_destinos: destinos.length - historico,
      historial: historico,
      planes: planesPorPub.get(p.id) || [],
      destinos_activos: activos.length,
      publicados: destinos.filter(x => x.status === 'published').length,
      errores: destinos.filter(x => x.status === 'error').length,
      omitidos: destinos.filter(x => x.status === 'omitted').length,
      destinos: destinos.map(x => {
        // La nota guarda el mensaje crudo del poster. Para los destinos que
        // quedaron en error, se agrega una pista con la causa conocida, para
        // que el detalle no muestre "Error" sin más: el usuario tiene que poder
        // distinguir "reintentá" de "prendé Chrome" de "logueate de nuevo".
        const causa = x.status === 'error' ? classifyFailure(x.notes || '') : null;
        return {
          id: x.id,
          group_name: x.group_name,
          group_url: x.group_url,
          status: x.status,
          scheduled_at: x.scheduled_at,
          published_at: x.published_at,
          notes: x.notes || '',
          causa,
          pista: causa ? CAUSAS[causa] : null,
          images: parseImages(x.images),
          variant_text: x.variant_text || '',
          pending_approval: !!x.pending_approval,
          updated_at: x.updated_at,
        };
      }),
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
 * Qué grupos ya se usaron en un día local (YYYY-MM-DD).
 *
 * Es la consulta que pinta el Planificador: cada grupo que ya tiene una
 * publicación con hora en ese día se marca en amarillo, y si además lo
 * seleccionás para la publicación que estás armando, se pone naranja con
 * aviso de que se va a repetir en el mismo grupo el mismo día.
 *
 * `exclude` es la publicación que se está editando: si no se excluye, al
 * guardar los cambios una publicación se marcaría a sí misma como repetida.
 * `archived` y `cancelled` quedan afuera porque no son publicaciones del día,
 * son historial o planificación desarmada.
 */
router.get('/uso-dia', (req, res) => {
  const db = getDB();
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : '';
  const pad = n => String(n).padStart(2, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
  }

  // Mismo criterio que el rango del calendario: el día local se acota con la
  // medianoche local, convertida a UTC, porque scheduled_at vive en UTC.
  const desdeIso = new Date(`${fecha}T00:00:00`).toISOString();
  const hastaIso = new Date(new Date(`${fecha}T00:00:00`).getTime() + 86400000).toISOString();

  const filas = db.prepare(`
    SELECT pq.id, pq.publication_id, pq.group_name, pq.scheduled_at, pq.status,
           p.product_name
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.publication_id IS NOT NULL
      AND pq.publication_id <> ?
      AND pq.scheduled_at IS NOT NULL
      AND pq.scheduled_at >= ? AND pq.scheduled_at < ?
      AND pq.status IN ('pending','published','error')
    ORDER BY pq.scheduled_at ASC
  `).all(exclude, desdeIso, hastaIso);

  const porGrupo = new Map();
  for (const f of filas) {
    const d = new Date(String(f.scheduled_at).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) continue;
    const clave = (f.group_name || '').toLowerCase();
    if (!clave) continue;
    const item = {
      group_name: f.group_name,
      publication_id: f.publication_id,
      product_name: f.product_name || 'Sin producto',
      scheduled_at: f.scheduled_at,
      status: f.status,
      hora_local: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
    // Un grupo puede aparecer varias veces en el día: para el aviso interesa la
    // primera vez que se usó, que es la que se está repitiendo.
    if (!porGrupo.has(clave)) porGrupo.set(clave, item);
  }

  res.json({ fecha, usos: [...porGrupo.values()] });
});

/**
 * Orden de rotación de grupos para "Distribuir en el día" (tilde "Rotar").
 *
 * Devuelve los siguientes `n` grupos del catálogo —mismo orden que el
 * Planificador (sort_order, name)— arrancando DESPUÉS del último grupo ya usado
 * hoy. "Usado hoy" es una publicación con destino pendiente, publicado o con
 * error en ese día local: el mismo criterio que /uso-dia.
 *
 * El arranque es el índice de catálogo MÁS ALTO entre los usados. Como el
 * catálogo está ordenado, todo lo que queda por delante de ese índice está sin
 * usar, así que los primeros elegidos siempre son grupos que hoy todavía no
 * salieron; recién se repiten cuando se da toda la vuelta. Si hoy no se usó
 * ninguno, arranca del principio (índice 0).
 *
 * El llamador lo pide ANTES de crear las copias: la rotación refleja el uso
 * previo a esta distribución, no las copias que se están por crear. Volver a
 * repartir más tarde ve esas copias ya en la cola y continúa después.
 */
router.get('/rotacion-grupos', (req, res) => {
  const db = getDB();
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  const n = Math.max(1, Math.min(500, Number(req.query.n) || 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
  }

  const grupos = db.prepare(
    'SELECT id, name, url FROM facebook_groups ORDER BY sort_order ASC, name ASC'
  ).all();
  if (!grupos.length) return res.json({ fecha, total: 0, inicio: 0, usados: 0, grupos: [] });

  const desdeIso = new Date(`${fecha}T00:00:00`).toISOString();
  const hastaIso = new Date(new Date(`${fecha}T00:00:00`).getTime() + 86400000).toISOString();
  const usados = db.prepare(`
    SELECT DISTINCT group_name FROM publication_queue
    WHERE publication_id IS NOT NULL
      AND group_name IS NOT NULL AND group_name <> ''
      AND scheduled_at IS NOT NULL AND scheduled_at >= ? AND scheduled_at < ?
      AND status IN ('pending','published','error')
  `).all(desdeIso, hastaIso).map((r) => r.group_name);

  const usadosNorm = new Set(usados.map((g) => normGrupo(g)));
  let ultimo = -1;
  grupos.forEach((g, i) => { if (usadosNorm.has(normGrupo(g.name))) ultimo = i; });
  const inicio = ultimo + 1;               // puede ser total: se envuelve con %

  // Si se piden más copias que grupos, se da la vuelta y se repiten: cada copia
  // tiene que caer en algún lado. Es el mismo wrap que el compositor.
  const salida = [];
  for (let k = 0; k < n; k++) salida.push(grupos[(inicio + k) % grupos.length]);

  res.json({ fecha, total: grupos.length, inicio, usados: usados.length, grupos: salida });
});

// ══════════════════════════════ duplicar un día entero ════════════════════
// El día de origen NO se toca: se crean copias de sus publicaciones en el día
// destino. La lógica (plan, copia y vínculos) vive en lib/duplicarDia.js; acá
// sólo están los tres endpoints. Ver el comentario de ese archivo para por qué
// duplicar y no mover.

/**
 * Reprogramar UNA publicación a `iso`, dejando coherentes el calendario y los
 * destinos: se actualiza publication_date (la fecha del evento) y el
 * scheduled_at de cada fila pendiente, para que el calendario y el disparador
 * no se contradigan.
 *
 * Lo que ya salió pasa a 'archived' y se vuelve a comprometer la publicación en
 * el horario nuevo: reprogramar algo ya publicado es una planificación NUEVA, y
 * el evento tiene que volver a "Programada" sin borrar el historial.
 *
 * OJO: esto reescribe el horario de la publicación, así que NO puede ser la
 * operación de "pasar un día a otro" (eso es /duplicar-dia, que clona y deja el
 * origen intacto justamente para no comerse el historial del día anterior).
 *
 * "Distribuir en el día" tampoco pasa por acá: crea una publicación clonada por
 * franja (POST /api/publications/:id/planificar), así que cada distribución
 * queda visible como un evento propio del calendario.
 */
function aplicarMovimiento(db, pubId, iso, origen = 'reprogramar') {
  registrarPlan(db, pubId, iso, origen);
  db.prepare("UPDATE publications SET publication_date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(iso, pubId);
  db.prepare(`
    UPDATE publication_queue
    SET scheduled_at = ?, updated_at = datetime('now')
    WHERE publication_id = ? AND status = 'pending'
  `).run(iso, pubId);

  const publicados = db.prepare(`
    SELECT group_name, group_url, variant_index, variant_text, images
    FROM publication_queue
    WHERE publication_id = ? AND status = 'published'
  `).all(pubId);

  if (publicados.length) {
    db.prepare(`
      UPDATE publication_queue
      SET status = 'archived', updated_at = datetime('now')
      WHERE publication_id = ? AND status = 'published'
    `).run(pubId);
    for (const g of publicados) {
      // La sentencia se prepara en cada vuelta: Statement.run() libera el
      // statement al terminar, así que reutilizar una fallaría.
      db.prepare(`
        INSERT INTO publication_queue (id, publication_id, group_name, group_url,
          variant_index, variant_text, scheduled_at, images)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), pubId, g.group_name, g.group_url,
        g.variant_index, g.variant_text || '', iso, g.images || '[]');
    }
  }
  return publicados.length;
}

function leerFechas(req, res) {
  const desde = typeof req.body?.desde === 'string' ? req.body.desde : req.query.desde;
  const hasta = typeof req.body?.hasta === 'string' ? req.body.hasta : req.query.hasta;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) {
    res.status(400).json({ error: 'Fechas inválidas (YYYY-MM-DD)' });
    return null;
  }
  if (desde === hasta) {
    res.status(400).json({ error: 'El día destino tiene que ser distinto del día de origen' });
    return null;
  }
  // Hora de arranque del bloque, opcional. Viene en el query del GET (vista previa)
  // y en el body del POST, y tiene que ser el MISMO valor en los dos: si el plan
  // se calcula a una hora y se aplica a otra, la vista previa miente.
  const hora = typeof req.body?.hora_inicio === 'string' ? req.body.hora_inicio : req.query.hora_inicio;
  const hora_inicio = /^\d{1,2}:\d{2}$/.test(String(hora || '')) ? String(hora) : null;
  return { desde, hasta, hora_inicio };
}

/** Vista previa: lo mismo que se va a aplicar, sin escribir nada. */
router.get('/duplicar-dia', (req, res) => {
  const args = leerFechas(req, res);
  if (!args) return;
  res.json(planDuplicacionDia(getDB(), args.desde, args.hasta, args.hora_inicio));
});

/**
 * Aplicar la duplicación. Es un todo o nada: o se copia el día entero, o no se
 * tocó nada.
 *
 * `ids` acota qué publicaciones van: la vista previa las tilda una por una y manda
 * sólo las marcadas. Sin `ids` se copia el día completo (lo que hace cualquier
 * cliente que no sepa de la selección).
 *
 * `hora_inicio` corre el día como bloque desde esa hora; sin ella cada
 * publicación conserva la suya. El plan se vuelve a calcular acá y recién después
 * se acota, así que la selección nunca copia algo que el plan no pensaba copiar.
 *
 * Va en transaccion() y no en BEGIN/COMMIT a mano por el motivo que explica
 * database.js: guardar el archivo cierra la transacción con rollback.
 */
router.post('/duplicar-dia', (req, res) => {
  const db = getDB();
  const args = leerFechas(req, res);
  if (!args) return;

  const plan = acotarPlan(planDuplicacionDia(db, args.desde, args.hasta, args.hora_inicio), req.body?.ids);
  if (!plan.duplicadas.length) {
    return res.json({ ...plan, aplicado: true, duplicadas: [] });
  }

  try {
    transaccion(db, () => {
      for (const d of plan.duplicadas) {
        d.clon_id = duplicarPublicacion(db, d.id, d.a_iso, args.desde, args.hasta);
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo duplicar el día: ' + err.message });
  }

  res.json({ ...plan, aplicado: true });
});

/**
 * Deshacer una duplicación.
 *
 * La lógica (qué se borra y qué se conserva) vive en
 * `deshacerDuplicacion()` en backend/lib/duplicarDia.js, no acá: es una decisión
 * con reglas —por destino y no por copia— que hay que poder testear contra una
 * base en memoria, y una regla metida en un handler de Express no se prueba sin
 * levantar el servidor. Los motivos de por qué la regla es por destino están en
 * esa función; el resumen de qué se conservó sale en el `resumen` de la respuesta.
 *
 * Va en transaccion(): si una de las copias se rebota, no queda el día a medias
 * con la mitad de las copias borradas y la otra mitad viva.
 */
router.post('/duplicar-dia/deshacer', (req, res) => {
  const db = getDB();
  const clones = Array.isArray(req.body?.clones)
    ? req.body.clones.filter(c => typeof c === 'string' && c)
    : [];
  if (!clones.length) return res.status(400).json({ error: 'No hay copias para deshacer' });

  let salida;
  try {
    salida = transaccion(db, () => deshacerDuplicacion(db, clones));
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo deshacer: ' + err.message });
  }

  res.json({ ok: true, ...salida });
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
 * Reprogramar UN evento: mueve la fecha del evento y de todos sus destinos
 * pendientes a la vez. Se actualiza publication_date (que es la fecha del
 * evento) y el scheduled_at de cada fila pendiente, para que el calendario y el
 * disparador no se contradigan.
 *
 * OJO: reprogramar UNA publicación reescribe su historial (lo publicado pasa a
 * 'archived' y se vuelve a agendar). Para llevar un día entero a otro día sin
 * perder el historial del de origen está /duplicar-dia, que clona.
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
    aplicarMovimiento(db, pubId, new Date(ms).toISOString(), 'reprogramar');
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

/**
 * Descartar UN destino suelto.
 *
 * Sirve para el caso en que una publicación tiene varios grupos y uno quedó en
 * error para siempre (grupo dado de baja, sin permiso, id roto): sin esto, ese
 * error queda ahí y el evento nunca llega a "Publicada" porque siempre hay un
 * destino en error, aunque los demás hayan salido bien.
 *
 * Se pasa a 'cancelled' (igual que al desarmar) en vez de borrarse, así se
 * conserva el rastro de qué se intentó y por qué falló.
 *
 * Por seguridad sólo se acepta desde 'error' u 'omitted'. Descartar un destino
 * ya publicado falsearía el historial, así que se rechaza.
 */
router.patch('/:id/destinos/:destinoId', (req, res) => {
  const db = getDB();
  const pubId = req.params.id;
  const destId = req.params.destinoId;

  const destino = db.prepare(`
    SELECT id, status FROM publication_queue WHERE id = ? AND publication_id = ?
  `).get(destId, pubId);
  if (!destino) return res.status(404).json({ error: 'Destino no encontrado en esta publicación' });
  if (!['error', 'omitted'].includes(destino.status)) {
    return res.status(400).json({
      error: `Sólo se puede descartar un destino que falló (este está en "${destino.status}")`,
    });
  }

  db.prepare(`
    UPDATE publication_queue
    SET status = 'cancelled', notes = TRIM(COALESCE(notes,'') || ?), updated_at = datetime('now')
    WHERE id = ? AND publication_id = ?
  `).run(' | descartado manualmente', destId, pubId);

  res.json({ ok: true, destino_id: destId, status: 'cancelled' });
});

export default router;
