import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(BACKEND_DIR, 'danimarvis.db');
const UPLOADS_DIR = path.join(BACKEND_DIR, 'uploads');
const BACKUPS_DIR = path.join(BACKEND_DIR, 'backups');

const KEEP = parseInt(process.env.BACKUP_KEEP || '3', 10);
const MAX_AGE_HOURS = parseInt(process.env.BACKUP_MAX_AGE_HOURS || '24', 10);

const TABLES = [
  'products', 'providers', 'sales', 'categories', 'settings',
  'users', 'publications', 'publication_queue', 'exports',
];

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function lastBackupAgeHours() {
  if (!fs.existsSync(BACKUPS_DIR)) return null;
  const dirs = fs.readdirSync(BACKUPS_DIR)
    .filter(f => /^danimarvis-\d{4}-\d{2}-\d{2}/.test(f) && fs.statSync(path.join(BACKUPS_DIR, f)).isDirectory())
    .map(f => path.join(BACKUPS_DIR, f));
  if (!dirs.length) return null;
  const newest = Math.max(...dirs.map(d => fs.statSync(d).mtimeMs));
  return (Date.now() - newest) / 3600000;
}

function cleanOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const dirs = fs.readdirSync(BACKUPS_DIR)
    .filter(f => /^danimarvis-\d{4}-\d{2}-\d{2}/.test(f))
    .map(f => ({ f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const d of dirs.slice(KEEP)) {
    fs.rmSync(path.join(BACKUPS_DIR, d.f), { recursive: true, force: true });
    console.log(`[Backup] Eliminado respaldo antiguo: ${d.f}`);
  }
}

export async function createBackup({ force = false } = {}) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  if (!force) {
    const age = lastBackupAgeHours();
    if (age !== null && age < MAX_AGE_HOURS) {
      console.log(`[Backup] Respaldo reciente (${age.toFixed(1)}h). Omitido. Usá force=true para forzar.`);
      return null;
    }
  }

  const name = `danimarvis-${timestamp()}`;
  const destDir = path.join(BACKUPS_DIR, name);
  fs.mkdirSync(destDir, { recursive: true });

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const data = { version: 2, exported_at: new Date().toISOString() };
  for (const t of TABLES) {
    const r = db.exec(`SELECT * FROM ${t}`);
    data[t] = r.length && r[0].values.length
      ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])))
      : [];
  }
  fs.writeFileSync(path.join(destDir, 'danimarvis.json'), JSON.stringify(data, null, 2));
  console.log(`[Backup] BD exportada: ${data.products.length} productos, ${data.publications.length} publicaciones`);

  if (fs.existsSync(UPLOADS_DIR)) {
    const imgDest = path.join(destDir, 'uploads');
    fs.cpSync(UPLOADS_DIR, imgDest, { recursive: true });
    const count = fs.readdirSync(imgDest).length;
    console.log(`[Backup] Imágenes copiadas: ${count}`);
  }

  cleanOldBackups();
  console.log(`[Backup] Respaldo completo creado: ${destDir}`);
  return destDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  createBackup({ force }).catch((e) => {
    console.error('[Backup] Error:', e);
    process.exit(1);
  });
}
