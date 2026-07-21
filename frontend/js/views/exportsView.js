import { api } from '../db/api.js';
import { openModal, closeModal, showToast, confirmDialog } from '../core/app.js';
import { renderConfig } from './exportsConfigView.js';
import { renderNew } from './exportsNewView.js';

let currentContainer = null;
let currentTab = 'history';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando...</div>';
  try {
    renderPage(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderPage(container) {
  const isConfig = currentTab === 'config';
  const isNew = currentTab === 'new';

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Exportaciones</h1>
          <p>Generá reportes PDF de tus productos</p>
        </div>
      </div>
      <div class="filter-bar" style="gap:4px">
        <button class="btn btn--sm ${currentTab === 'history' ? 'btn--primary' : 'btn--secondary'}" id="tab-history">Historial</button>
        <button class="btn btn--sm ${isNew ? 'btn--primary' : 'btn--secondary'}" id="tab-new">Nueva exportación</button>
        <button class="btn btn--sm ${isConfig ? 'btn--primary' : 'btn--secondary'}" id="tab-config">Configuración</button>
      </div>
      <div id="exports-tab-content"></div>
    </div>
  `;

  document.getElementById('tab-history').addEventListener('click', () => { currentTab = 'history'; renderPage(container); });
  document.getElementById('tab-new').addEventListener('click', () => { currentTab = 'new'; renderPage(container); });
  document.getElementById('tab-config').addEventListener('click', () => { currentTab = 'config'; renderPage(container); });

  const content = document.getElementById('exports-tab-content');

  if (isConfig) {
    renderConfig(content);
  } else if (isNew) {
    renderNew(content, () => { currentTab = 'history'; renderPage(container); });
  } else {
    renderHistory(content);
  }
}

async function renderHistory(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando historial...</div>';
  try {
    const exports = await api.getExports();
    if (exports.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <h3>Sin exportaciones</h3>
          <p>Creá tu primera exportación para generar un PDF</p>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;padding:16px">
        ${exports.map(e => `
          <div class="card" style="padding:16px;display:flex;align-items:center;gap:16px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.9rem">${escHtml(e.title)}</div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
                ${e.product_count} producto(s) · ${e.style === 'list' ? 'Lista detallada' : 'Tabla simple'} · ${formatDate(e.created_at)}
              </div>
            </div>
            <button class="btn btn--sm btn--ghost" onclick="window._deleteExport('${e.id}')" title="Eliminar" style="color:var(--error)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        `).join('')}
      </div>`;

    window._deleteExport = async (id) => {
      if (!await confirmDialog('¿Eliminar esta exportación del historial?', { title: 'Eliminar', danger: true })) return;
      try {
        await api.deleteExport(id);
        showToast('Exportación eliminada', 'success');
        renderHistory(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}
