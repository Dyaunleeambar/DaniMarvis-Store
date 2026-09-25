import { api } from '../db/api.js';
import { showToast, openModal, closeModal, confirmDialog } from '../core/app.js';
import { formatDateTime, debounce } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let currentContainer = null;
let currentTab = 'pending';
let timerInterval = null;

function formatTimer(ms) {
  if (ms <= 0) return '<span style="color:var(--success);font-weight:600">Listo para publicar</span>';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

function generateVariants(text) {
  if (!text || !text.trim()) return [text];
  const variants = [text];
  const substitutions = [
    [/[¡!]/g, ''],
    [/\./g, ','],
    [/,/g, '.'],
    [/\bexcelente\b/gi, 'increíble'],
    [/\bincreíble\b/gi, 'fantástico'],
    [/\bobtén\b/gi, 'conseguí'],
    [/\badquiere\b/gi, 'llévate'],
    [/\bdisponible\b/gi, 'a la venta'],
    [/\bhermoso\b/gi, 'espectacular'],
    [/\bgenial\b/gi, 'maravilloso'],
    [/\bmuy bueno\b/gi, 'de primera calidad'],
    [/\benvío gratis\b/gi, 'delivery sin costo'],
    [/\bgarantía\b/gi, 'garantía'],
  ];

  const v1 = text.replace(/([!?])/g, (m) => m === '!' ? '¡' : '¿') + (text.endsWith('!') ? '' : ' ¡No te lo pierdas!');
  if (v1 !== text) variants.push(v1);

  let v2 = text;
  for (let i = 0; i < Math.min(2, substitutions.length); i++) {
    v2 = v2.replace(substitutions[i][0], substitutions[i][1]);
  }
  if (v2 !== text && v2 !== variants[variants.length - 1]) variants.push(v2);

  return variants.slice(0, 3);
}

export async function render(container) {
  currentContainer = container;
  const qIndex = window.location.hash.indexOf('?');
  const query = qIndex >= 0 ? window.location.hash.slice(qIndex + 1) : '';
  const params = new URLSearchParams(query);
  if (params.get('tab') === 'groups') currentTab = 'groups';
  else if (params.get('tab') === 'pending') currentTab = 'pending';
  else if (params.get('tab') === 'add') currentTab = 'add';
  else if (params.get('tab') === 'history') currentTab = 'history';
  else if (params.get('tab') === 'timers') currentTab = 'timers';

  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando...</div>';
  try {
    renderPage(container);
    startTimerRefresh();
    return cleanup;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderPage(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Cola de Publicaciones</h1>
          <p>Prepará, variantes y registrá publicaciones en grupos</p>
        </div>
      </div>
      <div class="filter-bar" style="gap:4px">
        <button class="btn btn--sm ${currentTab === 'pending' ? 'btn--primary' : 'btn--secondary'}" id="tab-pending">Pendientes</button>
        <button class="btn btn--sm ${currentTab === 'add' ? 'btn--primary' : 'btn--secondary'}" id="tab-add">Agregar a cola</button>
        <button class="btn btn--sm ${currentTab === 'history' ? 'btn--primary' : 'btn--secondary'}" id="tab-history">Historial</button>
        <button class="btn btn--sm ${currentTab === 'timers' ? 'btn--primary' : 'btn--secondary'}" id="tab-timers">Temporizadores</button>
        <button class="btn btn--sm ${currentTab === 'groups' ? 'btn--primary' : 'btn--secondary'}" id="tab-groups">Grupos</button>
      </div>
      <div id="pubq-tab-content"></div>
    </div>
  `;

  document.getElementById('tab-pending').addEventListener('click', () => { currentTab = 'pending'; renderPage(container); });
  document.getElementById('tab-add').addEventListener('click', () => { currentTab = 'add'; renderPage(container); });
  document.getElementById('tab-history').addEventListener('click', () => { currentTab = 'history'; renderPage(container); });
  document.getElementById('tab-timers').addEventListener('click', () => { currentTab = 'timers'; renderPage(container); });
  document.getElementById('tab-groups').addEventListener('click', () => { currentTab = 'groups'; renderPage(container); });

  const content = document.getElementById('pubq-tab-content');

  switch (currentTab) {
    case 'pending': renderPending(content); break;
    case 'add': renderAddForm(content); break;
    case 'history': renderHistory(content); break;
    case 'timers': renderTimers(content); break;
    case 'groups': renderGroups(content); break;
  }
}

async function renderPending(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando cola...</div>';
  try {
    const [items, timerData, dueItems, autoStatus] = await Promise.all([
      api.getPubQueue(),
      api.getPubQueueTimer(),
      api.getPubQueueDue(),
      api.getGroupPublishStatus(),
    ]);

    const dueIds = new Set(dueItems.map(d => d.id));
    const pending = items.filter(i => i.status === 'pending' || i.status === 'prepared');
    const timerMap = {};
    for (const t of timerData.timers) {
      timerMap[t.group_name.toLowerCase()] = t;
    }

    const ap = autoStatus?.config || {};
    const cfgTxt = ap.enabled
      ? `ON · ${ap.mode === 'prepare' ? 'preparar' : 'publicar'} · cap ${ap.daily_cap}/día · ${ap.hours_from}:00–${ap.hours_to}:00 · gap ${ap.min_gap_min}min · cooldown ${ap.cooldown_min}min`
      : 'OFF (activá el worker en Ajustes)';
    const last = autoStatus?.lastResult;
    let lastTxt = 'sin corridas todavía';
    if (autoStatus?.running) lastTxt = '<span style="color:var(--warning)">⏳ disparando en Chrome...</span>';
    else if (last) {
      if (last.grabbed) lastTxt = `${last.started} · ${last.published} publicados · ${last.prepared} preparados · ${last.errors} errores`;
      else lastTxt = `${last.started} · ${last.error || last.message || last.reason || 'vacío'}`;
    }
    const barHtml = `
      <div class="card" style="padding:10px 14px;margin-bottom:6px;font-size:.8rem">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:600">🤖 Auto-publicado:</span>
          <span class="badge ${ap.enabled ? 'badge--active' : ''}">${cfgTxt}</span>
          <span style="color:var(--text-muted)">| Última corrida: ${lastTxt}</span>
          <button class="btn btn--sm btn--secondary" id="pubq-run-all" ${autoStatus?.running ? 'disabled' : ''}>Correr vencidos</button>
        </div>
      </div>`;

    if (pending.length === 0) {
      container.innerHTML = `
        ${barHtml}
        <div class="empty-state" style="padding:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <h3>Cola vacía</h3>
          <p>Agregá publicaciones desde "Publicar en Facebook" o la pestaña "Agregar a cola"</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      ${barHtml}
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        ${pending.map(item => {
          const timer = timerMap[item.group_name.toLowerCase()];
          const canPublish = !timer || timer.can_publish;
          const isDue = dueIds.has(item.id);

          let stateHtml = '';
          if (item.status === 'prepared') {
            stateHtml = `<span style="font-size:.72rem;color:var(--info,#3b82f6);font-weight:600">🧰 Preparado en pestaña</span>`;
          } else if (item.scheduled_at && !isDue) {
            stateHtml = `<span style="font-size:.72rem;color:var(--text-muted)">📅 Programado para ${formatDateTime(item.scheduled_at)}</span>`;
          } else if (isDue) {
            stateHtml = `<span style="font-size:.72rem;color:var(--success);font-weight:600">⏰ Listo para publicar</span>`;
          } else {
            stateHtml = `<span style="font-size:.72rem;color:var(--success)">✓ Listo</span>`;
          }

          const timerHtml = timer && !canPublish
            ? `<span style="font-size:.72rem;color:var(--text-muted)">⏳ ${formatTimer(timer.remaining_ms)} cooldown del grupo</span>`
            : '';

          return `
            <div class="card" style="padding:16px" data-id="${item.id}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                    <span style="font-weight:600;font-size:.9rem;color:var(--rose)">${escHtml(item.group_name)}</span>
                    ${stateHtml}
                    ${timerHtml}
                    ${item.variant_index > 0 ? `<span style="font-size:.68rem;padding:2px 6px;border-radius:50px;background:var(--bg);color:var(--text-muted)">variante ${item.variant_index}</span>` : ''}
                  </div>
                  <div style="font-size:.82rem;color:var(--text-secondary);white-space:pre-wrap;max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--bg);margin-bottom:8px;cursor:pointer" class="pubq-copy-text" data-text="${escAttr(item.variant_text || item.publish_text || '')}">
                    ${escHtml((item.variant_text || item.publish_text || 'Sin texto').slice(0, 300))}${(item.variant_text || item.publish_text || '').length > 300 ? '...' : ''}
                  </div>
                  <div style="font-size:.72rem;color:var(--text-muted)">Clic en el texto para copiar</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
                  ${isDue && item.status !== 'prepared' ? `<button class="btn btn--sm btn--primary pubq-auto" data-id="${item.id}">🚀 Auto-publicar</button>` : ''}
                  ${isDue && item.status !== 'prepared' ? `<button class="btn btn--sm btn--ghost pubq-prepare" data-id="${item.id}">🧰 Preparar en pestaña</button>` : ''}
                  ${item.status === 'prepared' ? `<button class="btn btn--sm btn--primary pubq-auto" data-id="${item.id}">🚀 Publicar ahora</button>` : ''}
                  ${isDue ? `<button class="btn btn--sm btn--secondary pubq-open-group" data-id="${item.id}">Abrir grupo + copiar</button>` : ''}
                  ${item.status === 'pending' ? `<button class="btn btn--sm btn--ghost pubq-edit" data-id="${item.id}">✎ Editar</button>` : ''}
                  <button class="btn btn--sm btn--ghost pubq-mark-published" data-id="${item.id}" ${!canPublish ? 'disabled style="opacity:.5"' : ''}>Publicado</button>
                  <button class="btn btn--sm btn--ghost pubq-skip" data-id="${item.id}">Omitir</button>
                  <button class="btn btn--sm btn--ghost pubq-delete" data-id="${item.id}" style="color:var(--error)">Quitar</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    container.querySelectorAll('.pubq-copy-text').forEach(el => {
      el.addEventListener('click', () => {
        const text = el.dataset.text;
        navigator.clipboard.writeText(text).then(() => {
          showToast('Texto copiado al portapapeles', 'success');
        }).catch(() => {
          showToast('No se pudo copiar', 'error');
        });
      });
    });

    container.querySelectorAll('.pubq-open-group').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = pending.find(i => i.id === btn.dataset.id);
        if (!item) return;
        const text = item.variant_text || item.publish_text || '';
        navigator.clipboard.writeText(text).then(() => {
          if (item.group_url) {
            window.open(item.group_url, '_blank');
            showToast('Texto copiado. Pegalo en el grupo', 'success');
          } else {
            showToast('Sin URL del grupo. Texto copiado.', 'success');
          }
        }).catch(() => {
          showToast('No se pudo copiar', 'error');
        });
      });
    });

    document.getElementById('pubq-run-all')?.addEventListener('click', async () => {
      const btn = document.getElementById('pubq-run-all');
      btn.disabled = true;
      btn.textContent = 'Corriendo...';
      try {
        const r = await api.runGroupPublish({ force: true });
        if (r.ok === false) throw new Error(r.error || 'No se pudo correr');
        showToast(r.message || `Procesados ${r.grabbed || 0}`, r.errors > 0 ? 'error' : 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
      renderPending(container);
    });

    container.querySelectorAll('.pubq-auto').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Publicando...';
        try {
          const r = await api.runGroupPublishOne(btn.dataset.id, { mode: 'publish', force: true });
          const res = r.results?.[0];
          if (r.ok === false) throw new Error(r.error || 'No se pudo publicar');
          if (res?.ok) showToast(res.message || 'Publicado', 'success');
          else throw new Error(res?.message || 'El grupo no se pudo publicar');
        } catch (err) {
          showToast(err.message, 'error');
        }
        renderPending(container);
      });
    });

    container.querySelectorAll('.pubq-prepare').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Preparando...';
        try {
          const r = await api.runGroupPublishOne(btn.dataset.id, { mode: 'prepare', force: true });
          const res = r.results?.[0];
          if (r.ok === false) throw new Error(r.error || 'No se pudo preparar');
          if (res?.ok) {
            showToast('Post preparado en la pestaña. Revisalo y publicalo.', 'success');
            window.open(res.url, '_blank');
          } else throw new Error(res?.message || 'No se pudo preparar el post');
        } catch (err) {
          showToast(err.message, 'error');
        }
        renderPending(container);
      });
    });

    container.querySelectorAll('.pubq-mark-published').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.updatePubQueue(btn.dataset.id, { status: 'published' });
          showToast('Marcada como publicada', 'success');
          renderPending(container);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.pubq-skip').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.updatePubQueue(btn.dataset.id, { status: 'skipped' });
          showToast('Omitida', 'success');
          renderPending(container);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.pubq-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = pending.find(i => i.id === btn.dataset.id);
        if (!item) return;
        await openEditModal(item);
      });
    });

    container.querySelectorAll('.pubq-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog('¿Quitar de la cola?');
        if (!ok) return;
        try {
          await api.deletePubQueue(btn.dataset.id);
          showToast('Eliminada de la cola', 'success');
          renderPending(container);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function renderAddForm(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando publicaciones y grupos...</div>';
  try {
    const [publications, groups] = await Promise.all([api.getPublications(), api.getGroups()]);
    renderQueueForm(container, { publications, groups }, null, async (payload) => {
      await api.addToPubQueue(payload);
    }, { mode: 'add' });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function imgSrc(url) {
  const s = String(url || '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\//.test(s)) return s;
  return '/uploads/' + s;
}

// --------------------------------------------------------------------------
// Formulario reutilizable de "Agregar a cola" (modo add) y edición de un ítem
// pendiente (modo edit). En modo edit solo se editan texto e imágenes.
// --------------------------------------------------------------------------
function renderQueueForm(root, ctx, initial, onSave, { mode = 'add' } = {}) {
  const publications = ctx.publications || [];
  const groups = ctx.groups || [];
  const st = {
    pubId: initial?.publication_id || publications[0]?.id || '',
    text: initial?.variant_text || initial?.publish_text || '',
    images: Array.isArray(initial?.images) ? initial.images.slice() : [],
    textTouched: !!initial,
    imagesDirty: !!initial,
    groupIds: new Set(),
    groupName: initial?.group_name || '',
    groupUrl: initial?.group_url || '',
    filter: { provider: '', category: '', vis: '', q: '' },
    useVariants: false,
  };
  if (!initial && st.pubId) {
    const first = publications.find(p => p.id === st.pubId);
    if (first) { st.text = first.publish_text || ''; st.images = (first.images || []).slice(); }
  }

  const providers = [...new Set(publications.map(p => p.provider_name).filter(Boolean))].sort();
  const categories = [...new Set(publications.map(p => p.category).filter(Boolean))].sort();

  function filteredPubs() {
    const f = st.filter;
    return publications.filter(p => {
      if (f.provider && p.provider_name !== f.provider) return false;
      if (f.category && p.category !== f.category) return false;
      if (f.vis === '1' && p.catalog_visible !== 1) return false;
      if (f.vis === '0' && p.catalog_visible === 1) return false;
      if (f.q) {
        const hay = `${p.product_name || ''} ${p.publish_text || ''} ${p.provider_name || ''}`.toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  function variantPreviewHtml() {
    if (!st.useVariants) return '';
    const variants = generateVariants(st.text);
    return `<div style="margin-top:6px">
      ${variants.map((v, i) => `
        <div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:var(--bg)">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px">Variante ${i + 1}</div>
          <div style="font-size:.82rem;white-space:pre-wrap">${escHtml(v)}</div>
        </div>`).join('')}
    </div>`;
  }

  root.innerHTML = `
    <div style="padding:16px;max-width:900px">
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 14px;font-size:1rem">${mode === 'edit' ? 'Editar elemento de la cola' : 'Agregar publicación a la cola'}</h3>

        ${mode === 'edit'
          ? `<div style="font-size:.82rem;color:var(--text-secondary);margin-bottom:12px">
               Grupo: <b>${escHtml(st.groupName || '—')}</b>
               ${initial?.product_name ? ` · Publicación: <b>${escHtml(initial.product_name)}</b>` : ''}
             </div>`
          : `
        <div style="margin-bottom:8px">
          <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Filtros de publicación</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <input type="text" id="pubq-filter-q" class="form-control" placeholder="Buscar por nombre o texto…" style="flex:2;min-width:180px" />
            <select id="pubq-filter-provider" class="form-control" style="flex:1;min-width:130px">
              <option value="">Proveedor: todos</option>
              ${providers.map(pv => `<option value="${escAttr(pv)}">${escHtml(pv)}</option>`).join('')}
            </select>
            <select id="pubq-filter-category" class="form-control" style="flex:1;min-width:130px">
              <option value="">Categoría: todas</option>
              ${categories.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('')}
            </select>
            <select id="pubq-filter-vis" class="form-control" style="flex:1;min-width:120px">
              <option value="">Visibilidad: todas</option>
              <option value="1">Visible en catálogo</option>
              <option value="0">Oculta</option>
            </select>
          </div>
          <div id="pubq-pub-list" style="margin-top:8px;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px"></div>
        </div>`}

        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Texto de la publicación (${mode === 'edit' ? 'editable' : 'editable, se precarga al elegir publicación'})</label>
            <textarea id="pubq-text" class="form-control" style="min-height:130px;white-space:pre-wrap">${escHtml(st.text)}</textarea>
          </div>

          ${mode === 'add' ? `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="pubq-use-variants" /> Generar variantes del texto
          </label>
          <div id="pubq-variant-preview">${variantPreviewHtml()}</div>` : ''}

          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Imágenes (máx. 6) — subí archivos o pegá con Ctrl+V sobre el área</label>
            <div id="pubq-images-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn--sm btn--secondary" id="pubq-img-add">+ Agregar imágenes</button>
            </div>
            <div id="pubq-img-paste" tabindex="0" style="border:1.5px dashed var(--border);border-radius:8px;padding:10px;margin-top:8px;font-size:.78rem;color:var(--text-muted);text-align:center;cursor:text">
              O pegalo acá (Ctrl+V): imágenes o texto
            </div>
            <input type="file" id="pubq-img-file" accept="image/*" multiple style="display:none" />
          </div>

          ${mode === 'add' ? `
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Grupos</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input type="text" id="pubq-group-name" class="form-control" placeholder="Nombre del grupo (si no usás la lista)" style="min-width:180px;flex:1.5" value="${escAttr(st.groupName)}" />
              <input type="text" id="pubq-group-url" class="form-control" placeholder="https://facebook.com/groups/... (opcional)" style="min-width:220px;flex:2" value="${escAttr(st.groupUrl)}" />
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
              <span style="font-size:.78rem;color:var(--text-secondary)">Grupos guardados:</span>
              <button class="btn btn--sm btn--ghost" id="pubq-pick9">Marcar 9</button>
              <button class="btn btn--sm btn--ghost" id="pubq-pick-clear">Limpiar</button>
            </div>
            <div id="pubq-groups-list" style="margin-top:6px;max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px"></div>
          </div>` : ''}
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          ${mode === 'edit' ? `<button class="btn btn--secondary" id="pubq-edit-cancel">Cancelar</button>` : ''}
          <button class="btn btn--primary" id="pubq-submit">${mode === 'edit' ? 'Guardar cambios' : 'Agregar a la cola'}</button>
        </div>
      </div>
    </div>
  `;

  const textEl = root.querySelector('#pubq-text');
  const gridEl = root.querySelector('#pubq-images-grid');

  function renderImages() {
    if (!gridEl) return;
    gridEl.innerHTML = st.images.length
      ? st.images.map((u, i) => `
          <div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
            <img src="${escAttr(imgSrc(u))}" style="width:100%;height:100%;object-fit:cover" alt="" />
            <button type="button" data-rm="${i}" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:1;cursor:pointer">✕</button>
          </div>`).join('')
      : '<div style="font-size:.78rem;color:var(--text-muted)">Sin imágenes</div>';
    gridEl.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        st.images.splice(Number(btn.dataset.rm), 1);
        st.imagesDirty = true;
        renderImages();
      });
    });
  }

  function renderPubList() {
    const listEl = root.querySelector('#pubq-pub-list');
    if (!listEl) return;
    const list = filteredPubs();
    if (!list.length) { listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted)">Sin publicaciones para esos filtros</div>'; return; }
    listEl.innerHTML = list.map(p => {
      const sel = p.id === st.pubId;
      const thumbs = (p.images || []).slice(0, 3);
      const price = p.price ? `$${Number(p.price).toLocaleString('es-CO')}` : '';
      return `
        <div data-pub="${p.id}" style="display:flex;gap:10px;align-items:center;border:1.5px solid ${sel ? 'var(--rose)' : 'var(--border)'};border-radius:8px;padding:8px;cursor:pointer;background:var(--bg)">
          <div style="display:flex;gap:4px;flex-shrink:0">
            ${thumbs.length ? thumbs.map(t => `<img src="${escAttr(imgSrc(t))}" style="width:44px;height:44px;border-radius:6px;object-fit:cover" alt="" />`).join('') : '<div style="width:44px;height:44px;border-radius:6px;background:var(--border);color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-size:.62rem">sin img</div>'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.85rem">${escHtml(p.product_name || 'Sin producto')}
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.catalog_visible === 1 ? 'var(--success,#22c55e)' : 'var(--text-muted)'};margin-left:6px" title="${p.catalog_visible === 1 ? 'Visible en catálogo' : 'Oculta'}"></span>
            </div>
            <div style="font-size:.72rem;color:var(--text-muted)">${[p.provider_name, price, p.category].filter(Boolean).join(' · ')}</div>
            <div style="font-size:.72rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml((p.publish_text || '').slice(0, 90))}</div>
          </div>
          <span style="font-size:1.1rem;color:${sel ? 'var(--rose)' : 'transparent'}">●</span>
        </div>`;
    }).join('');
    listEl.querySelectorAll('[data-pub]').forEach(card => {
      card.addEventListener('click', () => {
        const pub = publications.find(p => p.id === card.dataset.pub);
        st.pubId = pub.id;
        if (!st.textTouched) { st.text = pub.publish_text || ''; textEl.value = st.text; }
        if (!st.imagesDirty) { st.images = (pub.images || []).slice(); renderImages(); }
        renderPubList();
        renderVariants();
      });
    });
  }

  function renderGroups() {
    const listEl = root.querySelector('#pubq-groups-list');
    if (!listEl) return;
    if (!groups.length) { listEl.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted)">Sin grupos guardados. Agregalos en la pestaña "Grupos".</div>'; return; }
    listEl.innerHTML = groups.map(g => `
      <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer;padding:3px 4px;border-radius:6px;background:${st.groupIds.has(g.id) ? 'var(--bg)' : 'transparent'}">
        <input type="checkbox" class="pubq-gchk" data-gid="${g.id}" ${st.groupIds.has(g.id) ? 'checked' : ''} />
        <span>${escHtml(g.name)}</span>
      </label>`).join('');
    listEl.querySelectorAll('.pubq-gchk').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) st.groupIds.add(chk.dataset.gid);
        else st.groupIds.delete(chk.dataset.gid);
      });
    });
  }

  function renderVariants() {
    const pv = root.querySelector('#pubq-variant-preview');
    if (pv) pv.innerHTML = variantPreviewHtml();
  }

  // eventos de filtros -----------------------------------------------------
  const qEl = root.querySelector('#pubq-filter-q');
  qEl?.addEventListener('input', () => { st.filter.q = qEl.value.trim(); renderPubList(); });
  const fpEl = root.querySelector('#pubq-filter-provider');
  fpEl?.addEventListener('change', () => { st.filter.provider = fpEl.value; renderPubList(); });
  const fcEl = root.querySelector('#pubq-filter-category');
  fcEl?.addEventListener('change', () => { st.filter.category = fcEl.value; renderPubList(); });
  const fvEl = root.querySelector('#pubq-filter-vis');
  fvEl?.addEventListener('change', () => { st.filter.vis = fvEl.value; renderPubList(); });

  // texto y variantes --------------------------------------------------------
  textEl.addEventListener('input', () => { st.text = textEl.value; st.textTouched = true; renderVariants(); });
  const uvEl = root.querySelector('#pubq-use-variants');
  uvEl?.addEventListener('change', () => { st.useVariants = uvEl.checked; renderVariants(); });

  // imágenes ----------------------------------------------------------------
  const fileEl = root.querySelector('#pubq-img-file');
  root.querySelector('#pubq-img-add')?.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const files = Array.from(fileEl.files || []).slice(0, 6 - st.images.length);
    fileEl.value = '';
    for (const file of files) {
      try {
        const r = await api.uploadImage(file);
        if (r?.url) st.images.push(r.url);
      } catch (err) { showToast(`No se pudo subir ${file.name}: ${err.message}`, 'error'); }
    }
    st.imagesDirty = true;
    renderImages();
  });
  const pasteEl = root.querySelector('#pubq-img-paste');
  if (pasteEl) {
    pasteEl.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgItems = items.filter(it => it.type.startsWith('image/'));
      const textItems = items.filter(it => it.type === 'text/plain');
      if (imgItems.length) {
        e.preventDefault();
        for (const it of imgItems.slice(0, 6 - st.images.length)) {
          const file = it.getAsFile();
          if (!file) continue;
          try {
            const r = await api.uploadImage(file);
            if (r?.url) st.images.push(r.url);
          } catch (err) { showToast(`No se pudo pegar la imagen: ${err.message}`, 'error'); }
        }
        st.imagesDirty = true;
        renderImages();
      } else if (textItems.length) {
        e.preventDefault();
        const txt = e.clipboardData.getData('text/plain');
        if (txt) {
          st.text = (st.text ? st.text + '\n' : '') + txt;
          st.textTouched = true;
          textEl.value = st.text;
          renderVariants();
        }
      }
    });
    pasteEl.addEventListener('click', () => pasteEl.focus());
  }

  // grupos (solo add) -------------------------------------------------------
  if (mode === 'add') {
    const gnEl = root.querySelector('#pubq-group-name');
    const guEl = root.querySelector('#pubq-group-url');
    gnEl.addEventListener('input', () => { st.groupName = gnEl.value; });
    guEl.addEventListener('input', () => { st.groupUrl = guEl.value; });
    root.querySelector('#pubq-pick9')?.addEventListener('click', () => {
      st.groupIds.clear();
      groups.slice(0, 9).forEach(g => st.groupIds.add(g.id));
      renderGroups();
    });
    root.querySelector('#pubq-pick-clear')?.addEventListener('click', () => {
      st.groupIds.clear();
      renderGroups();
    });
  }

  // submit ------------------------------------------------------------------
  root.querySelector('#pubq-submit').addEventListener('click', async () => {
    const btn = root.querySelector('#pubq-submit');
    const variant_text = st.text.trim();
    if (!variant_text) { showToast('Escribí el texto de la publicación', 'error'); return; }

    const payload = {
      publication_id: st.pubId || null,
      variant_index: st.useVariants ? 1 : 0,
      variant_text,
      images: st.images.slice(0, 6),
    };

    if (mode === 'edit') {
      btn.disabled = true;
      try { await onSave(payload); showToast('Elemento actualizado', 'success'); } catch (err) { showToast(err.message, 'error'); btn.disabled = false; return; }
      return;
    }

    const gids = [...st.groupIds];
    if (gids.length) {
      payload.group_ids = gids;
    } else if (st.groupName) {
      payload.group_name = st.groupName;
      payload.group_url = st.groupUrl;
    } else {
      showToast('Elegí grupos (lista guardada) o escribí el nombre del grupo', 'error');
      return;
    }
    btn.disabled = true;
    try {
      const r = await onSave(payload);
      const count = Array.isArray(r) ? r.length : 1;
      showToast(`${count} ítem(s) agregado(s) a la cola`, 'success');
      st.groupIds.clear();
      st.groupName = ''; st.groupUrl = '';
      const gn = root.querySelector('#pubq-group-name'); if (gn) gn.value = '';
      const gu = root.querySelector('#pubq-group-url'); if (gu) gu.value = '';
      renderGroups();
    } catch (err) {
      showToast(err.message, 'error');
    }
    btn.disabled = false;
  });

  root.querySelector('#pubq-edit-cancel')?.addEventListener('click', () => closeModal(true));

  renderPubList();
  renderImages();
  renderGroups();
  renderVariants();
}

// --------------------------------------------------------------------------
// Edición de un ítem pendiente: reutiliza el formulario en un modal.
// --------------------------------------------------------------------------
async function openEditModal(item) {
  const [publications, groups] = await Promise.all([api.getPublications(), api.getGroups()]);
  openModal(`
    <div class="modal-header">
      <h2>Editar elemento de la cola</h2>
      <button class="modal-close" id="pubq-editmodal-close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div id="pubq-editmodal-body" style="max-height:74vh;overflow:auto"></div>
  `);
  document.getElementById('pubq-editmodal-close').addEventListener('click', () => closeModal(true));
  const body = document.getElementById('pubq-editmodal-body');
  renderQueueForm(body, { publications, groups }, item, async (payload) => {
    await api.updatePubQueue(item.id, { variant_text: payload.variant_text, images: payload.images });
    closeModal(true);
    if (currentTab === 'pending') renderPage(currentContainer);
  }, { mode: 'edit' });
}

async function renderHistory(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando historial...</div>';
  try {
    const items = await api.getPubQueue();
    const published = items.filter(i => i.status === 'published');
    const skipped = items.filter(i => i.status === 'skipped');

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px">
          <h3>Sin historial</h3>
          <p>Las publicaciones que marques como "Publicado" o "Omitir" aparecerán aquí</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:16px;font-size:.82rem;color:var(--text-muted)">
          <span><b style="color:var(--success)">${published.length}</b> publicada(s)</span>
          <span><b style="color:var(--text-muted)">${skipped.length}</b> omitida(s)</span>
        </div>

        ${published.map(item => `
          <div class="card" style="padding:12px;border-left:3px solid var(--success)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="font-weight:600;font-size:.85rem">${escHtml(item.group_name)}</span>
                <span style="font-size:.72rem;color:var(--text-muted);margin-left:8px">${item.product_name || ''}</span>
              </div>
              <span style="font-size:.72rem;color:var(--text-muted)">✓ ${formatDateTime(item.published_at)}</span>
            </div>
          </div>
        `).join('')}

        ${skipped.map(item => `
          <div class="card" style="padding:12px;border-left:3px solid var(--text-muted);opacity:.7">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="font-weight:600;font-size:.85rem">${escHtml(item.group_name)}</span>
                <span style="font-size:.72rem;color:var(--text-muted);margin-left:8px">${item.product_name || ''}</span>
              </div>
              <span style="font-size:.72rem;color:var(--text-muted)">⊘ omitida</span>
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function renderTimers(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando temporizadores...</div>';
  try {
    const data = await api.getPubQueueTimer();
    if (data.timers.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <h3>Sin temporizadores</h3>
          <p>Cuando publiques en un grupo, se creará un temporizador automático</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">
          Intervalo mínimo recomendado: 4 horas entre publicaciones al mismo grupo
        </div>
        ${data.timers.map(t => `
          <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:600;font-size:.9rem">${escHtml(t.group_name)}</div>
              <div style="font-size:.72rem;color:var(--text-muted)">Última publicación: ${formatDateTime(t.last_published)}</div>
            </div>
            <div style="text-align:right">
              ${t.can_publish
                ? '<span style="color:var(--success);font-weight:600;font-size:.85rem">✓ Listo para publicar</span>'
                : `<div style="font-size:1.1rem;font-weight:600;color:var(--rose)">${formatTimer(t.remaining_ms)}</div>
                   <div style="font-size:.68rem;color:var(--text-muted)">Disponible: ${formatDateTime(t.ready_at)}</div>`
              }
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function renderGroups(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando grupos...</div>';
  let groups = [];
  try {
    groups = await api.getGroups();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div style="padding:16px;max-width:720px">
      <div class="card" style="padding:16px;margin-bottom:12px">
        <h3 style="margin:0 0 12px;font-size:.95rem">Agregar grupo de Facebook</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="g-new-name" class="form-control" placeholder="Nombre del grupo" style="flex:1;min-width:180px" />
          <input type="text" id="g-new-url" class="form-control" placeholder="https://facebook.com/groups/..." style="flex:2;min-width:220px" />
          <button class="btn btn--primary" id="g-add-btn">Agregar</button>
        </div>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:6px">
          Facebook ya no permite publicar por API en grupos; esta lista alimenta el modal "Publicar en Facebook" para armar tu agenda.
        </small>
      </div>

      ${groups.length === 0
        ? '<div class="empty-state" style="padding:36px"><h3>Sin grupos</h3><p>Agregá los grupos donde publicás</p></div>'
        : `<div style="display:flex;flex-direction:column;gap:8px">
            ${groups.map(g => `
              <div class="card" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px" data-id="${g.id}">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:.88rem">${escHtml(g.name)}</div>
                  ${g.url ? `<a href="${escAttr(g.url)}" target="_blank" rel="noopener" style="font-size:.72rem;color:var(--text-muted)">${escHtml(g.url)}</a>` : '<span style="font-size:.72rem;color:var(--text-muted)">Sin URL</span>'}
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button class="btn btn--sm btn--ghost g-edit" data-id="${g.id}">Editar</button>
                  <button class="btn btn--sm btn--ghost g-remove" data-id="${g.id}" style="color:var(--error)">Eliminar</button>
                </div>
              </div>
            `).join('')}
          </div>`
      }
    </div>
  `;

  document.getElementById('g-add-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('g-new-name').value.trim();
    const url = document.getElementById('g-new-url').value.trim();
    if (!name) { showToast('Escribí el nombre del grupo', 'error'); return; }
    try {
      await api.createGroup({ name, url });
      showToast('Grupo agregado', 'success');
      renderGroups(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('.g-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este grupo? Las publicaciones ya agendadas no se tocan.');
      if (!ok) return;
      try {
        await api.deleteGroup(btn.dataset.id);
        showToast('Grupo eliminado', 'success');
        renderGroups(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.g-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      card.querySelector('div[style*="flex:1"]').style.display = 'none';
      card.querySelector('.g-edit').style.display = 'none';
      card.querySelector('.g-remove').style.display = 'none';
      card.innerHTML += `
        <div style="display:flex;gap:6px;flex:1;flex-wrap:wrap" id="g-edit-form">
          <input type="text" id="g-edit-name" class="form-control" value="${escAttr(groups.find(x => x.id === btn.dataset.id)?.name || '')}" placeholder="Nombre" />
          <input type="text" id="g-edit-url" class="form-control" value="${escAttr(groups.find(x => x.id === btn.dataset.id)?.url || '')}" placeholder="https://..." />
          <button class="btn btn--sm btn--primary" id="g-edit-save">Guardar</button>
          <button class="btn btn--sm btn--ghost" id="g-edit-cancel">Cancelar</button>
        </div>`;
      document.getElementById('g-edit-cancel').addEventListener('click', () => renderGroups(container));
      document.getElementById('g-edit-save').addEventListener('click', async () => {
        const name = document.getElementById('g-edit-name').value.trim();
        const url = document.getElementById('g-edit-url').value.trim();
        if (!name) { showToast('El nombre es obligatorio', 'error'); return; }
        try {
          await api.updateGroup(btn.dataset.id, { name, url });
          showToast('Grupo actualizado', 'success');
          renderGroups(container);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  });
}

function startTimerRefresh() {
  stopTimerRefresh();
  timerInterval = setInterval(() => {
    if (currentTab === 'pending' || currentTab === 'timers') {
      const content = document.getElementById('pubq-tab-content');
      if (content) {
        if (currentTab === 'pending') renderPending(content);
        else renderTimers(content);
      }
    }
  }, 30000);
}

function stopTimerRefresh() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

export function cleanup() {
  stopTimerRefresh();
}
