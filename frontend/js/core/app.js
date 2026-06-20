import { route, initRouter, navigate } from './router.js';
import { ROUTE_TITLES } from './config.js';
import { initDB } from '../db/indexeddb.js';
import { auth } from '../services/index.js';
import { api } from '../db/api.js';

import { render as renderDashboard } from '../views/dashboardView.js';
import { render as renderProducts } from '../views/productsView.js';
import { render as renderProviders } from '../views/providersView.js';
import { render as renderSales } from '../views/salesView.js';
import { render as renderCatalogImages } from '../views/catalogImagesView.js';
import { render as renderSettings } from '../views/settingsView.js';
import { render as renderLogin } from '../views/loginView.js';

const toastEl = document.getElementById('toast');
let _toastTimer = null;

export function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast${type ? ` toast--${type}` : ''}`;
  toastEl.classList.remove('hidden');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 4000);
}

const overlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalConfirm = document.getElementById('modal-confirm');
const modalConfirmBox = document.getElementById('modal-confirm-box');
let modalCloseGuard = null;
let activeConfirmDismiss = null;

function hideConfirmDialog() {
  modalConfirm.classList.add('hidden');
  modalConfirmBox.innerHTML = '';
  activeConfirmDismiss = null;
}

export function setModalCloseGuard(guard) {
  modalCloseGuard = guard;
}

export function openModal(html) {
  modalCloseGuard = null;
  hideConfirmDialog();
  modalContent.innerHTML = html;
  overlay.classList.remove('hidden');
}

export async function closeModal(force = false) {
  if (!force && modalCloseGuard) {
    const allow = await modalCloseGuard();
    if (!allow) return;
  }
  modalCloseGuard = null;
  hideConfirmDialog();
  overlay.classList.add('hidden');
  modalContent.innerHTML = '';
}

export function confirmDialog(message, { title = 'Confirmar', confirmText = 'Eliminar', danger = true } = {}) {
  return new Promise((resolve) => {
    const stacked = !overlay.classList.contains('hidden') && modalContent.innerHTML.trim() !== '';
    const html = `
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" id="confirm-dialog-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p style="font-size:.9rem;color:var(--text-secondary);margin-bottom:4px">${message}</p>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" id="confirm-dialog-cancel">Cancelar</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" id="confirm-dialog-accept">${confirmText}</button>
      </div>
    `;

    const host = stacked ? modalConfirmBox : modalContent;
    host.innerHTML = html;
    overlay.classList.remove('hidden');
    if (stacked) modalConfirm.classList.remove('hidden');

    const finish = (result) => {
      hideConfirmDialog();
      if (!stacked) {
        overlay.classList.add('hidden');
        modalContent.innerHTML = '';
      }
      resolve(result);
    };

    activeConfirmDismiss = () => finish(false);

    document.getElementById('confirm-dialog-close').addEventListener('click', () => finish(false));
    document.getElementById('confirm-dialog-cancel').addEventListener('click', () => finish(false));
    document.getElementById('confirm-dialog-accept').addEventListener('click', () => finish(true));
  });
}

modalConfirm.addEventListener('click', (e) => {
  if (activeConfirmDismiss && e.target === modalConfirm) activeConfirmDismiss();
});

overlay.addEventListener('click', (e) => {
  if (activeConfirmDismiss) return;
  if (e.target === overlay) closeModal();
});

function updateSidebar() {
  const user = auth.getUser();
  document.getElementById('sidebar-user').textContent = user ? user.name : 'Invitado';
}

export async function refreshSidebarCounts() {
  if (!auth.isLoggedIn()) return;
  try {
    const counts = await api.getCounts();
    for (const [key, value] of Object.entries(counts)) {
      const el = document.querySelector(`[data-count="${key}"]`);
      if (el) el.textContent = value;
    }
  } catch (err) {
    console.warn('[Sidebar] No se pudieron cargar los contadores:', err.message);
  }
}

function updateActiveLink(hash) {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('sidebar-link--active');
    const href = link.getAttribute('href');
    if (href && hash.startsWith(href)) {
      link.classList.add('sidebar-link--active');
    }
  });
}

function updatePageTitle(hash) {
  const el = document.getElementById('page-title');
  el.textContent = ROUTE_TITLES[hash] || 'Panel';
}

async function bootstrap() {
  const loading = document.getElementById('loading-screen');
  const shell = document.getElementById('app-shell');
  const mainEl = document.getElementById('app-main');

  try { await initDB(); } catch (err) {
    console.warn('[App] IndexedDB:', err);
  }

  function protect(handler) {
    return (params, c) => {
      if (!auth.isLoggedIn()) {
        navigate('#/login');
        return;
      }
      document.getElementById('app-shell').classList.remove('hidden');
      return handler(params, c);
    };
  }

  route('#/login', () => {
    document.getElementById('app-shell').classList.add('hidden');
    const loginContainer = document.getElementById('login-container');
    renderLogin(loginContainer);
    return () => { loginContainer.innerHTML = ''; };
  });
  route('#/dashboard', protect((_, c) => renderDashboard(c)));
  route('#/', protect((_, c) => renderDashboard(c)));
  route('#/products', protect((_, c) => renderProducts(c)));
  route('#/providers', protect((_, c) => renderProviders(c)));
  route('#/sales', protect((_, c) => renderSales(c)));
  route('#/catalog-images', protect((_, c) => renderCatalogImages(c)));
  route('#/settings', protect((_, c) => renderSettings(c)));

  window.addEventListener('routeChanged', (e) => {
    updateActiveLink(e.detail.hash);
    updatePageTitle(e.detail.path);
    refreshSidebarCounts();
  });

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('sidebar--open');
  });

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('sidebar--open');
    });
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    auth.logout();
    navigate('#/login');
    showToast('Sesión finalizada');
  });

  window.addEventListener('authChanged', () => {
    updateSidebar();
    refreshSidebarCounts();
  });

  updateSidebar();
  if (auth.isLoggedIn()) refreshSidebarCounts();

  loading.classList.add('hidden');
  if (!auth.isLoggedIn()) {
    navigate('#/login');
    shell.classList.add('hidden');
  } else {
    shell.classList.remove('hidden');
  }
  initRouter(mainEl);
}

window.navigate = navigate;
window.showToast = showToast;
window.closeModal = closeModal;
window.openModal = openModal;
const _nativeConfirm = window.confirm.bind(window);
window.confirm = (msg) => _nativeConfirm(msg);

bootstrap();
