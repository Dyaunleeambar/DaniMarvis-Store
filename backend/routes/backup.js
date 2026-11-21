import { Router } from 'express';
import { createReadStream, existsSync, lstatSync, readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { extname, join, relative, resolve, sep } from 'path';
import { getDB, saveDB, listTables } from '../db/database.js';
import { resolveLocalUpload } from '../lib/imageUtils.js';

const router = Router();
const AI_PACKAGE_TTL_MS = 30 * 60 * 1000;
const AI_PACKAGE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const aiPackages = new Map();

function listAiInventoryImages(folder) {
  const root = resolve(folder);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('La carpeta indicada no existe o no es válida');
  }
  const files = [];
  const addDirectory = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !AI_PACKAGE_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const path = join(directory, entry.name);
      if (lstatSync(path).isSymbolicLink()) continue;
      files.push({ path, filename: entry.name, relativePath: relative(root, path).split(sep).join('/') });
    }
  };
  addDirectory(root);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    if (!lstatSync(directory).isSymbolicLink()) addDirectory(directory);
  }
  if (!files.length) throw new Error('No se encontraron imágenes en la carpeta ni en sus subcarpetas inmediatas');
  return { root, files };
}

function purgeExpiredAiPackages() {
  const now = Date.now();
  for (const [id, aiPackage] of aiPackages) {
    if (aiPackage.expiresAt <= now) {
      clearTimeout(aiPackage.expirationTimer);
      aiPackages.delete(id);
    }
  }
}

router.get('/', (req, res) => {
  const db = getDB();
  const data = {
    version: 2,
    exported_at: new Date().toISOString(),
  };
  for (const t of listTables()) {
    data[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  res.json(data);
});

function q(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

router.post('/restore', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Archivo de respaldo inválido' });
  }

  const db = getDB();
  const tables = new Set(listTables());

  // Se restaura tabla por tabla (DELETE + INSERT). Con foreign_keys activos el
  // orden de borrado/inserción podría violar integridad referencial, por lo que
  // se desactiva durante la restauración y se vuelve a activar al final.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const t of Object.keys(data)) {
      if (!tables.has(t)) continue;
      if (!Array.isArray(data[t])) continue;
      const rows = data[t];

      const existing = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t);
      const validCols = new Set(existing.map(r => r.name));

      // Una tabla VACÍA en el respaldo también se limpia. Con el `continue` que
      // había antes, restaurar un respaldo en el que esa tabla estaba vacía
      // dejaba los datos del momento intactos: el resultado no era la foto de
      // esa fecha sino un revolújido de dos. Lo que decide el borrado es que la
      // tabla esté en el JSON, no que tenga filas.
      const before = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c;
      if (before > 0) {
        db.exec('DELETE FROM ' + t);
      }

      for (const r of rows) {
        const keys = Object.keys(r).filter(k => validCols.has(k));
        if (!keys.length) continue;
        const cols = keys.join(', ');
        const vals = keys.map(k => q(r[k])).join(', ');
        db.exec(`INSERT INTO ${t} (${cols}) VALUES (${vals})`);
      }
      console.log(`[Backup] Restaurada ${t}: ${rows.length} fila(s)`);
    }

    saveDB();
    res.json({ message: 'Datos restaurados correctamente' });
  } catch (e) {
    const msg = e?.message || e?.toString() || 'Error desconocido';
    console.error('[Backup] Error al restaurar:', msg);
    res.status(500).json({ error: 'Error al restaurar los datos: ' + msg });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
});

