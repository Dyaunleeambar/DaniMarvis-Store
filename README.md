# DaniMarvis Store — Panel de Gestión

Panel de gestión para gestores de ventas que trabajan con importadores de electrodomésticos y productos para el hogar. Permite administrar productos, proveedores, ventas y generar imágenes promocionales listas para redes sociales.

---

## 📋 Tabla de Contenido

- [Descripción General](#-descripción-general)
- [Tecnologías](#-tecnologías)
- [Arquitectura](#-arquitectura)
- [Instalación y Ejecución](#-instalación-y-ejecución)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [API REST](#-api-rest)
- [Panel de Gestión (Frontend)](#-panel-de-gestión-frontend)
- [Generador de Imágenes](#-generador-de-imágenes)
- [Flujo de Trabajo](#-flujo-de-trabajo)
- [Personalización](#-personalización)
- [Roadmap](#-roadmap)

---

## 📖 Descripción General

Este sistema permite a un **gestor de ventas**:

1. **Registrar productos** de múltiples importadores con precio, comisión y garantía.
2. **Administrar proveedores** con sus datos de contacto y tasa de comisión.
3. **Registrar ventas** con cálculo automático de comisiones.
4. **Generar imágenes promocionales** 1080×1080 para Facebook/Instagram/WhatsApp con el logo de la marca, precio, comisión y CTA.
5. **Dar seguimiento** a entregas y comisiones pendientes.

El negocio funciona así:

```
Importador → Tú (Gestor) → Cliente final
```

Los importadores proporcionan productos y se encargan del envío directo al cliente. El gestor (tú) se encarga de la publicidad, la gestión de ventas y la coordinación.

---

## 🛠 Tecnologías

### Backend
| Tecnología | Uso |
|-----------|-----|
| **Node.js** (v18+) | Entorno de ejecución |
| **Express** | Framework HTTP |
| **better-sqlite3** | Base de datos SQLite |
| **uuid** | Generación de IDs |

### Frontend
| Tecnología | Uso |
|-----------|-----|
| **JavaScript Vanilla** (ES Modules) | Sin frameworks |
| **HTML5** | Estructura semántica |
| **CSS3** (nativo) | Sin preprocesadores |
| **Canvas API** | Generación de imágenes |
| **IndexedDB** | Caché offline en navegador |

---

## 🏗 Arquitectura

```
┌─────────────────────────────────────────────┐
│                 Navegador                    │
│  ┌───────────────────────────────────────┐   │
│  │    SPA Vanilla JS                     │   │
│  │  ┌─────────┐  ┌──────────────────┐   │   │
│  │  │ Router  │  │  IndexedDB Cache │   │   │
│  │  │ (hash)  │  │  (offline)       │   │   │
│  │  └────┬────┘  └──────────────────┘   │   │
│  │       │                                │   │
│  │  ┌────▼────┐                           │   │
│  │  │  Views  │  (Dashboard, Products,    │   │
│  │  │         │   Providers, Sales,        │   │
│  │  │         │   Catalog Images)          │   │
│  │  └────┬────┘                           │   │
│  │       │                                │   │
│  │  ┌────▼────┐                           │   │
│  │  │  API    │  (fetch → /api/*)         │   │
│  │  └─────────┘                           │   │
│  └───────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │ HTTP
┌──────────────────▼──────────────────────────┐
│            Express Server                    │
│  ┌──────────┐  ┌────────────────────────┐   │
│  │  Routes  │  │  Static Files          │   │
│  │  /api/*  │  │  (frontend/)           │   │
│  └────┬─────┘  └────────────────────────┘   │
│       │                                      │
│  ┌────▼─────┐                                │
│  │  SQLite  │  (better-sqlite3)              │
│  │  .db     │                                │
│  └──────────┘                                │
└──────────────────────────────────────────────┘
```

---

## 🚀 Instalación y Ejecución

### Requisitos
- Node.js v18 o superior
- Git Bash (recomendado en Windows) o cualquier terminal

### Pasos

```bash
# 1. Clonar o copiar el proyecto
cd /d/Proyectos/DaniMarvisStore

# 2. Instalar dependencias del backend
cd backend
npm install

# 3. Iniciar el servidor
npm start
```

El servidor arranca en `http://localhost:3001`. La base de datos SQLite se crea automáticamente en `backend/danimarvis.db` con un usuario administrador por defecto.

### Credenciales de Acceso

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |

---

## 📁 Estructura del Proyecto

```
DaniMarvisStore/
├── backend/
│   ├── server.js              # Servidor Express (puerto 3001)
│   ├── package.json           # Dependencias Node.js
│   ├── danimarvis.db          # Base de datos SQLite (auto-creada)
│   ├── db/
│   │   └── database.js        # Esquema + seed de BD
│   └── routes/
│       ├── products.js        # CRUD productos
│       ├── providers.js       # CRUD proveedores
│       └── sales.js           # CRUD ventas
│
├── frontend/
│   ├── index.html             # Shell SPA: sidebar, topbar, modal, toast
│   ├── css/
│   │   ├── main.css           # Variables, reset, loading screen
│   │   ├── layout.css         # Sidebar fijo, grid, responsive
│   │   └── components.css     # Cards, tablas, formularios, badges
│   └── js/
│       ├── core/
│       │   ├── app.js         # Bootstrap, rutas, toast, modal
│       │   ├── router.js      # Router SPA por hash (#/ruta)
│       │   └── config.js      # Constantes y títulos de rutas
│       ├── db/
│       │   ├── api.js         # Cliente HTTP para API REST
│       │   └── indexeddb.js   # Caché offline con IndexedDB
│       ├── services/
│       │   └── index.js       # Auth + capa de caché
│       ├── utils/
│       │   ├── utils.js       # formatCurrency, fechas, IDs
│       │   └── imageGenerator.js  # Motor Canvas para imágenes
│       └── views/
│           ├── dashboardView.js      # Estadísticas y gráficos
│           ├── productsView.js       # CRUD productos + filtros
│           ├── providersView.js      # CRUD proveedores
│           ├── salesView.js          # CRUD ventas + cálculo comisiones
│           └── catalogImagesView.js  # Generador de imágenes
│
└── README.md
```

---

## 🌐 API REST

Todas las rutas API están bajo el prefijo `/api/`.

### Autenticación

```bash
POST /api/login
Body: { "username": "admin", "password": "admin123" }
Response: { "user": {...}, "token": "..." }
```

### Productos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/products` | Listar productos (filtros: `?category=&status=&provider_id=&q=`) |
| `GET` | `/api/products/:id` | Obtener producto por ID |
| `POST` | `/api/products` | Crear producto |
| `PUT` | `/api/products/:id` | Actualizar producto |
| `DELETE` | `/api/products/:id` | Eliminar o archivar producto |

**Ejemplo de creación:**

```json
{
  "name": "Licuadora Pro 3000",
  "price": 250000,
  "category": "Electrodomésticos",
  "commission_type": "percentage",
  "commission_value": 5,
  "warranty": "1 año",
  "stock": 10
}
```

### Proveedores

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/providers` | Listar proveedores (incluye conteo de productos) |
| `GET` | `/api/providers/:id` | Obtener proveedor por ID |
| `POST` | `/api/providers` | Crear proveedor |
| `PUT` | `/api/providers/:id` | Actualizar proveedor |
| `DELETE` | `/api/providers/:id` | Eliminar (solo si no tiene productos) |

### Ventas

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/sales` | Listar ventas (filtros: `?delivery_status=&provider_id=&start_date=&end_date=`) |
| `GET` | `/api/sales/:id` | Obtener venta por ID |
| `POST` | `/api/sales` | Crear venta |
| `PUT` | `/api/sales/:id` | Actualizar venta |
| `PATCH` | `/api/sales/:id/status` | Actualizar solo estado (`delivery_status`, `commission_paid`) |
| `DELETE` | `/api/sales/:id` | Eliminar venta |

### Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Estadísticas: totales, ventas mensuales, top productos |

---

## 🖥 Panel de Gestión (Frontend)

El frontend es una **SPA** (Single Page Application) construida con JavaScript vanilla. Usa un router por hash (`#/ruta`) para la navegación.

### Secciones

| Ruta | Sección | Descripción |
|------|---------|-------------|
| `#/dashboard` | Dashboard | Tarjetas con totales, ventas recientes, top productos, gráfico mensual |
| `#/products` | Productos | CRUD completo con filtros por categoría, estado y búsqueda |
| `#/providers` | Proveedores | CRUD con conteo de productos asociados |
| `#/sales` | Ventas | CRUD con cálculo automático de comisiones y filtros |
| `#/catalog-images` | Catálogo imágenes | Generador de imágenes promocionales |

### Funcionalidades

- **Toast notifications** para feedback de acciones
- **Modal** para formularios de creación/edición
- **Sidebar responsive** — se colapsa en móvil
- **Caché offline** con IndexedDB (5 min de TTL)
- **Filtros en tiempo real** en productos y ventas
- **Cálculo automático** de comisiones al registrar ventas

---

## 🖼 Generador de Imágenes

El generador produce imágenes **1080×1080px** (formato estándar para Facebook e Instagram) con el siguiente diseño:

```
┌──────────────────────────────┐
│  DANI MARVIS Store           │  ← Logo
│                              │
│      ┌──────────────┐        │
│      │              │        │
│      │   Producto   │        │  ← Imagen del producto
│      │              │        │     (o placeholder)
│      └──────────────┘        │
│                              │
│     Nombre del Producto      │  ← Nombre en Georgia bold
│                              │
│       $ 2.500.000            │  ← Precio destacado (rose)
│                              │
│  ┌────────────────────────┐  │
│  │ Comisión: 8% │ Garantía│  │  ← Barra oscura
│  └────────────────────────┘  │
│                              │
│   📲 Escríbeme y llévate     │
│   💬 Comprar por WhatsApp    │  ← CTA verde WhatsApp
│                              │
│  DaniMarvis Store — Footer   │
└──────────────────────────────┘
```

### Cómo usarlo

1. Ve a **Catálogo imágenes** en el panel.
2. Haz clic en **"Generar imagen"** en cualquier producto.
3. La imagen se renderiza en el navegador (no se envía al servidor).
4. Previsualiza y descarga como PNG.
5. Usa **"Generar todas"** para descargar imágenes de todos los productos activos (se descargan una por una automáticamente).

Las imágenes se generan **100% en el cliente** usando Canvas API — no ocupan recursos del servidor.

---

## 🔄 Flujo de Trabajo

### 1. Registrar un proveedor
```
Panel → Proveedores → Nuevo proveedor
```
Ingresa nombre, contacto, teléfono y % de comisión.

### 2. Registrar productos
```
Panel → Productos → Nuevo producto
```
Asocia cada producto a un proveedor. Define precio, comisión (porcentaje o fijo), garantía y stock.

### 3. Generar imágenes promocionales
```
Panel → Catálogo imágenes → Generar imagen
```
Descarga la imagen y publícala en Facebook con un enlace a tu WhatsApp.

### 4. Registrar ventas
```
Panel → Ventas → Nueva venta
```
Selecciona el producto, ingresa datos del cliente. El sistema calcula automáticamente el total y la comisión.

### 5. Dar seguimiento
Actualiza el estado de entrega (pendiente → enviado → entregado) y marca comisiones como pagadas.

### 6. Revisar dashboard
El dashboard muestra ingresos totales, comisiones pendientes, productos más vendidos y ventas mensuales.

---

## 🎨 Personalización

### Colores de marca
Edita las variables CSS en `frontend/css/main.css`:

```css
:root {
  --rose: #c9847a;        /* Color principal */
  --rose-light: #e8b4ad;  /* Variante clara */
  --rose-dark: #a8645a;   /* Variante oscura */
  --dark: #221815;        /* Color de texto oscuro */
}
```

### Logo
El logo SVG está en `frontend/index.html` dentro del sidebar y se usa en el generador de imágenes. Puedes reemplazar el SVG o modificar `drawLogo()` en `frontend/js/utils/imageGenerator.js`.

### Template de imágenes
Edita `frontend/js/utils/imageGenerator.js` para cambiar:
- Dimensiones (const `CANVAS_SIZE`)
- Colores, fuentes, tamaños
- Texto del CTA
- Posición de los elementos

---

## 🗺 Roadmap

Ideas para futuras iteraciones:

- [ ] **Exportar reportes** a Excel/CSV
- [ ] **Enlace directo a WhatsApp** por producto (con plantilla de mensaje predefinida)
- [ ] **Panel de comisiones** por proveedor con resumen mensual
- [ ] **Subida de imágenes** al servidor (multer ya incluido en package.json)
- [ ] **Modo oscuro**
- [ ] **Autenticación mejorada** con JWT y sesiones
- [ ] **Notificaciones** cuando una venta cambia de estado
- [ ] **Integración con Facebook Catalog** para Dynamic Ads
- [ ] **Generación de catálogo PDF** para compartir por WhatsApp
- [ ] **Múltiples gestores** con roles y permisos

---

## 📄 Licencia

Proyecto privado — DaniMarvis Store.
