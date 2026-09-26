import { api } from '../db/api.js';
import { showToast, confirmDialog } from '../core/app.js';
import { exportRankingsPdf } from '../utils/rankingPdfGenerator.js';

async function exportRankings(blocks) {
  const { ensurePdfLibs } = await import('../utils/libLoader.js');
  await ensurePdfLibs();
  exportRankingsPdf(blocks);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let currentContainer = null;
let refreshing = false;
let currentTab = 'ranking';
let rankMode = 'fecha';

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function formatNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-ES');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function tabsHtml() {
  return `
    <div style="display:flex;gap:8px;margin-bottom:24px">
      <button class="btn ${currentTab === 'ranking' ? 'btn--primary' : ''}" id="tab-ranking">Ranking del día</button>
      <button class="btn ${currentTab === 'historial' ? 'btn--primary' : ''}" id="tab-historial">Historial</button>
      <button class="btn ${currentTab === 'semanal' ? 'btn--primary' : ''}" id="tab-semanal">Semanal</button>
    </div>`;
}

const tableHead = `
  <thead><tr><th>#</th><th>Grupo</th><th>Posts</th><th>Vistas</th><th>Impresiones</th><th>Promedio</th><th>Fecha</th></tr></thead>`;

function rankingRowsHtml(items, startIndex = 0, dateOf) {
  return items.map((g, i) => `
    <tr>
      <td class="cell-num">${startIndex + i + 1}</td>
      <td>${escHtml(g.grupo)}</td>
      <td class="cell-num">${Number(g.posts) || 0}</td>
      <td class="cell-num cell-num--strong">${formatNum(g.vistas)}</td>
      <td class="cell-num">${formatNum(g.impresiones)}</td>
      <td class="cell-num">${formatNum(g.promedio)}</td>
      <td>${escHtml(formatDate(dateOf || g.ultima_fecha || ''))}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-cell">Sin datos</td></tr>';
}

function summaryCardsHtml({ grupos, posts, vistas }) {
  return `
    <div class="pub-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:28px">
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Grupos medidos</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${grupos}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Publicaciones</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${posts}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Visualizaciones totales</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px;color:var(--primary)">${formatNum(vistas)}</div>
      </div>
    </div>`;
}

function groupTableHtml(title, rows, badge) {
  return `
    <div class="section-block">
      <div class="section-heading">
        <h2>${title}</h2>
        ${badge || ''}
      </div>
      <div class="card table-wrap">
        <table class="data-table">${tableHead}<tbody>${rows}</tbody></table>
      </div>
    </div>`;
}

function rankingBlock(fecha, data) {
  return {
    fecha,
    total_groups: data.total_groups,
    total_posts: data.total_posts,
    total_vistas: data.total_vistas,
    top: data.top || [],
    bottom: data.bottom || [],
  };
}

// ---------------- Ranking del día ----------------
async function loadRanking(container, silent) {
  try {
    if (!silent) container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando ranking...</div>';
    const [data, dailySt] = await Promise.all([
      api.getRankings(),
      api.getDailyRanking().catch(() => null),
    ]);
    currentContainer = container;
    data._daily = dailySt;
    container.innerHTML = renderPage(data, dailySt);
    bindActions(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar el ranking')}</p></div>`;
  }
}

function dailyStatusLabel(st) {
  if (!st) return '<span class="badge badge--pending">Estado no disponible</span>';
  const { auto_enabled, time, lastRunDay, outcome } = st;
  const hora = time || '—';
  if (!auto_enabled) return `<span class="badge badge--pending">Job diario desactivado</span>`;
  let badge;
  if (outcome?.ok) {
    badge = `<span class="badge badge--active">${formatDate(outcome.fecha || lastRunDay)}: ok (${Number(outcome.grupos) || 0} grupos)</span>`;
  } else if (outcome?.noBrowser) {
    badge = `<span class="badge badge--pending">Chrome no conectado (puerto 9222) — revisá la Biblioteca</span>`;
  } else if (outcome?.skipped === 'degenerate') {
    badge = `<span class="badge badge--pending">${formatDate(outcome.fecha || lastRunDay)}: corrida incompleta (${Number(outcome.grupos) || 0} grupos) — reintentos agotados por hoy</span>`;
  } else if (outcome && !outcome.ok) {
    badge = `<span class="badge badge--pending">Última corrida falló: ${escHtml((outcome.error || '').slice(0, 90))}</span>`;
  } else {
    badge = `<span class="badge badge--pending">Aún no corrió hoy</span>`;
  }
  return badge;
}

