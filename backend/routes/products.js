import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const { category, status, provider_id, q } = req.query;
  let sql = `SELECT p.*, pr.name as provider_name
             FROM products p
             LEFT JOIN providers pr ON pr.id = p.provider_id`;
  const conditions = [];
  const params = [];

  if (category) { conditions.push('p.category = ?'); params.push(category); }
  if (status) { conditions.push('p.status = ?'); params.push(status); }
  if (provider_id) { conditions.push('p.provider_id = ?'); params.push(provider_id); }
  if (q) { conditions.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.created_at DESC';

  const products = db.prepare(sql).all(...params);
  res.json(products);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const product = db.prepare(`SELECT p.*, pr.name as provider_name
    FROM products p LEFT JOIN providers pr ON pr.id = p.provider_id
    WHERE p.id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(product);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { name, description, category, price, commission_type, commission_value, warranty, provider_id, image_url, stock, status } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
  }

  const id = uuid();
  const product = {
    id, name, description: description || '', category: category || '',
    price, commission_type: commission_type || 'percentage',
    commission_value: commission_value || 0, warranty: warranty || '',
    provider_id: provider_id || null, image_url: image_url || '',
    stock: stock || 0, status: status || 'active'
  };

  db.prepare(`INSERT INTO products (id, name, description, category, price,
    commission_type, commission_value, warranty, provider_id, image_url, stock, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    product.id, product.name, product.description, product.category,
    product.price, product.commission_type, product.commission_value,
    product.warranty, product.provider_id, product.image_url,
    product.stock, product.status
  );

  res.status(201).json(product);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const { name, description, category, price, commission_type, commission_value, warranty, provider_id, image_url, stock, status } = req.body;

  db.prepare(`UPDATE products SET
    name = COALESCE(?, name), description = COALESCE(?, description),
    category = COALESCE(?, category), price = COALESCE(?, price),
    commission_type = COALESCE(?, commission_type), commission_value = COALESCE(?, commission_value),
    warranty = COALESCE(?, warranty), provider_id = COALESCE(?, provider_id),
    image_url = COALESCE(?, image_url), stock = COALESCE(?, stock),
    status = COALESCE(?, status), updated_at = datetime('now')
    WHERE id = ?`).run(
    name, description, category, price,
    commission_type, commission_value, warranty, provider_id,
    image_url, stock, status,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const hasSales = db.prepare('SELECT COUNT(*) as c FROM sales WHERE product_id = ?').get(req.params.id);
  if (hasSales.c > 0) {
    db.prepare('UPDATE products SET status = ? WHERE id = ?').run('archived', req.params.id);
    return res.json({ message: 'Producto archivado (tiene ventas asociadas)' });
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: 'Producto eliminado' });
});

export default router;
