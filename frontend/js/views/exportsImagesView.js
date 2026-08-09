import { api } from '../db/api.js';
import { showToast } from '../core/app.js';
import { generateProductImage, canvasToBlob, downloadCanvas, slugify, TEMPLATES, ACCENT_COLORS } from '../utils/imageGenerator.js';
import { debounce, extractSlogan } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STORAGE_KEY = 'danimarvis_images_config';
const PROMPT_KEY = 'danimarvis_images_prompt';
const COPILOT_FOLDER_KEY = 'danimarvis_images_copilot_folder';

function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    template: 'clasica',
    ctaText: '📲  Escríbeme y llévate este producto',
    whatsappText: '💬  Comprar por WhatsApp',
    showLogo: true,
    accentColor: '#c9847a',
  };
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function categoryOptions(products, selected = '') {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  return cats.map(c =>
    `<option value="${escHtml(c)}" ${selected === c ? 'selected' : ''}>${escHtml(c)}</option>`
  ).join('');
}

export async function renderImages(container, onDone) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando productos...</div>';

  try {
    const products = await api.getProducts();
    renderForm(container, products, onDone);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderForm(container, products, onDone) {
  const config = loadConfig();
  const selectedIds = new Set(products.map(p => p.id));
  let filterQ = '';
  let filterCat = '';
  let previewProductId = products[0]?.id || '';
  let aiEnabled = !!localStorage.getItem('ai_bg');
  let aiBg = localStorage.getItem('ai_bg') || '';
  let aiPrompt = localStorage.getItem(PROMPT_KEY) || '';
  let aiBusy = false;
  let copilotFolder = localStorage.getItem(COPILOT_FOLDER_KEY) || 'D:\\Proyectos\\DaniMarvisStore\\generadas\\copilot';
  let previewCounter = 0;

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

  function getSelected() {
    return products.filter(p => selectedIds.has(p.id));
  }

  function getPreviewProduct() {
    return products.find(p => p.id === previewProductId) || getSelected()[0] || products[0] || null;
  }

  function updateSummary() {
    const el = document.getElementById('img-summary');
    if (el) el.textContent = `${selectedIds.size} producto(s) seleccionado(s)`;
    const btn1 = document.getElementById('img-download-selected');
    const btn2 = document.getElementById('img-download-zip');
    const disabled = selectedIds.size === 0;
    if (btn1) btn1.disabled = disabled;
    if (btn2) btn2.disabled = disabled;
  }

  function updateSelectAll() {
    const filtered = getFiltered();
    const allVisible = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));
    const someVisible = filtered.some(p => selectedIds.has(p.id));
    const cb = document.getElementById('img-select-all');
    if (cb) {
      cb.checked = allVisible;
      cb.indeterminate = someVisible && !allVisible;
    }
    const label = document.getElementById('img-select-all-label');
    if (label) label.textContent = `Seleccionar todos (${filtered.length} productos)`;
  }

  function renderProductList() {
    const list = document.getElementById('img-product-list');
    if (!list) return;
    const filtered = getFiltered();
    list.innerHTML = filtered.map(p => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;font-size:.85rem;${selectedIds.has(p.id) ? 'background:var(--bg)' : ''}">
        <input type="checkbox" class="img-product-cb" value="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''} />
        <span style="flex:1">${escHtml(p.name)}</span>
        <span style="color:var(--text-muted);font-size:.78rem">${escHtml(p.category || '—')}</span>
        <span style="font-weight:600;font-size:.82rem">${formatPrice(p.price)}</span>
        <button type="button" class="btn btn--sm btn--ghost img-copilot-copy" data-id="${p.id}" title="Copiar prompt para Copilot/Dreamina" style="padding:2px 6px;font-size:.85rem">📋</button>
      </label>
    `).join('');
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Sin resultados</div>';
    }
    updateSelectAll();
    updateSummary();
  }

  function renderPreviewProductSelect() {
    const sel = document.getElementById('img-preview-product');
    if (!sel) return;
    const selected = getSelected();
    if (!selected.some(p => p.id === previewProductId)) {
      previewProductId = selected[0]?.id || '';
    }
    sel.innerHTML = selected.map(p =>
      `<option value="${p.id}" ${p.id === previewProductId ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
    if (selected.length === 0) {
      sel.innerHTML = '<option value="">—</option>';
    }
  }

  function currentOptions() {
    return {
      template: config.template,
      ctaText: config.ctaText,
      whatsappText: config.whatsappText,
      showLogo: config.showLogo,
      accentColor: config.accentColor,
      backgroundImage: aiEnabled ? aiBg : '',
    };
  }

  const refreshPreview = debounce(async () => {
    const product = getPreviewProduct();
    const img = document.getElementById('img-preview');
    if (!img) return;
    if (!product) {
      img.src = '';
      img.style.opacity = '.2';
      return;
    }
    img.style.opacity = '.3';
    const myId = ++previewCounter;
    try {
      const canvas = await generateProductImage(product, currentOptions());
      if (myId !== previewCounter) return;
      img.src = canvas.toDataURL('image/png');
      img.style.opacity = '1';
    } catch (err) {
      if (myId !== previewCounter) return;
      img.src = '';
      img.style.opacity = '.2';
      showToast('Error en vista previa: ' + err.message, 'error');
    }
  }, 250);

  function refreshAiFieldsVisibility() {
    const fields = document.getElementById('img-ai-fields');
    if (fields) fields.style.display = aiEnabled ? '' : 'none';
    const remove = document.getElementById('img-ai-remove');
    if (remove) remove.style.display = aiEnabled && aiBg ? '' : 'none';
  }

  function renderAiThumb() {
    const box = document.getElementById('img-ai-thumb');
    if (!box) return;
    if (aiBg) {
      box.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${aiBg}" alt="Fondo IA" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border)" />
          <button type="button" class="btn btn--sm btn--ghost" id="img-ai-remove" style="color:var(--error)">Quitar fondo</button>
        </div>
      `;
      document.getElementById('img-ai-remove').addEventListener('click', () => {
        aiBg = '';
        localStorage.removeItem('ai_bg');
        refreshAiFieldsVisibility();
        renderAiThumb();
        refreshPreview();
        showToast('Fondo IA eliminado');
      });
    } else {
      box.innerHTML = '';
    }
  }

  container.innerHTML = `
    <div style="padding:16px">
      <div style="display:grid;grid-template-columns:1fr 340px;gap:12px;align-items:start">

        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="card" style="padding:20px">
            <h3 style="margin:0 0 12px;font-size:1rem">Filtrar productos</h3>
            <div style="display:flex;gap:8px;margin-bottom:16px">
              <input type="text" id="img-search" class="form-control" placeholder="Buscar producto..." style="flex:1" />
              <select id="img-category" class="form-control form-control--small" style="max-width:200px">
                <option value="">Todas las categorías</option>
                ${categoryOptions(products)}
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border)">
              <input type="checkbox" id="img-select-all" checked />
              <label for="img-select-all" style="font-size:.85rem;font-weight:500" id="img-select-all-label">
                Seleccionar todos (${products.length} productos)
              </label>
            </div>
            <div id="img-product-list" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
          </div>

          <div class="card" style="padding:20px">
            <h3 style="margin:0 0 12px;font-size:1rem">Plantilla</h3>
            <div id="img-template-list" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
              ${TEMPLATES.map(t => `
                <label style="cursor:pointer">
                  <input type="radio" name="img-template" value="${t.id}" ${config.template === t.id ? 'checked' : ''} style="display:none" />
                  <div class="card" id="img-tpl-${t.id}" style="padding:14px;text-align:center;border:2px solid ${config.template === t.id ? 'var(--rose)' : 'var(--border)'}">
                    <div style="height:44px;border-radius:6px;margin-bottom:8px;background:${t.id === 'moderna' ? 'linear-gradient(135deg,#221815,#3a2b26)' : t.id === 'oferta' ? 'linear-gradient(135deg,#fef3f1,#e8b4ad)' : t.id === 'minimal' ? '#ffffff' : 'linear-gradient(135deg,#ffffff,#faf8f6)'};border:1px solid var(--border)"></div>
                    <div style="font-size:.85rem;font-weight:600">${t.name}</div>
                    <div style="font-size:.72rem;color:var(--text-muted)">${t.description}</div>
                  </div>
                </label>
              `).join('')}
            </div>

            <h3 style="margin:0 0 12px;font-size:1rem">Personalizar</h3>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div>
                <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Texto del CTA</label>
                <input type="text" id="img-cta" class="form-control" value="${escHtml(config.ctaText)}" />
              </div>
              <div>
                <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Texto del botón WhatsApp</label>
                <input type="text" id="img-whatsapp" class="form-control" value="${escHtml(config.whatsappText)}" />
              </div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
                <input type="checkbox" id="img-logo" ${config.showLogo ? 'checked' : ''} /> Mostrar logo de la tienda
              </label>
              <div>
                <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:6px">Color de acento</label>
                <div id="img-accent-options" style="display:flex;gap:8px">
                  ${ACCENT_COLORS.map(c => `
                    <label style="cursor:pointer" title="${c.name}">
                      <input type="radio" name="img-accent" value="${c.value}" ${config.accentColor === c.value ? 'checked' : ''} style="display:none" />
                      <span data-value="${c.value}" style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${c.value};border:3px solid ${config.accentColor === c.value ? 'var(--text)' : 'transparent'};box-sizing:border-box"></span>
                    </label>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="card" style="padding:20px">
            <h3 style="margin:0 0 4px;font-size:1rem">Fondo IA (gratis)</h3>
            <p style="margin:0 0 12px;font-size:.78rem;color:var(--text-secondary)">
              Generá un fondo creativo con IA gratuita (Pollinations). Sin token ni cuenta. El texto y el producto se dibujan encima.
            </p>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;margin-bottom:12px">
              <input type="checkbox" id="img-ai-enabled" ${aiEnabled ? 'checked' : ''} /> Usar fondo generado por IA
            </label>
            <div id="img-ai-fields" style="display:${aiEnabled ? '' : 'none'};flex-direction:column;gap:10px">
              <div>
                <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Prompt (qué querés ver de fondo)</label>
                <textarea id="img-ai-prompt" class="form-control" rows="2" placeholder="Ej: fondo de estudio minimalista, tonos pastel, luz suave, sin texto">${escHtml(aiPrompt)}</textarea>
                <small style="color:var(--text-muted);font-size:.72rem">La primera generación puede tardar hasta ~60 segundos</small>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <button type="button" class="btn btn--primary" id="img-ai-generate">Generar fondo</button>
                <span id="img-ai-status" style="font-size:.78rem;color:var(--text-muted)"></span>
              </div>
            </div>
            <div id="img-ai-thumb" style="margin-top:12px"></div>
          </div>

          <div class="card" style="padding:20px">
            <h3 style="margin:0 0 4px;font-size:1rem">Anuncios con Copilot / Dreamina</h3>
            <p style="margin:0 0 12px;font-size:.78rem;color:var(--text-secondary)">
              1) Tocá <b>📋</b> junto a un producto para copiar el prompt y el nombre sugerido del archivo.<br />
              2) Generá el anuncio en Copilot o Dreamina y guardalo en la carpeta con ese nombre.<br />
              3) Importá la carpeta: las imágenes se archivan en el historial y se asocian al producto.
            </p>
            <div style="display:flex;gap:8px;margin-top:10px">
              <input type="text" id="img-copilot-folder" class="form-control" value="${escHtml(copilotFolder)}" style="flex:1" placeholder="Ruta de la carpeta con los anuncios" />
              <button type="button" class="btn btn--primary" id="img-copilot-import">Importar</button>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-secondary);margin-top:8px;cursor:pointer">
              <input type="checkbox" id="img-copilot-assign" checked style="width:14px;height:14px" />
              Asignar imagen principal al producto (prepende en la galería)
            </label>
            <div id="img-copilot-status" style="font-size:.78rem;color:var(--text-muted);margin-top:8px"></div>
            <div id="img-copilot-results" style="margin-top:12px"></div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="card" style="padding:16px">
            <h3 style="margin:0 0 10px;font-size:1rem">Vista previa</h3>
            <select id="img-preview-product" class="form-control form-control--small" style="margin-bottom:10px"></select>
            <img id="img-preview" src="" alt="Vista previa" style="width:100%;border-radius:8px;border:1px solid var(--border);background:var(--bg)" />
            <div style="text-align:center;font-size:.72rem;color:var(--text-muted);margin-top:6px">1080 × 1080 px · PNG</div>
          </div>

          <div class="card" style="padding:16px">
            <div id="img-summary" style="font-size:.82rem;color:var(--text-muted);margin-bottom:10px"></div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button class="btn btn--primary" id="img-download-selected">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Descargar seleccionadas (PNG)
              </button>
              <button class="btn btn--secondary" id="img-download-zip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Descargar todas en ZIP
              </button>
              <button class="btn btn--ghost" id="img-cancel">Cancelar</button>
            </div>
            <div id="img-progress" style="font-size:.78rem;color:var(--text-muted);margin-top:10px"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderProductList();
  renderPreviewProductSelect();
  renderAiThumb();
  refreshPreview();

  const debouncedSearch = debounce(() => {
    filterQ = document.getElementById('img-search').value;
    renderProductList();
  }, 200);

  document.getElementById('img-search').addEventListener('input', debouncedSearch);

  document.getElementById('img-category').addEventListener('change', (e) => {
    filterCat = e.target.value;
    renderProductList();
  });

  document.getElementById('img-select-all').addEventListener('change', (e) => {
    const filtered = getFiltered();
    if (e.target.checked) {
      filtered.forEach(p => selectedIds.add(p.id));
    } else {
      filtered.forEach(p => selectedIds.delete(p.id));
    }
    renderProductList();
    renderPreviewProductSelect();
    refreshPreview();
  });

  document.getElementById('img-product-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('img-product-cb')) return;
    if (e.target.checked) {
      selectedIds.add(e.target.value);
    } else {
      selectedIds.delete(e.target.value);
    }
    updateSelectAll();
    updateSummary();
    e.target.closest('label').style.background = e.target.checked ? 'var(--bg)' : '';
    renderPreviewProductSelect();
    refreshPreview();
  });

  document.getElementById('img-preview-product').addEventListener('change', (e) => {
    previewProductId = e.target.value;
    refreshPreview();
  });

  document.getElementById('img-template-list').addEventListener('change', (e) => {
    if (e.target.name !== 'img-template') return;
    config.template = e.target.value;
    container.querySelectorAll('[id^="img-tpl-"]').forEach(el => { el.style.borderColor = 'var(--border)'; });
    document.getElementById(`img-tpl-${config.template}`).style.borderColor = 'var(--rose)';
    saveConfig(config);
    refreshPreview();
  });

  const saveAndRefresh = (e) => {
    config.ctaText = document.getElementById('img-cta').value;
    config.whatsappText = document.getElementById('img-whatsapp').value;
    config.showLogo = document.getElementById('img-logo').checked;
    saveConfig(config);
    refreshPreview();
  };

  document.getElementById('img-cta').addEventListener('input', debounce(saveAndRefresh, 300));
  document.getElementById('img-whatsapp').addEventListener('input', debounce(saveAndRefresh, 300));
  document.getElementById('img-logo').addEventListener('change', saveAndRefresh);

  document.getElementById('img-accent-options').addEventListener('change', (e) => {
    if (e.target.name !== 'img-accent') return;
    config.accentColor = e.target.value;
    document.querySelectorAll('#img-accent-options span[data-value]').forEach(el => {
      el.style.borderColor = el.dataset.value === config.accentColor ? 'var(--text)' : 'transparent';
    });
    saveConfig(config);
    refreshPreview();
  });

  // ── IA ────────────────────────────────────────────────────────

  document.getElementById('img-ai-enabled').addEventListener('change', (e) => {
    aiEnabled = e.target.checked;
    if (!aiEnabled) {
      aiBg = '';
      localStorage.removeItem('ai_bg');
    }
    refreshAiFieldsVisibility();
    renderAiThumb();
    refreshPreview();
  });

  document.getElementById('img-ai-generate').addEventListener('click', async () => {
    if (aiBusy) return;
    const prompt = document.getElementById('img-ai-prompt').value.trim();
    const status = document.getElementById('img-ai-status');
    const btn = document.getElementById('img-ai-generate');

    if (!prompt) { showToast('Escribí un prompt para el fondo', 'error'); return; }

    aiPrompt = prompt;
    localStorage.setItem(PROMPT_KEY, prompt);

    aiBusy = true;
    btn.disabled = true;
    status.textContent = 'Generando fondo (puede tardar hasta ~60 s)...';

    try {
      const data = await api.generateImage({ prompt });
      aiBg = data.dataUrl;
      localStorage.setItem('ai_bg', aiBg);
      renderAiThumb();
      refreshPreview();
      status.textContent = 'Fondo generado ✓';
      showToast('Fondo IA generado', 'success');
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      aiBusy = false;
      btn.disabled = false;
    }
  });

  // ── Copilot / Dreamina ────────────────────────────────────────

  document.getElementById('img-product-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button.img-copilot-copy');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const product = products.find(p => p.id === btn.dataset.id);
    if (!product) return;
    const prompt = buildCopilotPrompt(product);
    const slug = slugify(product.name);
    copyText(prompt).then(() => {
      showToast(`Prompt copiado. Guardá la imagen como ${slug}.png`, 'success');
    }).catch(() => {
      showToast('No se pudo copiar al portapapeles', 'error');
    });
  });

  document.getElementById('img-copilot-import').addEventListener('click', async () => {
    const folder = document.getElementById('img-copilot-folder').value.trim();
    const assignToProduct = document.getElementById('img-copilot-assign').checked;
    const status = document.getElementById('img-copilot-status');
    const results = document.getElementById('img-copilot-results');
    const btn = document.getElementById('img-copilot-import');
    if (!folder) { showToast('Indicá la ruta de la carpeta', 'error'); return; }
    localStorage.setItem(COPILOT_FOLDER_KEY, folder);
    btn.disabled = true;
    status.textContent = 'Importando...';
    results.innerHTML = '';
    try {
      const data = await api.copilotImport({ folder, assignToProduct });
      status.textContent = '';
      renderCopilotResults(results, data);
      showToast('Importación completada', 'success');
    } catch (err) {
      status.textContent = '';
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Descargas ─────────────────────────────────────────────────

  async function recordHistory(products, title) {
    try {
      await api.createExport({
        title,
        style: config.template,
        kind: 'images',
        fields: JSON.stringify({
          ctaText: config.ctaText,
          whatsappText: config.whatsappText,
          showLogo: config.showLogo,
          accentColor: config.accentColor,
          ai: !!aiEnabled,
        }),
        product_ids: products.map(p => p.id),
        product_count: products.length,
      });
    } catch (err) {
      console.warn('[Imágenes] No se pudo guardar en historial:', err.message);
    }
  }

  document.getElementById('img-download-selected').addEventListener('click', async () => {
    const selected = getSelected();
    if (selected.length === 0) return;
    const progress = document.getElementById('img-progress');
    const btn = document.getElementById('img-download-selected');
    btn.disabled = true;
    try {
      for (let i = 0; i < selected.length; i++) {
        progress.textContent = `Generando ${i + 1}/${selected.length}...`;
        const canvas = await generateProductImage(selected[i], currentOptions());
        await downloadCanvas(canvas, `${slugify(selected[i].name)}.png`);
      }
      progress.textContent = 'Listo ✓';
      await recordHistory(selected, `Imágenes (${selected.length} productos)`);
      showToast(`${selected.length} imagen(es) descargada(s)`, 'success');
    } catch (err) {
      progress.textContent = '';
      showToast('Error al generar imágenes: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('img-download-zip').addEventListener('click', async () => {
    const selected = getSelected();
    if (selected.length === 0) return;
    if (!window.JSZip) {
      showToast('La librería JSZip no está cargada', 'error');
      return;
    }
    const progress = document.getElementById('img-progress');
    const btn = document.getElementById('img-download-zip');
    btn.disabled = true;
    try {
      const zip = new JSZip();
      for (let i = 0; i < selected.length; i++) {
        progress.textContent = `Generando ${i + 1}/${selected.length}...`;
        const canvas = await generateProductImage(selected[i], currentOptions());
        const blob = await canvasToBlob(canvas, 'image/jpeg');
        zip.file(`${slugify(selected[i].name)}.jpg`, blob);
      }
      progress.textContent = 'Empaquetando ZIP...';
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `danimarvis-imagenes-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      progress.textContent = 'Listo ✓';
      await recordHistory(selected, `Imágenes ZIP (${selected.length} productos)`);
      showToast(`ZIP con ${selected.length} imagen(es) descargado`, 'success');
    } catch (err) {
      progress.textContent = '';
      showToast('Error al generar ZIP: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('img-cancel').addEventListener('click', () => onDone());
}

function formatPrice(price) {
  return '$' + Number(price || 0).toLocaleString('es-CO');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

function buildCopilotPrompt(product) {
  const nameUpper = (product.name || '').trim().toUpperCase();
  const priceText = `$${Math.round(Number(product.price) || 0)} USD`;
  const warrantyTime = product.warranty || '15 días';
  const slogan = extractSlogan(product);
  const sloganSection = slogan
    ? `- Eslogan en cursiva blanca elegante: "${slogan}".`
    : '- Sin eslogan (omitir esta línea).';

  return `Diseño publicitario premium estilo DaniMarvis Store Simplificado Premium.
Formato: 1:1 (cuadrado, 1080x1080).

Fondo:
Degradado diagonal azul oscuro (izquierda) → naranja vibrante (derecha),
con línea divisoria suave en el footer.

Composición:
Producto principal centrado, recortado profesionalmente, sin fondo blanco.
Sombra integrada realista y reflejo sutil bajo el producto.
Si existen variantes (colores/modelos), colocarlas de forma simétrica.
Si el producto NO tiene variantes visibles, mostrar UNA sola unidad centrada.

Tipografía:
- Nombre del producto en MAYÚSCULAS, blanco con efecto 3D suave: "${nameUpper}".
${sloganSection}

Precio:
Texto dorado MUY GRANDE (tamaño destacado, protagonista), con sombra azul suave
y línea fina dorada debajo: "${priceText}". Debe ser el elemento más visible
después del producto.

Sello de garantía:
Círculo con fondo azul oscuro, borde dorado, texto:
"GARANTÍA ${warrantyTime}" en blanco.

Iluminación:
Equilibrada, con reflejo sutil bajo el producto.

Estética general:
Limpia, moderna, técnica y coherente con el estilo premium DaniMarvis Store.
Sin texto basura, sin watermarks, sin marcos innecesarios.
Calidad de renderizado fotorrealista.`;
}

function renderCopilotResults(el, data) {
  if (data.message && data.total === 0) {
    el.innerHTML = `<div style="font-size:.8rem;color:var(--text-muted)">${escHtml(data.message)}</div>`;
    return;
  }
  const errs = (data.errors || []).map(e =>
    `<div style="font-size:.75rem;color:var(--error)">${escHtml(e.filename)}: ${escHtml(e.error)}</div>`
  ).join('');
  const item = (rec) => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg)">
      <img src="${rec.url}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px" />
      <div style="font-size:.75rem;font-weight:600;margin-top:6px;word-break:break-all">${escHtml(rec.filename)}</div>
      <div style="font-size:.72rem;color:${rec.product ? 'var(--text-secondary)' : '#b8860b'}">
        ${rec.product ? '✓ ' + escHtml(rec.product.name) : 'Sin coincidencia de producto'}
      </div>
    </div>`;
  el.innerHTML = `
    <div style="font-size:.8rem;margin-bottom:8px">
      <b>${data.imported.length}</b> importado(s) · <b>${data.noMatch.length}</b> sin coincidencia
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">
      ${data.imported.map(item).join('')}${data.noMatch.map(item).join('')}
    </div>
    ${errs ? `<div style="margin-top:8px">${errs}</div>` : ''}
  `;
}
