import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';
import { publishToFacebook, publishToInstagram } from '../lib/facebook.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const publications = db.prepare(
    'SELECT * FROM publications ORDER BY sort_order ASC, publication_date DESC'
  ).all();
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
  const date = publication_date || new Date().toISOString().slice(0, 19).replace('T', ' ');
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

  const { platform = 'facebook' } = req.body;
  const images = [];
  try { images.push(...JSON.parse(pub.images || '[]')); } catch {}

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
        imageUrl: images[0] || null
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM publications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Publicación no encontrada' });

  db.prepare('DELETE FROM publications WHERE id = ?').run(req.params.id);
  res.json({ message: 'Publicación eliminada' });
});

export default router;
