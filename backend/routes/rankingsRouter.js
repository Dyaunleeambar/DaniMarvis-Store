import { Router } from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPORT_PATH = path.join(__dirname, '..', '..', 'reporte_POC_fechas.json');
const FBLEAVE_PATH = path.join('C:', 'Users', 'Dani', 'fb-leave', 'reporte_POC_fechas.json');
const SCRAPER_JS = path.join('C:', 'Users', 'Dani', 'fb-leave', 'content_library_views.js');

function loadReport() {
  for (const p of [REPORT_PATH, FBLEAVE_PATH]) {
    try {
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        const grupos = raw.grupos || raw.groups;
        if (Array.isArray(grupos) && grupos.length) {
          return grupos.map(normGroup).filter(Boolean);
        }
        if (Array.isArray(raw.posts) && raw.posts.length) {
          return rankBy(raw.posts.map(normRow));
        }
      }
    } catch (_) {}
  }
  return [];
}

function loadReportFull() {
  for (const p of [REPORT_PATH, FBLEAVE_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const fecha = String(raw.fecha || '').slice(0, 10);
      const gruposArr = raw.grupos || raw.groups;
      const grupos = Array.isArray(gruposArr) && gruposArr.length
        ? gruposArr.map(normGroup).filter(Boolean)
        : (Array.isArray(raw.posts) && raw.posts.length ? rankBy(raw.posts.map(normRow)) : []);
      return { fecha, grupos, generado: raw.generado || '' };
    } catch (_) {}
  }
  return { fecha: '', grupos: [], generado: '' };
}

function normRow(r) {
  return {
    group: r.group || r.grupo || 'Sin grupo',
    views: Number(r.views ?? r.vistas ?? 0),
    impressions: Number(r.impressions ?? r.impresiones ?? 0),
    iso: r.iso || r.fecha_iso || null,
  };
}

function normGroup(g) {
  const views = Number(g.views ?? g.vistas ?? 0);
  const posts = Number(g.posts ?? 1) || 0;
  return {
    group: String(g.group || g.grupo || 'Sin grupo').trim(),
    posts,
    views,
    impressions: Number(g.impressions ?? g.impresiones ?? 0),
    promedio: Number(g.promedio ?? (posts ? Math.round(views / posts) : 0)),
    ultima_fecha: g.ultima_fecha || g.fecha_iso || '',
  };
}

// formato que consume el frontend (rankingsView.js)
function toResp(g) {
  return {
    grupo: g.group,
    posts: g.posts,
    vistas: g.views,
    impresiones: g.impressions,
    promedio: g.promedio,
    ultima_fecha: g.ultima_fecha,
  };
}

function rankBy(rows) {
  const by = new Map();
  for (const r of rows) {
    const grupo = (r.group || 'Sin grupo').trim();
    if (!by.has(grupo)) by.set(grupo, { group: grupo, posts: 0, views: 0, impressions: 0, fechas: [] });
    const g = by.get(grupo);
    g.posts += 1;
    g.views += Number(r.views) || 0;
    g.impressions += Number(r.impressions) || 0;
    if (r.iso) g.fechas.push(r.iso);
  }
  return [...by.values()].map(g => ({
    group: g.group,
    posts: g.posts,
    views: g.views,
    impressions: g.impressions,
    promedio: g.posts ? Math.round(g.views / g.posts) : 0,
    ultima_fecha: g.fechas.sort().pop() || ''
  }));
}

