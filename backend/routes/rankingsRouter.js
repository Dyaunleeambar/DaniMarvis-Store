import { Router } from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/database.js';
import { runDailyRanking, dailyRankingStatus } from '../jobs/dailyRanking.js';
import { ensureRankingChrome } from '../jobs/chromeLauncher.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPORT_PATH = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'reporte_POC_fechas.json');
const FBLEAVE_PATH = path.join('C:', 'Users', 'Dani', 'fb-leave', 'reporte_POC_fechas.json');
const SCRAPER_JS = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'content_library_views.js');

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
    const { fecha, generado, grupos } = loadReportFull();
    grupos.sort((a, b) => b.views - a.views);
    const top = grupos.slice(0, 20);
    const bottom = [...grupos].sort((a, b) => a.views - b.views).slice(0, 10);
    res.json({
      total_groups: grupos.length,
      total_posts: grupos.reduce((a, g) => a + g.posts, 0),
      total_vistas: grupos.reduce((a, g) => a + g.views, 0),
      top: top.map(toResp),
      bottom: bottom.map(toResp),
      fuente: 'Biblioteca de Contenido',
      fecha,
      generado,
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

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Análisis semanal (agrupa ranking_history por semana ISO, lunes a domingo) ──
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lunes de la semana a la que pertenece la fecha (lun=0).
function startOfWeek(iso) {
  const d = new Date(iso + 'T00:00:00');
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return isoDate(d);
}

function endOfWeek(iso) {
  const d = new Date(iso + 'T00:00:00');
  const offset = 6 - ((d.getDay() + 6) % 7);
  d.setDate(d.getDate() + offset);
  return isoDate(d);
}

function weeklyAgg(rows) {
  // rows = [{fecha, grupo, posts, vistas, impresiones, promedio}]
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.grupo)) by.set(r.grupo, { grupo: r.grupo, dias: 0, posts: 0, vistas: 0, impresiones: 0, promedios: [] });
    const g = by.get(r.grupo);
    g.dias += 1;
    g.posts += Number(r.posts) || 0;
    g.vistas += Number(r.vistas) || 0;
    g.impresiones += Number(r.impresiones) || 0;
    if (Number(r.promedio)) g.promedios.push(Number(r.promedio));
  }
  return [...by.values()].map(g => ({
    ...g,
    promedio: g.promedios.length ? Math.round(g.promedios.reduce((a, v) => a + v, 0) / g.promedios.length) : 0,
  })).sort((a, b) => b.vistas - a.vistas);
}

