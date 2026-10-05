import { api } from '../db/api.js';
import { openModal, closeModal, setModalCloseGuard, showToast, confirmDialog } from '../core/app.js';
import { formatDate, formatDateTime, formatDateInput, localInputToUtc, debounce } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const MAX_IMAGES = 10;
const DIA_MS = 86400000;
const HORA_MIN = 6;
const HORA_MAX = 23;

let container = null;
let agenda = null;          // respuesta de /api/agenda
let grupos = [];            // facebook_groups
let productos = [];         // productos, para el buscador del Planificador
let vista = 'mes';          // 'mes' | 'semana'
let ancla = new Date();     // mes o semana que se está mirando
let cargando = false;
let filtroEstado = '';
let filtroGrupo = '';
let listaDia = null;        // publicaciones del modal "ver día", para "Distribuir en el día"

// ══════════════════════════════ utilidades de fecha ═══════════════════════
// Todo se calcula en hora LOCAL. La fecha viene del servidor ya resuelta
// (anio_local/mes_local/dia_local/hora_local) justamente para no repetir el
// error del desfase de 4h del otro lado del cable.
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const mesLabel = d => d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
// La grilla arranca en lunes (ver celdas() y lunesDe), así que los rótulos
// tienen que ir corridos respecto de DIAS, que arranca el domingo.
const DIAS_LUNES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** Lunes de la semana que contiene a `d`. */
function lunesDe(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;   // lunes = 0
  x.setDate(x.getDate() - dow);
  return x;
}

function rangoMes(base) {
  const primero = new Date(base.getFullYear(), base.getMonth(), 1);
  const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: ymd(primero), to: ymd(ultimo) };
}

function rangoSemana(base) {
  const lun = lunesDe(base);
  const dom = new Date(lun); dom.setDate(dom.getDate() + 6);
  return { from: ymd(lun), to: ymd(dom) };
}

/** Rango visible: en mes, la semana del 1° al 31; en semana, lunes a domingo. */
function rangoVisible() {
  return vista === 'semana' ? rangoSemana(ancla) : rangoMes(ancla);
}

/** Celdas del calendario: 42 (6 semanas) en mes, 7 en semana. */
function celdas() {
  if (vista === 'semana') {
    const lun = lunesDe(ancla);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(lun); d.setDate(d.getDate() + i);
      return d;
    });
  }
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  const dow = (primero.getDay() + 6) % 7;
  const inicio = new Date(primero); inicio.setDate(inicio.getDate() - dow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio); d.setDate(d.getDate() + i);
    return d;
  });
}

function eventosDelDia(d) {
  if (!agenda) return [];
  const clave = ymd(d);
  return agenda.eventos.filter(e => {
    if (e.fecha) {
      const f = new Date(e.fecha);
      return ymd(f) === clave;
    }
    // Sin fecha no debería pasar (la migración las rellenó), pero si pasara se
    // muestra hoy en vez de perderlo: mejor visible que invisible.
    return false;
  });
}

function eventosVisibles(evs) {
  return evs.filter(e => {
    if (filtroEstado && e.estado !== filtroEstado) return false;
    if (filtroGrupo) {
      const nombres = e.destinos.map(d => (d.group_name || '').toLowerCase());
      if (!nombres.includes(filtroGrupo.toLowerCase())) return false;
    }
    return true;
  });
}

// ══════════════════════════════════════════════════ carga ═════════════════

async function cargar() {
  const { from, to } = rangoVisible();
  cargando = true;
  try {
    agenda = await api.getAgenda(from, to);
  } catch (err) {
    agenda = { eventos: [], disparador: null };
    showToast('No se pudo cargar la agenda: ' + err.message, 'error');
  } finally {
    cargando = false;
    pintar();
  }
}

export async function render(cont) {
  container = cont;
  cont.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando agenda...</div>';
  try {
    const [gs, ps] = await Promise.all([
      api.getGroups().catch(() => []),
      api.getProducts({ status: 'active' }).catch(() => []),
    ]);
    grupos = gs;
    productos = ps;
  } catch { /* el calendario igual se dibuja */ }
  await cargar();
}

