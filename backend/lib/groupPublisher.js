import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { resolveLocalUpload } from './imageUtils.js';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTER_JS = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'group_poster.js');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

export const DEFAULT_AUTO_PUBLISH = {
  enabled: false,
  mode: 'publish',      // 'publish' | 'prepare'
  daily_cap: 6,         // máx. publicaciones reales por día (conteo local)
  hours_from: 8,        // franja horaria local de actividad
  hours_to: 21,
  min_gap_min: 45,      // separación mínima entre publicaciones consecutivas
  cooldown_min: 240,    // espera mínima entre 2 posts del MISMO grupo
  worker_batch: 3,      // cuántos dispara el worker por tick
};

let running = false;
let lastResult = null;

// ------------------------------------------------------------- utilidades ---
const pad = (n) => String(n).padStart(2, '0');
const localNow = () => new Date();

function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
  // La cola guarda published_at/created_at en ISO (UTC). Este formato es
  // comparable por string con lo que genera new Date().toISOString().
}

function toIsoUtc(d) {
  return d.toISOString();
}

function localDayBoundaries() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start: toIsoUtc(start), end: toIsoUtc(end) };
}

function getAutopublishConfig() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row?.publish_config || '{}'); } catch {}
  const cfg = { ...DEFAULT_AUTO_PUBLISH, ...(pc.autopublish || {}) };
  cfg.mode = cfg.mode === 'prepare' ? 'prepare' : 'publish';
  cfg.daily_cap = Math.max(1, Number(cfg.daily_cap) || DEFAULT_AUTO_PUBLISH.daily_cap);
  cfg.worker_batch = Math.max(1, Math.min(20, Number(cfg.worker_batch) || DEFAULT_AUTO_PUBLISH.worker_batch));
  cfg.min_gap_min = Math.max(5, Number(cfg.min_gap_min) || DEFAULT_AUTO_PUBLISH.min_gap_min);
  cfg.cooldown_min = Math.max(30, Number(cfg.cooldown_min) || DEFAULT_AUTO_PUBLISH.cooldown_min);
  return cfg;
}

function lastPublishedInfo() {
  const db = getDB();
  const row = db.prepare(
    "SELECT published_at FROM publication_queue WHERE status = 'published' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
  ).get();
  return row?.published_at || null;
}

function countPublishedToday() {
  const db = getDB();
  const { start, end } = localDayBoundaries();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM publication_queue WHERE status = 'published' AND published_at >= ? AND published_at < ?"
  ).get(start, end);
  return Number(row?.c) || 0;
}

function lastPublishedForGroup(groupName) {
  const db = getDB();
  const row = db.prepare(
    "SELECT published_at FROM publication_queue WHERE status = 'published' AND LOWER(group_name) = LOWER(?) AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
  ).get(groupName);
  return row?.published_at || null;
}

function withinHoursWindow(cfg) {
  const h = localNow().getHours();
  return h >= (Number(cfg.hours_from) || 0) && h < (Number(cfg.hours_to) || 24);
}

function isChromeReachable() {
  return fetch('http://localhost:9222/json/version', { signal: AbortSignal.timeout(2500) })
    .then(r => r.ok)
    .catch(() => false);
}

// ------------------------------------------------------- resolución inputs ---
function resolveGroupUrl(item) {
  if (item.group_url && /^https?:\/\//i.test(item.group_url)) return item.group_url;
  const db = getDB();
  const name = String(item.group_name || '').trim();
  if (!name) return null;
  const row = db.prepare('SELECT url FROM facebook_groups WHERE LOWER(name) = LOWER(?) LIMIT 1').get(name)
    || db.prepare('SELECT url FROM facebook_groups WHERE name LIKE ? LIMIT 1').get(`%${name}%`);
  return row?.url || null;
}

async function downloadToUploads(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = path.extname(new URL(url).pathname).replace(/[^\w.]/g, '') || '.jpg';
    const rel = `pgp_dl_${uuid().slice(0, 8)}${ext}`;
    const file = path.join(UPLOADS_DIR, rel);
    fs.writeFileSync(file, buf);
    return file;
  } catch {
    return null;
  }
}

async function resolveImages(imagesArr) {
  const out = [];
  // dueCandidates() entrega "images" como el texto JSON tal cual del DB;
  // normalizamos a array real antes de recorrer (string => JSON.parse o split).
  let list = imagesArr;
  if (typeof list === 'string') {
    const s = String(list || '').trim();
    try { list = JSON.parse(s); } catch { list = s.split(','); }
  }
  if (!Array.isArray(list)) list = [];
  for (const img of list) {
    if (!img) continue;
    if (/^https?:\/\//i.test(img)) {
      const local = await downloadToUploads(img);
      if (local && fs.existsSync(local)) out.push(await toFacebookFriendly(local));
    } else {
      const local = resolveLocalUpload(img);
      if (local) out.push(await toFacebookFriendly(local));
    }
    if (out.length >= 10) break;
  }
  return out;
}

