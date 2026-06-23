import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const providers = db.prepare(`
    SELECT p.*, COUNT(pr.id) as product_count
    FROM providers p
    LEFT JOIN products pr ON pr.provider_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `).all();
  res.json(providers);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const provider = db.prepare(`
    SELECT p.*, COUNT(pr.id) as product_count
    FROM providers p
    LEFT JOIN products pr ON pr.provider_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json(provider);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { name, contact, phone, email, info, notes } = req.body;

  if (!name) return res.status(400).json({ error: 'Nombre del proveedor es obligatorio' });

  const id = uuid();
  const provider = { id, name, contact: contact || '', phone: phone || '', email: email || '', info: info || '', notes: notes || '' };

  db.prepare(`INSERT INTO providers (id, name, contact, phone, email, info, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    provider.id, provider.name, provider.contact, provider.phone,
    provider.email, provider.info, provider.notes
  );

  res.status(201).json(provider);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const { name, contact, phone, email, info, notes } = req.body;

  db.prepare(`UPDATE providers SET
    name = COALESCE(?, name), contact = COALESCE(?, contact),
    phone = COALESCE(?, phone), email = COALESCE(?, email),
    info = COALESCE(?, info),
    notes = COALESCE(?, notes), updated_at = datetime('now')
    WHERE id = ?`).run(name, contact, phone, email, info, notes, req.params.id);

  const updated = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const productCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE provider_id = ?').get(req.params.id);
  if (productCount.c > 0) {
    return res.status(400).json({ error: `No se puede eliminar: tiene ${productCount.c} producto(s) asociados. Archive o reasigne primero.` });
  }

  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Proveedor eliminado' });
});

export default router;
