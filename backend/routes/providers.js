import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE_IMPORT_DIR = join(__dirname, '..', '..', 'precios-importacion');

function sanitizeFolderName(name) {
  return String(name || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|$/g, '');
}

function getProviderFolder(providerName) {
  return join(BASE_IMPORT_DIR, sanitizeFolderName(providerName));
}

function ensureBaseImportDir() {
  if (!existsSync(BASE_IMPORT_DIR)) {
    mkdirSync(BASE_IMPORT_DIR, { recursive: true });
  }
}

function createProviderFolder(name) {
  ensureBaseImportDir();
  const folder = getProviderFolder(name);
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }
  return folder;
}

function renameProviderFolder(oldName, newName) {
  ensureBaseImportDir();
  const oldFolder = getProviderFolder(oldName);
  const newFolder = getProviderFolder(newName);
  if (existsSync(oldFolder) && oldFolder !== newFolder) {
    if (existsSync(newFolder)) {
      const files = readdirSync(oldFolder);
      for (const f of files) {
        renameSync(join(oldFolder, f), join(newFolder, f));
      }
      rmSync(oldFolder, { recursive: true });
    } else {
      renameSync(oldFolder, newFolder);
    }
  }
  return newFolder;
}

function deleteProviderFolder(name) {
  const folder = getProviderFolder(name);
  if (existsSync(folder)) {
    rmSync(folder, { recursive: true, force: true });
  }
}

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const providers = db.prepare(`
    SELECT p.*, COUNT(pr.id) as product_count
    FROM providers p
    LEFT JOIN products pr ON pr.provider_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `).all();
  res.json(providers);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const provider = db.prepare(`
    SELECT p.*, COUNT(pr.id) as product_count
    FROM providers p
    LEFT JOIN products pr ON pr.provider_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json(provider);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { name, contact, phone, email, info, notes, commission_currency } = req.body;

  if (!name) return res.status(400).json({ error: 'Nombre del proveedor es obligatorio' });

  const id = uuid();
  const provider = { id, name, contact: contact || '', phone: phone || '', email: email || '', info: info || '', notes: notes || '', commission_currency: commission_currency || 'USD' };

  db.prepare(`INSERT INTO providers (id, name, contact, phone, email, info, notes, commission_currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    provider.id, provider.name, provider.contact, provider.phone,
    provider.email, provider.info, provider.notes, provider.commission_currency
  );

  const folder = createProviderFolder(name);
  provider.import_folder = folder;

  res.status(201).json(provider);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id, name FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const { name, contact, phone, email, info, notes, commission_currency } = req.body;

  if (name && name !== existing.name) {
    renameProviderFolder(existing.name, name);
  }

  db.prepare(`UPDATE providers SET
    name = COALESCE(?, name), contact = COALESCE(?, contact),
    phone = COALESCE(?, phone), email = COALESCE(?, email),
    info = COALESCE(?, info),
    notes = COALESCE(?, notes), commission_currency = COALESCE(?, commission_currency),
    updated_at = datetime('now')
    WHERE id = ?`).run(name, contact, phone, email, info, notes, commission_currency, req.params.id);

  const updated = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id, name FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const productCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE provider_id = ?').get(req.params.id);
  if (productCount.c > 0) {
    return res.status(400).json({ error: `No se puede eliminar: tiene ${productCount.c} producto(s) asociados. Archive o reasigne primero.` });
  }

  deleteProviderFolder(existing.name);
  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Proveedor eliminado' });
});

export default router;
