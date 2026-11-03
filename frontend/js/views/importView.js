import { api } from '../db/api.js';
import { showToast, openModal } from '../core/app.js';
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
  let engine = localStorage.getItem(ENGINE_KEY) || 'local';
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
          3) Revisá, corregís si hace falta y aplicás: actualiza precio, define si el producto está visible en el catálogo y elimina de la carpeta las imágenes ya aplicadas. Con el botón <b>+</b> creás un producto nuevo directamente desde la imagen.
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
          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Motor de lectura</label>
            <select id="imp-engine" class="form-control">
              <option value="local" ${engine === 'local' ? 'selected' : ''}>Local (OCR, sin internet)</option>
              <option value="vision" ${engine === 'vision' ? 'selected' : ''}>IA · visión (varios productos por imagen)</option>
            </select>
            <p style="margin:4px 0 0;font-size:.72rem;color:var(--text-muted)">
              IA usa la API de Ajustes &gt; Publicaciones y necesita un modelo con visión. Es más preciso y detecta varios productos en una misma foto.
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn--primary" id="imp-analyze">Analizar imágenes</button>
            <span id="imp-status" style="font-size:.78rem;color:var(--text-muted)"></span>
          </div>
        </div>
      </div>

      <div id="imp-results" class="import-view" style="margin-top:16px"></div>
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

  const categories = [...new Set(data.products.map(p => p.category).filter(Boolean))].sort();

  // Estado de selección de imagen activa en el carrusel
  let activeImgIndex = 0;

  // ---------- CARRUSEL INFERIOR (imágenes crudas) ----------
  const validItems = data.items.filter(i => i.filename && !i.error);
  const carouselHtml = `
    <div class="import-carousel">
      <button type="button" class="carousel-arrow carousel-prev" aria-label="Imagen anterior">&#9664;</button>
      <div class="carousel-track" id="carousel-track">
        ${validItems.map((it, idx) => `
          <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
            <img src="${escHtml(it.url)}" alt="${escHtml(it.filename)}" loading="lazy" />
            <div class="carousel-caption">${escHtml(it.filename)}</div>
          </div>
        `).join('')}
      </div>
      <button type="button" class="carousel-arrow carousel-next" aria-label="Imagen siguiente">&#9654;</button>
      <div class="carousel-counter" id="carousel-counter">${activeImgIndex + 1} / ${validItems.length}</div>
    </div>
  `;

  // ---------- LISTA IZQUIERDA (procesados, resumida) ----------
  const itemsHtml = validItems.map((it, i) => {
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
      <div class="import-card-left" data-idx="${i}" data-visible="${it.product && !it.product.visible ? '0' : '1'}" data-img-idx="${i}">
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
    `;
  }).join('');

  // ---------- LISTA DERECHA (catálogo del proveedor) ----------
  const providerProducts = data.products;
  const rightListHtml = providerProducts.map(p => {
    const visible = p.catalog_visible !== 0;
    return `
      <div class="import-card-right" data-pid="${p.id}" data-cat="${escAttr(p.category || '')}" data-visible="${visible ? '1' : '0'}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600">${escHtml(p.name)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">$${Number(p.price).toLocaleString('es-CO')} · ${p.category || 'sin categoría'} · stock ${p.stock}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <button type="button" class="btn btn--sm btn--ghost imp-eye-right" title="${visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" style="padding:3px 6px;"></button>
            <span style="font-size:.7rem;padding:2px 6px;border-radius:10px;background:${visible ? 'rgba(37,211,102,.15)' : 'rgba(184,134,11,.15)'};color:${visible ? '#1da851' : '#b8860b'}">${visible ? 'Visible' : 'Oculto'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  results.innerHTML = `
    <div class="import-layout">
      <!-- Área superior: dos columnas iguales (2/3 del alto) -->
      <div class="import-top">
        <div class="import-panel import-left">
          <div class="import-panel-header">
            <span style="font-weight:600">Productos analizados</span>
            <span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">${validItems.length} imagen(es)</span>
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
            ${rightListHtml}
          </div>
        </div>
      </div>

      <!-- Área inferior: carrusel de imágenes crudas (1/3 del alto) -->
      ${carouselHtml}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:14px">
        <label style="display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer">
          <input type="checkbox" id="imp-toggle-all" checked /> Marcar / desmarcar todos
        </label>
        <div style="font-size:.85rem;color:var(--text-secondary)">
          Proveedor: <b>${escHtml(data.provider)}</b> · ${validItems.length} imagen(es) · ${data.items.filter(i => !i.error).length} producto(s) detectado(s)
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
        <input type="checkbox" id="imp-hide-absent" /> Ocultar productos del proveedor que no aparecen
      </label>
    </div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn--primary" id="imp-apply">Aplicar seleccionados</button>
      <span id="imp-apply-status" style="font-size:.8rem;color:var(--text-muted)"></span>
    </div>
    <div id="imp-apply-summary" style="margin-top:12px"></div>
  `;

  // ---------- CARRUSEL: navegación ----------
  const track = document.getElementById('carousel-track');
  const counter = document.getElementById('carousel-counter');
  const btnPrev = results.querySelector('.carousel-prev');
  const btnNext = results.querySelector('.carousel-next');

  function renderCarousel() {
    track.innerHTML = validItems.map((it, idx) => `
      <div class="carousel-item${idx === activeImgIndex ? ' active' : ''}" data-idx="${idx}">
        <img src="${escHtml(it.url)}" alt="${escHtml(it.filename)}" loading="lazy" />
        <div class="carousel-caption">${escHtml(it.filename)}</div>
      </div>
    `).join('');
    counter.textContent = `${activeImgIndex + 1} / ${validItems.length}`;
    // Resaltar item correspondiente en lista izquierda
    results.querySelectorAll('.import-card-left').forEach(card => {
      const imgIdx = Number(card.dataset.imgIdx);
      card.classList.toggle('linked-active', imgIdx === activeImgIndex);
    });
  }

  btnPrev.addEventListener('click', () => {
    activeImgIndex = (activeImgIndex - 1 + validItems.length) % validItems.length;
    renderCarousel();
    scrollCarouselToActive();
  });

  btnNext.addEventListener('click', () => {
    activeImgIndex = (activeImgIndex + 1) % validItems.length;
    renderCarousel();
    scrollCarouselToActive();
  });

  function scrollCarouselToActive() {
    const activeEl = track.querySelector('.carousel-item.active');
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // Teclado: flechas izquierda/derecha
  results.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); activeImgIndex = (activeImgIndex - 1 + validItems.length) % validItems.length; renderCarousel(); scrollCarouselToActive(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); activeImgIndex = (activeImgIndex + 1) % validItems.length; renderCarousel(); scrollCarouselToActive(); }
  });
  results.setAttribute('tabindex', '0');

  // Clic en imagen del carrusel: abre vista previa y marca como activa
  track.addEventListener('click', (e) => {
    const item = e.target.closest('.carousel-item');
    if (!item) return;
    const idx = Number(item.dataset.idx);
    const it = validItems[idx];
    activeImgIndex = idx;
    renderCarousel();
    scrollCarouselToActive();
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
        <img src="${escHtml(it.url)}" alt="" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain" />
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

  results.querySelectorAll('.import-card-left').forEach(card => {
    const catSel = card.querySelector('.imp-filter-cat');
    if (!catSel) return;
    function renderCardOptions() {
      const cat = catSel.value;
      const select = card.querySelector('.imp-product');
      const currentVal = select.value;
      const pool = data.products.filter(p => {
        if (cat && p.category !== cat) return false;
        return true;
      });
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
    catSel.addEventListener('change', renderCardOptions);
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
    }).map(p => {
      const visible = p.catalog_visible !== 0;
      return `
        <div class="import-card-right" data-pid="${p.id}" data-cat="${escAttr(p.category || '')}" data-visible="${visible ? '1' : '0'}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:.8rem;font-weight:600">${escHtml(p.name)}</div>
              <div style="font-size:.72rem;color:var(--text-muted)">$${Number(p.price).toLocaleString('es-CO')} · ${p.category || 'sin categoría'} · stock ${p.stock}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button type="button" class="btn btn--sm btn--ghost imp-eye-right" title="${visible ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}" style="padding:3px 6px;"></button>
              <span style="font-size:.7rem;padding:2px 6px;border-radius:10px;background:${visible ? 'rgba(37,211,102,.15)' : 'rgba(184,134,11,.15)'};color:${visible ? '#1da851' : '#b8860b'}">${visible ? 'Visible' : 'Oculto'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    listRight.innerHTML = html;
    listRight.querySelectorAll('.imp-eye-right').forEach(btn => {
      const card = btn.closest('.import-card-right');
      const visible = card.dataset.visible !== '0';
      updateEyeIcon(btn, visible);
      btn.addEventListener('click', () => {
        card.dataset.visible = card.dataset.visible === '0' ? '1' : '0';
        const newVisible = card.dataset.visible !== '0';
        updateEyeIcon(btn, newVisible);
        // Actualizar en data.products también
        const p = providerProducts.find(pr => pr.id === card.dataset.pid);
        if (p) p.catalog_visible = newVisible ? 1 : 0;
      });
    });
  }

  filterCatRight.addEventListener('change', renderRightList);
  filterVisRight.addEventListener('change', renderRightList);
  filterSearchRight.addEventListener('input', renderRightList);

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
      if (!apply.checked) return;
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
      const deletedNote = (res.deleted || []).length
        ? ` · ${res.deleted.length} imagen(es) eliminada(s) de la carpeta`
        : '';
      showToast(`${res.applied.length} producto(s) actualizado(s)${deletedNote}`, 'success');
      // Refrescar carrusel si se eliminaron imágenes aplicadas
      if (res.deleted && res.deleted.length) {
        // Volver a renderizar resultados para sincronizar carrusel con carpetas restantes
        // (se asume que el servidor ya eliminó los archivos)
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
