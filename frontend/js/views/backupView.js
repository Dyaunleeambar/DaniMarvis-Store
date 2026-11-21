import { api } from '../db/api.js';
import { showToast, confirmDialog } from '../core/app.js';
import { ensureZipLibs } from '../utils/libLoader.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
        <strong>Respaldo automático:</strong> se programa diariamente a las 00:30 (hora local del servidor).
        Se guarda en <code>backend/backups/</code>, con rotación de las 3 copias más recientes.
        También podés generarlo manualmente con <code>npm run backup</code>.
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 8px">Exportar respaldo total</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Descarga un archivo .json con todos los datos del sistema. El respaldo automático
            también conserva los archivos de imagen.
          </p>
          <button class="btn btn--primary" id="btn-export">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar todo
          </button>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Preparar análisis visual para IA</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 12px">
            Crea un ZIP compacto con los productos de un proveedor, sus imágenes de referencia
            disponibles y las imágenes actuales que quieras comparar. Excluye ventas, publicaciones
            y textos extensos del catálogo.
          </p>
          <div class="form-row">
            <div class="form-group">
              <label for="ai-analysis-provider">Proveedor</label>
              <select id="ai-analysis-provider" class="form-control">
                <option value="">Cargando proveedores...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="ai-analysis-folder">Carpeta de imágenes actuales</label>
              <input id="ai-analysis-folder" class="form-control" type="text" placeholder="Ruta local de la carpeta" />
            </div>
          </div>
          <p style="font-size:.76rem;color:var(--text-muted);margin:0 0 12px">
            Se incluirán las imágenes de la carpeta y sus subcarpetas inmediatas. El inventario indicará
            cuáles productos no tienen una referencia disponible; no se tomarán decisiones automáticamente.
          </p>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:.8rem;margin-bottom:12px">
            <input id="ai-analysis-inventory-complete" type="checkbox" />
            Confirmo que la carpeta contiene todas las imágenes actuales de este proveedor.
          </label>
          <button class="btn btn--primary" id="btn-export-ai-analysis" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Crear paquete ZIP para análisis
          </button>
          <div id="ai-analysis-export-status" role="status" aria-live="polite" style="margin-top:8px;font-size:.78rem;color:var(--text-muted)"></div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Importar respaldo total</h3>
          <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
            Reemplaza todos los datos actuales con los de un respaldo total .json. Los paquetes ZIP
            de análisis visual no se pueden restaurar. Esta acción no se puede deshacer.
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
  const providerSelect = container.querySelector('#ai-analysis-provider');
  const folderInput = container.querySelector('#ai-analysis-folder');
  const inventoryCompleteInput = container.querySelector('#ai-analysis-inventory-complete');
  const exportAiButton = container.querySelector('#btn-export-ai-analysis');
  const exportStatus = container.querySelector('#ai-analysis-export-status');
  const savedProviderId = localStorage.getItem('danimarvis_update_provider') || '';
  folderInput.value = localStorage.getItem('danimarvis_update_folder') || '';

  container.querySelector('#btn-export').addEventListener('click', async () => {
    try {
      const data = await api.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `danimarvis-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Respaldo exportado correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  providerSelect.addEventListener('change', () => {
    localStorage.setItem('danimarvis_update_provider', providerSelect.value);
    exportAiButton.disabled = !providerSelect.value || !folderInput.value.trim();
  });
  folderInput.addEventListener('input', () => {
    localStorage.setItem('danimarvis_update_folder', folderInput.value);
    exportAiButton.disabled = !providerSelect.value || !folderInput.value.trim();
  });

  exportAiButton.addEventListener('click', async () => {
    const providerId = providerSelect.value;
    const folder = folderInput.value.trim();
    if (!providerId || !folder) {
      showToast('Seleccioná un proveedor e indicá la carpeta de imágenes actuales', 'error');
      return;
    }

    let packageId = '';
    let packageDownloaded = false;
    exportAiButton.disabled = true;
    providerSelect.disabled = true;
    folderInput.disabled = true;
    inventoryCompleteInput.disabled = true;
    try {
      exportStatus.textContent = 'Preparando el inventario y reuniendo las imágenes...';
      const prepared = await api.createAiAnalysisPackage({
        provider_id: providerId,
        folder,
        inventory_complete: inventoryCompleteInput.checked,
      });
      packageId = prepared.package_id;
      const { manifest } = prepared;

      await ensureZipLibs();
      const zip = new window.JSZip();
      zip.file('inventario.json', JSON.stringify(manifest, null, 2));
      zip.file('LEEME.txt', [
        `Paquete de análisis visual para ${manifest.provider.name}.`,
        '',
        'imagenes-referencia/ contiene las referencias guardadas para cada producto.',
        'imagenes-actuales/ contiene las imágenes del inventario actual del proveedor.',
        'En inventario.json, reference_status indica si la referencia está incluida, falta o no estaba configurada.',
        `Inventario confirmado completo: ${manifest.inventory_complete ? 'sí' : 'no'}.`,
        '',
        ...manifest.analysis_guidance.map((line, index) => `${index + 1}. ${line}`),
        '',
      ].join('\n'));

      for (let index = 0; index < manifest.assets.length; index++) {
        const asset = manifest.assets[index];
        exportStatus.textContent = `Descargando imagen ${index + 1} de ${manifest.assets.length}...`;
        const imageBlob = await api.getAiAnalysisAsset(packageId, asset.id);
        zip.file(asset.path, imageBlob);
      }

      exportStatus.textContent = 'Empaquetando las imágenes...';
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        progress => { exportStatus.textContent = `Empaquetando las imágenes... ${Math.round(progress.percent)}%`; },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const providerSlug = manifest.provider.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proveedor';
      a.href = url;
      a.download = `analisis-visual-${providerSlug}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      packageDownloaded = true;
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportStatus.textContent = `Paquete listo: ${manifest.products.length} productos y ${manifest.assets.length} imágenes.`;
      showToast(`Paquete de análisis descargado (${manifest.assets.length} imágenes)`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      exportStatus.textContent = '';
    } finally {
      if (packageId) {
        try {
          await api.deleteAiAnalysisPackage(packageId);
        } catch (err) {
          const message = packageDownloaded
            ? `El paquete se descargó, pero no se pudo liberar la sesión temporal: ${err.message}`
            : `No se pudo liberar la sesión temporal del paquete: ${err.message}`;
          showToast(message, 'warning');
        }
      }
      providerSelect.disabled = false;
      folderInput.disabled = false;
      inventoryCompleteInput.disabled = false;
      exportAiButton.disabled = !providerSelect.value || !folderInput.value.trim();
    }
  });

  container.querySelector('#btn-select-file').addEventListener('click', () => {
    container.querySelector('#backup-file-input').click();
  });

  container.querySelector('#backup-file-input').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    selectedFile = file;
    container.querySelector('#file-info').textContent = `Archivo: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    container.querySelector('#btn-restore').disabled = false;
  });

  container.querySelector('#btn-restore').addEventListener('click', async () => {
    if (!selectedFile) return;
    const confirmed = await confirmDialog(
      '¿Restaurar este respaldo? Se reemplazarán TODOS los datos actuales del sistema. Esta acción no se puede deshacer.',
      { title: 'Restaurar respaldo', confirmText: 'Restaurar', danger: true },
    );
    if (!confirmed) return;

    try {
      const data = JSON.parse(await selectedFile.text());
      if (!data.products || !data.providers || !data.sales) {
        throw new Error('El archivo no contiene un respaldo total válido de productos, proveedores y ventas');
      }
      await api.restoreBackup(data);
      showToast(`Datos restaurados: ${data.products.length} producto(s), ${data.providers.length} proveedor(es), ${data.sales.length} venta(s)`, 'success');
      selectedFile = null;
      container.querySelector('#backup-file-input').value = '';
      container.querySelector('#file-info').textContent = '';
      container.querySelector('#btn-restore').disabled = true;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  try {
    const providers = await api.getProviders();
    providerSelect.innerHTML = `<option value="">Selecciona un proveedor</option>${providers.map(provider => (
      `<option value="${escHtml(provider.id)}">${escHtml(provider.name)}</option>`
    )).join('')}`;
    if (providers.some(provider => provider.id === savedProviderId)) {
      providerSelect.value = savedProviderId;
      exportAiButton.disabled = !folderInput.value.trim();
    } else {
      providerSelect.value = '';
      exportAiButton.disabled = true;
    }
  } catch (err) {
    providerSelect.innerHTML = '<option value="">No se pudieron cargar los proveedores</option>';
    showToast(`No se pudieron cargar los proveedores: ${err.message}`, 'error');
  }
}
