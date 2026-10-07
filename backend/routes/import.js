import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join, dirname, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { ocrDocument, textoConfiable, bestMatch, extractPrice } from '../lib/ocr.js';
import { extraerConVision } from '../lib/vision.js';
import { pareceSecretoValido } from '../lib/settingsMerge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

async function mapPool(arr, n, fn) {
  const out = new Array(arr.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, arr.length)) }, async () => {
    while (cursor < arr.length) {
      const idx = cursor++;
      out[idx] = await fn(arr[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function formaProducto(match) {
  return match
    ? {
        id: match.product.id,
        name: match.product.name,
        current_price: match.product.price,
        visible: !!match.product.catalog_visible,
        confidence: Math.round(match.score * 100),
      }
    : null;
}

function itemOCR(doc, filename, url, products) {
  // Para decidir usamos solo las líneas que Tesseract leyó con confianza; el ruido
  // gráfico de los folletos (rayas, iconos) no debe contaminar el match ni el
  // precio. Si no hubo estructura, caemos al texto crudo para no quedar sin nada.
  const textoFiable = doc.lines.length ? textoConfiable(doc.lines) : (doc.text || '');
  const match = bestMatch(products, textoFiable);
  const price = extractPrice(textoFiable);
  return {
    filename,
    url,
    origen: 'local',
    text: (doc.text || '').trim().slice(0, 600),
    detected_name: '',
    product: formaProducto(match),
    detected_price: price ? { value: price.value, raw: price.raw } : null,
  };
}

function itemsVision(productos, crudo, filename, url, products) {
  const texto = String(crudo || '').trim().slice(0, 600);
  if (!productos.length) {
    return [{ filename, url, origen: 'vision', text: texto, detected_name: '', product: null, detected_price: null }];
  }
  return productos.map((p) => {
    const match = p.nombre ? bestMatch(products, p.nombre) : null;
    let detected = null;
    if (p.precio != null) {
      detected = { value: p.precio, raw: String(p.precio) };
    } else if (p.nombre) {
      const ep = extractPrice(p.nombre);
      if (ep) detected = { value: ep.value, raw: ep.raw };
    }
    return {
      filename,
      url,
      origen: 'vision',
      text: texto,
      detected_name: p.nombre || '',
      product: formaProducto(match),
      detected_price: detected,
    };
  });
}

router.post('/analyze', async (req, res) => {
  const { folder, provider_id, engine } = req.body || {};
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

  const usarVision = engine === 'vision';
  let cfgVision = null;
  if (usarVision) {
    let pc = {};
    try { pc = JSON.parse(db.prepare('SELECT publish_config FROM settings WHERE id = 1').get()?.publish_config || '{}'); } catch {}
    const ai = pc.ai || {};
    if (!ai.enabled || !ai.api_key) {
      return res.status(400).json({ error: 'Motor IA: configurá la API en Ajustes > Publicaciones.' });
    }
    if (!pareceSecretoValido(ai.api_key)) {
      return res.status(400).json({ error: 'La API key guardada no es válida. Volvé a configurarla en Ajustes > Publicaciones.' });
    }
    cfgVision = { apiUrl: ai.api_url || '', apiKey: ai.api_key, model: ai.model || '' };
  }

  const products = db.prepare(
    'SELECT id, name, price, category, catalog_visible FROM products WHERE provider_id = ? ORDER BY name'
  ).all(provider_id);

  const outDir = join(__dirname, '..', 'uploads', 'import');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const files = readdirSync(dir).filter(f => IMAGE_EXT.has(extname(f).toLowerCase()));
  if (files.length === 0) {
    return res.json({ provider: provider.name, products, items: [], engine: usarVision ? 'vision' : 'local', message: 'No se encontraron imágenes en esa carpeta' });
  }

  const procesar = async (f) => {
    try {
      const src = join(dir, f);
      if (!statSync(src).isFile()) return [];
      const newName = uuid() + extname(f).toLowerCase();
      copyFileSync(src, join(outDir, newName));
      const url = `/uploads/import/${newName}`;
      if (usarVision) {
        const { productos, crudo } = await extraerConVision(src, cfgVision);
        return itemsVision(productos, crudo, f, url, products);
      }
      return [itemOCR(await ocrDocument(src), f, url, products)];
    } catch (err) {
      console.error('[Import] Error procesando', f, err);
      return [{ filename: f, error: err.message }];
    }
  };

  const items = [];
  if (usarVision) {
    const grupos = await mapPool(files, 3, procesar);
    for (const g of grupos) items.push(...g);
  } else {
    for (const f of files) items.push(...(await procesar(f)));
  }

  res.json({ provider: provider.name, products, items, engine: usarVision ? 'vision' : 'local' });
});

router.post('/apply', (req, res) => {
  const { provider_id, items, hideAbsent, folder } = req.body || {};
  if (!provider_id) return res.status(400).json({ error: 'Falta el proveedor' });

  const db = getDB();
  const applied = [];
  const errors = [];
  const appliedIds = new Set();
  const appliedByProduct = new Map();

  for (const it of items || []) {
    if (!it || !it.product_id || it.price === undefined || it.price === null || it.price === '') continue;
    const val = Number(String(it.price).replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      errors.push({ product_id: it.product_id, name: it.product_name || '', error: 'Precio inválido' });
      continue;
    }
    const changed = db.prepare(
      "UPDATE products SET price = ?, catalog_visible = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?"
    ).run(val, it.catalog_visible === 0 ? 0 : 1, it.product_id, provider_id);
    if (changed > 0) {
      appliedIds.add(it.product_id);
      appliedByProduct.set(it.product_id, it);
      applied.push({ product_id: it.product_id, price: val, name: it.product_name || '', visible: it.catalog_visible !== 0 });
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

  const deleted = [];
  if (folder && typeof folder === 'string' && appliedByProduct.size > 0) {
    const dir = resolve(folder);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      for (const it of appliedByProduct.values()) {
        const name = String(it.filename || '');
        if (!name || basename(name) !== name) continue;
        if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue;
        const target = join(dir, name);
        try {
          if (existsSync(target) && statSync(target).isFile()) {
            unlinkSync(target);
            deleted.push(name);
          }
        } catch (err) {
          console.error('[Import] No se pudo eliminar', target, err.message);
        }
      }
    }
  }

  res.json({ applied, hidden, errors, deleted });
});

export default router;