import { route, initRouter, navigate } from './router.js';
import { ROUTE_TITLES } from './config.js';
import { initDB } from '../db/indexeddb.js';
import { auth } from '../services/index.js';

import { render as renderDashboard } from '../views/dashboardView.js';
import { render as renderProducts } from '../views/productsView.js';
import { render as renderProviders } from '../views/providersView.js';
import { render as renderSales } from '../views/salesView.js';
import { render as renderCatalogImages } from '../views/catalogImagesView.js';

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

export function openModal(html) {
  modalContent.innerHTML = html;
  overlay.classList.remove('hidden');
}

export function closeModal() {
  overlay.classList.add('hidden');
  modalContent.innerHTML = '';
}

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

function updateSidebar() {
  const user = auth.getUser();
  document.getElementById('sidebar-user').textContent = user ? user.name : 'Invitado';
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

  route('#/dashboard', (_, c) => renderDashboard(c));
  route('#/', (_, c) => renderDashboard(c));
  route('#/products', (_, c) => renderProducts(c));
  route('#/providers', (_, c) => renderProviders(c));
  route('#/sales', (_, c) => renderSales(c));
  route('#/catalog-images', (_, c) => renderCatalogImages(c));

  window.addEventListener('routeChanged', (e) => {
    updateActiveLink(e.detail.hash);
    updatePageTitle(e.detail.path);
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
    showToast('Sesión finalizada');
  });

  updateSidebar();

  loading.classList.add('hidden');
  shell.classList.remove('hidden');
  initRouter(mainEl);
}

window.navigate = navigate;
window.showToast = showToast;
window.closeModal = closeModal;
window.openModal = openModal;
window.confirm = (msg) => window.confirm(msg);

bootstrap();
