// Coordinación entre las dos cuentas (A y B).
//
// A es el COORDINADOR: guarda en su propia base los cursores compartidos (lote
// de 9 grupos y destino de catálogo) y el candado de turno. B es un CLIENTE:
// la misma base de código arrancada con COORD_URL apuntando a A, así que todas
// estas funciones viajan por HTTP al coordinador.
//
// La elección local/HTTP es por entorno: si COORD_URL está definido, esta
// instancia es cliente; si no, es el coordinador (comportamiento histórico de A).
//
// Regla de oro: B NUNCA toca la base de A (sql.js reescribe el archivo entero;
// dos procesos escribiendo lo corrompen). Todo pasa por HTTP.

import { getDB } from '../db/database.js';
import { distribuirEnHuecos } from './ventanas.js';

const LEASE_MS_DEFAULT = 10 * 60 * 1000;

function isClient() {
  return Boolean(String(process.env.COORD_URL || '').trim());
}
function coordUrl() {
  return String(process.env.COORD_URL || '').replace(/\/+$/, '');
}
function coordToken() {
  return String(process.env.COORD_TOKEN || '');
}

// ------------------------------------------------------------ base local ---
function readPC() {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  try { return JSON.parse(row?.publish_config || '{}'); } catch { return {}; }
}
function writePC(pc) {
  const db = getDB();
  db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(pc));
}
function coordOf(pc) {
  return pc.coordination && typeof pc.coordination === 'object' ? pc.coordination : {};
}

// --------------------------------------------------------------- candado ---
/**
 * Toma el turno de publicación para `account`. Si lo tiene otra cuenta y no
 * expiró su lease, se niega. Volver a pedirlo siendo el dueño RENUEVA el lease
 * (es el heartbeat implícito). El lease evita que una caída deje el turno
 * trabado para siempre.
 */
export function localClaimTurn(account, leaseMs = LEASE_MS_DEFAULT) {
  const pc = readPC();
  const c = coordOf(pc);
  const turno = c.turno && typeof c.turno === 'object' ? c.turno : { owner: '', hasta: 0 };
  const now = Date.now();
  if (turno.owner && turno.owner !== account && Number(turno.hasta) > now) {
    return { ok: false, owner: turno.owner, retry_min: Math.ceil((Number(turno.hasta) - now) / 60000) };
  }
  const hasta = now + Math.max(30000, Number(leaseMs) || LEASE_MS_DEFAULT);
  pc.coordination = { ...c, turno: { owner: account, hasta } };
  writePC(pc);
  return { ok: true, owner: account, hasta };
}

export function localReleaseTurn(account) {
  const pc = readPC();
  const c = coordOf(pc);
  const turno = c.turno && typeof c.turno === 'object' ? c.turno : { owner: '', hasta: 0 };
  if (turno.owner === account) {
    pc.coordination = { ...c, turno: { owner: '', hasta: 0 } };
    writePC(pc);
    return { ok: true };
  }
  return { ok: false, owner: turno.owner };
}

// ------------------------------------------------------------ lote (9) ---
// El cursor del lote vive en agenda.lote_desde (mismo campo de siempre), así
// que A lo sigue viendo igual en Ajustes; lo nuevo es que B lo lee y commitea
// por HTTP, de modo que los lotes se reparten entre las dos cuentas sin
// importar cuál tenga el turno.
export function localGetLote() {
  const pc = readPC();
  return typeof pc.agenda?.lote_desde === 'string' ? pc.agenda.lote_desde : '';
}

export function localCommitLote(ultimo) {
  const pc = readPC();
  pc.agenda = { ...(pc.agenda || {}), lote_desde: typeof ultimo === 'string' ? ultimo : '' };
  writePC(pc);
  return pc.agenda.lote_desde;
}

// ---------------------------------------------------------- destino catálogo ---
// Cursor compartido sobre facebook_groups (mismo orden que el Planificador:
// sort_order, name). peek no avanza (es solo para previsualizar); advance lo
// mueve cuando la publicación se agenda de verdad.
export function localPeekDestinos(n) {
  const db = getDB();
  const grupos = db.prepare('SELECT id, name, url FROM facebook_groups ORDER BY sort_order ASC, name ASC').all();
  if (!grupos.length) return { grupos: [], inicio: 0, cursor: 0, total: 0 };
  const c = coordOf(readPC());
  const cursor = Number.isFinite(Number(c.destino_cursor)) ? ((Number(c.destino_cursor) % grupos.length) + grupos.length) % grupos.length : 0;
  const out = [];
  const k = Math.max(0, Number(n) || 0);
  for (let i = 0; i < k; i++) out.push(grupos[(cursor + i) % grupos.length]);
  return { grupos: out, inicio: cursor, cursor, total: grupos.length };
}

