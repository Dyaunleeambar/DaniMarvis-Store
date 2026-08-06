import { api } from '../db/api.js';
import { showToast, openModal } from '../core/app.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const FOLDER_KEY = 'danimarvis_import_folder';
const PROVIDER_KEY = 'danimarvis_import_provider';
const DEFAULT_FOLDER = 'D:\\Proyectos\\DaniMarvisStore\\prueba-precios.png';

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
  const folder = localStorage.getItem(FOLDER_KEY) || DEFAULT_FOLDER;
  let providerId = localStorage.getItem(PROVIDER_KEY) || providers[0]?.id || '';
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
          3) Revisás, corregís si hace falta y aplicás: actualiza precio y deja el producto disponible.
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
      <div class="card" style="padding:16px;display:flex;gap:14px;align-items:flex-start" data-idx="${i}">
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
            <select class="imp-product form-control form-control--small" style="flex:1;min-width:220px">
              <option value="">— Sin producto / no aplicar —</option>
              ${productOptions}
            </select>
            <input type="number" step="any" min="1" class="imp-price form-control form-control--small" value="${priceVal}" style="max-width:120px" placeholder="Precio USD" />
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

  document.getElementById('imp-apply').addEventListener('click', async () => {
    const providerId = document.getElementById('imp-provider').value;
    const hideAbsent = document.getElementById('imp-hide-absent').checked;
    const cards = results.querySelectorAll('[data-idx]');
    const items = [];
    cards.forEach(card => {
      const apply = card.querySelector('.imp-apply');
      if (!apply.checked) return;
      const productId = card.querySelector('.imp-product').value;
      const price = card.querySelector('.imp-price').value;
      if (!productId) return;
      const idx = Number(card.dataset.idx);
      const product = data.products.find(p => p.id === productId);
      items.push({ product_id: productId, product_name: product ? product.name : '', price });
      card.dataset.applied = '1';
    });
    if (!items.length) { showToast('Marcá al menos un producto para aplicar', 'error'); return; }
    const btn = document.getElementById('imp-apply');
    const status = document.getElementById('imp-apply-status');
    btn.disabled = true;
    status.textContent = 'Aplicando...';
    try {
      const res = await api.importApply({ provider_id: providerId, items, hideAbsent });
      status.textContent = '';
      renderSummary(document.getElementById('imp-apply-summary'), res);
      showToast(`${res.applied.length} producto(s) actualizado(s)`, 'success');
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
    `<div style="font-size:.8rem">✓ <b>${escHtml(a.name || a.product_id)}</b> → $${Number(a.price).toLocaleString('es-CO')} y disponible</div>`
  ).join('');
  const hiddenRows = (res.hidden || []).map(h =>
    `<div style="font-size:.8rem;color:#b8860b">👁 Ocultado: ${escHtml(h.name)}</div>`
  ).join('');
  const errRows = (res.errors || []).map(e =>
    `<div style="font-size:.8rem;color:var(--error)">✗ ${escHtml(e.name || e.product_id)}: ${escHtml(e.error)}</div>`
  ).join('');
  el.innerHTML = `
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:4px">
      ${appliedRows || '<div style="font-size:.8rem;color:var(--text-muted)">Ningún producto aplicado</div>'}
      ${hiddenRows}
      ${errRows}
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
