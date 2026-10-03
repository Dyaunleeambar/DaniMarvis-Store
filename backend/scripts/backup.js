import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(BACKEND_DIR, 'danimarvis.db');
const UPLOADS_DIR = path.join(BACKEND_DIR, 'uploads');
const BACKUPS_DIR = path.join(BACKEND_DIR, 'backups');

const KEEP = parseInt(process.env.BACKUP_KEEP || '3', 10);
const MAX_AGE_HOURS = parseInt(process.env.BACKUP_MAX_AGE_HOURS || '24', 10);

// ─────────────────────────────── Drive (fuera de esta máquina) ───────────────
//
// La BD y las imágenes son lo único que NO está en git. Si se caen con el disco,
// un respaldo guardado en la misma partición se cae con él: por eso el espejo va
// a Drive. El remoto lo crea el usuario UNA vez con `rclone config` (el login es
// en el navegador, acá no hay ni usuario ni contraseña) y queda en el perfil de
// Windows, fuera del repo.
//
// "Es incremental" significa que rclone compara nombre, tamaño y fecha y sube
// SOLO lo que falta o cambió. Las imágenes se suben una vez y nunca se vuelven a
// subir; de ahí que los respaldos locales ya no copien `uploads/`: sería una
// segunda copia de 1.7 GB en el mismo disco que no protege de nada.
const DRIVE_REMOTE = process.env.BACKUP_DRIVE_REMOTE || 'gdrive';
const DRIVE_DIR = (process.env.BACKUP_DRIVE_DIR || 'DaniMarvisStore').replace(/^\/+|\/+$/g, '');
const DRIVE_KEEP = parseInt(process.env.BACKUP_DRIVE_KEEP || '30', 10);
// 'auto' = copia en local solo mientras Drive no esté listo. '1'/'0' = forzarlo.
const UPLOADS_LOCAL = process.env.BACKUP_UPLOADS_LOCAL || 'auto';
// Cuánto se espera la subida. El espejo diario es de unos pocos archivos y va
// sobrado con 30 min; la PRIMERA vez hay que subir todo uploads/ y con una
// conexión lenta de subida (~200 KB/s) 1.8 GB se van a más de 2 h, así que para
// esa corrida hay que pasarlo por variable (BACKUP_DRIVE_TIMEOUT_MIN=240).
const DRIVE_TIMEOUT_MIN = parseInt(process.env.BACKUP_DRIVE_TIMEOUT_MIN || '30', 10);

/**
 * Dónde está el rclone.
 *
 * winget deja el exe dentro de su propia carpeta con la versión en el nombre, y
 * solo actualiza el PATH de sesiones nuevas. Si el server arrancó antes de
 * instalarlo, `rclone` a secas no existe y el respaldo se caería en silencio.
 * Por eso se busca también ahí, y se devuelve el nombre pelado solo como
 * último recurso para que el error diga algo útil.
 */
