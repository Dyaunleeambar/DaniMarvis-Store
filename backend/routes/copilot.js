import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function matchProduct(products, fileSlug) {
  if (!fileSlug) return null;
  for (const p of products) {
    const base = slugify(p.name);
    if (!base) continue;
    if (fileSlug === base ||
        fileSlug.startsWith(base + '-') ||
        fileSlug.includes('-' + base) ||
        base.startsWith(fileSlug + '-')) return p;
  }
  return null;
}

router.post('/import', (req, res) => {
  const { folder, assignToProduct } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde guardaste las imágenes' });
  }

  const dir = resolve(folder);
  if (!existsSync(dir)) {
    return res.status(400).json({ error: `La carpeta no existe: ${folder}` });
  }
  if (!statSync(dir).isDirectory()) {
    return res.status(400).json({ error: `No es una carpeta: ${folder}` });
  }

  const outDir = join(__dirname, '..', 'uploads', 'copilot');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const db = getDB();
  const products = db.prepare('SELECT id, name, images FROM products').all();
  const files = readdirSync(dir).filter(f => IMAGE_EXT.has(extname(f).toLowerCase()));

  if (files.length === 0) {
    return res.json({ folder: dir, total: 0, imported: [], noMatch: [], errors: [], message: 'No se encontraron imágenes en esa carpeta' });
  }

  const imported = [];
  const noMatch = [];
  const errors = [];

  for (const f of files) {
    try {
      const src = join(dir, f);
      const st = statSync(src);
      if (!st.isFile()) continue;

      const ext = extname(f).toLowerCase();
      const newName = uuid() + ext;
      copyFileSync(src, join(outDir, newName));
      const url = `/uploads/copilot/${newName}`;

      const baseName = basename(f, extname(f));
      const fileSlug = slugify(baseName);
      const product = matchProduct(products, fileSlug);

      const id = uuid();
      db.prepare(
        'INSERT INTO exports (id, title, style, kind, fields, product_ids, product_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        product ? `Anuncio: ${product.name}` : `Anuncio: ${baseName}`,
        'copilot',
        'images',
        JSON.stringify({ source: 'copilot', filename: f, url, folder: dir }),
        product ? [product.id] : [],
        product ? 1 : 0
      );

      if (product && assignToProduct) {
        let images = [];
        try { images = JSON.parse(product.images || '[]'); } catch { images = []; }
        if (!images.includes(url)) {
          images.unshift(url);
          db.prepare("UPDATE products SET images = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(images), product.id);
        }
      }

      const rec = { id, filename: f, url, product: product ? { id: product.id, name: product.name } : null };
      if (product) imported.push(rec);
      else noMatch.push(rec);
    } catch (err) {
      errors.push({ filename: f, error: err.message });
    }
  }

  res.json({ folder: dir, total: files.length, imported, noMatch, errors });
});

export default router;
