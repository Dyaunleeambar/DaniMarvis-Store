# DaniMarvis Store — Panel de Gestión

Panel de gestión para gestores de ventas que trabajan con importadores de electrodomésticos y productos para el hogar. Permite administrar productos, proveedores, ventas, generar imágenes promocionales para redes sociales y publicar directamente en Facebook e Instagram.

---

## Tabla de Contenido

- [Descripción General](#descripción-general)
- [Tecnologías](#tecnologías)
- [Arquitectura](#arquitectura)
- [Instalación y Ejecución](#instalación-y-ejecución)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [API REST](#api-rest)
- [Panel de Gestión (Frontend)](#panel-de-gestión-frontend)
- [Generador de Imágenes](#generador-de-imágenes)
- [Catálogo Público (GitHub Pages)](#catálogo-público-github-pages)
- [Publicaciones en Redes Sociales](#publicaciones-en-redes-sociales)
- [Sistema de Respaldos](#sistema-de-respaldos)
- [Flujo de Trabajo](#flujo-de-trabajo)
- [Personalización](#personalización)
- [Roadmap](#roadmap)

---

## Descripción General

Este sistema permite a un **gestor de ventas**:

1. **Registrar productos** de múltiples importadores con precio, comisión, garantía y múltiples imágenes.
2. **Administrar proveedores** con sus datos de contacto, información adicional y tasa de comisión.
3. **Registrar ventas** con cálculo automático de comisiones y seguimiento de entregas.
4. **Generar imágenes promocionales** 1080x1080 para Facebook/Instagram/WhatsApp con el logo de la marca, precio, comisión y CTA.
5. **Generar textos de publicación** con IA (compatible con OpenAI) usando plantillas personalizables.
6. **Publicar directamente en Facebook e Instagram** mediante la Graph API.
7. **Generar un catálogo web público** con todos los productos activos, filtros por categoría, búsqueda y botón directo a WhatsApp. Se despliega en GitHub Pages.
8. **Dar seguimiento** a entregas y comisiones pendientes.
9. **Configurar el tipo de cambio** USD → MN para mostrar precios en moneda nacional.
10. **Respaldar y restaurar** todos los datos del sistema como archivos JSON.

El negocio funciona así:

```
Importador → Tú (Gestor) → Cliente final
```

Los importadores proporcionan productos y se encargan del envío directo al cliente. El gestor (tú) se encarga de la publicidad, la gestión de ventas y la coordinación.

---

## Tecnologías

### Backend
| Tecnología | Uso |
|-----------|-----|
| **Node.js** (v18+) | Entorno de ejecución |
| **Express** | Framework HTTP |
| **sql.js** | Base de datos SQLite (100% JS/WASM) |
| **uuid** | Generación de IDs |
| **multer** | Subida de archivos de imágenes |
| **sharp** | Conversión de imágenes a WebP |
| **canvas** | Generación de íconos (Node.js) |

### Frontend
| Tecnología | Uso |
|-----------|-----|
| **JavaScript Vanilla** (ES Modules) | Sin frameworks |
| **HTML5** | Estructura semántica |
| **CSS3** (nativo) | Sin preprocesadores |
| **Canvas API** | Generación de imágenes 1080x1080 |
| **IndexedDB** | Caché offline en navegador |

---

## Arquitectura

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
│  │  │         │   Publications, Backup,    │   │
│  │  │         │   Catalog, Settings)       │   │
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
│  ┌────▼─────┐  ┌──────────────────────┐     │
│  │  SQLite  │  │  Facebook Graph API  │     │
│  │  .db     │  │  (publicaciones)     │     │
│  └──────────┘  └──────────────────────┘     │
└──────────────────────────────────────────────┘
```

---

## Instalación y Ejecución

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

# 3. Iniciar el servidor (desde backend/ o desde la raíz del proyecto)
npm start
# Alternativa con recarga automática:
npm run dev
```

El servidor arranca en `http://localhost:3456`. La base de datos SQLite se crea automáticamente en `backend/danimarvis.db` con un usuario administrador por defecto.

> Desde la raíz del proyecto también puedes usar `npm start` (ejecuta `backend/server.js` directamente).

### Credenciales de Acceso

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |

---

## Estructura del Proyecto

```
DaniMarvisStore/
├── package.json               # Scripts npm desde la raíz del proyecto
├── scripts/
│   └── generate-catalog.js    # Script CLI para regenerar el catálogo público
├── public-catalog/
│   ├── index.html             # Catálogo web estático generado (GitHub Pages)
│   └── images/                # Imágenes de productos copiadas para el catálogo
├── backend/
│   ├── server.js              # Servidor Express (puerto 3456)
│   ├── package.json           # Dependencias Node.js
│   ├── danimarvis.db          # Base de datos SQLite (auto-creada)
│   ├── uploads/               # Imágenes subidas por los usuarios
│   ├── db/
│   │   └── database.js        # Esquema, migraciones y seed de BD
│   ├── lib/
│   │   ├── catalogGenerator.js # Generador de HTML estático del catálogo público
│   │   ├── currency.js         # Formateador de precios en USD
│   │   ├── facebook.js         # Integración con Facebook Graph API
│   │   └── imageUtils.js       # Conversión de imágenes a WebP con sharp
│   ├── routes/
│   │   ├── products.js        # CRUD productos + visibilidad
│   │   ├── providers.js       # CRUD proveedores
│   │   ├── sales.js           # CRUD ventas + PATCH estado
│   │   ├── categories.js      # CRUD categorías
│   │   ├── publications.js    # CRUD publicaciones + publicar en FB/IG
│   │   └── backup.js          # Exportar/restaurar datos como JSON
│   └── scripts/
│       └── generate-icon.js   # Generador de ícono PNG con canvas
│
├── frontend/
│   ├── index.html             # Shell SPA: sidebar, modal, confirmación apilada, toast
│   ├── css/
│   │   ├── main.css           # Variables, reset, loading screen, login
│   │   ├── layout.css         # Sidebar fijo, topbar, grid, responsive
│   │   └── components.css     # Cards, tablas, formularios, badges, lightbox, publicaciones
│   └── js/
│       ├── core/
│       │   ├── app.js         # Bootstrap, rutas, toast, modal, confirmDialog
│       │   ├── router.js      # Router SPA por hash (#/ruta)
│       │   └── config.js      # Constantes y títulos de rutas
│       ├── db/
│       │   ├── api.js         # Cliente HTTP para API REST
│       │   └── indexeddb.js   # Caché offline con IndexedDB
│       ├── services/
│       │       └── index.js   # Auth, caché + invalidación de productos
│       ├── utils/
│       │   ├── utils.js       # formatUSD, formatMN, fechas, IDs, debounce
│       │   └── imageGenerator.js  # Motor Canvas para imágenes 1080x1080
│       └── views/
│           ├── loginView.js          # Pantalla de inicio de sesión
│           ├── dashboardView.js      # Estadísticas y gráficos
│           ├── productsView.js       # CRUD productos + filtros + imágenes + IA
│           ├── providersView.js      # CRUD proveedores
│           ├── salesView.js          # CRUD ventas + cálculo comisiones
│           ├── publicationsView.js   # CRUD publicaciones + publicar en FB/IG
│           ├── catalogImagesView.js  # Generador de catálogo público
│           ├── settingsView.js       # Configuración general
│           └── backupView.js         # Exportar/restaurar datos
│
└── README.md
```

---

## API REST

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
| `PATCH` | `/api/products/:id/visibility` | Alternar visibilidad en catálogo público |
| `DELETE` | `/api/products/:id` | Eliminar o archivar producto |

**Campos del producto:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | TEXT | Nombre del producto |
| `description` | TEXT | Descripción (puede generarse con IA) |
| `category` | TEXT | Categoría del producto |
| `price` | REAL | Precio en USD |
| `commission_type` | TEXT | Tipo de comisión (siempre "fixed") |
| `commission_value` | REAL | Comisión fija en USD por unidad |
| `warranty` | TEXT | Información de garantía |
| `provider_id` | TEXT | ID del proveedor asociado |
| `images` | TEXT | Array JSON de URLs de imágenes |
| `image_url` | TEXT | URL de imagen principal (legacy) |
| `publish_text` | TEXT | Texto generado para publicación |
| `catalog_visible` | INTEGER | 1 = visible en catálogo, 0 = oculto |
| `stock` | INTEGER | Cantidad en stock |
| `status` | TEXT | "active" o "archived" |

### Proveedores

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/providers` | Listar proveedores (incluye conteo de productos) |
| `GET` | `/api/providers/:id` | Obtener proveedor por ID |
| `POST` | `/api/providers` | Crear proveedor |
| `PUT` | `/api/providers/:id` | Actualizar proveedor |
| `DELETE` | `/api/providers/:id` | Eliminar (solo si no tiene productos) |

**Campos del proveedor:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | TEXT | Nombre del proveedor |
| `contact` | TEXT | Nombre de contacto |
| `phone` | TEXT | Teléfono |
| `email` | TEXT | Correo electrónico |
| `info` | TEXT | Información adicional |
| `commission_rate` | REAL | Tasa de comisión |
| `notes` | TEXT | Notas |

### Ventas

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/sales` | Listar ventas (filtros: `?delivery_status=&provider_id=&start_date=&end_date=`) |
| `GET` | `/api/sales/:id` | Obtener venta por ID |
| `POST` | `/api/sales` | Crear venta (recalcula total y comisión automáticamente) |
| `PUT` | `/api/sales/:id` | Actualizar venta (recalcula total y comisión) |
| `PATCH` | `/api/sales/:id/status` | Actualizar solo estado (`delivery_status`, `commission_paid`) |
| `DELETE` | `/api/sales/:id` | Eliminar venta |

> El backend **recalcula** `total_amount` y `commission_amount` al crear/editar ventas, ignorando los valores enviados por el cliente.

### Categorías

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/categories` | Listar categorías ordenadas |
| `POST` | `/api/categories` | Crear categoría (nombre único) |
| `PUT` | `/api/categories/:id` | Renombrar (actualiza productos asociados) |
| `DELETE` | `/api/categories/:id` | Eliminar (solo si no tiene productos) |

> Las 7 categorías por defecto se crean al inicializar la BD. Las categorías huérfanas de productos existentes se importan automáticamente.

### Publicaciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/publications` | Listar todas las publicaciones |
| `GET` | `/api/publications/:id` | Obtener publicación por ID |
| `POST` | `/api/publications` | Crear publicación (asocia a producto, almacena texto e imágenes) |
| `PUT` | `/api/publications/:id` | Actualizar publicación |
| `POST` | `/api/publications/:id/publish` | Publicar en Facebook o Instagram |
| `DELETE` | `/api/publications/:id` | Eliminar publicación |

### Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Estadísticas: totales, ingresos, comisiones, ventas mensuales, top productos, ventas recientes, tipo de cambio |

### Conteos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/counts` | Conteo de productos, proveedores y ventas para la barra lateral |

### Configuración

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/settings` | Obtener configuración global (tipo de cambio + publish_config) |
| `PUT` | `/api/settings` | Actualizar tipo de cambio y/o configuración de publicación |

**publish_config** incluye:
- `template`: Plantilla de texto para publicaciones con placeholders (`{NAME}`, `{PRICE}`, `{DESCRIPTION}`, `{WARRANTY}`, `{CATEGORY}`, `{STOCK}`)
- `ai_url`: URL de la API de IA compatible con OpenAI
- `ai_key`: Clave de API de IA
- `ai_model`: Modelo de IA a utilizar
- `ai_prompt`: Prompt del sistema para generación de texto
- `fb_page_id`: ID de página de Facebook
- `fb_access_token`: Token de acceso de Facebook
- `ig_account_id`: ID de cuenta de Instagram

### Imágenes

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/upload` | Subir imagen (multer, 5MB máximo, conversión automática a WebP) |

### IA

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/generate-description` | Generar descripción de producto con IA |

### Catálogo público

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/generate-catalog` | Regenerar el catálogo HTML estático desde el panel (requiere auth) |
| `GET` | `/catalogo` | Ver el catálogo público generado localmente |

### Respaldos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/backup` | Exportar todos los datos como archivo JSON |
| `POST` | `/api/backup/restore` | Restaurar todos los datos desde un archivo JSON (elimina datos existentes) |

---

## Panel de Gestión (Frontend)

El frontend es una **SPA** (Single Page Application) construida con JavaScript vanilla. Usa un router por hash (`#/ruta`) para la navegación.

### Secciones

| Ruta | Sección | Descripción |
|------|---------|-------------|
| `#/dashboard` | Dashboard | Tarjetas con totales, ingresos, comisiones, ventas recientes, top productos, gráfico mensual |
| `#/products` | Productos | CRUD completo con filtros, gestión de múltiples imágenes, generación de descripciones con IA, texto de publicación, visibilidad en catálogo |
| `#/providers` | Proveedores | CRUD con información de contacto y conteo de productos |
| `#/sales` | Ventas | CRUD con cálculo automático de comisiones, seguimiento de entregas y filtros |
| `#/publications` | Publicaciones | CRUD de publicaciones con texto, imágenes, generación con IA y publicación directa en Facebook/Instagram |
| `#/catalog-images` | Catálogo público | Generador de catálogo web estático + despliegue en GitHub Pages |
| `#/settings` | Configuración | Tipo de cambio, plantilla de publicación, configuración de IA, configuración de Facebook/Instagram, gestión de categorías |
| `#/backup` | Respaldos | Exportar e importar todos los datos del sistema como JSON |

### Funcionalidades

- **Autenticación** con token Bearer en sessionStorage
- **Toast notifications** para feedback de acciones
- **Modales** para formularios de creación/edición
- **Diálogos de confirmación** (`confirmDialog`) para eliminar registros o descartar cambios sin guardar
- **Protección de formularios** — al cerrar el modal con datos modificados se pide confirmación
- **Sidebar responsive** — se colapsa en móvil
- **Sidebar con conteos en vivo** — muestra cantidad de productos, proveedores y ventas, se actualiza al navegar o tras crear/eliminar
- **Caché offline** con IndexedDB y función dedicada `fetchProducts()` que evita datos obsoletos
- **Invalidación de caché** automática al crear, editar o eliminar productos
- **Categorías dinámicas** desde el servidor — el formulario de productos y los filtros se alimentan de `GET /api/categories`
- **Filtros en tiempo real** en productos (con preservación de foco en el campo de búsqueda)
- **Cálculo automático** de comisiones al registrar ventas
- **Gestión de imágenes múltiples** — subida, URL, orden con drag-and-drop, conversión automática a WebP
- **Lightbox** para previsualización de imágenes a pantalla completa con navegación
- **Generación de descripciones con IA** — envía datos del producto a una API compatible con OpenAI
- **Generación de textos de publicación** con plantilla personalizable
- **Publicación directa** en páginas de Facebook y cuentas de Instagram
- **Backup/Restore** completo del sistema como archivos JSON

---

## Generador de Imágenes

El generador produce imágenes **1080x1080px** (formato estándar para Facebook e Instagram) con el siguiente diseño:

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
│  │ Comisión: $10 USD │ Gtía│  │  ← Barra oscura
│  └────────────────────────┘  │
│                              │
│   Escríbeme y llévate       │
│   Comprar por WhatsApp      │  ← CTA verde WhatsApp
│                              │
│  DaniMarvis Store — Footer  │
└──────────────────────────────┘
```

### Cómo usarlo

1. Ve a **Productos** en el panel.
2. Haz clic en **"Generar imagen"** en cualquier producto.
3. La imagen se renderiza en el navegador (no se envía al servidor).
4. Previsualiza y descarga como PNG.
5. Usa **"Generar todas"** para descargar imágenes de todos los productos activos (se descargan una por una automáticamente).

Las imágenes se generan **100% en el cliente** usando Canvas API — no ocupan recursos del servidor.

---

## Catálogo Público (GitHub Pages)

El sistema genera un **catálogo web estático** con todos los productos activos, ideal para compartir por WhatsApp sin depender del catálogo oficial de Meta (bloqueado para números cubanos +53).

### Características

- **Grid de productos** con imagen principal, nombre, precio en USD, descripción y botón "Consultar" vía WhatsApp.
- **Filtros por categoría** y **búsqueda** en vivo.
- **Modal de previsualización** al hacer clic en un producto con todos los detalles y enlace directo a WhatsApp.
- **Diseño responsive** con soporte modo oscuro automático.
- **Sin enlaces a competidores** — el catálogo solo dirige a tu WhatsApp.
- **Control de visibilidad** — cada producto tiene un flag `catalog_visible` para incluirlo/excluirlo del catálogo.

### Cómo generar el catálogo

1. Ve a **Catálogo público** en el panel.
2. Haz clic en **"Generar catálogo"**.
3. El servidor genera el HTML en `public-catalog/index.html` y copia las imágenes (conversión automática a WebP).
4. Para publicarlo en GitHub Pages, haz commit y push de la carpeta `public-catalog/`.

### Desde la terminal

```bash
node scripts/generate-catalog.js
```

### Estructura generada

```
public-catalog/
├── index.html        # Catálogo completo (autocontenido)
└── images/           # Imágenes de productos copiadas desde backend/uploads/
```

### Despliegue en GitHub Pages

1. Pushear el proyecto (incluyendo `public-catalog/`) a GitHub.
2. Ir a Settings → Pages → "Deploy from a branch".
3. Seleccionar `main` / `public-catalog`.
4. El sitio queda disponible en `https://<usuario>.github.io/<repo>/public-catalog/`.

---

## Publicaciones en Redes Sociales

El sistema permite crear publicaciones y publicarlas directamente en Facebook e Instagram.

### Flujo de publicación

1. **Crear publicación** — Asocia un producto, genera o escribe el texto de publicación, agrega imágenes.
2. **Generar texto con IA** — Usa la configuración de IA para generar automáticamente un texto de publicación basado en la plantilla configurada.
3. **Publicar** — Envía la publicación a Facebook (Graph API) o Instagram.

### Configuración necesaria

En **Configuración** del panel, configura:

- **Facebook Page ID** e **Instagram Account ID**
- **Token de acceso** de Facebook (con permisos `pages_publish_posts` y `instagram_basic`, `instagram_content_publish`)
- **Plantilla de publicación** con placeholders: `{NAME}`, `{PRICE}`, `{DESCRIPTION}`, `{WARRANTY}`, `{CATEGORY}`, `{STOCK}`
- **Configuración de IA** (URL, clave, modelo, prompt) para generación automática de textos

### API de publicaciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/publications` | Crear publicación |
| `POST` | `/api/publications/:id/publish` | Publicar en FB/IG (`{ "platform": "facebook" }` o `{ "platform": "instagram" }`) |

---

## Sistema de Respaldos

Permite exportar e importar todos los datos del sistema.

### Exportar

1. Ve a **Respaldos** en el panel.
2. Haz clic en **"Exportar datos"**.
3. Se descarga un archivo JSON con todos los productos, proveedores, ventas, categorías, configuración y publicaciones.

### Importar

1. Ve a **Respaldos** en el panel.
2. Haz clic en **"Importar datos"** y selecciona un archivo JSON.
3. **Advertencia:** Esto eliminará todos los datos existentes y los reemplazará con los del archivo.

### Desde la API

```bash
# Exportar
GET /api/backup → archivo JSON

# Restaurar
POST /api/backup/restore
Body: { "providers": [...], "products": [...], "sales": [...], ... }
```

---

## Flujo de Trabajo

### 1. Registrar un proveedor
```
Panel → Proveedores → Nuevo proveedor
```
Ingresa nombre, contacto, teléfono, email e información adicional.

### 2. Registrar productos
```
Panel → Productos → Nuevo producto
```
Asocia cada producto a un proveedor. Define precio en USD, comisión fija por unidad, garantía y stock. Sube imágenes o ingresa URLs.

### 3. Configurar tipo de cambio
```
Panel → Configuración
```
Actualiza el valor de 1 USD en moneda nacional (MN). Se refleja en dashboard, ventas e imágenes promocionales.

### 4. Generar imágenes promocionales
```
Panel → Productos → Generar imagen
```
Descarga la imagen y publícala en Facebook con un enlace a tu WhatsApp.

### 5. Generar publicaciones
```
Panel → Publicaciones → Nueva publicación
```
Asocia un producto, genera el texto con IA o escríbelo manualmente, y publica directamente en Facebook o Instagram.

### 6. Generar catálogo público
```
Panel → Catálogo público → Generar catálogo
```
El servidor genera un catálogo web estático con todos los productos activos, imágenes y botón de WhatsApp. Luego haz commit y push a GitHub para actualizar GitHub Pages.

### 7. Registrar ventas
```
Panel → Ventas → Nueva venta
```
Selecciona el producto, ingresa datos del cliente. El sistema calcula automáticamente el total y la comisión.

### 8. Dar seguimiento
Actualiza el estado de entrega (pendiente → enviado → entregado) y marca comisiones como pagadas.

### 9. Respaldar datos
```
Panel → Respaldos → Exportar datos
```
Descarga un archivo JSON con todos los datos para tener un respaldo de seguridad.

### 10. Revisar dashboard
El dashboard muestra ingresos totales, comisiones pendientes, productos más vendidos y ventas mensuales.

---

## Personalización

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

### Plantilla de publicaciones
En **Configuración** del panel puedes definir una plantilla de texto con placeholders:
- `{NAME}` — Nombre del producto
- `{PRICE}` — Precio en USD
- `{DESCRIPTION}` — Descripción del producto
- `{WARRANTY}` — Garantía
- `{CATEGORY}` — Categoría
- `{STOCK}` — Stock disponible

---

## Roadmap

### Completado

- [x] CRUD completo de productos, proveedores, ventas y categorías
- [x] Cálculo automático de comisiones
- [x] Generación de imágenes promocionales 1080x1080 (Canvas API)
- [x] Subida de imágenes al servidor con conversión automática a WebP
- [x] Gestión de múltiples imágenes por producto con drag-and-drop
- [x] Generación de catálogo web estático para GitHub Pages
- [x] Modo oscuro en el catálogo público
- [x] Enlace directo a WhatsApp por producto
- [x] Sistema de publicaciones con publicación directa en Facebook e Instagram
- [x] Generación de textos de publicación con IA (compatible OpenAI)
- [x] Plantilla de publicaciones personalizable
- [x] Sistema de respaldos (exportar/importar JSON)
- [x] Control de visibilidad de productos en catálogo público
- [x] Caché offline con IndexedDB
- [x] Configuración de tipo de cambio USD → MN

### Por implementar

- [ ] **Exportar reportes** a Excel/CSV
- [ ] **Panel de comisiones** por proveedor con resumen mensual
- [ ] **Autenticación mejorada** con JWT y hashes de contraseñas
- [ ] **Notificaciones** cuando una venta cambia de estado
- [ ] **Múltiples gestores** con roles y permisos
- [ ] **Integración con Facebook Catalog** para Dynamic Ads
- [ ] **Compartir módulo `escHtml()`/`escAttr()`** como utilidad centralizada
- [ ] **Unificar generación de IDs** en el backend para todos los recursos
- [ ] **Aplicación Electron** para escritorio

---

## Licencia

Proyecto privado — DaniMarvis Store.