// Índice de semanas disponibles a partir del histórico.
router.get('/weekly', (req, res) => {
  try {
    const db = getDB();
    const rows = db.prepare('SELECT DISTINCT fecha FROM ranking_history ORDER BY fecha ASC').all();
    const seen = new Map();
    for (const r of rows) {
      const inicio = startOfWeek(r.fecha);
      if (!seen.has(inicio)) seen.set(inicio, { dias: 0, grupos: new Set(), posts: 0, vistas: 0 });
      const w = seen.get(inicio);
      w.dias += 1;
      w.grupos.add(r.fecha); // marcador precario — se sobreescribe abajo con la agrupación real
    }
    // agrupar con datos reales (por si hay varios días por semana)
    const agg = db.prepare(`
      SELECT fecha, grupo, posts, vistas, impresiones, promedio
      FROM ranking_history
      ORDER BY fecha ASC
    `).all();
    const weeks = new Map();
    for (const w of agg) {
      const inicio = startOfWeek(w.fecha);
      if (!weeks.has(inicio)) weeks.set(inicio, { inicio, fin: '', dias: new Set(), grupos: new Set(), posts: 0, vistas: 0, prom: [] });
      const wk = weeks.get(inicio);
      wk.fin = endOfWeek(inicio);
      wk.dias.add(w.fecha);
      wk.grupos.add(w.grupo);
      wk.posts += Number(w.posts) || 0;
      wk.vistas += Number(w.vistas) || 0;
    }
    const semanas = [...weeks.values()].map(w => ({
      id: w.inicio,
      inicio: w.inicio,
      fin: w.fin,
      dias: w.dias.size,
      grupos: w.grupos.size,
      posts: w.posts,
      vistas: w.vistas,
    })).sort((a, b) => b.inicio.localeCompare(a.inicio));
    res.json({ semanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalle de una semana (id = inicio en formato YYYY-MM-DD) con delta vs la anterior.
router.get('/weekly/:inicio', (req, res) => {
  try {
    const inicio = req.params.inicio;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
      return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });
    }
    const db = getDB();
    const fin = endOfWeek(inicio);
    const rows = db.prepare(`
      SELECT fecha, grupo, posts, vistas, impresiones, promedio
      FROM ranking_history
      WHERE fecha >= ? AND fecha <= ?
      ORDER BY fecha ASC
    `).all(inicio, fin);
    if (!rows.length) {
      return res.status(404).json({ error: 'No hay datos para esa semana' });
    }

    const prevInicio = startOfWeek(shiftWeek(inicio, -7));
    const prevRows = db.prepare(`
      SELECT fecha, grupo, posts, vistas, impresiones, promedio
      FROM ranking_history
      WHERE fecha >= ? AND fecha <= ?
      ORDER BY fecha ASC
    `).all(prevInicio, endOfWeek(prevInicio));
    const prevBy = new Map(weeklyAgg(prevRows).map(g => [g.grupo, g]));

    const grupos = weeklyAgg(rows).map(g => {
      const prev = prevBy.get(g.grupo);
      const deltaVistas = prev && prev.vistas
        ? Math.round(((g.vistas - prev.vistas) / prev.vistas) * 100)
        : (prev ? (g.vistas - prev.vistas) : null);
      const deltaPosts = prev && prev.posts
        ? Math.round(((g.posts - prev.posts) / prev.posts) * 100)
        : (prev ? (g.posts - prev.posts) : null);
      return {
        ...g,
        prev_vistas: prev?.vistas ?? null,
        prev_posts: prev?.posts ?? null,
        delta_vistas: deltaVistas,
        delta_posts: deltaPosts,
      };
    });

    res.json({
      semana: { inicio, fin, dias: rows.reduce((s, r) => s.add(r.fecha), new Set()).size, id: inicio },
      total_groups: grupos.length,
      total_posts: grupos.reduce((s, g) => s + g.posts, 0),
      total_vistas: grupos.reduce((s, g) => s + g.vistas, 0),
      top: grupos.slice(0, 20),
      bottom: [...grupos].sort((a, b) => a.vistas - b.vistas).slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function shiftWeek(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Evolución semana a semana de un grupo.
router.get('/weekly/group/:name', (req, res) => {
  try {
    const db = getDB();
    const name = decodeURIComponent(req.params.name);
    const rows = db.prepare(`
      SELECT fecha, posts, vistas, impresiones, promedio
      FROM ranking_history
      WHERE grupo = ?
      ORDER BY fecha ASC
    `).all(name);
    const by = new Map();
    for (const r of rows) {
      const inicio = startOfWeek(r.fecha);
      if (!by.has(inicio)) by.set(inicio, { inicio, fin: endOfWeek(inicio), dias: new Set(), posts: 0, vistas: 0, impresiones: 0, promedios: [] });
      const wk = by.get(inicio);
      wk.dias.add(r.fecha);
      wk.posts += Number(r.posts) || 0;
      wk.vistas += Number(r.vistas) || 0;
      wk.impresiones += Number(r.impresiones) || 0;
      if (Number(r.promedio)) wk.promedios.push(Number(r.promedio));
    }
    const puntos = [...by.values()].map(w => ({
      inicio: w.inicio,
      fin: w.fin,
      dias: w.dias.size,
      posts: w.posts,
      vistas: w.vistas,
      impresiones: w.impresiones,
      promedio: w.promedios.length ? Math.round(w.promedios.reduce((a, v) => a + v, 0) / w.promedios.length) : 0,
    })).sort((a, b) => a.inicio.localeCompare(b.inicio));
    res.json({ grupo: name, puntos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// El "Ranking del día" y la reparación del /history se alimentan del reporte.
// Al borrar una fecha del historial, si el reporte corresponde a esa fecha lo
// limpiamos para que la fecha eliminada no reaparezca ni en la vista ni al
// re-sembrar el historial.
function clearReportIfMatches(date) {
  for (const p of [REPORT_PATH, FBLEAVE_PATH]) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (String(raw.fecha || '').slice(0, 10) === date) {
        raw.grupos = [];
        raw.top = [];
        raw.posts = [];
        fs.writeFileSync(p, JSON.stringify(raw, null, 2));
        console.log(`[Ranking] Reporte limpio para fecha eliminada: ${date} (${p})`);
      }
    } catch (_) {}
  }
}

router.delete('/history/:date', (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });
    }
    const db = getDB();
    const eliminados = db.prepare('DELETE FROM ranking_history WHERE fecha = ?').run(date);
    clearReportIfMatches(date);
    res.json({ ok: true, fecha: date, eliminados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily', (req, res) => {
  res.json(dailyRankingStatus());
});

// Disparo manual de la corrida diaria (para el día objetivo = ayer, o --date).
router.post('/daily/run', async (req, res) => {
  try {
    const date = (req.body?.date || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });
    }
    const outcome = await runDailyRanking({ force: true, target: date || null });
    res.json(outcome);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/refresh', async (req, res) => {
  const date = (req.body?.date || '').trim();
  const desde = (req.body?.desde || '').trim();
  const hasta = (req.body?.hasta || '').trim();
  const range = (req.body?.range || '').trim();
  const today = todayLocal();

  if (!fs.existsSync(SCRAPER_JS)) return res.status(500).json({ error: `No se encuentra el scraper en ${SCRAPER_JS}` });

  // Precondición de las corridas (diarias y manuales): Chrome con debug 9222 y
  // sesión FB. Si el puerto no responde, se lanza Chrome automáticamente.
  try {
    const chrome = await ensureRankingChrome({ launch: true });
    if (!chrome.ok) {
      console.log(`[Ranking/refresh] Chrome no disponible: ${chrome.error || chrome.status}`);
      return res.status(502).json({
        error: 'Chrome con sesión de Facebook no disponible',
        detalle: (chrome.error || chrome.status).slice(0, 300),
      });
    }
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo preparar Chrome', detalle: e.message });
  }

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

  run();
});

export default router;
