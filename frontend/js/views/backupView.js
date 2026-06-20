import { api } from '../db/api.js';
import { showToast, confirmDialog } from '../core/app.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Respaldos</h1>
          <p>Exporta e importa todos los datos del sistema</p>
        </div>
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 8px">Exportar respaldo</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Descarga un archivo .json con todos los datos del sistema:
            productos, proveedores, ventas, categorías y configuración.
          </p>
          <button class="btn btn--primary" id="btn-export">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar todo
          </button>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Importar respaldo</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Reemplaza TODOS los datos actuales con los de un archivo .json
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
}
