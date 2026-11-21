import { getDB } from '../db/database.js';
import { publishToPage, cancelScheduledPost, FacebookError } from './facebook.js';
import { v4 as uuid } from 'uuid';

const DEFAULT_TIMES = ['09:00', '13:30', '18:00'];
const MAX_LOOKAHEAD_DAYS = 1;
const MIN_LEAD_MS = 10 * 60 * 1000;
const GRAPH_API = 'https://graph.facebook.com/v22.0';

let running = false;
let timer = null;
let lastRun = null;
let lastRunSummary = null;
let workerActive = true; // se lee desde publish_config.pageRoutines.enabled

/* ─── Utilidades de tiempo ──────────────────────────────────── */

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function localDateAt(base, addDays) {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setSeconds(0, 0);
  return d;
}

function slotAt(base, addDays, hm) {
  const [h, m] = hm.split(':').map(Number);
  const d = localDateAt(base, addDays);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/* ─── Configuración ─────────────────────────────────────────── */

function publishConfig() {
  const db = getDB();
  const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(settings?.publish_config || '{}'); } catch {}
  return pc.facebook || {};
}

export function getPageConfig() {
  const fb = publishConfig();
  return {
    pageId: fb.page_id || '',
    accessToken: fb.access_token || '',
    tokenExpiresAt: fb.token_expires_at || null,
  };
}

function pageRoutineConfig() {
  const db = getDB();
  const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(settings?.publish_config || '{}'); } catch {}
  const pr = pc.pageRoutines || {};
  return {
    enabled: pr.enabled !== false,
    tickMs: Number(pr.tickMs) || 60 * 1000,
    maxRetries: Number(pr.maxRetries) || 3,
    retryBaseMs: Number(pr.retryBaseMs) || 60 * 1000,
  };
}

export function parseTimes(times) {
  const raw = String(times ?? '').trim();
  if (!raw) return [...DEFAULT_TIMES];
  const list = raw.split(',').map(t => t.trim()).filter(Boolean);
  // Eliminar duplicados manteniendo el orden y validando formato HH:MM con rango válido
  const seen = new Set();
  const unique = list.filter(t => {
    if (!/^\d{2}:\d{2}$/.test(t)) return false;
    const [h, m] = t.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return unique.length ? unique : [...DEFAULT_TIMES];
}

/* ─── Pool de productos ─────────────────────────────────────── */

function productPool(routine) {
  const db = getDB();
  let ids = [];
  try { ids = JSON.parse(routine.products || '[]'); } catch {}
  let products;
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    products = db.prepare(
      `SELECT * FROM products WHERE id IN (${placeholders}) AND status = 'active' ORDER BY name ASC`
    ).all(...ids);
  } else {
    products = db.prepare(
      "SELECT * FROM products WHERE status = 'active' AND catalog_visible = 1 ORDER BY name ASC"
    ).all();
  }
  return products;
}

/* ─── Construcción de mensaje ───────────────────────────────── */

function buildMessage(routine, product, fallbackTemplate) {
  if (routine.default_text && routine.default_text.trim()) {
    return fillTemplate(routine.default_text, product);
  }
  if (product.publish_text && product.publish_text.trim()) {
    return product.publish_text;
  }
  if (fallbackTemplate && fallbackTemplate.trim()) {
    return fillTemplate(fallbackTemplate, product);
  }
  const desc = String(product.description || '').trim();
  const price = '$' + Number(product.price || 0).toLocaleString('es-CO');
  const currency = product.commission_currency || 'USD';
  return [
    product.name,
    desc ? desc : '',
    `Precio: ${price} ${currency}`,
  ].filter(Boolean).join('\n');
}

function fillTemplate(template, product) {
  const price = '$' + Number(product.price || 0).toLocaleString('es-CO');
  const currency = product.commission_currency || 'USD';
  const map = {
    '{NAME}': product.name || '',
    '{PRICE}': price,
    '{CURRENCY}': currency,
    '{DESCRIPTION}': product.description || '',
    '{WARRANTY}': product.warranty || 'No especificada',
  };
  return Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), template);
}

function productImages(product) {
  let images = [];
  try { images = JSON.parse(product.images || '[]'); } catch {}
  if (!Array.isArray(images) || images.length === 0) {
    if (product.image_url) images = [product.image_url];
  }
  return images.filter(Boolean).slice(0, 10);
}

export function isRoutineConfigured() {
  const { pageId, accessToken } = getPageConfig();
  return !!(pageId && accessToken);
}

/* ─── Estado del worker ─────────────────────────────────────── */

