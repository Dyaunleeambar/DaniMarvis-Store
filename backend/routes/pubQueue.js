import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

router.get('/', (req, res) => {
  const db = getDB();
  const items = db.prepare(`
    SELECT pq.*, p.publish_text, p.product_name, p.images, p.publication_date
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
    SELECT pq.*, p.publish_text, p.product_name, p.images, p.publication_date
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
  const { publication_id, group_name, group_url, group_ids, variant_index, variant_text, scheduled_at } = req.body;

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
      INSERT INTO publication_queue (id, publication_id, group_name, group_url, variant_index, variant_text, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, publication_id || null, target.group_name, target.group_url || '', variant_index || 0, text, scheduled_at || null);

    const created = db.prepare(`
      SELECT pq.*, p.publish_text, p.product_name, p.images, p.publication_date
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
  const { status, notes } = req.body;
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

  const updated = db.prepare(`
    SELECT pq.*, p.publish_text, p.product_name, p.images, p.publication_date
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
