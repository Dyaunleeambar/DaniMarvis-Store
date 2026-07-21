import { api } from '../db/api.js';
import { showToast } from '../core/app.js';
import { FIELD_LABELS, DEFAULT_FIELDS } from '../utils/pdfGenerator.js';

const STORAGE_KEY = 'danimarvis_export_config';

function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    style: 'table',
    fields: [...DEFAULT_FIELDS],
    header: 'DaniMarvis Store',
  };
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderConfig(container) {
  const config = loadConfig();
  const allFields = Object.keys(FIELD_LABELS);

  container.innerHTML = `
    <div style="padding:16px;max-width:600px">
      <div class="card" style="padding:24px">
        <h3 style="margin:0 0 16px;font-size:1rem">Estilo del PDF</h3>
        <div style="display:flex;gap:12px;margin-bottom:20px">
          <label style="flex:1;cursor:pointer">
            <input type="radio" name="export-style" value="table" ${config.style === 'table' ? 'checked' : ''} style="display:none" />
            <div class="card" style="padding:16px;text-align:center;border:2px solid ${config.style === 'table' ? 'var(--rose)' : 'var(--border)'}" id="style-table">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              <div style="font-size:.82rem;font-weight:600;margin-top:8px">Tabla simple</div>
              <div style="font-size:.72rem;color:var(--text-muted)">Estilo profesional compacto</div>
            </div>
          </label>
          <label style="flex:1;cursor:pointer">
            <input type="radio" name="export-style" value="list" ${config.style === 'list' ? 'checked' : ''} style="display:none" />
            <div class="card" style="padding:16px;text-align:center;border:2px solid ${config.style === 'list' ? 'var(--rose)' : 'var(--border)'}" id="style-list">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="var(--rose)"/><circle cx="4" cy="12" r="1" fill="var(--rose)"/><circle cx="4" cy="18" r="1" fill="var(--rose)"/></svg>
              <div style="font-size:.82rem;font-weight:600;margin-top:8px">Lista detallada</div>
              <div style="font-size:.72rem;color:var(--text-muted)">Un producto por bloque</div>
            </div>
          </label>
        </div>

        <h3 style="margin:0 0 12px;font-size:1rem">Campos por defecto</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
          ${allFields.map(f => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" name="export-field" value="${f}" ${config.fields.includes(f) ? 'checked' : ''} />
              ${FIELD_LABELS[f]}
            </label>
          `).join('')}
        </div>

        <h3 style="margin:0 0 12px;font-size:1rem">Encabezado del PDF</h3>
        <input type="text" id="export-header" class="form-control" value="${escHtml(config.header)}" placeholder="Nombre del proyecto o empresa" />

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <button class="btn btn--primary" id="export-save-config">Guardar configuración</button>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('input[name="export-style"]').forEach(radio => {
    radio.addEventListener('change', () => {
      container.querySelectorAll('[id^="style-"]').forEach(el => { el.style.borderColor = 'var(--border)'; });
      document.getElementById(`style-${radio.value}`).style.borderColor = 'var(--rose)';
    });
  });

  document.getElementById('export-save-config').addEventListener('click', () => {
    const style = container.querySelector('input[name="export-style"]:checked')?.value || 'table';
    const fields = [...container.querySelectorAll('input[name="export-field"]:checked')].map(cb => cb.value);
    const header = document.getElementById('export-header').value.trim() || 'DaniMarvis Store';
    saveConfig({ style, fields, header });
    showToast('Configuración guardada', 'success');
  });
}
