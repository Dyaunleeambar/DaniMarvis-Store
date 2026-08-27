import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const { provider_id } = req.query;
  let sql = `SELECT wr.*, p.name as provider_name
    FROM warranty_rules wr
    LEFT JOIN providers p ON p.id = wr.provider_id`;
  const params = [];
  if (provider_id) {
    sql += ' WHERE wr.provider_id = ?';
    params.push(provider_id);
  }
  sql += ' ORDER BY p.name, wr.keyword';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const db = getDB();
  const { provider_id, keyword, warranty_text } = req.body;
  if (!provider_id || !keyword || !warranty_text) {
    return res.status(400).json({ error: 'Proveedor, palabra clave y garantía son obligatorios' });
  }
  const id = uuid();
  db.prepare('INSERT INTO warranty_rules (id, provider_id, keyword, warranty_text) VALUES (?, ?, ?, ?)')
    .run(id, provider_id, keyword.trim(), warranty_text.trim());
  const created = db.prepare('SELECT wr.*, p.name as provider_name FROM warranty_rules wr LEFT JOIN providers p ON p.id = wr.provider_id WHERE wr.id = ?').get(id);
  res.status(201).json(created);
});

router.post('/bulk', (req, res) => {
  const db = getDB();
  const { provider_id, rules } = req.body;
  if (!provider_id || !Array.isArray(rules) || rules.length === 0) {
    return res.status(400).json({ error: 'Proveedor y al menos una regla son obligatorios' });
  }
  let created = 0;
  let skipped = 0;
  for (const rule of rules) {
    const keyword = (rule.keyword || '').trim();
    const warranty_text = (rule.warranty_text || '').trim();
    if (!keyword || !warranty_text) { skipped++; continue; }
    const existing = db.prepare('SELECT id FROM warranty_rules WHERE provider_id = ? AND keyword = ?').get(provider_id, keyword);
    if (existing) {
      db.prepare('UPDATE warranty_rules SET warranty_text = ? WHERE id = ?').run(warranty_text, existing.id);
    } else {
      db.prepare('INSERT INTO warranty_rules (id, provider_id, keyword, warranty_text) VALUES (?, ?, ?, ?)')
        .run(uuid(), provider_id, keyword, warranty_text);
    }
    created++;
  }
  res.json({ created, skipped });
});

router.post('/match', (req, res) => {
  const db = getDB();
  const { provider_id, product_name } = req.body;
  if (!provider_id || !product_name) {
    return res.status(400).json({ error: 'Proveedor y nombre del producto son obligatorios' });
  }
  const rules = db.prepare('SELECT keyword, warranty_text FROM warranty_rules WHERE provider_id = ?').all(provider_id);
  const nameLower = product_name.toLowerCase();
  let bestMatch = null;
  let bestLen = 0;
  for (const rule of rules) {
    if (nameLower.includes(rule.keyword.toLowerCase()) && rule.keyword.length > bestLen) {
      bestMatch = rule.warranty_text;
      bestLen = rule.keyword.length;
    }
  }
  res.json({ warranty: bestMatch || null, matched: bestLen > 0 });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM warranty_rules WHERE id = ?').run(req.params.id);
  res.json({ message: 'Regla eliminada' });
});

router.delete('/provider/:provider_id', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM warranty_rules WHERE provider_id = ?').run(req.params.provider_id);
  res.json({ message: 'Reglas del proveedor eliminadas' });
});

export default router;