// Facebook NO acepta .webp en las publicaciones: el input del compositor
// rechaza el archivo y el post se publica sin foto. Se convierte a JPG antes de
// subirlo. El archivo temporal se limpia al terminar (deleteTempFiles).
const FB_UNSUPPORTED = new Set(['.webp']);
async function toFacebookFriendly(file) {
  const ext = path.extname(file).toLowerCase();
  if (!FB_UNSUPPORTED.has(ext)) return file;
  try {
    const { default: sharp } = await import('sharp');
    const out = path.join(UPLOADS_DIR, `pgp_conv_${uuid().slice(0, 8)}.jpg`);
    await sharp(file).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(out);
    return out;
  } catch (e) {
    console.error('[publish] no se pudo convertir', path.basename(file), 'a jpg:', e.message);
    return file;
  }
}

function fillTemplateText(text, pub) {
  const price = '$' + Number(pub?.product_price || 0).toLocaleString('es-CO');
  const map = {
    '{FECHA}': isoLocal(localNow()).slice(0, 10),
    '{NOMBRE}': pub?.product_name || '',
    '{PRECIO}': price,
    '{PUBLISH_TEXT}': pub?.publish_text || '',
  };
  return Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), text || '');
}

// --------------------------------------------------------- selección due ---
function dueCandidates() {
  const db = getDB();
  const now = toIsoUtc(new Date());
  return db.prepare(`
    SELECT pq.id, pq.publication_id, pq.group_name, pq.group_url, pq.variant_text,
           pq.scheduled_at, p.publish_text, COALESCE(pq.images, p.images) AS images,
           p.publication_date
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    WHERE pq.status = 'pending' AND (pq.scheduled_at IS NULL OR pq.scheduled_at <= ?)
    ORDER BY COALESCE(pq.scheduled_at, pq.created_at) ASC
  `).all(now);
}

function pickForRun(cfg, { auto, force }) {
  const now = Date.now();
  const candidates = dueCandidates().filter(c => resolveGroupUrl(c));
  const rows = [];
  const todayCount = countPublishedToday();
  const lastOverall = lastPublishedInfo();

  for (const c of candidates) {
    if (rows.length >= (auto ? cfg.worker_batch : 30)) break;

    const groupUrl = resolveGroupUrl(c);
    // cooldown por grupo
    const lastGroup = lastPublishedForGroup(c.group_name);
    if (!force && lastGroup && Date.now() - new Date(lastGroup).getTime() < cfg.cooldown_min * 60000) continue;
    // franja horaria (solo worker)
    if (auto && !force && !withinHoursWindow(cfg)) continue;
    // cap diario (solo auto)
    if (auto && !force && todayCount + rows.length >= cfg.daily_cap) continue;
    // gap mínimo entre consecutivos (auto)
    if (auto && !force && lastOverall) {
      const gapMs = now - new Date(lastOverall).getTime();
      if (gapMs < cfg.min_gap_min * 60000) continue;
    }

    rows.push(c);
    if (!force) todayCount += 0;
  }
  return rows;
}

