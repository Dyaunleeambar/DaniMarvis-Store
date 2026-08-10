import { api } from '../db/api.js';
import { showToast, openModal, closeModal, confirmDialog } from '../core/app.js';
import { formatDateTime, debounce } from '../utils/utils.js';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, &amp;').replace(/</g, &lt;').replace(/>/g, &gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, &amp;').replace(/"/g, &quot;').replace(/</g, &lt;');
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
      </div>
      <div id="pubq-tab-content"></div>
    </div>
  `;

  document.getElementById('tab-pending').addEventListener('click', () => { currentTab = 'pending'; renderPage(container); });
  document.getElementById('tab-add').addEventListener('click', () => { currentTab = 'add'; renderPage(container); });
  document.getElementById('tab-history').addEventListener('click', () => { currentTab = 'history'; renderPage(container); });
  document.getElementById('tab-timers').addEventListener('click', () => { currentTab = 'timers'; renderPage(container); });

  const content = document.getElementById('pubq-tab-content');

  switch (currentTab) {
    case 'pending': renderPending(content); break;
    case 'add': renderAddForm(content); break;
    case 'history': renderHistory(content); break;
    case 'timers': renderTimers(content); break;
  }
}

async function renderPending(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando cola...</div>';
  try {
    const [items, timerData] = await Promise.all([
      api.getPubQueue(),
      api.getPubQueueTimer()
    ]);

    const pending = items.filter(i => i.status === 'pending');
    const timerMap = {};
    for (const t of timerData.timers) {
      timerMap[t.group_name.toLowerCase()] = t;
    }

    if (pending.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <h3>Cola vacía</h3>
          <p>Agregá publicaciones desde la pestaña "Agregar a cola"</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        ${pending.map(item => {
          const timer = timerMap[item.group_name.toLowerCase()];
          const canPublish = !timer || timer.can_publish;
          const timerHtml = timer && !canPublish
            ? `<span style="font-size:.72rem;color:var(--text-muted)">⏰ ${formatTimer(timer.remaining_ms)}</span>`
            : `<span style="font-size:.72rem;color:var(--success)">✓ Listo</span>`;

          return `
            <div class="card" style="padding:16px" data-id="${item.id}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span style="font-weight:600;font-size:.9rem;color:var(--rose)">${escHtml(item.group_name)}</span>
                    ${timerHtml}
                    ${item.variant_index > 0 ? `<span style="font-size:.68rem;padding:2px 6px;border-radius:50px;background:var(--bg);color:var(--text-muted)">variante ${item.variant_index}</span>` : ''}
                  </div>
                  <div style="font-size:.82rem;color:var(--text-secondary);white-space:pre-wrap;max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--bg);margin-bottom:8px;cursor:pointer" class="pubq-copy-text" data-text="${escAttr(item.variant_text || item.publish_text || '')}">
                    ${escHtml((item.variant_text || item.publish_text || 'Sin texto').slice(0, 300))}${(item.variant_text || item.publish_text || '').length > 300 ? '...' : ''}
                  </div>
                  <div style="font-size:.72rem;color:var(--text-muted)">Clic en el texto para copiar</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
                  <button class="btn btn--sm btn--primary pubq-mark-published" data-id="${item.id}" ${!canPublish ? 'disabled style="opacity:.5"' : ''}>Publicado</button>
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
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Cargando publicaciones...</div>';
  try {
    const publications = await api.getPublications();
    renderAddFormContent(container, publications);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderAddFormContent(container, publications) {
  let selectedPubId = publications[0]?.id || '';
  let groupName = '';
  let groupUrl = '';
  let useVariants = false;

  function getSelectedPub() {
    return publications.find(p => p.id === selectedPubId);
  }

  function renderVariantPreview() {
    const el = document.getElementById('variant-preview');
    if (!el) return;
    const pub = getSelectedPub();
    if (!pub) { el.innerHTML = ''; return; }
    const variants = useVariants ? generateVariants(pub.publish_text) : [pub.publish_text];
    el.innerHTML = variants.map((v, i) => `
      <div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:var(--bg)">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px">Variante ${i + 1}</div>
        <div style="font-size:.82rem;white-space:pre-wrap">${escHtml(v)}</div>
      </div>
    `).join('');
  }

  container.innerHTML = `
    <div style="padding:16px;max-width:700px">
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 16px;font-size:1rem">Agregar publicación a la cola</h3>

        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Publicación</label>
            <select id="pubq-pub-select" class="form-control">
              ${publications.map(p => `<option value="${p.id}" ${p.id === selectedPubId ? 'selected' : ''}>${escHtml(p.product_name || 'Sin producto')} — ${(p.publish_text || '').slice(0, 50)}...</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">Nombre del grupo de Facebook</label>
            <input type="text" id="pubq-group-name" class="form-control" placeholder="Ej: Electrodomésticos Cuba" />
          </div>

          <div>
            <label style="font-size:.82rem;color:var(--text-secondary);display:block;margin-bottom:4px">URL del grupo (opcional)</label>
            <input type="text" id="pubq-group-url" class="form-control" placeholder="https://facebook.com/groups/..." />
          </div>

          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="pubq-use-variants" /> Generar variantes del texto
          </label>

          <div id="variant-preview"></div>

          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn--primary" id="pubq-add-btn">Agregar a la cola</button>
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px;margin-top:12px">
        <h3 style="margin:0 0 8px;font-size:.9rem">Agregar varios grupos a la vez</h3>
        <p style="margin:0 0 8px;font-size:.78rem;color:var(--text-secondary)">
          Pegá los nombres de los grupos, uno por línea. Se creará una entrada en la cola para cada uno.
        </p>
        <textarea id="pubq-batch-groups" class="form-control" rows="4" placeholder="Electrodomésticos Cuba&#10;Hogar y Electrodomésticos&#10;Ventas Cuba"></textarea>
        <button class="btn btn--secondary btn--sm" id="pubq-batch-btn" style="margin-top:8px">Agregar todos</button>
      </div>
    </div>
  `;

  document.getElementById('pubq-pub-select').addEventListener('change', (e) => {
    selectedPubId = e.target.value;
    renderVariantPreview();
  });

  document.getElementById('pubq-use-variants').addEventListener('change', (e) => {
    useVariants = e.target.checked;
    renderVariantPreview();
  });

  renderVariantPreview();

  document.getElementById('pubq-add-btn').addEventListener('click', async () => {
    const name = document.getElementById('pubq-group-name').value.trim();
    if (!name) { showToast('Escribí el nombre del grupo', 'error'); return; }
    try {
      await api.addToPubQueue({
        publication_id: selectedPubId,
        group_name: name,
        group_url: document.getElementById('pubq-group-url').value.trim(),
      });
      showToast(`"${name}" agregada a la cola`, 'success');
      document.getElementById('pubq-group-name').value = '';
      document.getElementById('pubq-group-url').value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('pubq-batch-btn').addEventListener('click', async () => {
    const text = document.getElementById('pubq-batch-groups').value.trim();
    if (!text) { showToast('Pegá al menos un nombre de grupo', 'error'); return; }
    const groups = text.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0;
    for (const name of groups) {
      try {
        await api.addToPubQueue({
          publication_id: selectedPubId,
          group_name: name,
        });
        added++;
      } catch {}
    }
    showToast(`${added} grupo(s) agregado(s) a la cola`, 'success');
    document.getElementById('pubq-batch-groups').value = '';
  });
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
