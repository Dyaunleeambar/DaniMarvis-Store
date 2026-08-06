import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { ocrImage, bestMatch, extractPrice } from '../lib/ocr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

router.post('/analyze', async (req, res) => {
  const { folder, provider_id } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde están las imágenes' });
  }
  if (!provider_id) {
    return res.status(400).json({ error: 'Elegí el proveedor a sincronizar' });
  }

  const dir = resolve(folder);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return res.status(400).json({ error: `La carpeta no existe: ${folder}` });
  }

  const db = getDB();
  const provider = db.prepare('SELECT id, name FROM providers WHERE id = ?').get(provider_id);
  if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const products = db.prepare(
    'SELECT id, name, price, catalog_visible FROM products WHERE provider_id = ? ORDER BY name'
  ).all(provider_id);

  const outDir = join(__dirname, '..', 'uploads', 'import');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const files = readdirSync(dir).filter(f => IMAGE_EXT.has(extname(f).toLowerCase()));
  if (files.length === 0) {
    return res.json({ provider: provider.name, products, items: [], message: 'No se encontraron imágenes en esa carpeta' });
  }

  const items = [];
  for (const f of files) {
    try {
      const src = join(dir, f);
      if (!statSync(src).isFile()) continue;
      const ext = extname(f).toLowerCase();
      const newName = uuid() + ext;
      copyFileSync(src, join(outDir, newName));
      const url = `/uploads/import/${newName}`;

      const text = await ocrImage(src);
      const match = bestMatch(products, text);
      const price = extractPrice(text);

      items.push({
        filename: f,
        url,
        text: text.trim().slice(0, 600),
        product: match
          ? {
              id: match.product.id,
              name: match.product.name,
              current_price: match.product.price,
              visible: !!match.product.catalog_visible,
              confidence: Math.round(match.score * 100),
            }
          : null,
        detected_price: price ? { value: price.value, raw: price.raw } : null,
      });
    } catch (err) {
      console.error('[Import] Error procesando', f, err);
      items.push({ filename: f, error: err.message });
    }
  }

  res.json({ provider: provider.name, products, items });
});

router.post('/apply', (req, res) => {
  const { provider_id, items, hideAbsent } = req.body || {};
  if (!provider_id) return res.status(400).json({ error: 'Falta el proveedor' });

  const db = getDB();
  const applied = [];
  const errors = [];
  const appliedIds = new Set();

  for (const it of items || []) {
    if (!it || !it.product_id || it.price === undefined || it.price === null || it.price === '') continue;
    const val = Number(String(it.price).replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      errors.push({ product_id: it.product_id, name: it.product_name || '', error: 'Precio inválido' });
      continue;
    }
    const changed = db.prepare(
      "UPDATE products SET price = ?, catalog_visible = 1, updated_at = datetime('now') WHERE id = ? AND provider_id = ?"
    ).run(val, it.product_id, provider_id);
    if (changed > 0) {
      appliedIds.add(it.product_id);
      applied.push({ product_id: it.product_id, price: val, name: it.product_name || '' });
    }
  }

  let hidden = [];
  if (hideAbsent && appliedIds.size > 0) {
    const placeholders = Array(appliedIds.size).fill('?').join(',');
    const rows = db.prepare(
      `SELECT id, name FROM products WHERE provider_id = ? AND catalog_visible = 1 AND id NOT IN (${placeholders})`
    ).all(provider_id, ...Array.from(appliedIds));
    for (const row of rows) {
      db.prepare("UPDATE products SET catalog_visible = 0, updated_at = datetime('now') WHERE id = ?").run(row.id);
      hidden.push({ id: row.id, name: row.name });
    }
  }

  res.json({ applied, hidden, errors });
});

export default router;
