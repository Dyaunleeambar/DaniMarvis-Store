import { api } from '../db/api.js';
import { showToast } from '../core/app.js';

export async function render(container) {
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando configuración...</div>';

  try {
    const settings = await api.getSettings();
    renderForm(container, settings);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderForm(container, settings) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Configuración</h1>
          <p>Tipo de cambio USD → MN</p>
        </div>
      </div>

      <div class="card" style="max-width:480px">
        <form id="settings-form">
          <div class="form-group">
            <label>Tipo de cambio (1 USD = ? MN)</label>
            <input type="number" name="exchange_rate" class="form-control"
              value="${settings.exchange_rate}" min="1" step="1" required />
            <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
              Este valor se usa para calcular el precio en moneda nacional (MN).
              Actualízalo diariamente según la tasa del día.
            </small>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary">Guardar</button>
          </div>
        </form>
      </div>

      <div class="card" style="max-width:480px;margin-top:16px">
        <h3 style="margin:0 0 12px">Info</h3>
        <ul style="font-size:.85rem;color:var(--text-secondary);line-height:1.8;padding-left:16px">
          <li>Los precios de productos se ingresan en <strong>USD</strong></li>
          <li>Las comisiones son valores <strong>fijos en USD</strong> por producto</li>
          <li>En ventas, el total y comisión se muestran en USD + MN</li>
          <li>El tipo de cambio se guarda con cada venta para referencia histórica</li>
        </ul>
      </div>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.exchange_rate = parseFloat(data.exchange_rate);

    try {
      await api.updateSettings(data);
      showToast('Tipo de cambio actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