function dailyStatusBanner(st) {
  if (!st) return '';
  const label = dailyStatusLabel(st);
  return `
    <div class="card" style="padding:12px 16px;margin-bottom:24px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px;color:var(--text-secondary)">
      <span>Automatización diaria · ${escHtml(st.time || '—')}${st.auto_enabled ? '' : ' (desactivada)'}</span>
      ${label}
      ${st.lastRunDay ? `<span>Último intento: ${escHtml(formatDate(st.lastRunDay))}</span>` : ''}
    </div>`;
}

function renderPage(data, dailySt) {
  const { total_groups = 0, total_posts = 0, total_vistas = 0, top = [], bottom = [] } = data;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Ranking de grupos</h1>
          <p>Qué grupos devuelven más y menos visualizaciones por publicación</p>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <button class="btn" id="btn-export-ranking">Exportar PDF</button>
          <button class="btn btn--primary" id="btn-refresh-ranking">
            ${refreshing ? 'Actualizando…' : 'Actualizar ranking'}
          </button>
        </div>
      </div>

      ${tabsHtml()}

      ${dailyStatusBanner(data._daily)}

      <div class="card" style="padding:16px;margin-bottom:24px">
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Modo de análisis
            <select id="rank-mode" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
              <option value="fecha" ${rankMode === 'ventana' ? '' : 'selected'}>Fecha específica</option>
              <option value="ventana" ${rankMode === 'ventana' ? 'selected' : ''}>Ventana desde / hasta</option>
            </select>
          </label>
          <label id="field-rank-date" style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Fecha objetivo
            <input id="rank-date" type="date" value="${yesterdayIso()}"
                   style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
          </label>
          <label id="field-rank-desde" style="display:none;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Desde
            <input id="rank-desde" type="date" value="${daysAgoIso(7)}"
                   style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
          </label>
          <label id="field-rank-hasta" style="display:none;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Hasta
            <input id="rank-hasta" type="date" value="${yesterdayIso()}"
                   style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Rango en la Biblioteca
            <select id="rank-range" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
              <option value="28">Últimos 28 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="all">Total</option>
            </select>
          </label>
          <div style="font-size:12px;color:var(--text-secondary);max-width:340px">
            La fecha (o ventana) define qué publicaciones se analizan; el rango solo limita cuántos días atrás mira la Biblioteca para alcanzarlas.
          </div>
        </div>
      </div>

      ${summaryCardsHtml({ grupos: total_groups, posts: total_posts, vistas: total_vistas })}

      ${groupTableHtml('Grupos con MÁS visualizaciones', rankingRowsHtml(top), '<span class="badge badge--active">Top</span>')}
      ${groupTableHtml('Grupos con MENOS visualizaciones', rankingRowsHtml(bottom), '<span class="badge badge--pending">Fondo</span>')}
    </div>`;
}

// ---------------- Historial ----------------
async function loadHistory(container) {
  try {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando historial...</div>';
    const { fechas } = await api.getRankingHistory();
    currentContainer = container;
    if (!fechas.length) {
      container.innerHTML = `
        <div class="page">
          ${tabsHtml()}
          <div class="empty-state" style="padding:48px;text-align:center">
            <h3>Sin historial todavía</h3>
            <p style="color:var(--text-secondary)">Actualizá el ranking al menos una vez y el snapshot del día quedará guardado en la base.</p>
          </div>
        </div>`;
      bindActions(container);
      return;
    }
    container.innerHTML = renderHistoryHub(fechas);
    bindActions(container);
    bindHistory(container, fechas);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar el historial')}</p></div>`;
  }
}

