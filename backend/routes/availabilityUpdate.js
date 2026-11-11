import { Router } from 'express';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { dirname, extname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getDB, transaccion } from '../db/database.js';
import { resolveLocalUpload } from '../lib/imageUtils.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const AUTO_MATCH_MAX_DISTANCE = 7;
const REVIEW_MAX_DISTANCE = 14;
const AUTO_MATCH_MARGIN = 3;

function fingerprintInventory(images) {
  const hash = createHash('sha256');
  for (const image of [...images].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(image.relativePath);
    hash.update('\0');
    hash.update(createHash('sha256').update(readFileSync(image.path)).digest());
  }
  return hash.digest('hex');
}

function listInventoryImages(folder) {
  const root = resolve(folder);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('La carpeta indicada no existe o no es válida');
  }
  const images = [];
  const addDirectory = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXT.has(extname(entry.name).toLowerCase())) continue;
      const path = join(dir, entry.name);
      if (lstatSync(path).isSymbolicLink()) continue;
      images.push({ path, filename: entry.name, relativePath: relative(root, path).split(sep).join('/') });
    }
  };
  addDirectory(root);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (lstatSync(dir).isSymbolicLink()) continue;
    addDirectory(dir);
  }
  return { root, images };
}

async function imageHash(path) {
  const { data, info } = await sharp(path)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = '';
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width - 1; x++) {
      hash += data[y * info.width + x] > data[y * info.width + x + 1] ? '1' : '0';
    }
  }
  return hash;
}

function hammingDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distance++;
  return distance;
}

