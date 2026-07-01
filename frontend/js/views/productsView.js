import { api } from '../db/api.js';
import { fetchProducts, invalidateProductsCache } from '../services/index.js';
import { formatUSD, debounce, generateId } from '../utils/utils.js';
import { openModal, closeModal, setModalCloseGuard, showToast, confirmDialog, refreshSidebarCounts } from '../core/app.js';

let currentContainer = null;
let currentFilter = {};
let allProducts = [];
let currentProviders = [];
let currentCategories = [];

function categoryOptions(selected = '') {
  return currentCategories.map(c =>
    `<option value="${escAttr(c.name)}" ${selected === c.name ? 'selected' : ''}>${escAttr(c.name)}</option>`
  ).join('');
}

function filterProducts(products, filter) {
  return products.filter(p => {
    if (filter.category && p.category !== filter.category) return false;
    if (filter.status && p.status !== filter.status) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      if (!name.includes(q) && !desc.includes(q)) return false;
    }
    return true;
  });
}

function hasActiveFilter(filter) {
  return !!(filter.q || filter.category || filter.status);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function formatDescription(text) {
  const parts = text.split(/\s*(?:💥|🔹|•|\n)\s*/).filter(Boolean);
  if (parts.length <= 1) return escHtml(text);
  return parts.map(p => `<div class="desc-line">${escHtml(p)}</div>`).join('');
}

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando productos...</div>';

  try {
    const [products, providers, categories] = await Promise.all([
      fetchProducts(),
      api.getProviders(),
      api.getCategories(),
    ]);
    allProducts = products;
    currentProviders = providers;
    currentCategories = categories;
    renderTable(container, filterProducts(allProducts, currentFilter), providers);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, products, providers) {
  const filtered = hasActiveFilter(currentFilter);
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Productos</h1>
          <p>${filtered
            ? `${products.length} producto(s) encontrados de ${allProducts.length}`
            : `${products.length} producto(s) registrados`}</p>
        </div>
        <button class="btn btn--primary" onclick="window._openProductForm(null)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo producto
        </button>
      </div>

      <div class="filter-bar">
        <input type="text" id="filter-search" class="form-control" placeholder="Buscar producto..." value="${escAttr(currentFilter.q)}" />
        <select id="filter-category" class="form-control form-control--small">
          <option value="">Todas las categorías</option>
          ${categoryOptions(currentFilter.category)}
        </select>
        <select id="filter-status" class="form-control form-control--small">
          <option value="">Todos los estados</option>
          <option value="active" ${currentFilter.status === 'active' ? 'selected' : ''}>Activos</option>
          <option value="archived" ${currentFilter.status === 'archived' ? 'selected' : ''}>Archivados</option>
        </select>
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:40px">#</th>
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
                ? `<tr><td colspan="9"><div class="empty-state" style="padding:32px"><h3>${filtered ? 'Sin resultados' : 'No hay productos'}</h3><p>${filtered ? 'Prueba con otros filtros o términos de búsqueda' : 'Crea tu primer producto para comenzar'}</p></div></td></tr>`
                : products.map((p, i) => `
                  <tr>
                    <td><span style="color:var(--text-muted);font-size:.8rem">${i + 1}</span></td>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        ${p.images?.[0]
                          ? `<img src="${p.images[0]}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:4px;background:var(--bg)" />`
                          : `<div style="width:36px;height:36px;border-radius:4px;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                            </div>`
                        }
                          <div>
                            <div style="font-weight:600;font-size:.88rem;cursor:pointer;color:var(--rose)" onclick="window._viewProduct('${p.id}')">${p.name}</div>
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
                        <button class="btn btn--sm btn--ghost" onclick="window._toggleVisibility('${p.id}', this)" title="${p.catalog_visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" style="color:${p.catalog_visible ? 'var(--success)' : 'var(--text-muted)'}">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${p.catalog_visible
                            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}
                          </svg>
                        </button>
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
    const searchHadFocus = document.activeElement === searchInput;
    const cursorPos = searchHadFocus ? searchInput.selectionStart : 0;

    currentFilter = {};
    if (searchInput.value.trim()) currentFilter.q = searchInput.value.trim();
    if (catSelect.value) currentFilter.category = catSelect.value;
    if (statusSelect.value) currentFilter.status = statusSelect.value;
    renderTable(currentContainer, filterProducts(allProducts, currentFilter), currentProviders);

    if (searchHadFocus) {
      const input = document.getElementById('filter-search');
      input.focus();
      input.setSelectionRange(cursorPos, cursorPos);
    }
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
            ${categoryOptions(product?.category)}
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
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0">
            <input type="checkbox" name="catalog_visible" value="1" ${product?.catalog_visible !== 0 ? 'checked' : ''} style="width:16px;height:16px" />
            Mostrar en catálogo público
          </label>
        </div>
        <div class="form-group">
          <label>Imágenes</label>
          <div id="product-images-thumbs" class="image-thumbnails">
            ${(product?.images || []).map(url =>
              `<div class="img-thumb" data-url="${escAttr(url)}">
                <img src="${escAttr(url)}" alt="" />
                <button type="button" class="img-thumb-remove" data-url="${escAttr(url)}">&times;</button>
              </div>`
            ).join('')}
          </div>
          <div class="image-input-row">
            <input type="text" id="product-image-url-input" class="form-control" placeholder="https://..." />
            <button type="button" class="btn btn--secondary btn--sm" id="btn-add-image-url">Agregar</button>
            <label class="btn btn--secondary btn--sm" style="cursor:pointer;margin:0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Subir
              <input type="file" accept="image/*" id="product-image-file" style="display:none" />
            </label>
          </div>
          <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Agregá URLs o subí archivos. La primera imagen es la principal.</small>
        </div>
      </div>
      <div class="form-group">
        <label>URL de referencia (ficha del producto)</label>
        <input type="url" name="image_url" class="form-control" placeholder="https://..." value="${product?.image_url || ''}" />
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Enlace a la página web con la descripción completa del producto</small>
      </div>
      <div class="form-group">
        <label>Texto de publicación</label>
        <textarea name="publish_text" class="form-control" placeholder="Copiado para WhatsApp, Facebook, etc." style="min-height:120px">${escHtml(product?.publish_text || '')}</textarea>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Texto formateado para compartir en redes o mensajería</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${product ? 'Guardar cambios' : 'Crear producto'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('product-form');
  const initialSnapshot = snapshotForm(form);

  setModalCloseGuard(async () => {
    if (snapshotForm(form) === initialSnapshot) return true;
    return confirmDialog('¿Descartar los cambios sin guardar?', {
      title: 'Cambios sin guardar',
      confirmText: 'Descartar',
      danger: true,
    });
  });

  const productImages = product?.images ? [...product.images] : [];
  const thumbsContainer = document.getElementById('product-images-thumbs');
  const fileInput = document.getElementById('product-image-file');
  const urlInput = document.getElementById('product-image-url-input');
  const addUrlBtn = document.getElementById('btn-add-image-url');

  function renderThumbs() {
    thumbsContainer.innerHTML = productImages.map(url =>
      `<div class="img-thumb" data-url="${escAttr(url)}">
        <img src="${escAttr(url)}" alt="" />
        <button type="button" class="img-thumb-remove" data-url="${escAttr(url)}">&times;</button>
      </div>`
    ).join('');
    thumbsContainer.querySelectorAll('.img-thumb-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = productImages.indexOf(btn.dataset.url);
        if (idx !== -1) productImages.splice(idx, 1);
        renderThumbs();
      });
    });
  }

  addUrlBtn?.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) return;
    productImages.push(url);
    urlInput.value = '';
    renderThumbs();
  });

  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrlBtn?.click();
    }
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      fileInput.disabled = true;
      const res = await api.uploadImage(file);
      productImages.push(res.url);
      renderThumbs();
      showToast('Imagen subida', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      fileInput.disabled = false;
      fileInput.value = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    data.commission_type = 'fixed';
    data.commission_value = parseFloat(data.commission_value) || 0;
    data.images = productImages;

    try {
      if (product) {
        await api.updateProduct(product.id, data);
        showToast('Producto actualizado', 'success');
      } else {
        data.id = generateId();
        await api.createProduct(data);
        showToast('Producto creado', 'success');
      }
      await invalidateProductsCache();
      closeModal(true);
      refreshSidebarCounts();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

function snapshotForm(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}

window._editProduct = async function(id) {
  try {
    const product = await api.getProduct(id);
    window._openProductForm(product);
  } catch (err) {
    showToast('Error al cargar producto', 'error');
  }
};

window._viewProduct = async function(id) {
  try {
    const p = await api.getProduct(id);
    const images = p.images?.length ? p.images : [];
    openModal(`
      <div class="modal-header">
        <h2>${escHtml(p.name)}</h2>
        <button class="modal-close" onclick="closeModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="product-detail">
        <div class="product-detail-gallery">
          ${images.length > 0
            ? `
              <div class="gallery-main">
                <img src="${escAttr(images[0])}" alt="${escAttr(p.name)}" id="gallery-main-img" />
              </div>
              ${images.length > 1 ? `
                <div class="gallery-thumbs" id="gallery-thumbs">
                  ${images.map((url, i) =>
                    `<img src="${escAttr(url)}" alt="" class="gallery-thumb${i === 0 ? ' active' : ''}" data-index="${i}" />`
                  ).join('')}
                </div>
              ` : ''}
            `
            : `<div class="product-detail-image--empty" style="width:100%;padding:48px;text-align:center">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 8px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                <span style="color:var(--text-muted);font-size:.85rem">Sin imagen</span>
              </div>`
          }
        </div>
        <div class="product-detail-info">
          <div class="detail-row">
            <span class="detail-label">Precio</span>
            <span class="detail-value">${formatUSD(p.price)}</span>
          </div>
          ${p.category ? `<div class="detail-row"><span class="detail-label">Categoría</span><span class="detail-value">${escHtml(p.category)}</span></div>` : ''}
          ${p.description ? `<div class="detail-row detail-row--col"><span class="detail-label">Descripción</span><div class="detail-text">${formatDescription(p.description)}</div></div>` : ''}
          <div class="detail-row">
            <span class="detail-label">Comisión</span>
            <span class="detail-value">${p.commission_value > 0 ? formatUSD(p.commission_value) + ' / ud.' : '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Stock</span>
            <span class="detail-value">${p.stock}</span>
          </div>
          ${p.provider_name ? `<div class="detail-row"><span class="detail-label">Proveedor</span><span class="detail-value">${escHtml(p.provider_name)}</span></div>` : ''}
          ${p.warranty ? `<div class="detail-row"><span class="detail-label">Garantía</span><span class="detail-value">${escHtml(p.warranty)}</span></div>` : ''}
          <div class="detail-row">
            <span class="detail-label">Estado</span>
            <span class="detail-value"><span class="badge badge--${p.status === 'active' ? 'active' : 'archived'}">${p.status}</span></span>
          </div>
          ${p.image_url ? `<div class="detail-row">
            <span class="detail-label">Ficha</span>
            <span class="detail-value"><a href="${escAttr(p.image_url)}" target="_blank" rel="noopener" class="btn btn--sm btn--primary" style="display:inline-flex">Ver ficha completa</a></span>
          </div>` : ''}
        </div>
      </div>
      ${p.publish_text ? `<div class="publish-text-section">
        <div class="publish-text-label">Texto de publicación</div>
        <div class="publish-text-content">${escHtml(p.publish_text)}</div>
      </div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button>
      </div>
    `);

    setModalCloseGuard(null);

    const galleryImg = document.getElementById('gallery-main-img');
    if (galleryImg) {
      galleryImg.addEventListener('click', () => {
        if (!images.length) return;
        const currentSrc = galleryImg.getAttribute('src');
        const idx = images.indexOf(currentSrc);
        window._openLightbox(images, idx >= 0 ? idx : 0);
      });

      const thumbs = document.querySelectorAll('.gallery-thumb');
      thumbs.forEach(thumb => {
        thumb.addEventListener('click', () => {
          const idx = parseInt(thumb.dataset.index);
          galleryImg.style.opacity = '0';
          setTimeout(() => {
            galleryImg.setAttribute('src', images[idx]);
            galleryImg.style.opacity = '1';
          }, 120);
          thumbs.forEach(t => t.classList.remove('active'));
          thumb.classList.add('active');
        });
      });
    }
  } catch (err) {
    showToast('Error al cargar producto', 'error');
  }
};

window._openLightbox = function(images, startIdx = 0) {
  let currentIdx = startIdx;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <button class="lightbox-close">&times;</button>
    ${images.length > 1 ? '<button class="lightbox-nav lightbox-prev">&lsaquo;</button><button class="lightbox-nav lightbox-next">&rsaquo;</button>' : ''}
    <div class="lightbox-image-wrap">
      <img src="${escAttr(images[currentIdx])}" alt="" class="lightbox-image" />
    </div>
    <div class="lightbox-counter">${currentIdx + 1} / ${images.length}</div>
  `;

  const img = overlay.querySelector('.lightbox-image');
  const counter = overlay.querySelector('.lightbox-counter');

  function destroy() {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }

  function showImage(i) {
    currentIdx = i;
    img.src = images[currentIdx];
    if (counter) counter.textContent = `${currentIdx + 1} / ${images.length}`;
  }

  function onKey(e) {
    if (e.key === 'Escape') destroy();
    if (e.key === 'ArrowLeft') showImage((currentIdx - 1 + images.length) % images.length);
    if (e.key === 'ArrowRight') showImage((currentIdx + 1) % images.length);
  }

  const prev = overlay.querySelector('.lightbox-prev');
  const next = overlay.querySelector('.lightbox-next');
  if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); showImage((currentIdx - 1 + images.length) % images.length); });
  if (next) next.addEventListener('click', (e) => { e.stopPropagation(); showImage((currentIdx + 1) % images.length); });

  overlay.addEventListener('click', destroy);
  img.addEventListener('click', (e) => e.stopPropagation());
  overlay.querySelector('.lightbox-close')?.addEventListener('click', destroy);

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
};

window._toggleVisibility = async function(id, btn) {
  try {
    const res = await api.toggleVisibility(id);
    btn.title = res.catalog_visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo';
    btn.style.color = res.catalog_visible ? 'var(--success)' : 'var(--text-muted)';
    btn.innerHTML = res.catalog_visible
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    showToast(res.catalog_visible ? 'Producto visible en catálogo' : 'Producto oculto del catálogo', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._deleteProduct = async function(id) {
  const ok = await confirmDialog('¿Eliminar este producto? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    const res = await api.deleteProduct(id);
    showToast(res.message, 'success');
    await invalidateProductsCache();
    refreshSidebarCounts();
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};