// -------------------------------------------------------- ejecución/run ---
function writeMessageFile(item) {
  const content = fillTemplateText(item.variant_text || item.publish_text, item);
  const file = path.join(UPLOADS_DIR, `pgp_msg_${uuid().slice(0, 8)}.txt`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function spawnPoster({ groupUrl, messageFile, imageFiles, mode, label, debug = false }) {
  return new Promise((resolve) => {
    const args = [
      '--no-sandbox',
      '--groups=' + groupUrl,
      '--message-file=' + messageFile,
      '--mode=' + mode,
      '--label=' + label,
      '--max-seconds=300',
    ];
    if (debug) args.push('--debug=1');
    if (imageFiles.length) args.push('--images=' + imageFiles.join(';'));
    execFile(process.execPath, [POSTER_JS, ...args], { timeout: 280000 }, (err, stdout, stderr) => {
      const allText = `${stdout || ''}\n${stderr || ''}`;
      const line = String(stdout || '').split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .find(x => x && typeof x === 'object' && 'ok' in x);
      if (line) {
        const imgA = typeof line.imagen_adjunta === 'number' ? line.imagen_adjunta : null;
        if (imgA !== null) line.img_adjunta = imgA;
        const imgP = typeof line.imagenes_pedidas === 'number' ? line.imagenes_pedidas : null;
        if (imgP !== null) line.img_pedidas = imgP;
        return resolve(line);
      }
      resolve({ ok: false, status: 'error', message: (err?.message || allText || 'Sin salida del poster').slice(0, 300) });
    });
  });
}

function updateQueue(item, result, mode) {
  const db = getDB();
  const now = toIsoUtc(new Date());
  const base = (item.notes || '').trim();
  let notes;
  if (result.ok) {
    const tag = mode === 'prepare' ? 'preparado' : 'publicado';
    notes = [base, `auto:${tag} ${now.slice(0, 19)}`.trim()].filter(Boolean).join(' | ');
  } else {
    notes = [base, `auto:error ${result.message || ''}`.trim()].filter(Boolean).join(' | ').slice(0, 500);
  }
  if (result.ok && mode === 'publish') {
    db.prepare("UPDATE publication_queue SET status = 'published', notes = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, now, item.id);
  } else if (result.ok && mode === 'prepare') {
    db.prepare("UPDATE publication_queue SET status = 'prepared', notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, item.id);
  } else {
    db.prepare("UPDATE publication_queue SET notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, item.id);
  }
}

async function deleteTempFiles(files) {
  for (const f of files) {
    try {
      if (fs.existsSync(f) && /pgp_(msg|dl|conv)_/.test(path.basename(f))) fs.unlinkSync(f);
    } catch (_) {}
  }
}

export async function runGroupPublish({ auto = false, force = false, ids = [], mode = null, debug = false } = {}) {
  if (running) return { skipped: true, reason: 'Ya hay una corrida de publicador en curso', lastResult };
  running = true;
  const cfg = getAutopublishConfig();
  if (auto && !cfg.enabled) {
    running = false;
    return { skipped: true, reason: 'auto-publicado deshabilitado' };
  }
  const effectiveMode = mode || cfg.mode;

  try {
    const chrome = await isChromeReachable();
    if (!chrome) {
      const r = { ok: false, error: 'Chrome no está accesible en el puerto 9222. Abrí Chrome con --remote-debugging-port=9222 logueado en Facebook.', started: toIsoUtc(new Date()).slice(0, 19) };
      lastResult = r;
      return r;
    }

    const items = (ids && ids.length)
      ? dueCandidates().filter(c => ids.includes(c.id))
      : pickForRun(cfg, { auto, force });

    if (items.length === 0) {
      const r = { ok: true, processed: 0, message: 'No hay publicaciones vencidas para publicar ahora.', reason: !auto ? 'na' : (withinHoursWindow(cfg) ? 'fuera de franja o sin vencidas' : 'fuera de franja horaria'), started: toIsoUtc(new Date()).slice(0, 19) };
      lastResult = r;
      return r;
    }

    const results = [];
    const temps = [];
    for (const item of items) {
      const groupUrl = resolveGroupUrl(item);
      const imageFiles = await resolveImages(item.images);
      const messageFile = writeMessageFile(item);
      temps.push(messageFile, ...imageFiles);

      const result = await spawnPoster({
        groupUrl,
        messageFile,
        imageFiles,
        mode: effectiveMode,
        label: item.group_name,
        debug,
      });
      updateQueue(item, result, effectiveMode);
      results.push({
        item_id: item.id,
        group: item.group_name,
        url: groupUrl,
        mode: effectiveMode,
        ok: result.ok,
        status: result.status,
        message: ((result.message || '') + (result.img_adjunta !== undefined ? ` | img_adjunta:${result.img_adjunta}` : '') + (result.img_pedidas !== undefined ? ` de ${result.img_pedidas}` : '')).slice(0, 220),
        post_url: result.post_url || '',
      });
      // separación natural entre posts consecutivos (simula flujo humano)
      if (results.length < items.length) {
        await new Promise(r => setTimeout(r, (45000 + Math.random() * 90000)));
      }
    }

    deleteTempFiles(temps);
    const r = {
      ok: true,
      mode: effectiveMode,
      grabbed: items.length,
      published: results.filter(x => x.ok && x.status === 'published').length,
      prepared: results.filter(x => x.ok && x.status === 'prepared').length,
      errors: results.filter(x => !x.ok).length,
      results,
      started: toIsoUtc(new Date()).slice(0, 19),
    };
    lastResult = r;
    return r;
  } catch (err) {
    const r = { ok: false, error: err.message.slice(0, 300), started: toIsoUtc(new Date()).slice(0, 19) };
    lastResult = r;
    return r;
  } finally {
    running = false;
  }
}

export function groupPublishStatus() {
  const cfg = getAutopublishConfig();
  return {
    running,
    chrome: lastResult?.ok === false && /9222/.test(lastResult.error || '') ? false : null,
    config: cfg,
    lastResult,
  };
}

export { getAutopublishConfig }; // reúso desde server.js / worker