function pintar() {
  if (!container) return;
  const evs = agenda?.eventos || [];
  const visibles = eventosVisibles(evs);
  const cuenta = (estado) => evs.filter(e => e.estado === estado).length;

  container.innerHTML = `
    <div class="page">
      <div class="page-header page-header--sticky">
        <div>
          <h1>Publicaciones</h1>
          <p>${evs.length} evento(s) · ${visibles.length} visible(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn--secondary" onclick="window._agendaHoy()">Hoy</button>
          <button class="btn btn--primary" onclick="window._abrirPlanificador()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;margin-right:5px"><path d="M12 5v14M5 12h14"/></svg>
            Planificador
          </button>
        </div>
      </div>

      ${bannerDisparador()}
      ${bannerHuerfanos()}

      <div class="agenda-toolbar">
        <div class="agenda-nav">
          <button class="btn btn--sm btn--ghost" onclick="window._agendaNav(-1)" title="Anterior">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="agenda-period">${etiquetaPeriodo()}</div>
          <button class="btn btn--sm btn--ghost" onclick="window._agendaNav(1)" title="Siguiente">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="agenda-viewtoggle">
          <button class="${vista === 'mes' ? 'on' : ''}" onclick="window._agendaVista('mes')">Mes</button>
          <button class="${vista === 'semana' ? 'on' : ''}" onclick="window._agendaVista('semana')">Semana</button>
        </div>
        <div class="agenda-filters">
          <select class="form-control form-control--small" style="max-width:170px" onchange="window._agendaFiltroEstado(this.value)">
            <option value="">Todos los estados</option>
            ${['material', 'programada', 'vencida', 'parcial', 'parcial_vencida', 'publicada', 'error', 'omitida', 'cancelada']
              .map(s => `<option value="${s}" ${filtroEstado === s ? 'selected' : ''}>${etiquetaEstado(s)}</option>`).join('')}
          </select>
          <select class="form-control form-control--small" style="max-width:180px" onchange="window._agendaFiltroGrupo(this.value)">
            <option value="">Todos los grupos</option>
            ${grupos.map(g => `<option value="${escAttr(g.name)}" ${filtroGrupo === g.name ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="agenda-legend">
        <span><i style="background:#9e918d"></i> Material</span>
        <span><i style="background:#0288d1"></i> Programada</span>
        <span><i style="background:#ed6c02"></i> Vencida</span>
        <span><i style="background:#b8860b"></i> Parcial</span>
        <span><i style="background:#2e7d32"></i> Publicada</span>
        <span><i style="background:#d32f2f"></i> Error</span>
        <span><i style="background:#b8860b"></i> Omitida</span>
      </div>

      ${cargando ? '<div style="padding:30px;text-align:center;color:var(--text-secondary)">Cargando...</div>'
        : vista === 'semana' ? pintarSemana() : pintarMes()}

      ${huerfanos()}
    </div>
  `;
}

function etiquetaPeriodo() {
  if (vista === 'semana') {
    const lun = lunesDe(ancla);
    const dom = new Date(lun); dom.setDate(dom.getDate() + 6);
    const f = lun.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const t = dom.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    return `${f} – ${t} ${dom.getFullYear()}`;
  }
  return mesLabel(ancla);
}

function etiquetaEstado(s) {
  return ({
    material: 'Material', programada: 'Programada', vencida: 'Vencida',
    parcial: 'Parcial', parcial_vencida: 'Parcial · vencida', publicada: 'Publicada',
    error: 'Error', omitida: 'Omitida', cancelada: 'Cancelada',
  })[s] || s;
}

function bannerDisparador() {
  const d = agenda?.disparador;
  if (!d) return '';
  if (d.master_on === false) {
    return `<div class="agenda-aviso agenda-aviso--off">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="flex:none;margin-top:2px"><path d="M18.36 6.64a9 9 0 1 1-12.73 0 9 9 0 0 1 12.73 0zm-4.95 4.95H10.6l1.2-1.2v-3h1.2zm-5.06-5.06a9 9 0 0 1 12.73 0z" opacity=".9"/></svg>
      <div><b>El publicador está APAGADO (interruptor maestro).</b>
      Podés agendar todo lo que quieras y habrá vencidos esperando, pero nada se publicará — ni solo ni con "Publicar ahora" — hasta que lo prendas en Configuración.</div>
    </div>`;
  }
  if (d.auto === false) {
    return `<div class="agenda-aviso agenda-aviso--off">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;margin-top:2px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div><b>El disparador por fecha está apagado.</b>
      Podés agendar todo lo que quieras, pero nada se publicará solo hasta que lo prendas en Configuración.</div>
    </div>`;
  }
  if (d.due > 0) {
    return `<div class="agenda-aviso agenda-aviso--warn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;margin-top:2px"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
      <div><b>${d.due} publicación(es) vencida(s) esperando.</b>
      El disparador corre cada ${Math.round((d.interval_ms || 60000) / 60000)} min. Se publican solas salvo que ya haya una corrida en curso.</div>
    </div>`;
  }
  if (d.next_due_at) {
    const f = formatDateTime(d.next_due_at);
    return `<div class="agenda-aviso agenda-aviso--ok">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;margin-top:2px"><path d="M20 6 9 17l-5-5"/></svg>
      <div><b>Disparador activo.</b> Próxima publicación programada: ${escHtml(f)}.</div>
    </div>`;
  }
  return '';
}

function bannerHuerfanos() {
  const n = agenda?.huerfanos || 0;
  if (!n) return '';
  return `<div class="agenda-aviso agenda-aviso--warn">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;margin-top:2px"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div><b>${n} destino(s) sin publicación.</b>
    Quedaron apuntando a una publicación que ya no existe (típicamente al borrar
    una publicación con destinos agendados). No los publica el disparador por
    fecha, pero el worker legado sí los agarra: si querés, reiniciá el server
    y se limpian solos.</div>
  </div>`;
}

// ══════════════════════════════════ vista mes ═══════════════════════════

function pintarMes() {
  const lista = celdas();
  const mesActual = ancla.getMonth();
  const hoy = ymd(new Date());
  let html = '<div class="agenda-grid">';
  for (const d of DIAS_LUNES) html += `<div class="agenda-dayhead">${d}</div>`;
  for (const dia of lista) {
    const evs = eventosVisibles(eventosDelDia(dia));
    const out = dia.getMonth() !== mesActual;
    const esHoy = ymd(dia) === hoy;
// La celda entera abre el modal del día, no solo el "+N más": si no, con 1 a
    // 3 publicaciones no había forma de llegar a Duplicar ni a Distribuir.
    // Las celdas vacías no son clickeables (no hay nada que ver) y ahí se usa el
    // "+" para crear.
    const f = ymd(dia);
    const clickable = evs.length ? ` role="button" tabindex="0" title="Ver las publicaciones del ${escAttr(formatDate(f))}"
      onclick="window._agendaVerDia('${f}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window._agendaVerDia('${f}')}"` : '';
    html += `<div class="agenda-day ${out ? 'agenda-day--out' : ''} ${esHoy ? 'agenda-day--hoy' : ''}${evs.length ? ' agenda-day--click' : ''}"${clickable}>`;
    html += `<span class="agenda-daynum ${out ? 'agenda-daynum--tenue' : ''}">${dia.getDate()}</span>`;
    html += botonNuevoDia(dia);
    if (evs.length) html += botonMenuDia(dia);
    html += evs.slice(0, 3).map(tarjetaEvento).join('');
    if (evs.length > 3) {
      html += `<button class="agenda-more" onclick="event.stopPropagation();window._agendaVerDia('${f}')">+${evs.length - 3} más</button>`;
    }
    html += '</div>';
  }
  return html + '</div>';
}

/**
 * "⋯" de cada celda: duplica TODAS las publicaciones de ese día en otro día.
 *
 * Se dibuja sólo si el día tiene algo que duplicar. El click va con
 * stopPropagation porque la celda entera abre el modal del día y, sin esto, el
 * "⋯" no haría otra cosa que abrir lo mismo.
 */
function botonMenuDia(dia) {
  const f = ymd(dia);
  return `<button class="agenda-daymenu" onclick="event.stopPropagation();window._agendaDuplicarDia('${f}')"
    title="Duplicar las publicaciones del ${escAttr(formatDate(f))}"
    aria-label="Duplicar las publicaciones del ${escAttr(formatDate(f))}">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
    </svg>
  </button>`;
}

/**
 * "+" de cada celda del calendario: crea una publicación YA con ese día
 * puesto, así no hay que scrollear hasta el botón de arriba ni elegir la fecha
 * a mano. Va en la esquina para no comerse lugar de los eventos.
 */
function botonNuevoDia(dia) {
  const f = ymd(dia);
  return `<button class="agenda-dayadd" onclick="event.stopPropagation();window._agendaNuevo('${f}')"
    title="Nueva publicación el ${escAttr(formatDate(f))}"
    aria-label="Nueva publicación el ${escAttr(formatDate(f))}">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg>
  </button>`;
}

// `destinos_activos` excluye lo archivado, cancelado o descartado, así que el
// rótulo baja solo cuando el usuario descarta un destino. El conteo completo
// (`total_destinos`) se sigue usando para el banner de "Sin agendar".
function vivosDe(e) { return e.destinos_activos ?? e.total_destinos; }

function tarjetaEvento(e) {
  const vivos = vivosDe(e);
  const meta = vivos > 0 ? `${vivos} grupo${vivos === 1 ? '' : 's'}` : 'sin agendar';
  return `<button class="agenda-ev agenda-ev--${e.estado}" onclick="event.stopPropagation();window._agendaDetalle('${e.id}')" title="${escAttr(e.product_name || 'Sin producto')} — ${escAttr(etiquetaEstado(e.estado))}">
    <div class="agenda-evtime">${e.hora_local || '—:—'}</div>
    <div class="agenda-evtxt">${escHtml(e.product_name || truncate(e.publish_text, 34))}</div>
    <div class="agenda-evmeta">${escHtml(etiquetaEstado(e.estado))}${vivos ? ' · ' + meta : ''}</div>
  </button>`;
}

function truncate(text, len = 90) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '…' : text;
}

// ═════════════════════════════════ vista semana ══════════════════════════

function pintarSemana() {
  const lista = celdas();
  const hoy = ymd(new Date());
  const horas = [];
  for (let h = HORA_MIN; h <= HORA_MAX; h++) horas.push(h);
  const ALTO = 44;                       // alto de cada franja horaria (px)
  const altoTotal = horas.length * ALTO;

  // ── capa 1: la grilla de fondo (etiquetas de hora + celdas vacías) ──
  let html = '<div class="agenda-weekwrap">';
  html += '<div class="agenda-week"><div class="agenda-weekhead"></div>';
  for (const dia of lista) {
    const esHoy = ymd(dia) === hoy;
    // El encabezado del día también abre el modal del día: en la vista semana las
    // celdas vacías no son clickeables (las ocupa la grilla horaria).
    const cab = ymd(dia);
    const conEventos = eventosVisibles(eventosDelDia(dia)).length > 0;
    html += `<div class="agenda-weekhead ${esHoy ? 'agenda-weekhead--hoy' : ''} agenda-weekhead--click" role="button" tabindex="0"
      title="Ver las publicaciones del ${escAttr(formatDate(cab))}"
      onclick="window._agendaVerDia('${cab}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window._agendaVerDia('${cab}')}">${DIAS[(dia.getDay() + 6) % 7]} ${dia.getDate()}${botonNuevoDia(dia)}${conEventos ? botonMenuDia(dia) : ''}</div>`;
  }
  for (const h of horas) {
    html += `<div class="agenda-hour">${pad2(h)}:00</div>`;
    for (const dia of lista) {
      const esHoy = ymd(dia) === hoy;
      html += `<div class="agenda-weekcol ${esHoy ? 'agenda-weekcol--hoy' : ''}"></div>`;
    }
  }
  html += '</div>';

  // ── capa 2: los eventos, posicionados sobre la grilla ──
  // Van en un overlay porque en la grilla cada celda mide una sola hora y un
  // evento a las 14:30 necesita medio slice de las 15:00. El overlay es un
  // div por día, de altura completa, y cada evento se ancla a su hora real.
  html += `<div class="agenda-weekoverlay" style="height:${altoTotal}px">`;
  for (const dia of lista) {
    html += '<div class="agenda-weekday">';
    for (const ev of repartirEnCarriles(eventosVisibles(eventosDelDia(dia)))) {
      const hh = Number((ev.hora_local || '00:00').slice(0, 2));
      const mm = Number((ev.hora_local || '00:00').slice(3, 5));
      if (hh < HORA_MIN || hh > HORA_MAX) continue;
      const top = (hh - HORA_MIN + mm / 60) * ALTO;
      const w = 100 / ev.__carriles;
      html += `<button class="agenda-weekslot agenda-ev--${ev.estado}" style="top:${top}px;left:calc(${ev.__carril * w}% + 2px);width:calc(${w}% - 4px)"
        onclick="window._agendaDetalle('${ev.id}')" title="${escAttr((ev.hora_local || '') + ' · ' + (ev.product_name || truncate(ev.publish_text, 40)) + ' — ' + etiquetaEstado(ev.estado))}">
        <b>${e(ev)}</b>
      </button>`;
    }
    html += '</div>';
  }
  return html + '</div></div>';
}

function e(ev) {
  return escHtml((ev.hora_local || '').slice(0, 5) + ' ' + truncate(ev.product_name || ev.publish_text, 14));
}

/**
 * Reparte en carriles los eventos que se pisan en el mismo día, para que dos
 * publicaciones a la misma hora no queden una encima de la otra. Greedy: cada
 * evento toma el primer carril cuyo último evento ya terminó.
 */
function repartirEnCarriles(evs) {
  const orden = evs.slice().sort((a, b) => (a.hora_local || '').localeCompare(b.hora_local || ''));
  const finCarril = [];
  for (const ev of orden) {
    const ini = Number((ev.hora_local || '00:00').slice(0, 2)) * 60 + Number((ev.hora_local || '00:00').slice(3, 5));
    let carril = finCarril.findIndex(f => f <= ini);
    if (carril === -1) { carril = finCarril.length; finCarril.push(0); }
    finCarril[carril] = ini + 30;   // altura mínima de un bloque: media hora
    ev.__carril = carril;
    ev.__carriles = 0;               // se completa abajo
  }
  const total = finCarril.length || 1;
  for (const ev of orden) ev.__carriles = total;
  return orden;
}

function huerfanos() {
  const evs = agenda?.eventos || [];
  const sinDestino = evs.filter(e => e.total_destinos === 0);
  if (!sinDestino.length) return '';
  return `<div class="agenda-huerfanos">
    <b>${sinDestino.length} publicación(es) sin agendar.</b> Están en la biblioteca como material: tienen texto e imágenes, pero ningún grupo ni fecha de publicación, así que no se van a publicar solas.
    Abrilas con el Planificador cuando quieras decidirlas.
  </div>`;
}

// ══════════════════════════════ detalle del evento ══════════════════════

const DEST_ICON = {
  pending: 'Programada', published: 'Publicada', error: 'Falló',
  cancelled: 'Cancelada', omitted: 'Omitida', prepared: 'Preparada', 'dry-run': 'Simulada',
  archived: 'Publicada (histórica)',
};

async function detalle(id) {
  const ev = (agenda?.eventos || []).find(e => e.id === id);
  if (!ev) { showToast('Ese evento no está en el rango visible', 'warning'); return; }

  const tienePendientes = ev.destinos.some(d => d.status === 'pending');
  const tieneFallos = ev.destinos.some(d => d.status === 'error' || d.status === 'omitted');
  const actuales = ev.destinos.filter(d => d.status !== 'archived');
  const historicos = ev.destinos.filter(d => d.status === 'archived');

  openModal(`
    <div class="modal-header">
      <h2>${escHtml(ev.product_name || 'Publicación')}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <span class="agenda-estado-badge agenda-estado-badge--${ev.estado}">${escHtml(ev.estado_label)}</span>
        <span style="font-size:.82rem;color:var(--text-secondary)">${escHtml(formatDateTime(ev.fecha))}</span>
        ${vivosDe(ev) ? `<span style="font-size:.8rem;color:var(--text-muted)">· ${vivosDe(ev)} destino(s)</span>` : ''}
        ${ev.historial ? `<span style="font-size:.8rem;color:var(--text-muted)">· ${ev.historial} histórico(s)</span>` : ''}
      </div>

      ${ev.total_destinos === 0 && !ev.historial ? `<div class="agenda-aviso agenda-aviso--off">
        <div><b>Sin agendar.</b> Esta publicación es material de la biblioteca: no tiene grupos ni hora de publicación, así que no se publica sola.
        Abrí el Planificador para decidir cuándo y a dónde va.</div>
      </div>` : ''}

      ${ev.images?.length ? `<div class="publication-detail-gallery">
        ${ev.images.slice(0, MAX_IMAGES).map(u => `<img src="${escAttr(u)}" alt="" class="publication-detail-img" />`).join('')}
      </div>` : ''}

      <div class="publish-text-section">
        <div class="publish-text-label">Texto de publicación</div>
        <div class="publish-text-content" style="white-space:pre-wrap">${escHtml(ev.publish_text)}</div>
      </div>

      ${actuales.length ? `<div style="margin-top:16px">
        <div class="publish-text-label" style="margin-bottom:8px">Destinos</div>
        <div class="agenda-destinos">
          ${actuales.map(destinoHTML).join('')}
        </div>
      </div>` : ''}

      ${historicos.length ? `<div style="margin-top:16px">
        <div class="publish-text-label" style="margin-bottom:8px">Histórico (planificaciones anteriores)</div>
        <div class="agenda-destinos">
          ${historicos.map(destinoHTML).join('')}
        </div>
      </div>` : ''}

      ${ev.planes?.length ? `<div style="margin-top:16px">
        <div class="publish-text-label" style="margin-bottom:8px">Horarios anteriores</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${ev.planes.map(p => `<div style="display:flex;align-items:center;gap:8px;font-size:.82rem;color:var(--text-secondary)">
            <span class="agenda-destino-dot agenda-destino-dot--archived"></span>
            <s>${escHtml(formatDateTime(p.fecha))}</s>
            <span style="color:var(--text-muted);font-size:.74rem">${p.origen === 'editar' ? 'cambio en el Planificador' : 'reprogramada'}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button>
      ${tieneFallos ? '<button type="button" class="btn btn--secondary" id="ev-retry">Reintentar fallidas</button>' : ''}
      <button type="button" class="btn btn--secondary" id="ev-editar">Editar</button>
      <button type="button" class="btn btn--secondary" onclick="closeModal();window._agendaDuplicar('${ev.id}')">Duplicar</button>
      ${tienePendientes ? '<button type="button" class="btn btn--primary" id="ev-run">Publicar ahora</button>' : ''}
    </div>
  `);
  setModalCloseGuard(null);

  document.getElementById('ev-run')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Publicando…';
    try {
      await api.runAgendaEvent(id);
      showToast('Corrida iniciada. Seguí el progreso en Configuración.', 'success');
      closeModal(true);
      setTimeout(cargar, 1500);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Publicar ahora';
    }
  });

  document.getElementById('ev-retry')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.retryAgendaEvent(id);
      showToast(`${r.requeued} destino(s) volvieron a la cola`, 'success');
      closeModal(true);
      await cargar();
      detalle(id);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });

  document.getElementById('ev-editar')?.addEventListener('click', () => {
    closeModal(true);
    abrirPlanificador(ev);
  });

  // Botón "Descartar" de cada destino que falló (por delegación: los botones
  // los arma destinoHTML() y se repintan con el modal).
  document.querySelectorAll('[data-descartar]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      window._agendaDescartarDestino(id, btn.dataset.descartar);
    });
  });
}

function destinoHTML(d) {
  const notas = d.notes || '';
  const imgs = d.images?.length
    ? `<div class="agenda-destino-mini">${d.images.slice(0, 4).map(u => `<img src="${escAttr(u)}" alt="" />`).join('')}
       ${d.images.length > 4 ? `<span>+${d.images.length - 4}</span>` : ''}</div>`
    : '';
  const cuando = d.published_at
    ? `publicado ${escHtml(formatDateTime(d.published_at))}`
    : d.scheduled_at ? `para ${escHtml(formatDateTime(d.scheduled_at))}` : '';
  // Sólo en los que fallaron: un destino ya publicado no se puede descartar
  // (sería falsear el historial) y un pendiente se resuelve reprogramando.
  const descartable = ['error', 'omitted'].includes(d.status);
  const botonDescartar = descartable
    ? `<button type="button" class="btn btn--sm btn--danger" data-descartar="${d.id}"
         title="Sacar este destino de la lista sin borrarlo">Descartar</button>`
    : '';
  // "Publicada" sola miente cuando el post quedó esperando al administrador del
  // grupo: salió del compositor pero todavía no se ve. El 2026-10-04 pasó — un
  // post en esa situación se contó como entregado. El tag principal lo dice.
  const tag = (d.status === 'published' && d.pending_approval)
    ? 'Publicada (esperando aprobación)'
    : (DEST_ICON[d.status] || d.status);
  return `<div class="agenda-destino">
    <span class="agenda-destino-dot agenda-destino-dot--${d.status}"></span>
    <div class="agenda-destino-cuerpo">
      <div class="agenda-destino-nombre">${escHtml(d.group_name || 'Grupo')}</div>
      <div class="agenda-destino-notas">
        <b>${escHtml(tag)}</b>${cuando ? ' · ' + cuando : ''}
        ${notas ? '<br>' + escHtml(notas) : ''}
      </div>
      ${d.pending_approval ? '<div class="agenda-destino--aprobacion">Queda esperando al administrador del grupo</div>' : ''}
      ${d.pista ? `<div class="agenda-destino-pista"><b>Qué hacer:</b> ${escHtml(d.pista)}</div>` : ''}
      ${imgs}
    </div>
    ${botonDescartar}
  </div>`;
}

/** Descarta un destino suelto y repinta el detalle con los conteos al día. */
window._agendaDescartarDestino = async function (pubId, destId) {
  const ok = await confirmDialog(
    'Este destino sale de la lista: la publicación no lo vuelve a intentar y no cuenta para el estado del evento. Se conserva el registro de qué se intentó.',
    { title: 'Descartar destino', confirmText: 'Descartar', danger: true }
  );
  if (!ok) return;
  try {
    await api.discardAgendaDestino(pubId, destId);
    showToast('Destino descartado', 'success');
    closeModal(true);
    await cargar();
    detalle(pubId);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function verDia(fecha) {
  const evs = eventosVisibles(agenda?.eventos || []).filter(e => e.fecha && ymd(new Date(e.fecha)) === fecha);
  if (!evs.length) { showToast('No hay eventos ese día', 'info'); return; }
  // "Distribuir en el día" trabaja sobre TODAS las del día: si algo ya salió,
  // al repartirlo se archiva (queda en el historial con su hora real) y se
  // agenda de nuevo en el horario nuevo. Ver _agendaDistribuir.
  const repartibles = evs;
  listaDia = { fecha, eventos: repartibles };
  openModal(`
    <div class="modal-header">
      <h2>${escHtml(formatDate(fecha))}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="agenda-destinos">
        ${evs.map(e => {
          const fechaActual = e.fecha ? formatDateInput(e.fecha) : '';
          const thumb = e.images?.length
            ? `<img src="${escAttr(e.images[0])}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:0 0 56px;align-self:center" />`
            : '';
          const accion = (onclick, title, colorClass, svg) =>
            `<button type="button" class="btn btn--sm ${colorClass}" title="${title}" onclick="${onclick}" style="padding:5px;display:flex;align-items:center;justify-content:center">${svg}</button>`;
          const acciones = `
            <div style="display:flex;gap:5px;align-items:center;justify-content:flex-end;flex:0 0 auto">
              ${accion(`window._agendaPublicarAhora('${e.id}')`, 'Publicar ahora', 'btn--primary',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`)}
              ${accion(`window._agendaReprogramar('${e.id}', '${escAttr(fechaActual)}')`, 'Reprogramar', 'btn--secondary',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`)}
              ${accion(`window._agendaEditar('${e.id}')`, 'Editar', 'btn--ghost',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`)}
              ${accion(`window._agendaDesarmar('${e.id}')`, 'Desarmar', 'btn--ghost',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`)}
              ${accion(`window._agendaDuplicar('${e.id}')`, 'Duplicar publicación', 'btn--ghost',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`)}
              ${accion(`window._agendaEliminar('${e.id}')`, 'Eliminar publicación', 'btn--danger',
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`)}
            </div>`;
          return `<div class="agenda-destino" style="align-items:stretch">
            <span class="agenda-dia-dot agenda-dia-dot--${e.estado}" title="${escAttr(etiquetaEstado(e.estado))}"></span>
            ${thumb}
            <button class="agenda-destino-cuerpo" style="cursor:pointer;text-align:left;border:0;background:none;padding:0;font:inherit;color:inherit"
              title="Ver detalle" onclick="closeModal(true);window._agendaDetalle('${e.id}')">
              <div class="agenda-destino-nombre">${escHtml(e.hora_local || '')} · ${escHtml(e.product_name || truncate(e.publish_text, 40))}</div>
              <div class="agenda-destino-notas">${escHtml(etiquetaEstado(e.estado))}${vivosDe(e) ? ' · ' + vivosDe(e) + ' grupo(s)' : ' · sin agendar'}</div>
              <span style="font-size:.72rem;color:var(--rose);text-decoration:underline">Ver detalle →</span>
            </button>
            ${acciones}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="form-actions">
      ${repartibles.length > 0 ? `
        <button type="button" class="btn btn--secondary" onclick="window._agendaDistribuir()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          Distribuir en el día
        </button>
        <button type="button" class="btn btn--secondary" onclick="window._agendaDuplicarDia('${fecha}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Duplicar todo al día
        </button>` : ''}
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button>
    </div>
  `);
  setModalCloseGuard(null);
}

/**
 * Duplicar TODAS las publicaciones de un día en otro día.
 *
 * No mueve: el día de origen queda intacto, con su historial, y en el destino
 * aparecen COPIAS con todos sus destinos en 'pending'. Mover un día se comía el
 * historial del anterior, así que la opción de "mover" no existe.
 *
 * La vista previa y la aplicación salen del mismo endpoint del backend
 * (planDuplicacionDia), así que lo que se muestra antes de confirmar no puede
 * diferir de lo que pasa después.
 *
 * Tres cosas se resuelven acá y no en el backend:
 *  - El plan se pide siempre sobre el DÍA COMPLETO, nunca sobre la lista ya
 *    filtrada. Si hay un filtro de estado o grupo activo se avisa cuántas cosas
 *    ocultas se van a duplicar igual, para que "duplicar todas" no sea una
 *    sorpresa.
 *  - Al duplicar, el modal no se cierra: pasa a un estado de éxito con
 *    "Deshacer". Es la red de seguridad de una acción masiva. El toast global
 *    no sirve porque muestra texto fijo y se va a los 4 segundos.
 *  - El deshacer borra las copias. Si alguna ya llegó a publicarse en Facebook
 *    el backend se niega a borrarla y el modal lo dice, en vez de fingir que se
 *    deshizo.
 */
window._agendaDuplicarDia = function (fecha) {
  closeModal(true);

  const [oy, om, od] = String(fecha).split('-').map(Number);
  const diaSiguiente = ymd(new Date(oy, om - 1, od + 1));
  // Set de ids visibles con el filtro de la barra, no un número: si el usuario
  // desmarca publicaciones, el aviso de "también van estas ocultas" tiene que
  // contar sobre lo que queda marcado.
  const visiblesIds = new Set(eventosVisibles(eventosDelDia(new Date(oy, om - 1, od))).map(e => e.id));
  // La hora de arranque se ofrece con la del día de origen, porque eso es
  // exactamente "copiar el día tal cual": la primera publicación cae en su hora y
  // los intervalos quedan como estaban. Si el usuario la mueve, mueve el bloque.
  // Se mira el día ENTERO, no lo que pasa el filtro: si el usuario tiene filtrada
  // la mañana, arrancar el bloque en la primera de la tarde movería todo el día.
  const horasDia = eventosDelDia(new Date(oy, om - 1, od))
    .map(e => e.hora_local).filter(h => /^\d{2}:\d{2}$/.test(h)).sort();
  const horaInicio = horasDia[0] || '08:00';

  let plan = null;
  let cargando = true;
  // El botón pide un clic de más cuando el día destino ya tiene copias de este
  // día. Se reinicia con cada plan nuevo: si cambiás la fecha o la hora, la
  // pregunta es otra.
  let confirmarRepeticion = false;
  const seleccion = new Set();      // arranca vacío; cada plan nuevo lo llena

  const nombreDe = (d) => d.product_name || truncate(d.publish_text, 38) || 'Publicación';

  openModal(`
    <div class="modal-header">
      <h2>Duplicar el ${escHtml(formatDate(fecha))} en otro día</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="agenda-aviso agenda-aviso--warn" style="margin-bottom:12px">
        El ${escHtml(formatDate(fecha))} <b>no se toca</b>: queda con todo su historial.
        En el día destino se crean copias, con los mismos grupos y a la hora que elijas, listas para publicar de nuevo.
      </div>
      <div class="form-group">
        <label for="dup-destino">Duplicarlas el día</label>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div style="flex:1">
            <input type="date" id="dup-destino" class="form-control" value="${escAttr(diaSiguiente)}" />
          </div>
          <div style="width:120px">
            <label for="dup-hora" style="display:block">Arrancar a las</label>
            <input type="time" id="dup-hora" class="form-control" value="${escAttr(horaInicio)}" />
          </div>
        </div>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
          A esa hora entra la primera publicación del día; las demás conservan los intervalos que tenían
          respecto de ella, así el bloque no se deforma.
        </small>
      </div>
      <div id="dup-previa"></div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="dup-ok" disabled>Duplicando…</button>
    </div>
  `);
  setModalCloseGuard(null);

  const destinoEl = document.getElementById('dup-destino');
  const horaEl = document.getElementById('dup-hora');
  const previaEl = document.getElementById('dup-previa');
  const okEl = document.getElementById('dup-ok');

  const aviso = (texto) => `<div class="agenda-aviso agenda-aviso--warn">${texto}</div>`;

  // Miniatura de la primera imagen. El placeholder va para las publicaciones sin
  // foto: una fila sin recuadro parece que se olvidó de cargar la imagen.
  const miniatura = (d) => d.imagen
    ? `<img src="${escAttr(d.imagen)}" alt="" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex:0 0 40px;background:var(--bg)" />`
    : `<span style="width:40px;height:40px;flex:0 0 40px;border-radius:6px;background:var(--bg);border:1px dashed var(--border);color:var(--text-muted);font-size:.6rem;display:flex;align-items:center;justify-content:center">—</span>`;

  /**
   * Botón y resumen. Se recalcula en cada cambio de selección, así que el texto
   * del botón SIEMPRE dice cuántas van: es la última línea de defensa contra
   * duplicar de más.
   */
  const pintarResumen = () => {
    const todas = plan?.duplicadas || [];
    const elegidas = todas.filter(d => seleccion.has(d.id));
    const resumenEl = document.getElementById('dup-resumen');
    if (!resumenEl) return;

    const todasEl = document.getElementById('dup-todas');
    if (todasEl) {
      todasEl.checked = elegidas.length === todas.length && todas.length > 0;
      todasEl.indeterminate = elegidas.length > 0 && elegidas.length < todas.length;
    }

    const n = elegidas.length;
    okEl.disabled = n === 0 || cargando;
    // El primer clic sobre un día ya duplicado pide confirmación (ver el handler
    // de `okEl`); el texto del botón tiene que decir cuál de los dos es.
    if (confirmarRepeticion && plan?.ya_duplicada && n > 0) {
      okEl.textContent = `Duplicar igual (ya lo hiciste ${plan.ya_duplicada} ${plan.ya_duplicada === 1 ? 'vez' : 'veces'})`;
      okEl.classList.add('btn--danger');
      return;
    }
    confirmarRepeticion = false;
    okEl.classList.remove('btn--danger');
    // "publicación" no es "publicación" + "es": el plural pierde el acento
    // ("publicaciones"), así que no se puede concatenar.
    okEl.textContent = n === 0 ? (todas.length ? 'No marcaste ninguna' : 'Nada que duplicar')
      : n === 1 ? 'Duplicar 1 publicación'
      : `Duplicar ${n} publicaciones`;

    if (!todas.length) {
      resumenEl.innerHTML = `<div class="agenda-aviso">No hay publicaciones el ${escHtml(formatDate(fecha))}.</div>`;
      return;
    }

    const destinos = elegidas.reduce((t, d) => t + (d.destinos || 0), 0);
    const publicadas = elegidas.reduce((t, d) => t + (d.publicados || 0), 0);
    const ocultas = n - elegidas.filter(d => visiblesIds.has(d.id)).length;
    // Los choques son por publicación: si esa no va, su choque no va con ella.
    const conflictos = (plan.conflictos || []).filter(c => seleccion.has(c.de_id));

    resumenEl.innerHTML = `
      <div class="agenda-aviso">
        ${n === todas.length ? 'Van' : `Van <b>${n}</b> de ${todas.length}`}:
        ${n === 1 ? 'se crea 1 publicación' : `se crean ${n} publicaciones`} con
        ${n === 1 ? '1 destino' : `${destinos} destinos`}, todas en 'pendiente' para que el worker las publique.
        ${publicadas ? `De lo que ya salió el ${escHtml(formatDate(fecha))} no se copia el historial: queda sólo en el día de origen.` : ''}
      </div>
      ${ocultas > 0 ? aviso(`Con el filtro de la barra sólo se ven ${n - ocultas} de las marcadas: se van a duplicar también ${ocultas} que están ocultas.`) : ''}
      ${(plan.avisos || []).map(a => aviso(escHtml(a))).join('')}
      ${conflictos.length ? aviso(
        `<b>Choques en el día destino</b>: ${conflictos.slice(0, 4).map(c =>
          `${escHtml(c.group_name)} a las ${escHtml(c.hora)} está cerca de ${escHtml(c.con)}`).join('; ')}${conflictos.length > 4 ? ` (y ${conflictos.length - 4} más)` : ''}.`
      ) : ''}
    `;
  };

  /** Las filas NO se redibujan al cambiar una selección: se destiñan. Así el
   *  foco del check y el scroll de la lista se conservan mientras se va marcando,
   *  que es lo que pasa cuando el día tiene 76 publicaciones. */
  const marcar = (id, on) => {
    if (on) seleccion.add(id); else seleccion.delete(id);
    previaEl.querySelectorAll('[data-dup-fila]').forEach(fila => {
      if (fila.dataset.dupFila !== id) return;
      fila.style.opacity = on ? '' : '.45';
      const chk = fila.querySelector('[data-dup-check]');
      if (chk) chk.checked = on;
    });
    pintarResumen();
  };

  const marcarTodas = (on) => {
    seleccion.clear();
    (plan?.duplicadas || []).forEach(d => { if (on) seleccion.add(d.id); });
    previaEl.querySelectorAll('[data-dup-fila]').forEach(fila => {
      fila.style.opacity = on ? '' : '.45';
      const chk = fila.querySelector('[data-dup-check]');
      if (chk) chk.checked = on;
    });
    pintarResumen();
  };

  const pintarPrevia = () => {
    if (cargando) { previaEl.innerHTML = '<div class="agenda-aviso">Calculando…</div>'; okEl.disabled = true; return; }
    if (!plan) return;

    const duplicadas = plan.duplicadas || [];
    if (!duplicadas.length) {
      previaEl.innerHTML = `<div class="agenda-aviso">No hay publicaciones el ${escHtml(formatDate(fecha))}.</div>`;
      okEl.disabled = true;
      okEl.textContent = 'Nada que duplicar';
      return;
    }

    // Orden de la fila: punto de estado, miniatura, texto y check al final. El
    // check a la derecha deja la columna de checks en un mismo lugar para el
    // ojo —y para el clic— aunque las filas mezclen textos de dos líneas— y evita
    // que el check quede pegado al punto, que es donde el usuario no espera
    // pulsar.
    // `a_fecha` se muestra sólo cuando la copia no cae en el día destino (hora de
    // arranque tarde + bloque largo): si no, el usuario vería una hora que no es
    // la que pidió sin ninguna pista de por qué.
    const filas = duplicadas.map(d => `
      <label class="agenda-destino" data-dup-fila="${escAttr(d.id)}" style="align-items:center;cursor:pointer">
        <span class="agenda-dia-dot agenda-dia-dot--${escAttr(d.estado)}" title="${escAttr(etiquetaEstado(d.estado))}"></span>
        ${miniatura(d)}
        <span style="flex:1;min-width:0;cursor:default;text-align:left;border:0;background:none;padding:0;font:inherit;color:inherit">
          <div class="agenda-destino-nombre">${escHtml(nombreDe(d))}</div>
          <div class="agenda-destino-notas">${escHtml(d.de_hora || '—:—')} → <b>${escHtml(d.a_hora || '—:—')}</b>${d.a_fecha && d.a_fecha !== plan.hasta ? ` <span style="color:var(--warning)">del ${escHtml(formatDate(d.a_fecha))}</span>` : ''} · ${escHtml(etiquetaEstado(d.estado))} · ${d.destinos || 0} destino(s)${d.publicados ? `, ${d.publicados} ya publicado(s)` : ''}</div>
        </span>
        <input type="checkbox" data-dup-check="${escAttr(d.id)}" checked style="flex:none;margin-top:5px;cursor:pointer" title="Llevar esta al día destino" />
      </label>`).join('');

    previaEl.innerHTML = `
      ${plan.ya_duplicada ? `
        <div class="agenda-aviso agenda-aviso--warn" style="margin-bottom:10px">
          <b>Ya duplicaste el ${escHtml(formatDate(plan.desde))} al ${escHtml(formatDate(plan.hasta))}
          ${plan.ya_duplicada === 1 ? 'una vez' : `${plan.ya_duplicada} veces`}.</b>
          Si volvés a duplicar, esas publicaciones quedan repetidas en el ${escHtml(formatDate(plan.hasta))}.
        </div>` : ''}
      <div style="display:flex;align-items:center;gap:10px;margin:2px 0 8px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.78rem;font-weight:600">
          <input type="checkbox" id="dup-todas" checked style="cursor:pointer" />
          Todas
        </label>
        <span style="font-size:.72rem;color:var(--text-muted)">Desmarcá lo que no quieras llevar al otro día</span>
      </div>
      <div class="agenda-destinos" style="margin-bottom:12px">${filas}</div>
      <div id="dup-resumen"></div>
    `;

    pintarResumen();
  };

  const pedirPlan = async () => {
    const hasta = destinoEl.value;
    if (!hasta || hasta === fecha) {
      plan = null;
      previaEl.innerHTML = aviso('Elegí un día destino distinto del de origen.');
      okEl.disabled = true;
      okEl.textContent = 'Duplicando…';
      return;
    }
    cargando = true;
    pintarPrevia();
    try {
      plan = await api.previewDuplicateAgendaDay(fecha, hasta, horaEl.value);
      confirmarRepeticion = false;
      // Viene todo marcado: el botón dice "Duplicar todo el día" y desmarcar es
      // la excepción, no al revés.
      seleccion.clear();
      (plan.duplicadas || []).forEach(d => seleccion.add(d.id));
      cargando = false;
      pintarPrevia();
    } catch (err) {
      cargando = false;
      plan = null;
      previaEl.innerHTML = aviso(`No se pudo calcular la duplicación: ${escHtml(err.message)}`);
      okEl.disabled = true;
    }
  };

  destinoEl.addEventListener('change', pedirPlan);
  // Cambiar la hora de arranque recalcula el plan entero: los horarios de todas las
  // filas se mueven, así que mostrar los viejos sería mostrar una preview que no
  // es la que se va a aplicar.
  horaEl.addEventListener('change', pedirPlan);

  // Un solo listener delegado para toda la lista, y puesto UNA vez: la lista se
  // redibuja cada vez que cambia el día destino, y atar el listener al render
  // dejaría un handler por cada cambio de fecha, con lo que un solo click
  // empezaría a contar doble.
  previaEl.addEventListener('change', e => {
    const chk = e.target;
    if (!(chk instanceof HTMLInputElement) || chk.type !== 'checkbox') return;
    if (chk.id === 'dup-todas') return marcarTodas(chk.checked);
    const fila = chk.closest('[data-dup-fila]');
    if (fila) marcar(fila.dataset.dupFila, chk.checked);
  });

  // El error de carga de una imagen no burbujea pero sí se captura, así que el
  // listener va en fase de captura. Sin esto, una miniatura que ya no está en el
  // disco muestra el ícono de imagen rota en medio de la lista.
  previaEl.addEventListener('error', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.closest('[data-dup-fila]')) return;
    const vacio = document.createElement('span');
    vacio.style.cssText = 'width:40px;height:40px;flex:0 0 40px;border-radius:6px;background:var(--bg);border:1px dashed var(--border);color:var(--text-muted);font-size:.6rem;display:flex;align-items:center;justify-content:center';
    vacio.textContent = '—';
    img.replaceWith(vacio);
  }, true);

  okEl.addEventListener('click', async () => {
    const hasta = destinoEl.value;
    const elegidas = (plan?.duplicadas || []).filter(d => seleccion.has(d.id)).map(d => d.id);
    if (!elegidas.length) return;

    // Si el día destino ya tiene copias de este día, el botón pide confirmación en
    // vez de duplicar y ya está. El caso real: la primera ejecución tarda unos
    // segundos, la respuesta no llega a tiempo, el usuario aprieta otra vez y el
    // día queda con cada publicación repetida. Un clic más, dicho a propósito,
    // es la diferencia.
    if (plan?.ya_duplicada && !confirmarRepeticion) {
      confirmarRepeticion = true;
      okEl.textContent = plan.ya_duplicada === 1
        ? 'Duplicar igual (ya lo hiciste 1 vez)'
        : `Duplicar igual (ya lo hiciste ${plan.ya_duplicada} veces)`;
      okEl.classList.add('btn--danger');
      return;
    }

    okEl.disabled = true;
    okEl.textContent = 'Duplicando…';
    try {
      const r = await api.duplicateAgendaDay(fecha, hasta, elegidas, horaEl.value);
      await cargar();
      mostrarListo(r, hasta);
    } catch (err) {
      showToast(err.message, 'error');
      okEl.disabled = false;
      pintarResumen();
    }
  });

  /**
   * Estado de éxito. No cierra el modal: deja el "Deshacer" a mano, que es el
   * punto. El día de origen nunca se tocó, así que no hay nada que restaurar
   * allá: deshacer sólo borra las copias.
   */
  const mostrarListo = (r, hasta) => {
    const n = r.duplicadas?.length || 0;
    const destinos = (r.duplicadas || []).reduce((t, d) => t + (d.destinos || 0), 0);
    openModal(`
      <div class="modal-header">
        <h2>${n} ${n === 1 ? 'publicación duplicada' : 'publicaciones duplicadas'} en ${escHtml(formatDate(hasta))}</h2>
        <button class="modal-close" onclick="closeModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="font-size:.9rem;color:var(--text-secondary)">El ${escHtml(formatDate(fecha))} quedó igual: ${n === 1 ? 'su publicación sigue' : 'sus publicaciones siguen'} con su historial. En ${escHtml(formatDate(hasta))} hay ${n} ${n === 1 ? 'copia' : 'copias'} con ${n === 1 ? '1 destino' : `${destinos} destinos`} en pendiente.</p>
        ${(r.conflictos || []).length ? aviso(`Quedan ${r.conflictos.length} choque(s) en el día destino: dos publicaciones cerca en el mismo grupo.`) : ''}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" id="dup-deshacer">Deshacer</button>
        <button type="button" class="btn btn--primary" onclick="closeModal()">Cerrar</button>
      </div>
    `);
    setModalCloseGuard(null);

    const deshacerEl = document.getElementById('dup-deshacer');
    if (!deshacerEl) return;
    deshacerEl.addEventListener('click', async () => {
      deshacerEl.disabled = true;
      deshacerEl.textContent = 'Deshaciendo…';
      try {
        const clones = (r.duplicadas || []).map(d => d.clon_id).filter(Boolean);
        const res = await api.undoDuplicateAgendaDay(clones);
        await cargar();
        const extra = res.omitidas?.length
          ? ` ${res.omitidas.length} no se borraron porque ya se habían publicado.`
          : '';
        showToast(`${res.borradas?.length || 0} copia(s) borradas de ${formatDate(hasta)}${extra}`, 'success');
        closeModal(true);
      } catch (err) {
        showToast(err.message, 'error');
        deshacerEl.disabled = false;
        deshacerEl.textContent = 'Deshacer';
      }
    });
  };

  pedirPlan();
};


window._agendaReprogramar = function (id, actual) {
  closeModal(true);
  const inputId = 'replan-fecha';
  openModal(`
    <div class="modal-header">
      <h2>Reprogramar publicación</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Nueva fecha y hora de publicación</label>
        <input type="datetime-local" id="${inputId}" class="form-control" value="${escAttr(actual)}" />
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
          Mueve la publicación y sus destinos todavía pendientes; los ya publicados quedan como historial.
        </small>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="replan-guardar">Reprogramar</button>
    </div>
  `);
  setModalCloseGuard(null);
  document.getElementById('replan-guardar').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const val = document.getElementById(inputId)?.value;
    if (!val) { showToast('Poné la fecha y la hora de publicación', 'warning'); return; }
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await api.rescheduleAgendaEvent(id, { scheduled_at: localInputToUtc(val) });
      showToast('Publicación reprogramada', 'success');
      closeModal(true);
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Reprogramar';
    }
  });
};

