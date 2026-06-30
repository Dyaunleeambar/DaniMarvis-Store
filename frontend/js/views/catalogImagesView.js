import { api } from '../db/api.js';
import { showToast } from '../core/app.js';

export async function render(container) {
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando...</div>';

  try {
    const [products, dashboard] = await Promise.all([
      api.getProducts({ status: 'active' }),
      api.getDashboard()
    ]);
    renderView(container, products, dashboard);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderView(container, products, dashboard) {
  const totalProducts = dashboard?.stats?.total_products || 0;
  const activeProducts = products.length;

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Catálogo público</h1>
          <p>Genera un catálogo web estático para compartir con tus clientes por WhatsApp</p>
        </div>
        <div style="display:flex;gap:8px">
          <button id="btn-generate-catalog" class="btn btn--primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            Generar catálogo
          </button>
        </div>
      </div>

      <div class="grid-3" style="margin-bottom:24px">
        <div class="card card--stat">
          <div class="stat-icon stat-icon--rose">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div>
            <div class="stat-value">${totalProducts}</div>
            <div class="stat-label">Total de productos</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <div class="stat-value">${activeProducts}</div>
            <div class="stat-label">Productos activos</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div class="stat-value" id="catalog-status">No generado</div>
            <div class="stat-label">Última generación</div>
          </div>
        </div>
      </div>

      <div id="result-area" class="hidden" style="margin-bottom:24px"></div>

      <div class="card">
        <div class="card-header">
          <h3>Cómo publicar el catálogo en GitHub Pages</h3>
        </div>
        <div style="font-size:.85rem;line-height:1.7;color:var(--text-secondary)">
          <ol style="padding-left:20px;display:flex;flex-direction:column;gap:12px">
            <li>
              <strong style="color:var(--text)">Genera el catálogo</strong> con el botón de arriba.
              Se creará el archivo <code>public-catalog/index.html</code> en tu proyecto.
            </li>
            <li>
              <strong style="color:var(--text)">Crea un repositorio en GitHub</strong> (ej: <code>danimarvis-catalogo</code>)
              y sube el contenido de la carpeta <code>public-catalog/</code>.
            </li>
            <li>
              <strong style="color:var(--text)">Activa GitHub Pages</strong>: Ve a Settings → Pages →
              selecciona la rama <code>main</code> (o <code>gh-pages</code>) y carpeta <code>/ (root)</code>.
            </li>
            <li>
              <strong style="color:var(--text)">Comparte el enlace</strong>:
              <code>https://tunombre.github.io/danimarvis-catalogo</code>
            </li>
          </ol>
          <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:var(--radius);border:1px solid var(--border)">
            <strong style="color:var(--text)">💡 Tip:</strong> Puedes subir la carpeta
            <code>public-catalog/</code> directamente a un repo de GitHub usando
            <a href="https://desktop.github.com/" target="_blank">GitHub Desktop</a>
            o desde la terminal con <code>git push</code>.
          </div>
        </div>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .loading-spinner--sm {
      width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin .6s linear infinite;
      display: inline-block;
    }
  `;
  document.head.appendChild(style);

  document.getElementById('btn-generate-catalog').addEventListener('click', generateCatalog);
}

async function generateCatalog() {
  const btn = document.getElementById('btn-generate-catalog');
  const resultArea = document.getElementById('result-area');
  const statusEl = document.getElementById('catalog-status');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner--sm"></span> Generando...';

  try {
    const data = await api.generateCatalog();
    showToast('Catálogo generado correctamente', 'success');

    const now = new Date().toLocaleString('es-CU', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    statusEl.textContent = now;

    resultArea.classList.remove('hidden');
    resultArea.innerHTML = `
      <div class="card" style="border-color:var(--success)">
        <div style="display:flex;align-items:center;gap:12px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <div>
            <strong>Catálogo generado</strong>
            <div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px">
              ${data.products_count} productos exportados —
              <code style="font-size:.8rem">public-catalog/index.html</code>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    resultArea.classList.remove('hidden');
    resultArea.innerHTML = `
      <div class="card" style="border-color:var(--error)">
        <div style="display:flex;align-items:center;gap:12px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <div>
            <strong>Error al generar</strong>
            <div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px">${err.message}</div>
          </div>
        </div>
      </div>
    `;
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Generar catálogo`;
}
