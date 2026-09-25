import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB, initDB } from '../db/database.js';
import { ensureRankingChrome } from './chromeLauncher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_JS = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'content_library_views.js');
const REPORT_PATH = path.join(__dirname, '..', '..', 'utilidades', 'fb-ranking', 'reporte_POC_fechas.json');
const STATE_FILE = path.join(__dirname, '.dailyRanking.json');
const LOG_FILE = path.join(__dirname, 'dailyRanking.log');

export function getRankingConfig() {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    const r = pc.ranking || {};
    return {
      auto_enabled: r.auto_enabled !== false,
      time: r.time || '10:00',
      min_groups: Number(r.min_groups) || 30,
      rounds: Number(r.rounds) || 260,
    };
  } catch {
    return { auto_enabled: true, time: '10:00', min_groups: 30, rounds: 260 };
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

function minutes(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ''));
  if (!m) return 10 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

const MAX_AUTO_ATTEMPTS = 4;            // reintentos automáticos máx. por día
const RETRY_COOLDOWN_MS = 15 * 60 * 1000; // espera mínima entre intentos fallidos
const MAX_WINDOW_MIN = 180;             // ventana máxima desde cfg.time

export function isDailyRankingDue(now = new Date(), cfg = getRankingConfig()) {
  if (!cfg.auto_enabled) return false;
  const today = localDateStr(now);
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = minutes(cfg.time);
  const state = readState();
  if (state?.lastRunDay !== today) {
    // primer intento del día: solo dentro de la ventana [time, time+30]
    return cur >= start && cur <= start + 30;
  }
  // ya corrido hoy
  if (state.outcome?.ok) return false;
  // Sin Chrome apagado al puerto 9222 no hay nada que reintentar: solo manual.
  if (state.outcome?.noBrowser) return false;
  // Tope de reintentos por día: evita el bucle de un scraper por minuto.
  if ((Number(state.attempts) || 0) >= MAX_AUTO_ATTEMPTS) return false;
  if (cur > start + MAX_WINDOW_MIN) return false;
  // Cooldown mínimo entre intentos fallidos.
  const last = state.lastAttemptAt ? new Date(state.lastAttemptAt).getTime() : 0;
  if (now.getTime() - last < RETRY_COOLDOWN_MS) return false;
  return true;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) { log(`[state] no se pudo guardar: ${e.message}`); }
}

export function dailyRankingStatus() {
  const st = readState() || {};
  const cfg = getRankingConfig();
  return {
    auto_enabled: cfg.auto_enabled,
    time: cfg.time,
    min_groups: cfg.min_groups,
    lastRunDay: st.lastRunDay || '',
    target: st.target || '',
    runAt: st.runAt || '',
    outcome: st.outcome || null,
    dueNow: isDailyRankingDue(),
  };
}

