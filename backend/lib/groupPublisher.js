import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { resolveLocalUpload } from './imageUtils.js';
import { ensureDebugChrome, debugChromeReachable } from './chromeLauncher.js';
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
  tick_min: 5,          // cada cuánto mira la cola el worker
};

let running = false;
let lastResult = null;
// Progreso en vivo de la corrida en curso. Las rutas ya no esperan al run (el
// poster tiene --max-seconds=300 y entre posts hay 45-135s de separación), así
// que el frontend hace polling a /group-publish/status y lee esto. Sin esto no
// hay nada que mostrar hasta el final, que es justo lo que había que evitar.
let currentRun = null;

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
  // El intervalo del tick antes era una constante (5 min) y la UI prometía
  // "cada 5 minutos" sin forma de cambiarlo. Ahora sale de la config.
  cfg.tick_min = Math.max(1, Math.min(120, Number(cfg.tick_min) || DEFAULT_AUTO_PUBLISH.tick_min));
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
  const map = {
    '{FECHA}': isoLocal(localNow()).slice(0, 10),
    '{NOMBRE}': pub?.product_name || '',
    '{PRECIO}': pub?.product_price ? `$${Number(pub.product_price).toLocaleString('es-CO')}` : '',
    '{PUBLISH_TEXT}': pub?.publish_text || '',
  };
  // Solo se reemplaza lo que tiene dato detrás. Sin publicación asociada
  // (redacción propia) {NOMBRE}/{PRECIO}/{PUBLISH_TEXT} no tienen fuente, y
  // antes se convertían en '' y '$0': un post salía publicado con el precio
  // en $0 sin ningún error. Ahora quedan literales, que es visible.
  return Object.entries(map)
    .filter(([, v]) => v !== '')
    .reduce((acc, [k, v]) => acc.split(k).join(v), text || '');
}

