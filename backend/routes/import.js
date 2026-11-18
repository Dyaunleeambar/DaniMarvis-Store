import { Router } from 'express';
import { existsSync, readdirSync, statSync, lstatSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'fs';
import { join, dirname, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { getDB } from '../db/database.js';
import { ocrDocument, textoConfiable, bestMatch, extractPrice } from '../lib/ocr.js';
import { extraerConVision } from '../lib/vision.js';
import { pareceSecretoValido } from '../lib/settingsMerge.js';
import { resolveLocalUpload } from '../lib/imageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function categoryFolders(db) {
  const rows = db.prepare(`
    SELECT name FROM categories
    UNION
    SELECT DISTINCT category AS name FROM products
    WHERE TRIM(COALESCE(category, '')) <> ''
  `).all();
  const names = [...new Set(rows.map(row => String(row.name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const usedNames = new Set();
  return names.map(name => {
    let baseName = name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'Categoria';
    if (WINDOWS_RESERVED_NAMES.test(baseName)) baseName = `_${baseName}`;
    let folderName = baseName;
    let suffix = 2;
    while (usedNames.has(folderName.toLowerCase())) {
      const ending = `_${suffix++}`;
      folderName = `${baseName.slice(0, 100 - ending.length)}${ending}`;
    }
    usedNames.add(folderName.toLowerCase());
    return { name, folderName };
  });
}

function validateImportFolder(folder) {
  const dir = resolve(folder);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { error: `La carpeta no existe: ${folder}` };
  }
  return { dir };
}

function resolveImageDirectory(folder, category, db) {
  const validated = validateImportFolder(folder);
  if (validated.error || !category) return validated;
  const categoryDir = categoryFolders(db).find(item => item.name === category);
  if (!categoryDir) return { error: 'La categoría ya no existe en el catálogo' };
  const dir = join(validated.dir, categoryDir.folderName);
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink() || !statSync(dir).isDirectory()) {
    return { error: 'La carpeta de categoría no existe o no es segura' };
  }
  return { dir };
}

function importPreviewUrl(source, filename) {
  const outDir = join(__dirname, '..', 'uploads', 'import');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const key = createHash('sha256').update(resolve(source)).digest('hex');
  const previewName = `${key}${extname(filename).toLowerCase()}`;
  copyFileSync(source, join(outDir, previewName));
  return `/uploads/import/${previewName}`;
}

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

router.post('/prepare-categories', (req, res) => {
  const { folder } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde están las imágenes' });
  }
  const validated = validateImportFolder(folder);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const categories = categoryFolders(getDB());
  for (const category of categories) {
    const target = join(validated.dir, category.folderName);
    if (existsSync(target)) {
      const targetStat = lstatSync(target);
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        return res.status(400).json({ error: `El destino de la categoría no es una carpeta segura: ${category.folderName}` });
      }
    } else {
      mkdirSync(target);
    }
  }
  res.json({ categories });
});

router.post('/assign-image', (req, res) => {
  const { folder, filename, category } = req.body || {};
  if (!folder || typeof folder !== 'string' || !filename || typeof filename !== 'string' || !category || typeof category !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta, imagen y categoría' });
  }
  if (basename(filename) !== filename || !IMAGE_EXT.has(extname(filename).toLowerCase())) {
    return res.status(400).json({ error: 'Nombre de imagen inválido' });
  }

  const validated = validateImportFolder(folder);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const categoryDir = categoryFolders(getDB()).find(item => item.name === category);
  if (!categoryDir) return res.status(400).json({ error: 'La categoría ya no existe en el catálogo' });

  const source = join(validated.dir, filename);
  const targetDir = join(validated.dir, categoryDir.folderName);
  if (!existsSync(source) || !lstatSync(source).isFile()) {
    return res.status(404).json({ error: 'La imagen pendiente ya no existe en la carpeta raíz' });
  }
  if (!existsSync(targetDir) || lstatSync(targetDir).isSymbolicLink() || !statSync(targetDir).isDirectory()) {
    return res.status(400).json({ error: 'La carpeta de categoría no está preparada; vuelve a abrir la vista por categoría' });
  }

  const destination = join(targetDir, filename);
  if (existsSync(destination)) {
    return res.status(409).json({ error: 'Ya existe una imagen con ese nombre en la categoría' });
  }
  renameSync(source, destination);
  res.json({ filename, category, folderName: categoryDir.folderName });
});

router.post('/browse', (req, res) => {
  const { folder, category } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde están las imágenes' });
  }
  const db = getDB();
  const validated = resolveImageDirectory(folder, category, db);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const images = readdirSync(validated.dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_EXT.has(extname(entry.name).toLowerCase()))
    .map(entry => {
      const source = join(validated.dir, entry.name);
      return { filename: entry.name, url: importPreviewUrl(source, entry.name) };
    });
  res.json({ category: category || '', images });
});

