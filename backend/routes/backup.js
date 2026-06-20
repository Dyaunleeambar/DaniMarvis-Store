import { Router } from 'express';
import { getDB, saveDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const data = {
    version: 1,
    exported_at: new Date().toISOString(),
    products: db.prepare('SELECT * FROM products').all(),
    providers: db.prepare('SELECT * FROM providers').all(),
    sales: db.prepare('SELECT * FROM sales').all(),
    categories: db.prepare('SELECT * FROM categories').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
  };
  res.json(data);
});

function q(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

router.post('/restore', (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.providers) ||
      !Array.isArray(data.sales) || !Array.isArray(data.categories) || !Array.isArray(data.settings)) {
    return res.status(400).json({ error: 'Archivo de respaldo inválido' });
  }

  const db = getDB();

  try {
    db.exec('DELETE FROM sales');
    db.exec('DELETE FROM products');
    db.exec('DELETE FROM providers');
    db.exec('DELETE FROM categories');
    db.exec('DELETE FROM settings');

    for (const r of data.sales) {
      db.exec(`INSERT INTO sales (id, product_id, provider_id, client_name, client_phone, client_address, quantity, unit_price, total_amount, commission_amount, commission_paid, exchange_rate, delivery_method, delivery_status, notes, sale_date, created_at, updated_at) VALUES (${q(r.id)}, ${q(r.product_id)}, ${q(r.provider_id)}, ${q(r.client_name)}, ${q(r.client_phone)}, ${q(r.client_address)}, ${q(r.quantity)}, ${q(r.unit_price)}, ${q(r.total_amount)}, ${q(r.commission_amount)}, ${q(r.commission_paid)}, ${q(r.exchange_rate)}, ${q(r.delivery_method)}, ${q(r.delivery_status)}, ${q(r.notes)}, ${q(r.sale_date)}, ${q(r.created_at)}, ${q(r.updated_at)})`);
    }
    for (const r of data.products) {
      db.exec(`INSERT INTO products (id, name, description, category, price, commission_type, commission_value, warranty, provider_id, image_url, stock, status, created_at, updated_at) VALUES (${q(r.id)}, ${q(r.name)}, ${q(r.description)}, ${q(r.category)}, ${q(r.price)}, ${q(r.commission_type)}, ${q(r.commission_value)}, ${q(r.warranty)}, ${q(r.provider_id)}, ${q(r.image_url)}, ${q(r.stock)}, ${q(r.status)}, ${q(r.created_at)}, ${q(r.updated_at)})`);
    }
    for (const r of data.providers) {
      db.exec(`INSERT INTO providers (id, name, contact, phone, email, commission_rate, notes, created_at, updated_at) VALUES (${q(r.id)}, ${q(r.name)}, ${q(r.contact)}, ${q(r.phone)}, ${q(r.email)}, ${q(r.commission_rate)}, ${q(r.notes)}, ${q(r.created_at)}, ${q(r.updated_at)})`);
    }
    for (const r of data.categories) {
      db.exec(`INSERT INTO categories (id, name, sort_order, created_at) VALUES (${q(r.id)}, ${q(r.name)}, ${q(r.sort_order ?? 0)}, ${q(r.created_at || null)})`);
    }
    for (const r of data.settings) {
      db.exec(`INSERT INTO settings (id, exchange_rate, updated_at) VALUES (${q(r.id)}, ${q(r.exchange_rate)}, ${q(r.updated_at || null)})`);
    }

    saveDB();
    res.json({ message: 'Datos restaurados correctamente' });
  } catch (e) {
    const msg = e?.message || e?.toString() || 'Error desconocido';
    console.error('[Backup] Error al restaurar:', msg);
    res.status(500).json({ error: 'Error al restaurar los datos: ' + msg });
  }
});

export default router;
