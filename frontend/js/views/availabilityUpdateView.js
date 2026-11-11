import { api } from '../db/api.js';
import { confirmDialog, refreshSidebarCounts, showToast } from '../core/app.js';
import { invalidateProductsCache } from '../services/index.js';
import { openProductForm } from './productsView.js';

const FOLDER_KEY = 'danimarvis_update_folder';
const PROVIDER_KEY = 'danimarvis_update_provider';

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function render(container) {
  container.innerHTML = '<div class="loading-screen" style="position:static;padding:40px"><div class="loading-spinner"></div></div>';
  try {
    const providers = await api.getProviders();
    let history = [];
    let historyError = null;
    try {
      history = await api.getAvailabilityUpdateHistory();
    } catch (err) {
      historyError = err;
    }
    renderView(container, providers, history);
    if (historyError) showToast(`No se pudo cargar el historial: ${historyError.message}`, 'warning');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error al cargar</h3><p>${esc(err.message)}</p></div>`;
  }
}

function renderView(container, providers, history) {
  let batch = null;
  let applied = false;
  let historyRows = history;
  const savedProvider = localStorage.getItem(PROVIDER_KEY) || localStorage.getItem('danimarvis_import_provider') || providers[0]?.id || '';
  const savedFolder = localStorage.getItem(FOLDER_KEY) || localStorage.getItem('danimarvis_import_folder') || '';

  container.innerHTML = `
    <div class="page availability-update-page">
      <div class="page-header">
        <div>
          <h1>Actualización</h1>
          <p>Compara las imágenes completas de disponibilidad de un proveedor con las referencias de sus productos.</p>
        </div>
      </div>
      <div class="card" style="padding:18px;margin-bottom:16px">
        <div class="form-row">
          <div class="form-group">
            <label for="update-provider">Proveedor</label>
            <select id="update-provider" class="form-control">
              ${providers.map(provider => `<option value="${esc(provider.id)}" ${provider.id === savedProvider ? 'selected' : ''}>${esc(provider.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:2">
            <label for="update-folder">Carpeta raíz de imágenes de la actualización</label>
            <input id="update-folder" class="form-control" value="${esc(savedFolder)}" placeholder="Ruta local; puede contener subcarpetas por categoría" />
          </div>
          <div class="form-group" style="align-self:end">
            <button type="button" class="btn btn--primary" id="update-analyze">Analizar disponibilidad</button>
          </div>
        </div>
        <p style="font-size:.78rem;color:var(--text-muted);margin:0">
          Se analizarán imágenes de la carpeta raíz y de sus subcarpetas inmediatas. El análisis compara localmente las imágenes y no usa IA generativa.
          Una coincidencia clara propone disponible; una referencia sin coincidencia propone oculto. Los casos dudosos y productos sin referencia no cambian.
        </p>
      </div>
      <div id="update-status" style="font-size:.82rem;color:var(--text-muted);margin:8px 0"></div>
      <div id="update-preview"></div>
      <div id="update-history"></div>
    </div>
  `;

  const providerSelect = container.querySelector('#update-provider');
  const folderInput = container.querySelector('#update-folder');
  const analyzeButton = container.querySelector('#update-analyze');
  const status = container.querySelector('#update-status');
  const previewHost = container.querySelector('#update-preview');
  const historyHost = container.querySelector('#update-history');

  async function reportCatalogRefresh(message) {
    try {
      const catalog = await api.generateCatalog();
      showToast(`${message}. Catálogo regenerado (${catalog.products_count} productos).`, 'success');
    } catch (err) {
      showToast(`${message}, pero no se pudo regenerar el catálogo: ${err.message}`, 'warning');
    }
  }

  function renderHistory() {
    const rows = historyRows.filter(item => item.status === 'applied');
    historyHost.innerHTML = rows.length ? `
      <section class="card availability-update-section">
        <h3>Actualizaciones recientes aplicadas</h3>
        ${rows.map(item => `
          <div class="availability-product-row">
            <div style="flex:1"><b>${esc(item.provider_name || 'Proveedor')}</b><small>${esc(item.created_at)} · ${item.changed_count} cambios</small></div>
            <button type="button" class="btn btn--secondary btn--sm update-history-undo" data-batch-id="${esc(item.id)}">Deshacer</button>
          </div>
        `).join('')}
      </section>
    ` : '';
    historyHost.querySelectorAll('.update-history-undo').forEach(button => {
      button.addEventListener('click', () => undoBatch(button.dataset.batchId, button));
    });
  }

  async function undoBatch(batchId, button) {
    button.disabled = true;
    try {
      const result = await api.undoAvailabilityUpdate(batchId);
      if (batch?.batch_id === batchId) {
        batch = null;
        applied = false;
        previewHost.innerHTML = '';
        status.textContent = 'Actualización deshecha. Analiza nuevamente para generar una vista previa actualizada.';
      }
      historyRows = historyRows.filter(item => item.id !== batchId);
      renderHistory();
      try {
        await invalidateProductsCache();
      } catch (err) {
        showToast(`Se deshizo la actualización, pero no se pudo invalidar la caché: ${err.message}`, 'warning');
      }
      refreshSidebarCounts();
      await reportCatalogRefresh(result.message);
      try {
        historyRows = await api.getAvailabilityUpdateHistory();
        renderHistory();
      } catch (err) {
        showToast(`Se deshizo la actualización, pero no se pudo actualizar el historial: ${err.message}`, 'warning');
      }
    } catch (err) {
      button.disabled = false;
      showToast(err.message, 'error');
    }
  }

  async function refreshAnalysis(message) {
    if (!batch) return;
    try {
      batch = await api.analyzeAvailabilityUpdate({
        provider_id: batch.provider.id,
        folder: batch.folder,
      });
      applied = false;
      renderPreview();
      status.textContent = message;
    } catch (err) {
      batch = null;
      previewHost.innerHTML = '';
      status.textContent = '';
      showToast(`La acción se completó, pero no se pudo actualizar el análisis: ${err.message}`, 'warning');
    }
  }

  function productActions(product) {
    const id = esc(product.id);
    const visible = !!product.catalog_visible;
    return `
      <div class="availability-update-actions">
        <button type="button" class="btn btn--sm btn--ghost update-product-action" data-action="visibility" data-product-id="${id}" title="${visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" aria-label="${visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" style="color:${visible ? 'var(--success)' : 'var(--text-muted)'}">
          ${visible
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}
        </button>
        <button type="button" class="btn btn--sm btn--ghost update-product-action" data-action="edit" data-product-id="${id}" title="Editar" aria-label="Editar producto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="btn btn--sm btn--ghost update-product-action" data-action="duplicate" data-product-id="${id}" title="Duplicar" aria-label="Duplicar producto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button type="button" class="btn btn--sm btn--ghost update-product-action" data-action="delete" data-product-id="${id}" title="Eliminar" aria-label="Eliminar producto" style="color:var(--error)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
  }

  async function handleProductAction(button) {
    const { action, productId } = button.dataset;
    const product = batch?.products.find(item => item.id === productId);
    if (!product) {
      showToast('El producto ya no forma parte del análisis. Analiza nuevamente.', 'warning');
      return;
    }
    button.disabled = true;
    try {
      if (action === 'visibility') {
        await api.toggleVisibility(productId);
        await invalidateProductsCache();
        refreshSidebarCounts();
        await refreshAnalysis('Visibilidad actualizada; revisa la vista previa renovada antes de aplicar.');
      } else if (action === 'edit' || action === 'duplicate') {
        const fullProduct = await api.getProduct(productId);
        await openProductForm(fullProduct, {
          isDuplicate: action === 'duplicate',
          onSaved: () => refreshAnalysis('Producto editado; el análisis se actualizó con los cambios guardados.'),
          onCreated: () => refreshAnalysis('Producto duplicado; el análisis se actualizó con el nuevo producto.'),
        });
      } else if (action === 'delete') {
        const confirmed = await confirmDialog('¿Eliminar este producto? Esta acción no se puede deshacer.');
        if (!confirmed) return;
        const result = await api.deleteProduct(productId);
        await invalidateProductsCache();
        refreshSidebarCounts();
        await refreshAnalysis(result.message || 'Producto eliminado; el análisis se actualizó.');
        showToast(result.message || 'Producto eliminado', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  renderHistory();
  providerSelect.addEventListener('change', () => localStorage.setItem(PROVIDER_KEY, providerSelect.value));
  folderInput.addEventListener('input', () => localStorage.setItem(FOLDER_KEY, folderInput.value));
  analyzeButton.addEventListener('click', async () => {
    const providerId = providerSelect.value;
    const folder = folderInput.value.trim();
    if (!providerId || !folder) {
      showToast('Seleccioná un proveedor e indicá la carpeta de imágenes', 'error');
      return;
    }
    analyzeButton.disabled = true;
    status.textContent = 'Analizando imágenes y comparando referencias...';
    previewHost.innerHTML = '';
    try {
      batch = await api.analyzeAvailabilityUpdate({ provider_id: providerId, folder });
      applied = false;
      status.textContent = '';
      renderPreview();
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      analyzeButton.disabled = false;
    }
  });

  function renderPreview() {
    if (!batch) return;
    const changes = batch.changes || [];
    const available = changes.filter(item => item.decision === 'available');
    const unavailable = changes.filter(item => item.decision === 'unavailable');
    const unchanged = (batch.products || []).filter(item =>
      item.decision === 'available' && item.catalog_visible
      || item.decision === 'unavailable' && !item.catalog_visible);
    const reviewProducts = (batch.products || []).filter(item => item.decision === 'review');
    const noReference = (batch.products || []).filter(item => item.decision === 'no_reference');
    const unchangedProducts = (batch.products || []).filter(item =>
      item.decision === 'available' && item.catalog_visible
      || item.decision === 'unavailable' && !item.catalog_visible);
    const productsById = new Map((batch.products || []).map(item => [item.id, item]));
    const hasErrors = batch.imageErrors?.length || batch.productErrors?.length;
    const summaryRows = (items, title, nextLabel) => items.length ? `
      <section class="card availability-update-section">
        <h3>${title} <span class="badge">${items.length}</span></h3>
        <div class="availability-product-list">
          ${items.map(item => `
            <div class="availability-product-row">
              ${item.referenceThumbnail ? `<img class="update-preview-image" src="${item.referenceThumbnail}" alt="Ampliar referencia de ${esc(item.name)}" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" />` : '<div class="availability-empty-thumb">Sin referencia</div>'}
              <div class="availability-product-info"><b>${esc(item.name)}</b><small>${esc(item.category || 'Sin categoría')} · ${item.catalog_visible ? 'Visible' : 'Oculto'} → ${nextLabel}</small></div>
              ${productActions(item)}
            </div>
          `).join('')}
        </div>
      </section>
    ` : '';
    const unchangedRows = unchangedProducts.length ? `
      <section class="card availability-update-section">
        <h3>Ya tienen el estado esperado <span class="badge">${unchangedProducts.length}</span></h3>
        <div class="availability-product-list">
          ${unchangedProducts.map(item => `
            <div class="availability-product-row">
              <img class="update-preview-image" src="${item.referenceThumbnail}" alt="Ampliar referencia de ${esc(item.name)}" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" />
              <div class="availability-product-info"><b>${esc(item.name)}</b><small>${esc(item.category || 'Sin categoría')} · ${item.catalog_visible ? 'Visible/disponible' : 'Oculto/no disponible'}</small></div>
              ${productActions(item)}
            </div>
          `).join('')}
        </div>
      </section>
    ` : '';

    previewHost.innerHTML = `
      <div class="card availability-update-summary">
        <h2>Vista previa · ${esc(batch.provider.name)}</h2>
        <p>${batch.analyzedImages} imágenes analizadas · ${batch.matches.length} coincidencias claras · ${batch.ambiguousImages.length} imágenes por revisar · ${batch.unmatchedImages.length} posibles productos nuevos</p>
        <p>${available.length} pasarían a disponible · ${unavailable.length} pasarían a oculto · ${unchanged.length} ya tienen el estado esperado</p>
        ${hasErrors ? `<div class="availability-update-errors">
          <b>No se puede aplicar mientras existan errores de lectura.</b>
          ${[...(batch.imageErrors || []), ...(batch.productErrors || [])].map(error => `<div>${esc(error)}</div>`).join('')}
        </div>` : ''}
      </div>
      ${summaryRows(available, 'Pasarían a disponible', 'Disponible')}
      ${summaryRows(unavailable, 'Pasarían a oculto (agotado)', 'Agotado')}
      ${unchangedRows}
      ${reviewProducts.length ? `<section class="card availability-update-section">
        <h3>Productos por revisar <span class="badge">${reviewProducts.length}</span></h3>
        <p>Hay una o más imágenes parecidas, pero no alcanzan un nivel de coincidencia seguro. No se cambiará su estado.</p>
        ${reviewProducts.map(product => `<div class="availability-product-row"><img class="update-preview-image" src="${product.referenceThumbnail}" alt="Ampliar referencia de ${esc(product.name)}" role="button" tabindex="0" title="Clic para ampliar" /><div class="availability-product-info"><b>${esc(product.name)}</b><small>${esc(product.category || 'Sin categoría')} · estado sin cambios</small></div>${productActions(product)}</div>`).join('')}
        ${batch.ambiguousImages.map(image => `
          <div class="availability-match-row">
            <img class="update-preview-image" src="${image.imageThumbnail}" alt="Ampliar imagen de actualización" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" />
            <div><b>${esc(image.filename)}</b><small>Candidatos: ${image.candidates.map(item => `${esc(item.productName)} (distancia ${item.distance})`).join(' · ')}</small></div>
          </div>
        `).join('')}
      </section>` : ''}
      ${noReference.length ? `<section class="card availability-update-section">
        <h3>Sin imagen de referencia <span class="badge">${noReference.length}</span></h3>
        <p>Se excluyen de los cambios automáticos hasta que se agregue su referencia.</p>
        ${noReference.map(product => `<div class="availability-product-row"><div class="availability-empty-thumb">Sin referencia</div><div class="availability-product-info"><b>${esc(product.name)}</b><small>${esc(product.category || 'Sin categoría')} · estado sin cambios</small></div>${productActions(product)}</div>`).join('')}
      </section>` : ''}
      ${batch.unmatchedImages.length ? `<section class="card availability-update-section">
        <h3>Imágenes sin producto asociado · posibles productos nuevos <span class="badge">${batch.unmatchedImages.length}</span></h3>
        <div class="availability-image-grid">${batch.unmatchedImages.map(image => `<figure><img class="update-preview-image" src="${image.thumbnail}" alt="Ampliar imagen sin asociar" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" /><figcaption>${esc(image.filename)}</figcaption></figure>`).join('')}</div>
      </section>` : ''}
      ${batch.matches.length ? `<section class="card availability-update-section">
        <details><summary><b>Coincidencias claras (${batch.matches.length})</b></summary>
          <div class="availability-match-list">${batch.matches.map(match => `
            <div class="availability-match-row">
              <img class="update-preview-image" src="${match.imageThumbnail}" alt="Ampliar imagen disponible" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" />
              <span aria-hidden="true">→</span>
              <img class="update-preview-image" src="${match.referenceThumbnail}" alt="Ampliar referencia de ${esc(match.productName)}" role="button" tabindex="0" title="Clic para ampliar" loading="lazy" />
              <div class="availability-product-info"><b>${esc(match.productName)}</b><small>${esc(match.filename)} · distancia ${match.distance}</small></div>
              ${productsById.has(match.productId) ? productActions(productsById.get(match.productId)) : ''}
            </div>
          `).join('')}</div>
        </details>
      </section>` : ''}
      <div class="card availability-update-confirm">
        <label><input id="update-confirm-complete" type="checkbox" ${applied ? 'disabled' : ''} />
          Confirmo que las imágenes incluyen todos los productos disponibles publicados hoy por este proveedor.
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px">
          ${applied
            ? '<span class="badge badge--pending">Actualización aplicada</span><button type="button" class="btn btn--secondary" id="update-undo">Deshacer última actualización</button>'
            : '<button type="button" class="btn btn--primary" id="update-apply" disabled>Aplicar cambios de disponibilidad</button>'}
          <span style="font-size:.75rem;color:var(--text-muted)">Solo se modificarán productos con imagen de referencia y coincidencia o ausencia concluyente.</span>
        </div>
      </div>
    `;

    const confirmCheckbox = previewHost.querySelector('#update-confirm-complete');
    const applyButton = previewHost.querySelector('#update-apply');
    previewHost.querySelectorAll('.update-product-action').forEach(button => {
      button.addEventListener('click', () => handleProductAction(button));
    });
    previewHost.querySelectorAll('.update-preview-image').forEach(image => {
      const openImage = () => window._openLightbox([image.src]);
      image.addEventListener('click', openImage);
      image.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openImage();
      });
    });
    confirmCheckbox?.addEventListener('change', () => {
      applyButton.disabled = !confirmCheckbox.checked || !!hasErrors || changes.length === 0;
    });
    applyButton?.addEventListener('click', async () => {
      applyButton.disabled = true;
      let result;
      try {
        result = await api.applyAvailabilityUpdate(batch.batch_id, { confirm_complete_inventory: true });
      } catch (err) {
        applyButton.disabled = false;
        showToast(err.message, 'error');
        return;
      }
      applied = true;
      renderPreview();
      try {
        await invalidateProductsCache();
      } catch (err) {
        showToast(`La actualización fue aplicada, pero no se pudo invalidar la caché: ${err.message}`, 'warning');
      }
      refreshSidebarCounts();
      try {
        historyRows = await api.getAvailabilityUpdateHistory();
        renderHistory();
      } catch (err) {
        showToast(`La actualización fue aplicada, pero no se pudo actualizar el historial: ${err.message}`, 'warning');
      }
      await reportCatalogRefresh(result.message);
    });
    previewHost.querySelector('#update-undo')?.addEventListener('click', async (event) => {
      undoBatch(batch.batch_id, event.currentTarget);
    });
  }
}
