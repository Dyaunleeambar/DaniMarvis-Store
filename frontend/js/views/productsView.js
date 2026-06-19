import { api } from '../db/api.js';
import { loadCached, invalidateCache } from '../services/index.js';
import { formatUSD, debounce, generateId } from '../utils/utils.js';
import { openModal, closeModal, showToast, confirmDialog } from '../core/app.js';

let currentContainer = null;
let currentFilter = {};
let currentProducts = [];
let currentProviders = [];

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando productos...</div>';

  try {
    const [products, providers] = await Promise.all([
      loadCached('products', () => api.getProducts(currentFilter), 'products'),
      api.getProviders(),
    ]);
    currentProducts = products;
    currentProviders = providers;
    renderTable(container, products, providers);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, products, providers) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Productos</h1>
          <p>${products.length} producto(s) registrados</p>
        </div>
        <button class="btn btn--primary" onclick="window._openProductForm(null)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo producto
        </button>
      </div>

      <div class="filter-bar">
        <input type="text" id="filter-search" class="form-control" placeholder="Buscar producto..." />
        <select id="filter-category" class="form-control form-control--small">
          <option value="">Todas las categorías</option>
          <option value="Electrodomésticos">Electrodomésticos</option>
          <option value="Cocina">Cocina</option>
          <option value="Hogar">Hogar</option>
          <option value="Energía">Energía</option>
          <option value="Climatización">Climatización</option>
          <option value="Tecnología">Tecnología</option>
          <option value="Otro">Otro</option>
        </select>
        <select id="filter-status" class="form-control form-control--small">
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="archived">Archivados</option>
        </select>
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Comisión</th>
                <th>Proveedor</th>
                <th>Stock</th>
                <th>Estado</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody>
              ${products.length === 0
                ? `<tr><td colspan="8"><div class="empty-state" style="padding:32px"><h3>No hay productos</h3><p>Crea tu primer producto para comenzar</p></div></td></tr>`
                : products.map(p => `
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        ${p.image_url
                          ? `<img src="${p.image_url}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:4px;background:var(--bg)" />`
                          : `<div style="width:36px;height:36px;border-radius:4px;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                            </div>`
                        }
                        <div>
                          <div style="font-weight:600;font-size:.88rem">${p.name}</div>
                          ${p.warranty ? `<div style="font-size:.72rem;color:var(--text-muted)">Garantía: ${p.warranty}</div>` : ''}
                        </div>
                      </div>
                    </td>
                    <td><span style="font-size:.82rem">${p.category || '—'}</span></td>
                    <td class="amount">${formatUSD(p.price)}</td>
                    <td><span style="font-size:.82rem">${p.commission_value > 0 ? formatUSD(p.commission_value) : '—'}</span></td>
                    <td><span style="font-size:.82rem">${p.provider_name || '—'}</span></td>
                    <td><span style="font-size:.82rem">${p.stock}</span></td>
                    <td><span class="badge badge--${p.status === 'active' ? 'active' : 'archived'}">${p.status}</span></td>
                    <td>
                      <div class="actions-cell">
                        <button class="btn btn--sm btn--ghost" onclick="window._editProduct('${p.id}')" title="Editar">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn btn--sm btn--ghost" onclick="window._deleteProduct('${p.id}')" title="Eliminar" style="color:var(--error)">
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

  // Search/filter
  const searchInput = document.getElementById('filter-search');
  const catSelect = document.getElementById('filter-category');
  const statusSelect = document.getElementById('filter-status');

  const applyFilters = debounce(() => {
    currentFilter = {};
    if (searchInput.value) currentFilter.q = searchInput.value;
    if (catSelect.value) currentFilter.category = catSelect.value;
    if (statusSelect.value) currentFilter.status = statusSelect.value;
    render(currentContainer);
  });

  searchInput.addEventListener('input', applyFilters);
  catSelect.addEventListener('change', applyFilters);
  statusSelect.addEventListener('change', applyFilters);
}

// ── Global handlers ───────────────────────────────────────────
window._openProductForm = function(product) {
  openModal(`
    <div class="modal-header">
      <h2>${product ? 'Editar producto' : 'Nuevo producto'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="product-form">
      <input type="hidden" name="id" value="${product?.id || ''}" />
      <div class="form-group">
        <label>Nombre del producto *</label>
        <input type="text" name="name" class="form-control" value="${product?.name || ''}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Precio (USD) *</label>
          <input type="number" name="price" class="form-control" value="${product?.price || ''}" step="any" required />
        </div>
        <div class="form-group">
          <label>Categoría</label>
          <select name="category" class="form-control">
            <option value="">Seleccionar</option>
            ${['Electrodomésticos','Cocina','Hogar','Energía','Climatización','Tecnología','Otro'].map(c =>
              `<option value="${c}" ${product?.category === c ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Descripción</label>
        <textarea name="description" class="form-control">${product?.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label>Comisión (USD) — valor fijo por unidad</label>
        <input type="number" name="commission_value" class="form-control" value="${product?.commission_value || 0}" min="0" step="any" />
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">Monto fijo en USD que gana el vendedor por cada unidad vendida</small>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Proveedor</label>
          <select name="provider_id" class="form-control">
            <option value="">Sin proveedor</option>
            ${currentProviders.map(pr =>
              `<option value="${pr.id}" ${product?.provider_id === pr.id ? 'selected' : ''}>${pr.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Garantía</label>
          <input type="text" name="warranty" class="form-control" placeholder="Ej: 1 año" value="${product?.warranty || ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Stock</label>
          <input type="number" name="stock" class="form-control" value="${product?.stock || 0}" min="0" />
        </div>
        <div class="form-group">
          <label>URL de imagen</label>
          <input type="url" name="image_url" class="form-control" placeholder="https://..." value="${product?.image_url || ''}" />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${product ? 'Guardar cambios' : 'Crear producto'}</button>
      </div>
    </form>
  `);

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.commission_type = 'fixed';
    data.commission_value = parseFloat(data.commission_value) || 0;

    try {
      if (product) {
        await api.updateProduct(product.id, data);
        showToast('Producto actualizado', 'success');
      } else {
        data.id = generateId();
        await api.createProduct(data);
        showToast('Producto creado', 'success');
      }
      closeModal();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window._editProduct = async function(id) {
  try {
    const product = await api.getProduct(id);
    window._openProductForm(product);
  } catch (err) {
    showToast('Error al cargar producto', 'error');
  }
};

window._deleteProduct = async function(id) {
  const ok = await confirmDialog('¿Eliminar este producto? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await api.deleteProduct(id);
    showToast('Producto eliminado', 'success');
    invalidateCache('products');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};
