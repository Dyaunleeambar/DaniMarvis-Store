# DaniMarvis Store — Contexto para Claude Code

## Descripción del proyecto
Panel de gestión para asesores de venta que trabajan con importadores de electrodomésticos. Permite gestionar productos, proveedores, ventas y generar imágenes promocionales para Facebook/WhatsApp.

## Stack tecnológico
- **Backend:** Node.js + Express (ES Modules, `"type": "module"`)
- **Base de datos:** SQLite mediante sql.js (100% JS, sin módulos nativos)
- **Frontend:** Vanilla JS SPA (sin frameworks), HTML5, CSS3
- **Escritorio:** Electron
- **Imágenes:** Canvas API del navegador (generación 1080×1080px)
- **Build:** electron-builder (portable + nsis)

## Estructura del proyecto
```
DaniMarvisStore/
├── backend/
│   ├── db/
│   │   └── database.js        # Inicialización sql.js + schema
│   ├── routes/
│   │   ├── products.js        # CRUD productos
│   │   ├── providers.js       # CRUD proveedores
│   │   └── sales.js           # CRUD ventas
│   ├── scripts/
│   │   └── generate-icon.js   # Genera el ícono de la app (canvas)
│   ├── build/
│   │   └── icon.png           # Ícono generado (256×256)
│   ├── server.js              # Entry point Express
│   └── package.json
├── frontend/
│   ├── js/
│   │   ├── core/
│   │   │   ├── app.js         # Router SPA
│   │   │   └── config.js      # API_BASE, rutas, títulos
│   │   ├── db/
│   │   │   └── api.js         # Fetch wrapper con auth
│   │   ├── services/
│   │   │   └── index.js       # Caché, utilidades
│   │   ├── utils/
│   │   │   └── imageGenerator.js  # Canvas API para imágenes promocionales
│   │   └── views/             # Cada vista es un módulo
│   │       ├── loginView.js
│   │       ├── dashboardView.js
│   │       ├── productsView.js
│   │       ├── providersView.js
│   │       ├── salesView.js
│   │       └── catalogImagesView.js
│   └── index.html
├── electron/
│   └── main.js                # Ventana Electron + fork del server
├── package.json               # Raíz: build electron-builder
├── .gitignore
└── CLAUDE.md                  # Este archivo
```

## Convenciones de código

### Backend
- ES Modules siempre (`import`/`export`, no `require`)
- Las rutas Express reciben `(req, res)`, NO `next` (no hay middleware después)
- La DB se obtiene con `getDB()` (sincrónico, debe llamarse `initDB()` primero al arrancar)
- Las consultas SQL usan el patrón: `db.prepare(sql).all(...params)`, `.get(...params)`, `.run(...params)`
- Los IDs se generan con `uuid` en las rutas antes de insertar
- No agregar comentarios en archivos .js

### Frontend
- SPA con hash routing (`#/dashboard`, `#/products`, etc.)
- Las vistas son funciones que reciben el elemento contenedor y renderizan con innerHTML
- Los eventos se asignan con `querySelector` + `addEventListener`
- API calls mediante `api.xxx()` desde `api.js`
- `API_BASE` se auto-configura según el puerto (Live Server vs Express)
- No usar librerías externas — solo vanilla JS

### Base de datos (sql.js)
- `initDB()` se llama asincrónicamente al arrancar el servidor
- `getDB()` devuelve el objeto db ya inicializado (sync)
- El wrapper `Statement` — creado en `database.js` — traduce la API de sql.js a la de better-sqlite3
- Writes persisten automáticamente con `saveDB()` (export + fs.writeFileSync)
- La DB se carga completa en memoria al iniciar (archivo .db en backend/)

## Comandos principales
```bash
# Iniciar servidor (desarrollo)
cd backend && node server.js          # http://localhost:3456

# Iniciar con Electron
cd backend && npm run electron

# Build para Windows
cd backend && npm run dist:win        # genera dist/

# Generar ícono (si se modifica)
node backend/scripts/generate-icon.js
```

## Decisiones técnicas importantes
- **sql.js en vez de better-sqlite3:** better-sqlite3 tiene módulos nativos que causan `NODE_MODULE_VERSION mismatch` con Electron. sql.js es 100% JavaScript/WASM y funciona sin compilación.
- **Vanilla JS en frontend:** El usuario quiere evitar frameworks modernos (React, Vue, etc.)
- **Canvas del navegador vs servidor:** Las imágenes promocionales se generan en el cliente para no cargar el servidor y porque canvas nativo requiere dependencias nativas en Node.js
- **Electron fork:** El servidor Express se ejecuta en un proceso hijo (`fork()`) para mantener separación de responsabilidades

## Puerto
El servidor Express corre en el puerto **3456** (configurado en `backend/server.js` y `electron/main.js`).
