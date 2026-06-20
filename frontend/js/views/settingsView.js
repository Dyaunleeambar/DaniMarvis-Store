import { api } from '../db/api.js';
import { showToast, confirmDialog, openModal, closeModal } from '../core/app.js';

let currentContainer = null;
let currentSettings = null;

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando configuración...</div>';

  try {
    const [settings, categories] = await Promise.all([
      api.getSettings(),
      api.getCategories(),
    ]);
    currentSettings = settings;
    renderPage(container, settings, categories);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderPage(container, settings, categories) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Configuración</h1>
          <p>Tipo de cambio y categorías de productos</p>
        </div>
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 16px">Tipo de cambio</h3>
          <form id="settings-form">
            <div class="form-group">
              <label>Tipo de cambio (1 USD = ? MN)</label>
              <input type="number" name="exchange_rate" class="form-control"
                value="${settings.exchange_rate}" min="1" step="1" required />
              <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                Se usa en ventas e imágenes promocionales. Actualízalo según la tasa del día.
              </small>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Guardar</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h3 style="margin:0 0 12px">Info</h3>
          <ul style="font-size:.85rem;color:var(--text-secondary);line-height:1.8;padding-left:16px;margin:0">
            <li>Los precios de productos se ingresan en <strong>USD</strong></li>
            <li>Las comisiones son valores <strong>fijos en USD</strong> por producto</li>
            <li>En ventas, el total y comisión se muestran en USD + MN</li>
            <li>Al renombrar una categoría, los productos asociados se actualizan automáticamente</li>
          </ul>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Categorías de productos</h3>
            <p style="margin:4px 0 0;font-size:.82rem;color:var(--text-secondary)">${categories.length} categoría(s) disponibles en formularios y filtros</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" id="btn-add-category">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva categoría
          </button>
        </div>

        ${categories.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>No hay categorías. Agrega la primera.</p></div>'
          : `<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th style="width:100px">Productos</th>
                    <th style="width:120px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${categories.map(c => `
                    <tr>
                      <td><span style="font-weight:500">${escHtml(c.name)}</span></td>
                      <td><span style="font-size:.82rem;color:var(--text-secondary)">${c.product_count || 0}</span></td>
                      <td>
                        <div class="actions-cell">
                          <button type="button" class="btn btn--sm btn--ghost btn-edit-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Editar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button type="button" class="btn btn--sm btn--ghost btn-delete-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Eliminar" style="color:var(--error)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.exchange_rate = parseFloat(data.exchange_rate);

    try {
      await api.updateSettings(data);
      currentSettings = { exchange_rate: data.exchange_rate };
      showToast('Tipo de cambio actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-add-category')?.addEventListener('click', () => openCategoryForm());
  container.querySelectorAll('.btn-edit-category').forEach(btn => {
    btn.addEventListener('click', () => openCategoryForm(btn.dataset.id, btn.dataset.name));
  });
  container.querySelectorAll('.btn-delete-category').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.id, btn.dataset.name));
  });
}

function openCategoryForm(id = null, name = '') {
  openModal(`
    <div class="modal-header">
      <h2>${id ? 'Editar categoría' : 'Nueva categoría'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="category-form">
      <div class="form-group">
        <label>Nombre *</label>
        <input type="text" name="name" class="form-control" value="${escAttr(name)}" required autofocus />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${id ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>
  `);

  document.getElementById('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const trimmed = new FormData(e.target).get('name').trim();
    if (!trimmed) {
      showToast('El nombre no puede estar vacío', 'error');
      return;
    }

    try {
      if (id) {
        await api.updateCategory(id, { name: trimmed });
        showToast('Categoría actualizada', 'success');
      } else {
        await api.createCategory({ name: trimmed });
        showToast('Categoría creada', 'success');
      }
      closeModal(true);
      const categories = await api.getCategories();
      renderPage(currentContainer, currentSettings, categories);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteCategory(id, name) {
  const ok = await confirmDialog(
    `¿Eliminar la categoría "${name}"? Solo es posible si ningún producto la usa.`,
    { title: 'Eliminar categoría', confirmText: 'Eliminar', danger: true }
  );
  if (!ok) return;

  try {
    await api.deleteCategory(id);
    showToast('Categoría eliminada', 'success');
    const categories = await api.getCategories();
    renderPage(currentContainer, currentSettings, categories);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
