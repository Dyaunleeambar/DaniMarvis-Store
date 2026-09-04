import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const groups = db.prepare(
    'SELECT * FROM facebook_groups ORDER BY sort_order ASC, name ASC'
  ).all();
  res.json(groups);
});

router.post('/', (req, res) => {
  const db = getDB();
  const name = (req.body.name || '').trim();
  const url = (req.body.url || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const exists = db.prepare('SELECT id FROM facebook_groups WHERE name = ? COLLATE NOCASE').get(name);
  if (exists) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM facebook_groups').get();
  const group = { id: uuid(), name, url, sort_order: maxOrder.m + 1 };

  db.prepare('INSERT INTO facebook_groups (id, name, url, sort_order) VALUES (?, ?, ?, ?)').run(
    group.id, group.name, group.url, group.sort_order
  );

  res.status(201).json(group);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Grupo no encontrado' });

  const name = (req.body.name ?? existing.name).toString().trim();
  const url = (req.body.url ?? existing.url).toString().trim();
  if (!name) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const duplicate = db.prepare('SELECT id FROM facebook_groups WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, req.params.id);
  if (duplicate) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });

  db.prepare('UPDATE facebook_groups SET name = ?, url = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(name, url, req.params.id);

  const updated = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.patch('/reorder', (req, res) => {
  const db = getDB();
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'Se esperaba un array order' });
  }
  for (let i = 0; i < order.length; i++) {
    db.prepare('UPDATE facebook_groups SET sort_order = ? WHERE id = ?').run(i, order[i]);
  }
  res.json({ message: 'Orden actualizado' });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Grupo no encontrado' });

  db.prepare('DELETE FROM facebook_groups WHERE id = ?').run(req.params.id);
  res.json({ message: 'Grupo eliminado' });
});

export default router;