router.post('/analyze', async (req, res) => {
  const { folder, category, filename, provider_id, engine } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde están las imágenes' });
  }
  if (!provider_id) {
    return res.status(400).json({ error: 'Elegí el proveedor a sincronizar' });
  }

  const db = getDB();
  const validated = resolveImageDirectory(folder, category, db);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (filename && (typeof filename !== 'string' || basename(filename) !== filename || !IMAGE_EXT.has(extname(filename).toLowerCase()))) {
    return res.status(400).json({ error: 'Nombre de imagen inválido' });
  }
  const dir = validated.dir;
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
    'SELECT id, name, price, category, catalog_visible, stock, images, image_url FROM products WHERE provider_id = ? ORDER BY name'
  ).all(provider_id);
  for (const product of products) {
    try { product.images = JSON.parse(product.images || '[]'); } catch { product.images = []; }
    if (!product.images.length && product.image_url) product.images = [product.image_url];
  }

  const files = filename
    ? [filename]
    : readdirSync(dir).filter(f => IMAGE_EXT.has(extname(f).toLowerCase()));
  if (filename) {
    const source = join(dir, filename);
    if (!existsSync(source)) return res.status(404).json({ error: 'La imagen ya no existe en la categoría seleccionada' });
    if (!lstatSync(source).isFile()) return res.status(400).json({ error: 'El archivo indicado no es una imagen válida' });
  }
  if (files.length === 0) {
    return res.json({ provider: provider.name, products, items: [], engine: usarVision ? 'vision' : 'local', message: 'No se encontraron imágenes en esa carpeta' });
  }

  const procesar = async (f) => {
    let url = '';
    try {
      const src = join(dir, f);
      if (!existsSync(src) || !lstatSync(src).isFile()) return [];
      url = importPreviewUrl(src, f);
      if (usarVision) {
        const { productos, crudo } = await extraerConVision(src, cfgVision);
        return itemsVision(productos, crudo, f, url, products);
      }
      return [itemOCR(await ocrDocument(src), f, url, products)];
    } catch (err) {
      console.error('[Import] Error procesando', f, err);
      return [{ filename: f, ...(url ? { url } : {}), error: err.message }];
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

router.post('/discard-image', (req, res) => {
  const { folder, category, filename } = req.body || {};
  if (!folder || typeof folder !== 'string' || !filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta y el nombre de la imagen' });
  }
  if (basename(filename) !== filename || !IMAGE_EXT.has(extname(filename).toLowerCase())) {
    return res.status(400).json({ error: 'Nombre de imagen inválido' });
  }

  const validated = resolveImageDirectory(folder, category, getDB());
  if (validated.error) return res.status(400).json({ error: validated.error });
  const dir = validated.dir;
  const target = join(dir, filename);
  if (!existsSync(target)) return res.status(404).json({ error: 'La imagen ya no existe en la carpeta' });
  if (!lstatSync(target).isFile()) {
    return res.status(400).json({ error: 'El archivo indicado no es una imagen válida' });
  }

  unlinkSync(target);
  res.json({ deleted: filename });
});

router.post('/apply', (req, res) => {
  const { provider_id, items, hideAbsent, folder, category } = req.body || {};
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
    const validated = resolveImageDirectory(folder, category, db);
    if (!validated.error) {
      const dir = validated.dir;
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

// ---------- Comparación visual con imágenes de referencia ----------
async function computeImageHash(imagePath, size = 32) {
  // dHash: redimensionar a (size+1) x size, escala de grises, comparar píxeles adyacentes horizontalmente
  const { data, info } = await sharp(imagePath)
    .resize(size + 1, size, { fit: 'cover', position: 'center' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width } = info;
  const chunks = []; // array de números de 31 bits para evitar overflow en JS
  let chunk = 0;
  let bitCount = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * width + x);
      const idxRight = (y * width + (x + 1));
      const pxLeft = data[idx];
      const pxRight = data[idxRight];
      const bit = pxLeft > pxRight ? 1 : 0;
      chunk = (chunk << 1) | bit;
      bitCount++;
      if (bitCount === 31) {
        chunks.push(chunk);
        chunk = 0;
        bitCount = 0;
      }
    }
  }
  if (bitCount > 0) {
    chunk = chunk << (31 - bitCount);
    chunks.push(chunk);
  }
  return chunks;
}

function hashSimilarity(chunksA, chunksB) {
  if (!chunksA || !chunksB || chunksA.length !== chunksB.length) return 0;
  let totalBits = 0;
  let diffBits = 0;
  for (let i = 0; i < chunksA.length; i++) {
    let xor = chunksA[i] ^ chunksB[i];
    for (let b = 0; b < 31; b++) {
      totalBits++;
      if (xor & 1) diffBits++;
      xor >>>= 1;
    }
  }
  return 1 - diffBits / totalBits;
}

router.post('/sync-reference-images', async (req, res) => {
  const { folder } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta donde están las imágenes' });
  }
  const validated = validateImportFolder(folder);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const db = getDB();
  const products = db.prepare(
    'SELECT id, name, category, reference_image FROM products WHERE reference_image IS NOT NULL AND reference_image <> ""'
  ).all();

  const refProducts = [];
  for (const p of products) {
    const refPath = resolveLocalUpload(p.reference_image);
    if (refPath && p.category) {
      refProducts.push({ ...p, refPath });
    }
  }

  if (refProducts.length === 0) {
    return res.json({ matches: [], noMatch: [], total: 0, message: 'No hay productos con imagen de referencia y categoría' });
  }

  const files = readdirSync(validated.dir)
    .filter(f => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort();

  const matches = [];
  const noMatch = [];

  for (const filename of files) {
    const sourcePath = join(validated.dir, filename);
    if (!lstatSync(sourcePath).isFile()) continue;

    let bestMatch = null;
    let bestScore = 0;

    try {
      const sourceHash = await computeImageHash(sourcePath);

      for (const p of refProducts) {
        try {
          const refHash = await computeImageHash(p.refPath);
          const score = hashSimilarity(sourceHash, refHash);
          if (score > bestScore && score >= 0.72) {
            bestScore = score;
            bestMatch = {
              product: { id: p.id, name: p.name, category: p.category },
              score: Math.round(score * 100)
            };
          }
        } catch (err) {
          console.error('[Import] Error hashing reference', p.reference_image, err.message);
        }
      }
    } catch (err) {
      console.error('[Import] Error hashing source', filename, err.message);
    }

    if (bestMatch) {
      matches.push({ filename, ...bestMatch });
      console.log('[Import Sync] Coincidencia', filename, '->', bestMatch.product.name, '(', bestMatch.score, '%)', 'cat:', bestMatch.product.category);
    } else {
      noMatch.push(filename);
      console.log('[Import Sync] Sin coincidencia', filename);
    }
  }

  res.json({ matches, noMatch, total: files.length });
});

// ---------- Comparación individual: una sola imagen contra referencias ----------
async function compareSingleImage(folder, filename) {
  const validated = validateImportFolder(folder);
  if (validated.error) return { error: validated.error };

  const db = getDB();
  const products = db.prepare(
    'SELECT id, name, category, reference_image FROM products WHERE reference_image IS NOT NULL AND reference_image <> ""'
  ).all();

  const refProducts = [];
  for (const p of products) {
    const refPath = resolveLocalUpload(p.reference_image);
    if (refPath && p.category) {
      refProducts.push({ ...p, refPath });
    }
  }

  if (refProducts.length === 0) {
    return { match: null, noReference: true };
  }

  const sourcePath = join(validated.dir, filename);
  if (!lstatSync(sourcePath).isFile()) {
    return { match: null, error: 'Archivo no encontrado' };
  }

  let bestMatch = null;
  let bestScore = 0;

  try {
    const sourceHash = await computeImageHash(sourcePath);

    for (const p of refProducts) {
      try {
        const refHash = await computeImageHash(p.refPath);
        const score = hashSimilarity(sourceHash, refHash);
        if (score > bestScore && score >= 0.72) {
          bestScore = score;
          bestMatch = {
            product: { id: p.id, name: p.name, category: p.category },
            score: Math.round(score * 100)
          };
        }
      } catch (err) {
        console.error('[Import] Error hashing reference', p.reference_image, err.message);
      }
    }
  } catch (err) {
    console.error('[Import] Error hashing source', filename, err.message);
    return { match: null, error: err.message };
  }

  return { match: bestMatch, noReference: false };
}

router.post('/compare-single-image', async (req, res) => {
  const { folder, filename } = req.body || {};
  if (!folder || typeof folder !== 'string' || !filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Indicá la carpeta y el nombre de la imagen' });
  }
  const result = await compareSingleImage(folder, filename);
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ filename, match: result.match, noReference: result.noReference });
});

export default router;