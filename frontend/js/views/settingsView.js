import { api } from '../db/api.js';
import { showToast, confirmDialog, openModal, closeModal, setModalCloseGuard } from '../core/app.js';

let currentContainer = null;
let currentSettings = null;

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando configuración...</div>';

  try {
    const [settings, categories, providerStyles] = await Promise.all([
      api.getSettings(),
      api.getCategories(),
      api.getProviderStyles(),
    ]);
    currentSettings = settings;
    renderPage(container, settings, categories, providerStyles);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderPage(container, settings, categories, providerStyles) {
  const pc = settings.publish_config || {};
  const template = pc.template || '';
  const ai = pc.ai || {};
  const fb = pc.facebook || {};

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Configuración</h1>
          <p>Tipo de cambio, categorías y texto de publicación</p>
        </div>
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 16px">Tipo de cambio</h3>
          <form id="settings-form">
            <div class="form-group">
              <label>Tipo de cambio (1 USD = ? MN)</label>
              <input type="number" name="exchange_rate" class="form-control"
                value="${settings.exchange_rate}" min="1" step="1" required />
              <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                Se usa en ventas e imágenes promocionales. Actualízalo según la tasa del día.
              </small>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Guardar</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h3 style="margin:0 0 12px">Info</h3>
          <ul style="font-size:.85rem;color:var(--text-secondary);line-height:1.8;padding-left:16px;margin:0">
            <li>Los precios de productos se ingresan en <strong>USD</strong></li>
            <li>Las comisiones pueden ser en <strong>USD</strong> o <strong>MN</strong> según el proveedor</li>
            <li>En ventas, el total se muestra en USD + MN</li>
            <li>Al renombrar una categoría, los productos asociados se actualizan automáticamente</li>
          </ul>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">Plantilla de publicación</h3>
        <p style="margin:0 0 16px;font-size:.82rem;color:var(--text-secondary)">
          Definí el formato del texto que se genera automáticamente. Usá los placeholders
          <code>{NAME}</code>, <code>{PRICE}</code>, <code>{DESCRIPTION}</code>,
          <code>{WARRANTY}</code>, <code>{CATEGORY}</code>, <code>{STOCK}</code>
          para insertar datos del producto.
        </p>
        <form id="publish-template-form">
          <div class="form-group">
            <label>Plantilla</label>
            <textarea name="template" class="form-control" style="min-height:220px;font-family:monospace;font-size:.82rem;line-height:1.5">${escHtml(template)}</textarea>
          </div>

          <details style="margin-top:16px" ${ai.enabled ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">⚙ Generación con IA (opcional)</summary>
            <div style="margin-top:12px">
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
                  <input type="checkbox" name="ai_enabled" value="1" ${ai.enabled ? 'checked' : ''} style="width:16px;height:16px" />
                  Habilitar generación automática de descripciones con IA
                </label>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>API URL</label>
                  <input type="url" name="ai_api_url" class="form-control" value="${escAttr(ai.api_url || 'https://api.openai.com/v1')}" placeholder="https://api.openai.com/v1" />
                </div>
                <div class="form-group">
                  <label>Modelo</label>
                  <input type="text" name="ai_model" class="form-control" value="${escAttr(ai.model || 'gpt-4o-mini')}" placeholder="gpt-4o-mini" />
                </div>
              </div>
              <div class="form-group">
                <label>API Key</label>
                <input type="password" name="ai_api_key" class="form-control" value="${escAttr(ai.api_key || '')}" placeholder="sk-..." />
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                  Probá gratis con <a href="https://freetokenrouter.cn" target="_blank" rel="noopener">Free Token Router</a>
                  (modelo: <code>qwen-turbo</code>, URL: <code>https://freetokenrouter.cn/api/v1</code>)
                  o <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>
                  (modelo: <code>openrouter/free</code>)
                </small>
              </div>
              <div class="form-group">
                <label>Prompt del sistema</label>
                <textarea name="ai_system_prompt" class="form-control" style="min-height:100px;font-size:.82rem">${escHtml(ai.system_prompt || '')}</textarea>
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Instrucciones para la IA sobre cómo generar la descripción del producto</small>
              </div>
            </div>
          </details>

          <details style="margin-top:12px" ${fb.page_id ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">🌐 Publicación en Facebook (opcional)</summary>
            <div style="margin-top:12px">
              <div class="form-row">
                <div class="form-group">
                  <label>Facebook Page ID</label>
                  <input type="text" name="fb_page_id" class="form-control" value="${escAttr(fb.page_id || '')}" placeholder="Ej: 123456789012345" />
                </div>
                <div class="form-group">
                  <label>Instagram Account ID (opcional)</label>
                  <input type="text" name="fb_instagram_id" class="form-control" value="${escAttr(fb.instagram_id || '')}" placeholder="Ej: 17841400000000000" />
                </div>
              </div>
              <div class="form-group">
                <label>Facebook Page Access Token</label>
                <input type="password" name="fb_access_token" class="form-control" value="${escAttr(fb.access_token || '')}" placeholder="EAAC..." />
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                  Token de larga duración. Se genera desde Facebook Developers. Requiere permisos: <code>pages_manage_posts</code>, <code>pages_read_engagement</code>.
                </small>
              </div>
            </div>
          </details>

          <div class="form-actions" style="margin-top:16px">
            <button type="submit" class="btn btn--primary">Guardar plantilla</button>
          </div>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Categorías de productos</h3>
            <p style="margin:4px 0 0;font-size:.82rem;color:var(--text-secondary)">${categories.length} categoría(s) disponibles en formularios y filtros</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" id="btn-add-category">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva categoría
          </button>
        </div>

        ${categories.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>No hay categorías. Agrega la primera.</p></div>'
          : `<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th style="width:100px">Productos</th>
                    <th style="width:120px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${categories.map(c => `
                    <tr>
                      <td><span style="font-weight:500">${escHtml(c.name)}</span></td>
                      <td><span style="font-size:.82rem;color:var(--text-secondary)">${c.product_count || 0}</span></td>
                      <td>
                        <div class="actions-cell">
                          <button type="button" class="btn btn--sm btn--ghost btn-edit-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Editar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button type="button" class="btn btn--sm btn--ghost btn-delete-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Eliminar" style="color:var(--error)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>

      <div class="card" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Estilos de Proveedor</h3>
            <p style="margin:4px 0 0;font-size:.82rem;color:var(--text-secondary)">Perfiles visuales que usa el motor de prompts al generar anuncios. Asigná un estilo a cada proveedor desde la sección de Proveedores.</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" id="btn-add-style">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo estilo
          </button>
        </div>
        ${providerStyles.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>No hay estilos configurados.</p></div>'
          : `<div style="display:flex;flex-direction:column;gap:12px">
              ${providerStyles.map(s => {
                const palette = typeof s.palette === 'object' ? s.palette : {};
                return `
                <details style="border:1px solid var(--border);border-radius:8px;padding:0">
                  <summary style="cursor:pointer;padding:12px 16px;font-weight:600;display:flex;align-items:center;gap:10px">
                    <span class="badge badge--active">${escHtml(s.code)}</span>
                    <span>${escHtml(s.name)}</span>
                    <span style="font-size:.78rem;color:var(--text-muted);margin-left:auto">${escHtml(s.style_name)}</span>
                  </summary>
                  <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px">
                    <div class="style-palette-section" data-code="${s.code}">
                      ${paletteBuilderHTML(palette)}
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de fondo</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="background_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.background_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de acentos</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="accent_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.accent_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de firma</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="signature_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.signature_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Restricciones del perfil</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="negative_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.negative_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Envío gratis (texto del prompt)</label>
                      <input type="text" class="form-control style-rule" data-code="${s.code}" data-field="shipping_rule" value="${escAttr(s.shipping_rule || '')}" placeholder="Envío: GRATIS a ..." />
                      <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Texto que aparece en el prompt generado. Si está vacío, usa el valor por defecto.</small>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center">
                      <button type="button" class="btn btn--primary btn--sm btn-save-style" data-code="${s.code}">Guardar estilo</button>
                      <button type="button" class="btn btn--sm btn--ghost btn-delete-style" data-code="${s.code}" data-name="${escAttr(s.name)}" style="color:var(--error);margin-left:auto">Eliminar</button>
                    </div>
                  </div>
                </details>`;
              }).join('')}
            </div>`
        }
      </div>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.exchange_rate = parseFloat(data.exchange_rate);

    try {
      await api.updateSettings(data);
      currentSettings = { exchange_rate: data.exchange_rate };
      showToast('Tipo de cambio actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('publish-template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const publish_config = {
      template: fd.get('template') || '',
      ai: {
        enabled: fd.get('ai_enabled') === '1',
        api_url: fd.get('ai_api_url') || '',
        api_key: fd.get('ai_api_key') || '',
        model: fd.get('ai_model') || '',
        system_prompt: fd.get('ai_system_prompt') || ''
      },
      facebook: {
        page_id: fd.get('fb_page_id') || '',
        instagram_id: fd.get('fb_instagram_id') || '',
        access_token: fd.get('fb_access_token') || ''
      }
    };

    try {
      const res = await api.updateSettings({
        exchange_rate: currentSettings?.exchange_rate || settings?.exchange_rate || 61000,
        publish_config
      });
      currentSettings = res;
      showToast('Plantilla de publicación guardada', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-add-category')?.addEventListener('click', () => openCategoryForm());
  container.querySelectorAll('.btn-edit-category').forEach(btn => {
    btn.addEventListener('click', () => openCategoryForm(btn.dataset.id, btn.dataset.name));
  });
  container.querySelectorAll('.btn-delete-category').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.id, btn.dataset.name));
  });

  container.querySelectorAll('.btn-save-style').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      const fields = container.querySelectorAll(`.style-rule[data-code="${code}"]`);
      const data = {};
      fields.forEach(el => { data[el.dataset.field] = el.value; });
      const paletteSection = container.querySelector(`.style-palette-section[data-code="${code}"]`);
      if (paletteSection) {
        data.palette = collectPaletteFrom(paletteSection);
      }
      try {
        await api.updateProviderStyle(code, data);
        showToast(`Estilo ${code} actualizado`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  initPaletteBuilder();
  refreshPaletteSummaries();

  document.getElementById('btn-add-style')?.addEventListener('click', () => openStyleForm());

  container.querySelectorAll('.btn-delete-style').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(`¿Eliminar el estilo "${btn.dataset.name}" (${btn.dataset.code})?`, {
        title: 'Eliminar estilo',
        danger: true,
        confirmText: 'Eliminar'
      });
      if (!ok) return;
      try {
        await api.deleteProviderStyle(btn.dataset.code);
        showToast('Estilo eliminado', 'success');
        render(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function openCategoryForm(id = null, name = '') {
  openModal(`
    <div class="modal-header">
      <h2>${id ? 'Editar categoría' : 'Nueva categoría'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="category-form">
      <div class="form-group">
        <label>Nombre *</label>
        <input type="text" name="name" class="form-control" value="${escAttr(name)}" required autofocus />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${id ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('category-form');
  const initialSnapshot = snapshotForm(form);

  setModalCloseGuard(async () => {
    if (snapshotForm(form) === initialSnapshot) return true;
    return confirmDialog('¿Descartar los cambios sin guardar?', {
      title: 'Cambios sin guardar',
      confirmText: 'Descartar',
      danger: true,
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const trimmed = new FormData(e.target).get('name').trim();
    if (!trimmed) {
      showToast('El nombre no puede estar vacío', 'error');
      return;
    }

    try {
      if (id) {
        await api.updateCategory(id, { name: trimmed });
        showToast('Categoría actualizada', 'success');
      } else {
        await api.createCategory({ name: trimmed });
        showToast('Categoría creada', 'success');
      }
      closeModal(true);
      const categories = await api.getCategories();
      renderPage(currentContainer, currentSettings, categories);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteCategory(id, name) {
  const ok = await confirmDialog(
    `¿Eliminar la categoría "${name}"? Solo es posible si ningún producto la usa.`,
    { title: 'Eliminar categoría', confirmText: 'Eliminar', danger: true }
  );
  if (!ok) return;

  try {
    await api.deleteCategory(id);
    showToast('Categoría eliminada', 'success');
    const categories = await api.getCategories();
    renderPage(currentContainer, currentSettings, categories);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

const BRAND_BASE_COLORS = [
  { label: 'Navy', hex: '#08245A' },
  { label: 'Deep Navy', hex: '#061633' },
  { label: 'Naranja', hex: '#FF6A00' },
  { label: 'Dorado', hex: '#D9A928' },
  { label: 'Blanco', hex: '#FFFFFF' },
];

function normalizePaletteEntries(palette = {}) {
  const entries = Object.entries(palette || {}).filter(([k]) => k);
  if (entries.length === 0) return [{ label: '', hex: '#08245A', pct: 0 }];
  return entries.map(([label, val]) => {
    if (val && typeof val === 'object' && typeof val.hex === 'string') {
      const pct = Number(val.pct);
      return { label, hex: val.hex, pct: Number.isFinite(pct) ? pct : 0 };
    }
    return { label, hex: typeof val === 'string' ? val : '#08245A', pct: 0 };
  });
}

function paletteBuilderHTML(existingPalette = {}) {
  const rows = normalizePaletteEntries(existingPalette);
  return `
    <div class="form-group">
      <label>Paleta de colores y proporciones</label>
      <div style="margin-bottom:10px">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">Paleta base DaniMarvis (referencia):</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${BRAND_BASE_COLORS.map(c => `
            <span title="${escHtml(c.label)}: ${c.hex}" style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;color:var(--text-muted);background:var(--bg);padding:3px 8px;border-radius:12px">
              <span style="width:14px;height:14px;border-radius:50%;background:${c.hex};border:1px solid var(--border);display:inline-block;flex-shrink:0"></span>
              ${c.hex}
            </span>
          `).join('')}
        </div>
      </div>
      <div class="palette-rows" style="display:flex;flex-direction:column;gap:6px">
        ${rows.map(r => paletteRowHTML(r.label, r.hex, r.pct)).join('')}
      </div>
      <button type="button" class="btn btn--sm btn--ghost palette-add-btn" style="margin-top:6px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Agregar color
      </button>
      <div class="palette-summary"></div>
      <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:4px">Colores específicos de este estilo. Mové la barra para ajustar la proporción de cada color; en el prompt se envía como rango (±10%).</small>
    </div>
  `;
}

function paletteRowHTML(label = '', hex = '#08245A', pct = 0) {
  const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `
    <div class="palette-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px">
      <input type="text" class="form-control palette-label" placeholder="Nombre" value="${escAttr(label)}" style="flex:1 1 110px;font-size:.82rem" />
      <input type="color" class="palette-color" value="${hex}" style="width:34px;height:30px;padding:2px;border:1px solid var(--border);border-radius:4px;cursor:pointer;flex-shrink:0" />
      <span class="palette-hex" style="font-size:.72rem;font-family:monospace;color:var(--text-muted);min-width:52px">${escHtml(hex)}</span>
      <div style="flex:1 1 150px;display:flex;align-items:center;gap:6px;min-width:150px">
        <input type="range" class="palette-pct" min="0" max="100" step="1" value="${safePct}" style="flex:1" title="Proporción del color" />
        <input type="number" class="palette-pct-num" min="0" max="100" value="${safePct}" style="width:50px;font-size:.8rem;padding:4px 6px;border:1px solid var(--border);border-radius:4px" />
        <span style="font-size:.75rem;color:var(--text-muted)">%</span>
      </div>
      <button type="button" class="btn btn--sm btn--ghost palette-remove" style="color:var(--error);padding:2px 4px;flex-shrink:0" title="Eliminar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function setPalettePct(row, v) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const s = row.querySelector('.palette-pct');
  const n = row.querySelector('.palette-pct-num');
  if (s) s.value = clamped;
  if (n) n.value = clamped;
}

function normalizePalette(root) {
  const formGroup = root.closest('.form-group') || (root.classList && root.classList.contains('form-group') ? root : null);
  if (!formGroup) return;
  const rows = Array.from(formGroup.querySelectorAll('.palette-row'));
  if (rows.length === 0) return;
  const pcts = rows.map(r => Number(r.querySelector('.palette-pct').value) || 0);
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const each = Math.floor(100 / rows.length);
    rows.forEach((r, i) => setPalettePct(r, i === rows.length - 1 ? 100 - each * (rows.length - 1) : each));
  } else {
    let assigned = 0;
    rows.forEach((r, i) => {
      if (i === rows.length - 1) {
        setPalettePct(r, 100 - assigned);
      } else {
        const v = Math.round((pcts[i] / sum) * 100);
        setPalettePct(r, v);
        assigned += v;
      }
    });
  }
  renderPaletteSummary(root);
}

function renderPaletteSummary(root) {
  const formGroup = root.closest ? root.closest('.form-group') : null;
  const container = formGroup || root;
  const box = container.querySelector && container.querySelector('.palette-summary');
  if (!box) return;
  const rows = Array.from(container.querySelectorAll('.palette-row'));
  const items = rows.map(row => ({
    hex: row.querySelector('.palette-color').value,
    pct: Number(row.querySelector('.palette-pct').value) || 0,
    name: (row.querySelector('.palette-label').value || '').trim(),
  }));
  const total = items.reduce((s, i) => s + Math.max(0, i.pct), 0);
  if (items.length === 0) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;height:14px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
        ${items.map(i => `<div title="${escAttr(i.name)} ${i.pct}%" style="flex:${Math.max(i.pct, 0.1)};background:${i.hex};min-width:${i.pct > 0 ? '2px' : '0'}"></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:.72rem;color:var(--text-muted)">Total: <b>${total}%</b>${total > 100 ? ' <span style="color:#b8860b">(supera 100%)</span>' : ''}</span>
        <button type="button" class="btn btn--sm btn--ghost palette-reset-btn" style="padding:2px 8px;font-size:.75rem">Normalizar a 100%</button>
      </div>
    </div>
  `;
}

function refreshPaletteSummaries() {
  document.querySelectorAll('.palette-rows').forEach(rowsEl => {
    renderPaletteSummary(rowsEl);
  });
}

function collectPaletteFrom(root) {
  const palette = {};
  (root || document).querySelectorAll('.palette-row').forEach(row => {
    const label = row.querySelector('.palette-label').value.trim();
    const hex = row.querySelector('.palette-color').value;
    const pctInput = row.querySelector('.palette-pct');
    const pct = Number(pctInput ? pctInput.value : 0);
    if (label) palette[label] = { hex, pct: Math.max(0, Math.min(100, Math.round(pct || 0))) };
  });
  return palette;
}

function collectPalette() {
  return collectPaletteFrom(document);
}

function initPaletteBuilder() {
  if (window._paletteBuilderInit) return;
  window._paletteBuilderInit = true;

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('palette-color')) {
      const hex = e.target.value;
      const row = e.target.closest('.palette-row');
      row.querySelector('.palette-hex').textContent = hex;
    } else if (e.target.classList.contains('palette-pct')) {
      const row = e.target.closest('.palette-row');
      setPalettePct(row, e.target.value);
      renderPaletteSummary(row);
    } else if (e.target.classList.contains('palette-pct-num')) {
      const row = e.target.closest('.palette-row');
      const n = Number(e.target.value);
      const clamped = Math.max(0, Math.min(100, Math.round(n || 0)));
      setPalettePct(row, clamped);
      renderPaletteSummary(row);
    } else if (e.target.classList.contains('palette-label')) {
      const row = e.target.closest('.palette-row');
      renderPaletteSummary(row);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.palette-remove')) {
      const row = e.target.closest('.palette-row');
      const parent = row.parentElement;
      if (parent.querySelectorAll('.palette-row').length > 1) {
        row.remove();
        renderPaletteSummary(row);
      } else {
        showToast('Debe haber al menos un color', 'warning');
      }
    }
    if (e.target.closest('.palette-add-btn')) {
      const rowsContainer = e.target.closest('.form-group').querySelector('.palette-rows');
      if (rowsContainer) {
        rowsContainer.insertAdjacentHTML('beforeend', paletteRowHTML('', '#08245A', 0));
        renderPaletteSummary(rowsContainer);
      }
    }
    if (e.target.closest('.palette-reset-btn')) {
      normalizePalette(e.target.closest('.form-group'));
    }
  });
}

function openStyleForm() {
  openModal(`
    <div class="modal-header">
      <h2>Nuevo estilo de proveedor</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
      Creá un nuevo perfil visual para un proveedor. El ADN de la marca (paleta base, tipografía, personalidad) se mantiene siempre como base. Este estilo se superpone como variación visual.
    </p>
    <form id="style-form">
      <div class="form-row" style="grid-template-columns:1fr 2fr">
        <div class="form-group">
          <label>Código del estilo *</label>
          <input type="text" name="code" class="form-control" placeholder="Ej: NP" maxlength="5" required style="text-transform:uppercase;font-weight:700;font-family:monospace" />
          <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Identificador corto (máx. 5 caracteres)</small>
        </div>
        <div class="form-group">
          <label>Nombre del estilo *</label>
          <input type="text" name="name" class="form-control" placeholder="Ej: MiPime Nuevo Proveedor" required />
        </div>
      </div>
      <div class="form-group">
        <label>Nombre interno (prompt) *</label>
        <input type="text" name="style_name" class="form-control" placeholder="Ej: DANIMARVIS_CUSTOM" required style="font-family:monospace;font-size:.85rem" />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Nombre que aparece en el prompt generado. Formato recomendado: DANIMARVIS_XXX</small>
      </div>
      ${paletteBuilderHTML({})}
      <div class="form-group">
        <label>Reglas de fondo</label>
        <textarea name="background_rules" class="form-control" rows="3" placeholder="Describí cómo deben ser los fondos de los anuncios de este proveedor..."></textarea>
      </div>
      <div class="form-group">
        <label>Reglas de acentos</label>
        <textarea name="accent_rules" class="form-control" rows="3" placeholder="Describí cómo usar los colores de acento..."></textarea>
      </div>
      <div class="form-group">
        <label>Reglas de firma visual</label>
        <textarea name="signature_rules" class="form-control" rows="3" placeholder="Elementos visuales distintivos de este estilo..."></textarea>
      </div>
      <div class="form-group">
        <label>Restricciones del perfil</label>
        <textarea name="negative_rules" class="form-control" rows="3" placeholder="Qué NO hacer en los anuncios de este estilo..."></textarea>
      </div>
      <div class="form-group">
        <label>Texto de envío</label>
        <input type="text" name="shipping_rule" class="form-control" placeholder="Envío: GRATIS a ..." />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Si está vacío, se usa el valor por defecto.</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">Crear estilo</button>
      </div>
    </form>
  `, 'modal-content--wide');

  initPaletteBuilder();
  refreshPaletteSummaries();

  document.getElementById('style-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.code = data.code.trim().toUpperCase();
    data.name = data.name.trim();
    data.style_name = data.style_name.trim();
    data.palette = collectPalette();
    if (!data.code || !data.name || !data.style_name) {
      showToast('Código, nombre y nombre de estilo son obligatorios', 'error');
      return;
    }
    try {
      await api.createProviderStyle(data);
      showToast(`Estilo ${data.code} creado`, 'success');
      closeModal(true);
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function snapshotForm(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
