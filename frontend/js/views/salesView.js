import { api } from '../db/api.js';
import { openModal, closeModal, showToast, confirmDialog, refreshSidebarCounts } from '../core/app.js';
import { formatUSD, formatMN, formatCommission, formatDate, generateId } from '../utils/utils.js';
import { generateSalesPDF } from '../utils/salesPdfGenerator.js';

let currentContainer = null;
let currentSales = [];
let currentProducts = [];
let currentProviders = [];

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando ventas...</div>';

  try {
    const [sales, products, providers] = await Promise.all([
      api.getSales(),
      api.getProducts({ status: 'active' }),
      api.getProviders(),
    ]);
    currentSales = sales;
    currentProducts = products;
    currentProviders = providers;
    renderTable(container, sales);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, sales) {
  const totalRevenue = sales.reduce((s, v) => s + v.total_amount, 0);
  const pendingCommissions = sales.filter(v => !v.commission_paid).reduce((s, v) => s + v.commission_amount, 0);
  const pendingCommissionsUSD = sales.filter(v => !v.commission_paid && (v.commission_currency || 'USD') === 'USD').reduce((s, v) => s + v.commission_amount, 0);
  const pendingCommissionsMN = sales.filter(v => !v.commission_paid && (v.commission_currency || 'USD') === 'MN').reduce((s, v) => s + v.commission_amount, 0);
  const exchangeRate = sales.length > 0 ? sales[0].exchange_rate : 61000;

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Ventas</h1>
          <p>${sales.length} venta(s) · Total: ${formatUSD(totalRevenue)} · Comisiones pendientes: ${pendingCommissionsUSD > 0 ? formatUSD(pendingCommissionsUSD) : ''}${pendingCommissionsUSD > 0 && pendingCommissionsMN > 0 ? ' + ' : ''}${pendingCommissionsMN > 0 ? formatCommission(pendingCommissionsMN, 'MN') : ''}${pendingCommissions === 0 ? '$0.00' : ''}</p>
        </div>
        <div class="page-header-left" style="display:flex;align-items:center;gap:10px">
          <button class="btn btn--primary" onclick="window._openSaleForm(null)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva venta
          </button>
          <button class="btn btn--secondary" onclick="window._exportSalesPDF()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar PDF
          </button>
        </div>
      </div>

      <!-- Mini stats -->
      <div class="grid-3" style="margin-bottom:20px">
        <div class="card card--stat">
          <div class="stat-icon stat-icon--green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div>
            <div class="stat-value">${formatUSD(totalRevenue)}</div>
            <div class="stat-label">Ingresos totales</div>
            <div style="font-size:.72rem;color:var(--text-muted)">${formatMN(totalRevenue, exchangeRate)}</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--amber">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <div class="stat-value">${pendingCommissionsUSD > 0 ? formatUSD(pendingCommissionsUSD) : ''}${pendingCommissionsUSD > 0 && pendingCommissionsMN > 0 ? ' + ' : ''}${pendingCommissionsMN > 0 ? formatCommission(pendingCommissionsMN, 'MN') : ''}${pendingCommissions === 0 ? '$0.00' : ''}</div>
            <div class="stat-label">Comisiones pendientes</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div class="stat-value">${sales.filter(v => v.delivery_status === 'delivered').length}/${sales.length}</div>
            <div class="stat-label">Entregados / Total</div>
          </div>
        </div>
      </div>

      <div class="filter-bar">
        <select id="filter-status" class="form-control form-control--small">
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="shipped">Enviado</option>
          <option value="delivered">Entregado</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <select id="filter-provider" class="form-control form-control--small">
          <option value="">Todos los proveedores</option>
          ${currentProviders.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <input type="date" id="filter-start" class="form-control form-control--small" style="min-width:140px" />
        <span style="color:var(--text-muted)">a</span>
        <input type="date" id="filter-end" class="form-control form-control--small" style="min-width:140px" />
      </div>

      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Comisión</th>
                <th>Pagada</th>
                <th>Entrega</th>
                <th>Fecha</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody>
              ${sales.length === 0
                ? `<tr><td colspan="8"><div class="empty-state" style="padding:32px"><h3>No hay ventas</h3><p>Registra tu primera venta</p></div></td></tr>`
                : sales.map(s => `
                  <tr>
                    <td><span style="font-weight:500;font-size:.85rem">${s.product_name || '—'}</span></td>
                    <td>
                      <div style="font-size:.85rem">${s.client_name || '—'}</div>
                      ${s.client_phone ? `<div style="font-size:.75rem;color:var(--text-muted)">${s.client_phone}</div>` : ''}
                    </td>
                    <td class="amount">${formatUSD(s.total_amount)}<br><span style="font-size:.7rem;color:var(--text-muted)">${formatMN(s.total_amount, s.exchange_rate || exchangeRate)}</span></td>
                    <td class="amount">${formatCommission(s.commission_amount, s.commission_currency || 'USD')}</td>
                    <td><span class="badge badge--${s.commission_paid ? 'paid' : 'unpaid'}">${s.commission_paid ? 'Pagada' : 'Pendiente'}</span></td>
                    <td><span class="badge badge--${s.delivery_status === 'delivered' ? 'delivered' : s.delivery_status === 'shipped' ? 'shipped' : 'pending'}">${s.delivery_status || 'pending'}</span></td>
                    <td style="font-size:.82rem;color:var(--text-secondary);white-space:nowrap">${formatDate(s.sale_date)}</td>
                    <td>
                      <div class="actions-cell">
                        <button class="btn btn--sm btn--ghost" onclick="window._editSale('${s.id}')" title="Editar">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn btn--sm btn--ghost" onclick="window._deleteSale('${s.id}')" title="Eliminar" style="color:var(--error)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Filters
  const statusFilter = document.getElementById('filter-status');
  const providerFilter = document.getElementById('filter-provider');
  const startFilter = document.getElementById('filter-start');
  const endFilter = document.getElementById('filter-end');

  function applyFilters() {
    const params = {};
    if (statusFilter.value) params.delivery_status = statusFilter.value;
    if (providerFilter.value) params.provider_id = providerFilter.value;
    if (startFilter.value) params.start_date = startFilter.value;
    if (endFilter.value) params.end_date = endFilter.value;

    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Filtrando...</div>';
    api.getSales(params).then(filtered => {
      currentSales = filtered;
      renderTable(container, filtered);
    }).catch(() => {});
  }

  statusFilter.addEventListener('change', applyFilters);
  providerFilter.addEventListener('change', applyFilters);
  startFilter.addEventListener('change', applyFilters);
  endFilter.addEventListener('change', applyFilters);
}

// ── Global handlers ───────────────────────────────────────────
window._openSaleForm = function(sale) {
  openModal(`
    <div class="modal-header">
      <h2>${sale ? 'Editar venta' : 'Nueva venta'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="sale-form">
      <input type="hidden" name="id" value="${sale?.id || ''}" />
      <div class="form-row">
        <div class="form-group">
          <label>Producto *</label>
          <select name="product_id" class="form-control" id="sale-product" required>
            <option value="">Seleccionar producto</option>
            ${currentProducts.map(p =>
              `<option value="${p.id}" data-price="${p.price}" data-commission="${p.commission_value}" data-currency="${p.commission_currency || 'USD'}" data-provider="${p.provider_id || ''}" ${sale?.product_id === p.id ? 'selected' : ''}>${p.name} — ${formatUSD(p.price)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Proveedor</label>
          <select name="provider_id" class="form-control" id="sale-provider">
            <option value="">Automático</option>
            ${currentProviders.map(p =>
              `<option value="${p.id}" ${sale?.provider_id === p.id ? 'selected' : ''}>${p.name}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Cliente</label>
          <input type="text" name="client_name" class="form-control" value="${sale?.client_name || ''}" />
        </div>
        <div class="form-group">
          <label>Teléfono</label>
          <input type="text" name="client_phone" class="form-control" value="${sale?.client_phone || ''}" />
        </div>
      </div>
      <div class="form-group">
        <label>Dirección de envío</label>
        <input type="text" name="client_address" class="form-control" value="${sale?.client_address || ''}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Cantidad</label>
          <input type="number" name="quantity" class="form-control" id="sale-qty" value="${sale?.quantity || 1}" min="1" />
        </div>
        <div class="form-group">
          <label>Precio unitario (USD)</label>
          <input type="number" name="unit_price" class="form-control" id="sale-price" value="${sale?.unit_price || ''}" step="any" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Total (USD)</label>
          <input type="number" name="total_amount" class="form-control" id="sale-total" value="${sale?.total_amount || ''}" step="any" readonly style="background:var(--bg)" />
        </div>
        <div class="form-group">
          <label>Comisión (USD)</label>
          <input type="number" name="commission_amount" class="form-control" id="sale-commission" value="${sale?.commission_amount || 0}" step="any" readonly style="background:var(--bg)" />
          <small id="commission-source" style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">—</small>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Método de envío</label>
          <input type="text" name="delivery_method" class="form-control" value="${sale?.delivery_method || ''}" placeholder="Ej: Mensajería" />
        </div>
        <div class="form-group">
          <label>Estado de entrega</label>
          <select name="delivery_status" class="form-control">
            <option value="pending" ${sale?.delivery_status === 'pending' ? 'selected' : ''}>Pendiente</option>
            <option value="shipped" ${sale?.delivery_status === 'shipped' ? 'selected' : ''}>Enviado</option>
            <option value="delivered" ${sale?.delivery_status === 'delivered' ? 'selected' : ''}>Entregado</option>
            <option value="cancelled" ${sale?.delivery_status === 'cancelled' ? 'selected' : ''}>Cancelado</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Fecha de venta</label>
          <input type="datetime-local" name="sale_date" class="form-control" value="${sale?.sale_date ? sale.sale_date.slice(0,16) : new Date().toISOString().slice(0,16)}" />
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:6px;padding-top:20px">
            <input type="checkbox" name="commission_paid" value="1" ${sale?.commission_paid ? 'checked' : ''} />
            Comisión pagada
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Notas</label>
        <textarea name="notes" class="form-control">${sale?.notes || ''}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${sale ? 'Guardar cambios' : 'Registrar venta'}</button>
      </div>
    </form>
  `);

  // Auto-calculate total and commission
  const productSelect = document.getElementById('sale-product');
  const providerSelect = document.getElementById('sale-provider');
  const qtyInput = document.getElementById('sale-qty');
  const priceInput = document.getElementById('sale-price');
  const totalInput = document.getElementById('sale-total');
  const commissionInput = document.getElementById('sale-commission');

  function calcTotals() {
    const qty = parseInt(qtyInput.value) || 1;
    const price = parseFloat(priceInput.value) || 0;
    totalInput.value = Math.round(qty * price * 100) / 100;

    const selected = productSelect.options[productSelect.selectedIndex];
    if (selected && selected.value) {
      const commVal = parseFloat(selected.dataset.commission) || 0;
      const commCurrency = selected.dataset.currency || 'USD';
      const commission = commVal * qty;
      commissionInput.value = Math.round(commission * 100) / 100;

      const label = document.getElementById('commission-source');
      if (label) label.textContent = commVal > 0
        ? `${formatCommission(commVal, commCurrency)} fijo por unidad`
        : 'Sin comisión';

      if (selected.dataset.provider && !sale) {
        providerSelect.value = selected.dataset.provider;
      }
    }
  }

  productSelect.addEventListener('change', () => {
    const selected = productSelect.options[productSelect.selectedIndex];
    if (selected && selected.value) {
      priceInput.value = selected.dataset.price;
    }
    calcTotals();
  });

  qtyInput.addEventListener('input', calcTotals);
  priceInput.addEventListener('input', calcTotals);
  if (sale) calcTotals();

  document.getElementById('sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    data.quantity = parseInt(data.quantity) || 1;
    data.unit_price = parseFloat(data.unit_price) || 0;
    data.total_amount = parseFloat(data.total_amount) || 0;
    data.commission_amount = parseFloat(data.commission_amount) || 0;
    data.commission_paid = data.commission_paid ? 1 : 0;

    try {
      if (sale) {
        await api.updateSale(sale.id, data);
        showToast('Venta actualizada', 'success');
      } else {
        await api.createSale(data);
        showToast('Venta registrada', 'success');
      }
      closeModal();
      refreshSidebarCounts();
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window._exportSalesPDF = async function() {
  let allSales;
  try {
    allSales = await api.getSales();
  } catch (err) {
    showToast('Error al cargar ventas', 'error');
    return;
  }
  if (allSales.length === 0) {
    showToast('No hay ventas para exportar', 'error');
    return;
  }

  const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });

  openModal(`
    <div class="modal-header">
      <h2>Exportar ventas a PDF</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="sales-pdf-form">
      <div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:12px">
        Se exportarán las <strong id="sales-pdf-count">—</strong> venta(s).
      </div>
      <div class="form-group">
        <label>Título</label>
        <input type="text" name="title" class="form-control" value="Ventas — ${today}" />
      </div>
      <div class="form-group">
        <label>Proveedor</label>
        <select name="provider_id" class="form-control" id="sales-pdf-provider">
          <option value="">Todos los proveedores</option>
          ${currentProviders.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Fecha desde</label>
          <input type="date" name="start_date" class="form-control" id="sales-pdf-start" />
        </div>
        <div class="form-group">
          <label>Fecha hasta</label>
          <input type="date" name="end_date" class="form-control" id="sales-pdf-end" />
        </div>
      </div>
      <div class="form-group">
        <label>Ventas a incluir</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;margin-bottom:6px">
          <input type="checkbox" id="sales-pdf-all" checked />
          Exportar todas las ventas que coinciden (desmarcar para elegirlas manualmente)
        </label>
        <select id="sales-pdf-select" multiple size="7" style="width:100%" disabled><option>Seleccioná un proveedor y/o fechas para ver las ventas</option></select>
        <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">La lista se actualiza con el proveedor, el rango de fechas y la exclusión de canceladas.</small>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" name="exclude_cancelled" value="1" checked />
          Excluir ventas canceladas
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" name="include_summary" value="1" checked />
          Incluir resumen de totales
        </label>
      </div>
      <div class="form-group">
        <label>Pie de página (opcional)</label>
        <textarea name="footer" class="form-control" rows="2" placeholder="Ej: Gracias por confiar en DaniMarvis Store"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">Generar PDF</button>
      </div>
    </form>
  `);

  const countEl = document.getElementById('sales-pdf-count');
  const providerEl = document.getElementById('sales-pdf-provider');
  const startEl = document.getElementById('sales-pdf-start');
  const endEl = document.getElementById('sales-pdf-end');
  const excludeEl = document.querySelector('input[name="exclude_cancelled"]');
  const allEl = document.getElementById('sales-pdf-all');
  const salesSelect = document.getElementById('sales-pdf-select');
  const selectedIds = new Set();

  function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildFiltered() {
    const provider = providerEl.value;
    const start = startEl.value;
    const end = endEl.value;
    const exclude = excludeEl.checked;
    return allSales.filter(s => {
      if (provider && s.provider_id !== provider) return false;
      const day = (s.sale_date || '').slice(0, 10);
      if (start && day < start) return false;
      if (end && day > end) return false;
      if (exclude && s.delivery_status === 'cancelled') return false;
      return true;
    });
  }

  function updateSalesList() {
    const matching = buildFiltered();
    for (const id of selectedIds) {
      if (!matching.some(s => s.id === id)) selectedIds.delete(id);
    }
    salesSelect.innerHTML = matching.map(s => `
      <option value="${escHtml(s.id)}" ${selectedIds.has(s.id) ? 'selected' : ''}>
        ${escHtml(s.product_name || '—')} · ${escHtml(s.client_name || '—')} · ${escHtml((s.sale_date || '').slice(0, 10))} · ${escHtml(formatUSD(s.total_amount || 0))}
      </option>
    `).join('') || '<option>Sin ventas con estos filtros</option>';
  }

  function updateCount() {
    const matching = buildFiltered();
    const count = allEl.checked || selectedIds.size === 0 ? matching.length : selectedIds.size;
    countEl.textContent = `${count}`;
  }

  allEl.addEventListener('change', () => {
    salesSelect.disabled = allEl.checked;
    updateCount();
  });

  salesSelect.addEventListener('change', () => {
    selectedIds.clear();
    for (const opt of salesSelect.selectedOptions) selectedIds.add(opt.value);
    updateCount();
  });

  providerEl.addEventListener('change', updateSalesList);
  startEl.addEventListener('change', updateSalesList);
  endEl.addEventListener('change', updateSalesList);
  excludeEl.addEventListener('change', updateSalesList);
  updateSalesList();
  updateCount();

  document.getElementById('sales-pdf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const matching = buildFiltered();
    const filtered = allEl.checked || selectedIds.size === 0
      ? matching
      : matching.filter(s => selectedIds.has(s.id));
    if (filtered.length === 0) {
      showToast('No hay ventas para exportar', 'error');
      return;
    }
    try {
      await generateSalesPDF(filtered, {
        title: data.title || 'Reporte de ventas',
        excludeCancelled: data.exclude_cancelled === '1',
        includeSummary: data.include_summary === '1',
        footer: data.footer || '',
      });
      closeModal();
      showToast('PDF generado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window._editSale = async function(id) {
  try {
    const sale = await api.getSale(id);
    window._openSaleForm(sale);
  } catch (err) {
    showToast('Error al cargar venta', 'error');
  }
};

window._deleteSale = async function(id) {
  const ok = await confirmDialog('¿Eliminar esta venta? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await api.deleteSale(id);
    showToast('Venta eliminada', 'success');
    refreshSidebarCounts();
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};
