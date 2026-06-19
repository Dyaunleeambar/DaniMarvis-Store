import { api } from '../db/api.js';
import { formatUSD, formatMN, formatDate } from '../utils/utils.js';
import { showToast } from '../core/app.js';

export async function render(container) {
  container.innerHTML = '<div class="loading-screen" style="position:static;padding:40px"><div class="loading-spinner"></div></div>';

  try {
    const data = await api.getDashboard();
    renderDashboard(container, data);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error al cargar</h3><p>${err.message}</p></div>`;
    showToast('Error al cargar dashboard', 'error');
  }
}

function renderDashboard(container, data) {
  const { stats, monthlySales, topProducts, recentSales, exchange_rate } = data;
  const rate = exchange_rate || 61000;

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen general de tu negocio</p>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid-4" style="margin-bottom:24px">
        <div class="card card--stat">
          <div class="stat-icon stat-icon--rose">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div>
            <div class="stat-value">${stats.total_products}</div>
            <div class="stat-label">Productos activos</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <div>
            <div class="stat-value">${stats.total_providers}</div>
            <div class="stat-label">Proveedores</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <div class="stat-value">${formatUSD(stats.total_revenue)}</div>
            <div class="stat-label">Ingresos totales (USD)</div>
            <div style="font-size:.72rem;color:var(--text-muted)">${formatMN(stats.total_revenue, rate)}</div>
          </div>
        </div>
        <div class="card card--stat">
          <div class="stat-icon stat-icon--amber">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <div class="stat-value">${formatUSD(stats.pending_commissions)}</div>
            <div class="stat-label">Comisiones pendientes (USD)</div>
            <div style="font-size:.72rem;color:var(--text-muted)">${formatMN(stats.pending_commissions, rate)}</div>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Recent Sales -->
        <div class="card">
          <div class="card-header">
            <h3>Ventas recientes</h3>
            <a href="#/sales" class="btn btn--sm btn--ghost">Ver todas</a>
          </div>
          ${recentSales.length === 0
            ? '<div class="empty-state" style="padding:24px"><p>Aún no hay ventas registradas</p></div>'
            : `<div class="table-wrap">
                <table>
                  <thead><tr><th>Producto</th><th>Cliente</th><th>Total</th><th>Fecha</th></tr></thead>
                  <tbody>
                    ${recentSales.map(s => `
                      <tr>
                        <td>${s.product_name || '—'}</td>
                        <td>${s.client_name || '—'}</td>
                        <td class="amount">${formatUSD(s.total_amount)}</td>
                        <td>${formatDate(s.sale_date)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`
          }
        </div>

        <!-- Top Products -->
        <div class="card">
          <div class="card-header">
            <h3>Productos más vendidos</h3>
          </div>
          ${topProducts.length === 0
            ? '<div class="empty-state" style="padding:24px"><p>Aún no hay datos de ventas</p></div>'
            : `<div style="display:flex;flex-direction:column;gap:12px">
                ${topProducts.map((p, i) => {
                  const maxRevenue = Math.max(...topProducts.map(x => x.revenue));
                  const pct = maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0;
                  return `
                    <div>
                      <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:4px">
                        <span style="font-weight:500">${p.name}</span>
                        <span class="amount">${formatUSD(p.revenue)}</span>
                      </div>
                      <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:var(--rose);border-radius:3px;transition:width .5s"></div>
                      </div>
                      <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">${p.sold} unidad(es)</div>
                    </div>
                  `;
                }).join('')}
              </div>`
          }
        </div>
      </div>

      <!-- Monthly Sales Chart -->
      <div class="card" style="margin-top:24px">
        <div class="card-header">
          <h3>Ventas mensuales</h3>
        </div>
        ${monthlySales.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>Aún no hay datos</p></div>'
          : `<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:8px 0">
              ${monthlySales.slice().reverse().map(m => {
                const maxRev = Math.max(...monthlySales.map(x => x.revenue));
                const h = maxRev > 0 ? (m.revenue / maxRev) * 100 : 0;
                return `
                  <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                    <span style="font-size:.65rem;color:var(--text-muted);font-weight:500">${formatUSD(m.revenue)}</span>
                    <div style="width:100%;background:var(--bg);border-radius:4px 4px 0 0;height:${h}%;min-height:4px;background:linear-gradient(to top, var(--rose), var(--rose-light));border-radius:4px 4px 0 0;transition:height .5s"></div>
                    <span style="font-size:.65rem;color:var(--text-muted)">${m.month}</span>
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    </div>
  `;
}
