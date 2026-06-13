import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const { delivery_status, provider_id, start_date, end_date } = req.query;
  let sql = `SELECT s.*, p.name as product_name, pr.name as provider_name
             FROM sales s
             LEFT JOIN products p ON p.id = s.product_id
             LEFT JOIN providers pr ON pr.id = s.provider_id`;
  const conditions = [];
  const params = [];

  if (delivery_status) { conditions.push('s.delivery_status = ?'); params.push(delivery_status); }
  if (provider_id) { conditions.push('s.provider_id = ?'); params.push(provider_id); }
  if (start_date) { conditions.push('s.sale_date >= ?'); params.push(start_date); }
  if (end_date) { conditions.push('s.sale_date <= ?'); params.push(end_date); }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY s.created_at DESC';

  const sales = db.prepare(sql).all(...params);
  res.json(sales);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const sale = db.prepare(`SELECT s.*, p.name as product_name, pr.name as provider_name
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    LEFT JOIN providers pr ON pr.id = s.provider_id
    WHERE s.id = ?`).get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  res.json(sale);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { product_id, provider_id, client_name, client_phone, client_address,
    quantity, unit_price, total_amount, commission_amount,
    delivery_method, delivery_status, notes, sale_date } = req.body;

  if (!product_id || !unit_price) {
    return res.status(400).json({ error: 'Producto y precio unitario son obligatorios' });
  }

  const id = uuid();
  const qty = quantity || 1;
  const total = total_amount || (unit_price * qty);

  const sale = {
    id, product_id, provider_id: provider_id || null,
    client_name: client_name || '', client_phone: client_phone || '',
    client_address: client_address || '',
    quantity: qty, unit_price, total_amount: total,
    commission_amount: commission_amount || 0,
    commission_paid: 0,
    delivery_method: delivery_method || '', delivery_status: delivery_status || 'pending',
    notes: notes || '', sale_date: sale_date || new Date().toISOString()
  };

  db.prepare(`INSERT INTO sales (id, product_id, provider_id, client_name, client_phone,
    client_address, quantity, unit_price, total_amount, commission_amount,
    commission_paid, delivery_method, delivery_status, notes, sale_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sale.id, sale.product_id, sale.provider_id, sale.client_name,
    sale.client_phone, sale.client_address, sale.quantity, sale.unit_price,
    sale.total_amount, sale.commission_amount, sale.commission_paid,
    sale.delivery_method, sale.delivery_status, sale.notes, sale.sale_date
  );

  res.status(201).json(sale);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Venta no encontrada' });

  const { client_name, client_phone, client_address, quantity, unit_price,
    total_amount, commission_amount, commission_paid, delivery_method,
    delivery_status, notes, sale_date } = req.body;

  db.prepare(`UPDATE sales SET
    client_name = COALESCE(?, client_name), client_phone = COALESCE(?, client_phone),
    client_address = COALESCE(?, client_address),
    quantity = COALESCE(?, quantity), unit_price = COALESCE(?, unit_price),
    total_amount = COALESCE(?, total_amount),
    commission_amount = COALESCE(?, commission_amount),
    commission_paid = COALESCE(?, commission_paid),
    delivery_method = COALESCE(?, delivery_method),
    delivery_status = COALESCE(?, delivery_status),
    notes = COALESCE(?, notes), sale_date = COALESCE(?, sale_date),
    updated_at = datetime('now')
    WHERE id = ?`).run(
    client_name, client_phone, client_address, quantity, unit_price,
    total_amount, commission_amount, commission_paid, delivery_method,
    delivery_status, notes, sale_date,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.patch('/:id/status', (req, res) => {
  const db = getDB();
  const { delivery_status, commission_paid } = req.body;

  const existing = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Venta no encontrada' });

  const updates = [];
  const params = [];
  if (delivery_status !== undefined) { updates.push('delivery_status = ?'); params.push(delivery_status); }
  if (commission_paid !== undefined) { updates.push('commission_paid = ?'); params.push(commission_paid); }

  if (updates.length) {
    updates.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    db.prepare(`UPDATE sales SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Venta no encontrada' });

  db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
  res.json({ message: 'Venta eliminada' });
});

export default router;
