import { api } from '../db/api.js';
import { formatUSD } from '../utils/utils.js';
import { generateProductImage } from '../utils/imageGenerator.js';
import { showToast } from '../core/app.js';

export async function render(container) {
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando productos...</div>';

  try {
    const products = await api.getProducts({ status: 'active' });
    renderView(container, products);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderView(container, products) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Catálogo de imágenes</h1>
          <p>Genera imágenes promocionales para Facebook y WhatsApp</p>
        </div>
        ${products.length > 0 ? `
          <div style="display:flex;gap:8px">
            <button id="btn-generate-all" class="btn btn--primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              Generar todas
            </button>
          </div>
        ` : ''}
      </div>

      <div id="preview-area" class="preview-area hidden">
        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <h3>Vista previa</h3>
            <button id="btn-close-preview" class="btn btn--sm btn--ghost">Cerrar</button>
          </div>
          <div id="preview-content" style="display:flex;flex-direction:column;align-items:center;gap:16px">
            <div id="preview-canvas-wrap" style="max-width:400px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)"></div>
            <p id="preview-name" style="font-weight:600;font-size:1rem"></p>
            <button id="btn-download" class="btn btn--primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Descargar imagen
            </button>
          </div>
        </div>
      </div>

      ${products.length === 0
        ? `<div class="empty-state"><h3>No hay productos activos</h3><p>Activa productos en la sección Productos para generar imágenes</p></div>`
        : `<div class="product-grid" id="product-grid">
            ${products.map(p => `
              <div class="card product-card" data-id="${p.id}">
                <div class="product-card__preview">
                  ${p.image_url
                    ? `<img src="${p.image_url}" alt="${p.name}" />`
                    : `<div class="product-card__no-img">📷</div>`
                  }
                </div>
                <div class="product-card__info">
                  <div class="product-card__name">${p.name}</div>
                  <div class="product-card__price">${formatUSD(p.price)}</div>
                  <div class="product-card__meta">
                    ${p.commission_value > 0
                      ? `Comisión: ${formatUSD(p.commission_value)}`
                      : 'Sin comisión'
                    }
                    ${p.warranty ? ` · ${p.warranty}` : ''}
                  </div>
                </div>
                <div class="product-card__actions">
                  <button class="btn btn--primary btn--sm btn-generate" data-id="${p.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                    Generar imagen
                  </button>
                </div>
              </div>
            `).join('')}
          </div>`
      }
    </div>

    <style>
      .product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .product-card {
        padding: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .product-card__preview {
        width: 100%;
        height: 200px;
        background: var(--bg);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .product-card__preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .product-card__no-img {
        font-size: 3rem;
        opacity: .3;
      }
      .product-card__info {
        padding: 14px 16px 8px;
        flex: 1;
      }
      .product-card__name {
        font-weight: 600;
        font-size: .9rem;
        margin-bottom: 4px;
      }
      .product-card__price {
        font-family: var(--font-mono);
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--rose-dark);
      }
      .product-card__meta {
        font-size: .75rem;
        color: var(--text-secondary);
        margin-top: 4px;
      }
      .product-card__actions {
        padding: 8px 16px 14px;
      }
      .product-card__actions .btn {
        width: 100%;
      }
      .preview-area.hidden { display: none; }
      .preview-area { animation: fadeUp .25s ease; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .loading-spinner--sm {
        width: 18px; height: 18px;
        border: 2px solid rgba(255,255,255,.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin .6s linear infinite;
        display: inline-block;
      }
    </style>
  `;

  // ── Event delegation ──────────────────────────────────────
  const grid = document.getElementById('product-grid');
  const previewArea = document.getElementById('preview-area');
  const previewContent = document.getElementById('preview-content');
  const previewName = document.getElementById('preview-name');
  const canvasWrap = document.getElementById('preview-canvas-wrap');
  const downloadBtn = document.getElementById('btn-download');
  const closePreview = document.getElementById('btn-close-preview');
  const generateAllBtn = document.getElementById('btn-generate-all');

  if (!products.length) return;

  // Single generate
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-generate');
    if (!btn) return;

    const id = btn.dataset.id;
    const product = products.find(p => p.id === id);
    if (!product) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner--sm"></span> Generando...';

    try {
      const canvas = await generateProductImage(product);
      showPreview(canvas, product);
      showToast('Imagen generada', 'success');
    } catch (err) {
      showToast('Error al generar imagen: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Generar imagen';
  });

  // Generate all
  generateAllBtn?.addEventListener('click', async () => {
    generateAllBtn.disabled = true;
    generateAllBtn.innerHTML = '<span class="loading-spinner--sm"></span> Generando...';

    let generated = 0;
    for (const product of products) {
      try {
        const canvas = await generateProductImage(product);
        downloadCanvas(canvas, slugify(product.name));
        generated++;
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.warn('Error con', product.name, err);
      }
    }

    showToast(`${generated} imágenes generadas y descargadas`, 'success');
    generateAllBtn.disabled = false;
    generateAllBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Generar todas`;
  });

  // Download
  let currentCanvas = null;

  downloadBtn.addEventListener('click', () => {
    if (!currentCanvas) return;
    downloadCanvas(currentCanvas, 'danimarvis-producto');
  });

  closePreview.addEventListener('click', () => {
    previewArea.classList.add('hidden');
    currentCanvas = null;
  });

  function showPreview(canvas, product) {
    currentCanvas = canvas;
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(canvas);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    previewName.textContent = product.name;
    previewArea.classList.remove('hidden');
    previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.download = `${filename}-danimarvis.png`;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
