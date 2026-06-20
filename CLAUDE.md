# DaniMarvis Store — Contexto para Claude Code

## Descripción del proyecto
Panel de gestión para asesores de venta que trabajan con importadores de electrodomésticos. Permite gestionar productos, proveedores, ventas y generar imágenes promocionales 1080×1080px para Facebook/WhatsApp.

## Stack tecnológico
- **Backend:** Node.js + Express (ES Modules, `"type": "module"`)
- **Base de datos:** SQLite mediante sql.js (100% JS/WASM, sin módulos nativos)
- **Frontend:** Vanilla JS SPA (sin frameworks), HTML5, CSS3 nativo
- **Imágenes:** Canvas API del navegador (generación client-side)
- **Caché offline:** IndexedDB con TTL de 5 minutos

## Estructura real del proyecto
```
DaniMarvisStore/
├── backend/
│   ├── db/
│   │   └── database.js        # Inicialización sql.js + schema + Statement wrapper
│   ├── routes/
│   │   ├── products.js        # CRUD productos
│   │   ├── providers.js       # CRUD proveedores
│   │   └── sales.js           # CRUD ventas + PATCH status
│   ├── scripts/
│   │   └── generate-icon.js   # Genera ícono PNG con canvas (Node)
│   ├── server.js              # Entry point Express + rutas /api/dashboard, /api/settings, /api/login
│   └── package.json           # type: module, deps: express cors sql.js uuid canvas multer
├── frontend/
│   ├── css/
│   │   ├── main.css           # Variables CSS, reset, loading screen, login
│   │   ├── layout.css         # Sidebar, topbar, grid, responsive
│   │   └── components.css     # Cards, botones, formularios, tablas, badges, toast, modal
│   ├── js/
│   │   ├── core/
│   │   │   ├── app.js         # Bootstrap, rutas protegidas, toast, modal, confirmDialog
│   │   │   ├── router.js      # Hash router con params y cleanup
│   │   │   └── config.js      # API_BASE (auto-detecta puerto), ROUTE_TITLES
│   │   ├── db/
│   │   │   ├── api.js         # Fetch wrapper con Bearer token y manejo de errores
│   │   │   └── indexeddb.js   # initDB, dbGetAll, dbPutAll, dbClear, getCacheTime, setCacheTime
│   │   ├── services/
│   │   │   └── index.js       # auth (login/logout/getUser/isLoggedIn), loadCached, invalidateCache
│   │   ├── utils/
│   │   │   ├── utils.js       # formatUSD, formatMN, formatDate, formatDateTime, formatDateInput, nowISO, generateId, debounce
│   │   │   └── imageGenerator.js  # generateProductImage(product) → canvas
│   │   └── views/
│   │       ├── loginView.js
│   │       ├── dashboardView.js
│   │       ├── productsView.js
│   │       ├── providersView.js
│   │       ├── salesView.js
│   │       ├── catalogImagesView.js
│   │       └── settingsView.js
│   └── index.html             # Shell SPA: sidebar, topbar, modal, toast, login container
├── package.json               # Scripts raíz: start/dev → node backend/server.js
├── .gitignore                 # node_modules/, *.db, .env, dist*/
└── CLAUDE.md                  # Este archivo
```

## Rutas registradas

### Backend (`server.js` + routers)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/login` | Autenticación, devuelve token base64 |
| GET | `/api/dashboard` | Stats, ventas mensuales, top productos, tipo de cambio |
| GET/PUT | `/api/settings` | Tipo de cambio USD → MN |
| GET/POST | `/api/products` | Listar (filtros: category, status, provider_id, q) / Crear |
| GET/PUT/DELETE | `/api/products/:id` | Obtener / Actualizar / Eliminar o archivar |
| GET/POST | `/api/providers` | Listar / Crear |
| GET/PUT/DELETE | `/api/providers/:id` | Obtener / Actualizar / Eliminar |
| GET/POST | `/api/sales` | Listar (filtros: delivery_status, provider_id, start_date, end_date) / Crear |
| GET/PUT/DELETE | `/api/sales/:id` | Obtener / Actualizar / Eliminar |
| PATCH | `/api/sales/:id/status` | Actualizar delivery_status y/o commission_paid |

