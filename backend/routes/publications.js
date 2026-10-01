import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';
import { publishToFacebook, publishToInstagram } from '../lib/facebook.js';
import { registrarPlan } from '../lib/plans.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const publications = db.prepare(`
    SELECT p.*,
           COALESCE(pd.provider_id, '') AS provider_id,
           COALESCE(pr.name, '') AS provider_name,
           COALESCE(pd.category, '') AS category,
           COALESCE(pd.catalog_visible, 1) AS catalog_visible,
           COALESCE(pd.price, 0) AS price
    FROM publications p
    LEFT JOIN products pd ON pd.id = p.product_id
    LEFT JOIN providers pr ON pr.id = pd.provider_id
    ORDER BY p.publication_date DESC, p.sort_order ASC
  `).all();
  for (const p of publications) {
    try { p.images = JSON.parse(p.images || '[]'); } catch { p.images = []; }
  }
  res.json(publications);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Publicación no encontrada' });
  try { pub.images = JSON.parse(pub.images || '[]'); } catch { pub.images = []; }
  res.json(pub);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { product_id, publish_text, images, publication_date } = req.body;
  if (!publish_text) {
    return res.status(400).json({ error: 'El texto de publicación es obligatorio' });
  }

  let productName = '';
  if (product_id) {
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(product_id);
    if (product) productName = product.name;
  }

  const id = uuid();
  const imagesStr = JSON.stringify(images || []);
  // UTC ISO, no 'YYYY-MM-DD HH:MM:SS' local: publication_date se compara contra
  // el reloj del disparador por fecha y contra published_at (que ya es UTC ISO).
  // El default anterior mezclaba los dos formatos.
  const date = publication_date || new Date().toISOString();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM publications').get();
  const sortOrder = (maxOrder?.m ?? -1) + 1;

  db.prepare(
    'INSERT INTO publications (id, product_id, product_name, publish_text, images, publication_date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, product_id || null, productName, publish_text, imagesStr, date, sortOrder);

  const created = db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
  try { created.images = JSON.parse(created.images || '[]'); } catch { created.images = []; }
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM publications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Publicación no encontrada' });

  const { product_id, publish_text, images, publication_date } = req.body;

  if (publish_text !== undefined && !publish_text) {
    return res.status(400).json({ error: 'El texto de publicación no puede estar vacío' });
  }

  if (product_id !== undefined) {
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(product_id);
    db.prepare("UPDATE publications SET product_id = ?, product_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(product_id || null, product ? product.name : '', req.params.id);
  }

  if (publish_text !== undefined) {
    db.prepare("UPDATE publications SET publish_text = ?, updated_at = datetime('now') WHERE id = ?")
      .run(publish_text, req.params.id);
  }

  if (images !== undefined) {
    db.prepare("UPDATE publications SET images = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(images), req.params.id);
  }

  if (publication_date !== undefined) {
    // Cambiar la fecha acá también es un reprogramado: el horario anterior se
    // archiva para que el usuario no lo pierda de vista.
    registrarPlan(db, req.params.id, publication_date, 'editar');
    db.prepare("UPDATE publications SET publication_date = ?, updated_at = datetime('now') WHERE id = ?")
      .run(publication_date, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  try { updated.images = JSON.parse(updated.images || '[]'); } catch { updated.images = []; }
  res.json(updated);
});

router.patch('/reorder', (req, res) => {
  const db = getDB();
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'Se esperaba un array order' });
  }
  for (let i = 0; i < order.length; i++) {
    db.prepare("UPDATE publications SET sort_order = ?, updated_at = datetime('now') WHERE id = ?").run(i, order[i]);
  }
  res.json({ message: 'Orden actualizado' });
});

router.post('/:id/publish', async (req, res) => {
  const db = getDB();
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Publicación no encontrada' });

  const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(settings.publish_config || '{}'); } catch {}
  const fb = pc.facebook || {};

  const { platform = 'facebook', scheduled_at } = req.body;
  const images = [];
  try { images.push(...JSON.parse(pub.images || '[]')); } catch {}

  if (scheduled_at) {
    const diffMs = new Date(scheduled_at).getTime() - Date.now();
    const minMs = 10 * 60 * 1000;
    const maxMs = 75 * 24 * 60 * 60 * 1000;
    if (diffMs < minMs) {
      return res.status(400).json({ error: 'Programá con al menos 10 minutos de anticipación' });
    }
    if (diffMs > maxMs) {
      return res.status(400).json({ error: 'Solo se puede programar hasta 75 días en el futuro' });
    }
  }

  try {
    let result;
    if (platform === 'instagram') {
      if (!images[0]) return res.status(400).json({ error: 'Instagram requiere al menos una imagen' });
      result = await publishToInstagram(fb.instagram_id, fb.access_token, {
        message: pub.publish_text,
        imageUrl: images[0]
      });
    } else {
      result = await publishToFacebook(fb.page_id, fb.access_token, {
        message: pub.publish_text,
        imageUrl: images[0] || null,
        scheduledAt: scheduled_at || null
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Duplicar una publicación: crea una copia INDEPENDIENTE (mismo texto, imágenes y
 * producto) pero SIN grupos ni fecha, o sea como material de la biblioteca.
 *
 * Se guarda sin agendar a propósito: si la copia naciera con los mismos grupos y
 * la misma hora que la original, el disparador publicaría el mismo texto dos
 * veces en el mismo grupo, que es justo lo que Facebook penaliza. Así el usuario
 * abre el Planificador sobre la copia, le elige hora y grupos, y decide cuál de
 * las dos se queda.
 */
router.post('/:id/duplicate', (req, res) => {
  const db = getDB();
  const orig = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!orig) return res.status(404).json({ error: 'Publicación no encontrada' });

  const id = uuid();
  db.prepare(`
    INSERT INTO publications (id, product_id, product_name, publish_text, images, publication_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, orig.product_id, orig.product_name, orig.publish_text,
    orig.images || '[]', new Date().toISOString());

  const copy = db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
  try { copy.images = JSON.parse(copy.images || '[]'); } catch { copy.images = []; }
  res.status(201).json(copy);
});

