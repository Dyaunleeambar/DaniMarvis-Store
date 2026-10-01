import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'danimarvis.db');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

// Las tablas NO se listan a mano: se leen de la base. La lista fija que había
// antes se quedó atrás y se comía el.facebook_groups, los rankings, los estilos
// de proveedor, las rutinas de página y todo lo que se agregara después, sin
// avisar: esas tablas no se restauraban y quedaban con los datos del momento.
// Ahora sale todo lo que exista, que es lo que significa "restaurar".

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

const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
const ALL_TABLES = r.length && r[0].values.length ? r[0].values.map(v => String(v[0])) : [];

function q(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

for (const t of ALL_TABLES) {
  if (!Array.isArray(data[t])) continue;
  const rows = data[t];

  const existing = db.exec(`SELECT name FROM pragma_table_info('${t}')`);
  const validCols = existing.length ? new Set(existing[0].values.map(v => v[0])) : new Set();

  // La tabla que vino VACÍA también se vacía. Con el `continue` que había antes
  // quedaba con los datos del momento y el resultado no era la foto de esa
  // fecha: era un mezcla de dos. Lo que decide el borrado es que la tabla esté
  // en el JSON, no que tenga filas.
  db.exec('DELETE FROM ' + t);
  let n = 0;
  for (const r of rows) {
    const keys = Object.keys(r).filter(k => validCols.has(k));
    if (!keys.length) continue;
    const cols = keys.join(', ');
    const vals = keys.map(k => q(r[k])).join(', ');
    db.exec(`INSERT INTO ${t} (${cols}) VALUES (${vals})`);
    n++;
  }
  console.log(`Restaurados ${n} registros en ${t}`);
}

fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
console.log('Base de datos guardada en', DB_PATH);

if (src.imagesDir && fs.existsSync(src.imagesDir)) {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.cpSync(src.imagesDir, uploadsDir, { recursive: true });
  const count = fs.readdirSync(uploadsDir).length;
  console.log(`Imágenes restauradas: ${count}`);
} else {
  // Los respaldos nuevos no traen copia de `uploads/`: las imágenes están en
  // Drive como espejo y copiar 1.7 GB dentro del respaldo local las duplicaba
  // sin proteger nada. Si faltan imágenes, se recuperan de Drive.
  console.log('Este respaldo no trae imágenes: están en Drive (DaniMarvisStore/uploads).');
}
console.log('Respaldo aplicado:', src.label);