export function getPageRoutineWorkerStatus() {
  const cfg = pageRoutineConfig();
  return {
    active: workerActive,
    running,
    timer: !!timer,
    lastRun: lastRun ? new Date(lastRun).toISOString() : null,
    lastRunSummary: lastRunSummary || null,
    tickMs: cfg.tickMs,
    maxRetries: cfg.maxRetries,
    retryBaseMs: cfg.retryBaseMs,
  };
}

export function setPageRoutineWorkerActive(active) {
  const nextActive = Boolean(active);
  const wasActive = workerActive;
  workerActive = nextActive;
  if (nextActive && !timer) startPageRoutineWorker();
  if (!nextActive && timer) stopPageRoutineWorker();
  return { active: workerActive, wasActive };
}

export function startPageRoutineWorker() {
  if (timer) return { started: false, reason: 'Ya iniciado' };
  const cfg = pageRoutineConfig();
  if (!cfg.enabled) return { started: false, reason: 'Worker deshabilitado en la configuración' };
  timer = setInterval(() => {
    runPageRoutineCycle().catch(err =>
      console.error('[PageRoutineWorker] Error en ciclo automático:', err.message)
    );
  }, cfg.tickMs);
  // Ejecutar una vez al iniciar para no esperar al primer tick
  runPageRoutineCycle().catch(err =>
    console.error('[PageRoutineWorker] Error en ciclo inicial:', err.message)
  );
  return { started: true, tickMs: cfg.tickMs };
}

export function stopPageRoutineWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return { stopped: true };
}

/* ─── Sincronización con Meta ───────────────────────────────── */

