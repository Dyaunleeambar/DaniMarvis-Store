import { Router } from 'express';
import { getDB } from '../db/database.js';
import { buildPrompt, listFamilies, listFormats, selectFamily, nextVariant, VARIANTS_ORDER } from '../lib/promptEngine.js';

const router = Router();

router.get('/families', (req, res) => {
  res.json({ families: listFamilies() });
});

router.get('/formats', (req, res) => {
  res.json({ formats: listFormats() });
});

router.post('/generate', (req, res) => {
  const db = getDB();
  const { product_id, family, variant, format } = req.body || {};

  if (!product_id) {
    return res.status(400).json({ error: 'El campo product_id es obligatorio' });
  }

  const product = db.prepare(`
    SELECT p.id, p.name, p.description, p.category, p.price, p.warranty, p.commission_currency,
           p.provider_id, p.last_template,
           pr.name as provider_name, pr.provider_style_code
    FROM products p
    LEFT JOIN providers pr ON pr.id = p.provider_id
    WHERE p.id = ?
  `).get(product_id);

  if (!product) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  // Resolve provider style
  let providerStyle = null;
  if (product.provider_style_code) {
    providerStyle = db.prepare('SELECT * FROM provider_styles WHERE code = ?').get(product.provider_style_code);
    if (providerStyle) {
      try { providerStyle.palette = JSON.parse(providerStyle.palette); } catch { providerStyle.palette = {}; }
    }
  }

  const lastTemplate = product.last_template;
  const autoFamily = selectFamily(product);
  const suggestedFamily = family || autoFamily;
  const order = VARIANTS_ORDER[suggestedFamily] || [];
  const finalVariant = (variant && order.includes(variant))
    ? variant
    : nextVariant(lastTemplate, suggestedFamily);
  const finalFormat = format && ['1:1', '4:5', '9:16'].includes(format) ? format : '4:5';

  const prompt = buildPrompt(product, {
    family: suggestedFamily,
    variant: finalVariant,
    format: finalFormat,
    providerStyle,
  });

  let history = [];
  try { history = JSON.parse(db.prepare('SELECT creative_history FROM products WHERE id = ?').get(product_id).creative_history || '[]'); } catch {}

  const entry = {
    ts: new Date().toISOString(),
    family: suggestedFamily,
    variant: finalVariant,
    format: finalFormat,
    provider_style: product.provider_style_code || null,
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
      format: finalFormat,
      provider_name: product.provider_name || null,
      provider_style_code: product.provider_style_code || null,
      automatic: !family && !variant,
      history,
    },
  });
});

export default router;
