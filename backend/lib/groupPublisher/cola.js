// Cola de publicación: resuelve los inputs del poster, corre una corrida
// (runGroupPublish) y la dispara en segundo plano (startGroupPublish). Es el
// único módulo con estado mutable de corrida (`running`/`lastResult`/`currentRun`).
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { getDB } from '../../db/database.js';
import { resolveLocalUpload } from '../imageUtils.js';
import { ensureDebugChrome } from '../chromeLauncher.js';
import { getAccountConfig, getCuentasConfig, getUploadsDir, setCuentaActiva } from '../accountConfig.js';
import { claimTurn, commitLote, getLote, releaseTurn } from '../coordination.js';
import { isoLocal, localNow, toIsoUtc } from './util.js';
import { getAgendaConfig, getAutopublishConfig, getMasterConfig } from './config.js';
import { countPublishedToday, lastAttemptInfo, withinHoursWindow } from './estado.js';
import { limpiarFallos, marcarIntentoAhora, registrarFallo } from './limites.js';
import { classifyFailure, notaLote, notaDiagnostico, spawnPoster } from './poster.js';

// Carpeta de uploads de esta instancia. A usa backend/uploads; B la suya, para
// no mezclar imágenes ni dejar temporales en la de A.
const UPLOADS_DIR = getUploadsDir();

let running = false;
let lastResult = null;
// Progreso en vivo de la corrida en curso. Las rutas ya no esperan al run (el
// poster tiene --max-seconds=600 y entre posts hay 45-135s de separación), así
// que el frontend hace polling a /group-publish/status y lee esto. Sin esto no
// hay nada que mostrar hasta el final, que es justo lo que había que evitar.
let currentRun = null;

