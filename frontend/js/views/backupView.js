import { api } from '../db/api.js';
import { showToast, confirmDialog } from '../core/app.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Agrupación lógica de tablas para el selector de exportación
const TABLE_GROUPS = [
  {
    label: 'Catálogo (base para IA)',
    tables: ['products', 'categories', 'providers'],
    description: 'Productos, categorías y proveedores.',
  },
  {
    label: 'Publicaciones',
    tables: ['publications', 'publication_queue', 'publication_plans', 'publication_clones'],
    description: 'Publicaciones, cola, planes y clones.',
  },
  {
    label: 'Ventas',
    tables: ['sales'],
    description: 'Historial de ventas.',
  },
  {
    label: 'Configuración y sistema',
    tables: ['settings', 'users', 'provider_styles', 'exports'],
    description: 'Ajustes, usuarios, estilos de proveedor y exportaciones previas.',
  },
  {
    label: 'Otros',
    tables: [
      'facebook_groups',
      'rank_snapshots',
      'ranking_history',
      'warranty_rules',
      'warranty_reminder_dismissals',
      'availability_update_batches',
      'page_routines',
      'page_schedule_log',
    ],
    description: 'Grupos de Facebook, rankings, garantías y disponibilidad.',
  },
];

export async function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Respaldos</h1>
          <p>Exporta e importa todos los datos del sistema</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px;padding:12px 16px;font-size:.82rem;color:var(--text-secondary)">
        <strong>Respaldo automático:</strong> al iniciar el servidor se crea un respaldo completo
        (BD + imágenes) en <code>backend/backups/</code>, con rotación de las 3 copias más recientes.
        También podés generarlo manualmente con <code>npm run backup</code>.
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 8px">Exportar respaldo total</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Descarga un archivo .json con <b>TODOS</b> los datos del sistema:
            productos, proveedores, ventas, categorías, configuración,
            publicaciones, cola de publicaciones, exports y usuarios.
          </p>
          <button class="btn btn--primary" id="btn-export">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar todo
          </button>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Exportar selección configurable</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 12px">
            Elegí qué tablas del sistema querés incluir en el respaldo. Ideal para preparar
            los datos que vas a usar en la actualización asistida por IA.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <button type="button" class="btn btn--sm btn--secondary" id="btn-select-all-tables">Seleccionar todo</button>
            <button type="button" class="btn btn--sm btn--secondary" id="btn-select-none-tables">Seleccionar nada</button>
          </div>
          <div id="tables-selector" style="display:flex;flex-direction:column;gap:10px">
            <!-- Las tablas se renderizan acá dinámicamente -->
          </div>
          <div id="tables-count" style="margin-top:8px;font-size:.8rem;color:var(--text-secondary)"></div>
          <button class="btn btn--primary" id="btn-export-selective" disabled style="margin-top:12px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar selección
          </button>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Importar respaldo</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Reemplaza TODOS los datos actuales (incl. publicaciones, cola de
            publicaciones, exports y usuarios) con los de un archivo .json
            previamente exportado. Esta acción no se puede deshacer.
          </p>
          <input type="file" id="backup-file-input" accept=".json" style="display:none" />
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--secondary" id="btn-select-file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Seleccionar archivo
            </button>
            <button class="btn btn--danger" id="btn-restore" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              Restaurar
            </button>
          </div>
          <div id="file-info" style="margin-top:8px;font-size:.82rem;color:var(--text-muted)"></div>
        </div>
      </div>
    </div>
  `;

  let selectedFile = null;
  const selectedTables = new Set();
  const tableFilters = {}; // { tableName: { column: value } }
  let providers = [];

  // ---------- Cargar proveedores ----------
  async function loadProviders() {
    try {
      const res = await api.getProviders();
      providers = res || [];
    } catch (err) {
      console.error('[Backup] Error cargando proveedores', err);
      providers = [];
    }
  }

  // ---------- Renderizar selector de tablas ----------
  async function renderTablesSelector() {
    const container = document.getElementById('tables-selector');
    const countEl = document.getElementById('tables-count');
    if (!container) return;

    let tables = [];
    try {
      const res = await api.listBackupTables();
      tables = res.tables || [];
    } catch (err) {
      console.error('[Backup] Error listando tablas', err);
      // Fallback: usar lista hardcodeada si falla el backend
      tables = TABLE_GROUPS.flatMap(g => g.tables);
    }

    container.innerHTML = TABLE_GROUPS.map(group => {
      const existingTables = group.tables.filter(t => tables.includes(t));
      if (existingTables.length === 0) return '';
      const checkedAll = existingTables.every(t => selectedTables.has(t));
      const indeterminate = existingTables.some(t => selectedTables.has(t)) && !checkedAll;
      // Filtros especiales para la tabla products
      let productFiltersHtml = '';
      if (group.label === 'Catálogo (base para IA)' && existingTables.includes('products')) {
        const productsChecked = selectedTables.has('products');
        const prodFilters = tableFilters.products || {};
        productFiltersHtml = `
          <div style="margin-top:10px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px">
            <strong style="font-size:.8rem;color:var(--text)">Filtros para productos</strong>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer">
                <select id="filter-products-provider" class="form-control form-control--small" style="flex:1;min-width:140px"
                  ${!productsChecked ? 'disabled' : ''}>
                  <option value="">Todos los proveedores</option>
                  ${providers.map(p => `<option value="${p.id}" ${prodFilters.provider_id === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
                </select>
                <span style="font-size:.72rem;color:var(--text-muted)">Proveedor</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer">
                <select id="filter-products-visible" class="form-control form-control--small" style="flex:1;min-width:120px"
                  ${!productsChecked ? 'disabled' : ''}>
                  <option value="">Todos los estados</option>
                  <option value="1" ${prodFilters.catalog_visible === '1' ? 'selected' : ''}>Visible</option>
                  <option value="0" ${prodFilters.catalog_visible === '0' ? 'selected' : ''}>Oculto</option>
                </select>
                <span style="font-size:.72rem;color:var(--text-muted)">Estado</span>
              </label>
            </div>
          </div>
        `;
      }

      return `
        <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--bg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <strong style="font-size:.85rem">${group.label}</strong>
            <span style="font-size:.75rem;color:var(--text-muted)">${existingTables.length} tabla(s)</span>
          </div>
          <p style="font-size:.76rem;color:var(--text-secondary);margin:0 0 8px">${group.description}</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px">
            ${existingTables.map(t => {
              const isChecked = selectedTables.has(t);
              return `
                <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer">
                  <input type="checkbox" value="${t}" ${isChecked ? 'checked' : ''} ${indeterminate ? 'indeterminate' : ''} />
                  ${t}
                </label>
              `;
            }).join('')}
          </div>
          ${productFiltersHtml}
        </div>
      `;
    }).join('');

    countEl.textContent = `${selectedTables.size} tabla(s) seleccionada(s)`;

    // Event listeners de los checkboxes
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const val = e.target.value;
        if (e.target.checked) selectedTables.add(val);
        else {
          selectedTables.delete(val);
          // Limpiar filtros si se desmarca la tabla products
          if (val === 'products') {
            tableFilters.products = undefined;
          }
        }
        document.getElementById('btn-export-selective').disabled = selectedTables.size === 0;
        countEl.textContent = `${selectedTables.size} tabla(s) seleccionada(s)`;
        renderTablesSelector(); // re-render para actualizar estados de grupo
      });
    });
  }

  // ---------- Exportar todo (existente) ----------
  document.getElementById('btn-export').addEventListener('click', async () => {
    try {
      const data = await api.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `danimarvis-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Respaldo exportado correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---------- Exportar selección ----------
  // ---------- Listeners de filtros de productos (delegación, ya que el HTML se recrea) ----------
  document.getElementById('tables-selector')?.addEventListener('change', (e) => {
    if (e.target.id === 'filter-products-provider') {
      const val = e.target.value;
      if (val) {
        tableFilters.products = { ...(tableFilters.products || {}), provider_id: val };
      } else {
        const { provider_id, ...rest } = tableFilters.products || {};
        tableFilters.products = Object.keys(rest).length ? rest : undefined;
      }
    }
    if (e.target.id === 'filter-products-visible') {
      const val = e.target.value;
      if (val) {
        tableFilters.products = { ...(tableFilters.products || {}), catalog_visible: val };
      } else {
        const { catalog_visible, ...rest } = tableFilters.products || {};
        tableFilters.products = Object.keys(rest).length ? rest : undefined;
      }
    }
  });

  document.getElementById('btn-select-all-tables').addEventListener('click', () => {
    TABLE_GROUPS.forEach(g => g.tables.forEach(t => selectedTables.add(t)));
    document.getElementById('btn-export-selective').disabled = false;
    renderTablesSelector();
  });

  document.getElementById('btn-select-none-tables').addEventListener('click', () => {
    selectedTables.clear();
    document.getElementById('btn-export-selective').disabled = true;
    renderTablesSelector();
  });

  document.getElementById('btn-export-selective').addEventListener('click', async () => {
    if (selectedTables.size === 0) {
      showToast('Seleccioná al menos una tabla para exportar', 'error');
      return;
    }
    try {
      const btn = document.getElementById('btn-export-selective');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Exportando…';

      const data = await api.exportSelectiveBackup([...selectedTables], tableFilters);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      const safeTables = [...selectedTables].join('_').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `danimarvis-backup-selective-${safeTables}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btn.disabled = false;
      btn.textContent = originalText;
      showToast(`Respaldo selectivo exportado (${selectedTables.size} tabla(s))`, 'success');
    } catch (err) {
      const btn = document.getElementById('btn-export-selective');
      btn.disabled = false;
      btn.textContent = 'Exportar selección';
      showToast(err.message, 'error');
    }
  });

  // ---------- Importar respaldo (existente) ----------
  document.getElementById('btn-select-file').addEventListener('click', () => {
    document.getElementById('backup-file-input').click();
  });

  document.getElementById('backup-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    document.getElementById('file-info').textContent = `Archivo: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    document.getElementById('btn-restore').disabled = false;
  });

  document.getElementById('btn-restore').addEventListener('click', async () => {
    if (!selectedFile) return;

    const ok = await confirmDialog(
      '¿Restaurar este respaldo? Se reemplazarán TODOS los datos actuales del sistema. Esta acción no se puede deshacer.',
      { title: 'Restaurar respaldo', confirmText: 'Restaurar', danger: true }
    );
    if (!ok) return;

    try {
      const text = await selectedFile.text();
      const data = JSON.parse(text);

      if (!data.products || !data.providers || !data.sales) {
        throw new Error('El archivo no contiene datos válidos de productos, proveedores y ventas');
      }

      await api.restoreBackup(data);
      showToast(`Datos restaurados: ${data.products.length} producto(s), ${data.providers.length} proveedor(es), ${data.sales.length} venta(s)`, 'success');

      selectedFile = null;
      document.getElementById('backup-file-input').value = '';
      document.getElementById('file-info').textContent = '';
      document.getElementById('btn-restore').disabled = true;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Inicializar selector de tablas
  loadProviders().then(() => renderTablesSelector());
}
