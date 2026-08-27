import { Router } from 'express';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const styles = db.prepare('SELECT * FROM provider_styles ORDER BY code').all();
  for (const s of styles) {
    try { s.palette = JSON.parse(s.palette); } catch { s.palette = {}; }
  }
  res.json(styles);
});

router.get('/:code', (req, res) => {
  const db = getDB();
  const style = db.prepare('SELECT * FROM provider_styles WHERE code = ?').get(req.params.code);
  if (!style) return res.status(404).json({ error: 'Estilo no encontrado' });
  try { style.palette = JSON.parse(style.palette); } catch { style.palette = {}; }
  res.json(style);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { code, name, style_name, palette, background_rules, accent_rules, signature_rules, negative_rules, shipping_rule } = req.body;
  if (!code || !name || !style_name) {
    return res.status(400).json({ error: 'Código, nombre y nombre de estilo son obligatorios' });
  }
  const existing = db.prepare('SELECT code FROM provider_styles WHERE code = ?').get(code);
  if (existing) {
    return res.status(409).json({ error: 'Ya existe un estilo con ese código' });
  }
  db.prepare(`INSERT INTO provider_styles (code, name, style_name, palette, background_rules, accent_rules, signature_rules, negative_rules, shipping_rule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    code.toUpperCase(), name, style_name,
    typeof palette === 'string' ? palette : JSON.stringify(palette || {}),
    background_rules || '', accent_rules || '', signature_rules || '', negative_rules || '', shipping_rule || ''
  );
  const created = db.prepare('SELECT * FROM provider_styles WHERE code = ?').get(code.toUpperCase());
  try { created.palette = JSON.parse(created.palette); } catch { created.palette = {}; }
  res.status(201).json(created);
});

router.put('/:code', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT code FROM provider_styles WHERE code = ?').get(req.params.code);
  if (!existing) return res.status(404).json({ error: 'Estilo no encontrado' });
  const { name, style_name, palette, background_rules, accent_rules, signature_rules, negative_rules, shipping_rule } = req.body;

  const current = db.prepare('SELECT * FROM provider_styles WHERE code = ?').get(req.params.code);
  const paletteVal = palette !== undefined ? (typeof palette === 'string' ? palette : JSON.stringify(palette)) : current.palette;

  db.prepare(`UPDATE provider_styles SET name = ?, style_name = ?, palette = ?, background_rules = ?, accent_rules = ?, signature_rules = ?, negative_rules = ?, shipping_rule = ?, updated_at = datetime('now')
    WHERE code = ?`).run(
    name ?? current.name,
    style_name ?? current.style_name,
    paletteVal,
    background_rules ?? current.background_rules,
    accent_rules ?? current.accent_rules,
    signature_rules ?? current.signature_rules,
    negative_rules ?? current.negative_rules,
    shipping_rule ?? current.shipping_rule,
    req.params.code
  );
  const updated = db.prepare('SELECT * FROM provider_styles WHERE code = ?').get(req.params.code);
  try { updated.palette = JSON.parse(updated.palette); } catch { updated.palette = {}; }
  res.json(updated);
});

router.delete('/:code', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT code FROM provider_styles WHERE code = ?').get(req.params.code);
  if (!existing) return res.status(404).json({ error: 'Estilo no encontrado' });
  const usingProvider = db.prepare('SELECT COUNT(*) as c FROM providers WHERE provider_style_code = ?').get(req.params.code);
  if (usingProvider.c > 0) {
    return res.status(409).json({ error: 'Hay proveedores usando este estilo. Desasígnalos primero.' });
  }
  db.prepare('DELETE FROM provider_styles WHERE code = ?').run(req.params.code);
  res.json({ message: 'Estilo eliminado' });
});

export default router;
