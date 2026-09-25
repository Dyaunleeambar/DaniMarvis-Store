import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';

const router = Router();

const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_IMAGES = 6;
const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

function parseImages(raw) {
  if (!Array.isArray(raw)) return [];
  const imgs = raw
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_IMAGES);
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    // pegado desde portapapeles: data:image/...;base64,.... → se guarda en uploads
    if (/^data:image\//i.test(img)) {
      const m = img.match(/^data:(image\/[\w.+-]+);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/);
      if (!m) { imgs.splice(i, 1); i--; continue; }
      const ext = MIME_EXT[m[1].toLowerCase()] || 'png';
      const file = `pgp_paste_${uuid().slice(0, 8)}.${ext}`;
      try {
        fs.writeFileSync(path.join(UPLOADS_DIR, file), Buffer.from(m[2], 'base64'));
        imgs[i] = `/uploads/${file}`;
      } catch (_) { imgs.splice(i, 1); i--; }
      continue;
    }
    // rutas locales relativas o absolutas de http(s) se conservan tal cual
    if (/^\/uploads\//.test(img) || /^https?:\/\//i.test(img)) continue;
    imgs.splice(i, 1);
    i--;
  }
  return imgs;
}

router.get('/', (req, res) => {
  const db = getDB();
  const items = db.prepare(`
    SELECT pq.*, p.publish_text, p.product_name, COALESCE(pq.images, p.images) AS images, p.publication_date
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    ORDER BY pq.created_at DESC
  `).all();
  for (const item of items) {
    try { item.images = JSON.parse(item.images || '[]'); } catch { item.images = []; }
  }
  res.json(items);
});

router.get('/due', (req, res) => {
  const db = getDB();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const items = db.prepare(`
    SELECT pq.*, p.publish_text, p.product_name, COALESCE(pq.images, p.images) AS images, p.publication_date
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.status = 'pending' AND (pq.scheduled_at IS NULL OR pq.scheduled_at <= ?)
    ORDER BY COALESCE(pq.scheduled_at, pq.created_at) ASC
  `).all(now);
  for (const item of items) {
    try { item.images = JSON.parse(item.images || '[]'); } catch { item.images = []; }
  }
  res.json(items);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { publication_id, group_name, group_url, group_ids, variant_index, variant_text, scheduled_at, images } = req.body;

  const imagesArr = parseImages(images);

  let targets = [];
  if (Array.isArray(group_ids) && group_ids.length > 0) {
    const rows = db.prepare('SELECT id, name, url FROM facebook_groups WHERE id IN (' +
      group_ids.map(() => '?').join(',') + ')').all(...group_ids);
    targets = rows.map(g => ({ group_name: g.name, group_url: g.url }));
  } else if (group_name && group_name.trim()) {
    targets = [{ group_name: group_name.trim(), group_url: group_url || '' }];
  }

  if (targets.length === 0) {
    return res.status(400).json({ error: 'Elegí al menos un grupo o escribí el nombre del grupo' });
  }

  let publishText = '';
  if (publication_id) {
    const pub = db.prepare('SELECT publish_text FROM publications WHERE id = ?').get(publication_id);
    if (pub) publishText = pub.publish_text || '';
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const createdItems = [];
  for (const target of targets) {
    const id = uuid();
    const text = variant_text || publishText;
    db.prepare(`
      INSERT INTO publication_queue (id, publication_id, group_name, group_url, variant_index, variant_text, scheduled_at, images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, publication_id || null, target.group_name, target.group_url || '', variant_index || 0, text, scheduled_at || null, JSON.stringify(imagesArr));

    const created = db.prepare(`
      SELECT pq.*, p.publish_text, p.product_name, COALESCE(pq.images, p.images) AS images, p.publication_date
      FROM publication_queue pq
      LEFT JOIN publications p ON p.id = pq.publication_id
      WHERE pq.id = ?
    `).get(id);
    try { created.images = JSON.parse(created.images || '[]'); } catch { created.images = []; }
    createdItems.push(created);
  }

  if (createdItems.length === 1) return res.status(201).json(createdItems[0]);
  res.status(201).json(createdItems);
});

router.patch('/:id', (req, res) => {
  const db = getDB();
  const { status, notes, variant_text, images } = req.body;
  const existing = db.prepare('SELECT id FROM publication_queue WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Elemento no encontrado en la cola' });

  if (status) {
    const publishedAt = status === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    db.prepare("UPDATE publication_queue SET status = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, publishedAt, req.params.id);
  }
  if (notes !== undefined) {
    db.prepare("UPDATE publication_queue SET notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, req.params.id);
  }
  if (variant_text !== undefined) {
    db.prepare("UPDATE publication_queue SET variant_text = ?, updated_at = datetime('now') WHERE id = ?")
      .run(String(variant_text), req.params.id);
  }
  if (images !== undefined) {
    const imagesJson = JSON.stringify(parseImages(images));
    db.prepare("UPDATE publication_queue SET images = ?, updated_at = datetime('now') WHERE id = ?")
      .run(imagesJson, req.params.id);
  }

  const updated = db.prepare(`
    SELECT pq.*, p.publish_text, p.product_name, COALESCE(pq.images, p.images) AS images, p.publication_date
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.id = ?
  `).get(req.params.id);
  try { updated.images = JSON.parse(updated.images || '[]'); } catch { updated.images = []; }
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM publication_queue WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Elemento no encontrado' });
  db.prepare('DELETE FROM publication_queue WHERE id = ?').run(req.params.id);
  res.json({ message: 'Eliminado de la cola' });
});

router.get('/timer', (req, res) => {
  const db = getDB();
  const recent = db.prepare(`
    SELECT group_name, MAX(published_at) as last_published
    FROM publication_queue
    WHERE status = 'published' AND published_at IS NOT NULL
    GROUP BY LOWER(group_name)
  `).all();

  const now = Date.now();
  const timers = recent.map(r => {
    const lastMs = new Date(r.last_published).getTime();
    const elapsed = now - lastMs;
    const remaining = Math.max(0, MIN_INTERVAL_MS - elapsed);
    return {
      group_name: r.group_name,
      last_published: r.last_published,
      remaining_ms: remaining,
      can_publish: remaining === 0,
      ready_at: remaining > 0 ? new Date(lastMs + MIN_INTERVAL_MS).toISOString() : null,
    };
  });

  res.json({ min_interval_ms: MIN_INTERVAL_MS, timers });
});

export default router;
