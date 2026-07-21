import { api } from '../db/api.js';
import { showToast } from '../core/app.js';
import { generatePDF, FIELD_LABELS, DEFAULT_FIELDS } from '../utils/pdfGenerator.js';
import { formatUSD, debounce } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STORAGE_KEY = 'danimarvis_export_config';

function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { style: 'table', fields: [...DEFAULT_FIELDS], header: 'DaniMarvis Store' };
}

function categoryOptions(products, selected = '') {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  return cats.map(c =>
    `<option value="${escHtml(c)}" ${selected === c ? 'selected' : ''}>${escHtml(c)}</option>`
  ).join('');
}

export async function renderNew(container, onDone) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando productos...</div>';

  try {
    const products = await api.getProducts();
    const config = loadConfig();
    renderForm(container, products, config, onDone);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderForm(container, products, config, onDone) {
  const selectedIds = new Set(products.map(p => p.id));
  const selectedFields = new Set(config.fields);
  let filterQ = '';
  let filterCat = '';

  function getFiltered() {
    return products.filter(p => {
      if (filterCat && p.category !== filterCat) return false;
      if (filterQ) {
        const q = filterQ.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.description || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  function updateSummary() {
    const el = document.getElementById('export-summary');
    if (el) el.textContent = `${selectedIds.size} producto(s) · ${selectedFields.size} campo(s)`;
    const btn = document.getElementById('export-generate');
    if (btn) btn.disabled = selectedIds.size === 0;
  }

  function updateSelectAll() {
    const filtered = getFiltered();
    const allVisible = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));
    const someVisible = filtered.some(p => selectedIds.has(p.id));
    const cb = document.getElementById('export-select-all');
    if (cb) {
      cb.checked = allVisible;
      cb.indeterminate = someVisible && !allVisible;
    }
    const label = document.getElementById('export-select-all-label');
    if (label) label.textContent = `Seleccionar todos (${filtered.length} productos)`;
  }

  function renderProductList() {
    const list = document.getElementById('export-product-list');
    if (!list) return;
    const filtered = getFiltered();
    list.innerHTML = filtered.map(p => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;font-size:.85rem;${selectedIds.has(p.id) ? 'background:var(--bg)' : ''}">
        <input type="checkbox" class="export-product-cb" value="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} />
        <span style="flex:1">${escHtml(p.name)}</span>
        <span style="color:var(--text-muted);font-size:.78rem">${p.category || '—'}</span>
        <span style="font-weight:600;font-size:.82rem">${formatUSD(p.price)}</span>
      </label>
    `).join('');
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Sin resultados</div>';
    }
    updateSelectAll();
    updateSummary();
  }

  container.innerHTML = `
    <div style="padding:16px">
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 12px;font-size:1rem">Filtrar productos</h3>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="export-search" class="form-control" placeholder="Buscar producto..." style="flex:1" />
          <select id="export-category" class="form-control form-control--small" style="max-width:200px">
            <option value="">Todas las categorías</option>
            ${categoryOptions(products)}
          </select>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <input type="checkbox" id="export-select-all" checked />
          <label for="export-select-all" style="font-size:.85rem;font-weight:500" id="export-select-all-label">
            Seleccionar todos (${products.length} productos)
          </label>
        </div>

        <div id="export-product-list" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
      </div>

      <div class="card" style="padding:20px;margin-top:12px">
        <h3 style="margin:0 0 12px;font-size:1rem">Campos a incluir</h3>
        <div id="export-fields-list" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          ${Object.keys(FIELD_LABELS).map(f => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" class="export-field-cb" value="${f}" ${selectedFields.has(f) ? 'checked' : ''} />
              ${FIELD_LABELS[f]}
            </label>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div id="export-summary" style="font-size:.82rem;color:var(--text-muted)">
          ${selectedIds.size} producto(s) · ${selectedFields.size} campo(s)
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn--secondary" id="export-cancel">Cancelar</button>
          <button class="btn btn--primary" id="export-generate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Generar PDF
          </button>
        </div>
      </div>
    </div>
  `;

  renderProductList();

  const debouncedSearch = debounce(() => {
    filterQ = document.getElementById('export-search').value;
    renderProductList();
  }, 200);

  document.getElementById('export-search').addEventListener('input', debouncedSearch);

  document.getElementById('export-category').addEventListener('change', (e) => {
    filterCat = e.target.value;
    renderProductList();
  });

  document.getElementById('export-select-all').addEventListener('change', (e) => {
    const filtered = getFiltered();
    if (e.target.checked) {
      filtered.forEach(p => selectedIds.add(p.id));
    } else {
      filtered.forEach(p => selectedIds.delete(p.id));
    }
    renderProductList();
  });

  document.getElementById('export-product-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('export-product-cb')) return;
    if (e.target.checked) {
      selectedIds.add(e.target.value);
    } else {
      selectedIds.delete(e.target.value);
    }
    updateSelectAll();
    updateSummary();
    e.target.closest('label').style.background = e.target.checked ? 'var(--bg)' : '';
  });

  document.getElementById('export-fields-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('export-field-cb')) return;
    if (e.target.checked) {
      selectedFields.add(e.target.value);
    } else {
      selectedFields.delete(e.target.value);
    }
    updateSummary();
  });

  document.getElementById('export-cancel').addEventListener('click', () => onDone());

  document.getElementById('export-generate').addEventListener('click', async () => {
    const selected = products.filter(p => selectedIds.has(p.id));
    const fields = [...selectedFields];
    const title = filterCat ? `Productos - ${filterCat}` : 'Productos';

    try {
      generatePDF(selected, {
        style: config.style,
        fields,
        title: `${title} (${selected.length} productos)`,
        header: config.header,
      });

      await api.createExport({
        title: `${title} (${selected.length} productos)`,
        style: config.style,
        fields,
        product_ids: [...selectedIds],
        product_count: selected.length,
      });

      showToast('PDF generado y exportación guardada', 'success');
      onDone();
    } catch (err) {
      showToast('Error al generar PDF: ' + err.message, 'error');
    }
  });
}