function log(msg) {
  const line = `[${new Date().toLocaleString('es-ES')}] ${msg}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  console.log(line);
}

function runScraper(target, rounds) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRAPER_JS, '--date=' + target, '--range=90', '--rounds=' + rounds], { timeout: 420000 }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      const errMsg = (err ? String(stderr || err.message) : '');
      if (err) return resolve({ error: errMsg.slice(0, 400), out });
      resolve({ ok: true, out });
    });
  });
}

// Chrome sin el nodo de debug (--remote-debugging-port=9222) no admite
// reintentos: el fallo es de "browser ausente", no del dato.
function isNoBrowserError(msg) {
  return /failed to fetch browser websocket url|localhost:9222|econnrefused|could not connect to chrome/i.test(String(msg || ''));
}

function loadReport() {
  try {
    const raw = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const norm = (g) => ({
      group: String(g.group || g.grupo || 'Sin grupo').trim(),
      posts: Number(g.posts ?? 1) || 0,
      views: Number(g.views ?? g.vistas ?? 0),
      impressions: Number(g.impressions ?? g.impresiones ?? 0),
      promedio: Number(g.promedio ?? (Number(g.views ?? g.vistas ?? 0) ? Math.round(Number(g.views ?? g.vistas ?? 0) / (Number(g.posts ?? 1) || 1)) : 0)),
    });
    const grupos = raw.grupos || raw.groups;
    return {
      fecha: String(raw.fecha || '').slice(0, 10),
      grupos: Array.isArray(grupos) && grupos.length ? grupos.map(norm).filter(g => g.group) : [],
    };
  } catch { return { fecha: '', grupos: [] }; }
}

let running = false;

function stampState(today, targetDate, outcome, source) {
  const prev = readState();
  const attempts = (prev?.lastRunDay === today ? (Number(prev.attempts) || 0) : 0) + 1;
  return { lastRunDay: today, target: targetDate, runAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), attempts, outcome, source };
}

export async function runDailyRanking({ force = false, target = null } = {}) {
  // Guard de concurrencia: una corrida cada minuto era lo que bloqueó la PC.
  if (running) {
    log('[RankingDiario] ya hay una corrida en curso; se omite este tick');
    return { ok: false, error: 'ya hay una corrida en curso' };
  }
  running = true;
  try {
    return await runDailyRankingInner({ force, target });
  } finally {
    running = false;
  }
}

async function runDailyRankingInner({ force = false, target = null } = {}) {
  const cfg = getRankingConfig();
  const targetDate = target || yesterdayStr();
  const today = localDateStr();
  log(`[RankingDiario] objetivo=${targetDate} fuerza=${force} min_groups=${cfg.min_groups}`);

  // Respaldo del reporte vigente: una corrida degenerada no debe pisar el
  // último snapshot bueno que muestra la vista.
  let prevReport = null;
  try { if (fs.existsSync(REPORT_PATH)) prevReport = fs.readFileSync(REPORT_PATH, 'utf8'); } catch {}
  const restoreReport = () => {
    if (prevReport != null) { try { fs.writeFileSync(REPORT_PATH, prevReport); } catch {} }
  };

  // Garantiza Chrome + sesión FB (puerto 9222) antes de correr el scraper.
  const chrome = await ensureRankingChrome({ launch: true });
  if (!chrome.ok) {
    const outcome = { ok: false, error: `Chrome no disponible (${chrome.error || chrome.status})`, noBrowser: true };
    saveState(stampState(today, targetDate, outcome, force ? 'manual' : 'auto'));
    log(`[RankingDiario] FALLO (Chrome): ${chrome.error || chrome.status}`);
    return outcome;
  }

  const res = await runScraper(targetDate, cfg.rounds);
  if (res.error) {
    const esSesion = /sesi[oó]n|login/i.test(res.error);
    const noBrowser = isNoBrowserError(res.error);
    const outcome = { ok: false, error: res.error.slice(0, 300), sesion: esSesion, noBrowser };
    saveState(stampState(today, targetDate, outcome, force ? 'manual' : 'auto'));
    log(`[RankingDiario] FALLO: ${res.error.slice(0, 200)}`);
    return outcome;
  }

  const { fecha, grupos } = loadReport();
  const gustos = grupos.length;
  const numOut = (!grupos.length && res.out) ? res.out.match(/Posts del .*: (\d+)/)?.[1] : null;
  const regen = numOut ? Number(numOut) : 0;

  if (!fecha || grupos.length === 0) {
    const outcome = { ok: false, error: `sin filas para ${targetDate} (extraidas ${regen ?? 0})` };
    saveState(stampState(today, targetDate, outcome, force ? 'manual' : 'auto'));
    log(`[RankingDiario] SIN filas para ${targetDate}`);
    restoreReport();
    return outcome;
  }

  const db = getDB();
  // snapshot crudo de la corrida (siempre; es la traza de lo que se vio)
  for (const g of grupos) {
    db.prepare('INSERT INTO rank_snapshots (grupo, fecha, vistas, impresiones) VALUES (?, datetime(\'now\', \'localtime\'), ?, ?)')
      .run(g.group, g.views, g.impressions);
  }

  if (grupos.length < cfg.min_groups) {
    const outcome = { ok: false, skipped: 'degenerate', fecha, grupos: grupos.length, vistas: grupos.reduce((a, g) => a + g.views, 0) };
    saveState(stampState(today, targetDate, outcome, force ? 'manual' : 'auto'));
    log(`[RankingDiario] DESCARTADO (se vio ${grupos.length} < ${cfg.min_groups}) — no se tocó ranking_history de ${targetDate}`);
    restoreReport();
    return outcome;
  }

  // La vista por grupo del día objetivo llegó completa: reemplazar el histórico.
  db.prepare('DELETE FROM ranking_history WHERE fecha = ?').run(fecha);
  for (const g of grupos) {
    // el wrapper cierra cada Statement tras un uso → preparar por cada fila
    db.prepare(`INSERT INTO ranking_history (fecha, grupo, posts, vistas, impresiones, promedio, creado)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`)
      .run(fecha, g.group, g.posts, g.views, g.impressions, g.promedio);
  }

  // respaldo con fecha del reporte
  try {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    fs.copyFileSync(REPORT_PATH, path.join(path.dirname(REPORT_PATH), `reporte_${fecha}_${stamp}.json`));
  } catch {}

  const outcome = { ok: true, fecha, grupos: grupos.length, vistas: grupos.reduce((a, g) => a + g.views, 0) };
  saveState(stampState(today, targetDate, outcome, force ? 'manual' : 'auto'));
  log(`[RankingDiario] OK: ${grupos.length} grupos para ${fecha} (${outcome.vistas} vistas) → ranking_history reemplazado`);
  return outcome;
}

// CLI: node backend/jobs/dailyRanking.js --now   (corre ya, para el día de ayer)
//      node backend/jobs/dailyRanking.js --now --date=2026-09-22
const isCLI = process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename;
if (isCLI) {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1] || null;
  initDB().then(() => runDailyRanking({ force: args.includes('--now'), target: dateArg })).then(() => { try { process.exit(0); } catch {} });
}