function renderHistoryHub(fechas) {
  const opts = fechas.map(f =>
    `<option value="${f.fecha}">${formatDate(f.fecha)} — ${f.grupos} grupos · ${formatNum(f.vistas)} vistas</option>`
  ).join('');
  const multiRows = fechas.map(f => `
    <tr>
      <td><input type="checkbox" class="hist-check" value="${f.fecha}"></td>
      <td>${escHtml(formatDate(f.fecha))}</td>
      <td class="cell-num">${Number(f.grupos) || 0}</td>
      <td class="cell-num cell-num--strong">${formatNum(f.vistas)}</td>
      <td class="cell-num">${Number(f.posts) || 0}</td>
      <td style="font-size:.85rem;color:var(--text-secondary)">${escHtml(f.actualizado || '')}</td>
    </tr>`).join('');
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Ranking de grupos</h1>
          <p>Historial de snapshots por fecha (1 por día, se reemplaza al re-ejecutar)</p>
        </div>
      </div>

      ${tabsHtml()}

      <div class="card" style="padding:16px;margin-bottom:24px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Fecha del historial
            <select id="hist-date" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
              ${opts}
            </select>
          </label>
          <button class="btn" id="hist-export">Exportar PDF</button>
          <button class="btn btn--danger" id="hist-delete">Eliminar</button>
        </div>
      </div>

      <div id="hist-detail">
        <div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando detalle...</div>
      </div>

      <div class="section-block">
        <div class="section-heading"><h2>Exportar o eliminar varias fechas</h2></div>
        <div class="card table-wrap">
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border)">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px">
              <input type="checkbox" id="hist-select-all"> Seleccionar todas
            </label>
            <button class="btn" id="hist-export-multi">Exportar seleccionadas (0)</button>
            <button class="btn btn--danger" id="hist-delete-multi">Eliminar seleccionadas (0)</button>
          </div>
          <table class="data-table">
            <thead><tr><th>Sel</th><th>Fecha</th><th>Grupos</th><th>Vistas</th><th>Posts</th><th>Actualizado</th></tr></thead>
            <tbody>${multiRows || '<tr><td colspan="6" class="empty-cell">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

async function bindHistory(container, fechas) {
  const dateSel = container.querySelector('#hist-date');
  if (dateSel) {
    dateSel.value = fechas[0]?.fecha || '';
    dateSel.onchange = () => loadHistoryDetail(container, dateSel.value);
  }
  bindHistoryExtra(container, fechas);
  await loadHistoryDetail(container, fechas[0]?.fecha || '');
}

function bindHistoryExtra(container, fechas) {
  const dateSel = container.querySelector('#hist-date');
  const exportBtn = container.querySelector('#hist-export');
  const deleteBtn = container.querySelector('#hist-delete');
  const exportMulti = container.querySelector('#hist-export-multi');
  const deleteMulti = container.querySelector('#hist-delete-multi');
  const selectAll = container.querySelector('#hist-select-all');

  const currentDate = () => (dateSel ? dateSel.value : (fechas[0]?.fecha || ''));

  if (exportBtn) {
    exportBtn.onclick = async () => {
      const fecha = currentDate();
      if (!fecha) return;
      try {
        showToast('Generando PDF…');
        const data = await api.getRankingHistoryDate(fecha);
        await exportRankings([rankingBlock(fecha, data)]);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo exportar', 'error');
      }
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const fecha = currentDate();
      if (!fecha) return;
      const ok = await confirmDialog(`¿Eliminar el snapshot del ${formatDate(fecha)}? Se borran todas las filas de ese día del historial.`, { title: 'Eliminar ranking', confirmText: 'Eliminar' });
      if (!ok) return;
      try {
        await api.deleteRankingHistory(fecha);
        showToast('Ranking eliminado', 'success');
        loadHistory(container);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo eliminar', 'error');
      }
    };
  }

  const selected = () => Array.from(container.querySelectorAll('.hist-check:checked')).map(c => c.value);
  const updateCounts = () => {
    if (exportMulti) exportMulti.textContent = `Exportar seleccionadas (${selected().length})`;
    if (deleteMulti) deleteMulti.textContent = `Eliminar seleccionadas (${selected().length})`;
  };

  if (selectAll) {
    selectAll.onchange = () => {
      container.querySelectorAll('.hist-check').forEach(c => { c.checked = selectAll.checked; });
      updateCounts();
    };
  }
  container.querySelectorAll('.hist-check').forEach(c => { c.onchange = updateCounts; });

  if (exportMulti) {
    exportMulti.onclick = async () => {
      const dates = selected();
      if (!dates.length) { showToast('Seleccioná al menos una fecha', 'error'); return; }
      try {
        showToast('Generando PDF…');
        const blocks = [];
        for (const d of dates) {
          const data = await api.getRankingHistoryDate(d);
          blocks.push(rankingBlock(d, data));
        }
await exportRankings(blocks);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo exportar', 'error');
      }
    };
  }

  if (deleteMulti) {
    deleteMulti.onclick = async () => {
      const dates = selected();
      if (!dates.length) { showToast('Seleccioná al menos una fecha', 'error'); return; }
      const ok = await confirmDialog(`¿Eliminar ${dates.length} snapshot(s) del historial?`, { title: 'Eliminar rankings', confirmText: 'Eliminar' });
      if (!ok) return;
      try {
        for (const d of dates) await api.deleteRankingHistory(d);
        showToast(`${dates.length} snapshot(s) eliminados`, 'success');
        loadHistory(container);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo eliminar', 'error');
      }
    };
  }
}

async function loadHistoryDetail(container, fecha) {
  const detailEl = container.querySelector('#hist-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando detalle...</div>';
  try {
    const data = await api.getRankingHistoryDate(fecha);
    detailEl.innerHTML = renderHistoryDetail(data);
    const groupSel = detailEl.querySelector('#hist-group');
    if (groupSel) {
      groupSel.onchange = async () => {
        const evoEl = detailEl.querySelector('#hist-evolution');
        const name = groupSel.value;
        if (!name) { evoEl.innerHTML = ''; return; }
        evoEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando evolución...</div>';
        try {
          const ev = await api.getRankingHistoryGroup(name);
          evoEl.innerHTML = renderEvolution(ev);
        } catch (err) {
          evoEl.innerHTML = `<p style="color:var(--danger);padding:16px">${escHtml(err.message || 'Error')}</p>`;
        }
      };
    }
  } catch (err) {
    detailEl.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar la fecha')}</p></div>`;
  }
}

function renderHistoryDetail(data) {
  const { fecha, total_groups = 0, total_posts = 0, total_vistas = 0, top = [], bottom = [], grupos } = data;
  const groups = Array.isArray(grupos) && grupos.length ? grupos.map(g => g.grupo) : top.map(g => g.grupo);
  const groupOpts = groups.map(g => `<option value="${escHtml(g)}">${escHtml(g)}</option>`).join('');
  return `
    ${summaryCardsHtml({ grupos: total_groups, posts: total_posts, vistas: total_vistas })}
    ${groupTableHtml('Top 20 — más visualizaciones (' + formatDate(fecha) + ')', rankingRowsHtml(top, 0, fecha), '<span class="badge badge--active">Top</span>')}
    ${groupTableHtml('Bottom 20 — menos visualizaciones (' + formatDate(fecha) + ')', rankingRowsHtml(bottom, 0, fecha), '<span class="badge badge--pending">Fondo</span>')}

    <div class="section-block">
      <div class="section-heading"><h2>Evolución de un grupo</h2></div>
      <div class="card" style="padding:16px">
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary);max-width:420px">
          Grupo
          <select id="hist-group" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
            <option value="">— Seleccioná un grupo —</option>
            ${groupOpts}
          </select>
        </label>
        <div id="hist-evolution" style="margin-top:16px"></div>
      </div>
    </div>`;
}

function renderEvolution(ev) {
  const rows = (ev.puntos || []).map((p, i) => `
    <tr>
      <td class="cell-num">${i + 1}</td>
      <td>${escHtml(formatDate(p.fecha))}</td>
      <td class="cell-num">${Number(p.posts) || 0}</td>
      <td class="cell-num cell-num--strong">${formatNum(p.vistas)}</td>
      <td class="cell-num">${formatNum(p.impresiones)}</td>
      <td class="cell-num">${formatNum(p.promedio)}</td>
      <td>${escHtml(p.grupo)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-cell">Sin datos de este grupo</td></tr>';
  return `
    <div class="card table-wrap">
      <table class="data-table">
        <thead><tr><th>#</th><th>Fecha</th><th>Posts</th><th>Vistas</th><th>Impresiones</th><th>Promedio</th><th>Grupo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------- Semanal ----------------
function deltaBadge(delta, opts = {}) {
  const { labelSuffix = '', sentidoTextoSimple = false } = opts;
  if (delta == null) return '<span class="badge badge--pending">s/previa</span>';
  const abs = Math.abs(delta);
  if (delta > 0) return `<span class="badge" style="background:rgba(34,197,94,.12);color:#22c549">▲ ${abs}% ${labelSuffix}</span>`;
  if (delta < 0) return `<span class="badge" style="background:rgba(244,63,94,.12);color:#f43f5e">▼ ${abs}% ${labelSuffix}</span>`;
  return `<span class="badge badge--pending">= ${abs}%</span>`;
}

function semanalSummaryCards({ grupos, posts, vistas, semanas, dias }) {
  return `
    <div class="pub-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:28px">
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Grupos en la semana</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${grupos}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Publicaciones</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${posts}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Visualizaciones</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px;color:var(--primary)">${formatNum(vistas)}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:12px;color:var(--text-secondary)">Días con datos</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${dias}</div>
      </div>
    </div>`;
}

function renderSemanalHub(semanas, semana = null) {
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Ranking de grupos</h1>
          <p>Comparativa semana a semana desde el historial guardado</p>
        </div>
      </div>

      ${tabsHtml()}

      <div class="card" style="padding:16px;margin-bottom:24px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Semana (lunes a domingo)
            <select id="sem-week" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
              ${semanas.map(s => `<option value="${s.id}">${formatDate(s.inicio)} al ${formatDate(s.fin)}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Grupo para evolución
            <select id="sem-group" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
              <option value="">— Seleccioná un grupo —</option>
            </select>
          </label>
          <button class="btn" id="sem-export">Exportar PDF</button>
        </div>
      </div>

      <div id="sem-detail">
        <div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando semana...</div>
      </div>

      <div id="sem-evolution" style="margin-top:16px"></div>
    </div>`;
}

async function loadSemanal(container) {
  try {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando análisis semanal...</div>';
    const { semanas } = await api.getRankingWeekly();
    currentContainer = container;
    if (!semanas.length) {
      container.innerHTML = `
        <div class="page">
          ${tabsHtml()}
          <div class="empty-state" style="padding:48px;text-align:center">
            <h3>Sin semanas todavía</h3>
            <p style="color:var(--text-secondary)">Cuando el historial tenga al menos una corrida, aquí verás el agregado por semana.</p>
          </div>
        </div>`;
      bindActions(container);
      return;
    }
    container.innerHTML = renderSemanalHub(semanas);
    bindActions(container);
    bindSemanal(container, semanas);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar el análisis semanal')}</p></div>`;
  }
}

async function loadSemanalDetail(container, inicio) {
  const detailEl = container.querySelector('#sem-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando semana...</div>';
  try {
    const data = await api.getRankingWeeklyDetail(inicio);
    detailEl.innerHTML = renderSemanalDetail(data);
  } catch (err) {
    detailEl.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar la semana')}</p></div>`;
  }
}

function semanalRows(groups, startIndex = 0) {
  return groups.map((g, i) => `
    <tr>
      <td class="cell-num">${startIndex + i + 1}</td>
      <td>${escHtml(g.grupo)}</td>
      <td class="cell-num">${Number(g.dias) || 0}</td>
      <td class="cell-num">${Number(g.posts) || 0} ${deltaBadge(g.delta_posts)}</td>
      <td class="cell-num cell-num--strong">${formatNum(g.vistas)} ${deltaBadge(g.delta_vistas)}</td>
      <td class="cell-num">${formatNum(g.impresiones)}</td>
      <td class="cell-num">${formatNum(g.promedio)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-cell">Sin datos</td></tr>';
}

const semanalHead = `
  <thead><tr><th>#</th><th>Grupo</th><th>Días</th><th>Posts (Δ)</th><th>Vistas (Δ vs previa)</th><th>Impresiones</th><th>Promedio</th></tr></thead>`;

function renderSemanalDetail(data) {
  const { semana, total_groups = 0, total_posts = 0, total_vistas = 0, top = [], bottom = [] } = data;
  return `
    ${semanalSummaryCards({ grupos: total_groups, posts: total_posts, vistas: total_vistas, dias: semana?.dias || 0 })}

    <div class="section-block">
      <div class="section-heading"><h2>Comparativa de grupos</h2></div>
      <div class="card table-wrap">
        <table class="data-table">${semanalHead}<tbody>${semanalRows(top)}</tbody></table>
      </div>
    </div>
    <div class="section-block">
      <div class="section-heading"><h2>Menos visualizaciones</h2></div>
      <div class="card table-wrap">
        <table class="data-table">${semanalHead}<tbody>${semanalRows(bottom)}</tbody></table>
      </div>
    </div>`;
}

async function loadSemanalEvolution(container, name) {
  const evoEl = container.querySelector('#sem-evolution');
  if (!evoEl) return;
  evoEl.innerHTML = '';
  if (!name) return;
  evoEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando evolución...</div>';
  try {
    const ev = await api.getRankingWeeklyGroup(name);
    evoEl.innerHTML = renderSemanalEvolution(ev);
  } catch (err) {
    evoEl.innerHTML = `<p style="color:var(--danger);padding:16px">${escHtml(err.message || 'Error')}</p>`;
  }
}

function renderSemanalEvolution(ev) {
  const rows = (ev.puntos || []).map((p, i) => `
    <tr>
      <td class="cell-num">${i + 1}</td>
      <td>${escHtml(formatDate(p.inicio))} → ${escHtml(formatDate(p.fin))}</td>
      <td class="cell-num">${Number(p.dias) || 0}</td>
      <td class="cell-num">${Number(p.posts) || 0}</td>
      <td class="cell-num cell-num--strong">${formatNum(p.vistas)}</td>
      <td class="cell-num">${formatNum(p.impresiones)}</td>
      <td class="cell-num">${formatNum(p.promedio)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-cell">Sin datos de este grupo</td></tr>';
  return `
    <div class="section-block">
      <div class="section-heading"><h2>Evolución semana a semana — ${escHtml(ev.grupo)}</h2></div>
      <div class="card table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Semana</th><th>Días</th><th>Posts</th><th>Vistas</th><th>Impresiones</th><th>Promedio</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function bindSemanal(container, semanas) {
  const weekSel = container.querySelector('#sem-week');
  const groupSel = container.querySelector('#sem-group');
  const exportBtn = container.querySelector('#sem-export');
  if (weekSel) {
    weekSel.value = semanas[0]?.id || '';
    weekSel.onchange = () => loadSemanalDetail(container, weekSel.value);
  }
  if (groupSel) {
    const weeks = semanas.map(s => s.id);
    // población: cargar grupos de la semana más reciente para el selector
    try {
      const grupoSet = new Set();
      for (const inicio of weeks.slice(0, 2)) {
        const d = await api.getRankingWeeklyDetail(inicio);
        (d.top || []).forEach(g => grupoSet.add(g.grupo));
        (d.bottom || []).forEach(g => grupoSet.add(g.grupo));
      }
      groupSel.innerHTML = '<option value="">— Seleccioná un grupo —</option>' +
        [...grupoSet].map(g => `<option value="${escHtml(g)}">${escHtml(g)}</option>`).join('');
    } catch { /* el selector queda vacío */ }
    groupSel.onchange = () => loadSemanalEvolution(container, groupSel.value);
  }
  if (exportBtn) {
    exportBtn.onclick = async () => {
      const inicio = weekSel?.value || semanas[0]?.id;
      if (!inicio) return;
      try {
        showToast('Generando PDF…');
        const data = await api.getRankingWeeklyDetail(inicio);
        await exportRankings([{
          fecha: `${formatDate(data.semana.inicio)} al ${formatDate(data.semana.fin)}`,
          total_groups: data.total_groups,
          total_posts: data.total_posts,
          total_vistas: data.total_vistas,
          top: (data.top || []).map(g => ({ grupo: g.grupo, posts: g.posts, vistas: g.vistas, impresiones: g.impresiones, promedio: g.promedio, ultima_fecha: '' })),
          bottom: (data.bottom || []).map(g => ({ grupo: g.grupo, posts: g.posts, vistas: g.vistas, impresiones: g.impresiones, promedio: g.promedio, ultima_fecha: '' })),
        }]);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo exportar', 'error');
      }
    };
  }
  await loadSemanalDetail(container, semanas[0]?.id || '');
}

// ---------------- acciones ----------------
function bindRankMode(container) {
  const modeSel = container.querySelector('#rank-mode');
  if (!modeSel) return;
  const dateField = container.querySelector('#field-rank-date');
  const desdeField = container.querySelector('#field-rank-desde');
  const hastaField = container.querySelector('#field-rank-hasta');
  const apply = () => {
    rankMode = modeSel.value;
    const dateMode = rankMode === 'fecha';
    if (dateField) dateField.style.display = dateMode ? 'flex' : 'none';
    if (desdeField) desdeField.style.display = dateMode ? 'none' : 'flex';
    if (hastaField) hastaField.style.display = dateMode ? 'none' : 'flex';
  };
  modeSel.onchange = apply;
  apply();
}

function bindActions(container) {
  bindRankMode(container);

  const exportBtn = container.querySelector('#btn-export-ranking');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      try {
        showToast('Generando PDF…');
        const data = await api.getRankings();
        const fecha = (container.querySelector('#rank-date')?.value || '').trim() || data.fecha || '';
        await exportRankings([rankingBlock(fecha, data)]);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo exportar', 'error');
      }
    };
  }

  const btn = container.querySelector('#btn-refresh-ranking');
  if (btn) {
    btn.onclick = async (e) => {
      if (refreshing) return;
      refreshing = true;
      btn.textContent = 'Actualizando…';
      btn.disabled = true;
      try {
        const mode = (container.querySelector('#rank-mode')?.value || 'fecha').trim();
        const range = (container.querySelector('#rank-range')?.value || '').trim();
        let body;
        if (mode === 'ventana') {
          const desde = (container.querySelector('#rank-desde')?.value || '').trim();
          const hasta = (container.querySelector('#rank-hasta')?.value || '').trim();
          body = { range, desde, hasta };
        } else {
          const date = (container.querySelector('#rank-date')?.value || '').trim();
          body = { date, range };
        }
        await api.refreshRankings(body);
        await loadRanking(currentContainer, true);
        showToast('Ranking actualizado', 'success');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Error al actualizar ranking', 'error');
      } finally {
        refreshing = false;
        btn.textContent = 'Actualizar ranking';
        btn.disabled = false;
      }
    };
  }

  const tabRanking = container.querySelector('#tab-ranking');
  const tabHistorial = container.querySelector('#tab-historial');
  const tabSemanal = container.querySelector('#tab-semanal');
  if (tabRanking) {
    tabRanking.onclick = () => {
      currentTab = 'ranking';
      loadRanking(container, false);
    };
  }
  if (tabHistorial) {
    tabHistorial.onclick = () => {
      currentTab = 'historial';
      loadHistory(container);
    };
  }
  if (tabSemanal) {
    tabSemanal.onclick = () => {
      currentTab = 'semanal';
      loadSemanal(container);
    };
  }
}

export function render(container) {
  currentContainer = container;
  if (currentTab === 'historial') {
    loadHistory(container);
  } else if (currentTab === 'semanal') {
    loadSemanal(container);
  } else {
    loadRanking(container, false);
  }
}