export function localAdvanceDestinos(k) {
  const db = getDB();
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM facebook_groups').get()?.c) || 0;
  if (!total) return { cursor: 0, total: 0 };
  const pc = readPC();
  const c = coordOf(pc);
  const cursor = Number.isFinite(Number(c.destino_cursor)) ? Number(c.destino_cursor) : 0;
  const nuevo = (((cursor + (Number(k) || 0)) % total) + total) % total;
  pc.coordination = { ...c, destino_cursor: nuevo };
  writePC(pc);
  return { cursor: nuevo, total };
}

// --------------------------------------------------- ventana de A (huecos) ---
// Horarios en que A ya tiene algo agendado dentro de [ini, fin] (ms). Son los
// "obstáculos" en los que B no debe caer.
export function localTiemposA(iniMs, finMs) {
  const db = getDB();
  const ini = Number(iniMs);
  const fin = Number(finMs);
  const out = [];
  for (const f of db.prepare("SELECT scheduled_at FROM publication_queue WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <> ''").all()) {
    const ms = new Date(String(f.scheduled_at).replace(' ', 'T')).getTime();
    if (!Number.isNaN(ms) && ms >= ini && ms <= fin) out.push(ms);
  }
  return out.sort((a, b) => a - b);
}

// Reparte las publicaciones de B en los huecos de A. Devuelve los horarios (ms)
// que entran en hueco y cuántas quedan fuera (van a la hora propia de B).
export function localDistribuir({ ini, fin, cantidad = 0, minGapMs = 0 } = {}) {
  const tiemposA = localTiemposA(ini, fin);
  const r = distribuirEnHuecos({ tiemposA, ini, fin, cantidad, minGapMs });
  return { ...r, tiemposA_en_ventana: tiemposA.length };
}

export function localState() {
  const pc = readPC();
  const c = coordOf(pc);
  const turno = c.turno && typeof c.turno === 'object' ? c.turno : { owner: '', hasta: 0 };
  return {
    role: 'coordinador',
    turno: { owner: turno.owner || '', hasta: Number(turno.hasta) || 0, vigente: Number(turno.hasta) > Date.now() },
    lote_desde: typeof pc.agenda?.lote_desde === 'string' ? pc.agenda.lote_desde : '',
    destino_cursor: Number.isFinite(Number(c.destino_cursor)) ? Number(c.destino_cursor) : 0,
  };
}

// ------------------------------------------------------ cliente HTTP (B) ---
async function http(path, { method = 'GET', body } = {}) {
  const res = await fetch(coordUrl() + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Coord-Token': coordToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `coordinación HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------- fachada que elige ---
export function isCoordinator() {
  return !isClient();
}

export async function claimTurn(account, { leaseMs = LEASE_MS_DEFAULT } = {}) {
  if (isClient()) return http('/api/coordination/turno/claim', { method: 'POST', body: { account, leaseMs } });
  return localClaimTurn(account, leaseMs);
}

export async function releaseTurn(account) {
  if (isClient()) return http('/api/coordination/turno/release', { method: 'POST', body: { account } });
  return localReleaseTurn(account);
}

export async function getLote() {
  if (isClient()) return (await http('/api/coordination/lote')).lote_desde;
  return localGetLote();
}

export async function commitLote(ultimo) {
  if (isClient()) return http('/api/coordination/lote/commit', { method: 'POST', body: { ultimo } });
  return localCommitLote(ultimo);
}

export async function peekDestinos(n) {
  if (isClient()) return http(`/api/coordination/destinos?n=${encodeURIComponent(n)}`);
  return localPeekDestinos(n);
}

export async function advanceDestinos(k) {
  if (isClient()) return http('/api/coordination/destinos/advance', { method: 'POST', body: { k } });
  return localAdvanceDestinos(k);
}

// Reparte las publicaciones de B en los huecos de la agenda de A. A computa sus
// propios horarios; B solo manda su ventana y cuántas quiere meter.
export async function distribuir({ ini, fin, cantidad, minGapMs = 0 } = {}) {
  if (isClient()) return http('/api/coordination/distribuir', { method: 'POST', body: { ini, fin, cantidad, minGapMs } });
  return localDistribuir({ ini, fin, cantidad, minGapMs });
}