### Frontend (hash router)
| Hash | Vista | Archivo |
|------|-------|---------|
| `#/login` | Login | loginView.js |
| `#/dashboard` | Dashboard | dashboardView.js |
| `#/` | Redirige a dashboard | — |
| `#/products` | Productos | productsView.js |
| `#/providers` | Proveedores | providersView.js |
| `#/sales` | Ventas | salesView.js |
| `#/catalog-images` | Catálogo de imágenes | catalogImagesView.js |
| `#/settings` | Configuración | settingsView.js |

## Esquema de base de datos

```sql
providers (id TEXT PK, name, contact, phone, email, commission_rate REAL, notes, created_at, updated_at)

products (id TEXT PK, name, description, category, price REAL, commission_type TEXT,
          commission_value REAL, warranty, provider_id FK, image_url, stock INTEGER,
          status TEXT DEFAULT 'active', created_at, updated_at)

sales (id TEXT PK, product_id FK, provider_id FK, client_name, client_phone,
       client_address, quantity INTEGER, unit_price REAL, total_amount REAL,
       commission_amount REAL, commission_paid INTEGER DEFAULT 0,
       exchange_rate REAL, delivery_method, delivery_status TEXT DEFAULT 'pending',
       notes, sale_date, created_at, updated_at)

users (id TEXT PK, username UNIQUE, name, password TEXT, role TEXT, created_at)

settings (id INTEGER PK CHECK(id=1), exchange_rate REAL DEFAULT 61000, updated_at)
```

## Convenciones de código

### Backend
- ES Modules siempre (`import`/`export`, nunca `require`)
- Las rutas Express reciben solo `(req, res)`, sin `next`
- `getDB()` es síncrono; `initDB()` debe llamarse al arrancar antes de cualquier query
- Patrón de queries: `db.prepare(sql).all(...params)`, `.get(...params)`, `.run(...params)`
- Los IDs de proveedores y ventas se generan en el backend con `uuid`
- Los IDs de productos se generan en el **frontend** con `generateId()` (`crypto.randomUUID`) y se envían al servidor — mantener esta inconsistencia hasta refactorizar
- La comisión es **siempre fija en USD** por unidad: `commission_amount = commission_value × quantity`. No hay comisiones por porcentaje ni herencia del proveedor
- El backend **recalcula** `total_amount` y `commission_amount` al crear/editar ventas, ignorando los valores enviados por el cliente
- `exchange_rate` se copia automáticamente desde `settings` al crear cada venta (referencia histórica inmutable)
- No agregar comentarios en archivos .js

### Frontend
- SPA con hash routing; las vistas renderizan con `innerHTML` en el contenedor recibido
- Los eventos se asignan con `querySelector` + `addEventListener` después del render
- Nunca interpolar datos del servidor directamente en HTML sin escapar (riesgo XSS); pendiente implementar `escHtml()` y `escAttr()`
- API calls siempre mediante `api.xxx()` desde `db/api.js`
- Para acciones destructivas usar `confirmDialog()` de `core/app.js`, nunca `window.confirm()`
- Para notificaciones usar `showToast(msg, type)` de `core/app.js` (types: `'success'`, `'error'`, `'warning'`)
- Para formularios en modales usar `openModal(html)` / `closeModal()` de `core/app.js`
- Para protección de formularios con cambios sin guardar usar `setModalCloseGuard(fn)` de `core/app.js`
- Tras operaciones CRUD sobre productos llamar `invalidateCache('products')` antes de refrescar la vista
- No usar librerías externas, solo vanilla JS

### CSS
- Todas las variables de diseño están en `main.css` bajo `:root`
- Colores de marca: `--rose: #c9847a`, `--rose-light`, `--rose-dark`, `--dark: #221815`
- Clases de utilidad disponibles: `.card`, `.btn`, `.btn--primary/secondary/danger/ghost/sm`, `.form-control`, `.form-group`, `.form-row`, `.form-actions`, `.badge`, `.table-wrap`, `.empty-state`, `.filter-bar`, `.grid-2/3/4`, `.page`, `.page-header`, `.amount`
- El layout responsivo colapsa el sidebar en móvil; las grids pasan a 1 columna bajo 768px