window._agendaDuplicar = async function (id) {
  try {
    await api.duplicatePublication(id);
    showToast('Publicación duplicada como material. Abrí el Planificador para elegirle hora y grupos.', 'success');
    await cargar();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

/**
 * "Distribuir en el día": reparte las publicaciones del día dentro de una franja
 * (Desde → Hasta) para no abrir el Planificador N veces cuando se generaron un
 * montón de publicaciones de una.
 *
 * El reparto es una caminata aleatoria: la primera queda a las `Desde` y cada
 * siguiente suma un entero sorteado entre el mínimo y el máximo. Si con eso la
 * tanda termina antes de `Hasta`, los gaps se estiran TODOS por el mismo factor
 * para llegar hasta `Hasta`; como el factor es uniforme, los gaps conservan sus
 * proporciones entre sí y no quedan iguales entre sí (ni crecientes), o sea que
 * no se arma un patrón reconocible. La última cae exactamente en `Hasta`, así
 * que nunca se pasa al día siguiente.
 *
 * Si algo ya se publicó, se archiva (queda en el historial con su hora real) y
 * se agenda de nuevo para el horario nuevo, en los mismos grupos: es el mismo
 * criterio que reprogramar a mano una publicación ya publicada.
 */
window._agendaDistribuir = function () {
  const ctx = listaDia;
  if (!ctx || !ctx.eventos.length) { showToast('No hay publicaciones para repartir', 'info'); return; }
  const [y, m, d] = ctx.fecha.split('-').map(Number);
  const nombreDe = e => e.product_name || truncate(e.publish_text, 34) || 'Publicación';
  const imgDe = e => e.images?.[0] || '';

  const minutosDe = (hora) => {
    const [hh, mm] = String(hora || '').split(':').map(Number);
    return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  };
  const relojDe = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
  // Los destinos no traen `hora_local` (solo el evento), así que la hora real de
  // salida se saca del timestamp.
  const horaDe = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  // Sorteo de los gaps. Se hace UNA vez por tanda: en cada tecla se recalcularía
  // solo y la vista previa saltaría mientras el usuario está mirando.
  let sorteados = [];

  const sortearGaps = (cuantos, min, max) => {
    const lo = Math.max(0, Math.floor(min) || 0);
    const hi = Math.max(lo, Math.floor(max) || 0);
    return Array.from({ length: Math.max(0, cuantos) }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
  };

  /** Devuelve [{ev, t, gap}] con la hora nueva de cada una, en orden del día. */
  const calcular = (sel, desde, hasta, min, max) => {
    const t0 = minutosDe(desde);
    const t1 = minutosDe(hasta);
    if (sel.length === 0) return { filas: [], error: 'Tildá al menos una publicación.' };
    if (t1 <= t0) return { filas: [], error: 'La hora de fin tiene que ser posterior a la de inicio.' };

    if (sel.length === 1) {
      return { filas: [{ ev: sel[0], t: new Date(y, m - 1, d, 0, t0, 0, 0), gap: 0 }], estirado: 0, comprimido: false };
    }

    const gaps = sorteados.length === sel.length - 1 ? sorteados : (sorteados = sortearGaps(sel.length - 1, min, max));
    const bruto = gaps.reduce((a, b) => a + b, 0);
    const span = t1 - t0;
    // Factor uniforme: preserva la irregularidad del sorteo y llena la franja.
    const factor = bruto > 0 ? span / bruto : 0;

    let acc = 0;
    const filas = [{ ev: sel[0], t: new Date(y, m - 1, d, 0, t0, 0, 0), gap: 0 }];
    for (let i = 0; i < gaps.length; i++) {
      acc += gaps[i] * factor;
      filas.push({ ev: sel[i + 1], t: new Date(y, m - 1, d, 0, Math.round(t0 + acc), 0, 0), gap: gaps[i] * factor });
    }
    return {
      filas,
      estirado: factor > 1 ? bruto : 0,
      comprimido: bruto > span,
      promedio: filas.length > 1 ? span / (filas.length - 1) : 0,
    };
  };

  // `pintarLista` reconstruye el HTML entero, así que el tildado no puede vivir
  // en el DOM: se guardan las excluidas y el checkbox se repinta desde acá.
  const excluidas = new Set();
  const seleccionadas = () => ctx.eventos.filter(e => !excluidas.has(e.id));

  const pintarLista = () => {
    const sel = seleccionadas();
    const res = calcular(sel, desdeEl.value, hastaEl.value, minEl.value, maxEl.value);
    const pubDe = e => (e.destinos || []).find(x => x.status === 'published');
    const invalid = res.error;
    // Orden del día de las tildadas: la k-ésima recibe rotacion[k].
    const orden = sel.map(e => e.id);

    cuerpoEl.innerHTML = ctx.eventos.map(e => {
      const pub = pubDe(e);
      const nueva = res.filas.find(f => f.ev.id === e.id);
      const k = orden.indexOf(e.id);
      const grupoRota = rotarEl.checked && k >= 0 ? (rotacion[k] || null) : null;
      return `
      <label class="dist-fila" for="dist-${e.id}">
        <input type="checkbox" class="dist-cb" id="dist-${e.id}" data-id="${e.id}" ${excluidas.has(e.id) ? '' : 'checked'} />
        <span class="agenda-dia-dot agenda-dia-dot--${e.estado}" title="${escAttr(etiquetaEstado(e.estado))}"></span>
        ${imgDe(e) ? `<img class="dist-thumb" src="${escAttr(imgDe(e))}" alt="" />` : '<span class="dist-thumb dist-thumb--vacia"></span>'}
        <span class="dist-nombre">
          <span class="dist-titulo">${escHtml(nombreDe(e))}</span>
          <span class="dist-sub">${escHtml(etiquetaEstado(e.estado))}${grupoRota ? ` · rotará a <b>${escHtml(grupoRota.name)}</b>` : (vivosDe(e) ? ` · ${vivosDe(e)} grupo(s)` : '')}${pub ? ` · publicada ${escHtml(horaDe(pub.published_at || pub.scheduled_at))}` : ''}</span>
        </span>
        <span class="dist-horas" title="La original se queda a las ${escAttr((e.hora_local || '--:--').slice(0, 5))}; se crea una copia a las ${escAttr(nueva ? relojDe(nueva.t.getHours() * 60 + nueva.t.getMinutes()) : '--:--')}">
          <span style="color:var(--text-muted);font-size:.74rem">${escHtml((e.hora_local || '--:--').slice(0, 5))}</span>
          <span style="color:var(--text-muted)">→</span>
          <b>${nueva ? escHtml(relojDe(nueva.t.getHours() * 60 + nueva.t.getMinutes())) : '—'}</b>
        </span>
      </label>`;
    }).join('');

    const selCount = sel.length;
    if (invalid) {
      notaEl.innerHTML = `<div class="plan-avisos plan-avisos--vacio">${escHtml(invalid)}</div>`;
    } else if (!selCount) {
      notaEl.innerHTML = '<div class="plan-avisos plan-avisos--vacio">No tildaste ninguna publicación.</div>';
    } else {
      const Bits = [];
      Bits.push(`${selCount} publicación(es) entre las <b>${escHtml(relojDe(minutosDe(desdeEl.value)))}</b> y las <b>${escHtml(relojDe(minutosDe(hastaEl.value)))}</b>.`);
      if (selCount > 1) Bits.push(`Separación promedio: <b>${Math.round(res.promedio)} min</b> (variable, sorteada).`);
      if (res.estirado) Bits.push(`Se estiró la tanda ${Math.round(res.estirado)} min para llenar la franja.`);
      if (res.comprimido) Bits.push('La franja quedó corta: se comprimieron los gaps.');
      const t0 = minutosDe(desdeEl.value);
      const t1 = minutosDe(hastaEl.value);
      if (t0 < HORA_MIN || t1 > HORA_MAX + 1) Bits.push(`Ojo: fuera de ${pad2(HORA_MIN)}:00–${pad2(HORA_MAX)}:00 no se ven en la vista semana.`);
      notaEl.innerHTML = `<div class="plan-avisos">${Bits.join(' ')}</div>`;
    }
    guardarEl.disabled = !!invalid || selCount === 0;
  };

  const repintarSorteo = () => { sorteados = []; pintarLista(); };

  closeModal(true);
  openModal(`
    <div class="modal-header">
      <h2>Distribuir en el día</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="form-group">
          <label>Desde</label>
          <input type="time" id="dist-desde" class="form-control" value="08:00" />
        </div>
        <div class="form-group">
          <label>Hasta</label>
          <input type="time" id="dist-hasta" class="form-control" value="20:00" />
        </div>
        <div class="form-group">
          <label>Separación mín. (min)</label>
          <input type="number" id="dist-min" class="form-control" value="2" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>Separación máx. (min)</label>
          <input type="number" id="dist-max" class="form-control" value="5" min="0" step="1" />
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button type="button" class="btn btn--sm btn--ghost" id="dist-todos">Todos</button>
        <button type="button" class="btn btn--sm btn--ghost" id="dist-ninguno">Ninguno</button>
        <button type="button" class="btn btn--sm btn--secondary" id="dist-sortear" title="Sortear otra vez los espacios entre publicaciones">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Volver a sortear
        </button>
        <span style="font-size:.74rem;color:var(--text-muted)">Los espacios se sortean al azar para que no se vea un patrón.</span>
      </div>
      <label class="dist-rotar" title="Cada copia va a UN solo grupo distinto, caminando el catálogo en orden y arrancando después del último grupo ya usado hoy.">
        <input type="checkbox" id="dist-rotar" />
        <span><b>Rotar grupos</b>: cada copia cae en un grupo distinto, empezando por los que hoy todavía no salieron.
          <span id="dist-rotar-info" style="color:var(--text-muted)"></span></span>
      </label>
      <div id="dist-lista" class="dist-lista"></div>
      <div id="dist-nota"></div>
      <div class="plan-avisos" style="margin-top:10px">
        Cada vez que repartís se crea una <b>copia</b> en la franja nueva y la publicación original se queda donde está.
        Así podés repartir varias veces el mismo día, ver todas las franjas en el calendario y borrar las que no te sirvan.
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="dist-guardar">Repartir</button>
    </div>
  `);
  setModalCloseGuard(null);

  const desdeEl = document.getElementById('dist-desde');
  const hastaEl = document.getElementById('dist-hasta');
  const minEl = document.getElementById('dist-min');
  const maxEl = document.getElementById('dist-max');
  const cuerpoEl = document.getElementById('dist-lista');
  const notaEl = document.getElementById('dist-nota');
  const guardarEl = document.getElementById('dist-guardar');
  const rotarEl = document.getElementById('dist-rotar');
  const rotarInfoEl = document.getElementById('dist-rotar-info');

  // Rotación de grupos. Se pide el orden UNA vez por un n igual a todas las del
  // día, así la k-ésima seleccionada siempre recibe el k-ésimo grupo sin volver
  // a pedirlo al destildar. El backend arranca después del último grupo usado
  // hoy y da la vuelta solo si hacen falta más copias que grupos.
  let rotacion = [];
  const cargarRotacion = async () => {
    if (!rotarEl.checked) { rotacion = []; if (rotarInfoEl) rotarInfoEl.textContent = ''; return; }
    try {
      const r = await api.getRotacionGrupos(ctx.fecha, ctx.eventos.length);
      rotacion = r.grupos || [];
      if (rotarInfoEl) {
        rotarInfoEl.textContent = r.total
          ? ` (catálogo: ${r.total}; ${r.usados} ya usado(s) hoy)`
          : ' (no hay grupos en el catálogo)';
      }
    } catch (err) {
      rotacion = [];
      rotarEl.checked = false;
      showToast(err.message, 'error');
    }
  };

  // Los horarios cambian la cuenta: se vuelve a sortear porque el estiramiento
  // depende del ancho de la franja.
  [desdeEl, hastaEl].forEach(el => el.addEventListener('change', repintarSorteo));
  [minEl, maxEl].forEach(el => el.addEventListener('input', repintarSorteo));
  document.getElementById('dist-sortear').addEventListener('click', repintarSorteo);
  document.getElementById('dist-todos').addEventListener('click', () => {
    excluidas.clear();
    pintarLista();
  });
  document.getElementById('dist-ninguno').addEventListener('click', () => {
    ctx.eventos.forEach(e => excluidas.add(e.id));
    pintarLista();
  });
  rotarEl.addEventListener('change', async () => {
    await cargarRotacion();
    pintarLista();
  });
  // El orden es el del día: tildar o destildar sólo cambia el QUÉ, no el
  // orden en que se reparten.
  cuerpoEl.addEventListener('change', (e) => {
    const cb = e.target.closest('.dist-cb');
    if (!cb) return;
    if (cb.checked) excluidas.delete(cb.dataset.id);
    else excluidas.add(cb.dataset.id);
    pintarLista();
  });
  pintarLista();

  guardarEl.addEventListener('click', async () => {
    const sel = seleccionadas();
    const res = calcular(sel, desdeEl.value, hastaEl.value, minEl.value, maxEl.value);
    if (res.error || !sel.length) { showToast(res.error || 'Tildá al menos una publicación', 'warning'); return; }
    guardarEl.disabled = true;
    try {
      // Cada distribución crea una COPIA en la franja nueva: la original se
      // queda donde está. Así se puede repartir varias veces el mismo día y
      // cada franja queda como un evento propio, para publicarlo o borrarlo
      // por separado.
      //
      // Con "Rotar grupos" la copia va a UN solo grupo del catálogo en vez de a
      // los de la original. Si el orden pedido no cubre las tildadas (p. ej. se
      // tildaron más después), se vuelve a pedir antes de repartir.
      const rotar = rotarEl.checked;
      if (rotar && rotacion.length < res.filas.length) await cargarRotacion();
      for (let i = 0; i < res.filas.length; i++) {
        guardarEl.textContent = `Repartiendo… ${i + 1}/${res.filas.length}`;
        const grupoId = rotar ? (rotacion[i]?.id || '') : '';
        await api.planificarPublication(res.filas[i].ev.id, res.filas[i].t.toISOString(), grupoId);
      }
      const avisoRotar = rotar && rotacion.length ? ' Cada copia fue a un grupo distinto.' : '';
      showToast(`${res.filas.length} copia(s) agendadas. Las originales quedaron en su lugar.${avisoRotar}`, 'success');
      closeModal(true);
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
      guardarEl.disabled = false;
      guardarEl.textContent = 'Repartir';
    }
  });
};

window._agendaPublicarAhora = async function (id) {
  const ok = await confirmDialog(
    'Se publica de inmediato en los grupos pendientes de esta publicación, sin esperar la hora agendada. La corrida puede tardar unos minutos.',
    { title: 'Publicar ahora', confirmText: 'Publicar ahora', danger: false }
  );
  if (!ok) return;
  try {
    await api.runAgendaEvent(id);
    showToast('Corrida iniciada. Seguí el progreso en Configuración.', 'success');
    closeModal(true);
    setTimeout(cargar, 1500);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._agendaEditar = function (id) {
  const ev = (agenda?.eventos || []).find(e => e.id === id);
  if (!ev) { showToast('Ese evento no está disponible', 'warning'); return; }
  closeModal(true);
  abrirPlanificador(ev);
};

window._agendaDesarmar = async function (id) {
  const ok = await confirmDialog(
    'Se cancelan los destinos pendientes y la publicación vuelve a ser material de la biblioteca: ya no se publicará, pero su texto e imágenes se conservan.',
    { title: 'Desarmar publicación', confirmText: 'Desarmar' }
  );
  if (!ok) return;
  try {
    await api.rescheduleAgendaEvent(id, { status: 'cancelled' });
    showToast('Publicación desarmada', 'success');
    closeModal(true);
    await cargar();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._agendaEliminar = async function (id) {
  const ok = await confirmDialog(
    'Se elimina la publicación de forma permanente: texto, imágenes, destinos e historial de publicación. Esta acción no se puede deshacer.',
    { title: 'Eliminar publicación', confirmText: 'Eliminar' }
  );
  if (!ok) return;
  try {
    await api.deletePublication(id);
    showToast('Publicación eliminada', 'success');
    closeModal(true);
    await cargar();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ══════════════════════════════════════ PLANIFICADOR ═════════════════════

/**
 * El Planificador reemplaza a la "Cola de Publicaciones" (pestañas Agregar y
 * Pendientes) y al modal de publicar. hace las dos cosas que hacían por
 * separado: guardar el contenido y agendarlo a grupos con una fecha/hora.
 *
 * `ev` = evento existente (editar). Sin argumento = crear uno nuevo.
 */
/**
 * `fechaInicial` la pasa el "+" de la celda del calendario: abre el Planificador
 * con ese día ya elegido en vez de la fecha de hoy.
 */
function abrirPlanificador(ev = null, fechaInicial = null) {
  const esEdicion = !!ev;

  // Las imágenes arrancan con las del evento; al guardar se copian a la cola
  // por destino, igual que siempre.
  const imgs = ev?.images ? [...ev.images] : [];

  // En la UI se muestra el NOMBRE del grupo, pero la cola guarda `group_id`
  // (y el endpoint /pub-queue resuelve nombre+url desde facebook_groups). Por
  // eso los checkbox llevan el id y el nombre se busca en `grupos`.
  const nombreDe = id => grupos.find(g => g.id === id)?.name || '';
  const idDeNombre = nombre => grupos.find(g => g.name === nombre)?.id;
  const destinosPendientes = esEdicion ? ev.destinos.filter(d => d.status === 'pending') : [];
  // Al editar se preseleccionan los grupos que ya están agendados (por nombre,
  // porque las filas viejas pueden no tener group_id guardado).
  const gruposPrevistos = destinosPendientes
    .map(d => d.group_id || idDeNombre(d.group_name))
    .filter(Boolean);

  const fechaDefecto = esEdicion && ev.fecha
    ? formatDateInput(ev.fecha)
    : fechaInicial
      ? formatDateInput(fechaInicial + 'T00:00:00')
      : (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return formatDateInput(d.toISOString()); })();

  openModal(`
    <div class="modal-header">
      <h2>${esEdicion ? 'Editar publicación' : 'Planificador'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <form id="plan-form">
      ${esEdicion ? `<input type="hidden" name="id" value="${ev.id}" />` : ''}

      <div class="form-group">
        <label>Producto asociado</label>
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <input type="text" id="plan-buscar" class="form-control" placeholder="Buscar producto..." style="flex:1;min-width:150px" />
          <select id="plan-prov" class="form-control form-control--small" style="max-width:160px">
            <option value="">Todos los proveedores</option>
          </select>
          <select id="plan-cat" class="form-control form-control--small" style="max-width:150px">
            <option value="">Todas las categorías</option>
          </select>
        </div>
        <select name="product_id" class="form-control" id="plan-prod">
          <option value="">Sin producto</option>
        </select>
      </div>

      <div class="form-group">
        <label>Texto de publicación</label>
        <textarea name="publish_text" class="form-control" id="plan-texto" style="min-height:130px">${escHtml(ev?.publish_text || '')}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm btn--secondary" id="plan-generar">Generar desde producto</button>
          <button type="button" class="btn btn--sm btn--ghost" id="plan-copiar">Copiar</button>
        </div>
      </div>

      <div class="form-group">
        <label>Imágenes <small style="color:var(--text-muted);font-weight:400">(máx. ${MAX_IMAGES})</small></label>
        <div id="plan-thumbs" class="image-thumbnails">
          ${imgs.map(u => `<div class="img-thumb" data-url="${escAttr(u)}"><img src="${escAttr(u)}" alt="" /><button type="button" class="img-thumb-remove" data-url="${escAttr(u)}">&times;</button></div>`).join('')}
        </div>
        <div class="image-input-row">
          <input type="text" id="plan-url" class="form-control" placeholder="https://..." />
          <button type="button" class="btn btn--secondary btn--sm" id="plan-addurl">Agregar URL</button>
          <label class="btn btn--secondary btn--sm" style="cursor:pointer;margin:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span id="plan-file-label">Subir</span>
            <input type="file" accept="image/*" multiple id="plan-file" style="display:none" />
          </label>
        </div>
      </div>

      <div class="form-row" style="grid-template-columns:1fr 1fr">
        <div class="form-group">
          <label>Fecha y hora de publicación</label>
          <input type="datetime-local" name="scheduled_at" class="form-control" id="plan-fecha" value="${fechaDefecto}" />
          <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
            Es el momento exacto en que sale. El disparador revisa cada minuto.
          </small>
        </div>
        <div class="form-group">
          <label>Grupos de Facebook</label>
          <div class="plan-grupos" id="plan-grupos">
            ${grupos.length ? grupos.map(g => {
              const on = gruposPrevistos.includes(g.id);
              // El "+" de uso del día se pinta después (pintarUsoGrupos), cuando
              // llegó la consulta: acá solo queda la fila base.
              return `<label class="plan-grupo" data-gname="${escAttr(g.name)}"><input type="checkbox" class="plan-gc" value="${escAttr(g.id)}" data-name="${escAttr(g.name)}" ${on ? 'checked' : ''}/> ${escHtml(g.name)}<span class="plan-grupo-uso" hidden></span></label>`;
            }).join('') : '<span style="font-size:.78rem;color:var(--text-muted)">No hay grupos registrados.</span>'}
          </div>
          ${grupos.length ? `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <button type="button" class="btn btn--sm btn--ghost" id="plan-todos">Todos</button>
            <button type="button" class="btn btn--sm btn--ghost" id="plan-ninguno">Ninguno</button>
            <button type="button" class="btn btn--sm btn--secondary" id="plan-gestionar">Gestionar grupos</button>
          </div>` : `<div style="margin-top:6px"><button type="button" class="btn btn--sm btn--secondary" id="plan-gestionar">Gestionar grupos</button></div>`}
        </div>
      </div>

      <div id="plan-avisos"></div>
      <div id="plan-preview"></div>

      <div class="form-actions" style="flex-wrap:wrap;gap:8px">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        ${destinosPendientes.length
          ? '<button type="button" class="btn btn--secondary" id="plan-cancelar">Desarmar publicación</button>' : ''}
        ${destinosPendientes.length ? '' : `<button type="button" class="btn btn--secondary" id="plan-material">${esEdicion ? 'Guardar cambios' : 'Guardar como material'}</button>`}
        <button type="submit" class="btn btn--primary" id="plan-agendar">${esEdicion ? 'Guardar y agendar' : 'Agendar publicación'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('plan-form');
  const init = JSON.stringify({ imgs, g: gruposPrevistos });
  setModalCloseGuard(async () => {
    const ahora = JSON.stringify({ imgs: imgs.slice().sort(), g: [...document.querySelectorAll('.plan-gc:checked')].map(c => c.value).sort() });
    if (ahora === init) return true;
    return confirmDialog('¿Descartar los cambios sin guardar?', {
      title: 'Cambios sin guardar', confirmText: 'Descartar', danger: true,
    });
  });

  // ── filtros de producto ──
  const selProd = document.getElementById('plan-prod');
  const selProv = document.getElementById('plan-prov');
  const selCat = document.getElementById('plan-cat');
  const inpBus = document.getElementById('plan-buscar');

  const proveedores = [...new Map(productos.filter(p => p.provider_id).map(p => [p.provider_id, p.provider_name || p.provider_id])).entries()];
  selProv.innerHTML = '<option value="">Todos los proveedores</option>' +
    proveedores.map(([id, n]) => `<option value="${escAttr(id)}">${escHtml(n)}</option>`).join('');
  const cats = [...new Set(productos.map(p => p.category).filter(Boolean))].sort();
  selCat.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('');

  function pintarProductos() {
    const q = (inpBus.value || '').toLowerCase();
    const cv = selProd.value;
    const filt = productos.filter(p => {
      if (selProv.value && p.provider_id !== selProv.value) return false;
      if (selCat.value && p.category !== selCat.value) return false;
      if (q && !(p.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
    selProd.innerHTML = '<option value="">Sin producto</option>' +
      filt.map(p => `<option value="${escAttr(p.id)}" ${p.id === cv ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');
  }
  if (esEdicion && ev.product_id) selProd.value = ev.product_id;
  pintarProductos();
  const deb = debounce(pintarProductos, 200);
  inpBus.addEventListener('input', deb);
  selProv.addEventListener('change', pintarProductos);
  selCat.addEventListener('change', pintarProductos);

  // ── imágenes ──
  const thumbs = document.getElementById('plan-thumbs');
  const fileIn = document.getElementById('plan-file');
  const urlIn = document.getElementById('plan-url');

  function pintarThumbs() {
    thumbs.innerHTML = imgs.map(u =>
      `<div class="img-thumb" data-url="${escAttr(u)}"><img src="${escAttr(u)}" alt="" /><button type="button" class="img-thumb-remove" data-url="${escAttr(u)}">&times;</button></div>`
    ).join('');
    thumbs.querySelectorAll('.img-thumb-remove').forEach(b => b.addEventListener('click', () => {
      const i = imgs.indexOf(b.dataset.url);
      if (i !== -1) imgs.splice(i, 1);
      pintarThumbs();
    }));
  }

  document.getElementById('plan-addurl').addEventListener('click', () => {
    const u = urlIn.value.trim();
    if (!u) return;
    if (imgs.length >= MAX_IMAGES) return showToast(`Máximo ${MAX_IMAGES} imágenes`, 'warning');
    imgs.push(u); urlIn.value = ''; pintarThumbs();
  });
  urlIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('plan-addurl').click(); } });

  fileIn.addEventListener('change', async () => {
    // Se limpia el input antes de procesar nada: si no, volver a elegir el
    // mismo archivo no dispara 'change' y el usuario cree que no funciona.
    const files = [...(fileIn.files || [])];
    fileIn.value = '';
    if (!files.length) return;

    // `accept` es solo una sugerencia para el diálogo del sistema: el usuario
    // puede elegir "todos los archivos". El filtro real va acá.
    const imagenes = files.filter(f => f.type.startsWith('image/'));
    const noImagenes = files.length - imagenes.length;

    const espacio = MAX_IMAGES - imgs.length;
    if (espacio <= 0) return showToast(`Máximo ${MAX_IMAGES} imágenes`, 'warning');

    const lote = imagenes.slice(0, espacio);
    const rebasadas = imagenes.length - lote.length;

    const label = document.getElementById('plan-file-label');
    const textoLabel = label?.textContent;
    const fallidas = [];
    let ok = 0;

    // Secuencial a propósito: /upload es local pero cada request abre streams y
    // escribe a disco. Diez en paralelo solo hace que una falle y perdamos la
    // trazabilidad de cuál fue. El label va avanzando para que no parezca colgado.
    for (let i = 0; i < lote.length; i++) {
      if (label) label.textContent = `Subiendo ${i + 1}/${lote.length}…`;
      try {
        const r = await api.uploadImage(lote[i]);
        imgs.push(r.url);
        ok++;
        pintarThumbs();          // se ve avanzar, en vez de saltar al final
      } catch (err) {
        fallidas.push(`${lote[i].name} (${err.message})`);
      }
    }
    if (label) label.textContent = textoLabel;

    // Un solo aviso con todo lo que pasó, para no encadenar toasts.
    const avisos = [];
    if (ok) avisos.push(`${ok} imagen${ok === 1 ? '' : 'es'} subida${ok === 1 ? '' : 's'}`);
    if (fallidas.length) avisos.push(`fallaron ${fallidas.length}: ${fallidas.join(', ')}`);
    if (noImagenes) avisos.push(`${noImagenes} archivo(s) no eran imágenes y se omitieron`);
    if (rebasadas) avisos.push(`${rebasadas} omitida(s) por el máximo de ${MAX_IMAGES}`);

    if (fallidas.length) showToast(avisos.join(' · '), 'error');
    else if (rebasadas || noImagenes) showToast(avisos.join(' · '), 'warning');
    else showToast(avisos.join(' · '), 'success');
  });

  document.getElementById('plan-generar').addEventListener('click', async () => {
    const pid = selProd.value;
    if (!pid) return showToast('Seleccioná un producto primero', 'warning');
    try {
      const p = await api.getProduct(pid);
      if (p.publish_text) document.getElementById('plan-texto').value = p.publish_text;
      else showToast('El producto no tiene texto de publicación. Usá la IA en Productos.', 'warning');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('plan-copiar').addEventListener('click', async () => {
    const t = document.getElementById('plan-texto')?.value;
    if (!t) return showToast('No hay texto para copiar', 'warning');
    try { await navigator.clipboard.writeText(t); showToast('Copiado al portapapeles', 'success'); }
    catch { showToast('No se pudo copiar', 'error'); }
  });

  document.getElementById('plan-todos')?.addEventListener('click', () => {
    document.querySelectorAll('.plan-gc').forEach(c => { c.checked = true; });
    pintarUsoGrupos();
    avisosDeb();
  });
  document.getElementById('plan-ninguno')?.addEventListener('click', () => {
    document.querySelectorAll('.plan-gc').forEach(c => { c.checked = false; });
    pintarUsoGrupos();
    avisosDeb();
  });
  document.getElementById('plan-gestionar').addEventListener('click', () => {
    closeModal(true);
    gestionarGrupos();
  });

  // ── avisos de separación: informa, NO bloquea ──
  const selFecha = document.getElementById('plan-fecha');
  const cajaAvisos = document.getElementById('plan-avisos');
  const cajaPreview = document.getElementById('plan-preview');

  const avisosDeb = debounce(async () => {
    // /agenda/conflicts compara por NOMBRE de grupo (es lo que guarda la cola),
    // así que se le pasan los data-name, no los ids.
    const gs = [...document.querySelectorAll('.plan-gc:checked')].map(c => c.dataset.name || '');
    const f = selFecha.value;
    if (!f) { cajaAvisos.innerHTML = ''; return; }
    const iso = localInputToUtc(f);
    if (!gs.length) {
      cajaAvisos.innerHTML = '<div class="plan-avisos plan-avisos--vacio">Sin grupos: esto se va a guardar como material y no se publicará solo.</div>';
      cajaPreview.innerHTML = '';
      return;
    }
    try {
      const r = await api.getAgendaConflicts(iso, gs, 2, ev?.id || '');
      if (r.avisos?.length) {
        cajaAvisos.innerHTML = `<div class="plan-avisos">
          <b>Vas a publicar cerca de otro post en el mismo grupo.</b>
          <span style="display:block;margin-top:2px">No hay cooldown, así que esto NO te va a detener: es solo para que lo sepas.</span>
          <ul>${r.avisos.slice(0, 6).map(a => `<li><b>${escHtml(a.group_name)}</b> — ${escHtml(a.product_name || 'sin producto')} ${a.minutos_de_diferencia === 0 ? 'a la misma hora' : `a ${a.minutos_de_diferencia} min de diferencia`}</li>`).join('')}</ul>
        </div>`;
      } else {
        cajaAvisos.innerHTML = '';
      }
      cajaPreview.innerHTML = `<div class="plan-preview">
        <b>Se publicará el ${escHtml(formatDateTime(iso))}</b> en ${gs.length} grupo(s): ${escHtml(gs.join(', '))}.
        <br><span style="color:var(--text-muted);font-size:.74rem">${imgs.length} de ${MAX_IMAGES} imagen(es). Podés elegir varias a la vez. El disparador corre cada minuto, así que puede salir hasta ~1 min después de esa hora.</span>
      </div>`;
    } catch { /* los avisos son un extra: si fallan, se sigue */ }
  }, 400);

  selFecha.addEventListener('change', avisosDeb);
  selFecha.addEventListener('input', avisosDeb);
  document.querySelectorAll('.plan-gc').forEach(c => c.addEventListener('change', avisosDeb));

  // ── grupos ya usados en ese día: amarillo al mirarlos, naranja al elegirlos ──
  // Un grupo que ya tiene una publicación con hora ese día se pinta de amarillo
  // como información ("este ya se usó"), y si además lo tildás para esta
  // publicación pasa a naranja con el aviso de que se va a repetir en el mismo
  // grupo el mismo día. Informa, no bloquea: la decisión es del usuario.
  let usosDelDia = new Map();

  const pintarUsoGrupos = () => {
    document.querySelectorAll('.plan-grupo').forEach(label => {
      const chk = label.querySelector('.plan-gc');
      const aviso = label.querySelector('.plan-grupo-uso');
      const uso = usosDelDia.get((label.dataset.gname || '').toLowerCase());
      const repetido = !!(uso && chk?.checked);
      label.classList.toggle('plan-grupo--usado', !!uso && !repetido);
      label.classList.toggle('plan-grupo--repetido', repetido);
      if (!uso) { aviso.hidden = true; aviso.textContent = ''; return; }
      aviso.hidden = false;
      aviso.innerHTML = repetido
        ? `⚠ ya se usó a las <b>${escHtml(uso.hora_local)}</b>`
        : `usado ${escHtml(uso.hora_local)}`;
    });
  };

  const cargarUsoDia = async () => {
    const dia = (selFecha.value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { usosDelDia = new Map(); pintarUsoGrupos(); return; }
    try {
      const r = await api.getUsoDia(dia, ev?.id || '');
      usosDelDia = new Map((r.usos || []).map(u => [(u.group_name || '').toLowerCase(), u]));
    } catch {
      usosDelDia = new Map();          // si falla, la lista queda neutra
    }
    pintarUsoGrupos();
  };

  selFecha.addEventListener('change', cargarUsoDia);
  document.querySelectorAll('.plan-gc').forEach(c => c.addEventListener('change', pintarUsoGrupos));
  cargarUsoDia();

  // ── guardado ──
  async function guardar({ agendar }) {
    const fd = new FormData(form);
    const texto = String(fd.get('publish_text') || '').trim();
    if (!texto) { showToast('El texto de publicación es obligatorio', 'error'); return; }

    const selIds = [...document.querySelectorAll('.plan-gc:checked')].map(c => c.value);
    const selNombres = selIds.map(nombreDe).filter(Boolean);
    const fechaRaw = String(fd.get('scheduled_at') || '');
    if (agendar) {
      if (!selIds.length) return showToast('Elegí al menos un grupo para agendar', 'warning');
      if (!fechaRaw) return showToast('Poné la fecha y la hora de publicación', 'warning');
    }

    const btn = document.getElementById(agendar ? 'plan-agendar' : 'plan-material');
    const txtBtn = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      // 1) El contenido vive en `publications` (la biblioteca). La fecha se
      //    guarda SIEMPRE, también como material: así el calendario puede
      //    colocarlo en su día aunque todavía no tenga grupos.
      const isoFecha = fechaRaw ? localInputToUtc(fechaRaw) : new Date().toISOString();
      const payload = {
        product_id: fd.get('product_id') || null,
        publish_text: texto,
        images: imgs,
        publication_date: isoFecha,
      };

      let pubId = ev?.id;
      if (pubId) await api.updatePublication(pubId, payload);
      else {
        const creado = await api.createPublication(payload);
        pubId = creado.id;
      }

      if (agendar) {
        // Al re-agendar un evento ya agendado se desarman sus destinos
        // pendientes primero: si no, cada guardado dejaría filas duplicadas
        // para el mismo grupo y se publicaría dos veces. Lo ya publicado no
        // se toca.
        if (destinosPendientes.length) {
          await api.rescheduleAgendaEvent(pubId, { status: 'cancelled' });
        }
        // 2) Los destinos van a `publication_queue`, uno por grupo, TODOS con
        //    la misma hora. Ese es el momento único de publicación.
        await api.addToPubQueue({
          publication_id: pubId,
          group_ids: selIds,
          scheduled_at: isoFecha,
          images: imgs,
        });
      }

      showToast(agendar
        ? `Programada para ${formatDateTime(isoFecha)} en ${selNombres.length} grupo(s)`
        : 'Guardado como material', 'success');
      closeModal(true);
      await cargar();
    } catch (err) {
      showToast(err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = txtBtn; }
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); guardar({ agendar: true }); });
  document.getElementById('plan-material')?.addEventListener('click', () => guardar({ agendar: false }));

  document.getElementById('plan-cancelar')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Desarmar desmarca los destinos pendientes de este evento: deja de publicarse solo y vuelve a ser material. Lo ya publicado no se toca.',
      { title: 'Desarmar publicación', confirmText: 'Desarmar', danger: true }
    );
    if (!ok) return;
    try {
      await api.rescheduleAgendaEvent(ev.id, { status: 'cancelled' });
      showToast('Publicación desarmada', 'success');
      closeModal(true);
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });

  avisosDeb();
}

// ═══════════════════════════ gestionar grupos ════════════════════════════
// La pestaña "Grupos" vivía dentro de la Cola de Publicaciones. Al sacar esa
// sección, la gestión de grupos se abre desde el Planificador.
async function gestionarGrupos() {
  const gs = await api.getGroups().catch(() => []);
  openModal(`
    <div class="modal-header">
      <h2>Gestionar grupos</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="agenda-destinos" id="gr-lista">
        ${gs.length ? gs.map(g => `
          <div class="agenda-destino" data-id="${escAttr(g.id)}">
            <div class="agenda-destino-cuerpo">
              <div class="agenda-destino-nombre" id="gr-nom-${escAttr(g.id)}">${escHtml(g.name)}</div>
              <div class="agenda-destino-notas" id="gr-url-${escAttr(g.id)}">${escHtml(g.url || '')}</div>
            </div>
            <button class="btn btn--sm btn--ghost" style="color:var(--error)" onclick="window._borrarGrupo('${escAttr(g.id)}')">Eliminar</button>
          </div>`).join('')
          : '<div class="empty-state"><h3>No hay grupos</h3><p>Agregá el primero con el formulario de abajo</p></div>'}
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <div class="form-group">
          <label>Nuevo grupo</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="text" id="gr-nombre" class="form-control" placeholder="Nombre del grupo" style="flex:1;min-width:140px" />
            <input type="text" id="gr-url" class="form-control" placeholder="https://facebook.com/groups/..." style="flex:1.4;min-width:190px" />
            <button type="button" class="btn btn--primary btn--sm" id="gr-agregar">Agregar</button>
          </div>
          <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:5px">
            La URL es la que se abre en Chrome para publicar.
          </small>
        </div>
      </div>
    </div>
    <div class="form-actions"><button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button></div>
  `);
  setModalCloseGuard(null);

  document.getElementById('gr-agregar').addEventListener('click', async () => {
    const nombre = document.getElementById('gr-nombre').value.trim();
    const url = document.getElementById('gr-url').value.trim();
    if (!nombre) return showToast('Falta el nombre del grupo', 'warning');
    try {
      const r = await api.createGroup({ name: nombre, url });
      showToast('Grupo agregado', 'success');
      grupos = await api.getGroups().catch(() => grupos);
      closeModal(true);
      gestionarGrupos();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

window._borrarGrupo = async function (id) {
  const ok = await confirmDialog('¿Eliminar este grupo de la lista?', { title: 'Eliminar grupo', danger: true });
  if (!ok) return;
  try {
    await api.deleteGroup(id);
    showToast('Grupo eliminado', 'success');
    grupos = await api.getGroups().catch(() => grupos);
    closeModal(true);
    gestionarGrupos();
  } catch (err) { showToast(err.message, 'error'); }
};

// ════════════════════════════ navegación del calendario ═════════════════

window._agendaNav = function (delta) {
  if (vista === 'semana') ancla.setDate(ancla.getDate() + 7 * delta);
  else ancla = new Date(ancla.getFullYear(), ancla.getMonth() + delta, 1);
  cargar();
};

window._agendaHoy = function () {
  ancla = new Date();
  cargar();
};

window._agendaVista = function (v) {
  vista = v === 'semana' ? 'semana' : 'mes';
  pintar();
};

window._agendaFiltroEstado = function (v) {
  filtroEstado = v || '';
  pintar();
};

window._agendaFiltroGrupo = function (v) {
  filtroGrupo = v || '';
  pintar();
};

window._agendaDetalle = detalle;
window._agendaVerDia = verDia;
/** "+" de una celda: Planificador nuevo con ese día ya puesto. */
window._agendaNuevo = function (fecha) { abrirPlanificador(null, fecha); };

window._abrirPlanificador = function (ev) { abrirPlanificador(ev || null); };
