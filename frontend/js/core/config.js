const BACKEND_PORT = 3456;
export const API_BASE = window.location.port === String(BACKEND_PORT)
  ? '/api'
  : `http://localhost:${BACKEND_PORT}/api`;

export const ROUTE_TITLES = {
  '#/dashboard': 'Dashboard',
  '#/products': 'Productos',
  '#/providers': 'Proveedores',
  '#/sales': 'Ventas',
  '#/catalog-images': 'Catálogo de imágenes',
  '#/settings': 'Configuración',
};
