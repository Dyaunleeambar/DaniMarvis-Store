import { Router } from 'express';
import { getDB } from '../db/database.js';
import { buildPrompt, listFamilies, selectFamily, nextVariant, VARIANTS_ORDER } from '../lib/promptEngine.js';

const router = Router();

router.get('/families', (req, res) => {
  res.json({ families: listFamilies() });
});

router.post('/generate', (req, res) => {
  const db = getDB();
  const { product_id, family, variant } = req.body || {};

  if (!product_id) {
    return res.status(400).json({ error: 'El campo product_id es obligatorio' });
  }

  const product = db.prepare(`
    SELECT id, name, description, category, price, warranty
    FROM products WHERE id = ?
  `).get(product_id);

  if (!product) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  const lastTemplate = db.prepare('SELECT last_template FROM products WHERE id = ?').get(product_id).last_template;
  const autoFamily = selectFamily(product);
  const suggestedFamily = family || autoFamily;
  const order = VARIANTS_ORDER[suggestedFamily] || [];
  const finalVariant = (variant && order.includes(variant))
    ? variant
    : nextVariant(lastTemplate, suggestedFamily);
  const prompt = buildPrompt(product, { family: suggestedFamily, variant: finalVariant });

  let history = [];
  try { history = JSON.parse(db.prepare('SELECT creative_history FROM products WHERE id = ?').get(product_id).creative_history || '[]'); } catch {}

  const entry = {
    ts: new Date().toISOString(),
    family: suggestedFamily,
    variant: finalVariant,
  };
  history = [entry, ...history].slice(0, 20);

  db.prepare('UPDATE products SET last_template = ?, creative_history = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(finalVariant, JSON.stringify(history), product_id);

  res.json({
    prompt,
    meta: {
      product_id,
      product_name: product.name,
      family: suggestedFamily,
      variant: finalVariant,
      automatic: !family && !variant,
      history,
    },
  });
});

export default router;
