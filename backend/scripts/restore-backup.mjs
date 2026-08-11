import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'danimarvis.db');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

const ALL_TABLES = [
  'products', 'providers', 'sales', 'categories', 'settings',
  'users', 'publications', 'publication_queue', 'exports',
];

function resolveSource(arg) {
  if (!arg) {
    if (!fs.existsSync(BACKUPS_DIR)) return null;
    const dirs = fs.readdirSync(BACKUPS_DIR)
      .filter(f => /^danimarvis-\d{4}-\d{2}-\d{2}/.test(f))
      .map(f => path.join(BACKUPS_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (dirs.length) return { jsonPath: path.join(dirs[0], 'danimarvis.json'), imagesDir: path.join(dirs[0], 'uploads'), label: path.basename(dirs[0]) };
    return null;
  }
  const p = path.resolve(arg);
  if (!fs.existsSync(p)) return null;
  if (fs.statSync(p).isDirectory()) {
    const jsonPath = path.join(p, 'danimarvis.json');
    return fs.existsSync(jsonPath)
      ? { jsonPath, imagesDir: path.join(p, 'uploads'), label: path.basename(p) }
      : null;
  }
  return { jsonPath: p, imagesDir: null, label: path.basename(p) };
}

const src = resolveSource(process.argv[2]);
if (!src) {
  console.error('No se encontró respaldo. Uso: node restore-backup.mjs [ruta-del-backup.json | carpeta-de-backup]');
  console.error('Sin argumento restaura el respaldo más reciente de backend/backups/');
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(DB_PATH));
const data = JSON.parse(fs.readFileSync(src.jsonPath, 'utf8'));

function q(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

for (const t of ALL_TABLES) {
  if (!Array.isArray(data[t])) continue;
  const rows = data[t];
  if (!rows.length) continue;

  const existing = db.exec(`SELECT name FROM pragma_table_info('${t}')`);
  const validCols = existing.length
    ? new Set(existing[0].values.map(v => v[0]))
    : new Set();
  const keys = Object.keys(rows[0]).filter(k => validCols.has(k));

  db.exec('DELETE FROM ' + t);
  for (const r of rows) {
    const cols = keys.join(', ');
    const vals = keys.map(k => q(r[k])).join(', ');
    db.exec(`INSERT INTO ${t} (${cols}) VALUES (${vals})`);
  }
  console.log(`Restaurados ${rows.length} registros en ${t}`);
}

fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
console.log('Base de datos guardada en', DB_PATH);

if (src.imagesDir && fs.existsSync(src.imagesDir)) {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.cpSync(src.imagesDir, uploadsDir, { recursive: true });
  const count = fs.readdirSync(uploadsDir).length;
  console.log(`Imágenes restauradas: ${count}`);
}
console.log('Respaldo aplicado:', src.label);
