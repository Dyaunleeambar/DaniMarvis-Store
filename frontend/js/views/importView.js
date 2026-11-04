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
  let analyzeResult = null;
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
          2) El sistema lee cada imagen (nombre + precio USD) y propone el producto y el precio.<br />
          3) Revisá, corregís si hace falta y aplicás: actualiza precio, define si el producto está visible en el catálogo y elimina de la carpeta las imágenes ya aplicadas. También podés eliminar imágenes individuales desde el carrusel. Con el botón <b>+</b> creás un producto nuevo directamente desde la imagen.
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
            <button class="btn btn--primary" id="imp-analyze">Analizar imágenes</button>
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
  const focusToggle = document.createElement('button');
  focusToggle.id = 'imp-focus-toggle';
  focusToggle.type = 'button';
  focusToggle.className = 'btn btn--sm btn--ghost import-focus-toggle';
  focusToggle.setAttribute('aria-pressed', 'false');
  focusToggle.title = 'Maximizar el área de trabajo';
  focusToggle.setAttribute('aria-label', 'Maximizar el área de trabajo');
  focusToggle.innerHTML = '<span class="import-focus-icon" aria-hidden="true"></span>';
  if (storeLink) storeLink.insertAdjacentElement('afterend', focusToggle);
  else topbarActions?.append(focusToggle);
  const focusIcon = focusToggle.querySelector('.import-focus-icon');
  function setImportFocusMode(focused) {
    appShell?.classList.toggle('import-focus', focused);
    importPage.classList.toggle('import-page--focused', focused);
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

  document.getElementById('imp-provider').addEventListener('change', (e) => {
    providerId = e.target.value;
    localStorage.setItem(PROVIDER_KEY, providerId);
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
    status.textContent = engineVal === 'vision'
      ? 'Analizando con IA (visión)... puede tardar unos minutos'
      : 'Analizando imágenes (OCR)... puede tardar un poco';
    try {
      const data = await api.importAnalyze({ folder: folderVal, provider_id: providerId, engine: engineVal });
      const [categoriesResult, productsResult] = await Promise.allSettled([
        api.getCategories(),
        api.getProducts(),
      ]);
      const categories = categoriesResult.status === 'fulfilled' && Array.isArray(categoriesResult.value)
        ? categoriesResult.value
        : [];
      const projectProducts = productsResult.status === 'fulfilled' && Array.isArray(productsResult.value)
        ? productsResult.value
        : [];
      const auxiliaryErrors = [categoriesResult, productsResult]
        .filter(result => result.status === 'rejected')
        .map(result => result.reason?.message)
        .filter(Boolean);
      analyzeResult = data;
      status.textContent = '';
      renderResults(container, data, categories, projectProducts);
      if (auxiliaryErrors.length) {
        showToast(`El análisis terminó, pero no se pudieron actualizar todos los filtros: ${auxiliaryErrors.join('; ')}`, 'warning');
      }
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
  return () => {
    setImportFocusMode(false);
    focusToggle.remove();
  };
}

function renderResults(container, data, registeredCategories = [], projectProducts = []) {
  const results = document.getElementById('imp-results');
  if (!results) return;
  if (data.message) {
    results.innerHTML = `<div class="card" style="padding:20px;color:var(--text-secondary);font-size:.85rem">${escHtml(data.message)}</div>`;
    return;
  }

  let categories = [...new Set([
    ...registeredCategories.map(category => typeof category === 'string' ? category : category.name),
    ...projectProducts.map(product => product.category),
    ...data.products.map(product => product.category),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const rawImages = [...new Map(data.items
    .filter(i => i.filename && i.url)
    .map(i => [i.filename, { filename: i.filename, url: i.url }])).values()];

  // Estado de selección de imagen activa en el carrusel
  let activeImgIndex = 0;

  // ---------- CARRUSEL INFERIOR (imágenes originales pendientes) ----------
  const validItems = data.items.filter(i => i.filename);
  const carouselHtml = `
    <div class="import-carousel">
      <div class="carousel-viewport">
        <button type="button" class="carousel-arrow carousel-prev" aria-label="Imagen anterior" ${rawImages.length < 2 ? 'disabled' : ''}>&#9664;</button>
        <div class="carousel-track" id="carousel-track" tabindex="0" aria-label="Imágenes originales pendientes">
          ${rawImages.length ? rawImages.map((image, idx) => `
            <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
              <img src="${escHtml(image.url)}" alt="${escHtml(image.filename)}" loading="lazy" />
              <div class="carousel-caption">${escHtml(image.filename)}</div>
              <button type="button" class="carousel-remove" data-idx="${idx}" title="Eliminar imagen tratada" aria-label="Eliminar ${escAttr(image.filename)} del disco">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          `).join('') : '<div class="carousel-empty">No quedan imágenes pendientes en la carpeta.</div>'}
        </div>
        <button type="button" class="carousel-arrow carousel-next" aria-label="Imagen siguiente" ${rawImages.length < 2 ? 'disabled' : ''}>&#9654;</button>
      </div>
      <div class="carousel-counter" id="carousel-counter">${rawImages.length ? activeImgIndex + 1 : 0} / ${rawImages.length}</div>
    </div>
  `;

  // ---------- LISTA IZQUIERDA (procesados, resumida) ----------
  const itemsHtml = validItems.map((it, i) => {
    if (it.error) {
      return `
        <div class="import-card-left import-card-error" data-idx="${i}" data-error="1">
          ${it.url ? `<img class="import-result-thumb" src="${escAttr(it.url)}" alt="" loading="lazy" />` : ''}
          <div class="import-card-details">
            <div style="font-size:.78rem;color:var(--text-secondary);word-break:break-all">${escHtml(it.filename)}</div>
            <div style="font-size:.78rem;color:var(--error);margin-top:4px">No se pudo analizar esta imagen: ${escHtml(it.error)}</div>
          </div>
        </div>
      `;
    }
    const matchProduct = it.product ? data.products.find(p => p.id === it.product.id) : null;
    const defaultCat = matchProduct?.category || '';
    const initialPool = defaultCat ? data.products.filter(p => p.category === defaultCat) : data.products;
    const productOptions = initialPool.map(p =>
      `<option value="${p.id}" ${it.product && p.id === it.product.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
    const matchBadge = it.product
      ? `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(37,211,102,.15);color:#1da851;font-weight:600">${it.product.confidence}% coincidencia</span>`
      : `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(184,134,11,.15);color:#b8860b;font-weight:600">Sin coincidencia</span>`;
    const current = it.product ? `$${Number(it.product.current_price).toLocaleString('es-CO')}` : '—';
    const priceVal = it.detected_price ? it.detected_price.value : (it.product ? it.product.current_price : '');
    const checked = it.product ? 'checked' : '';
    return `
      <div class="import-card-left" data-idx="${i}" data-visible="${it.product && !it.product.visible ? '0' : '1'}">
        <img class="import-result-thumb" src="${escHtml(it.url || '')}" alt="" loading="lazy" />
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
            <option value="">Todas</option>
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
          ? `<img class="import-product-thumb" src="${escAttr(image)}" alt="" loading="lazy" />`
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
          Proveedor: <b>${escHtml(data.provider)}</b> · ${rawImages.length} imagen(es) · ${data.items.filter(i => !i.error).length} producto(s) detectado(s)
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
          <input type="checkbox" id="imp-hide-absent" /> Ocultar productos del proveedor que no aparecen
        </label>
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
            <span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">${rawImages.length} imagen(es)</span>
          </div>
          <div class="import-list-left" id="import-list-left">
            ${itemsHtml}
          </div>
        </div>
        <div class="import-panel import-right">
          <div class="import-panel-header">
            <span style="font-weight:600">Catálogo del proveedor</span>
          </div>
          <div class="import-filters-right">
            <select class="import-filter-cat-right form-control form-control--small" style="max-width:140px" title="Filtrar por categoría">
              <option value="">Todas las categorías</option>
              ${categories.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('')}
            </select>
            <select class="import-filter-vis-right form-control form-control--small" style="max-width:110px" title="Filtrar por visibilidad">
              <option value="">Todas</option>
              <option value="1">Visible</option>
              <option value="0">Oculto</option>
            </select>
            <input type="text" class="import-filter-search form-control form-control--small" style="max-width:160px" placeholder="Buscar producto..." title="Buscar por nombre" />
          </div>
          <div class="import-list-right" id="import-list-right">
          </div>
        </div>
      </div>

      <!-- Área inferior: carrusel de imágenes crudas (1/3 del alto) -->
      ${carouselHtml}
    </div>

  `;
  document.querySelector('.import-page')?.classList.add('import-page--active');

  // ---------- CARRUSEL: navegación ----------
  const track = document.getElementById('carousel-track');
  const counter = document.getElementById('carousel-counter');
  const btnPrev = results.querySelector('.carousel-prev');
  const btnNext = results.querySelector('.carousel-next');

  function renderCarousel() {
    track.innerHTML = rawImages.length ? rawImages.map((image, idx) => `
      <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
        <img src="${escHtml(image.url)}" alt="${escHtml(image.filename)}" loading="lazy" />
        <div class="carousel-caption">${escHtml(image.filename)}</div>
        <button type="button" class="carousel-remove" data-idx="${idx}" title="Eliminar imagen tratada" aria-label="Eliminar ${escAttr(image.filename)} del disco">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `).join('') : '<div class="carousel-empty">No quedan imágenes pendientes en la carpeta.</div>';
    counter.textContent = `${rawImages.length ? activeImgIndex + 1 : 0} / ${rawImages.length}`;
    btnPrev.disabled = btnNext.disabled = rawImages.length < 2;
  }

  function scrollCarouselToActive() {
    const activeEl = track.querySelector('.carousel-item.active');
    if (activeEl) {
      track.scrollTo({
        left: activeEl.offsetLeft - (track.clientWidth - activeEl.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }

  function selectImage(index) {
    if (!rawImages.length) return;
    activeImgIndex = (index + rawImages.length) % rawImages.length;
    renderCarousel();
    scrollCarouselToActive();
  }

  async function discardCarouselImage(index, button) {
    const image = rawImages[index];
    if (!image) return;
    const ok = await confirmDialog(`¿Eliminar "${escHtml(image.filename)}" de la carpeta de imágenes?`);
    if (!ok) return;
    button.disabled = true;
    try {
      await api.importDiscardImage({
        folder: document.getElementById('imp-folder').value.trim(),
        filename: image.filename,
      });
      results.querySelectorAll('.import-card-left').forEach(card => {
        if (validItems[Number(card.dataset.idx)]?.filename === image.filename) card.remove();
      });
      rawImages.splice(index, 1);
      if (activeImgIndex > index) activeImgIndex--;
      else if (activeImgIndex >= rawImages.length) activeImgIndex = Math.max(0, rawImages.length - 1);
      renderCarousel();
      scrollCarouselToActive();
      showToast('Imagen eliminada de la carpeta', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  btnPrev.addEventListener('click', () => {
    selectImage(activeImgIndex - 1);
  });

  btnNext.addEventListener('click', () => {
    selectImage(activeImgIndex + 1);
  });

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); selectImage(activeImgIndex - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); selectImage(activeImgIndex + 1); }
  });

  // La navegación del carrusel es independiente de las listas de productos.
  track.addEventListener('click', (e) => {
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
    selectImage(idx);
    // Vista previa ampliada
    const mc = document.querySelector('.modal-content');
    if (mc) { mc.style.maxWidth = '90vw'; mc.style.maxHeight = '90vh'; }
    openModal(`
      <div class="modal-header">
        <h2>Vista previa</h2>
        <button class="modal-close" onclick="closeModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="display:flex;justify-content:center;padding:8px 0 0">
        <img src="${escHtml(image.url)}" alt="" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain" />
      </div>
    `);
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
    if (card.dataset.error === '1') return;
    const catSel = card.querySelector('.imp-filter-cat');
    if (!catSel) return;
    catSel.addEventListener('change', () => renderCardOptions(card));
    const prodSel = card.querySelector('.imp-product');
    prodSel.addEventListener('change', () => updateCurrentPrice(card));
    updateCurrentPrice(card);

    const eyeBtn = card.querySelector('.imp-eye');
    const visible = card.dataset.visible !== '0';
    updateEyeIcon(eyeBtn, visible);
    eyeBtn.addEventListener('click', () => {
      card.dataset.visible = card.dataset.visible === '0' ? '1' : '0';
      updateEyeIcon(eyeBtn, card.dataset.visible !== '0');
    });

    card.querySelector('.imp-discard').addEventListener('click', () => {
      card.remove();
    });

    card.querySelector('.imp-new').addEventListener('click', async () => {
      const idx = Number(card.dataset.idx);
      const it = validItems[idx];
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
  });

  // ---------- LISTA DERECHA: filtros y eventos ----------
  const listRight = document.getElementById('import-list-right');
  const filterCatRight = results.querySelector('.import-filter-cat-right');
  const filterVisRight = results.querySelector('.import-filter-vis-right');
  const filterSearchRight = results.querySelector('.import-filter-search');

  function renderRightList() {
    const cat = filterCatRight.value;
    const vis = filterVisRight.value;
    const search = filterSearchRight.value.toLowerCase();
    const html = providerProducts.filter(p => {
      if (cat && p.category !== cat) return false;
      if (vis && String(p.catalog_visible) !== vis) return false;
      if (search && !p.name.toLowerCase().includes(search)) return false;
      return true;
    }).map(renderProviderProductCard).join('');
    listRight.innerHTML = html;
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

  // ---------- Toggle all ----------
  document.getElementById('imp-toggle-all').addEventListener('change', (e) => {
    const checked = e.target.checked;
    results.querySelectorAll('.imp-apply').forEach(cb => { cb.checked = checked; });
  });

  // ---------- Aplicar ----------
  document.getElementById('imp-apply').addEventListener('click', async () => {
    const providerIdSel = document.getElementById('imp-provider').value;
    const folder = document.getElementById('imp-folder').value.trim();
    const hideAbsent = document.getElementById('imp-hide-absent').checked;
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
      const res = await api.importApply({ provider_id: providerIdSel, items, hideAbsent, folder });
      status.textContent = '';
      appliedCards.forEach(card => card.remove());
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
        const activeFilename = rawImages[activeImgIndex]?.filename;
        const deleted = new Set(res.deleted);
        const remainingImages = rawImages.filter(image => !deleted.has(image.filename));
        rawImages.splice(0, rawImages.length, ...remainingImages);
        const newActiveIndex = rawImages.findIndex(image => image.filename === activeFilename);
        activeImgIndex = newActiveIndex >= 0 ? newActiveIndex : Math.min(activeImgIndex, rawImages.length - 1);
        if (activeImgIndex < 0) activeImgIndex = 0;
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