// ------------------------------------------------------- resolución inputs ---
export function resolveGroupUrl(item) {
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
function dueCandidates({ ignoreSchedule = false } = {}) {
  const db = getDB();
  const now = toIsoUtc(new Date());
  // ignoreSchedule se usa solo para el botón "Publicar ahora" de un evento que
  // todavía tiene hora futura: el usuario está pidiendo explícitamente que
  // salga ya, así que la hora no debe filtrarlo. Ningún otro camino lo activa.
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
    WHERE pq.status = 'pending'
      AND (? = 1 OR pq.scheduled_at IS NULL OR pq.scheduled_at <= ?)
    ORDER BY COALESCE(pq.scheduled_at, pq.created_at) ASC
  `).all(ignoreSchedule ? 1 : 0, now);
}

export function pickForRun(cfg, { auto, force }) {
  const now = Date.now();
  const candidates = dueCandidates().filter(c => resolveGroupUrl(c));
  const rows = [];
  const todayCount = countPublishedToday();

  for (const c of candidates) {
    if (rows.length >= (auto ? cfg.worker_batch : 30)) break;

    const groupUrl = resolveGroupUrl(c);
    // SIN cooldown por grupo: la separación la fija el usuario al agendar. Lo
    // que sigue son los límites del worker con límites (el que usa "Correr
    // vencidos"), que no aplica al disparador por fecha: ese tiene los suyos,
    // en `evaluarLimites()`, porque ni siquiera pasa por acá (manda `ids`).
    // franja horaria (solo worker)
    if (auto && !force && !withinHoursWindow(cfg)) continue;
    // cap diario (solo auto)
    if (auto && !force && todayCount + rows.length >= cfg.daily_cap) continue;
    // gap mínimo entre consecutivos (auto). Se mide contra el último INTENTO
    // (último acierto o último fallo), no solo contra el último publicado: con
    // la cola fallando, `lastPublishedInfo()` se congela en el último éxito y
    // el gap deja de existir justo cuando más hace falta. `lastAttemptInfo()`
    // ya incluye los `published_at`, así que sustituye al otro.
    if (auto && !force) {
      const ultimo = lastAttemptInfo();
      if (ultimo !== null && now - ultimo < cfg.min_gap_min * 60000) continue;
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
  // Lote de grupos: cuáles se ticked de verdad en el compositor. El poster ya
  // lo devolvía como `lote_grupos` y el backend lo botaba: en un post exitoso
  // `result.message` no se guarda, y ahí era donde venía el texto del lote. O
  // sea que la propagación a los N grupos era invisible — no se podía confirmar
  // ni desde la cola ni desde los logs (el stdout del poster se descarta).
  const loteNota = notaLote(result);
  let notes;
  if (result.ok) {
    const tag = mode === 'prepare' ? 'preparado' : 'publicado';
    notes = [base, `auto:${tag} ${now.slice(0, 19)}`.trim()].filter(Boolean).join(' | ');
    if (pending) notes += ' | pendiente de aprobación del administrador';
    notes += loteNota;
    notes += imgNota;
  } else {
    // El poster hizo el clic pero no pudo confirmar el envío (red lenta) -> status
    // 'revisar'. El post PUEDE haber salido, así que la fila queda con una marca
    // explícita `auto:revisar` para que (a) el usuario lo distinga de un error
    // declarado y (b) el anti-duplicado lo cuente como "posiblemente publicado"
    // y no lo vuelva a mandar.
    const tag = result.status === 'revisar' ? 'auto:revisar' : 'auto:error';
    notes = [base, `${tag} ${result.message || ''}`.trim()].filter(Boolean).join(' | ').slice(0, 500);
    notes = (notes + notaDiagnostico(result) + loteNota).slice(0, 500);
  }
  notes = (notes + avisos).slice(0, 500);

  // Estado real de la fila ahora mismo. Hace falta porque entre que se tomó el
  // ítem y que terminó de publicarse (2-4 min) el usuario puede haberlo
  // cancelado desde el calendario, y el UPDATE de abajo se lo pisaba sin
  // preguntar: el 2026-10-03 un destino cancelado a las 11:13 quedó 'published'
  // a las 11:16 y el post realmente había salido. Perder "publicó de verdad" es
  // peor que perder una cancelación, así que las dos cosas van con su regla.
  let estadoPrevio = 'pending';
  try {
    estadoPrevio = db.prepare('SELECT status FROM publication_queue WHERE id = ?').get(item.id)?.status || 'pending';
  } catch { /* si no se puede leer, se asume el peor caso */ }
  const fueCancelado = ['cancelled', 'omitted'].includes(estadoPrevio);

  if (result.ok && mode === 'publish') {
    // Un post que SALIÓ se registra siempre, se haya cancelado en el medio o no:
    // el historial real de Facebook no se puede dejar en 'cancelled'. Se deja
    // asentado que la cancelación llegó tarde.
    if (fueCancelado) {
      notes = `${notes} | OJO: se canceló desde el calendario mientras se publicaba y el post igual salió`.slice(0, 500);
    }
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
    //
    // Y si mientras tanto lo cancelaron, el cancelado gana: un fallo no puede
    // resucitar un destino que el usuario ya Sacó de la cola.
    db.prepare("UPDATE publication_queue SET status = 'error', notes = ?, published_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(notes, item.id);
    if (fueCancelado) return { aplicado: false, estadoPrevio };
  }
  return { aplicado: true, estadoPrevio };
}

async function deleteTempFiles(files) {
  for (const f of files) {
    try {
      if (fs.existsSync(f) && /pgp_(msg|dl|conv)_/.test(path.basename(f))) fs.unlinkSync(f);
    } catch (_) {}
  }
}

/**
 * ¿Con qué cuenta de Facebook publica esta corrida?
 *
 * Un solo proceso, dos perfiles de Chrome: cada corrida se hace con UNA cuenta
 * y con esa se abren su Chrome, su perfil y su proxy (la IP distinta por
 * cuenta). En `alternado` las corridas se dan la mano — A, B, A, B… — para que
 * las dos cuentas publiquen sin pisarse. En `A` o `B` fija siempre la misma.
 *
 * Arranca en A a propósito: `ultimaCuenta` está vacía y cualquier cuenta que
 * no sea A es "la siguiente". En memoria basta porque el alternador se decide
 * corrida por corrida, no por cada item.
 */
let ultimaCuenta = null;
function elegirCuenta() {
  const modo = String(getCuentasConfig().modo || 'alternado').toUpperCase();
  if (modo === 'A' || modo === 'B') return modo;
  return ultimaCuenta === 'A' ? 'B' : 'A';
}

/**
 * Trabajo real de la corrida. NO await-ear desde una ruta: usar
 * startGroupPublish(), que devuelve de inmediato. Va dejando el avance en
 * currentRun para que groupPublishStatus() lo sirva por polling.
 */
async function runGroupPublish({ runId = null, auto = false, force = false, ids = [], mode = null, debug = false, runNow = false, origen = 'manual' } = {}) {
  const cfg = getAutopublishConfig();
  // El lote va en el reloj de agenda, no en el worker con límites. `grupos_por_post`
  // y `lote_desde` son del disparador por fecha; usarlos del autopublish daba
  // undefined, la condición `loteN > 1` era falsa y el lote nunca se pedía.
  const agendaCfg = getAgendaConfig();
  const effectiveMode = mode || cfg.mode;
  const startedAt = toIsoUtc(new Date()).slice(0, 19);
  // Cuenta que va a publicar esta corrida: fija el suyo ANTES de cualquier uso
  // para que spawnPoster, chromeLauncher y /api/status hablen todos de la misma.
  const cuenta = elegirCuenta();
  ultimaCuenta = cuenta;
  setCuentaActiva(cuenta);
  const acc = getAccountConfig(cuenta);
  currentRun = {
    runId, started: startedAt, startedMs: Date.now(), finished: null,
    phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: effectiveMode, results: [],
    sesion: false, noBrowser: false, error: null,
    // Qué cuenta (y qué perfil/proxy) publicó: se ve en el log y en la UI.
    account: acc.id, account_label: acc.label, account_port: acc.debugPort,
    // `origen` viene del `startGroupPublish` y hay que reusarlo acá: este objeto
    // REEMPLAZA al que arma ahí, y sin copiarlo el log de cierre salía con
    // `origen=?` justo cuando sí importaba (lo detectó una corrida real).
    origen: currentRun && currentRun.origen ? currentRun.origen : 'manual',
  };

  try {
    // Garantiza Chrome con debugging remoto y el perfil de ESTA cuenta ANTES de
    // publicar. Se le pasa el puerto/perfil/proxy explícitos: sin eso siempre
    // apuntaría al 9222 del perfil de A. Si el puerto ya responde no se toca
    // nada (no interfiere con el Chrome del usuario ni con el scraper).
    currentRun.phase = 'starting_chrome';
    const chrome = await ensureDebugChrome({ launch: true, port: acc.debugPort, profileDir: acc.profileDir, proxy: acc.proxy });
    if (!chrome.ok) {
      const r = { ok: false, error: `Chrome no disponible para ${acc.label} (${chrome.error || chrome.status}). Se necesita Chrome con --remote-debugging-port=${acc.debugPort}, perfil ${acc.profileDir} y la sesión de Facebook abierta en ese perfil.`, noBrowser: true, started: startedAt };
      lastResult = r;
      currentRun.phase = 'error';
      currentRun.noBrowser = true;
      currentRun.error = r.error;
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }

    currentRun.phase = 'picking';
    const items = (ids && ids.length)
      ? dueCandidates({ ignoreSchedule: runNow }).filter(c => ids.includes(c.id))
      : pickForRun(cfg, { auto, force });

    if (items.length === 0) {
      const r = { ok: true, processed: 0, message: 'No hay publicaciones vencidas para publicar ahora.', reason: !auto ? 'na' : (withinHoursWindow(cfg) ? 'fuera de franja o sin vencidas' : 'fuera de franja horaria'), started: startedAt };
      lastResult = r;
      currentRun.phase = 'empty';
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }

    currentRun.total = items.length;
    currentRun.phase = 'publishing';
    // Candado de turno (A/B): solo una cuenta publica a la vez. A lo pide local;
    // B lo pide por HTTP al coordinador. `claimTurn` renueva el lease cuando ya
    // es nuestro (heartbeat). Si lo tiene la otra cuenta, esta corrida se aborta
    // SIN tocar la cola: se reintenta en el próximo tick, cuando la otra libere.
    const accountId = acc.id;
    let turno;
    try {
      turno = await claimTurn(accountId);
    } catch (err) {
      turno = { ok: false, error: `no se pudo consultar el turno (${err.message})` };
    }
    if (!turno.ok) {
      const r = { ok: true, processed: 0, message: `Turno ocupado por ${turno.owner || 'la otra cuenta'}${turno.retry_min ? ` (~${turno.retry_min} min)` : ''}: se espera para no publicar en simultáneo.`, reason: 'turno', started: startedAt };
      lastResult = r;
      currentRun.phase = 'waiting_turn';
      currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
      logFinCorrida(r);
      return r;
    }
    const results = [];
    const temps = [];
    let pausedByMaster = false;
    for (const item of items) {
      // Corte a mitad de corrida: si el usuario apagó el interruptor mientras
      // corría, NO se procesa el siguiente ítem. Entre post y post hay 45-135s
      // de separación, así que el corte es casi inmediato en la práctica. Lo que
      // queda sin procesar NO se toca: sigue en 'pending' y se publica cuando se
      // prende de nuevo.
      if (!getMasterConfig().on) {
        pausedByMaster = true;
        break;
      }
      currentRun.current_group = item.group_name;
      // El reloj del gap arranca AQUÍ, cuando el post empieza a escribirse, y no
      // cuando termina. Medirlo contra `published_at` hacía que el ritmo real
      // fuera 1/(gap + duración de la corrida): con 1m35s de media, un gap de
      // 8 min daba 6,3/h y el tope de 6/h era el que nunca mandaba.
      marcarIntentoAhora();
      // Heartbeat del turno: renueva el lease mientras dure la corrida para que
      // la otra cuenta no lo reclame por vencimiento a mitad de camino.
      try { await claimTurn(accountId); } catch { /* el próximo ítem reintenta */ }
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
        loteN: agendaCfg.grupos_por_post,
        loteDesde: await getLote(),
        // Puerto del Chrome de ESTA cuenta: sin esto el poster siempre hablaría
        // con el 9222 del perfil de A aunque la corrida sea de B.
        debugPort: acc.debugPort,
      });
      // El cursor avanza SOLO si el lote se tildó de verdad. Si el botón no
      // apareció, o si no se pudo tildar nada, se deja donde estaba: avanzar a
      // ciegas saltaría 9 grupos y el reparto perdería ese tramo para siempre.
      // Se commitea al coordinador para que el próximo lote (lo publique A o B)
      // siga desde acá. Como el turno es exclusivo, no hay carrera.
      if (Array.isArray(result.lote_grupos) && result.lote_grupos.length) {
        await commitLote(result.lote_grupos[result.lote_grupos.length - 1]);
      }
      const escritura = updateQueue(item, result, effectiveMode);
      // Corte automático: cuenta fallos CONSECUTIVOS de cualquier origen (worker,
      // disparador o clic manual), porque lo que se rompió es el canal de
      // Facebook, no quién apretó el botón. Al llegar al tope el disparador queda
      // pausado un rato en vez de seguir sacando destinos de a uno. Sin esto, el
      // 2026-10-03, la cola se consumió entera en 2 horas y Facebook dejó de
      // aceptar los envíos sin decir nada.
      //
      // EXCEPCIÓN `revisar`: los resultados que el poster no pudo confirmar pero
      // tampoco son un fallo declarado (el compositor no se vació y Facebook no
      // mostró ningún aviso) NO cuentan como fallo del canal. Con internet lento
      // el post puede haber salido igual; contarlos disparaba el breaker por
      // falsos negativos y cortaba corridas buenas. Sí se registran en el
      // historial para que el usuario los revise.
      if (result.ok) limpiarFallos();
      else if (result.status !== 'revisar') registrarFallo(agendaCfg, result.message);
      const avisos = Array.isArray(result.warnings) && result.warnings.length
        ? result.warnings.join('; ') : '';
      const row = {
        item_id: item.id,
        group: item.group_name,
        url: groupUrl,
        mode: effectiveMode,
        ok: result.ok,
        status: result.status,
        message: ((result.message || '') + (escritura && escritura.aplicado === false ? ' | el destino ya no estaba pendiente: no se sobrescribió' : '') + (avisos ? ` | aviso: ${avisos}` : '') + (result.img_adjunta !== undefined ? ` | img_adjunta:${result.img_adjunta}` : '') + (result.img_pedidas !== undefined ? ` de ${result.img_pedidas}` : '')).slice(0, 220),
        post_url: result.post_url || '',
        // El lote va explícito en el row: `notaLote` lo persiste en las notas,
        // pero el log necesita el dato crudo para no tener que parsear texto.
        lote: Array.isArray(result.lote_grupos) ? result.lote_grupos.length : null,
        lote_total: result.grupos_en_lista || null,
        lote_estado: result.lote_estado || null,
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

    // Liberar el turno para que la otra cuenta publique en el próximo hueco.
    // Si no se llega aquí (excepción), el lease vence solo y no queda trabado.
    try { await releaseTurn(accountId); } catch { /* el lease expira solo */ }

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
    if (pausedByMaster) {
      r.pausado_por_interruptor = true;
      r.restantes = items.length - results.length;
      r.message = `Se apagó el interruptor maestro a mitad de corrida. Quedan ${r.restantes} pendiente(s) en la cola, sin tocar.`;
    }
    lastResult = r;
    currentRun.phase = 'done';
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    logFinCorrida(r);
    return r;
  } catch (err) {
    const r = { ok: false, error: err.message.slice(0, 300), started: startedAt };
    lastResult = r;
    currentRun.phase = 'error';
    currentRun.error = r.error;
    currentRun.finished = toIsoUtc(new Date()).slice(0, 19);
    logFinCorrida(r);
    return r;
  } finally {
    running = false;
  }
}

/**
 * Cierre de la corrida en el log: qué salió, cuánto tardó y cuántos grupos del
 * lote quedaron ticked de verdad.
 *
 * El lote se lee del campo `lote`/`lote_total` de cada resultado, no parseando
 * las notas: es dato crudo y no depende de que el texto no se haya cortado.
 * `estado` es inyectable solo para poder testear el formato sin abrir Chrome.
 */
export function logFinCorrida(r, estado = null) {
  const c = estado || currentRun;
  if (!c) return;
  // Se estampa acá porque `lastResult` es la MISMA referencia que `r` en los
  // cuatro caminos de salida, y `/api/publish/status` lo expone: así el origen
  // de la última corrida queda disponible para la UI y para auditar, sin depender
  // de parsear el log.
  if (r && typeof r === 'object') r.origen = c.origen || 'manual';
  const dur = c.startedMs ? Math.round((Date.now() - c.startedMs) / 1000) : 0;
  const mins = Math.floor(dur / 60);
  const resumen = (c.results || []).map((x) => {
    const lote = x.lote === null || x.lote === undefined ? '' : ` (lote ${x.lote}${x.lote_total ? '/' + x.lote_total : ''})`;
    return `${x.group || '?'}:${x.ok ? (x.status === 'prepared' ? 'preparado' : 'ok') : 'FALLÓ'}${lote}`;
  }).join(', ');
  // SIN_LOTE cuenta solo los lotes que SE INTENTARON y fallaron (sin botón o sin
  // tildar grupos). Un lote 'no-aplicable' (sin imágenes o lote apagado) no es un
  // fallo: antes entraba por `lote===0` y el log metía ruido con posts que nunca
  // debían repartirse.
  const sinLote = (c.results || []).filter((x) => x.lote_estado === 'sin-boton' || x.lote_estado === 'sin-grupos').length;
  console.log(`[publish] FIN    corrida=${String(c.runId).slice(0, 8)} origen=${c.origen || '?'}`
    + ` dur=${mins ? mins + 'm' : ''}${dur % 60}s ok=${c.ok || 0} err=${c.errors || 0}`
    + (r && r.pausado_por_interruptor ? ' PAUSADO_POR_INTERRUPTOR' : '')
    + (sinLote ? ` SIN_LOTE=${sinLote}` : '')
    + (resumen ? `  ${resumen}` : '')
    + (r && r.error ? `  error="${String(r.error).slice(0, 90)}"` : ''));
}

/**
 * Dispara una corrida y devuelve DE INMEDIATO con el runId (la ruta responde
 * 202). El resultado se consulta por polling en GET /group-publish/status.
 *
 * Antes la ruta awaiteaba el run entero: con --max-seconds=600 del poster y 45-135s
 * entre posts eso son minutos, y api.js no tiene timeout, así que el botón
 * quedaba en "Corriendo..." sin que nadie supiera si colgó o estaba trabajando.
 */
export function startGroupPublish({ auto, force = false, ids = [], mode = null, debug = false, runNow = false, origen = null } = {}) {
  // Interruptor maestro: llave general de todo el publicador. Si está apagado
  // no arranca NADA, ni lo automático ni un clic en "Publicar ahora": esa es la
  // gracia del interruptor (decidir periodos en que el sistema no funciona).
  // Se chequea ANTES de `running` para que apagar no dé una falsa sensación de
  // "estaba corriendo": la razón es clara y el estado no se ensucia.
  let master;
  try { master = getMasterConfig(); } catch { master = { on: true }; }
  if (!master.on) {
    return { accepted: false, skipped: true, reason: 'interruptor maestro apagado' };
  }
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
  // `origen` es explícito en los cuatro call sites porque la agenda y un clic
  // manual llamaban los DOS con `auto: false`. Sin esto, el log no distinguía un
  // post que salió por el reloj de uno que salió porque el usuario lo pidió, y
  // un post 2 min después de un error (fuera del gap) era imposible de
  // auditar: podía ser un clic o un hole del freno.
  const quien = origen || (auto === true ? 'worker' : 'manual');
  const origenes = { agenda: 'reloj de agenda', worker: 'worker con límites', manual: 'clic del usuario' };
  // se siembra acá para que el primer poll ya vea la corrida, aunque el Chrome
  // todavía esté arrancando
  currentRun = {
    runId, started, startedMs: Date.now(), finished: null, phase: 'starting', total: 0, done: 0, ok: 0, errors: 0,
    current_group: null, mode: mode || cfg.mode, results: [], sesion: false, noBrowser: false, error: null,
    origen: quien,
  };

  // El log por corrida.Va al principio y no solo al final porque si el proceso
  // se cae a mitad de camino, el log igual dice qué se había tomado y por qué.
  console.log(`[publish] INICIO corrida=${runId.slice(0, 8)} origen=${quien} (${origenes[quien] || quien})`
    + ` modo=${mode || cfg.mode} destinos=${ids.length || 'todos'} ${force ? 'forzado' : ''}${runNow ? ' runNow' : ''}`);

  // fire-and-forget: los errores ya quedan en lastResult/currentRun
  runGroupPublish({ auto: isAuto, force, ids, mode, debug, runId, runNow, origen: quien }).catch((err) => {
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

// Accesores de solo lectura del estado de corrida, para los schedulers y el
// status. No se re-exportan en el barrel: la API pública no expone este estado.
export function isRunning() {
  return running;
}
export function getCurrentRun() {
  return currentRun;
}
export function getLastResult() {
  return lastResult;
}
