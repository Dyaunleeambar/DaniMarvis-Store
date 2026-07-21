import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const exports = db.prepare('SELECT * FROM exports ORDER BY created_at DESC').all();
  for (const e of exports) {
    try { e.fields = JSON.parse(e.fields || '[]'); } catch { e.fields = []; }
    try { e.product_ids = JSON.parse(e.product_ids || '[]'); } catch { e.product_ids = []; }
  }
  res.json(exports);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const exp = db.prepare('SELECT * FROM exports WHERE id = ?').get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Exportación no encontrada' });
  try { exp.fields = JSON.parse(exp.fields || '[]'); } catch { exp.fields = []; }
  try { exp.product_ids = JSON.parse(exp.product_ids || '[]'); } catch { exp.product_ids = []; }
  res.json(exp);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { title, style, fields, product_ids, product_count } = req.body;
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });
  const id = uuid();
  db.prepare(
    'INSERT INTO exports (id, title, style, fields, product_ids, product_count) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, style || 'table', JSON.stringify(fields || []), JSON.stringify(product_ids || []), product_count || 0);
  const created = db.prepare('SELECT * FROM exports WHERE id = ?').get(id);
  try { created.fields = JSON.parse(created.fields || '[]'); } catch { created.fields = []; }
  try { created.product_ids = JSON.parse(created.product_ids || '[]'); } catch { created.product_ids = []; }
  res.status(201).json(created);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM exports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Exportación no encontrada' });
  db.prepare('DELETE FROM exports WHERE id = ?').run(req.params.id);
  res.json({ message: 'Exportación eliminada' });
});

export default router;