## Funciones de utilidad disponibles (`utils/utils.js`)

```js
formatUSD(n)              // '$1,234.56' (locale es-CO)
formatMN(usd, rate)       // 'COP 75.000.000' (Intl.NumberFormat)
formatDate(dateStr)       // 'ene. 15, 2025'
formatDateTime(dateStr)   // 'ene. 15, 2025, 10:30'
formatDateInput(dateStr)  // '2025-01-15T10:30' (para inputs datetime-local)
nowISO()                  // new Date().toISOString()
generateId()              // crypto.randomUUID() con fallback
debounce(fn, ms=300)      // wrapper debounce estándar
```

## Caché (services/index.js)

```js
// Cargar con caché IndexedDB (TTL 5 min)
const products = await loadCached('products', () => api.getProducts(filter), 'products');

// Invalidar antes de refrescar tras un CRUD
await invalidateCache('products');
```

Solo `products` usa caché actualmente. Proveedores, ventas y dashboard van directo al servidor.

## Auth (services/index.js)

```js
auth.isLoggedIn()         // comprueba dm_token en sessionStorage
auth.getUser()            // devuelve objeto user parseado de dm_user
auth.login(user, pass)    // POST /api/login → guarda token y user en sessionStorage
auth.logout()             // limpia sessionStorage, dispara evento 'authChanged'
```

El token es JSON base64 con `{ id, exp }` — sin firma criptográfica. No exponer en redes públicas.

## Patrón de una vista nueva

```js
// frontend/js/views/miVista.js
import { api } from '../db/api.js';
import { showToast, confirmDialog, openModal, closeModal } from '../core/app.js';
import { formatUSD } from '../utils/utils.js';

let currentContainer = null;

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando...</div>';

  try {
    const data = await api.getSomething();
    renderTable(container, data);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderTable(container, items) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div><h1>Título</h1><p>${items.length} elemento(s)</p></div>
        <button class="btn btn--primary" onclick="window._openForm(null)">Nuevo</button>
      </div>
      <!-- contenido -->
    </div>
  `;
  // asignar eventos aquí con querySelector + addEventListener
}

window._openForm = function(item) { /* openModal(...) */ };
window._deleteItem = async function(id) {
  const ok = await confirmDialog('¿Eliminar?');
  if (!ok) return;
  try {
    await api.deleteItem(id);
    showToast('Eliminado', 'success');
    render(currentContainer);
  } catch (err) {
    showToast(err.message, 'error');
  }
};
```

Registrar la ruta en `app.js`:
```js
import { render as renderMiVista } from '../views/miVista.js';
route('#/mi-vista', protect((_, c) => renderMiVista(c)));
```

Agregar el título en `config.js`:
```js
'#/mi-vista': 'Mi Vista',
```

Agregar el enlace en `index.html` dentro de `<nav class="sidebar-nav">`:
```html
<a href="#/mi-vista" class="sidebar-link" data-route>
  <!-- svg icon -->
  Mi Vista
</a>
```

## Pendientes conocidos (deuda técnica)
- Implementar `escHtml()` y `escAttr()` y aplicarlos en todas las vistas para prevenir XSS
- Unificar generación de IDs: moverla al backend para todos los recursos (actualmente productos generan ID en frontend)
- El `exchange_rate` en los mini-stats de `salesView.js` toma el valor de la primera venta del array en lugar de `settings.exchange_rate`
- Los filtros de búsqueda de productos hacen una petición al servidor en cada keystroke; considerar filtrar en memoria para `q` y solo ir al servidor para `category`/`status`
- El cleanup del router no se ejecuta si el handler de la ruta lanza un error asíncrono

## Puerto y arranque
```bash
cd backend && npm install   # primera vez
node server.js              # http://localhost:3456
node --watch server.js      # con recarga automática

# Credenciales por defecto
admin / admin123
```

La BD se crea automáticamente en `backend/danimarvis.db` al primer arranque. Eliminarla la regenera con datos semilla.
