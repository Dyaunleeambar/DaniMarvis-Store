import { api } from '../db/api.js';
import { showToast, openModal, closeModal, confirmDialog } from '../core/app.js';
import { formatDateTime } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let currentContainer = null;
let currentTab = 'rutinas';
let productsCache = [];
let routinesCache = null;
let workerStatusCache = null;
let refreshInterval = null;

export async function render(container) {
  currentContainer = container;
  const qIndex = window.location.hash.indexOf('?');
  const query = qIndex >= 0 ? window.location.hash.slice(qIndex + 1) : '';
  const params = new URLSearchParams(query);
  currentTab = params.get('tab') === 'logs' ? 'logs' : 'rutinas';

  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando...</div>';
  try {
    renderPage(container);
    return cleanup;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function cleanup() {
  currentContainer = null;
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

export async function refresh() {
  if (currentContainer) renderPage(currentContainer, true);
}

async function loadData() {
  const [routinesRes, products, worker] = await Promise.all([
    api.getPageRoutines(),
    api.getProducts().catch(() => []),
    api.getPageRoutineWorkerStatus().catch(() => null),
  ]);
  routinesCache = routinesRes;
  productsCache = Array.isArray(products) ? products : [];
  workerStatusCache = worker;
  return routinesRes;
}

async function renderPage(container, silent = false) {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    return;
  }

  const { routines, configured } = data;
  const worker = workerStatusCache || {};
  const fb = (await api.getSettings().catch(() => null))?.publish_config?.facebook || {};

  // Arrancar auto-refresh solo en la pestaña de rutinas y si no hay modal abierto
  if (currentTab === 'rutinas' && !refreshInterval) {
    refreshInterval = setInterval(() => {
      if (document.hidden) return;
      renderPage(currentContainer, true).catch(() => {});
    }, 30000);
  }

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Rutinas de Página</h1>
          <p>Publicación automática en tu Página de Facebook vía API oficial de Meta</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn--sm btn--secondary" id="rtn-run-now">Agendar ahora</button>
          <button class="btn btn--sm btn--secondary" id="rtn-test">Probar configuración</button>
          <button class="btn btn--sm btn--secondary" id="rtn-sync-meta">Sincronizar con Meta</button>
          <button class="btn btn--sm btn--primary" id="rtn-new">Nueva rutina</button>
        </div>
      </div>

      <div class="card" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${!configured ? `
            <span class="badge" style="background:var(--error)">Sin conectar</span>
            <span style="font-size:.82rem;color:var(--text-muted)">Página no configurada</span>
          ` : `
            <span class="badge badge--active">Conectada</span>
            <span style="font-size:.82rem;color:var(--text-muted)"> Página ${escHtml(fb.page_id || '')}</span>
          `}
          ${worker.active ? `
            <span class="badge ${worker.running ? 'badge--active' : ''}" title="${worker.running ? 'Ejecutando ciclo...' : 'Inactivo'}">
              ${worker.running ? '▶ Worker activo' : '⏸ Worker detenido'}
            </span>
          ` : `
            <span class="badge" style="background:var(--text-muted)">Worker deshabilitado</span>
          `}
          ${worker.lastRun ? `
            <span style="font-size:.78rem;color:var(--text-muted)">
              Última ejecución: ${new Date(worker.lastRun).toLocaleString('es-ES', { hour12: false })}
            </span>
          ` : `
            <span style="font-size:.78rem;color:var(--text-muted)">Sin ejecuciones todavía</span>
          `}
        </div>
        <div style="display:flex;gap:6px">
          ${worker.active
            ? `<button class="btn btn--sm btn--ghost" id="rtn-worker-stop" title="Detener worker automático">Detener worker</button>`
            : `<button class="btn btn--sm btn--ghost" id="rtn-worker-start" title="Iniciar worker automático">Iniciar worker</button>`}
        </div>
      </div>

      ${!configured ? `
        <div class="card" style="border-color:var(--error)">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <div>
              <h3 style="margin:0">Tu Página aún no está conectada</h3>
              <p style="margin:6px 0 0;font-size:.82rem;color:var(--text-secondary)">
                Para automatizar la publicación necesitás el <strong>Page ID</strong> y el
                <strong>Access Token de larga duración</strong> en
                <a href="#/settings" style="color:var(--rose)">Ajustes → Publicación en Facebook</a>.
                Generá el token desde Facebook Developers con <code>pages_manage_posts</code>. Nada se publica hasta entonces.
              </p>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="filter-bar" style="gap:4px;margin-top:12px">
        <button class="btn btn--sm ${currentTab === 'rutinas' ? 'btn--primary' : 'btn--secondary'}" id="tab-rutinas">Rutinas</button>
        <button class="btn btn--sm ${currentTab === 'logs' ? 'btn--primary' : 'btn--secondary'}" id="tab-logs">Historial de agendado</button>
      </div>

      ${currentTab === 'logs' ? renderLogs() : renderRoutines(routines)}
    </div>
  `;

  bindPageEvents();
}

function formatDateLite(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleDateString('es-ES');
}

function renderRoutines(routines) {
  if (routines.length === 0) {
    return `
      <div class="empty-state">
        <h3>Sin rutinas todavía</h3>
        <p>Crea tu primera rutina: elegí productos y horarios y el sistema agenda cada post en Meta solo.</p>
        <button class="btn btn--primary" id="rtn-new-empty">Crear rutina</button>
      </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
      ${routines.map((r, i) => `
        <div class="card" style="margin-top:0">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="badge ${r.active ? 'badge--active' : ''}" style="cursor:pointer" data-toggle="${r.id}" title="Activar / pausar">
              ${r.active ? 'Activa' : 'Pausada'}
            </span>
            <h3 style="margin:0">${escHtml(r.name)}</h3>
            <span style="font-size:.78rem;color:var(--text-muted)">
              ${(r.products || []).length} producto(s) · ${String(r.times || '').split(',').filter(Boolean).length} horarios · formato ${escHtml(r.format || '4:5')}
            </span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn--sm btn--ghost" data-edit="${r.id}">Editar</button>
              <button class="btn btn--sm btn--ghost" data-delete="${r.id}" style="color:var(--error)">Eliminar</button>
            </span>
          </div>
          <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;font-size:.8rem">
            <div><div style="color:var(--text-muted)">Horarios</div><div>${escHtml(r.times || '')}</div></div>
            <div><div style="color:var(--text-muted)">Antelación</div><div>${r.lead_minutes} min</div></div>
            <div><div style="color:var(--text-muted)">Productos</div><div>${(r.products || []).length === 0 ? 'Todos los activos (rotación)' : (r.products || []).length}</div></div>
            <div><div style="color:var(--text-muted)">Último agendado</div><div>${r.last_scheduled ? `${escHtml(r.last_scheduled.product_name)} · ${escHtml(formatDateLite(r.last_scheduled.scheduled_for))} · <span class="badge ${r.last_scheduled.status === 'scheduled' ? 'badge--active' : ''}">${escHtml(r.last_scheduled.status)}</span>` : '—'}</div></div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function statusBadge(status) {
  const map = {
    scheduled: '<span class="badge badge--active">Programado</span>',
    published: '<span class="badge" style="background:var(--success);color:#fff">Publicado</span>',
    error: '<span class="badge" style="background:var(--error);color:#fff">Error</span>',
    cancelled: '<span class="badge" style="background:var(--text-muted)">Cancelado</span>',
    replaced: '<span class="badge" style="background:var(--text-muted)">Reemplazado</span>',
  };
  return map[status] || `<span class="badge">${escHtml(status)}</span>`;
}

function renderLogs() {
  return `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div>
          <h3 style="margin:0">Historial de agendado</h3>
          <p style="margin:4px 0 0;font-size:.78rem;color:var(--text-muted)">Posts reservados en el agendado nativo de Meta (los publica Meta solo a la hora indicada)</p>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn--sm btn--secondary" id="logs-refresh">Actualizar</button>
          <button class="btn btn--sm btn--secondary" id="logs-sync-meta">Sincronizar Meta</button>
          <button class="btn btn--sm btn--primary" id="logs-run-now">Agendar ahora</button>
        </div>
      </div>
      <div id="logs-body">
        <div style="padding:20px;text-align:center;color:var(--text-muted)">Cargando historial...</div>
      </div>
    </div>`;
}

let logsPage = 0;
const logsPageSize = 50;

async function loadLogs() {
  const bodyEl = document.getElementById('logs-body');
  if (!bodyEl) return;
  try {
    const data = await api.getPageRoutineLogs({ limit: logsPageSize, offset: logsPage * logsPageSize });
    const logs = data.rows || [];
    const total = data.total || 0;

    if (!logs.length) {
      if (logsPage === 0) {
        bodyEl.innerHTML = '<div class="empty-state"><p>Aún no hay agendados. Los próximos slots se reservan automáticamente.</p></div>';
      }
      renderLogsPagination(bodyEl, total, logsPage);
      return;
    }

    bodyEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rutina</th>
              <th>Producto</th>
              <th>Programado para</th>
              <th>Estado</th>
              <th>Imágenes</th>
              <th>Formato</th>
              <th>Meta</th>
              <th>Reintentos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td>${escHtml(l.routine_name || '—')}</td>
                <td>${escHtml(l.product_name || '—')}</td>
                <td>${escHtml(formatDateTime(l.scheduled_for))}</td>
                <td>${statusBadge(l.status)}</td>
                <td>${l.images_count ?? 0}</td>
                <td style="font-size:.72rem;color:var(--text-muted)">${escHtml(l.format || '4:5')}</td>
                <td style="font-size:.72rem;color:var(--text-muted)">${l.meta_post_id ? escHtml(l.meta_post_id) : '—'}</td>
                <td style="font-size:.72rem">${l.retry_count ?? 0}</td>
                <td>
                  ${l.status === 'scheduled'
                    ? `<button class="btn btn--sm btn--ghost" data-cancel="${l.id}" style="color:var(--error)" title="Cancelar en Meta">Cancelar</button>`
                    : l.status === 'error'
                      ? `<button class="btn btn--sm btn--ghost" data-retry="${l.id}" title="Reintentar ahora">Reintentar</button>`
                      : ''}
                </td>
              </tr>
              ${l.error ? `<tr><td colspan="9" style="color:var(--error);font-size:.75rem;padding:4px 8px">⚠ ${escHtml(l.error)}</td></tr>` : ''}
              ${l.meta_status && l.meta_status !== l.status ? `<tr><td colspan="9" style="color:var(--text-muted);font-size:.72rem;padding:4px 8px">Meta reporta: ${escHtml(l.meta_status)} ${l.synced_at ? `· sincronizado ${escHtml(l.synced_at)}` : ''}</td></tr>` : ''}
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    bodyEl.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog('¿Cancelar este post agendado en Meta?');
        if (!ok) return;
        try {
          await api.cancelPageRoutineLog(btn.dataset.cancel);
          showToast('Agendado cancelado', 'success');
          loadLogs();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    bodyEl.querySelectorAll('[data-retry]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog('¿Reintentar este post ahora?');
        if (!ok) return;
        try {
          const result = await api.retryPageRoutineLog(btn.dataset.retry);
          showToast(`Reintento ${result.ok ? 'enviado' : 'fallado'}: ${result.product || ''}`, result.ok ? 'success' : 'error');
          loadLogs();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    renderLogsPagination(bodyEl, total, logsPage);
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderLogsPagination(container, total, page) {
  const totalPages = Math.ceil(total / logsPageSize) || 1;
  const pagination = document.createElement('div');
  pagination.style.cssText = 'margin-top:10px;display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap';
  pagination.innerHTML = `
    <span style="font-size:.78rem;color:var(--text-muted)">Página ${page + 1} de ${totalPages} (${total} registros)</span>
    <button class="btn btn--sm btn--ghost" ${page === 0 ? 'disabled' : ''} data-logspage="${page - 1}">← Anterior</button>
    <button class="btn btn--sm btn--ghost" ${page >= totalPages - 1 ? 'disabled' : ''} data-logspage="${page + 1}">Siguiente →</button>
  `;
  // Remover paginación previa si existe
  const old = container.parentElement?.querySelector('.logs-pagination');
  if (old) old.remove();
  pagination.className = 'logs-pagination';
  container.parentElement?.appendChild(pagination);

  pagination.querySelectorAll('[data-logspage]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      logsPage = Number(btn.dataset.logspage);
      loadLogs();
    });
  });
}

function bindPageEvents() {
  document.getElementById('rtn-new')?.addEventListener('click', () => openRoutineModal());
  document.getElementById('rtn-new-empty')?.addEventListener('click', () => openRoutineModal());
  document.getElementById('rtn-run-now')?.addEventListener('click', onRunNow);
  document.getElementById('logs-run-now')?.addEventListener('click', onRunNow);
  document.getElementById('rtn-test')?.addEventListener('click', onTest);
  document.getElementById('rtn-sync-meta')?.addEventListener('click', onSyncMeta);
  document.getElementById('logs-sync-meta')?.addEventListener('click', onSyncMeta);
  document.getElementById('tab-rutinas')?.addEventListener('click', () => {
    currentTab = 'rutinas';
    navigateTo('#/page-routines');
  });
  document.getElementById('tab-logs')?.addEventListener('click', () => {
    currentTab = 'logs';
    logsPage = 0;
    navigateTo('#/page-routines?tab=logs');
  });
  document.getElementById('logs-refresh')?.addEventListener('click', loadLogs);
  document.getElementById('rtn-worker-start')?.addEventListener('click', onWorkerStart);
  document.getElementById('rtn-worker-stop')?.addEventListener('click', onWorkerStop);

  document.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.toggle;
      const active = el.classList.contains('badge--active');
      try {
        await api.setPageRoutineActive(id, !active);
        showToast(active ? 'Rutina pausada' : 'Rutina activada', 'success');
        render(currentContainer);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const r = (routinesCache?.routines || []).find(x => x.id === el.dataset.edit);
      if (r) openRoutineModal(r);
    });
  });
  document.querySelectorAll('[data-delete]').forEach(el => {
    el.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta rutina? Los agendados futuros se cancelan.');
      if (!ok) return;
      try {
        await api.deletePageRoutine(el.dataset.delete);
        showToast('Rutina eliminada', 'success');
        render(currentContainer);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  if (currentTab === 'logs') loadLogs();
}

function navigateTo(hash) {
  window.location.hash = hash;
}

async function onRunNow() {
  try {
    const summary = await api.runPageRoutineNow();
    if (summary.skipped) {
      showToast(summary.reason || 'Nada que agendar', 'warning');
      return;
    }
    if (summary.error) {
      showToast(summary.error, 'error');
      return;
    }
    showToast(`Agendados: ${summary.planned} · productos: ${summary.totalPosts} · sincronizados: ${summary.synced} · reintentos: ${summary.retried}`, 'success');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onSyncMeta() {
  try {
    const result = await api.syncPageRoutinesMeta();
    showToast(`Sincronizados: ${result.synced} · errores: ${result.errors}`, result.errors === 0 ? 'success' : 'warning');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onWorkerStart() {
  try {
    const result = await api.startPageRoutineWorker();
    showToast(result.started ? 'Worker iniciado' : result.reason, result.started ? 'success' : 'warning');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onWorkerStop() {
  try {
    const result = await api.stopPageRoutineWorker();
    showToast('Worker detenido', 'success');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onTest() {
  const btn = document.getElementById('rtn-test');
  btn.disabled = true;
  try {
    const result = await api.testPageRoutine();
    if (result.valid) {
      openModal(`
        <div class="modal-header">
          <h2>Configuración válida</h2>
          <button class="modal-close" onclick="closeModal()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="font-size:.85rem">
          <p>Token válido para <strong>${escHtml(result.page.user || '')}</strong> (página ${escHtml(result.page.page_id)}).</p>
          ${result.page.token_expires_at ? `<p>El token vence el ${escHtml(result.page.token_expires_at)}.</p>` : ''}
          <p>Rutina de prueba: <strong>${escHtml(result.routine.name)}</strong> — horarios ${escHtml(result.routine.times.join(', '))}</p>
          <p>Slots próximos que se van a agendar en Meta:</p>
          <ul style="margin:0;padding-left:20px">
            ${result.pending_slots.length ? result.pending_slots.map(s => `<li>${escHtml(s)}</li>`).join('') : '<li>(ninguno: todos ya reservados)</li>'}
          </ul>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button>
        </div>
      `);
    } else {
      showToast(result.error || 'Revisá la configuración', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function openRoutineModal(routine) {
  const isEdit = !!routine;
  const products = productsCache.filter(p => p.status === 'active' || isEdit);
  const selected = new Set(routine?.products || []);

  openModal(`
    <div class="modal-header">
      <h2>${isEdit ? 'Editar rutina' : 'Nueva rutina de Página'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Nombre de la rutina</label>
        <input type="text" id="rtn-name" class="form-control" value="${escAttr(routine?.name || '')}" placeholder="Ej: Rutina diaria 3 posts" />
      </div>
      <div class="form-group">
        <label>Horarios (HH:MM, separados por coma)</label>
        <input type="text" id="rtn-times" class="form-control" value="${escAttr(routine?.times || '09:00,13:30,18:00')}" />
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Se repiten a diario. Horarios duplicados se ignoran automáticamente.</small>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Antelación mínima (min)</label>
          <input type="number" id="rtn-lead" class="form-control" value="${routine?.lead_minutes || 20}" min="11" />
        </div>
        <div class="form-group">
          <label>Formato de imagen</label>
          <select id="rtn-format" class="form-control">
            ${['4:5', '1:1', '9:16'].map(f => `<option value="${f}" ${(routine?.format || '4:5') === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
          <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Formato usado al agendar el post en Meta.</small>
        </div>
      </div>
      <div class="form-group">
        <label>Productos</label>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg)">
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
            <input type="radio" name="rtn-prod-mode" value="all" ${selected.size === 0 ? 'checked' : ''} /> Todos los productos activos (rotación automática)
          </label>
          ${products.map(p => `
            <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
              <input type="checkbox" class="rtn-prod" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''} /> ${escHtml(p.name)}
            </label>
          `).join('')}
        </div>
        ${products.length === 0 ? '<small style="color:var(--text-muted);font-size:.75rem">No hay productos todavía.</small>' : ''}
      </div>
      <div class="form-group">
        <label>Texto personalizado (opcional)</label>
        <textarea id="rtn-text" class="form-control" style="min-height:110px;font-size:.82rem" placeholder='Usa {NAME} {PRICE} {DESCRIPTION} {WARRANTY}'>${escHtml(routine?.default_text || '')}</textarea>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
          Vacío = usa el texto público del producto. Plantilla de Ajustes disponible si el producto no tiene texto.
        </small>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="rtn-save">${isEdit ? 'Guardar cambios' : 'Crear rutina'}</button>
    </div>
  `);

  const radioAll = document.querySelector('input[name="rtn-prod-mode"][value="all"]');
  const cbs = [...document.querySelectorAll('.rtn-prod')];
  const syncRadios = () => {
    if (radioAll) radioAll.checked = cbs.every(c => !c.checked) && selected.size === 0;
  };
  cbs.forEach(cb => cb.addEventListener('change', syncRadios));

  document.getElementById('rtn-save').addEventListener('click', async () => {
    const name = document.getElementById('rtn-name').value.trim();
    const times = document.getElementById('rtn-times').value.trim();
    if (!name) return showToast('Poné un nombre a la rutina', 'warning');
    if (!times) return showToast('Indicá al menos un horario', 'warning');

    const checked = cbs.filter(c => c.checked).map(c => c.value);
    const useAll = radioAll?.checked && checked.length === 0;
    const payload = {
      name,
      times,
      lead_minutes: Number(document.getElementById('rtn-lead').value) || 20,
      format: document.getElementById('rtn-format').value,
      default_text: document.getElementById('rtn-text').value,
      products: useAll ? [] : checked,
      active: isEdit ? routine.active : 1,
    };

    const saveBtn = document.getElementById('rtn-save');
    saveBtn.disabled = true;
    try {
      if (isEdit) await api.updatePageRoutine(routine.id, payload);
      else await api.createPageRoutine(payload);
      showToast(isEdit ? 'Rutina guardada' : 'Rutina creada', 'success');
      closeModal(true);
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
      saveBtn.disabled = false;
    }
  });
}
