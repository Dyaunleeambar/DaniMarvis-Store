import { api } from '../db/api.js';
import { showToast } from '../core/app.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let currentContainer = null;
let refreshing = false;
let currentTab = 'ranking';

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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

// ---------------- Ranking del día ----------------
async function loadRanking(container, silent) {
  try {
    if (!silent) container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando ranking...</div>';
    const data = await api.getRankings();
    currentContainer = container;
    container.innerHTML = renderPage(data);
    bindActions(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar el ranking')}</p></div>`;
  }
}

function renderPage(data) {
  const { total_groups = 0, total_posts = 0, total_vistas = 0, top = [], bottom = [] } = data;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Ranking de grupos</h1>
          <p>Qué grupos devuelven más y menos visualizaciones por publicación</p>
        </div>
        <button class="btn btn--primary" id="btn-refresh-ranking">
          ${refreshing ? 'Actualizando…' : 'Actualizar ranking'}
        </button>
      </div>

      ${tabsHtml()}

      <div class="card" style="padding:16px;margin-bottom:24px">
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
            Fecha objetivo
            <input id="rank-date" type="date" value="${yesterdayIso()}"
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
          <div style="font-size:12px;color:var(--text-secondary);max-width:320px">
            El lucro del ranking se calcula con las publicaciones de la fecha que elijas; el rango limita cuántos días atrás mira la Biblioteca de Contenido.
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
    bindHistory(container, fechas[0].fecha);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:48px"><h3>Error</h3><p>${escHtml(err.message || 'No se pudo cargar el historial')}</p></div>`;
  }
}

function renderHistoryHub(fechas) {
  const opts = fechas.map(f =>
    `<option value="${f.fecha}">${formatDate(f.fecha)} — ${f.grupos} grupos · ${formatNum(f.vistas)} vistas</option>`
  ).join('');
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
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
          Fecha del historial
          <select id="hist-date" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font:inherit">
            ${opts}
          </select>
        </label>
      </div>

      <div id="hist-detail">
        <div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando detalle...</div>
      </div>
    </div>`;
}

async function bindHistory(container, fecha) {
  const dateSel = container.querySelector('#hist-date');
  if (dateSel) {
    dateSel.onchange = () => loadHistoryDetail(container, dateSel.value);
  }
  await loadHistoryDetail(container, fecha);
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

// ---------------- acciones ----------------
function bindActions(container) {
  const btn = container.querySelector('#btn-refresh-ranking');
  if (btn) {
    btn.onclick = async (e) => {
      if (refreshing) return;
      refreshing = true;
      btn.textContent = 'Actualizando…';
      btn.disabled = true;
      try {
        const date = (container.querySelector('#rank-date')?.value || '').trim();
        const range = (container.querySelector('#rank-range')?.value || '').trim();
        await api.refreshRankings({ date, range });
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
}

export function render(container) {
  currentContainer = container;
  if (currentTab === 'historial') {
    loadHistory(container);
  } else {
    loadRanking(container, false);
  }
}