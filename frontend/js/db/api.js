import { API_BASE } from '../core/config.js';

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = sessionStorage.getItem('dm_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    sessionStorage.removeItem('dm_user');
    sessionStorage.removeItem('dm_token');
    window.location.hash = '#/login';
    throw new Error('Sesión expirada');
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(res.ok ? 'Respuesta inválida del servidor' : `Error del servidor (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

export const api = {
  // Products
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/products${qs ? '?' + qs : ''}`);
  },
  getProduct: (id) => request('GET', `/products/${id}`),
  createProduct: (data) => request('POST', '/products', data),
  updateProduct: (id, data) => request('PUT', `/products/${id}`, data),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),

  // Providers
  getProviders: () => request('GET', '/providers'),
  getProvider: (id) => request('GET', `/providers/${id}`),
  createProvider: (data) => request('POST', '/providers', data),
  updateProvider: (id, data) => request('PUT', `/providers/${id}`, data),
  deleteProvider: (id) => request('DELETE', `/providers/${id}`),

  // Sales
  getSales: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/sales${qs ? '?' + qs : ''}`);
  },
  getSale: (id) => request('GET', `/sales/${id}`),
  createSale: (data) => request('POST', '/sales', data),
  updateSale: (id, data) => request('PUT', `/sales/${id}`, data),
  updateSaleStatus: (id, data) => request('PATCH', `/sales/${id}/status`, data),
  deleteSale: (id) => request('DELETE', `/sales/${id}`),

  // Dashboard
  getDashboard: () => request('GET', '/dashboard'),
  getCounts: () => request('GET', '/counts'),

  // Categories
  getCategories: () => request('GET', '/categories'),
  createCategory: (data) => request('POST', '/categories', data),
  updateCategory: (id, data) => request('PUT', `/categories/${id}`, data),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  // Backup
  exportBackup: () => request('GET', '/backup'),
  restoreBackup: (data) => request('POST', '/backup/restore', data),

  // Settings
  getSettings: () => request('GET', '/settings'),
  updateSettings: (data) => request('PUT', '/settings', data),

  // Upload
  uploadImage: async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    const token = sessionStorage.getItem('dm_token');
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });
    if (res.status === 401) {
      sessionStorage.removeItem('dm_user');
      sessionStorage.removeItem('dm_token');
      window.location.hash = '#/login';
      throw new Error('Sesión expirada');
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Error al subir imagen'); }
    if (!res.ok) throw new Error(data.error || 'Error al subir imagen');
    return data;
  },

  // Auth
  login: (username, password) => request('POST', '/login', { username, password }),
};