/**
 * Planificar una publicación en una franja: crea una COPIA agendada, con sus
 * propios destinos, y deja la original exactamente como estaba.
 *
 * Esto es lo que usa "Distribuir en el día". Antes esa acción movía la
 * publicación con un UPDATE, así que al repetirla pisaba la distribución
 * anterior y el usuario perdía de vista los horarios que ya había probado.
 *
 * Con un clon por distribución cada franja queda como un evento propio del
 * calendario: se ven todas a la vez, se pueden publicar por separado y la que
 * no sirva se borra con el ícono de papelera. Igual que con Duplicar, el
 * contenido va a los mismos grupos, así que el usuario decide cuál se queda.
 *
 * Los destinos que se copian son los VIVOS de la original (pending y
 * published). Los que fallaron, se cancelaron o se archivaron no se arrastran:
 * quedaron atrás a propósito y el usuario los sigue teniendo a la vista en el
 * detalle de la original.
 */
router.post('/:id/planificar', (req, res) => {
  const db = getDB();
  const orig = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!orig) return res.status(404).json({ error: 'Publicación no encontrada' });

  const fecha = new Date(String(req.body?.fecha || ''));
  if (Number.isNaN(fecha.getTime())) {
    return res.status(400).json({ error: 'La fecha de la franja no es válida' });
  }
  const iso = fecha.toISOString();

  // Modo rotación: la copia va a UN solo grupo del catálogo, elegido por el
  // frontend (GET /api/agenda/rotacion-grupos). Así cada copia de la franja cae
  // en un grupo distinto en vez de repetir los de la original. Sin `grupo_id`
  // se mantiene el comportamiento de siempre (copiar los destinos vivos).
  const grupoId = typeof req.body?.grupo_id === 'string' ? req.body.grupo_id : '';
  if (grupoId) {
    const grupo = db.prepare('SELECT id, name, url FROM facebook_groups WHERE id = ?').get(grupoId);
    if (!grupo) return res.status(400).json({ error: 'El grupo de rotación no existe' });

    const id = uuid();
    db.prepare(`
      INSERT INTO publications (id, product_id, product_name, publish_text, images, publication_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, orig.product_id, orig.product_name, orig.publish_text, orig.images || '[]', iso);

    // variant_text e images en blanco/NULL para que el publicador herede el
    // texto y las imágenes de la publicación (COALESCE pq.images, p.images).
    db.prepare(`
      INSERT INTO publication_queue
        (id, publication_id, group_name, group_url, status, scheduled_at,
         variant_index, variant_text, images, pending_approval)
      VALUES (?, ?, ?, ?, 'pending', ?, 0, '', NULL, 0)
    `).run(uuid(), id, grupo.name, grupo.url || '', iso);

    const copy = db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
    try { copy.images = JSON.parse(copy.images || '[]'); } catch { copy.images = []; }
    return res.status(201).json({ ...copy, destinos: 1 });
  }

  const vivos = db.prepare(`
    SELECT group_name, group_url, variant_index, variant_text, images, pending_approval
    FROM publication_queue
    WHERE publication_id = ? AND status IN ('pending', 'published')
    ORDER BY scheduled_at ASC, created_at ASC
  `).all(orig.id);

  const id = uuid();
  db.prepare(`
    INSERT INTO publications (id, product_id, product_name, publish_text, images, publication_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, orig.product_id, orig.product_name, orig.publish_text, orig.images || '[]', iso);

  for (const v of vivos) {
    db.prepare(`
      INSERT INTO publication_queue
        (id, publication_id, group_name, group_url, status, scheduled_at,
         variant_index, variant_text, images, pending_approval)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(uuid(), id, v.group_name, v.group_url, iso,
      v.variant_index ?? 0, v.variant_text || '', v.images || '[]', v.pending_approval ?? 0);
  }

  const copy = db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
  try { copy.images = JSON.parse(copy.images || '[]'); } catch { copy.images = []; }
  res.status(201).json({ ...copy, destinos: vivos.length });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM publications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Publicación no encontrada' });

  // Los destinos se borran junto con la publicación: si quedaran en la cola,
  // el worker legado los tomaría igual y publicaría un post huérfano.
  db.prepare('DELETE FROM publication_queue WHERE publication_id = ?').run(req.params.id);
  db.prepare('DELETE FROM publication_plans WHERE publication_id = ?').run(req.params.id);
  db.prepare('DELETE FROM publications WHERE id = ?').run(req.params.id);
  res.json({ message: 'Publicación eliminada' });
});

export default router;