// --------------------------------------------------------- selección due ---
function dueCandidates() {
  const db = getDB();
  const now = toIsoUtc(new Date());
  return db.prepare(`
    SELECT pq.id, pq.publication_id, pq.group_name, pq.group_url, pq.variant_text,
           pq.scheduled_at, p.publish_text, COALESCE(pq.images, p.images) AS images,
           p.publication_date,
           -- fillTemplateText() lee product_name/price del objeto que le llega.
           -- Sin esto, {NOMBRE} salía vacío y {PRECIO} en $0 para todos los
           -- ítems, tuvieran o no publicación asociada. Ojo: publications NO
           -- tiene columna de precio — el precio vive en products y se une por
           -- product_id, igual que routes/publications.js. Se aliasea a
           -- product_price porque así lo espera fillTemplateText().
           p.product_name, pd.price AS product_price
    FROM publication_queue pq
    LEFT JOIN publications p ON p.id = pq.publication_id
    LEFT JOIN products pd ON pd.id = p.product_id
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

// Estados que el poster emite como resultado FINAL de un grupo. Cualquier otra
// línea de stdout (banner, logs, avisos 'warn') es intermedia y NO debe tocar la
// cola. Antes el parseo acceptaba cualquier objeto con clave `ok`, y el poster
// emite un `ok:true, status:'warn'` ANTES del resultado final cuando pierde
// saltos de línea: eso hacía que un ítem quedara marcado 'published' en la BD
// sin haberse publicado nunca, mientras el resumen de la corrida contaba 0.
const TERMINAL_STATUSES = new Set(['published', 'prepared', 'dry-run', 'error']);

/**
 * Convierte la salida del poster en un único resultado. Función pura (no toca
 * ni Chrome ni la BD) para poder testear el contrato con fixtures.
 */
export function parsePosterOutput(stdout, { err = null, allText = '' } = {}) {
  const objs = String(stdout || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x && typeof x === 'object' && !Array.isArray(x));

  // Los avisos se acumulan aparte: son diagnósticos valiosos ("faltaron saltos
  // de línea al escribir") pero no son el resultado del post. Antes se perdían
  // porque el parseo cortaba en el primero.
  const warnings = objs
    .filter(x => x.status === 'warn' || x.event === 'warn')
    .map(x => x.message || 'aviso sin detalle');

  // .find y no el último a propósito: el guard de timeout del poster no se
  // cancela cuando el worker gana la carrera, así que tras un publish OK puede
  // llegar una línea de error después. El primer terminal es el bueno.
  const line = objs.find(x => TERMINAL_STATUSES.has(x.status));

  if (line) {
    const imgA = typeof line.imagen_adjunta === 'number' ? line.imagen_adjunta : null;
    if (imgA !== null) line.img_adjunta = imgA;
    const imgP = typeof line.imagenes_pedidas === 'number' ? line.imagenes_pedidas : null;
    if (imgP !== null) line.img_pedidas = imgP;
    // `adjuntos_confirmados` es el campo de confianza del poster. Va aparte de
    // img_adjunta porque aquel numero no se puede sostener contra el DOM actual
    // de FB (da 0 con los adjuntos presentes). Este si: se apoya en que
    // aparezcan los controles de "quitar foto".
    if (typeof line.adjuntos_confirmados === 'number') line.img_confirmados = line.adjuntos_confirmados;
    if (warnings.length) line.warnings = warnings;
    return line;
  }
  return {
    ok: false,
    status: 'error',
    message: (err?.message || allText || 'Sin salida del poster').slice(0, 300),
    ...(warnings.length ? { warnings } : {}),
  };
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
      resolve(parsePosterOutput(stdout, { err, allText: `${stdout || ''}\n${stderr || ''}` }));
    });
  });
}

function updateQueue(item, result, mode) {
  const db = getDB();
  const now = toIsoUtc(new Date());
  const base = (item.notes || '').trim();
  // grupo con moderation: el post sale pero espera al administrador
  const pending = result.requiere_aprobacion ? 1 : 0;
  // Avisos no terminales del poster (p.ej. saltos de línea perdidos). Antes el
  // parseo los descartaba; ahora quedan registrados aunque el post salga bien.
  const avisos = Array.isArray(result.warnings) && result.warnings.length
    ? ` | aviso: ${result.warnings.join('; ')}` : '';
  // El poster publica aunque falten imágenes (para que un problema de adjuntos
  // nunca impida que el post salga), pero informa si FB las tomó. El conteo exacto
  // no es confiable contra el DOM actual de FB, así que la nota dice "confirmado"
  // o "no confirmado" en vez de inventar un "3 de 6": un número falso en la cola
  // es peor que una advertencia honesta, porque nadie lo va a cuestionar.
  const pedidas = Number(result.imagenes_pedidas) || 0;
  const confirmadas = Number(result.adjuntos_confirmados) || 0;
  const imgNota = pedidas > 0
    ? (confirmadas
        ? ` | imágenes: FB confirmó los adjuntos (${pedidas} pedidas; conteo exacto no verificado)`
        : ` | ATENCIÓN imágenes: se pidieron ${pedidas} y FB no mostró los controles de quitar foto; probablemente no las tomó`)
    : '';
  let notes;
  if (result.ok) {
    const tag = mode === 'prepare' ? 'preparado' : 'publicado';
    notes = [base, `auto:${tag} ${now.slice(0, 19)}`.trim()].filter(Boolean).join(' | ');
    if (pending) notes += ' | pendiente de aprobación del administrador';
    notes += imgNota;
  } else {
    notes = [base, `auto:error ${result.message || ''}`.trim()].filter(Boolean).join(' | ').slice(0, 500);
  }
  notes = (notes + avisos).slice(0, 500);
  if (result.ok && mode === 'publish') {
    db.prepare("UPDATE publication_queue SET status = 'published', notes = ?, published_at = ?, pending_approval = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, now, pending, item.id);
  } else if (result.ok && mode === 'prepare') {
    db.prepare("UPDATE publication_queue SET status = 'prepared', notes = ?, pending_approval = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, pending, item.id);
  } else {
    // OJO: antes esta rama solo escribía las notas y dejaba el status en
    // 'pending'. Como dueCandidates() filtra por 'pending', el worker volvía a
    // agarrar el ítem en cada tick, fallaba igual y repetía para siempre, sin
    // contador de intentos ni backoff. Por eso un fallo de red se veía en la UI
    // como "quedó esperando" indefinidamente. Ahora el ítem queda en 'error' y
    // la UI lo muestra en su propio balde, con reintento manual.
    db.prepare("UPDATE publication_queue SET status = 'error', notes = ?, published_at = NULL, updated_at = datetime('now') WHERE id = ?")
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

/**
 * Clasifica por qué falló un post, para que la UI no muestre un "error" pelado.
 * Mismo criterio que usa dailyRanking.js para separar sesión de navegador:
 *  - 'noBrowser': no hay Chrome escuchando en 9222
 *  - 'sesion':    el perfil de Facebook venció y hay muro de login
 */
function classifyFailure(message) {
  const m = String(message || '');
  if (/no se pudo conectar a chrome|puerto 9222|localhost:9222|failed to fetch browser websocket|econnrefused|could not connect to chrome/i.test(m)) return 'noBrowser';
  if (/sesi[oó]n de facebook requerida|sesi[oó]n (expirada|venci[oó]da)|\/login|checkpoint|cookie_consent/i.test(m)) return 'sesion';
  return null;
}

/**
 * Trabajo real de la corrida. NO await-ear desde una ruta: usar
 * startGroupPublish(), que devuelve de inmediato. Va dejando el avance en
 * currentRun para que groupPublishStatus() lo sirva por polling.
 */
async function runGroupPublish({ runId = null, auto = false, force = false, ids = [], mode = null, debug = false } = {}) {
  const cfg = getAutopublishConfig();
  const effectiveMode = mode || cfg.mode;
  const startedAt = toIsoUtc(new Date()).slice(0, 19);
  currentRun = {
    runId, started: startedAt, startedMs: Date.now(), finished: null,
    phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: effectiveMode, results: [],
    sesion: false, noBrowser: false, error: null,
  };

  try {
    // Garantiza Chrome con debugging remoto (puerto 9222) y el perfil con la
    // sesión de Facebook ANTES de publicar. Antes esto solo sondeaba el puerto
    // y abortaba: había que abrirlo a mano. Si el puerto ya responde no se toca
    // nada (no interfiere con el Chrome del usuario ni con el scraper).
    currentRun.phase = 'starting_chrome';
    const chrome = await ensureDebugChrome({ launch: true });
    if (!chrome.ok) {
      const r = { ok: false, error: `Chrome no disponible (${chrome.error || chrome.status}). Se necesita Chrome con --remote-debugging-port=9222 y la sesión de Facebook abierta en ese perfil.`, noBrowser: true, started: startedAt };
      lastResult = r;
      currentRun.phase = 'error';
      currentRun.noBrowser = true;
      currentRun.error = r.error;
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      return r;
    }

    currentRun.phase = 'picking';
    const items = (ids && ids.length)
      ? dueCandidates().filter(c => ids.includes(c.id))
      : pickForRun(cfg, { auto, force });

    if (items.length === 0) {
      const r = { ok: true, processed: 0, message: 'No hay publicaciones vencidas para publicar ahora.', reason: !auto ? 'na' : (withinHoursWindow(cfg) ? 'fuera de franja o sin vencidas' : 'fuera de franja horaria'), started: startedAt };
      lastResult = r;
      currentRun.phase = 'empty';
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      return r;
    }

    currentRun.total = items.length;
    currentRun.phase = 'publishing';
    const results = [];
    const temps = [];
    for (const item of items) {
      currentRun.current_group = item.group_name;
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
      const avisos = Array.isArray(result.warnings) && result.warnings.length
        ? result.warnings.join('; ') : '';
      const row = {
        item_id: item.id,
        group: item.group_name,
        url: groupUrl,
        mode: effectiveMode,
        ok: result.ok,
        status: result.status,
        message: ((result.message || '') + (avisos ? ` | aviso: ${avisos}` : '') + (result.img_adjunta !== undefined ? ` | img_adjunta:${result.img_adjunta}` : '') + (result.img_pedidas !== undefined ? ` de ${result.img_pedidas}` : '')).slice(0, 220),
        post_url: result.post_url || '',
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
      // El aviso de sesión/Chrome puede aparecer en cualquier ítem: se marca
      // para que la UI lo diga aunque el run siga y termine con otros errores.
      if (!result.ok) {
        const cause = classifyFailure(result.message);
        if (cause) currentRun[cause] = true;
      }
      results.push(row);
      currentRun.results.push(row);
      currentRun.done += 1;
      if (result.ok) currentRun.ok += 1; else currentRun.errors += 1;
      currentRun.current_group = null;
      // separación natural entre posts consecutivos (simula flujo humano)
      if (results.length < items.length) {
        currentRun.phase = 'waiting';
        await new Promise(r => setTimeout(r, (45000 + Math.random() * 90000)));
        currentRun.phase = 'publishing';
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
      sesion: currentRun.sesion,
      noBrowser: currentRun.noBrowser,
      results,
      started: startedAt,
    };
    lastResult = r;
    currentRun.phase = 'done';
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    return r;
  } catch (err) {
    const r = { ok: false, error: err.message.slice(0, 300), started: startedAt };
    lastResult = r;
    currentRun.phase = 'error';
    currentRun.error = r.error;
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    return r;
  } finally {
    running = false;
  }
}

/**
 * Dispara una corrida y devuelve DE INMEDIATO con el runId (la ruta responde
 * 202). El resultado se consulta por polling en GET /group-publish/status.
 *
 * Antes la ruta awaiteaba el run entero: con --max-seconds=300 del poster y 45-135s
 * entre posts eso son minutos, y api.js no tiene timeout, así que el botón
 * quedaba en "Corriendo..." sin que nadie supiera si colgó o estaba trabajando.
 */
export function startGroupPublish({ auto, force = false, ids = [], mode = null, debug = false } = {}) {
  if (running) {
    return { accepted: false, skipped: true, reason: 'Ya hay una corrida de publicador en curso', current: currentRun, lastResult };
  }
  const cfg = getAutopublishConfig();
  const isAuto = auto ?? !(ids && ids.length);
  if (isAuto && !cfg.enabled) {
    return { accepted: false, skipped: true, reason: 'auto-publicado deshabilitado' };
  }

  running = true;
  const runId = uuid();
  const started = toIsoUtc(new Date()).slice(0, 19);
  // se siembra acá para que el primer poll ya vea la corrida, aunque el Chrome
  // todavía esté arrancando
  currentRun = {
    runId, started, startedMs: Date.now(), finished: null, phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: mode || cfg.mode, results: [], sesion: false, noBrowser: false, error: null,
  };

  // fire-and-forget: los errores ya quedan en lastResult/currentRun
  runGroupPublish({ auto: isAuto, force, ids, mode, debug, runId }).catch((err) => {
    console.error('[publish] corrida falló:', err);
    lastResult = { ok: false, error: err.message.slice(0, 300), started };
    if (currentRun && currentRun.runId === runId) {
      currentRun.phase = 'error';
      currentRun.error = err.message.slice(0, 300);
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    }
    running = false;
  });

  return { accepted: true, runId, started, total: ids.length || cfg.worker_batch };
}

// ----------------------------------------------------------- worker auto ---
// El worker que faltaba. La etiqueta de Ajustes promete "cada 5 minutos" pero
// no había nada que disparara la corrida sola: startGroupPublish() solo se
// llamaba desde las rutas, o sea que publicar era 100% manual.
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

/** Intervalo efectivo del tick, leído de la config (cae al default si no se puede leer). */
function schedulerIntervalMs() {
  try {
    return getAutopublishConfig().tick_min * 60 * 1000;
  } catch {
    return SCHEDULER_INTERVAL_MS;
  }
}

let schedulerTimer = null;
let lastTickAt = null;
let nextTickAt = null;
let lastTickResult = null;

// Exportado para poder ejercitarlo en tests: con enabled=false el tick corta
// antes de pickForRun y antes de tocar Chrome, así que es seguro invocarlo.
export function runSchedulerTick() {
  lastTickAt = toIsoUtc(new Date());
  nextTickAt = toIsoUtc(new Date(Date.now() + schedulerIntervalMs()));

  const skip = (reason) => {
    lastTickResult = { skipped: true, reason, at: lastTickAt };
    return lastTickResult;
  };

  if (running) return skip('ya hay una corrida en curso');

  let cfg;
  try {
    cfg = getAutopublishConfig();
  } catch (err) {
    // getDB() puede fallar si la BD aún no cargó; no se debe matar el interval.
    return skip(`config ilegible: ${err.message.slice(0, 120)}`);
  }
  if (!cfg.enabled) return skip('auto-publicado deshabilitado');

  // Clave: NO arrancar la corrida "a ciegas". runGroupPublish() llama a
  // ensureDebugChrome({launch:true}) al principio, así que sin este chequeo el
  // worker abriría Chrome cada 5 minutos aunque no haya nada que publicar.
  // pickForRun con auto=true ya aplica franja, cap diario, gap y cooldown.
  let hayTrabajo = 0;
  try {
    hayTrabajo = pickForRun(cfg, { auto: true, force: false }).length;
  } catch (err) {
    return skip(`no se pudo evaluar la cola: ${err.message.slice(0, 120)}`);
  }
  if (hayTrabajo === 0) return skip('no hay publicaciones vencidas');

  const res = startGroupPublish({ auto: true });
  lastTickResult = res.accepted
    ? { started: true, runId: res.runId, queued: hayTrabajo, at: lastTickAt }
    : { skipped: true, reason: res.reason, at: lastTickAt };
  if (res.accepted) {
    console.log(`[publish] worker: corrida ${res.runId.slice(0, 8)} con ${hayTrabajo} pendiente(s)`);
  } else {
    console.log(`[publish] worker: se saltea el tick — ${res.reason}`);
  }
  return lastTickResult;
}

export async function groupPublishStatus() {
  const cfg = getAutopublishConfig();
  return {
    running,
    // antes esto era null salvo que el ÚLTIMO run hubiera fallado por 9222, así
    // que la UI no podía anticipar "no hay navegador". Ahora es un sondeo real.
    chrome: await debugChromeReachable(),
    config: cfg,
    // elapsed_s se calcula acá y no en el browser: `started` viene recortado a
    // 19 chars sin la Z, así que el JS del front lo parsearía como hora local
    // (4h desfasado en Venezuela).
    current: currentRun
      ? { ...currentRun, elapsed_s: currentRun.startedMs ? Math.round((Date.now() - currentRun.startedMs) / 1000) : null }
      : null,
    lastResult,
    scheduler: schedulerState(),
  };
}

/**
 * Estado del worker automático, para que la UI pueda mostrar la próxima corrida
 * en vez de un "cada 5 minutos" que no existía.
 *
 * Exportada además para `server.js`, que la consulta antes de guardar la config
 * para saber si el worker estaba activo (y no encenderlo de paso).
 */
export function schedulerState() {
  return {
    active: Boolean(schedulerTimer),
    interval_ms: schedulerIntervalMs(),
    last_tick: lastTickAt,
    next_tick: nextTickAt,
    last_tick_result: lastTickResult,
  };
}

export function startGroupPublishScheduler() {
  if (schedulerTimer) {
    console.log('[publish] worker automático ya estaba activo');
    return schedulerState();
  }
  const every = schedulerIntervalMs();
  schedulerTimer = setInterval(runSchedulerTick, every);
  // unref: el timer no debe impedir que el proceso baje limpio. El http server
  // lo mantiene vivo igual.
  schedulerTimer.unref?.();
  nextTickAt = toIsoUtc(new Date(Date.now() + every));
  // enabled solo se lee para el log. Se aísla porque si la BD no está lista el
  // arranque del timer no debería caer: el worker decides igual en cada tick.
  let enabled = '?';
  try { enabled = getAutopublishConfig().enabled; } catch { /* sin BD */ }
  console.log(`[publish] worker automático cada ${Math.round(every / 60000)} min (enabled=${enabled}). Primera corrida en ${Math.round(every / 60000)} min.`);
  return schedulerState();
}

export function stopGroupPublishScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  nextTickAt = null;
  return schedulerState();
}

/**
 * Re-arma el timer cuando cambia el intervalo o el interruptor.
 *
 * El `setInterval` se creaba una sola vez al arrancar el server con una
 * constante, así que cambiar el temporizador desde Ajustes no se notaba hasta
 * reiniciar. Ahora se rearma solo, y solo si el intervalo cambió de verdad:
 * guardar cualquier otro ajuste no reinicia la cuenta del próximo tick.
 *
 * `wasActive` viene del estado anterior, así que un worker apagado no se
 * enciende solo por guardar la config.
 */
export function rescheduleGroupPublish({ wasActive = true } = {}) {
  const before = schedulerTimer ? schedulerState().interval_ms : null;
  const after = schedulerIntervalMs();

  if (!wasActive || before === null) {
    // el worker estaba apagado: no lo levantamos por guardar la config
    if (schedulerTimer) stopGroupPublishScheduler();
    return { rescheduled: false, reason: wasActive ? 'no_active' : 'was_off', state: schedulerState() };
  }
  if (before === after) {
    return { rescheduled: false, reason: 'same_interval', state: schedulerState() };
  }
  stopGroupPublishScheduler();
  const state = startGroupPublishScheduler();
  // La config se lee acá y no antes, solo para el log: pedirla antes obliga a que
  // la BD esté inicializada y hace que esta función no se pueda probar sola.
  let enabled = '?';
  try { enabled = getAutopublishConfig().enabled; } catch { /* sin BD */ }
  console.log(`[publish] temporizador del worker cambiado a ${Math.round(after / 60000)} min (enabled=${enabled})`);
  return { rescheduled: true, from_ms: before, to_ms: after, state };
}

export { getAutopublishConfig }; // reúso desde server.js / worker
// alias explicito: server.js lo usa para leer si el worker estaba activo antes de
// guardar la config, y asi un guardado no enciende un worker apagado.
export { schedulerState as groupPublishSchedulerState };