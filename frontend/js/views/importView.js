import { api } from '../db/api.js';
import { showToast, openModal, confirmDialog, refreshSidebarCounts } from '../core/app.js';
import { invalidateProductsCache } from '../services/index.js';
import { openProductForm } from './productsView.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const EYE_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function suggestName(text) {
  const line = String(text || '').split('\n').map(l => l.trim()).find(l => l && !/^[💥✨‼️⭐🎁▪️•*#]/u.test(l));
  if (!line) return '';
  return line.replace(/^[💥✨‼️⭐🎁▪️•*#\s]+/u, '').replace(/\s+/g, ' ').slice(0, 80);
}

function updateEyeIcon(btn, visible) {
  btn.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
  btn.title = visible ? 'Visible en catálogo. Clic para ocultar.' : 'Oculto del catálogo. Clic para mostrar.';
  btn.setAttribute('aria-label', visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo');
  btn.setAttribute('aria-pressed', String(visible));
  btn.style.color = visible ? 'var(--success)' : 'var(--text-muted)';
}

function openImportImagePreview(url, name = '') {
  openModal(`
    <div class="modal-header">
      <h2>Vista previa${name ? `: ${escHtml(name)}` : ''}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div style="display:flex;justify-content:center;padding:8px 0 0">
      <img src="${escAttr(url)}" alt="${escAttr(name || 'Vista previa')}" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain" />
    </div>
  `);
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    modalContent.style.maxWidth = '90vw';
    modalContent.style.maxHeight = '90vh';
  }
}

const FOLDER_KEY = 'danimarvis_import_folder';
const PROVIDER_KEY = 'danimarvis_import_provider';
const ENGINE_KEY = 'danimarvis_import_engine';

function sanitizeFolderName(name) {
  return String(name || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|$/g, '');
}

function getProviderFolder(providerName) {
  return `D:\\Proyectos\\DaniMarvisStore\\precios-importacion\\${sanitizeFolderName(providerName)}`;
}

export async function renderImport(container) {
  const appShell = document.getElementById('app-shell');
  appShell?.classList.remove('import-focus');
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando...</div>';
  let cleanupForm = () => {};
  try {
    const providers = await api.getProviders();
    cleanupForm = renderForm(container, providers);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escHtml(err.message)}</p></div>`;
  }
  return () => {
    cleanupForm();
    appShell?.classList.remove('import-focus');
  };
}

function renderForm(container, providers) {
  let providerId = localStorage.getItem(PROVIDER_KEY) || providers[0]?.id || '';
  const selectedProvider = providers.find(p => p.id === providerId);
  const folder = localStorage.getItem(FOLDER_KEY) || (selectedProvider ? getProviderFolder(selectedProvider.name) : '');
  let engine = localStorage.getItem(ENGINE_KEY) || 'local';
  let busy = false;

  container.innerHTML = `
    <div class="page import-page">
      <div class="page-header">
        <div>
          <h1>Importar / Sincronizar</h1>
          <p>Actualizá precios y disponibilidad desde las imágenes que publica el proveedor</p>
        </div>
      </div>

      <div class="card import-config" style="padding:20px;max-width:760px">
        <h3 class="import-config-title" style="margin:0 0 4px;font-size:1rem">Lista del proveedor</h3>
        <p class="import-instructions" style="margin:0 0 16px;font-size:.8rem;color:var(--text-secondary)">
          1) Elegí el proveedor y la carpeta donde guardaste las imágenes (una por producto).<br />
          2) Carga las imágenes y crea las carpetas para las categorías registradas.<br />
          3) En modo maximizado, usa <b>Vista por categoría</b> para arrastrar las imágenes a sus carpetas. Las carpetas y las imágenes clasificadas no se borran automáticamente.<br />
          4) Selecciona una categoría en el carrusel y analiza individualmente las imágenes que necesites. Revisa y aplica los resultados; con el botón <b>+</b> creas un producto nuevo desde una imagen.
        </p>
        <div class="import-config-fields" style="display:flex;flex-direction:column;gap:12px">
          <div class="import-config-field">
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Proveedor</label>
            <select id="imp-provider" class="form-control">
              ${providers.map(p => `<option value="${p.id}" ${p.id === providerId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="import-config-field">
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Carpeta con las imágenes</label>
            <input type="text" id="imp-folder" class="form-control" value="${escHtml(folder)}" />
          </div>
          <div class="import-config-field import-engine-field">
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Motor de lectura</label>
            <select id="imp-engine" class="form-control">
              <option value="local" ${engine === 'local' ? 'selected' : ''}>Local (OCR, sin internet)</option>
              <option value="vision" ${engine === 'vision' ? 'selected' : ''}>IA · visión (varios productos por imagen)</option>
            </select>
            <p class="import-engine-note" style="margin:4px 0 0;font-size:.72rem;color:var(--text-muted)">
              IA usa la API de Ajustes &gt; Publicaciones y necesita un modelo con visión. Es más preciso y detecta varios productos en una misma foto.
            </p>
          </div>
          <div class="import-config-actions" style="display:flex;align-items:center;gap:10px">
            <button class="btn btn--primary" id="imp-analyze">Cargar imágenes</button>
            <span id="imp-status" style="font-size:.78rem;color:var(--text-muted)"></span>
          </div>
        </div>
      </div>

      <div id="imp-results" class="import-view" style="margin-top:16px"></div>
    </div>
  `;

  const appShell = document.getElementById('app-shell');
  const importPage = container.querySelector('.import-page');
  const topbarActions = document.querySelector('.topbar-actions');
  const storeLink = topbarActions?.querySelector('a[title="Ver tienda"]');
  const categoryToggle = document.createElement('button');
  categoryToggle.id = 'imp-category-toggle';
  categoryToggle.type = 'button';
  categoryToggle.className = 'btn btn--sm btn--ghost import-category-toggle';
  categoryToggle.hidden = true;
  categoryToggle.title = 'Vista por categoría';
  categoryToggle.setAttribute('aria-label', 'Vista por categoría');
  categoryToggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>';
  const focusToggle = document.createElement('button');
  focusToggle.id = 'imp-focus-toggle';
  focusToggle.type = 'button';
  focusToggle.className = 'btn btn--sm btn--ghost import-focus-toggle';
  focusToggle.setAttribute('aria-pressed', 'false');
  focusToggle.title = 'Maximizar el área de trabajo';
  focusToggle.setAttribute('aria-label', 'Maximizar el área de trabajo');
  focusToggle.innerHTML = '<span class="import-focus-icon" aria-hidden="true"></span>';
  if (storeLink) {
    storeLink.insertAdjacentElement('afterend', categoryToggle);
    categoryToggle.insertAdjacentElement('afterend', focusToggle);
  } else topbarActions?.append(categoryToggle, focusToggle);
  const focusIcon = focusToggle.querySelector('.import-focus-icon');
  function setImportCategoryMode(enabled) {
    importPage.classList.toggle('import-page--category-mode', enabled);
    categoryToggle.setAttribute('aria-pressed', String(enabled));
    categoryToggle.title = enabled ? 'Volver a la vista de análisis' : 'Vista por categoría';
    categoryToggle.setAttribute('aria-label', categoryToggle.title);
  }
  function setImportFocusMode(focused) {
    appShell?.classList.toggle('import-focus', focused);
    importPage.classList.toggle('import-page--focused', focused);
    categoryToggle.hidden = !focused;
    if (!focused) setImportCategoryMode(false);
    focusToggle.setAttribute('aria-pressed', String(focused));
    focusToggle.title = focused ? 'Restaurar vista normal' : 'Maximizar el área de trabajo';
    focusToggle.setAttribute('aria-label', focused ? 'Minimizar área de trabajo' : 'Maximizar área de trabajo');
    focusIcon.innerHTML = focused
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    appShell?.querySelectorAll('.sidebar-link').forEach(link => {
      const label = link.querySelector('.sidebar-link-label')?.textContent.trim()
        || [...link.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join(' ');
      if (focused) {
        link.title = label;
        link.setAttribute('aria-label', label);
      } else {
        link.removeAttribute('title');
        link.removeAttribute('aria-label');
      }
    });
  }
  setImportFocusMode(false);
  focusToggle.addEventListener('click', () => {
    setImportFocusMode(focusToggle.getAttribute('aria-pressed') !== 'true');
  });
  categoryToggle.addEventListener('click', () => {
    const workspace = importPage.querySelector('.import-category-workspace');
    if (!workspace) {
      showToast('Analiza la carpeta primero para preparar la vista por categoría', 'error');
      return;
    }
    setImportCategoryMode(!importPage.classList.contains('import-page--category-mode'));
  });

  document.getElementById('imp-provider').addEventListener('change', (e) => {
    providerId = e.target.value;
    localStorage.setItem(PROVIDER_KEY, providerId);
    setImportCategoryMode(false);
    document.getElementById('imp-results').innerHTML = '';
    importPage.classList.remove('import-page--active');
    const prov = providers.find(p => p.id === providerId);
    if (prov) {
      const folderInput = document.getElementById('imp-folder');
      folderInput.value = getProviderFolder(prov.name);
    }
  });

  document.getElementById('imp-analyze').addEventListener('click', async () => {
    if (busy) return;
    const folderVal = document.getElementById('imp-folder').value.trim();
    const status = document.getElementById('imp-status');
    const btn = document.getElementById('imp-analyze');
    if (!folderVal) { showToast('Indicá la carpeta con las imágenes', 'error'); return; }
    if (!providerId) { showToast('Elegí el proveedor', 'error'); return; }
    const engineVal = document.getElementById('imp-engine').value;
    localStorage.setItem(FOLDER_KEY, folderVal);
    localStorage.setItem(ENGINE_KEY, engineVal);
    busy = true;
    btn.disabled = true;
    status.textContent = 'Preparando categorías y cargando imágenes...';
    try {
      const prepared = await api.importPrepareCategories({ folder: folderVal });
      const browse = await api.importBrowse({ folder: folderVal });
      const [productsResult, categoriesResult, projectProductsResult] = await Promise.allSettled([
        api.getProducts({ provider_id: providerId }),
        api.getCategories(),
        api.getProducts(),
      ]);
      const products = productsResult.status === 'fulfilled' ? productsResult.value : [];
      const categories = categoriesResult.status === 'fulfilled'
        ? categoriesResult.value
        : prepared.categories.map(category => ({ name: category.name }));
      const projectProducts = projectProductsResult.status === 'fulfilled' ? projectProductsResult.value : [];
      const auxiliaryErrors = [productsResult, categoriesResult, projectProductsResult]
        .filter(result => result.status === 'rejected')
        .map(result => result.reason?.message)
        .filter(Boolean);
      const folderState = {
        folder: folderVal,
        providerId,
        engine: engineVal,
        categories: prepared.categories,
        rootImages: browse.images,
        activeCategory: null,
        images: [],
        analyzedByFolder: Object.create(null),
      };
      const data = {
        provider: providers.find(provider => provider.id === providerId)?.name || '',
        products,
        items: [],
      };
      status.textContent = '';
      renderResults(container, data, categories, projectProducts, prepared.categories, folderVal, folderState);
      showToast(
        auxiliaryErrors.length
          ? `Imágenes cargadas, pero no se pudieron actualizar todos los datos: ${auxiliaryErrors.join('; ')}`
          : 'Imágenes cargadas. Selecciona una categoría para analizarlas individualmente.',
        auxiliaryErrors.length ? 'warning' : 'success',
      );
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
  function handleImportCarouselKeydown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay && !modalOverlay.classList.contains('hidden')) return;
    const track = container.querySelector('#carousel-track');
    if (!track?.querySelector('.carousel-item, .carousel-folder')) return;
    e.preventDefault();
    container.querySelector(e.key === 'ArrowLeft' ? '.carousel-prev' : '.carousel-next')?.click();
  }
  document.addEventListener('keydown', handleImportCarouselKeydown);
  return () => {
    document.removeEventListener('keydown', handleImportCarouselKeydown);
    setImportFocusMode(false);
    categoryToggle.remove();
    focusToggle.remove();
  };
}

function renderResults(container, data, registeredCategories = [], projectProducts = [], categoryFolders = [], sourceFolder = '', folderState = null) {
  const results = document.getElementById('imp-results');
  if (!results) return;
  const importPage = container.querySelector('.import-page');
  const appShell = document.getElementById('app-shell');
  if (folderState) {
    const uiState = folderState.uiState ||= {};
    const categoryFilter = results.querySelector('.import-filter-cat-right');
    const visibilityFilter = results.querySelector('.import-filter-vis-right');
    const searchFilter = results.querySelector('.import-filter-search');
    const leftList = results.querySelector('#import-list-left');
    const rightList = results.querySelector('#import-list-right');
    if (categoryFilter) uiState.catalogCategory = categoryFilter.value;
    if (visibilityFilter) uiState.catalogVisibility = visibilityFilter.value;
    if (searchFilter) uiState.catalogSearch = searchFilter.value;
    if (leftList) uiState.leftListScrollTop = leftList.scrollTop;
    if (rightList) uiState.rightListScrollTop = rightList.scrollTop;
    if (importPage) uiState.categoryMode = importPage.classList.contains('import-page--category-mode');
    uiState.focused = appShell?.classList.contains('import-focus') || false;

    folderState.cardState ||= Object.create(null);
    results.querySelectorAll('.import-card-left[data-state-key]').forEach(card => {
      const state = folderState.cardState[card.dataset.stateKey] ||= {};
      const product = card.querySelector('.imp-product');
      const price = card.querySelector('.imp-price');
      const apply = card.querySelector('.imp-apply');
      const category = card.querySelector('.imp-filter-cat');
      if (product) state.productId = product.value;
      if (price) state.price = price.value;
      if (apply) state.apply = apply.checked;
      if (category) state.category = category.value;
      state.visible = card.dataset.visible !== '0';
    });
  }
  if (data.message) {
    results.innerHTML = `<div class="card" style="padding:20px;color:var(--text-secondary);font-size:.85rem">${escHtml(data.message)}</div>`;
    return;
  }

  let categories = [...new Set([
    ...registeredCategories.map(category => typeof category === 'string' ? category : category.name),
    ...categoryFolders.map(folder => folder.name),
    ...projectProducts.map(product => product.category),
    ...data.products.map(product => product.category),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const activeCategory = folderState?.activeCategory || '';
  const folderKey = activeCategory || '__root__';
  const rawImages = folderState
    ? [...(folderState.images || [])]
    : [...new Map(data.items
    .filter(i => i.filename && i.url)
    .map(i => [i.filename, { filename: i.filename, url: i.url }])).values()];
  const analyzedItems = folderState?.analyzedByFolder?.[folderKey] || Object.create(null);
  const visibleImageCount = activeCategory ? rawImages.length : (folderState?.rootImages?.length ?? rawImages.length);
  const validItems = folderState
    ? rawImages.flatMap(image => {
      const items = analyzedItems[image.filename]?.length
        ? analyzedItems[image.filename]
        : [{ ...image, pending: true }];
      return items.map((item, index) => ({
        ...item,
        stateKey: `${image.filename}::${index}`,
      }));
    })
    : data.items.filter(i => i.filename);
  const visibleItems = validItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !folderState?.cardState?.[item.stateKey]?.discarded);
  // Estado de selección de imagen activa en el carrusel
  let activeImgIndex = folderState?.activeImgIndex || 0;

  // ---------- CARRUSEL (categorías o imágenes de la categoría seleccionada) ----------
  const carouselFolders = folderState && !activeCategory ? categoryFolders : [];
  const uiState = folderState?.uiState || {};
  const carouselHtml = `
    <div class="import-carousel">
      <div class="carousel-viewport">
        <button type="button" class="carousel-back" aria-label="Volver a las categorías" ${activeCategory ? '' : 'hidden'}>&#8592; Categorías</button>
        <button type="button" class="carousel-arrow carousel-prev" aria-label="Imagen anterior" ${(carouselFolders.length || rawImages.length) < 2 ? 'disabled' : ''}>&#9664;</button>
        <div class="carousel-track" id="carousel-track" tabindex="0" aria-label="Imágenes originales pendientes">
          ${carouselFolders.length ? carouselFolders.map((item, idx) => `
            <button type="button" class="carousel-folder${folderState.activeFolderIndex === idx ? ' active' : ''}" data-category="${escAttr(item.name)}" data-idx="${idx}" title="Abrir categoría ${escAttr(item.name)}">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>
              <span class="carousel-folder-name">${escHtml(item.name)}</span>
            </button>
          `).join('') : rawImages.length ? rawImages.map((image, idx) => `
            <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
              <img src="${escHtml(image.url)}" alt="${escHtml(image.filename)}" loading="lazy" />
              <div class="carousel-caption">${escHtml(image.filename)}</div>
              <button type="button" class="carousel-remove" data-idx="${idx}" title="Eliminar imagen tratada" aria-label="Eliminar ${escAttr(image.filename)} del disco">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          `).join('') : `<div class="carousel-empty">${folderState ? (activeCategory ? 'No hay imágenes en esta categoría.' : 'No hay categorías para mostrar.') : 'No quedan imágenes pendientes en la carpeta.'}</div>`}
        </div>
        <button type="button" class="carousel-arrow carousel-next" aria-label="Imagen siguiente" ${(carouselFolders.length || rawImages.length) < 2 ? 'disabled' : ''}>&#9654;</button>
      </div>
      <div class="carousel-counter" id="carousel-counter">${carouselFolders.length ? `${(folderState.activeFolderIndex ?? 0) + 1} / ${carouselFolders.length} categorías` : `${rawImages.length ? activeImgIndex + 1 : 0} / ${rawImages.length}`}</div>
    </div>
  `;

  // ---------- LISTA IZQUIERDA (procesados, resumida) ----------
  const itemsHtml = visibleItems.map(({ item: it, index: i }) => {
    const itemState = folderState?.cardState?.[it.stateKey] || {};
    const selectedProductId = itemState.productId ?? it.product?.id ?? '';
    const selectedCategory = itemState.category ?? (it.product
      ? data.products.find(product => product.id === it.product.id)?.category || ''
      : '');
    if (it.pending) {
      return `
        <div class="import-card-left import-card-pending" data-idx="${i}" data-state-key="${escAttr(it.stateKey)}" data-filename="${escAttr(it.filename)}">
          <img class="import-result-thumb import-preview-image" src="${escAttr(it.url)}" alt="" loading="lazy" role="button" tabindex="0" title="Clic para ampliar" aria-label="Ampliar ${escAttr(it.filename)}" />
          <div class="import-card-details">
            <div style="font-size:.78rem;color:var(--text-secondary);word-break:break-all">${escHtml(it.filename)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
              <button type="button" class="btn btn--sm btn--ghost imp-new" title="Crear producto nuevo" style="padding:3px 6px;color:var(--rose);flex-shrink:0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button type="button" class="btn btn--sm btn--primary imp-analyze-one" data-filename="${escAttr(it.filename)}">Analizar imagen</button>
              <span class="imp-single-status" style="font-size:.72rem;color:var(--text-muted)"></span>
            </div>
          </div>
        </div>
      `;
    }
    if (it.error) {
      return `
        <div class="import-card-left import-card-error" data-idx="${i}" data-error="1" data-state-key="${escAttr(it.stateKey)}" data-filename="${escAttr(it.filename)}">
          ${it.url ? `<img class="import-result-thumb import-preview-image" src="${escAttr(it.url)}" alt="" loading="lazy" role="button" tabindex="0" title="Clic para ampliar" aria-label="Ampliar ${escAttr(it.filename)}" />` : ''}
          <div class="import-card-details">
            <div style="font-size:.78rem;color:var(--text-secondary);word-break:break-all">${escHtml(it.filename)}</div>
            <div style="font-size:.78rem;color:var(--error);margin-top:4px">No se pudo analizar esta imagen: ${escHtml(it.error)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
              <button type="button" class="btn btn--sm btn--ghost imp-new" title="Crear producto nuevo" style="padding:3px 6px;color:var(--rose);flex-shrink:0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button type="button" class="btn btn--sm btn--secondary imp-analyze-one" data-filename="${escAttr(it.filename)}">Reintentar análisis</button>
              <span class="imp-single-status" style="font-size:.72rem;color:var(--text-muted)"></span>
            </div>
          </div>
        </div>
      `;
    }
    const matchProduct = it.product ? data.products.find(p => p.id === it.product.id) : null;
    const defaultCat = selectedCategory || matchProduct?.category || '';
    const initialPool = defaultCat ? data.products.filter(p => p.category === defaultCat) : data.products;
    const productOptions = initialPool.map(p =>
      `<option value="${p.id}" ${selectedProductId === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
    const matchBadge = it.product
      ? `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(37,211,102,.15);color:#1da851;font-weight:600">${it.product.confidence}% coincidencia</span>`
      : `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(184,134,11,.15);color:#b8860b;font-weight:600">Sin coincidencia</span>`;
    const current = it.product ? `$${Number(it.product.current_price).toLocaleString('es-CO')}` : '—';
    const priceVal = itemState.price ?? (it.detected_price ? it.detected_price.value : (it.product ? it.product.current_price : ''));
    const checked = (itemState.apply ?? !!it.product) ? 'checked' : '';
    const visible = itemState.visible ?? (it.product ? it.product.visible : true);
    return `
      <div class="import-card-left" data-idx="${i}" data-state-key="${escAttr(it.stateKey || `${it.filename}::0`)}" data-filename="${escAttr(it.filename)}" data-visible="${visible ? '1' : '0'}">
        <img class="import-result-thumb import-preview-image" src="${escAttr(it.url || '')}" alt="" loading="lazy" role="button" tabindex="0" title="Clic para ampliar" aria-label="Ampliar ${escAttr(it.filename)}" />
        <div class="import-card-details">
        <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:5px;font-size:.78rem;cursor:pointer">
            <input type="checkbox" class="imp-apply" ${checked} /> Aplicar
          </label>
          ${matchBadge}
          ${it.origen === 'vision' ? '<span style="font-size:.68rem;padding:2px 7px;border-radius:10px;background:rgba(99,102,241,.12);color:#6366f1">IA · visión</span>' : ''}
        </div>
        <div style="font-size:.78rem;color:var(--text-secondary);word-break:break-all;margin-top:2px">${escHtml(it.filename)}</div>
        ${it.detected_name ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">Nombre detectado: <b>${escHtml(it.detected_name)}</b></div>` : ''}
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <select class="imp-filter-cat form-control form-control--small" style="max-width:110px;flex-shrink:0" title="Filtrar por categoría">
            <option value="" ${!defaultCat ? 'selected' : ''}>Todas</option>
            ${categories.map(c => `<option value="${escAttr(c)}" ${defaultCat === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
          </select>
          <select class="imp-product form-control form-control--small" style="flex:1;min-width:120px">
            <option value="">— Sin producto —</option>
            ${productOptions}
          </select>
          <input type="number" step="any" min="1" class="imp-price form-control form-control--small" value="${priceVal}" style="max-width:100px" placeholder="Precio USD" />
          <span class="imp-current" style="font-size:.72rem;color:var(--text-muted)">actual: ${current}</span>
          <button type="button" class="btn btn--sm btn--ghost imp-eye" title="Mostrar/ocultar en catálogo" style="padding:3px 6px;flex-shrink:0"></button>
          <button type="button" class="btn btn--sm btn--ghost imp-discard" title="Descartar" style="padding:3px 6px;color:var(--text-muted);flex-shrink:0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button type="button" class="btn btn--sm btn--ghost imp-new" title="Crear producto nuevo" style="padding:3px 6px;color:var(--rose);flex-shrink:0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <details style="font-size:.68rem;color:var(--text-muted);margin-top:4px">
          <summary style="cursor:pointer">${it.origen === 'vision' ? 'Respuesta IA' : 'Texto OCR'}</summary>
          <pre style="white-space:pre-wrap;font-family:inherit;margin:4px 0 0;max-height:80px;overflow:auto">${escHtml(it.text || '—')}</pre>
        </details>
        </div>
      </div>
    `;
  }).join('');

  // ---------- LISTA DERECHA (catálogo del proveedor) ----------
  const providerProducts = data.products;
  function renderProviderProductCard(p) {
    const visible = p.catalog_visible !== 0;
    const image = p.images?.[0];
    return `
      <div class="import-card-right" data-pid="${p.id}" data-cat="${escAttr(p.category || '')}" data-visible="${visible ? '1' : '0'}">
        ${image
          ? `<img class="import-product-thumb import-preview-image" src="${escAttr(image)}" alt="" loading="lazy" role="button" tabindex="0" title="Clic para ampliar" aria-label="Ampliar imagen de ${escAttr(p.name)}" />`
          : '<div class="import-product-thumb import-product-thumb--empty" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></div>'}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600">${escHtml(p.name)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">$${Number(p.price).toLocaleString('es-CO')} · ${p.category || 'sin categoría'} · stock ${p.stock}</div>
          </div>
          <div class="import-product-actions">
            <button type="button" class="btn btn--sm btn--ghost imp-eye-right" title="${visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" style="padding:3px 6px;"></button>
            <button type="button" class="btn btn--sm btn--ghost imp-product-action" data-action="edit" title="Editar producto" aria-label="Editar producto">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="btn btn--sm btn--ghost imp-product-action" data-action="duplicate" title="Duplicar producto" aria-label="Duplicar producto">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button type="button" class="btn btn--sm btn--ghost imp-product-action" data-action="delete" title="Eliminar producto" aria-label="Eliminar producto" style="color:var(--error)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }
  results.innerHTML = `
    <div class="import-actions-bar">
      <div class="import-bulk-actions">
        <label style="display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer">
          <input type="checkbox" id="imp-toggle-all" checked /> Marcar / desmarcar todos
        </label>
        <div class="import-summary" style="font-size:.85rem;color:var(--text-secondary)">
          Proveedor: <b>${escHtml(data.provider)}</b> · ${visibleImageCount} imagen(es) · ${validItems.filter(i => !i.error && !i.pending).length} producto(s) analizado(s)
        </div>
        ${folderState ? '' : `<label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
          <input type="checkbox" id="imp-hide-absent" /> Ocultar productos del proveedor que no aparecen
        </label>`}
      </div>
      <div class="import-apply-actions">
        <button class="btn btn--primary" id="imp-apply">Aplicar seleccionados</button>
        <span id="imp-apply-status" style="font-size:.8rem;color:var(--text-muted)"></span>
      </div>
      <div id="imp-apply-summary" class="import-apply-summary"></div>
    </div>
    <div class="import-layout">
      <!-- Área superior: dos columnas iguales (2/3 del alto) -->
      <div class="import-top">
        <div class="import-panel import-left">
          <div class="import-panel-header">
            <span style="font-weight:600">Productos analizados</span>
            ${folderState && activeCategory ? `
              <label style="display:flex;align-items:center;gap:6px;margin-left:auto;font-size:.72rem;color:var(--text-muted)">
                Analizador
                <select id="imp-category-engine" class="form-control form-control--small" aria-label="Tipo de analizador de imágenes">
                  <option value="local" ${folderState.engine === 'local' ? 'selected' : ''}>OCR sin visión</option>
                  <option value="vision" ${folderState.engine === 'vision' ? 'selected' : ''}>OCR con visión</option>
                </select>
              </label>
            ` : ''}
            <span style="font-size:.72rem;color:var(--text-muted);${folderState && activeCategory ? 'margin-left:12px' : 'margin-left:auto'}">${visibleImageCount} imagen(es)</span>
          </div>
          <div class="import-list-left" id="import-list-left">
            ${itemsHtml}
          </div>
        </div>
        <div class="import-panel import-right">
          <div class="import-panel-header">
            <span style="font-weight:600">Catálogo del proveedor</span>
            <span id="import-catalog-count" style="font-size:.72rem;color:var(--text-muted);margin-left:auto">0 productos</span>
          </div>
          <div class="import-filters-right">
            <select class="import-filter-cat-right form-control form-control--small" style="max-width:140px" title="Filtrar por categoría">
              <option value="">Todas las categorías</option>
              ${categories.map(c => `<option value="${escAttr(c)}" ${uiState.catalogCategory === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            </select>
            <select class="import-filter-vis-right form-control form-control--small" style="max-width:110px" title="Filtrar por visibilidad">
              <option value="">Todas</option>
              <option value="1" ${uiState.catalogVisibility === '1' ? 'selected' : ''}>Visible</option>
              <option value="0" ${uiState.catalogVisibility === '0' ? 'selected' : ''}>Oculto</option>
            </select>
            <input type="text" class="import-filter-search form-control form-control--small" style="max-width:160px" placeholder="Buscar producto..." title="Buscar por nombre" value="${escAttr(uiState.catalogSearch || '')}" />
          </div>
          <div class="import-list-right" id="import-list-right">
          </div>
        </div>
      </div>

      <!-- Área inferior: carrusel de imágenes crudas (1/3 del alto) -->
      ${carouselHtml}
    </div>
    <div class="import-category-workspace">
      <section class="import-panel import-category-images-panel">
        <div class="import-panel-header">
          <label class="import-classification-select-all">
            <input type="checkbox" id="import-category-select-all" />
            <span>Imágenes pendientes de clasificar</span>
          </label>
          <span id="import-category-selection-count" style="font-size:.72rem;color:var(--text-muted)">0 seleccionadas</span>
          <span id="import-category-image-count" style="font-size:.72rem;color:var(--text-muted)">${rawImages.length}</span>
        </div>
        <div class="import-category-images" id="import-category-images"></div>
      </section>
      <section class="import-panel import-category-folders-panel">
        <div class="import-panel-header">
          <span>Categorías</span>
          <span style="font-size:.72rem;color:var(--text-muted)">Arrastra cada imagen a una carpeta</span>
        </div>
        <div class="import-category-folders" id="import-category-folders"></div>
      </section>
    </div>
  `;
  document.querySelector('.import-page')?.classList.add('import-page--active');

  // ---------- CARRUSEL: navegación ----------
  const track = document.getElementById('carousel-track');
  const counter = document.getElementById('carousel-counter');
  const btnPrev = results.querySelector('.carousel-prev');
  const btnNext = results.querySelector('.carousel-next');

  track.addEventListener('keydown', (event) => {
    if (event.target !== track || (event.key !== 'Enter' && event.key !== ' ')) return;
    const activeFolder = track.querySelector('.carousel-folder.active');
    if (!activeFolder) return;
    event.preventDefault();
    activeFolder.click();
  });

  results.addEventListener('click', (e) => {
    const image = e.target.closest('.import-preview-image');
    if (!image) return;
    openImportImagePreview(image.src, image.getAttribute('aria-label')?.replace(/^Ampliar (imagen de )?/, '') || '');
  });

  results.addEventListener('keydown', (e) => {
    const image = e.target.closest('.import-preview-image');
    if (!image || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    openImportImagePreview(image.src, image.getAttribute('aria-label')?.replace(/^Ampliar (imagen de )?/, '') || '');
  });

  function renderCarousel() {
    track.innerHTML = carouselFolders.length ? carouselFolders.map((item, idx) => `
      <button type="button" class="carousel-folder${folderState.activeFolderIndex === idx ? ' active' : ''}" data-category="${escAttr(item.name)}" data-idx="${idx}" title="Abrir categoría ${escAttr(item.name)}">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>
        <span class="carousel-folder-name">${escHtml(item.name)}</span>
      </button>
    `).join('') : rawImages.length ? rawImages.map((image, idx) => `
      <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
        <img src="${escHtml(image.url)}" alt="${escHtml(image.filename)}" loading="lazy" />
        <div class="carousel-caption">${escHtml(image.filename)}</div>
        <button type="button" class="carousel-remove" data-idx="${idx}" title="Eliminar imagen tratada" aria-label="Eliminar ${escAttr(image.filename)} del disco">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `).join('') : '<div class="carousel-empty">No quedan imágenes pendientes en la carpeta.</div>';
    const carouselCount = carouselFolders.length || rawImages.length;
    const carouselIndex = carouselFolders.length ? (folderState.activeFolderIndex || 0) : activeImgIndex;
    counter.textContent = `${carouselCount ? carouselIndex + 1 : 0} / ${carouselCount}${carouselFolders.length ? ' categorías' : ''}`;
    btnPrev.disabled = btnNext.disabled = carouselCount < 2;
    results.querySelector('.carousel-back').hidden = !activeCategory;
    const summary = results.querySelector('.import-summary');
    if (summary) {
      summary.innerHTML = `Proveedor: <b>${escHtml(data.provider)}</b> · ${activeCategory ? rawImages.length : (folderState?.rootImages?.length ?? rawImages.length)} imagen(es) · ${validItems.filter(item => !item.error && !item.pending).length} producto(s) analizado(s)`;
    }
    requestAnimationFrame(scrollCarouselToActive);
  }

  const classificationImages = document.getElementById('import-category-images');
  const classificationFolders = document.getElementById('import-category-folders');
  const classificationCount = document.getElementById('import-category-image-count');
  const classificationSelectionCount = document.getElementById('import-category-selection-count');
  const selectAllImages = document.getElementById('import-category-select-all');
  const selectedFilenames = new Set(folderState?.selectedRootFilenames || []);

  function renderClassificationView() {
    const rootImages = folderState?.rootImages || [];
    for (const filename of selectedFilenames) {
      if (!rootImages.some(image => image.filename === filename)) selectedFilenames.delete(filename);
    }
    if (folderState) folderState.selectedRootFilenames = [...selectedFilenames];
    classificationImages.innerHTML = rootImages.length
      ? rootImages.map(image => `
        <div class="import-classification-image${selectedFilenames.has(image.filename) ? ' is-selected' : ''}" draggable="true" data-filename="${escAttr(image.filename)}" title="Selecciona o arrastra a una categoría">
          <input type="checkbox" class="import-classification-checkbox" aria-label="Seleccionar ${escAttr(image.filename)}" ${selectedFilenames.has(image.filename) ? 'checked' : ''} />
          <img class="import-preview-image" src="${escAttr(image.url)}" alt="" loading="lazy" role="button" tabindex="0" aria-label="Ampliar ${escAttr(image.filename)}" />
          <span>${escHtml(image.filename)}</span>
        </div>
      `).join('')
      : '<div class="import-category-empty">No quedan imágenes en la raíz por clasificar.</div>';
    classificationCount.textContent = String(rootImages.length);
    updateClassificationSelection();
    classificationFolders.innerHTML = categoryFolders.length
      ? categoryFolders.map(item => `
        <div class="import-category-folder" data-category="${escAttr(item.name)}" title="${escAttr(item.folderName)}">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>
          <span>${escHtml(item.name)}</span>
          <small>${escHtml(item.folderName)}</small>
        </div>
      `).join('')
      : '<div class="import-category-empty">No hay categorías registradas.</div>';
  }

  function updateClassificationSelection() {
    const rootImages = folderState?.rootImages || [];
    const selectedCount = rootImages.filter(image => selectedFilenames.has(image.filename)).length;
    classificationSelectionCount.textContent = `${selectedCount} seleccionada(s)`;
    selectAllImages.checked = rootImages.length > 0 && selectedCount === rootImages.length;
    selectAllImages.indeterminate = selectedCount > 0 && selectedCount < rootImages.length;
  }

  renderClassificationView();

  classificationImages.addEventListener('change', (e) => {
    const checkbox = e.target.closest('.import-classification-checkbox');
    if (!checkbox) return;
    const imageCard = checkbox.closest('.import-classification-image');
    if (!imageCard) return;
    if (checkbox.checked) selectedFilenames.add(imageCard.dataset.filename);
    else selectedFilenames.delete(imageCard.dataset.filename);
    folderState.selectedRootFilenames = [...selectedFilenames];
    imageCard.classList.toggle('is-selected', checkbox.checked);
    updateClassificationSelection();
  });
  selectAllImages.addEventListener('change', () => {
    const shouldSelect = selectAllImages.checked;
    for (const image of folderState.rootImages) {
      if (shouldSelect) selectedFilenames.add(image.filename);
      else selectedFilenames.delete(image.filename);
    }
    folderState.selectedRootFilenames = [...selectedFilenames];
    renderClassificationView();
  });
  classificationImages.addEventListener('click', (e) => {
    if (e.target.closest('.import-classification-checkbox')) e.stopPropagation();
  });

  classificationImages.addEventListener('dragstart', (e) => {
    const imageCard = e.target.closest('.import-classification-image');
    if (!imageCard) return;
    if (!selectedFilenames.has(imageCard.dataset.filename)) {
      selectedFilenames.clear();
      selectedFilenames.add(imageCard.dataset.filename);
      folderState.selectedRootFilenames = [...selectedFilenames];
      classificationImages.querySelectorAll('.import-classification-image').forEach(card => {
        const selected = selectedFilenames.has(card.dataset.filename);
        card.classList.toggle('is-selected', selected);
        card.querySelector('.import-classification-checkbox').checked = selected;
      });
      updateClassificationSelection();
    }
    e.dataTransfer.setData('text/plain', JSON.stringify([...selectedFilenames]));
    e.dataTransfer.effectAllowed = 'move';
    classificationImages.querySelectorAll('.import-classification-image').forEach(card => {
      card.classList.toggle('is-dragging', selectedFilenames.has(card.dataset.filename));
    });
  });
  classificationImages.addEventListener('dragend', (e) => {
    e.target.closest('.import-classification-image')?.classList.remove('is-dragging');
  });
  classificationFolders.addEventListener('dragover', (e) => {
    const folderCard = e.target.closest('.import-category-folder');
    if (!folderCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    folderCard.classList.add('is-drop-target');
  });
  classificationFolders.addEventListener('dragleave', (e) => {
    const folderCard = e.target.closest('.import-category-folder');
    if (folderCard && !folderCard.contains(e.relatedTarget)) folderCard.classList.remove('is-drop-target');
  });
  classificationFolders.addEventListener('drop', async (e) => {
    const folderCard = e.target.closest('.import-category-folder');
    if (!folderCard) return;
    e.preventDefault();
    folderCard.classList.remove('is-drop-target');
    const draggedData = e.dataTransfer.getData('text/plain');
    let filenames;
    try {
      const parsed = JSON.parse(draggedData);
      filenames = Array.isArray(parsed) ? parsed.filter(filename => typeof filename === 'string') : [draggedData];
    } catch {
      filenames = [draggedData];
    }
    filenames = filenames.filter(filename => folderState.rootImages.some(image => image.filename === filename));
    if (!filenames.length) return;
    folderCard.classList.add('is-moving');
    let moved = 0;
    const errors = [];
    try {
      for (const filename of filenames) {
        try {
          await api.importAssignImage({ folder: sourceFolder, filename, category: folderCard.dataset.category });
          folderState.rootImages = folderState.rootImages.filter(image => image.filename !== filename);
          selectedFilenames.delete(filename);
          folderState.selectedRootFilenames = [...selectedFilenames];
          moved++;
        } catch (err) {
          errors.push(`${filename}: ${err.message}`);
        }
      }
      renderClassificationView();
      renderCarousel();
      if (errors.length) {
        showToast(`${moved} imagen(es) movida(s). No se pudieron mover: ${errors.join('; ')}`, moved ? 'warning' : 'error');
      } else {
        showToast(`${moved} imagen(es) asignada(s) a ${folderCard.dataset.category}`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      folderCard.classList.remove('is-moving');
    }
  });

  function scrollCarouselToActive() {
    const activeEl = track.querySelector('.carousel-item.active, .carousel-folder.active');
    if (!activeEl) return;
    const activeRect = activeEl.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const activeCenter = activeRect.left + activeRect.width / 2;
    const trackCenter = trackRect.left + track.clientLeft + track.clientWidth / 2;
    track.scrollTo({
      left: track.scrollLeft + activeCenter - trackCenter,
      behavior: 'smooth',
    });
  }

  requestAnimationFrame(scrollCarouselToActive);

  function selectCarouselItem(index) {
    if (carouselFolders.length && folderState) {
      folderState.activeFolderIndex = (index + carouselFolders.length) % carouselFolders.length;
      renderCarousel();
      return;
    }
    if (!rawImages.length) return;
    activeImgIndex = (index + rawImages.length) % rawImages.length;
    if (folderState) folderState.activeImgIndex = activeImgIndex;
    renderCarousel();
  }

  async function openCategory(category, index) {
    if (!folderState) return;
    try {
      const browse = await api.importBrowse({ folder: sourceFolder, category });
      folderState.activeCategory = category;
      folderState.activeFolderIndex = index;
      folderState.activeImgIndex = 0;
      folderState.images = browse.images;
      const catalogCategoryFilter = results.querySelector('.import-filter-cat-right');
      if (catalogCategoryFilter) catalogCategoryFilter.value = category;
      renderResults(container, data, registeredCategories, projectProducts, categoryFolders, sourceFolder, folderState);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function returnToCategories() {
    if (!folderState) return;
    folderState.activeCategory = null;
    folderState.images = [];
    folderState.activeImgIndex = 0;
    renderResults(container, data, registeredCategories, projectProducts, categoryFolders, sourceFolder, folderState);
  }

  async function discardCarouselImage(index, button) {
    const image = rawImages[index];
    if (!image) return;
    const ok = await confirmDialog(`¿Eliminar "${escHtml(image.filename)}" de la carpeta de imágenes?`);
    if (!ok) return;
    button.disabled = true;
    try {
      await api.importDiscardImage({
        folder: sourceFolder || document.getElementById('imp-folder').value.trim(),
        ...(activeCategory ? { category: activeCategory } : {}),
        filename: image.filename,
      });
      folderState.images.splice(index, 1);
      if (folderState.analyzedByFolder[folderKey]) delete folderState.analyzedByFolder[folderKey][image.filename];
      for (const key of Object.keys(folderState.cardState || {})) {
        if (key.startsWith(`${image.filename}::`)) delete folderState.cardState[key];
      }
      folderState.activeImgIndex = Math.min(activeImgIndex, Math.max(0, rawImages.length - 2));
      renderResults(container, data, registeredCategories, projectProducts, categoryFolders, sourceFolder, folderState);
      showToast('Imagen eliminada de la carpeta', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  btnPrev.addEventListener('click', () => {
    const currentIndex = carouselFolders.length ? (folderState.activeFolderIndex || 0) : activeImgIndex;
    selectCarouselItem(currentIndex - 1);
  });

  btnNext.addEventListener('click', () => {
    const currentIndex = carouselFolders.length ? (folderState.activeFolderIndex || 0) : activeImgIndex;
    selectCarouselItem(currentIndex + 1);
  });
  results.querySelector('.carousel-back').addEventListener('click', returnToCategories);

  // La navegación del carrusel es independiente de las listas de productos.
  track.addEventListener('click', (e) => {
    const folderButton = e.target.closest('.carousel-folder');
    if (folderButton) {
      openCategory(folderButton.dataset.category, Number(folderButton.dataset.idx));
      return;
    }
    const removeButton = e.target.closest('.carousel-remove');
    if (removeButton) {
      e.stopPropagation();
      discardCarouselImage(Number(removeButton.dataset.idx), removeButton);
      return;
    }
    const item = e.target.closest('.carousel-item');
    if (!item) return;
    const idx = Number(item.dataset.idx);
    const image = rawImages[idx];
    if (!image) return;
    selectCarouselItem(idx);
    window._openLightbox(rawImages.map(item => item.url), idx);
  });

  // ---------- LISTA IZQUIERDA: eventos ----------
  function updateCurrentPrice(card) {
    const select = card.querySelector('.imp-product');
    if (!select) return;
    const p = data.products.find(pr => pr.id === select.value);
    const span = card.querySelector('.imp-current');
    if (!span) return;
    span.textContent = p
      ? `actual: $${Number(p.price).toLocaleString('es-CO')}`
      : 'actual: —';
  }

  function renderCardOptions(card) {
    const catSel = card.querySelector('.imp-filter-cat');
    const select = card.querySelector('.imp-product');
    if (!catSel || !select) return;
    const currentVal = select.value;
    const pool = data.products.filter(p => !catSel.value || p.category === catSel.value);
    let html = '<option value="">— Sin producto —</option>';
    for (const p of pool) {
      html += `<option value="${p.id}" ${p.id === currentVal ? 'selected' : ''}>${escHtml(p.name)}</option>`;
    }
    if (currentVal) {
      const kept = data.products.find(p => p.id === currentVal);
      if (kept && !pool.some(p => p.id === currentVal)) {
        html += `<option value="${currentVal}" selected>${escHtml(kept.name)}</option>`;
      }
    }
    select.innerHTML = html;
  }

  async function refreshCategories() {
    const [registered, allProducts] = await Promise.all([api.getCategories(), api.getProducts()]);
    categories = [...new Set([
      ...registered.map(category => typeof category === 'string' ? category : category.name),
      ...allProducts.map(product => product.category),
      ...data.products.map(product => product.category),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    const rightValue = filterCatRight.value;
    filterCatRight.innerHTML = `<option value="">Todas las categorías</option>${categories.map(category =>
      `<option value="${escAttr(category)}">${escHtml(category)}</option>`
    ).join('')}`;
    if (categories.includes(rightValue)) filterCatRight.value = rightValue;

    results.querySelectorAll('.import-card-left').forEach(card => {
      const catSelect = card.querySelector('.imp-filter-cat');
      if (!catSelect) return;
      const currentCategory = catSelect.value;
      catSelect.innerHTML = `<option value="">Todas</option>${categories.map(category =>
        `<option value="${escAttr(category)}">${escHtml(category)}</option>`
      ).join('')}`;
      if (categories.includes(currentCategory)) catSelect.value = currentCategory;
      renderCardOptions(card);
      updateCurrentPrice(card);
    });
    renderRightList();
  }

  results.querySelectorAll('.import-card-left').forEach(card => {
    const idx = Number(card.dataset.idx);
    const it = validItems[idx];
    const newButton = card.querySelector('.imp-new');
    newButton?.addEventListener('click', async () => {
      if (!it) return;
      const providerIdSel = document.getElementById('imp-provider')?.value || '';
      const price = card.querySelector('.imp-price')?.value;
      try {
        await openProductForm(null, {
          providerId: providerIdSel,
          images: it.url ? [it.url] : [],
          previewImage: it.url || '',
          catalogVisible: card.dataset.visible !== '0',
          name: it.detected_name || suggestName(it.text),
          price: price || undefined,
          onCreated: async (newId) => {
            const created = await api.getProduct(newId);
            if (!data.products.some(p => p.id === created.id)) data.products.push(created);
            const select = card.querySelector('.imp-product');
            if (select) {
              select.insertAdjacentHTML('beforeend', `<option value="${created.id}" selected>${escHtml(created.name)}</option>`);
              select.value = created.id;
            }
            updateCurrentPrice(card);
            const apply = card.querySelector('.imp-apply');
            if (apply && !apply.checked) apply.checked = true;
            await refreshCategories();
          },
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    if (it?.pending || it?.error) {
      const analyzeButton = card.querySelector('.imp-analyze-one');
      analyzeButton.addEventListener('click', async () => {
        const status = card.querySelector('.imp-single-status');
        analyzeButton.disabled = true;
        status.textContent = 'Analizando...';
        try {
          const result = await api.importAnalyze({
            folder: sourceFolder,
            category: activeCategory,
            filename: it.filename,
            provider_id: folderState.providerId,
            engine: folderState.engine,
          });
          folderState.analyzedByFolder[folderKey] ||= Object.create(null);
          folderState.analyzedByFolder[folderKey][it.filename] = result.items?.length
            ? result.items
            : [{ ...it, error: 'No se detectaron productos en esta imagen' }];
          if (folderState.activeCategory === activeCategory) {
            renderResults(container, data, registeredCategories, projectProducts, categoryFolders, sourceFolder, folderState);
          }
        } catch (err) {
          status.textContent = err.message;
          showToast(err.message, 'error');
        } finally {
          if (analyzeButton.isConnected) analyzeButton.disabled = false;
        }
      });
      return;
    }

    const catSel = card.querySelector('.imp-filter-cat');
    if (!catSel) return;
    catSel.addEventListener('change', () => renderCardOptions(card));
    const prodSel = card.querySelector('.imp-product');
    prodSel.addEventListener('change', () => updateCurrentPrice(card));
    updateCurrentPrice(card);
    const saveCardState = () => {
      if (!folderState || !card.dataset.stateKey) return;
      const state = folderState.cardState[card.dataset.stateKey] ||= {};
      state.productId = prodSel.value;
      state.price = card.querySelector('.imp-price')?.value ?? '';
      state.apply = card.querySelector('.imp-apply')?.checked ?? false;
      state.category = catSel.value;
      state.visible = card.dataset.visible !== '0';
    };
    catSel.addEventListener('change', saveCardState);
    prodSel.addEventListener('change', saveCardState);
    card.querySelector('.imp-price')?.addEventListener('input', saveCardState);
    card.querySelector('.imp-apply')?.addEventListener('change', saveCardState);

    const eyeBtn = card.querySelector('.imp-eye');
    const visible = card.dataset.visible !== '0';
    updateEyeIcon(eyeBtn, visible);
    eyeBtn.addEventListener('click', () => {
      card.dataset.visible = card.dataset.visible === '0' ? '1' : '0';
      updateEyeIcon(eyeBtn, card.dataset.visible !== '0');
      saveCardState();
    });

    card.querySelector('.imp-discard').addEventListener('click', () => {
      if (folderState && card.dataset.stateKey) {
        const state = folderState.cardState[card.dataset.stateKey] ||= {};
        state.discarded = true;
      }
      card.remove();
    });

  });

  // ---------- LISTA DERECHA: filtros y eventos ----------
  const listRight = document.getElementById('import-list-right');
  const categoryEngine = results.querySelector('#imp-category-engine');
  categoryEngine?.addEventListener('change', () => {
    folderState.engine = categoryEngine.value;
    localStorage.setItem(ENGINE_KEY, folderState.engine);
  });
  const filterCatRight = results.querySelector('.import-filter-cat-right');
  const filterVisRight = results.querySelector('.import-filter-vis-right');
  const filterSearchRight = results.querySelector('.import-filter-search');

  function renderRightList() {
    const scrollTop = listRight.scrollTop;
    const cat = filterCatRight.value;
    const vis = filterVisRight.value;
    const search = filterSearchRight.value.toLowerCase();
    if (folderState) {
      folderState.uiState.catalogCategory = cat;
      folderState.uiState.catalogVisibility = vis;
      folderState.uiState.catalogSearch = filterSearchRight.value;
    }
    const filteredProducts = providerProducts.filter(p => {
      if (cat && p.category !== cat) return false;
      if (vis && String(p.catalog_visible) !== vis) return false;
      if (search && !p.name.toLowerCase().includes(search)) return false;
      return true;
    });
    const count = results.querySelector('#import-catalog-count');
    if (count) count.textContent = `${filteredProducts.length} producto(s)`;
    const html = filteredProducts.map(renderProviderProductCard).join('');
    listRight.innerHTML = html;
    listRight.scrollTop = scrollTop;
    listRight.querySelectorAll('.imp-eye-right').forEach(btn => {
      const card = btn.closest('.import-card-right');
      const visible = card.dataset.visible !== '0';
      updateEyeIcon(btn, visible);
      btn.addEventListener('click', async () => {
        const product = providerProducts.find(item => item.id === card.dataset.pid);
        if (!product) return;
        btn.disabled = true;
        try {
          const response = await api.toggleVisibility(product.id);
          product.catalog_visible = response.catalog_visible;
          if (!product.catalog_visible) product.stock = 0;
          await invalidateProductsCache();
          refreshSidebarCounts();
          renderRightList();
          showToast('Visibilidad actualizada', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
    listRight.querySelectorAll('.imp-product-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.import-card-right');
        const productId = card.dataset.pid;
        const action = btn.dataset.action;
        try {
          if (action === 'delete') {
            const ok = await confirmDialog('¿Eliminar este producto? Esta acción no se puede deshacer.');
            if (!ok) return;
            const response = await api.deleteProduct(productId);
            const index = providerProducts.findIndex(product => product.id === productId);
            if (index >= 0) providerProducts.splice(index, 1);
            await invalidateProductsCache();
            refreshSidebarCounts();
            await refreshCategories();
            showToast(response.message, 'success');
            return;
          }

          const product = await api.getProduct(productId);
          const saveOptions = {
            onSaved: async (savedId) => {
              const saved = await api.getProduct(savedId);
              const index = providerProducts.findIndex(item => item.id === savedId);
              if (saved.provider_id === document.getElementById('imp-provider').value) {
                if (index >= 0) providerProducts[index] = saved;
                else providerProducts.push(saved);
              } else if (index >= 0) {
                providerProducts.splice(index, 1);
              }
              await refreshCategories();
            },
            onCreated: async (createdId) => {
              const created = await api.getProduct(createdId);
              if (created.provider_id === document.getElementById('imp-provider').value
                && !providerProducts.some(item => item.id === created.id)) {
                providerProducts.push(created);
                await refreshCategories();
              }
            },
          };
          await openProductForm(product, action === 'duplicate'
            ? { ...saveOptions, isDuplicate: true }
            : saveOptions);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  filterCatRight.addEventListener('change', renderRightList);
  filterVisRight.addEventListener('change', renderRightList);
  filterSearchRight.addEventListener('input', renderRightList);
  renderRightList();
  const summary = results.querySelector('#imp-apply-summary');
  if (folderState?.uiState?.applySummary) renderSummary(summary, folderState.uiState.applySummary);
  const leftList = results.querySelector('#import-list-left');
  if (leftList) leftList.scrollTop = folderState?.uiState?.leftListScrollTop || 0;
  listRight.scrollTop = folderState?.uiState?.rightListScrollTop || 0;

  // ---------- Toggle all ----------
  document.getElementById('imp-toggle-all').addEventListener('change', (e) => {
    const checked = e.target.checked;
    results.querySelectorAll('.imp-apply').forEach(cb => {
      cb.checked = checked;
      const card = cb.closest('.import-card-left');
      if (folderState && card?.dataset.stateKey) {
        const state = folderState.cardState[card.dataset.stateKey] ||= {};
        state.apply = checked;
      }
    });
  });

  // ---------- Aplicar ----------
  document.getElementById('imp-apply').addEventListener('click', async () => {
    const providerIdSel = document.getElementById('imp-provider').value;
    const folder = document.getElementById('imp-folder').value.trim();
    const hideAbsent = document.getElementById('imp-hide-absent')?.checked || false;
    const cards = results.querySelectorAll('.import-card-left');
    const items = [];
    const appliedCards = [];
    cards.forEach(card => {
      const apply = card.querySelector('.imp-apply');
      if (!apply?.checked) return;
      const productId = card.querySelector('.imp-product').value;
      const price = card.querySelector('.imp-price').value;
      if (!productId) return;
      const idx = Number(card.dataset.idx);
      const product = data.products.find(p => p.id === productId);
      const it = validItems[idx];
      items.push({
        product_id: productId,
        product_name: product ? product.name : '',
        price,
        catalog_visible: card.dataset.visible === '0' ? 0 : 1,
        filename: it ? it.filename : '',
      });
      card.dataset.applied = '1';
      appliedCards.push(card);
    });
    if (!items.length) { showToast('Marcá al menos un producto para aplicar', 'error'); return; }
    const btn = document.getElementById('imp-apply');
    const status = document.getElementById('imp-apply-status');
    btn.disabled = true;
    status.textContent = 'Aplicando...';
    try {
      const res = await api.importApply({
        provider_id: providerIdSel,
        items,
        hideAbsent,
        folder: sourceFolder || folder,
        ...(activeCategory ? { category: activeCategory } : {}),
      });
      status.textContent = '';
      if (folderState) folderState.uiState.applySummary = res;
      appliedCards.forEach(card => {
        if (folderState && card.dataset.stateKey) {
          const state = folderState.cardState[card.dataset.stateKey] ||= {};
          state.discarded = true;
        }
        card.remove();
      });
      renderSummary(document.getElementById('imp-apply-summary'), res);
      for (const applied of res.applied) {
        const product = providerProducts.find(item => item.id === applied.product_id);
        if (product) {
          product.price = applied.price;
          product.catalog_visible = applied.visible ? 1 : 0;
        }
      }
      for (const hidden of res.hidden || []) {
        const product = providerProducts.find(item => item.id === hidden.id);
        if (product) product.catalog_visible = 0;
      }
      await invalidateProductsCache();
      refreshSidebarCounts();
      renderRightList();
      const deletedNote = (res.deleted || []).length
        ? ` · ${res.deleted.length} imagen(es) eliminada(s) de la carpeta`
        : '';
      showToast(`${res.applied.length} producto(s) actualizado(s)${deletedNote}`, 'success');
      if (res.deleted && res.deleted.length) {
        const deleted = new Set(res.deleted);
        const remainingImages = rawImages.filter(image => !deleted.has(image.filename));
        rawImages.splice(0, rawImages.length, ...remainingImages);
        if (folderState) {
          folderState.images = folderState.images.filter(image => !deleted.has(image.filename));
          for (const filename of deleted) {
            if (folderState.analyzedByFolder[folderKey]) delete folderState.analyzedByFolder[folderKey][filename];
            for (const key of Object.keys(folderState.cardState || {})) {
              if (key.startsWith(`${filename}::`)) delete folderState.cardState[key];
            }
          }
          folderState.activeImgIndex = Math.min(activeImgIndex, Math.max(0, rawImages.length - 1));
        }
        results.querySelectorAll('.import-card-left').forEach(card => {
          if (deleted.has(validItems[Number(card.dataset.idx)]?.filename)) card.remove();
        });
        renderCarousel();
      }
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function renderSummary(el, res) {
  const appliedRows = res.applied.map(a =>
    `<div style="font-size:.8rem">✓ <b>${escHtml(a.name || a.product_id)}</b> → $${Number(a.price).toLocaleString('es-CO')}${a.visible === false ? ' y oculto del catálogo' : ' y disponible'}</div>`
  ).join('');
  const hiddenRows = (res.hidden || []).map(h =>
    `<div style="font-size:.8rem;color:#b8860b">👁 Ocultado: ${escHtml(h.name)}</div>`
  ).join('');
  const errRows = (res.errors || []).map(e =>
    `<div style="font-size:.8rem;color:var(--error)">✗ ${escHtml(e.name || e.product_id)}: ${escHtml(e.error)}</div>`
  ).join('');
  const deletedRows = (res.deleted || []).length
    ? `<div style="font-size:.8rem;color:var(--text-muted)">🗑 ${res.deleted.length} imagen(es) eliminada(s) de la carpeta</div>`
    : '';
  el.innerHTML = `
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:4px">
      ${appliedRows || '<div style="font-size:.8rem;color:var(--text-muted)">Ningún producto aplicado</div>'}
      ${hiddenRows}
      ${errRows}
      ${deletedRows}
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn--secondary btn--sm" id="imp-regenerate-catalog">Regenerar catálogo público</button>
      </div>
    </div>`;
  document.getElementById('imp-regenerate-catalog').addEventListener('click', async () => {
    const b = document.getElementById('imp-regenerate-catalog');
    b.disabled = true;
    b.textContent = 'Generando...';
    try {
      const r = await api.generateCatalog();
      showToast(`Catálogo generado (${r.products_count} productos)`, 'success');
      b.textContent = 'Catálogo generado ✓';
    } catch (err) {
      showToast(err.message, 'error');
      b.disabled = false;
      b.textContent = 'Regenerar catálogo público';
    }
  });
}