async function thumbnail(path) {
  const buffer = await sharp(path)
    .resize(180, 180, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 68 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function analyzeInventory(providerId, folder) {
  const db = getDB();
  const provider = db.prepare('SELECT id, name FROM providers WHERE id = ?').get(providerId);
  if (!provider) throw new Error('Proveedor no encontrado');
  const inventory = listInventoryImages(folder);
  if (!inventory.images.length) throw new Error('No se encontraron imágenes en la carpeta ni en sus subcarpetas');

  const productRows = db.prepare(`
    SELECT id, name, category, catalog_visible, reference_image
    FROM products WHERE provider_id = ? ORDER BY name
  `).all(providerId);

  const products = [];
  const productErrors = [];
  for (const row of productRows) {
    if (!row.reference_image) {
      products.push({ ...row, referencePath: '', hash: '', thumbnail: '' });
      continue;
    }
    const referencePath = resolveLocalUpload(row.reference_image);
    if (!referencePath) {
      productErrors.push(`${row.name}: no se encontró el archivo de referencia guardado`);
      products.push({ ...row, referencePath: '', hash: '', thumbnail: '' });
      continue;
    }
    try {
      products.push({
        ...row,
        referencePath,
        hash: await imageHash(referencePath),
        thumbnail: await thumbnail(referencePath),
      });
    } catch (err) {
      productErrors.push(`${row.name}: no se pudo leer la imagen de referencia (${err.message})`);
      products.push({ ...row, referencePath: '', hash: '', thumbnail: '' });
    }
  }

  const imageErrors = [];
  const sourceImages = [];
  for (const image of inventory.images) {
    try {
      sourceImages.push({
        ...image,
        hash: await imageHash(image.path),
        thumbnail: await thumbnail(image.path),
      });
    } catch (err) {
      imageErrors.push(`${image.relativePath}: no se pudo leer (${err.message})`);
    }
  }

  const referencedProducts = products.filter(product => product.hash);
  const ambiguousProductIds = new Set();
  const matchedProductIds = new Set();
  const matches = [];
  const unmatchedImages = [];
  const ambiguousImages = [];

  for (const image of sourceImages) {
    const ranked = referencedProducts
      .map(product => ({ product, distance: hammingDistance(image.hash, product.hash) }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best) {
      unmatchedImages.push({ filename: image.relativePath, url: image.thumbnail, thumbnail: image.thumbnail });
      continue;
    }
    const second = ranked[1];
    const margin = second ? second.distance - best.distance : Infinity;
    if (best.distance <= AUTO_MATCH_MAX_DISTANCE && margin >= AUTO_MATCH_MARGIN) {
      matchedProductIds.add(best.product.id);
      matches.push({
        filename: image.relativePath,
        url: image.thumbnail,
        imageThumbnail: image.thumbnail,
        productId: best.product.id,
        productName: best.product.name,
        referenceImage: best.product.reference_image,
        referenceThumbnail: best.product.thumbnail,
        distance: best.distance,
      });
      continue;
    }
    if (best.distance <= REVIEW_MAX_DISTANCE) {
      for (const candidate of ranked.filter(item => item.distance <= REVIEW_MAX_DISTANCE && item.distance - best.distance < AUTO_MATCH_MARGIN)) {
        ambiguousProductIds.add(candidate.product.id);
      }
      ambiguousImages.push({
        filename: image.relativePath,
        url: image.thumbnail,
        imageThumbnail: image.thumbnail,
        candidates: ranked.slice(0, 3).map(item => ({
          productId: item.product.id,
          productName: item.product.name,
          referenceThumbnail: item.product.thumbnail,
          distance: item.distance,
        })),
      });
      continue;
    }
    unmatchedImages.push({ filename: image.relativePath, url: image.thumbnail, thumbnail: image.thumbnail });
  }

  const productResults = products.map(product => {
    const hasReference = !!product.hash;
    const matched = matchedProductIds.has(product.id);
    const needsReview = ambiguousProductIds.has(product.id) && !matched;
    let decision = 'no_reference';
    if (hasReference && matched) decision = 'available';
    else if (hasReference && needsReview) decision = 'review';
    else if (hasReference) decision = 'unavailable';
    return {
      id: product.id,
      name: product.name,
      category: product.category || '',
      catalog_visible: product.catalog_visible ? 1 : 0,
      reference_image: product.reference_image || '',
      referenceThumbnail: product.thumbnail || '',
      decision,
    };
  });

  const preview = {
    provider: { id: provider.id, name: provider.name },
    folder: inventory.root,
    inventoryFingerprint: fingerprintInventory(inventory.images),
    analyzedImages: sourceImages.length,
    imageErrors,
    productErrors,
    matches,
    ambiguousImages,
    unmatchedImages,
    products: productResults,
    changes: productResults.filter(product => (
      product.decision === 'available' && !product.catalog_visible
    ) || (
      product.decision === 'unavailable' && product.catalog_visible
    )),
  };
  return preview;
}

router.post('/analyze', async (req, res) => {
  const { provider_id: providerId, folder } = req.body || {};
  if (typeof providerId !== 'string' || !providerId || typeof folder !== 'string' || !folder.trim()) {
    return res.status(400).json({ error: 'Seleccioná un proveedor y la carpeta de imágenes' });
  }
  try {
    const preview = await analyzeInventory(providerId, folder.trim());
    const batchId = randomUUID();
    const persistedPreview = {
      provider: preview.provider,
      folder: preview.folder,
      inventoryFingerprint: preview.inventoryFingerprint,
      analyzedImages: preview.analyzedImages,
      imageErrors: preview.imageErrors,
      productErrors: preview.productErrors,
      products: preview.products.map(({ referenceThumbnail, ...product }) => product),
      changes: preview.changes,
    };
    dbInsertBatch(batchId, providerId, preview.folder, persistedPreview);
    res.json({ ...preview, batch_id: batchId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  const rows = getDB().prepare(`
    SELECT b.id, b.provider_id, p.name AS provider_name, b.status, b.created_at,
           json_array_length(b.changes_json) AS changed_count
    FROM availability_update_batches b
    LEFT JOIN providers p ON p.id = b.provider_id
    WHERE b.status IN ('applied', 'undone')
    ORDER BY b.created_at DESC
    LIMIT 10
  `).all();
  res.json(rows);
});

function dbInsertBatch(id, providerId, folder, preview) {
  getDB().prepare(`
    INSERT INTO availability_update_batches (id, provider_id, folder, status, preview_json)
    VALUES (?, ?, ?, 'preview', ?)
  `).run(id, providerId, folder, JSON.stringify(preview));
}

router.post('/:batchId/apply', async (req, res) => {
  const { confirm_complete_inventory: confirmComplete } = req.body || {};
  if (confirmComplete !== true) {
    return res.status(400).json({ error: 'Confirmá que las imágenes incluyen todo lo disponible de este proveedor' });
  }
  const db = getDB();
  const batch = db.prepare("SELECT * FROM availability_update_batches WHERE id = ? AND status = 'preview'").get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'La vista previa no existe o ya fue aplicada' });
  const preview = JSON.parse(batch.preview_json || '{}');
  if (preview.imageErrors?.length || preview.productErrors?.length) {
    return res.status(409).json({ error: 'Hay errores de lectura en imágenes. Corrígelos antes de aplicar la actualización.' });
  }
  try {
    const currentInventory = listInventoryImages(batch.folder);
    if (fingerprintInventory(currentInventory.images) !== preview.inventoryFingerprint) {
      return res.status(409).json({ error: 'Las imágenes cambiaron desde el análisis. Generá una vista previa nueva.' });
    }
  } catch (err) {
    return res.status(409).json({ error: `No se pudo verificar la carpeta del análisis: ${err.message}` });
  }

  const changes = preview.changes || [];
  const applied = [];
  try {
    transaccion(db, () => {
      for (const item of changes) {
        const current = db.prepare('SELECT id, catalog_visible, reference_image FROM products WHERE id = ? AND provider_id = ?').get(item.id, batch.provider_id);
        if (!current) throw new Error(`El producto "${item.name}" ya no pertenece al proveedor`);
        if (Number(current.catalog_visible) !== Number(item.catalog_visible)) {
          throw new Error(`El estado de "${item.name}" cambió después del análisis. Generá una vista previa nueva.`);
        }
        if ((current.reference_image || '') !== (item.reference_image || '')) {
          throw new Error(`La imagen de referencia de "${item.name}" cambió después del análisis. Generá una vista previa nueva.`);
        }
        const nextVisible = item.decision === 'available' ? 1 : 0;
        db.prepare("UPDATE products SET catalog_visible = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?")
          .run(nextVisible, item.id, batch.provider_id);
        applied.push({ id: item.id, name: item.name, previous: Number(current.catalog_visible), next: nextVisible });
      }
      db.prepare(`
        UPDATE availability_update_batches
        SET status = 'applied', changes_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(applied), batch.id);
    });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  res.json({ batch_id: batch.id, applied, message: `${applied.length} producto(s) actualizado(s)` });
});

router.post('/:batchId/undo', (req, res) => {
  const db = getDB();
  const batch = db.prepare("SELECT * FROM availability_update_batches WHERE id = ? AND status = 'applied'").get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'No hay una actualización aplicada que se pueda deshacer' });
  const changes = JSON.parse(batch.changes_json || '[]');
  try {
    transaccion(db, () => {
      for (const item of changes) {
        const current = db.prepare('SELECT catalog_visible FROM products WHERE id = ? AND provider_id = ?').get(item.id, batch.provider_id);
        if (!current || Number(current.catalog_visible) !== Number(item.next)) {
          throw new Error(`El estado de "${item.name}" cambió desde la actualización; no se puede restaurar sin sobrescribirlo`);
        }
      }
      for (const item of changes) {
        db.prepare("UPDATE products SET catalog_visible = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?")
          .run(item.previous, item.id, batch.provider_id);
      }
      db.prepare("UPDATE availability_update_batches SET status = 'undone', updated_at = datetime('now') WHERE id = ?").run(batch.id);
    });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  res.json({ batch_id: batch.id, restored: changes.length, message: 'Actualización deshecha' });
});

export default router;
