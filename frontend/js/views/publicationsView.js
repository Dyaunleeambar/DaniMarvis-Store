import { api } from '../db/api.js';
import { openModal, closeModal, setModalCloseGuard, showToast, confirmDialog } from '../core/app.js';
import { navigate } from '../core/router.js';
import { formatDate, debounce } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let currentContainer = null;
let allPublications = [];
let allProducts = [];

const FILTERS_KEY = 'danimarvis_pub_filters';

function loadPubFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}');
    return {
      search: saved.search || '',
      category: saved.category || '',
      provider: saved.provider || '',
      visibility: saved.visibility || '',
    };
  } catch {
    return { search: '', category: '', provider: '', visibility: '' };
  }
}

function savePubFilters(filters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

function truncate(text, len = 120) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

function formatDateInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr.slice(0, 16);
  return d.toISOString().slice(0, 16);
}

function toSqlDatetime(localValue) {
  if (!localValue) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return localValue.replace('T', ' ');
}

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando publicaciones...</div>';

  try {
    const [publications, products] = await Promise.all([
      api.getPublications(),
      api.getProducts({ status: 'active' })
    ]);
    allPublications = publications;
    allProducts = products;
    renderPage(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderPage(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Publicaciones</h1>
          <p>${allPublications.length} publicación(es)</p>
        </div>
      </div>

      <div class="publications-grid" id="publications-grid">
        ${allPublications.length === 0
          ? '<div class="empty-state" style="grid-column:1/-1;padding:48px"><h3>No hay publicaciones</h3><p>Creá tu primera publicación para comenzar</p></div>'
          : allPublications.map((p, idx) => `
            <div class="card publication-card" draggable="true" data-id="${p.id}" data-idx="${idx}">
              <div class="publication-card-drag" title="Arrastrar para reordenar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
              </div>
              ${p.images?.[0]
                ? `<div class="publication-card-img">
                    <img src="${escAttr(p.images[0])}" alt="" />
                  </div>`
                : `<div class="publication-card-img publication-card-img--empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  </div>`
              }
              <div class="publication-card-body">
                <div class="publication-card-title">${escHtml(p.product_name || 'Sin producto')}</div>
                <div class="publication-card-date">${formatDate(p.publication_date || p.created_at)}</div>
                <div class="publication-card-text">${escHtml(truncate(p.publish_text))}</div>
                <div class="publication-card-actions">
                  <button class="btn btn--sm btn--ghost" onclick="window._viewPublication('${p.id}')" title="Ver">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Ver
                  </button>
                  <button class="btn btn--sm btn--ghost" onclick="window._editPublication('${p.id}')" title="Editar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="btn btn--sm btn--ghost" onclick="window._copyPublication('${p.id}')" title="Copiar texto">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="btn btn--sm btn--ghost" onclick="window._publishPublication('${p.id}', 'facebook')" title="Publicar en Facebook" style="color:var(--primary)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                  </button>
                  <button class="btn btn--sm btn--ghost" onclick="window._deletePublication('${p.id}')" title="Eliminar" style="color:var(--error)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          `).join('')
        }
      </div>
      <button class="btn btn--primary btn--fab" onclick="window._openPublicationForm(null)" title="Nueva publicación">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
  `;

  initDragAndDrop();
}

function initDragAndDrop() {
  const grid = document.getElementById('publications-grid');
  if (!grid) return;
  let dragId = null;

  grid.querySelectorAll('.publication-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      dragId = null;
      card.classList.remove('dragging');
      grid.querySelectorAll('.publication-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!dragId || dragId === card.dataset.id) return;
      const fromIdx = allPublications.findIndex(p => p.id === dragId);
      const toIdx = allPublications.findIndex(p => p.id === card.dataset.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = allPublications.splice(fromIdx, 1);
      allPublications.splice(toIdx, 0, moved);
      renderPage(currentContainer);
      try {
        await api.reorderPublications(allPublications.map(p => p.id));
      } catch (err) {
        showToast('Error al reordenar: ' + err.message, 'error');
      }
    });
  });
}

function categoryOptions(selected = '') {
  const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();
  return cats.map(c =>
    `<option value="${escAttr(c)}" ${selected === c ? 'selected' : ''}>${escHtml(c)}</option>`
  ).join('');
}

function providerOptions(selected = '') {
  const providers = [...new Map(allProducts.filter(p => p.provider_id).map(p => [p.provider_id, { id: p.provider_id, name: p.provider_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return providers.map(p =>
    `<option value="${escAttr(p.id)}" ${selected === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
}

window._openPublicationForm = function(pub) {
  const isEdit = !!pub;
  const productOptions = allProducts.map(pr =>
    `<option value="${pr.id}" ${pub?.product_id === pr.id ? 'selected' : ''}>${escHtml(pr.name)}</option>`
  ).join('');

  const currentDate = pub?.publication_date
    ? formatDateInput(pub.publication_date)
    : new Date().toISOString().slice(0, 16);

  openModal(`
    <div class="modal-header">
      <h2>${isEdit ? 'Editar publicación' : 'Nueva publicación'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="publication-form">
      <input type="hidden" name="id" value="${pub?.id || ''}" />
      <div class="form-row" style="grid-template-columns:1fr 1fr">
        <div class="form-group" style="grid-column:1/-1">
          <label>Producto asociado</label>
          <div style="display:flex;gap:8px;margin-bottom:6px">
            <input type="text" id="pub-product-search" class="form-control" placeholder="Buscar producto..." style="flex:1" />
            <select id="pub-product-provider" class="form-control form-control--small" style="max-width:160px">
              <option value="">Todos los proveedores</option>
              ${providerOptions('')}
            </select>
            <select id="pub-product-visibility" class="form-control form-control--small" style="max-width:150px">
              <option value="">Todos</option>
              <option value="1">Visibles</option>
              <option value="0">Ocultos</option>
            </select>
            <select id="pub-product-category" class="form-control form-control--small" style="max-width:160px">
              <option value="">Todas las categorías</option>
              ${categoryOptions('')}
            </select>
          </div>
          <select name="product_id" class="form-control" id="pub-product-select">
            <option value="">Sin producto</option>
            ${productOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Fecha de publicación</label>
          <input type="datetime-local" name="publication_date" class="form-control" value="${currentDate}" />
          <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Elegí la fecha para organizar tus publicaciones</small>
        </div>
      </div>
      <div class="form-group">
        <label>Texto de publicación</label>
        <textarea name="publish_text" class="form-control" id="pub-publish-text" style="min-height:150px">${escHtml(pub?.publish_text || '')}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm btn--secondary" id="pub-btn-generate">
            Generar desde producto
          </button>
          <button type="button" class="btn btn--sm btn--ghost" id="pub-btn-copy">
            Copiar
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>Imágenes de publicación</label>
        <div id="pub-images-thumbs" class="image-thumbnails">
          ${((pub?.images) || []).map(url =>
            `<div class="img-thumb" data-url="${escAttr(url)}">
              <img src="${escAttr(url)}" alt="" />
              <button type="button" class="img-thumb-remove" data-url="${escAttr(url)}">&times;</button>
            </div>`
          ).join('')}
        </div>
        <div class="image-input-row">
          <input type="text" id="pub-image-url-input" class="form-control" placeholder="https://..." />
          <button type="button" class="btn btn--secondary btn--sm" id="pub-btn-add-url">Agregar URL</button>
          <label class="btn btn--secondary btn--sm" style="cursor:pointer;margin:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Subir
            <input type="file" accept="image/*" id="pub-image-file" style="display:none" />
          </label>
        </div>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Agregá URLs o subí archivos. La primera será la portada.</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Guardar cambios' : 'Crear publicación'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('publication-form');
  const initialSnapshot = snapshotForm(form);
  setModalCloseGuard(async () => {
    if (snapshotForm(form) === initialSnapshot) return true;
    return confirmDialog('¿Descartar los cambios sin guardar?', {
      title: 'Cambios sin guardar',
      confirmText: 'Descartar',
      danger: true
    });
  });

  const pubImages = pub?.images ? [...pub.images] : [];
  const thumbsContainer = document.getElementById('pub-images-thumbs');
  const fileInput = document.getElementById('pub-image-file');
  const urlInput = document.getElementById('pub-image-url-input');
  const addUrlBtn = document.getElementById('pub-btn-add-url');

  const searchInput = document.getElementById('pub-product-search');
  const catSelect = document.getElementById('pub-product-category');
  const providerSelect = document.getElementById('pub-product-provider');
  const visibilitySelect = document.getElementById('pub-product-visibility');
  const productSelect = document.getElementById('pub-product-select');

  if (!isEdit) {
    const saved = loadPubFilters();
    searchInput.value = saved.search;
    if (saved.category) catSelect.value = saved.category;
    if (saved.provider) providerSelect.value = saved.provider;
    if (saved.visibility !== '') visibilitySelect.value = saved.visibility;
  }

  function saveFilters() {
    savePubFilters({
      search: searchInput.value,
      category: catSelect.value,
      provider: providerSelect.value,
      visibility: visibilitySelect.value,
    });
  }

  function renderProductSelect() {
    const q = searchInput.value.toLowerCase();
    const cat = catSelect.value;
    const prov = providerSelect.value;
    const vis = visibilitySelect.value;
    const currentVal = productSelect.value;
    const filtered = allProducts.filter(p => {
      if (cat && p.category !== cat) return false;
      if (prov && p.provider_id !== prov) return false;
      if (vis !== '' && String(p.catalog_visible) !== vis) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    productSelect.innerHTML = '<option value="">Sin producto</option>' +
      filtered.map(pr =>
        `<option value="${pr.id}" ${pr.id === currentVal ? 'selected' : ''}>${escHtml(pr.name)}</option>`
      ).join('');
  }

  const debouncedRender = debounce(renderProductSelect, 200);
  searchInput.addEventListener('input', () => {
    debouncedRender();
    saveFilters();
  });
  catSelect.addEventListener('change', () => {
    renderProductSelect();
    saveFilters();
  });
  providerSelect.addEventListener('change', () => {
    renderProductSelect();
    saveFilters();
  });
  visibilitySelect.addEventListener('change', () => {
    renderProductSelect();
    saveFilters();
  });

  renderProductSelect();

  function renderThumbs() {
    thumbsContainer.innerHTML = pubImages.map((url, i) =>
      `<div class="img-thumb" data-url="${escAttr(url)}">
        <img src="${escAttr(url)}" alt="" />
        <button type="button" class="img-thumb-remove" data-url="${escAttr(url)}">&times;</button>
      </div>`
    ).join('');
    thumbsContainer.querySelectorAll('.img-thumb-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = pubImages.indexOf(btn.dataset.url);
        if (idx !== -1) pubImages.splice(idx, 1);
        renderThumbs();
      });
    });
  }

  addUrlBtn?.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) return;
    pubImages.push(url);
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
      pubImages.push(res.url);
      renderThumbs();
      showToast('Imagen subida', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      fileInput.disabled = false;
      fileInput.value = '';
    }
  });

  document.getElementById('pub-btn-generate')?.addEventListener('click', async () => {
    const select = document.getElementById('pub-product-select');
    const productId = select.value;
    if (!productId) {
      showToast('Seleccioná un producto primero', 'warning');
      return;
    }
    try {
      const product = await api.getProduct(productId);
      const textarea = document.getElementById('pub-publish-text');
      if (product.publish_text) {
        textarea.value = product.publish_text;
      } else {
        showToast('El producto no tiene texto de publicación. Usá la IA en Productos.', 'warning');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('pub-btn-copy')?.addEventListener('click', async () => {
    const text = document.getElementById('pub-publish-text')?.value;
    if (!text) {
      showToast('No hay texto para copiar', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copiado al portapapeles', 'success');
    } catch {
      showToast('No se pudo copiar', 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    data.images = pubImages;
    data.publication_date = toSqlDatetime(data.publication_date);

    if (!data.publish_text?.trim()) {
      showToast('El texto de publicación es obligatorio', 'error');
      return;
    }

    try {
      if (pub) {
        await api.updatePublication(pub.id, data);
        showToast('Publicación actualizada', 'success');
      } else {
        await api.createPublication(data);
        showToast('Publicación creada', 'success');
      }
      closeModal(true);
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window._viewPublication = async function(id) {
  try {
    const p = await api.getPublication(id);
    const images = p.images?.length ? p.images : [];
    openModal(`
      <div class="modal-header">
        <h2>${escHtml(p.product_name || 'Publicación')}</h2>
        <button class="modal-close" onclick="closeModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${images.length > 0 ? `
        <div class="publication-detail-gallery">
          ${images.map(url =>
            `<img src="${escAttr(url)}" alt="" class="publication-detail-img" />`
          ).join('')}
        </div>
      ` : ''}
      <div class="publication-detail-info">
        <div class="detail-row">
          <span class="detail-label">Producto</span>
          <span class="detail-value">${escHtml(p.product_name || '—')}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fecha</span>
          <span class="detail-value">${formatDate(p.publication_date || p.created_at)}</span>
        </div>
      </div>
      <div class="publish-text-section">
        <div class="publish-text-label">Texto de publicación</div>
        <div class="publish-text-content" style="white-space:pre-wrap">${escHtml(p.publish_text)}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cerrar</button>
        <button type="button" class="btn btn--primary" id="view-copy-btn">Copiar texto</button>
        <button type="button" class="btn btn--primary" id="view-fb-btn" style="background:#1877f2">Publicar en Facebook</button>
      </div>
    `);
    setModalCloseGuard(null);
    document.getElementById('view-copy-btn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(p.publish_text);
        showToast('Texto copiado', 'success');
      } catch { showToast('No se pudo copiar', 'error'); }
    });
    document.getElementById('view-fb-btn')?.addEventListener('click', () => {
      closeModal(true);
      window._publishPublication(p.id, 'facebook');
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._editPublication = async function(id) {
  try {
    const pub = await api.getPublication(id);
    window._openPublicationForm(pub);
  } catch (err) {
    showToast('Error al cargar publicación', 'error');
  }
};

window._publishPublication = async function(id, platform = 'facebook') {
  const isIg = platform === 'instagram';

  let publications = [];
  let groups = [];
  let settings = null;
  try {
    publications = await api.getPublications();
  } catch { /* continúa con lista vacía */ }
  try {
    groups = await api.getGroups();
  } catch {}
  try {
    settings = await api.getSettings();
  } catch {}

  const defaultPubId = id || publications[0]?.id || '';
  const fbConfig = settings?.publish_config?.facebook || {};

  openModal(`
    <div class="modal-header">
      <h2>${isIg ? 'Publicar en Instagram' : 'Publicar en Facebook'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Publicación</label>
        <select id="pubx-select" class="form-control">
          ${publications.length ? publications.map(p =>
            `<option value="${p.id}" ${p.id === defaultPubId ? 'selected' : ''}>${escHtml(p.product_name || 'Sin producto')} — ${formatDate(p.publication_date || p.created_at)}</option>`
          ).join('') : '<option value="">Sin publicaciones</option>'}
        </select>
      </div>

      ${isIg ? '' : `
      <div class="form-group">
        <label>Grupos de Facebook</label>
        <div id="pubx-groups" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg)">
          ${groups.length ? groups.map(g =>
            `<label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
              <input type="checkbox" value="${g.id}" class="pubx-group-cb" /> ${escHtml(g.name)}
            </label>`
          ).join('') : '<span style="font-size:.78rem;color:var(--text-muted)">No hay grupos registrados. Agregalos en "Gestionar grupos".</span>'}
        </div>
        ${groups.length ? `
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm btn--ghost" id="pubx-select-all">Todos</button>
          <button type="button" class="btn btn--sm btn--ghost" id="pubx-select-none">Ninguno</button>
          <button type="button" class="btn btn--sm btn--secondary" id="pubx-manage-groups">Gestionar grupos</button>
        </div>` : `
        <div style="margin-top:6px">
          <button type="button" class="btn btn--sm btn--secondary" id="pubx-manage-groups">Gestionar grupos</button>
        </div>`}
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:6px">
          Se agenda la publicación en cada grupo elegido. Cuando llegue la hora quedará "Listo para publicar" en la Cola de Publicaciones.
        </small>
      </div>
      `}

      <div class="form-group">
        <label>Programar para (opcional)</label>
        <input type="datetime-local" id="pubx-sched" class="form-control" />
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
          Vacío = los grupos quedan listos ya y la Página se publica de inmediato. Mínimo 10 minutos para programar.
        </small>
      </div>

      ${!isIg ? `
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
          <input type="checkbox" id="pubx-page" /> Publicar también en mi Página (API)
        </label>
        ${fbConfig.page_id && fbConfig.access_token
          ? `<small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
              La publicación sale por API a tu Página (${escHtml(fbConfig.page_id)}). Si programás, la publica Meta solo.
            </small>`
          : `<small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
              Aún no configuraste tu Página. Publicar solo ahí requiere el Page ID y el Access Token.
              <a href="#" id="pubx-go-settings">Configurar en Ajustes</a>.
            </small>`}
      </div>
      ` : ''}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="pubx-submit">${isIg ? 'Publicar' : 'Agendar / Publicar'}</button>
    </div>
  `);

  const selectEl = document.getElementById('pubx-select');
  const schedEl = document.getElementById('pubx-sched');
  const submitBtn = document.getElementById('pubx-submit');

  document.getElementById('pubx-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.pubx-group-cb').forEach(cb => { cb.checked = true; });
  });
  document.getElementById('pubx-select-none')?.addEventListener('click', () => {
    document.querySelectorAll('.pubx-group-cb').forEach(cb => { cb.checked = false; });
  });
  document.getElementById('pubx-manage-groups')?.addEventListener('click', () => {
    closeModal(true);
    navigate('#/pub-queue?tab=groups');
  });
  document.getElementById('pubx-go-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal(true);
    navigate('#/settings');
  });

  submitBtn?.addEventListener('click', async () => {
    if (submitBtn.disabled) return;
    const pubId = selectEl?.value;
    if (!pubId || !publications.some(p => p.id === pubId)) {
      showToast('Elegí una publicación', 'warning');
      return;
    }

    const sched = schedEl?.value || '';
    const iso = sched ? new Date(sched).toISOString() : null;
    const groupIds = [...document.querySelectorAll('.pubx-group-cb:checked')].map(cb => cb.value);
    const doPage = !!document.getElementById('pubx-page')?.checked;
    const hasPageConfig = !!(fbConfig.page_id && fbConfig.access_token);

    if (doPage && !hasPageConfig) {
      showToast('Configurá tu Page ID y Access Token en Ajustes para publicar en la Página', 'warning');
      return;
    }

    if (!groupIds.length && !doPage && !isIg) {
      showToast(hasPageConfig
        ? 'Elegí al menos un grupo, o marcá "Publicar también en mi Página"'
        : 'Elegí al menos un grupo, o configurá tu Página en Ajustes para publicar solo ahí', 'warning');
      return;
    }

    submitBtn.disabled = true;
    try {
      if (groupIds.length) {
        await api.addToPubQueue({
          publication_id: pubId,
          group_ids: groupIds,
          scheduled_at: iso ? iso.slice(0, 19).replace('T', ' ') : null,
        });
        showToast(sched ? `${groupIds.length} grupo(s) agendado(s) para ${new Date(sched).toLocaleString()}` : `${groupIds.length} grupo(s) listos para publicar`, 'success');
      }
      if (doPage) {
        const result = await api.publishPublication(pubId, 'facebook', iso);
        showToast(sched ? 'Página: publicación programada en Meta' : 'Página: publicación realizada', 'success');
        if (result.post_url && !sched) {
          const openIt = await confirmDialog('¿Abrir la publicación?', { title: 'Publicado', confirmText: 'Abrir', danger: false });
          if (openIt) window.open(result.post_url, '_blank');
        }
      }
      closeModal(true);
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
      submitBtn.disabled = false;
    }
  });
};

window._copyPublication = async function(id) {
  try {
    const pub = await api.getPublication(id);
    await navigator.clipboard.writeText(pub.publish_text);
    showToast('Texto copiado al portapapeles', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._deletePublication = async function(id) {
  const ok = await confirmDialog('¿Eliminar esta publicación? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await api.deletePublication(id);
    showToast('Publicación eliminada', 'success');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function snapshotForm(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}
