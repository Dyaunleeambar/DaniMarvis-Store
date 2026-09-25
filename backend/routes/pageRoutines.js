import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';
import {
  validateFacebookToken,
  cancelScheduledPost,
  FacebookError,
} from '../lib/facebook.js';
import {
  runPageRoutineCycle,
  parseTimes,
  getPageConfig,
  isRoutineConfigured,
} from '../lib/pageRoutineWorker.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const routines = db.prepare('SELECT * FROM page_routines ORDER BY name ASC').all();
  for (const r of routines) {
    try { r.products = JSON.parse(r.products || '[]'); } catch { r.products = []; }
    const last = db.prepare(`
      SELECT product_name, scheduled_for, status FROM page_schedule_log
      WHERE routine_id = ? ORDER BY scheduled_for DESC LIMIT 1
    `).get(r.id);
    r.last_scheduled = last || null;
  }
  res.json({ routines, configured: isRoutineConfigured() });
});

function parseBody(body) {
  const name = String(body.name || '').trim();
  let products = [];
  if (Array.isArray(body.products)) products = body.products.map(p => String(p)).filter(Boolean);
  else if (body.products === 'all') products = [];

  const times = parseTimes(body.times);
  const default_text = String(body.default_text || '');
  const format = ['1:1', '4:5', '9:16'].includes(body.format) ? body.format : '4:5';
  const lead_minutes = Math.max(11, Number(body.lead_minutes) || 20);
  const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
  return { name, products, times, default_text, format, lead_minutes, active };
}

router.post('/', (req, res) => {
  const db = getDB();
  const data = parseBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'El nombre de la rutina es obligatorio' });

  if (data.times.length === 0) {
    return res.status(400).json({ error: 'Indicá al menos un horario (HH:MM)' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO page_routines (id, name, active, products, times, default_text, format, lead_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.active, JSON.stringify(data.products), data.times.join(','), data.default_text, data.format, data.lead_minutes);

  const created = db.prepare('SELECT * FROM page_routines WHERE id = ?').get(id);
  created.products = data.products;
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM page_routines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rutina no encontrada' });

  const data = parseBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'El nombre de la rutina es obligatorio' });
  if (data.times.length === 0) {
    return res.status(400).json({ error: 'Indicá al menos un horario (HH:MM)' });
  }

  db.prepare(`
    UPDATE page_routines SET name = ?, active = ?, products = ?, times = ?,
      default_text = ?, format = ?, lead_minutes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(data.name, data.active, JSON.stringify(data.products), data.times.join(','), data.default_text, data.format, data.lead_minutes, req.params.id);

  const updated = db.prepare('SELECT * FROM page_routines WHERE id = ?').get(req.params.id);
  updated.products = data.products;
  res.json(updated);
});

router.patch('/:id/active', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM page_routines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rutina no encontrada' });

  const active = req.body.active ? 1 : 0;
  db.prepare("UPDATE page_routines SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active, req.params.id);
  res.json({ id: req.params.id, active });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM page_routines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rutina no encontrada' });

  db.prepare("UPDATE page_schedule_log SET status = 'cancelled', updated_at = datetime('now') WHERE routine_id = ? AND status = 'scheduled'")
    .run(req.params.id);
  db.prepare('DELETE FROM page_routines WHERE id = ?').run(req.params.id);
  res.json({ message: 'Rutina eliminada' });
});

router.get('/logs', (req, res) => {
  const db = getDB();
  const { routine_id, status, limit } = req.query;
  const clauses = [];
  const params = [];
  if (routine_id) { clauses.push('routine_id = ?'); params.push(routine_id); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Number(limit) || 500, 2000);
  const rows = db.prepare(`
    SELECT l.*, r.name as routine_name
    FROM page_schedule_log l
    LEFT JOIN page_routines r ON r.id = l.routine_id
    ${where}
    ORDER BY l.scheduled_for DESC
    LIMIT ${lim}
  `).all(...params);
  res.json(rows);
});

router.get('/test', async (req, res) => {
  const db = getDB();
  const routine = req.query.routine_id
    ? db.prepare('SELECT * FROM page_routines WHERE id = ?').get(req.query.routine_id)
    : db.prepare("SELECT * FROM page_routines WHERE active = 1 ORDER BY name ASC LIMIT 1").get();

  const { pageId, accessToken } = getPageConfig();
  if (!pageId || !accessToken) {
    return res.status(400).json({ error: 'Configurá tu Página (Page ID y Access Token) en Ajustes.' });
  }

  const tokenCheck = await validateFacebookToken(accessToken);
  if (!tokenCheck.valid) {
    return res.status(400).json({
      error: tokenCheck.error + ' — volvé a generar un token de larga duración desde Facebook Developers.',
    });
  }

  if (!routine) return res.status(400).json({ error: 'No hay rutinas activas para probar' });

  const times = parseTimes(routine.times);
  const now = Date.now();
  const base = new Date(now);
  const leadMin = Math.max(11, Number(routine.lead_minutes) || 20);
  const dbTimes = new Set();
  for (let day = 0; day <= 1; day++) {
    for (const hm of times) {
      const [h, m] = hm.split(':').map(Number);
      const d = new Date(base);
      d.setDate(d.getDate() + day);
      d.setHours(h || 0, m || 0, 0, 0);
      const slotMs = d.getTime();
      if (slotMs <= now + leadMin * 60000) continue;
      dbTimes.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    }
  }

  res.json({
    valid: true,
    page: { page_id: pageId, user: tokenCheck.name, token_expires_at: getPageConfig().tokenExpiresAt },
    routine: { id: routine.id, name: routine.name, times: [...times] },
    pending_slots: [...dbTimes],
  });
});

router.post('/run-now', async (req, res) => {
  const summary = await runPageRoutineCycle();
  if (summary.error) return res.status(500).json(summary);
  res.json(summary);
});

router.delete('/logs/:logId', async (req, res) => {
  const db = getDB();
  const log = db.prepare('SELECT * FROM page_schedule_log WHERE id = ?').get(req.params.logId);
  if (!log) return res.status(404).json({ error: 'Registro no encontrado' });

  if (log.meta_post_id && log.status === 'scheduled') {
    const { pageId, accessToken } = getPageConfig();
    if (pageId && accessToken && log.meta_post_id) {
      try {
        await cancelScheduledPost(pageId, accessToken, log.meta_post_id);
      } catch (err) {
        return res.status(500).json({ error: 'No se pudo cancelar en Meta: ' + err.message });
      }
    }
  }

  db.prepare("UPDATE page_schedule_log SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(req.params.logId);
  res.json({ id: req.params.logId, status: 'cancelled' });
});

export default router;