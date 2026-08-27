import { api } from '../db/api.js';
import { openModal, closeModal, showToast, confirmDialog, refreshSidebarCounts } from '../core/app.js';

let currentContainer = null;
let currentProviders = [];
let currentStyles = [];

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeFolderName(name) {
  return String(name || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|$/g, '');
}

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando proveedores...</div>';

  try {
    const [providers, styles] = await Promise.all([
      api.getProviders(),
      api.getProviderStyles(),
    ]);
    currentProviders = providers;
    currentStyles = styles;
    renderTable(container, currentProviders);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, providers) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Proveedores</h1>
          <p>${providers.length} proveedor(es) registrados</p>
        </div>
        <button class="btn btn--primary" onclick="window._openProviderForm(null)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo proveedor
        </button>
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Contacto</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Info</th>
                <th>Estilo</th>
                <th>Moneda</th>
                <th>Carpeta</th>
                <th>Productos</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody>
              ${providers.length === 0
                ? `<tr><td colspan="10"><div class="empty-state" style="padding:32px"><h3>No hay proveedores</h3><p>Registra tu primer proveedor</p></div></td></tr>`
                : providers.map(p => {
                  const styleObj = currentStyles.find(s => s.code === p.provider_style_code);
                  return `
                  <tr>
                    <td><span style="font-weight:600">${p.name}</span></td>
                    <td>${p.contact || '—'}</td>
                    <td>${p.phone || '—'}</td>
                    <td>${p.email || '—'}</td>
                    <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.info ? escHtml(p.info) : '—'}</td>
                    <td>${p.provider_style_code ? `<span class="badge badge--active" title="${escHtml(styleObj?.name || '')}">${escHtml(p.provider_style_code)}</span>` : '<span style="color:var(--text-muted);font-size:.78rem">—</span>'}</td>
                    <td><span class="badge badge--${(p.commission_currency || 'USD') === 'USD' ? 'active' : 'unpaid'}">${p.commission_currency || 'USD'}</span></td>
                    <td><span style="font-size:.75rem;color:var(--text-muted);font-family:monospace">${sanitizeFolderName(p.name)}/</span></td>
                    <td><span class="badge badge--${p.product_count > 0 ? 'active' : 'archived'}">${p.product_count}</span></td>
                    <td>
                      <div class="actions-cell">
                        <button class="btn btn--sm btn--ghost" onclick="window._editProvider('${p.id}')" title="Editar">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn btn--sm btn--ghost" onclick="window._warrantyRules('${p.id}','${escAttr(p.name)}')" title="Reglas de garantía" style="color:var(--gold,#b8860b)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        </button>
                        <button class="btn btn--sm btn--ghost" onclick="window._deleteProvider('${p.id}')" title="Eliminar" style="color:var(--error)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── Global handlers ───────────────────────────────────────────
window._openProviderForm = function(provider) {
  if (provider) {
    openProviderFormDirect(provider);
  } else {
    openStyleSelector();
  }
};

function parsePalette(palette) {
  try {
    const obj = typeof palette === 'string' ? JSON.parse(palette) : (palette || {});
    return Object.entries(obj).filter(([, v]) => typeof v === 'string' && v.startsWith('#'));
  } catch { return []; }
}

function styleSummaryHTML(style) {
  const palette = parsePalette(style.palette);
  const rules = [
    { label: 'Fondos', value: style.background_rules },
    { label: 'Acentos', value: style.accent_rules },
    { label: 'Firma', value: style.signature_rules },
    { label: 'Restricciones', value: style.negative_rules },
  ].filter(r => r.value);
  return `
    ${palette.length > 0 ? `
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        ${palette.map(([name, hex]) =>
          `<span title="${escHtml(name)}: ${hex}" style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem;color:var(--text-muted)"><span style="width:12px;height:12px;border-radius:50%;background:${hex};border:1px solid var(--border);display:inline-block"></span>${hex}</span>`
        ).join('')}
      </div>` : ''}
    ${rules.length > 0 ? `
      <div style="font-size:.78rem;color:var(--text-secondary);line-height:1.5">
        ${rules.map(r => `<div><b>${r.label}:</b> ${escHtml(r.value.length > 80 ? r.value.slice(0, 80) + '...' : r.value)}</div>`).join('')}
      </div>` : '<div style="font-size:.78rem;color:var(--text-muted)">Sin reglas personalizadas</div>'}
  `;
}

function openStyleSelector() {
  openModal(`
    <div class="modal-header">
      <h2>Nuevo proveedor — Elegí un estilo visual</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p style="font-size:.85rem;color:var(--text-secondary);margin:0 0 16px">
      Elegí el perfil visual que definirá los anuncios de este proveedor. Podés cambiarlo después.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px" id="style-cards">
      ${currentStyles.map(s => `
        <div class="card style-card" data-code="${escAttr(s.code)}" style="padding:14px;cursor:pointer;border:2px solid transparent;transition:border-color .15s">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span class="badge badge--active">${escHtml(s.code)}</span>
            <span style="font-weight:600;font-size:.9rem">${escHtml(s.name)}</span>
          </div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px;font-family:monospace">${escHtml(s.style_name)}</div>
          ${styleSummaryHTML(s)}
        </div>
      `).join('')}
      <div class="card style-card" data-code="" style="padding:14px;cursor:pointer;border:2px solid transparent;transition:border-color .15s;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100px">
        <div style="font-size:1.5rem;margin-bottom:4px;opacity:.4">&#8709;</div>
        <span style="font-weight:600;font-size:.85rem">Sin estilo</span>
        <span style="font-size:.75rem;color:var(--text-muted)">Estilo por defecto</span>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn--primary" id="style-continue" disabled>Continuar →</button>
    </div>
  `, 'modal-content--wide');

  let selectedCode = null;
  const cards = document.querySelectorAll('.style-card');
  const continueBtn = document.getElementById('style-continue');

  cards.forEach(card => {
    card.addEventListener('click', () => {
      cards.forEach(c => c.style.borderColor = 'transparent');
      card.style.borderColor = 'var(--primary)';
      selectedCode = card.dataset.code;
      continueBtn.disabled = false;
    });
  });

  continueBtn.addEventListener('click', () => {
    const style = selectedCode ? currentStyles.find(s => s.code === selectedCode) : null;
    openProviderFormWithStyle(style);
  });
}

function openProviderFormWithStyle(style) {
  openModal(`
    <div class="modal-header">
      <h2>Nuevo proveedor</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    ${style ? `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:16px;font-size:.85rem">
        <span class="badge badge--active">${escHtml(style.code)}</span>
        <span style="flex:1"><b>${escHtml(style.name)}</b> — ${escHtml(style.style_name)}</span>
        <button type="button" class="btn btn--sm btn--ghost" id="style-change-btn" style="font-size:.78rem">Cambiar</button>
      </div>
    ` : `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:16px;font-size:.85rem">
        <div style="font-size:1.2rem;opacity:.4">&#8709;</div>
        <span style="flex:1"><b>Sin estilo asignado</b> — Se usará el estilo por defecto</span>
        <button type="button" class="btn btn--sm btn--ghost" id="style-change-btn" style="font-size:.78rem">Elegir estilo</button>
      </div>
    `}
    <form id="provider-form">
      <input type="hidden" name="id" value="" />
      <input type="hidden" name="provider_style_code" value="${style?.code || ''}" />
      <div class="form-group">
        <label>Nombre del proveedor *</label>
        <input type="text" name="name" class="form-control" required autofocus />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Persona de contacto</label>
          <input type="text" name="contact" class="form-control" />
        </div>
        <div class="form-group">
          <label>Teléfono</label>
          <input type="text" name="phone" class="form-control" />
        </div>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" class="form-control" />
      </div>
      <div class="form-group">
        <label>Información del proveedor</label>
        <textarea name="info" class="form-control" style="min-height:120px" placeholder="Condiciones, requisitos, formas de pago, etc."></textarea>
      </div>
      <div class="form-group">
        <label>Moneda de comisión</label>
        <select name="commission_currency" class="form-control">
          <option value="USD">USD — Dólares</option>
          <option value="MN">MN — Peso nacional</option>
        </select>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">Moneda en la que este proveedor paga comisiones. Los productos heredan esta moneda por defecto.</small>
      </div>
      <div class="form-group">
        <label>Notas</label>
        <textarea name="notes" class="form-control"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">Crear proveedor</button>
      </div>
    </form>
  `, 'modal-content--wide');

  document.getElementById('style-change-btn')?.addEventListener('click', () => {
    closeModal();
    setTimeout(openStyleSelector, 100);
  });

  document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.createProvider(data);
      showToast('Proveedor creado', 'success');
      closeModal();
      refreshSidebarCounts();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openProviderFormDirect(provider) {
  openModal(`
    <div class="modal-header">
      <h2>Editar proveedor</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="provider-form">
      <input type="hidden" name="id" value="${escAttr(provider?.id || '')}" />
      <div class="form-group">
        <label>Nombre del proveedor *</label>
        <input type="text" name="name" class="form-control" value="${escAttr(provider?.name || '')}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Persona de contacto</label>
          <input type="text" name="contact" class="form-control" value="${escAttr(provider?.contact || '')}" />
        </div>
        <div class="form-group">
          <label>Teléfono</label>
          <input type="text" name="phone" class="form-control" value="${escAttr(provider?.phone || '')}" />
        </div>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" class="form-control" value="${escAttr(provider?.email || '')}" />
      </div>
      <div class="form-group">
        <label>Información del proveedor</label>
        <textarea name="info" class="form-control" style="min-height:120px" placeholder="Condiciones, requisitos, formas de pago, etc.">${escHtml(provider?.info || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Moneda de comisión</label>
        <select name="commission_currency" class="form-control">
          <option value="USD" ${provider?.commission_currency === 'USD' ? 'selected' : ''}>USD — Dólares</option>
          <option value="MN" ${provider?.commission_currency === 'MN' ? 'selected' : ''}>MN — Peso nacional</option>
        </select>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">Moneda en la que este proveedor paga comisiones. Los productos heredan esta moneda por defecto.</small>
      </div>
      <div class="form-group">
        <label>Estilo visual (proveedor)</label>
        <select name="provider_style_code" class="form-control">
          <option value="">Sin estilo asignado</option>
          ${currentStyles.map(s => `<option value="${escAttr(s.code)}" ${provider?.provider_style_code === s.code ? 'selected' : ''}>${escHtml(s.code)} — ${escHtml(s.name)}</option>`).join('')}
        </select>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">Perfil visual que se usa en la generación de prompts de IA. Determina la paleta y estilo del anuncio.</small>
      </div>
      <div class="form-group">
        <label>Notas</label>
        <textarea name="notes" class="form-control">${escHtml(provider?.notes || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar cambios</button>
      </div>
    </form>
  `);

  document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.updateProvider(provider.id, data);
      showToast('Proveedor actualizado', 'success');
      closeModal();
      refreshSidebarCounts();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window._editProvider = async function(id) {
  try {
    const provider = await api.getProvider(id);
    window._openProviderForm(provider);
  } catch (err) {
    showToast('Error al cargar proveedor', 'error');
  }
};

window._deleteProvider = async function(id) {
  const ok = await confirmDialog('¿Eliminar este proveedor? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await api.deleteProvider(id);
    showToast('Proveedor eliminado', 'success');
    refreshSidebarCounts();
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window._warrantyRules = async function(providerId, providerName) {
  let rules = [];
  try {
    rules = await api.getWarrantyRules(providerId);
  } catch {}

  openModal(`
    <div class="modal-header">
      <h2>Garantías — ${escHtml(providerName)}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <details open>
        <summary style="cursor:pointer;font-size:.85rem;font-weight:600;margin-bottom:8px">Importar reglas (texto)</summary>
        <p style="font-size:.78rem;color:var(--text-secondary);margin:0 0 8px">Una regla por línea: <code>palabra-clave | garantía</code>. Ej: <code>Lavadora | 1 año de garantía</code></p>
        <textarea id="wr-bulk-text" class="form-control" rows="6" placeholder="Lavadora | 1 año de garantía&#10;Freidora | 6 meses de garantía&#10;Smart TV | 2 años de garantía"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button type="button" class="btn btn--primary btn--sm" id="wr-bulk-import">Importar</button>
          <span id="wr-bulk-status" style="font-size:.78rem;color:var(--text-muted)"></span>
        </div>
      </details>

      <details>
        <summary style="cursor:pointer;font-size:.85rem;font-weight:600;margin-bottom:8px">Agregar regla individual</summary>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input type="text" id="wr-keyword" class="form-control" placeholder="Palabra clave" style="flex:1" />
          <input type="text" id="wr-warranty" class="form-control" placeholder="Texto de garantía" style="flex:2" />
          <button type="button" class="btn btn--primary btn--sm" id="wr-add">Agregar</button>
        </div>
      </details>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:.85rem;font-weight:600">Reglas existentes (${rules.length})</span>
        </div>
        <div id="wr-list" style="max-height:250px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
          ${rules.length === 0
            ? '<div style="font-size:.8rem;color:var(--text-muted);padding:12px;text-align:center">No hay reglas de garantía para este proveedor</div>'
            : rules.map(r => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:.82rem" data-id="${r.id}">
                <span style="font-weight:600;min-width:120px">${escHtml(r.keyword)}</span>
                <span style="flex:1;color:var(--text-secondary)">${escHtml(r.warranty_text)}</span>
                <button type="button" class="btn btn--sm btn--ghost wr-delete" data-id="${r.id}" style="color:var(--error);padding:2px 4px" title="Eliminar">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>`).join('')}
        </div>
      </div>
    </div>
  `, 'modal-content--wide');

  document.getElementById('wr-bulk-import').addEventListener('click', async () => {
    const text = document.getElementById('wr-bulk-text').value.trim();
    const status = document.getElementById('wr-bulk-status');
    if (!text) { showToast('Pegá al menos una regla', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const rules = lines.map(line => {
      const parts = line.split('|').map(s => s.trim());
      return { keyword: parts[0] || '', warranty_text: parts[1] || '' };
    }).filter(r => r.keyword && r.warranty_text);
    try {
      const res = await api.bulkWarrantyRules({ provider_id: providerId, rules });
      status.textContent = `${res.created} regla(s) importada(s)`;
      showToast(`${res.created} regla(s) guardada(s)`, 'success');
      document.getElementById('wr-bulk-text').value = '';
      window._warrantyRules(providerId, providerName);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('wr-add').addEventListener('click', async () => {
    const keyword = document.getElementById('wr-keyword').value.trim();
    const warranty_text = document.getElementById('wr-warranty').value.trim();
    if (!keyword || !warranty_text) { showToast('Completá ambos campos', 'error'); return; }
    try {
      await api.createWarrantyRule({ provider_id: providerId, keyword, warranty_text });
      showToast('Regla agregada', 'success');
      window._warrantyRules(providerId, providerName);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.querySelectorAll('.wr-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.deleteWarrantyRule(btn.dataset.id);
        btn.closest('[data-id]').remove();
        showToast('Regla eliminada', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
};
