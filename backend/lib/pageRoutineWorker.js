import { getDB } from '../db/database.js';
import { publishToPage, FacebookError } from './facebook.js';
import { v4 as uuid } from 'uuid';

const DEFAULT_TIMES = ['09:00', '13:30', '18:00'];
const MAX_LOOKAHEAD_DAYS = 1;
const MIN_LEAD_MS = 10 * 60 * 1000;

let running = false;

export function parseTimes(times) {
  const raw = String(times ?? '').trim();
  if (!raw) return [...DEFAULT_TIMES];
  const list = raw.split(',').map(t => t.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_TIMES];
}

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

function publishConfig() {
  const db = getDB();
  const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(settings?.publish_config || '{}'); } catch {}
  return pc.facebook || {};
}

export function getPageConfig() {
  const fb = publishConfig();
  return { pageId: fb.page_id || '', accessToken: fb.access_token || '', tokenExpiresAt: fb.token_expires_at || null };
}

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

export async function runPageRoutineCycle() {
  if (running) return { skipped: true, reason: 'Ciclo anterior en curso' };
  running = true;
  try {
    const db = getDB();
    const { pageId, accessToken } = getPageConfig();
    if (!pageId || !accessToken) {
      return { skipped: true, reason: 'Página de Facebook no configurada' };
    }

    const routines = db.prepare("SELECT * FROM page_routines WHERE active = 1 ORDER BY name ASC").all();
    if (routines.length === 0) return { planned: 0, totalPosts: 0, messages: [] };

    const settings = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    let template = '';
    try { template = JSON.parse(settings?.publish_config || '{}')?.template || ''; } catch {}

    const now = Date.now();
    const base = new Date(now);
    const summary = { planned: 0, totalPosts: 0, messages: [] };

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

          const idx = Number(routine.last_product_index) || 0;
          const product = pool[idx % pool.length];

          await bookSlot(routine, product, slot, slotStr, template, pageId, accessToken, summary);

          db.prepare("UPDATE page_routines SET last_product_index = ?, updated_at = datetime('now') WHERE id = ?")
            .run((idx + 1) % pool.length, routine.id);
        }
      }
    }

    return summary;
  } catch (err) {
    console.error('[RoutineWorker] Error:', err);
    return { error: err.message };
  } finally {
    running = false;
  }
}

async function bookSlot(routine, product, slot, slotStr, template, pageId, accessToken, summary) {
  const db = getDB();
  const logId = uuid();
  const images = productImages(product);
  const message = buildMessage(routine, product, template);

  try {
    const result = await publishToPage(pageId, accessToken, {
      message,
      images,
      scheduledAt: slot,
    });

    db.prepare(`
      INSERT INTO page_schedule_log (id, routine_id, product_id, product_name, scheduled_for, status, meta_post_id, message, images_count)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
    `).run(logId, routine.id, product.id || null, product.name || '', slotStr, result.id || '', message, images.length);

    summary.planned += 1;
    summary.messages.push(`Agendado [${slotStr}] ${product.name} → Meta id ${result.id || 'n/a'} (${images.length} img)`);
  } catch (err) {
    const known = err instanceof FacebookError;
    db.prepare(`
      INSERT INTO page_schedule_log (id, routine_id, product_id, product_name, scheduled_for, status, meta_post_id, message, images_count, error)
      VALUES (?, ?, ?, ?, ?, 'error', '', ?, ?, ?)
    `).run(logId, routine.id, product.id || null, product.name || '', slotStr, message, images.length, err.message);
    summary.messages.push(`Error [${slotStr}] ${product.name}: ${err.message}${known && err.isTokenExpired ? ' (token expirado)' : ''}`);
  }
}