function whichRclone() {
  const directo = process.env.RCLONE_PATH;
  if (directo && fs.existsSync(directo)) return directo;
  const raiz = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(raiz)) {
      if (!/^rclone\.rclone/i.test(d)) continue;
      const base = path.join(raiz, d);
      for (const sub of fs.readdirSync(base)) {
        const exe = path.join(base, sub, 'rclone.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch { /* sin WinGet: se cae al nombre pelado */ }
  return 'rclone';
}

function rclone(args, timeoutMs = DRIVE_TIMEOUT_MIN * 60 * 1000) {
  return execFileSync(whichRclone(), args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** El remoto de Drive ya configurado, o null si todavía no lo hay. */
function driveListo() {
  try {
    const out = rclone(['listremotes'], 30000);
    return out.split(/\r?\n/).some((l) => l.trim() === `${DRIVE_REMOTE}:`);
  } catch {
    return false;
  }
}

function driveRaiz() {
  return `${DRIVE_REMOTE}:${DRIVE_DIR}`;
}

function subirImagenes() {
  if (!fs.existsSync(UPLOADS_DIR)) { console.log('[Backup] No hay uploads para subir'); return; }
  const destino = `${driveRaiz()}/uploads`;
  // --tpslimit evita que Google tire la subida por exceso de peticiones: con
  // ~2000 imágenes de golpe, sin límite, aparecen "quota exceeded" a medias.
  rclone(['copy', UPLOADS_DIR, destino, '--tpslimit', '8', '--tpslimit-burst', '1',
    '--transfers', '4', '--checkers', '16', '--retries', '5', '--low-level-retries', '10']);
  const total = rclone(['size', destino], 120000).trim();
  console.log(`[Backup] Imágenes en Drive (espejo, solo lo nuevo): ${total.split(/\r?\n/)[0] || 'ok'}`);
}

function subirJson(jsonPath, nombre) {
  rclone(['copyto', jsonPath, `${driveRaiz()}/backups/${nombre}`]);
  console.log(`[Backup] JSON subido a Drive: ${nombre}`);
}

/**
 * Poda los respaldos viejos de Drive. Solo toca archivos con el prefijo propio
 * dentro de la carpeta de respaldos: si el usuario subió algo ahí a mano, no se
 * toca. El nombre es timestamp, así que ordenar por nombre es ordenar por fecha.
 */
function podarDrive() {
  let lista;
  try {
    lista = rclone(['lsf', `${driveRaiz()}/backups/`, '--files-only'])
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    console.log('[Backup] No se pudo listar Drive para podar');
    return;
  }
  const mios = lista.filter((f) => /^danimarvis-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(f))
    .sort().reverse();
  const sobran = mios.slice(DRIVE_KEEP);
  for (const f of sobran) {
    try { rclone(['deletefile', `${driveRaiz()}/backups/${f}`]); }
    catch (e) { console.error(`[Backup] No se pudo borrar ${f} en Drive: ${e.message}`); }
  }
  if (sobran.length) console.log(`[Backup] Drive: ${sobran.length} respaldo(s) viejo(s) eliminado(s), se conservan ${DRIVE_KEEP}`);
}

function tableNames(db) {
  const r = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  return r.length && r[0].values.length ? r[0].values.map(v => String(v[0])) : [];
}

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

  const stamp = timestamp();
  const name = `danimarvis-${stamp}`;
  const destDir = path.join(BACKUPS_DIR, name);
  fs.mkdirSync(destDir, { recursive: true });

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const data = { version: 2, exported_at: new Date().toISOString() };
  for (const t of tableNames(db)) {
    const r = db.exec(`SELECT * FROM ${t}`);
    data[t] = r.length && r[0].values.length
      ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])))
      : [];
  }
  const jsonPath = path.join(destDir, 'danimarvis.json');
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`[Backup] BD exportada: ${data.products.length} productos, ${data.publications.length} publicaciones`);

  // ── ¿A dónde van las imágenes? ────────────────────────────────────────────
  // Con Drive listo, las imágenes viven en Drive como espejo incremental y acá
  // NO se copian: 1.7 GB de duplicado en el mismo disco no es un respaldo de
  // nada. Sin Drive todavía se copian como siempre, para no quedarse sin red
  // mientras el usuario termina de autorizarlo.
  const drive = driveListo();
  const copiaLocal = UPLOADS_LOCAL === '1' ? true : UPLOADS_LOCAL === '0' ? false : !drive;

  let imagenesEnDrive = false;
  if (drive) {
    try {
      subirImagenes();
      imagenesEnDrive = true;
      subirJson(jsonPath, `${name}.json`);
      podarDrive();
    } catch (e) {
      console.error('[Backup] Falló la subida a Drive:', e.message);
    }
  } else {
    console.log(`[Backup] Drive sin configurar (remoto "${DRIVE_REMOTE}" ausente).`);
  }

  // El fallback importa: si Drive no existe o la subida falló a medias, las
  // imágenes se copian igual. Prefiero 1.7 GB de duplicado a perder fotos.
  if (copiaLocal || !imagenesEnDrive) {
    if (!copiaLocal && drive) {
      console.log('[Backup] Las imágenes NO llegaron a Drive: se copian en local para no perderlas.');
    }
    copiarUploadsLocal(destDir);
  }

  cleanOldBackups();
  console.log(`[Backup] Respaldo completo creado: ${destDir}`);
  return destDir;
}

function copiarUploadsLocal(destDir) {
  if (!fs.existsSync(UPLOADS_DIR)) return;
  fs.cpSync(UPLOADS_DIR, path.join(destDir, 'uploads'), { recursive: true });
  console.log(`[Backup] Imágenes copiadas: ${fs.readdirSync(path.join(destDir, 'uploads')).length}`);
}

/**
 * Respaldo periódico.
 *
 * Antes solo se respaldaba al arrancar el server: si el usuario lo dejaba
 * encendido muchas semanas, no se generaba ninguno. El intervalo es el que
 * marca la cadencia, así que acá va con force=true y la guarda de 24h no lo
 * saltea por un minuto de diferencia.
 */
export function scheduleBackups() {
  const horas = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
  console.log(`[Backup] Respaldo cada ${horas}h (local KEEP=${KEEP}, Drive ${DRIVE_REMOTE}:${DRIVE_DIR} KEEP=${DRIVE_KEEP})`);
  return setInterval(() => {
    createBackup({ force: true }).catch((e) => console.error('[Backup] Error periódico:', e.message));
  }, horas * 3600 * 1000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  createBackup({ force }).catch((e) => {
    console.error('[Backup] Error:', e);
    process.exit(1);
  });
}