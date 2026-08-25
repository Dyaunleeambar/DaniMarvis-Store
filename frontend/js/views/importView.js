import { api } from '../db/api.js';
import { showToast, openModal } from '../core/app.js';
import { openProductForm } from './productsView.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const EYE_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function suggestName(text) {
  const line = String(text || '').split('\n').map(l => l.trim()).find(l => l && !/^[💥✨‼️⭐🎁▪️•*#]/u.test(l));
  if (!line) return '';
  return line.replace(/^[💥✨‼️⭐🎁▪️•*#\s]+/u, '').replace(/\s+/g, ' ').slice(0, 80);
}

function updateEyeIcon(btn, card) {
  const visible = card.dataset.visible !== '0';
  btn.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
  btn.title = visible ? 'Visible en catálogo. Clic para ocultar.' : 'Oculto del catálogo. Clic para mostrar.';
  btn.style.color = visible ? 'var(--success)' : 'var(--text-muted)';
}

const FOLDER_KEY = 'danimarvis_import_folder';
const PROVIDER_KEY = 'danimarvis_import_provider';

function sanitizeFolderName(name) {
  return String(name || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|$/g, '');
}

function getProviderFolder(providerName) {
  return `D:\\Proyectos\\DaniMarvisStore\\precios-importacion\\${sanitizeFolderName(providerName)}`;
}

export async function renderImport(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando...</div>';
  try {
    const providers = await api.getProviders();
    renderForm(container, providers);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderForm(container, providers) {
  let providerId = localStorage.getItem(PROVIDER_KEY) || providers[0]?.id || '';
  const selectedProvider = providers.find(p => p.id === providerId);
  const folder = localStorage.getItem(FOLDER_KEY) || (selectedProvider ? getProviderFolder(selectedProvider.name) : '');
  let analyzeResult = null;
  let busy = false;

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Importar / Sincronizar</h1>
          <p>Actualizá precios y disponibilidad desde las imágenes que publica el proveedor</p>
        </div>
      </div>

      <div class="card" style="padding:20px;max-width:760px">
        <h3 style="margin:0 0 4px;font-size:1rem">Lista del proveedor</h3>
        <p style="margin:0 0 16px;font-size:.8rem;color:var(--text-secondary)">
          1) Elegí el proveedor y la carpeta donde guardaste las imágenes (una por producto).<br />
          2) El sistema lee cada imagen (nombre + precio USD) y propone el producto y el precio.<br />
          3) Revisás, corregís si hace falta y aplicás: actualiza precio, define si el producto está visible en el catálogo y elimina de la carpeta las imágenes ya aplicadas. Con el botón <b>+</b> creás un producto nuevo directamente desde la imagen.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Proveedor</label>
            <select id="imp-provider" class="form-control">
              ${providers.map(p => `<option value="${p.id}" ${p.id === providerId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Carpeta con las imágenes</label>
            <input type="text" id="imp-folder" class="form-control" value="${escHtml(folder)}" />
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn--primary" id="imp-analyze">Analizar imágenes</button>
            <span id="imp-status" style="font-size:.78rem;color:var(--text-muted)"></span>
          </div>
        </div>
      </div>

      <div id="imp-results" style="margin-top:16px"></div>
    </div>
  `;

  document.getElementById('imp-provider').addEventListener('change', (e) => {
    providerId = e.target.value;
    localStorage.setItem(PROVIDER_KEY, providerId);
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
    localStorage.setItem(FOLDER_KEY, folderVal);
    busy = true;
    btn.disabled = true;
    status.textContent = 'Analizando imágenes (OCR)... puede tardar un poco';
    try {
      const data = await api.importAnalyze({ folder: folderVal, provider_id: providerId });
      analyzeResult = data;
      status.textContent = '';
      renderResults(container, data);
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}

function renderResults(container, data) {
  const results = document.getElementById('imp-results');
  if (!results) return;
  if (data.message) {
    results.innerHTML = `<div class="card" style="padding:20px;color:var(--text-secondary);font-size:.85rem">${escHtml(data.message)}</div>`;
    return;
  }

  const itemsHtml = data.items.map((it, i) => {
    if (it.error) {
      return `
        <div class="card" style="padding:14px;font-size:.8rem">
          <b>${escHtml(it.filename)}</b> — <span style="color:var(--error)">${escHtml(it.error)}</span>
        </div>`;
    }
    const productOptions = data.products.map(p =>
      `<option value="${p.id}" ${it.product && p.id === it.product.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
    const matchBadge = it.product
      ? `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(37,211,102,.15);color:#1da851;font-weight:600">${it.product.confidence}% coincidencia</span>`
      : `<span style="font-size:.68rem;padding:2px 8px;border-radius:50px;background:rgba(184,134,11,.15);color:#b8860b;font-weight:600">Sin coincidencia</span>`;
    const current = it.product ? `$${Number(it.product.current_price).toLocaleString('es-CO')}` : '—';
    const priceVal = it.detected_price ? it.detected_price.value : (it.product ? it.product.current_price : '');
    const checked = it.product ? 'checked' : '';
    return `
      <div class="card" style="padding:16px;display:flex;gap:14px;align-items:flex-start" data-idx="${i}" data-visible="${it.product && !it.product.visible ? '0' : '1'}">
        <img src="${it.url}" alt="" class="imp-thumb" data-preview="${it.url}" title="Ver imagen ampliada" />
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:.85rem;cursor:pointer">
              <input type="checkbox" class="imp-apply" ${checked} /> Aplicar
            </label>
            ${matchBadge}
            <span style="font-size:.72rem;color:var(--text-muted);word-break:break-all;flex:1">${escHtml(it.filename)}</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:260px">
              <select class="imp-product form-control form-control--small" style="flex:1;min-width:150px">
                <option value="">— Sin producto / no aplicar —</option>
                ${productOptions}
              </select>
              <button type="button" class="btn btn--sm btn--ghost imp-new" title="Crear producto nuevo con los datos de esta imagen" style="padding:4px 7px;color:var(--rose);flex-shrink:0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button type="button" class="btn btn--sm btn--ghost imp-eye" title="Mostrar/ocultar en catálogo" style="padding:4px 7px;flex-shrink:0"></button>
            </div>
            <input type="number" step="any" min="1" class="imp-price form-control form-control--small" value="${priceVal}" style="max-width:110px" placeholder="Precio USD" />
            <span style="font-size:.78rem;color:var(--text-muted)">actual: ${current}</span>
          </div>
          <details style="font-size:.72rem;color:var(--text-muted)">
            <summary style="cursor:pointer">Texto detectado por OCR</summary>
            <pre style="white-space:pre-wrap;font-family:inherit;margin:6px 0 0;max-height:120px;overflow:auto">${escHtml(it.text || '—')}</pre>
          </details>
        </div>
      </div>`;
  }).join('');

  results.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:.85rem;color:var(--text-secondary)">
        Proveedor: <b>${escHtml(data.provider)}</b> · ${data.items.length} imagen(es)
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
        <input type="checkbox" id="imp-hide-absent" /> Ocultar productos del proveedor que no aparecen
      </label>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">${itemsHtml}</div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn--primary" id="imp-apply">Aplicar seleccionados</button>
      <span id="imp-apply-status" style="font-size:.8rem;color:var(--text-muted)"></span>
    </div>
    <div id="imp-apply-summary" style="margin-top:12px"></div>
  `;

  results.querySelectorAll('.imp-thumb').forEach(img => {
    img.addEventListener('click', () => {
      const url = img.dataset.preview;
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
          <img src="${escHtml(url)}" alt="" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain" />
        </div>
      `);
    });
  });

  results.querySelectorAll('.imp-eye').forEach(btn => {
    const card = btn.closest('[data-idx]');
    if (!card) return;
    updateEyeIcon(btn, card);
    btn.addEventListener('click', () => {
      card.dataset.visible = card.dataset.visible === '0' ? '1' : '0';
      updateEyeIcon(btn, card);
    });
  });

  results.querySelectorAll('.imp-new').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-idx]');
      if (!card) return;
      const idx = Number(card.dataset.idx);
      const it = data.items[idx];
      if (!it) return;
      const providerId = document.getElementById('imp-provider')?.value || '';
      const price = card.querySelector('.imp-price')?.value;
      try {
        await openProductForm(null, {
          providerId,
          images: it.url ? [it.url] : [],
          previewImage: it.url || '',
          catalogVisible: card.dataset.visible !== '0',
          name: suggestName(it.text),
          price: price || undefined,
          onCreated: async (newId) => {
            const created = await api.getProduct(newId);
            if (!data.products.some(p => p.id === created.id)) data.products.push(created);
            const select = card.querySelector('.imp-product');
            if (select) {
              select.insertAdjacentHTML('beforeend', `<option value="${created.id}" selected>${escHtml(created.name)}</option>`);
              select.value = created.id;
            }
            const apply = card.querySelector('.imp-apply');
            if (apply && !apply.checked) apply.checked = true;
          },
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  document.getElementById('imp-apply').addEventListener('click', async () => {
    const providerId = document.getElementById('imp-provider').value;
    const folder = document.getElementById('imp-folder').value.trim();
    const hideAbsent = document.getElementById('imp-hide-absent').checked;
    const cards = results.querySelectorAll('[data-idx]');
    const items = [];
    const appliedCards = [];
    cards.forEach(card => {
      const apply = card.querySelector('.imp-apply');
      if (!apply.checked) return;
      const productId = card.querySelector('.imp-product').value;
      const price = card.querySelector('.imp-price').value;
      if (!productId) return;
      const idx = Number(card.dataset.idx);
      const product = data.products.find(p => p.id === productId);
      const it = data.items[idx];
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
      const res = await api.importApply({ provider_id: providerId, items, hideAbsent, folder });
      status.textContent = '';
      appliedCards.forEach(card => card.remove());
      renderSummary(document.getElementById('imp-apply-summary'), res);
      const deletedNote = (res.deleted || []).length
        ? ` · ${res.deleted.length} imagen(es) eliminada(s) de la carpeta`
        : '';
      showToast(`${res.applied.length} producto(s) actualizado(s)${deletedNote}`, 'success');
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
