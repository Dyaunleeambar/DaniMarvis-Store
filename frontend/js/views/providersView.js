import { api } from '../db/api.js';
import { openModal, closeModal, showToast, confirmDialog, refreshSidebarCounts } from '../core/app.js';

let currentContainer = null;
let currentProviders = [];

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando proveedores...</div>';

  try {
    currentProviders = await api.getProviders();
    renderTable(container, currentProviders);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, providers) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Proveedores</h1>
          <p>${providers.length} proveedor(es) registrados</p>
        </div>
        <button class="btn btn--primary" onclick="window._openProviderForm(null)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo proveedor
        </button>
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Contacto</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Comisión %</th>
                <th>Productos</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody>
              ${providers.length === 0
                ? `<tr><td colspan="7"><div class="empty-state" style="padding:32px"><h3>No hay proveedores</h3><p>Registra tu primer proveedor</p></div></td></tr>`
                : providers.map(p => `
                  <tr>
                    <td><span style="font-weight:600">${p.name}</span></td>
                    <td>${p.contact || '—'}</td>
                    <td>${p.phone || '—'}</td>
                    <td>${p.email || '—'}</td>
                    <td>${p.commission_rate > 0 ? p.commission_rate + '%' : '—'}</td>
                    <td><span class="badge badge--${p.product_count > 0 ? 'active' : 'archived'}">${p.product_count}</span></td>
                    <td>
                      <div class="actions-cell">
                        <button class="btn btn--sm btn--ghost" onclick="window._editProvider('${p.id}')" title="Editar">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn btn--sm btn--ghost" onclick="window._deleteProvider('${p.id}')" title="Eliminar" style="color:var(--error)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── Global handlers ───────────────────────────────────────────
window._openProviderForm = function(provider) {
  openModal(`
    <div class="modal-header">
      <h2>${provider ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="provider-form">
      <input type="hidden" name="id" value="${provider?.id || ''}" />
      <div class="form-group">
        <label>Nombre del proveedor *</label>
        <input type="text" name="name" class="form-control" value="${provider?.name || ''}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Persona de contacto</label>
          <input type="text" name="contact" class="form-control" value="${provider?.contact || ''}" />
        </div>
        <div class="form-group">
          <label>Teléfono</label>
          <input type="text" name="phone" class="form-control" value="${provider?.phone || ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" class="form-control" value="${provider?.email || ''}" />
        </div>
        <div class="form-group">
          <label>Comisión (%)</label>
          <input type="number" name="commission_rate" class="form-control" value="${provider?.commission_rate || 0}" min="0" max="100" step="0.5" />
        </div>
      </div>
      <div class="form-group">
        <label>Notas</label>
        <textarea name="notes" class="form-control">${provider?.notes || ''}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${provider ? 'Guardar cambios' : 'Crear proveedor'}</button>
      </div>
    </form>
  `);

  document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.commission_rate = parseFloat(data.commission_rate) || 0;

    try {
      if (provider) {
        await api.updateProvider(provider.id, data);
        showToast('Proveedor actualizado', 'success');
      } else {
        await api.createProvider(data);
        showToast('Proveedor creado', 'success');
      }
      closeModal();
      refreshSidebarCounts();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window._editProvider = async function(id) {
  try {
    const provider = await api.getProvider(id);
    window._openProviderForm(provider);
  } catch (err) {
    showToast('Error al cargar proveedor', 'error');
  }
};

window._deleteProvider = async function(id) {
  const ok = await confirmDialog('¿Eliminar este proveedor? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await api.deleteProvider(id);
    showToast('Proveedor eliminado', 'success');
    refreshSidebarCounts();
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};