async function syncSlotWithMeta(db, log, pageId, accessToken) {
  if (!log.meta_post_id) return { synced: false, reason: 'Sin meta_post_id' };
  try {
    const url = `${GRAPH_API}/${encodeURIComponent(log.meta_post_id)}?fields=id,status,scheduled_publish_time,created_time&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      // 400/404: el post ya no existe en Meta (borrado o expirado)
      if (res.status === 400 || res.status === 404) {
        db.prepare(`
          UPDATE page_schedule_log
          SET status = 'cancelled', meta_status = 'not_found', synced_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(log.id);
        return { synced: true, status: 'cancelled', metaStatus: 'not_found', reason: 'Post no encontrado en Meta' };
      }
      return { synced: false, reason: `Error ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = JSON.parse(text);
    const metaStatus = String(data.status || '').toLowerCase();
    let localStatus = log.status;
    if (metaStatus === 'published' || metaStatus === 'live') {
      localStatus = 'published';
    } else if (metaStatus === 'scheduled') {
      localStatus = 'scheduled';
    } else if (metaStatus === 'unpublished' || metaStatus === 'draft' || metaStatus === 'deleted') {
      localStatus = 'cancelled';
    }
    db.prepare(`
      UPDATE page_schedule_log
      SET status = ?, meta_status = ?, synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(localStatus, metaStatus, log.id);
    return { synced: true, status: localStatus, metaStatus };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

export async function syncPageRoutinesWithMeta() {
  const { pageId, accessToken } = getPageConfig();
  if (!pageId || !accessToken) return { synced: 0, errors: 0, reason: 'Página no configurada' };

  const db = getDB();
  const logs = db.prepare(`
    SELECT * FROM page_schedule_log
    WHERE status IN ('scheduled', 'error')
      AND meta_post_id IS NOT NULL AND meta_post_id <> ''
    ORDER BY scheduled_for ASC
    LIMIT 100
  `).all();

  let synced = 0;
  let errors = 0;
  const results = [];

  for (const log of logs) {
    const result = await syncSlotWithMeta(db, log, pageId, accessToken);
    if (result.synced) synced++;
    else errors++;
    results.push({ logId: log.id, ...result });
  }

  return { synced, errors, results };
}

/* ─── Reintentos ────────────────────────────────────────────── */

async function processFailedSlots(db, pageId, accessToken) {
  const cfg = pageRoutineConfig();
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const failed = db.prepare(`
    SELECT * FROM page_schedule_log
    WHERE status = 'error'
      AND retry_count < ?
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY scheduled_for ASC
    LIMIT 20
  `).all(cfg.maxRetries, nowStr);

  let retried = 0;
  let errors = 0;

  for (const log of failed) {
    const routine = db.prepare('SELECT * FROM page_routines WHERE id = ?').get(log.routine_id);
    if (!routine || !routine.active) continue;

    const retryCount = Number(log.retry_count || 0) + 1;
    const backoffMs = cfg.retryBaseMs * Math.pow(2, retryCount - 1);
    const nextRetry = new Date(Date.now() + backoffMs);
    const nextRetryStr = nextRetry.toISOString().slice(0, 19).replace('T', ' ');

    const nowMs = Date.now();
    const leadMin = Math.max(11, Number(routine.lead_minutes) || 20);
    const slotMs = new Date(log.scheduled_for).getTime();

    let newSlotStr = log.scheduled_for;
    // Si el horario original ya pasó (dentro de la antelación mínima), mover a mañana mismo horario
    if (slotMs <= nowMs + leadMin * 60000) {
      const [h, m] = log.scheduled_for.split(' ')[1].split(':').map(Number);
      const tomorrow = new Date(nowMs);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(h, m, 0, 0);
      newSlotStr = toLocalString(tomorrow);
    }

    // Verificar que no exista ya un agendado para ese horario
    const already = db.prepare(
      "SELECT id FROM page_schedule_log WHERE routine_id = ? AND scheduled_for = ? AND status = 'scheduled'"
    ).get(routine.id, newSlotStr);
    if (already) {
      // No se puede reintentar: el slot está ocupado. Marcar como agotado.
      db.prepare(
        "UPDATE page_schedule_log SET status = 'cancelled', retry_count = ?, next_retry_at = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(cfg.maxRetries, log.id);
      continue;
    }

    const pool = productPool(routine);
    if (pool.length === 0) continue;
    const idx = Number(routine.last_product_index || 0);
    const product = pool[idx % pool.length];

    const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    let template = '';
    try { template = JSON.parse(settings?.publish_config || '{}')?.template || ''; } catch {}

    const result = await bookSlot(routine, product, new Date(newSlotStr), newSlotStr, template, pageId, accessToken);

    if (result.ok) {
      retried++;
      db.prepare("UPDATE page_routines SET last_product_index = ?, updated_at = datetime('now') WHERE id = ?")
        .run((idx + 1) % pool.length, routine.id);
      // Marcar el log original como reemplazado
      db.prepare("UPDATE page_schedule_log SET status = 'replaced', updated_at = datetime('now') WHERE id = ?").run(log.id);
    } else {
      errors++;
      db.prepare(
        "UPDATE page_schedule_log SET retry_count = ?, next_retry_at = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(retryCount, nextRetryStr, log.id);
    }
  }

  return { retried, errors };
}

export async function retryPageRoutineLog(logId) {
  const db = getDB();
  const log = db.prepare('SELECT * FROM page_schedule_log WHERE id = ?').get(logId);
  if (!log) return { error: 'Registro no encontrado' };
  if (log.status !== 'error') return { error: 'Solo se pueden reintentar registros con error' };

  const { pageId, accessToken } = getPageConfig();
  if (!pageId || !accessToken) return { error: 'Página de Facebook no configurada' };

  const routine = db.prepare('SELECT * FROM page_routines WHERE id = ?').get(log.routine_id);
  if (!routine) return { error: 'Rutina no encontrada' };
  if (!routine.active) return { error: 'La rutina está pausada' };

  const now = Date.now();
  const leadMin = Math.max(11, Number(routine.lead_minutes) || 20);
  const slotMs = new Date(log.scheduled_for).getTime();

  let newSlotStr = log.scheduled_for;
  if (slotMs <= now + leadMin * 60000) {
    const [h, m] = log.scheduled_for.split(' ')[1].split(':').map(Number);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(h, m, 0, 0);
    newSlotStr = toLocalString(tomorrow);
  }

  const already = db.prepare(
    "SELECT id FROM page_schedule_log WHERE routine_id = ? AND scheduled_for = ? AND status = 'scheduled'"
  ).get(routine.id, newSlotStr);
  if (already) return { error: 'Ya existe un agendado para ese horario' };

  const pool = productPool(routine);
  if (pool.length === 0) return { error: 'No hay productos disponibles en la rutina' };
  const idx = Number(routine.last_product_index || 0);
  const product = pool[idx % pool.length];

  const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let template = '';
  try { template = JSON.parse(settings?.publish_config || '{}')?.template || ''; } catch {}

  const result = await bookSlot(routine, product, new Date(newSlotStr), newSlotStr, template, pageId, accessToken);

  if (result.ok) {
    db.prepare("UPDATE page_routines SET last_product_index = ?, updated_at = datetime('now') WHERE id = ?")
      .run((idx + 1) % pool.length, routine.id);
    db.prepare("UPDATE page_schedule_log SET status = 'replaced', updated_at = datetime('now') WHERE id = ?").run(logId);
    return { ok: true, logId: result.logId, scheduledFor: newSlotStr, product: product.name };
  }
  return { ok: false, error: result.error };
}

/* ─── bookSlot (agenda un post en Meta) ─────────────────────── */

async function bookSlot(routine, product, slot, slotStr, template, pageId, accessToken) {
  const db = getDB();
  const logId = uuid();

  const images = productImages(product);
  const message = buildMessage(routine, product, template);
  const format = routine.format || '4:5';

  try {
    const result = await publishToPage(pageId, accessToken, {
      message,
      images,
      scheduledAt: slot,
    });

    db.prepare(`
      INSERT INTO page_schedule_log (id, routine_id, product_id, product_name, scheduled_for, status, meta_post_id, message, images_count, format, retry_count, next_retry_at, synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'), datetime('now'))
    `).run(logId, routine.id, product.id || null, product.name || '', slotStr, result.id || '', message, images.length, format);

    return { ok: true, logId, scheduledFor: slotStr, product: product.name, metaId: result.id || null };
  } catch (err) {
    const known = err instanceof FacebookError;
    const cfg = pageRoutineConfig();
    const backoffMs = cfg.retryBaseMs;
    const nextRetry = new Date(Date.now() + backoffMs);
    const nextRetryStr = nextRetry.toISOString().slice(0, 19).replace('T', ' ');

    db.prepare(`
      INSERT INTO page_schedule_log (id, routine_id, product_id, product_name, scheduled_for, status, meta_post_id, message, images_count, format, retry_count, next_retry_at, error, synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'error', '', ?, ?, ?, 0, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(logId, routine.id, product.id || null, product.name || '', slotStr, message, images.length, format, nextRetryStr, err.message);

    return {
      ok: false,
      error: err.message,
      logId,
      isTokenExpired: known && err.isTokenExpired,
    };
  }
}

/* ─── Ciclo principal ───────────────────────────────────────── */

export async function runPageRoutineCycle() {
  if (running) return { skipped: true, reason: 'Ciclo anterior en curso' };
  if (!workerActive) return { skipped: true, reason: 'Worker deshabilitado' };

  running = true;
  lastRun = Date.now();
  try {
    const db = getDB();
    const { pageId, accessToken } = getPageConfig();
    if (!pageId || !accessToken) {
      lastRunSummary = { skipped: true, reason: 'Página de Facebook no configurada' };
      return lastRunSummary;
    }

    const routines = db.prepare("SELECT * FROM page_routines WHERE active = 1 ORDER BY name ASC").all();
    if (routines.length === 0) {
      lastRunSummary = { planned: 0, totalPosts: 0, synced: 0, retried: 0, messages: [], errors: 0 };
      return lastRunSummary;
    }

    const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    let template = '';
    try { template = JSON.parse(settings?.publish_config || '{}')?.template || ''; } catch {}

    const now = Date.now();
    const base = new Date(now);
    const summary = { planned: 0, totalPosts: 0, synced: 0, retried: 0, messages: [], errors: 0 };

    // 1) Planificar nuevos slots para cada rutina activa
    for (const routine of routines) {
      const pool = productPool(routine);
      if (pool.length === 0) continue;
      summary.totalPosts += pool.length;

      const times = parseTimes(routine.times);
      const leadMin = Math.max(11, Number(routine.lead_minutes) || 20);

      for (let day = 0; day <= MAX_LOOKAHEAD_DAYS; day++) {
        for (const hm of times) {
          const slot = slotAt(base, day, hm);
          const slotMs = slot.getTime();
          if (slotMs <= now + leadMin * 60000) continue;

          const slotStr = toLocalString(slot);
          const already = db.prepare(
            "SELECT id FROM page_schedule_log WHERE routine_id = ? AND scheduled_for = ? AND status = 'scheduled'"
          ).get(routine.id, slotStr);
          if (already) continue;

          const idx = Number(routine.last_product_index || 0);
          const product = pool[idx % pool.length];

          const result = await bookSlot(routine, product, slot, slotStr, template, pageId, accessToken);
          if (result.ok) {
            summary.planned += 1;
            summary.messages.push(`✓ ${result.scheduledFor} ${result.product} → Meta ${result.metaId}`);
            // Solo avanzar el índice si se agendó exitosamente
            db.prepare("UPDATE page_routines SET last_product_index = ?, updated_at = datetime('now') WHERE id = ?")
              .run((idx + 1) % pool.length, routine.id);
          } else {
            summary.errors += 1;
            summary.messages.push(`✗ ${slotStr} ${product.name}: ${result.error}`);
          }
        }
      }
    }

    // 2) Sincronizar estado con Meta (posts agendados y con error)
    const syncResult = await syncPageRoutinesWithMeta();
    summary.synced = syncResult.synced;
    summary.errors += syncResult.errors;

    // 3) Procesar reintentos automáticos de slots fallidos
    const retryResult = await processFailedSlots(db, pageId, accessToken);
    summary.retried = retryResult.retried;
    summary.errors += retryResult.errors;

    lastRunSummary = summary;
    return summary;
  } catch (err) {
    console.error('[PageRoutineWorker] Error:', err);
    lastRunSummary = { error: err.message };
    return { error: err.message };
  } finally {
    running = false;
  }
}

export { cancelScheduledPost };
