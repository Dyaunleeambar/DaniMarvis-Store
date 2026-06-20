import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const categories = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM products p WHERE p.category = c.name) as product_count
    FROM categories c
    ORDER BY c.sort_order ASC, c.name ASC
  `).all();
  res.json(categories);
});

router.post('/', (req, res) => {
  const db = getDB();
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const exists = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name);
  if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM categories').get();
  const category = { id: uuid(), name, sort_order: maxOrder.m + 1 };

  db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)').run(
    category.id, category.name, category.sort_order
  );

  res.status(201).json(category);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });

  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const duplicate = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id != ?').get(name, req.params.id);
  if (duplicate) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });

  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
  if (name !== existing.name) {
    db.prepare('UPDATE products SET category = ? WHERE category = ?').run(name, existing.name);
  }

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });

  const used = db.prepare('SELECT COUNT(*) as c FROM products WHERE category = ?').get(existing.name);
  if (used.c > 0) {
    return res.status(400).json({ error: `${used.c} producto(s) usan esta categoría. Reasígnalos antes de eliminar.` });
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Categoría eliminada' });
});

export default router;