router.get('/', (req, res) => {
  try {
    const groups = loadReport();
    groups.sort((a, b) => b.views - a.views);
    const top = groups.slice(0, 20);
    const bottom = [...groups].sort((a, b) => a.views - b.views).slice(0, 10);
    res.json({
      total_groups: groups.length,
      total_posts: groups.reduce((a, g) => a + g.posts, 0),
      total_vistas: groups.reduce((a, g) => a + g.views, 0),
      top: top.map(toResp),
      bottom: bottom.map(toResp),
      fuente: 'Biblioteca de Contenido',
      actualizado: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  try {
    const db = getDB();
    // Sembrar/reparar historial a partir del reporte actual (corridas directas del
    // scraper, sin pasar por POST /refresh). Solo escribe si faltan grupos de esa fecha.
    const { fecha, grupos } = loadReportFull();
    if (fecha && grupos.length) {
      const c = db.prepare('SELECT COUNT(*) as c FROM ranking_history WHERE fecha = ?').get(fecha);
      if (Number(c.c) !== grupos.length) {
        // Statement.run hace free() tras cada uso → preparar por cada fila
        for (const g of grupos) {
          db.prepare(`INSERT OR REPLACE INTO ranking_history (fecha, grupo, posts, vistas, impresiones, promedio, creado)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
            .run(fecha, g.group, g.posts, g.views, g.impressions, g.promedio);
        }
      }
    }
    const rows = db.prepare(`
      SELECT fecha, COUNT(*) as grupos, SUM(vistas) as vistas, SUM(posts) as posts, MAX(creado) as actualizado
      FROM ranking_history
      GROUP BY fecha
      ORDER BY fecha DESC
    `).all();
    res.json({
      fechas: rows.map(r => ({
        fecha: r.fecha,
        grupos: Number(r.grupos) || 0,
        vistas: Number(r.vistas) || 0,
        posts: Number(r.posts) || 0,
        actualizado: r.actualizado || ''
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function toHistoryResp(g) {
  return {
    grupo: g.grupo,
    posts: Number(g.posts) || 0,
    vistas: Number(g.vistas) || 0,
    impresiones: Number(g.impresiones) || 0,
    promedio: Number(g.promedio) || 0,
  };
}

router.get('/history/group/:name', (req, res) => {
  try {
    const db = getDB();
    const name = decodeURIComponent(req.params.name);
    const rows = db.prepare(`
      SELECT fecha, posts, vistas, impresiones, promedio, creado
      FROM ranking_history
      WHERE grupo = ?
      ORDER BY fecha ASC
    `).all(name);
    res.json({
      grupo: name,
      puntos: rows.map(r => ({
        fecha: r.fecha,
        posts: Number(r.posts) || 0,
        vistas: Number(r.vistas) || 0,
        impresiones: Number(r.impresiones) || 0,
        promedio: Number(r.promedio) || 0,
        actualizado: r.creado || ''
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:date', (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });
    }
    const db = getDB();
    const rows = db.prepare('SELECT * FROM ranking_history WHERE fecha = ?').all(date);
    const grupos = rows.map(toHistoryResp).sort((a, b) => b.vistas - a.vistas);
    res.json({
      fecha: date,
      total_groups: grupos.length,
      total_posts: grupos.reduce((a, g) => a + g.posts, 0),
      total_vistas: grupos.reduce((a, g) => a + g.vistas, 0),
      grupos: grupos.map(g => ({ ...g })),
      top: grupos.slice(0, 20),
      bottom: [...grupos].sort((a, b) => a.vistas - b.vistas).slice(0, 20)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', (req, res) => {
  const date = (req.body?.date || '').trim();
  const desde = (req.body?.desde || '').trim();
  const hasta = (req.body?.hasta || '').trim();
  const range = (req.body?.range || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  const run = () => {
    const args = ['--no-sandbox'];
    if (range) args.push('--range=' + range);
    if (date) args.push('--date=' + date);
    if (desde) args.push('--desde=' + desde);
    if (hasta) args.push('--hasta=' + hasta);
    execFile(process.execPath, [SCRAPER_JS, ...args], { timeout: 420000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toString();
        if (/sesi[oó]n|login/i.test(msg)) {
          return res.status(401).json({ error: 'Sesión de Facebook requerida — abrí la Biblioteca de Contenido en el Chrome y reintentá', detalle: msg.slice(0, 300) });
        }
        return res.status(502).json({ error: 'El scraper falló', detalle: msg.slice(0, 300) });
      }
      try {
        const db = getDB();
        const { fecha, grupos } = loadReportFull();
        for (const g of grupos) {
          db.prepare(`INSERT OR REPLACE INTO rank_snapshots (grupo, fecha, vistas, impresiones) VALUES (?, datetime('now','localtime'), ?, ?)`)
            .run(g.group, g.views, g.impressions);
        }
        if (fecha && grupos.length) {
          // importante: Statement.run hace free() tras cada uso → preparar por cada fila
          for (const g of grupos) {
            db.prepare(`INSERT OR REPLACE INTO ranking_history (fecha, grupo, posts, vistas, impresiones, promedio, creado)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
              .run(fecha, g.group, g.posts, g.views, g.impressions, g.promedio);
          }
        }
        res.json({
          ok: true,
          guardados: grupos.length,
          fecha: fecha || (date || today),
          desde: desde || today,
          hasta: hasta || today,
          total_vistas: grupos.reduce((a, g) => a + g.views, 0)
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  };

  if (!fs.existsSync(SCRAPER_JS)) return res.status(500).json({ error: `No se encuentra el scraper en ${SCRAPER_JS}` });
  run();
});

export default router;
