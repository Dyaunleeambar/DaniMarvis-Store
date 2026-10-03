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

  // Publications
  getPublications: () => request('GET', '/publications'),
  getPublication: (id) => request('GET', `/publications/${id}`),
  createPublication: (data) => request('POST', '/publications', data),
  updatePublication: (id, data) => request('PUT', `/publications/${id}`, data),
  deletePublication: (id) => request('DELETE', `/publications/${id}`),
  duplicatePublication: (id) => request('POST', `/publications/${id}/duplicate`),
  planificarPublication: (id, fecha, grupoId = '') =>
    request('POST', `/publications/${id}/planificar`, grupoId ? { fecha, grupo_id: grupoId } : { fecha }),
  getUsoDia: (fecha, exclude = '') => request('GET', `/agenda/uso-dia?fecha=${encodeURIComponent(fecha)}&exclude=${encodeURIComponent(exclude)}`),
  getRotacionGrupos: (fecha, n) => request('GET', `/agenda/rotacion-grupos?fecha=${encodeURIComponent(fecha)}&n=${encodeURIComponent(n)}`),
  discardAgendaDestino: (pubId, destId) => request('PATCH', `/agenda/${pubId}/destinos/${destId}`, {}),
  reorderPublications: (order) => request('PATCH', '/publications/reorder', { order }),
  publishPublication: (id, platform = 'facebook', scheduledAt = null) => request('POST', `/publications/${id}/publish`, { platform, scheduled_at: scheduledAt }),

  // Agenda (calendario). Reemplaza a la "Cola de Publicaciones" como pantalla:
  // publication_queue sigue siendo el registro interno de destinos, lo que se
  // devuelve acá es el evento con sus N destinos y el estado ya agregado.
  getAgenda: (from, to) => request('GET', `/agenda${from && to ? `?from=${from}&to=${to}` : ''}`),
  getAgendaConflicts: (at, groups, windowH = 2, exclude = '') =>
    request('GET', `/agenda/conflicts?at=${encodeURIComponent(at)}&groups=${encodeURIComponent(groups.join(','))}&window_h=${windowH}&exclude=${exclude}`),
  runAgendaEvent: (id) => request('POST', `/agenda/${id}/run`),
  rescheduleAgendaEvent: (id, data) => request('PATCH', `/agenda/${id}`, data),
  retryAgendaEvent: (id) => request('POST', `/agenda/${id}/retry`),

  // Duplicar todas las publicaciones de un día en otro. El día de origen queda
  // intacto: la copia es una publicación nueva con sus destinos en 'pending'.
  // El GET es la vista previa: el backend calcula el plan con la misma función
  // que después aplica, así que lo que se muestra antes de confirmar no puede
  // diferir de lo que pasa.
  //
  // `horaInicio` corre el día como bloque desde esa hora ("HH:MM"): la primera
  // publicación cae ahí y las demás conservan su intervalo. Sin valor, cada una
  // conserva su propia hora.
  previewDuplicateAgendaDay: (desde, hasta, horaInicio) =>
    request('GET', `/agenda/duplicar-dia?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}` +
      (horaInicio ? `&hora_inicio=${encodeURIComponent(horaInicio)}` : '')),
  duplicateAgendaDay: (desde, hasta, ids, horaInicio) =>
    request('POST', '/agenda/duplicar-dia',
      { desde, hasta, ...(ids ? { ids } : {}), ...(horaInicio ? { hora_inicio: horaInicio } : {}) }),
  undoDuplicateAgendaDay: (clones) => request('POST', '/agenda/duplicar-dia/deshacer', { clones }),

  // AI
  generateDescription: (data) => request('POST', '/generate-description', data),
  generateImage: (data) => request('POST', '/generate-image', data),

  // Catalog
  generateCatalog: () => request('POST', '/generate-catalog'),
  toggleVisibility: (id) => request('PATCH', `/products/${id}/visibility`),

  // Exports
  getExports: () => request('GET', '/exports'),
  getExport: (id) => request('GET', `/exports/${id}`),
  createExport: (data) => request('POST', '/exports', data),
  deleteExport: (id) => request('DELETE', `/exports/${id}`),

  // Importación de imágenes generadas con IA
  importImages: (data) => request('POST', '/images/import', data),

  // Sincronización desde imágenes (proveedor)
  importAnalyze: (data) => request('POST', '/import/analyze', data),
  importApply: (data) => request('POST', '/import/apply', data),

  // Destinos de una publicación. La cola dejó de ser una pantalla: es el
  // registro interno que el Planificador escribe (fan-out a N grupos) y que la
  // agenda lee para saber el estado de cada destino. Solo queda el alta; el
  // resto de la gestión se hace por /agenda, que trabaja por publicación.
  addToPubQueue: (data) => request('POST', '/pub-queue', data),

  // Auto-publicado en grupos (worker con Chrome)
  getGroupPublishStatus: () => request('GET', '/group-publish/status'),
  runGroupPublish: (data) => request('POST', '/group-publish/run', data || {}),
  runGroupPublishOne: (id, data) => request('POST', `/group-publish/run/${id}`, data || {}),

  // Facebook Groups
  getGroups: () => request('GET', '/groups'),
  createGroup: (data) => request('POST', '/groups', data),
  updateGroup: (id, data) => request('PUT', `/groups/${id}`, data),
  deleteGroup: (id) => request('DELETE', `/groups/${id}`),

  // Rankings
  getRankings: () => request('GET', '/rankings'),
  refreshRankings: (data) => request('POST', '/rankings/refresh', data || {}),
  getDailyRanking: () => request('GET', '/rankings/daily'),
  getRankingHistory: () => request('GET', '/rankings/history'),
  getRankingHistoryDate: (date) => request('GET', `/rankings/history/${date}`),
  getRankingHistoryGroup: (name) => request('GET', `/rankings/history/group/${encodeURIComponent(name)}`),
  deleteRankingHistory: (date) => request('DELETE', `/rankings/history/${date}`),
  getRankingWeekly: () => request('GET', '/rankings/weekly'),
  getRankingWeeklyDetail: (inicio) => request('GET', `/rankings/weekly/${inicio}`),
  getRankingWeeklyGroup: (name) => request('GET', `/rankings/weekly/group/${encodeURIComponent(name)}`),

  // Prompt Engine
  getPromptFamilies: () => request('GET', '/prompt-engine/families'),
  getPromptFormats: () => request('GET', '/prompt-engine/formats'),
  generatePrompt: (data) => request('POST', '/prompt-engine/generate', data),

  // Provider Styles
  getProviderStyles: () => request('GET', '/provider-styles'),
  getProviderStyle: (code) => request('GET', `/provider-styles/${code}`),
  createProviderStyle: (data) => request('POST', '/provider-styles', data),
  updateProviderStyle: (code, data) => request('PUT', `/provider-styles/${code}`, data),
  deleteProviderStyle: (code) => request('DELETE', `/provider-styles/${code}`),

  // Warranty Rules
  getWarrantyRules: (providerId) => request('GET', `/warranty-rules${providerId ? '?provider_id=' + providerId : ''}`),
  createWarrantyRule: (data) => request('POST', '/warranty-rules', data),
  bulkWarrantyRules: (data) => request('POST', '/warranty-rules/bulk', data),
  matchWarranty: (data) => request('POST', '/warranty-rules/match', data),
  deleteWarrantyRule: (id) => request('DELETE', `/warranty-rules/${id}`),

  // Page Routines
  getPageRoutines: () => request('GET', '/page-routines'),
  createPageRoutine: (data) => request('POST', '/page-routines', data),
  updatePageRoutine: (id, data) => request('PUT', `/page-routines/${id}`, data),
  deletePageRoutine: (id) => request('DELETE', `/page-routines/${id}`),
  setPageRoutineActive: (id, active) => request('PATCH', `/page-routines/${id}/active`, { active }),
  getPageRoutineLogs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/page-routines/logs${qs ? '?' + qs : ''}`);
  },
  testPageRoutine: (routineId) => request('GET', `/page-routines/test${routineId ? '?routine_id=' + routineId : ''}`),
  runPageRoutineNow: () => request('POST', '/page-routines/run-now'),
  cancelPageRoutineLog: (logId) => request('DELETE', `/page-routines/logs/${logId}`),

  // Auth
  login: (username, password) => request('POST', '/login', { username, password }),
};