router.post('/ai-analysis-package', (req, res) => {
  const { provider_id: providerId, folder, inventory_complete: inventoryComplete } = req.body || {};
  if (typeof providerId !== 'string' || !providerId || typeof folder !== 'string' || !folder.trim()) {
    return res.status(400).json({ error: 'Seleccioná un proveedor e indicá la carpeta de imágenes actuales' });
  }

  try {
    const db = getDB();
    const provider = db.prepare('SELECT id, name FROM providers WHERE id = ?').get(providerId);
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const inventory = listAiInventoryImages(folder.trim());
    const products = db.prepare(`
      SELECT id, name, category, status, stock, catalog_visible, reference_image
      FROM products
      WHERE provider_id = ?
      ORDER BY category, name
    `).all(providerId);

    if (!products.length) return res.status(400).json({ error: 'Este proveedor no tiene productos para analizar' });

    const assets = [];
    const packageAssets = new Map();
    const addAsset = (path, kind, details = {}) => {
      const id = randomUUID();
      const extension = extname(path).toLowerCase() || '.img';
      const archivePath = `${kind === 'reference' ? 'imagenes-referencia' : 'imagenes-actuales'}/${id}${extension}`;
      const asset = { id, path: archivePath, kind, ...details };
      assets.push(asset);
      packageAssets.set(id, { ...asset, sourcePath: path });
      return archivePath;
    };

    const productRows = products.map(product => {
      const referencePath = product.reference_image ? resolveLocalUpload(product.reference_image) : null;
      const referenceIsFile = referencePath
        && existsSync(referencePath)
        && lstatSync(referencePath).isFile()
        && !lstatSync(referencePath).isSymbolicLink();
      const referenceStatus = !product.reference_image
        ? 'not_configured'
        : referenceIsFile ? 'included' : 'file_unavailable';
      return {
        id: product.id,
        name: product.name,
        category: product.category || '',
        status: product.status || '',
        stock: product.stock ?? null,
        catalog_visible: !!product.catalog_visible,
        reference_image: referenceIsFile
          ? addAsset(referencePath, 'reference', { product_id: product.id })
          : null,
        reference_status: referenceStatus,
      };
    });

    const currentImages = inventory.files.map(image => ({
      file: addAsset(image.path, 'current', { original_filename: image.relativePath }),
      original_filename: image.relativePath,
    }));

    purgeExpiredAiPackages();
    const packageId = randomUUID();
    const expirationTimer = setTimeout(() => aiPackages.delete(packageId), AI_PACKAGE_TTL_MS);
    expirationTimer.unref();
    aiPackages.set(packageId, {
      expiresAt: Date.now() + AI_PACKAGE_TTL_MS,
      expirationTimer,
      assets: packageAssets,
    });

    res.json({
      package_id: packageId,
      expires_in_seconds: AI_PACKAGE_TTL_MS / 1000,
      manifest: {
        format: 'danimarvis-ai-availability-analysis',
        version: 1,
        exported_at: new Date().toISOString(),
        provider: { id: provider.id, name: provider.name },
        inventory_complete: inventoryComplete === true,
        products: productRows,
        current_images: currentImages,
        assets,
        analysis_guidance: [
          'Compare each current image with the product reference images.',
          `Classify clear matches as available; ${inventoryComplete === true ? 'the inventory was confirmed complete, so a product with no reliable match may be classified as out of stock.' : 'the inventory was not confirmed complete, so do not classify any product as out of stock.'}`,
          'Treat weak or ambiguous matches as needs_review, not as out of stock.',
          'Classify an unmatched current image as a possible_new_product.',
          'Do not make an availability decision for a product whose reference_status is not included.',
          'Return product IDs, image filenames used as evidence, confidence, and a concise reason for each classification.',
        ],
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ai-analysis-package/:packageId/assets/:assetId', (req, res) => {
  purgeExpiredAiPackages();
  const aiPackage = aiPackages.get(req.params.packageId);
  const asset = aiPackage?.assets.get(req.params.assetId);
  if (!asset) return res.status(404).json({ error: 'El paquete venció o la imagen ya no está disponible; vuelve a prepararlo' });

  res.type(extname(asset.sourcePath));
  const stream = createReadStream(asset.sourcePath);
  stream.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: `No se pudo leer una imagen del paquete: ${err.message}` });
    else res.destroy(err);
  });
  stream.pipe(res);
});

router.delete('/ai-analysis-package/:packageId', (req, res) => {
  const aiPackage = aiPackages.get(req.params.packageId);
  if (aiPackage) clearTimeout(aiPackage.expirationTimer);
  aiPackages.delete(req.params.packageId);
  res.json({ deleted: true });
});

export default router;
