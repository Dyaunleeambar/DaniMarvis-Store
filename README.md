# DaniMarvis Store — Panel de Gestión

Panel de gestión para gestores de ventas que trabajan con importadores de electrodomésticos y productos para el hogar. Permite administrar productos, proveedores, ventas, generar imágenes promocionales para redes sociales, exportar reportes PDF, importar precios desde imágenes con OCR, y publicar directamente en Facebook e Instagram.

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
- [Exportaciones PDF](#exportaciones-pdf)
- [Importación / Sincronización OCR](#importación--sincronización-ocr)
- [Anuncios generados con IA](#anuncios-generados-con-ia)
- [Catálogo Público (GitHub Pages)](#catálogo-público-github-pages)
- [Publicaciones en Redes Sociales](#publicaciones-en-redes-sociales)
- [Sistema de Respaldos](#sistema-de-respaldos)
- [Flujo de Trabajo](#flujo-de-trabajo)
- [Personalización](#personalización)
- [Roadmap](#roadmap)

---

## Descripción General

Este sistema permite a un **gestor de ventas**:

1. **Registrar productos** de múltiples importadores con precio, comisión (USD o MN), garantía y múltiples imágenes.
2. **Administrar proveedores** con sus datos de contacto, información adicional y moneda de comisión (USD o MN).
3. **Registrar ventas** con cálculo automático de comisiones en la moneda del proveedor y seguimiento de entregas.
4. **Generar imágenes promocionales** 1080x1080 con 5 plantillas distintas, fondo con IA y personalización completa de colores y textos.
5. **Exportar reportes PDF** de productos con selección de campos y estilos (tabla o lista detallada).
6. **Importar precios desde imágenes** del proveedor usando OCR (tesseract.js), con detección automática de productos y precios.
7. **Generar textos de publicación** con IA (compatible con OpenAI) usando plantillas personalizables.
8. **Publicar directamente en Facebook e Instagram** mediante la Graph API.
9. **Generar un catálogo web público** con todos los productos activos, filtros por categoría, búsqueda y botón directo a WhatsApp. Se despliega en GitHub Pages.
10. **Crear anuncios con IA (ChatGPT)** — copiar prompts generados por producto e importar los resultados.
11. **Dar seguimiento** a entregas y comisiones pendientes.
12. **Configurar el tipo de cambio** USD → MN para mostrar precios en moneda nacional.
13. **Respaldar y restaurar** todos los datos del sistema como archivos JSON.

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
| **tesseract.js** v7 | OCR para lectura de precios en imágenes |

### Frontend
| Tecnología | Uso |
|-----------|-----|
| **JavaScript Vanilla** (ES Modules) | Sin frameworks |
| **HTML5** | Estructura semántica |
| **CSS3** (nativo) | Sin preprocesadores |
| **Canvas API** | Generación de imágenes 1080x1080 |
| **IndexedDB** | Caché offline en navegador |
| **jsPDF** + jsPDF-AutoTable | Generación de reportes PDF |
| **JSZip** | Empaquetado ZIP para descarga masiva de imágenes |

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
│  │  │         │   Publications, Exports,   │   │
│  │  │         │   Import, Backup,          │   │
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
│  ┌──────────┐  ┌──────────────────────┐     │
│  │ Tesseract│  │  Pollinations API    │     │
│  │ (OCR)    │  │  (imágenes IA)       │     │
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
├── electron/
│   └── main.js                # Placeholder para aplicación Electron (próximamente)
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
│   │   ├── imageUtils.js       # Conversión de imágenes a WebP con sharp
│   │   └── ocr.js              # OCR con tesseract.js + fuzzy matching
│   ├── routes/
│   │   ├── products.js        # CRUD productos + visibilidad
│   │   ├── providers.js       # CRUD proveedores
│   │   ├── sales.js           # CRUD ventas + PATCH estado
│   │   ├── categories.js      # CRUD categorías
│   │   ├── publications.js    # CRUD publicaciones + publicar en FB/IG + reorder
│   │   ├── exports.js         # CRUD historial de exportaciones
│   │   ├── import.js          # Análisis OCR + aplicación de precios
│   │   ├── images.js           # Importación de imágenes generadas con IA
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
│       │   ├── utils.js       # formatUSD, formatMN, formatCommission, fechas, IDs, debounce, extractSlogan
│       │   ├── imageGenerator.js  # Motor Canvas para imágenes 1080x1080 (5 plantillas)
│       │   └── pdfGenerator.js    # Generador de PDF con jsPDF
│       ├── lib/
│       │   ├── jspdf.umd.min.js           # jsPDF
│       │   ├── jspdf.plugin.autotable.min.js  # jsPDF AutoTable
│       │   └── jszip.min.js               # JSZip
│       └── views/
│           ├── loginView.js          # Pantalla de inicio de sesión
│           ├── dashboardView.js      # Estadísticas y gráficos
│           ├── productsView.js       # CRUD productos + filtros + imágenes + IA
│           ├── providersView.js      # CRUD proveedores
│           ├── salesView.js          # CRUD ventas + cálculo comisiones
│           ├── publicationsView.js   # CRUD publicaciones + publicar en FB/IG
│           ├── catalogImagesView.js  # Generador de catálogo público
│           ├── settingsView.js       # Configuración general
│           ├── backupView.js         # Exportar/restaurar datos
│           ├── exportsView.js        # Panel de exportaciones (PDF + imágenes)
│           ├── exportsNewView.js     # Nueva exportación PDF
│           ├── exportsConfigView.js  # Configuración de exportaciones
│           ├── exportsImagesView.js  # Generador de imágenes promocionales
│           └── importView.js         # Importar/sincronizar precios con OCR
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
| `commission_value` | REAL | Comisión fija por unidad |
| `commission_currency` | TEXT | Moneda de la comisión: "USD" o "MN" (hereda del proveedor) |
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
| `commission_currency` | TEXT | Moneda de comisión: "USD" o "MN" |
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

> El backend **recalcula** `total_amount` y `commission_amount` al crear/editar ventas, ignorando los valores enviados por el cliente. La `commission_currency` se toma del producto al momento de crear la venta.

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
| `GET` | `/api/publications` | Listar publicaciones (ordenadas por `sort_order` y `publication_date`) |
| `GET` | `/api/publications/:id` | Obtener publicación por ID |
| `POST` | `/api/publications` | Crear publicación (asocia a producto, almacena texto e imágenes) |
| `PUT` | `/api/publications/:id` | Actualizar publicación |
| `PATCH` | `/api/publications/reorder` | Reordenar publicaciones (`{ "order": ["id1", "id2", ...] }`) |
| `POST` | `/api/publications/:id/publish` | Publicar en Facebook o Instagram |
| `DELETE` | `/api/publications/:id` | Eliminar publicación |

**Campos de publicación:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `product_id` | TEXT | ID del producto asociado (opcional) |
| `product_name` | TEXT | Nombre del producto (auto-generado) |
| `publish_text` | TEXT | Texto de la publicación |
| `images` | TEXT | Array JSON de URLs de imágenes |
| `publication_date` | TEXT | Fecha de publicación |
| `sort_order` | INTEGER | Orden de visualización |

### Exportaciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/exports` | Listar historial de exportaciones |
| `GET` | `/api/exports/:id` | Obtener exportación por ID |
| `POST` | `/api/exports` | Crear registro de exportación |
| `DELETE` | `/api/exports/:id` | Eliminar exportación del historial |

**Campos de exportación:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `title` | TEXT | Título de la exportación |
| `style` | TEXT | Estilo: `table`, `list`, `clasica`, `moderna`, etc. |
| `kind` | TEXT | Tipo: `pdf` o `images` |
| `fields` | TEXT | Array JSON de campos incluidos |
| `product_ids` | TEXT | Array JSON de IDs de productos |
| `product_count` | INTEGER | Cantidad de productos |

### Importación / Sincronización

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/import/analyze` | Analizar imágenes de una carpeta con OCR (requiere `folder` y `provider_id`) |
| `POST` | `/api/import/apply` | Aplicar precios detectados a productos (actualiza precio y visibilidad) |

### Anuncios generados con IA

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/images/import` | Importar imágenes desde una carpeta (asociación automática por nombre) |
| `GET` | `/api/prompt-engine/families` | Listar familias y variantes creativas del motor de prompts |
| `POST` | `/api/prompt-engine/generate` | Generar prompt para un producto (rotación automática o familia/variante fija) |

### Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Estadísticas: totales, ingresos, comisiones (USD y MN por separado), ventas mensuales, top productos, ventas recientes, tipo de cambio |

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
- `ai`: Configuración de IA (`enabled`, `api_url`, `api_key`, `model`, `system_prompt`)
- `facebook`: Configuración de Facebook (`page_id`, `access_token`, `instagram_id`)

### Imágenes

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/upload` | Subir imagen (multer, 5MB máximo, conversión automática a WebP) |

### IA

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/generate-description` | Generar descripción de producto con IA |
| `POST` | `/api/generate-image` | Generar fondo de imagen con IA (Pollinations, gratuito) |

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
| `#/providers` | Proveedores | CRUD con información de contacto, moneda de comisión y conteo de productos |
| `#/sales` | Ventas | CRUD con cálculo automático de comisiones (USD/MN), seguimiento de entregas y filtros |
| `#/publications` | Publicaciones | CRUD de publicaciones con texto, imágenes, generación con IA, reordenamiento y publicación directa en Facebook/Instagram |
| `#/catalog-images` | Catálogo público | Generador de catálogo web estático + despliegue en GitHub Pages |
| `#/import` | Importar / Sincronizar | OCR de imágenes del proveedor, detección de precios, actualización masiva |
| `#/settings` | Configuración | Tipo de cambio, plantilla de publicación, configuración de IA, configuración de Facebook/Instagram, gestión de categorías |
| `#/backup` | Respaldos | Exportar e importar todos los datos del sistema como JSON |
| `#/exports` | Exportaciones | Generación de PDF, imágenes promocionales, historial de exportaciones |

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
- **Cálculo automático** de comisiones al registrar ventas (con soporte USD y MN)
- **Gestión de imágenes múltiples** — subida, URL, orden con drag-and-drop, conversión automática a WebP
- **Lightbox** para previsualización de imágenes a pantalla completa con navegación
- **Generación de descripciones con IA** — envía datos del producto a una API compatible con OpenAI
- **Generación de textos de publicación** con plantilla personalizable
- **Publicación directa** en páginas de Facebook y cuentas de Instagram
- **Backup/Restore** completo del sistema como archivos JSON

---

## Generador de Imágenes

El generador produce imágenes **1080x1080px** (formato estándar para Facebook e Instagram) con **5 plantillas** distintas:

### Plantillas disponibles

| Plantilla | Estilo | Descripción |
|-----------|--------|-------------|
| **Clásica** | Claro | Degradado claro, logo, círculo y barra de información |
| **Moderna** | Oscuro | Fondo oscuro con acento de color |
| **Minimal** | Limpio | Imagen grande y texto limpio |
| **Oferta** | Claro | Insignia OFERTA con precio destacado |
| **Postal DM** | Oscuro | Estilo DaniMarvis Store con gradiente azul-naranja |

### Características

- **Fondo con IA** — Genera fondos creativos gratuitos con Pollinations (sin token ni cuenta)
- **6 colores de acento** — Rosa, rojo, verde, azul, púrpura, naranja
- **Texto CTA configurable** — Personalizar texto del llamado a la acción
- **Logo configurable** — Mostrar/ocultar logo de la tienda
- **Vista previa en tiempo real** — Previsualizar antes de descargar
- **Descarga individual** — PNG de cada producto seleccionado
- **Descarga masiva ZIP** — Empaquetar todas las imágenes en un archivo ZIP

### Cómo usarlo

1. Ve a **Exportaciones** → pestaña **Imágenes** en el panel.
2. Selecciona los productos (filtros por categoría y búsqueda).
3. Elige la plantilla, colores y textos.
4. Opcionalmente genera un fondo con IA.
5. Previsualiza y descarga como PNG o ZIP.

Las imágenes se generan **100% en el cliente** usando Canvas API — no ocupan recursos del servidor.

---

## Exportaciones PDF

Permite generar reportes PDF de productos con personalización completa.

### Características

- **2 estilos de PDF** — Tabla simple (profesional compacto) o Lista detallada (un producto por bloque)
- **Selección de campos** — Producto, categoría, precio, proveedor, stock, descripción, garantía, comisión, estado
- **Filtros** — Buscar por nombre, filtrar por categoría
- **Selección masiva** — Seleccionar/deseleccionar todos los productos filtrados
- **Historial** — Cada generación se registra en el historial de exportaciones
- **Configuración persistente** — Estilo, campos y encabezado se guardan en localStorage

### Cómo usarlo

1. Ve a **Exportaciones** → pestaña **Nueva exportación**.
2. Filtra y selecciona los productos.
3. Elige los campos a incluir.
4. Haz clic en **Generar PDF**.
5. El PDF se descarga automáticamente y se registra en el historial.

---

## Importación / Sincronización OCR

Funcionalidad para actualizar precios y disponibilidad de productos a partir de las imágenes que publica el proveedor (listas de precios en foto).

### Flujo

1. **Configurar** — Elegir proveedor y carpeta donde se guardaron las imágenes (una por producto).
2. **Analizar** — El sistema lee cada imagen con OCR (tesseract.js), detecta el texto y busca coincidencia con los productos existentes. También detecta precios en USD.
3. **Revisar** — Para cada imagen se muestra: producto detectado (con % de coincidencia), precio detectado, precio actual y texto OCR. Se puede corregir manualmente.
4. **Aplicar** — Actualiza precios, define visibilidad en catálogo y elimina de la carpeta las imágenes ya procesadas. Opcionalmente oculta productos del proveedor que no aparecen en la lista.

### Características

- **OCR en español e inglés** con tesseract.js v7
- **Coincidencia fuzzy** — Algoritmo de matching que tolera errores de escritura y variaciones en nombres
- **Detección de precios** — Reconoce montos en USD con contexto (distingue precios de especificaciones técnicas)
- **Creación de productos** — Botón `+` para crear un producto nuevo directamente desde la imagen
- **Toggle de visibilidad** — Controlar si cada producto queda visible en el catálogo
- **Eliminación de imágenes procesadas** — Limpieza automática de la carpeta tras aplicar
- **Regenerar catálogo** — Botón para regenerar el catálogo público tras la sincronización

### Cómo usarlo

1. Ve a **Importar / Sincronizar** en el panel.
2. Selecciona el proveedor y la carpeta con las imágenes.
3. Haz clic en **Analizar imágenes**.
4. Revisa cada resultado, corrige si hace falta.
5. Marca los productos a actualizar y haz clic en **Aplicar seleccionados**.

---

## Anuncios generados con IA

El panel incluye un **motor de prompts** que construye el texto listo para generar anuncios publicitarios en **ChatGPT**, con identidad visual DaniMarvis, plantillas por familia creativa y rotación de variantes.

### Flujo

1. **Copiar prompt** — Junto a cada producto hay un botón 📋 que copia un prompt detallado para generar un anuncio publicitario. Incluye nombre del producto, precio, garantía y estilo visual.
2. **Generar en ChatGPT** — Usar el prompt copiado en ChatGPT para generar la imagen.
3. **Guardar** — Guardar la imagen generada en una carpeta local con el nombre sugerido (slug del producto).
4. **Importar** — Indicar la ruta de la carpeta y hacer clic en **Importar**. El sistema:
   - Copia las imágenes a `uploads/generated/`
   - Registra cada imagen en el historial de exportaciones
   - Opcionalmente asocia la imagen al producto (prepende en la galería)
   - Detecta el producto por coincidencia del nombre del archivo

### Cómo usarlo

1. Ve a **Exportaciones** → pestaña **Imágenes**.
2. Elige **Familia creativa** y **Variante** (o dejá **Automático** para que el sistema elija y rote variantes según el historial del producto).
3. Haz clic en 📋 junto al producto que querés anunciar.
4. Genera la imagen en ChatGPT.
5. Guarda la imagen en la carpeta indicada.
6. Importa la carpeta desde el panel.

### Estilos visuales de proveedor

Cada proveedor puede tener un **perfil de estilo visual** (`style_name`) que define paleta de colores, reglas de fondo, acentos, firma visual y restricciones. El prompt generado inyecta automáticamente ese bloque `[PROVIDER_STYLE]`.

| Código | Proveedor | `style_name` |
|--------|-----------|--------------|
| `GE` | MiPime Gabriel y Erika | `DANIMARVIS_G_ERIKA` |
| `EM` | TCP El Marinero | `DANIMARVIS_MARINERO` |
| `MM` | MiPimeMelani | `DANIMARVIS_MELANI` |

> **Badge de proveedor:** si la pieza incluye un badge o sello de proveedor (p. ej. en el header), los prompts instructan mostrar **solo el código** (`GE`, `EM`, `MM`, etc.), nunca el nombre completo. Aplica a todos los estilos y variantes.

### Familias creativas y variantes

| Familia | Propósito | Variantes |
|---------|-----------|-----------|
| **A — HERO** | Atención + presentación | A1 Front, A2 Angle, A3 Float |
| **B — CATALOG** | Información técnica | B1 Grid, B2 Minimal, B3 Detail |
| **C — OFFER** | Oportunidad + acción | C1 Block, C2 Strike, C3 Badge, C4 Flyer |
| **D — LIFESTYLE** | Deseo + experiencia | D1 Home, D2 Use, D3 Aspirational |

La variante **C4 — Flyer** genera piezas tipo folleto profesional: producto a la derecha con grid de características a la izquierda, precio destacado, badges de confianza y franja de features.

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
3. **Reordenar** — Cambiar el orden de las publicaciones con drag-and-drop.
4. **Publicar** — Envía la publicación a Facebook (Graph API) o Instagram.

### Configuración necesaria

En **Configuración** del panel, configura:

- **Facebook Page ID** e **Instagram Account ID**
- **Token de acceso** de Facebook (con permisos `pages_publish_posts` y `instagram_basic`, `instagram_content_publish`)
- **Plantilla de publicación** con placeholders: `{NAME}`, `{PRICE}`, `{DESCRIPTION}`, `{WARRANTY}`, `{CATEGORY}`, `{STOCK}`
- **Configuración de IA** (URL, clave, modelo, prompt) para generación automática de textos

---

## Sistema de Respaldos

Permite exportar e importar todos los datos del sistema.

### Exportar

1. Ve a **Respaldos** en el panel.
2. Haz clic en **"Exportar datos"**.
3. Se descarga un archivo JSON con todos los productos, proveedores, ventas, categorías, configuración, publicaciones y exportaciones.

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
Ingresa nombre, contacto, teléfono, email, información adicional y la **moneda de comisión** (USD o MN) en la que paga.

### 2. Registrar productos
```
Panel → Productos → Nuevo producto
```
Asocia cada producto a un proveedor. Define precio en USD, comisión fija por unidad (se hereda la moneda del proveedor, con opción de override个别), garantía y stock. Sube imágenes o ingresa URLs.

### 3. Configurar tipo de cambio
```
Panel → Configuración
```
Actualiza el valor de 1 USD en moneda nacional (MN). Se refleja en dashboard, ventas e imágenes promocionales.

### 4. Generar imágenes promocionales
```
Panel → Exportaciones → Imágenes
```
Elige plantilla, colores y textos. Genera fondos con IA si lo deseás. Descarga individual o masiva (ZIP).

### 5. Generar reportes PDF
```
Panel → Exportaciones → Nueva exportación
```
Selecciona productos, campos y estilo. Genera y descarga el PDF.

### 6. Sincronizar precios del proveedor
```
Panel → Importar / Sincronizar
```
Guarda las imágenes de listas de precios en una carpeta. El sistema lee precios con OCR y actualiza los productos.

### 7. Generar publicaciones
```
Panel → Publicaciones → Nueva publicación
```
Asocia un producto, genera el texto con IA o escríbelo manualmente, y publica directamente en Facebook o Instagram.

### 8. Generar catálogo público
```
Panel → Catálogo público → Generar catálogo
```
El servidor genera un catálogo web estático con todos los productos activos, imágenes y botón de WhatsApp. Luego haz commit y push a GitHub para actualizar GitHub Pages.

### 9. Registrar ventas
```
Panel → Ventas → Nueva venta
```
Selecciona el producto, ingresa datos del cliente. El sistema calcula automáticamente el total y la comisión en la moneda correspondiente (USD o MN según el producto).

### 10. Dar seguimiento
Actualiza el estado de entrega (pendiente → enviado → entregado) y marca comisiones como pagadas. Las comisiones pendientes se muestran por separado en USD y MN.

### 11. Respaldar datos
```
Panel → Respaldos → Exportar datos
```
Descarga un archivo JSON con todos los datos para tener un respaldo de seguridad.

### 12. Revisar dashboard
El dashboard muestra ingresos totales, comisiones pendientes (desglosadas por moneda: USD y MN), productos más vendidos y ventas mensuales.

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
- Agregar nuevas plantillas (objeto `TEMPLATE_DRAWERS`)

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
- [x] 5 plantillas de imágenes (Clásica, Moderna, Minimal, Oferta, Postal DM)
- [x] Fondo con IA gratuito (Pollinations)
- [x] 6 colores de acento configurables
- [x] Subida de imágenes al servidor con conversión automática a WebP
- [x] Gestión de múltiples imágenes por producto con drag-and-drop
- [x] Generación de catálogo web estático para GitHub Pages
- [x] Modo oscuro en el catálogo público
- [x] Enlace directo a WhatsApp por producto
- [x] Sistema de publicaciones con publicación directa en Facebook e Instagram
- [x] Reordenamiento de publicaciones
- [x] Generación de textos de publicación con IA (compatible OpenAI)
- [x] Plantilla de publicaciones personalizable
- [x] Sistema de respaldos (exportar/importar JSON)
- [x] Control de visibilidad de productos en catálogo público
- [x] Caché offline con IndexedDB
- [x] Configuración de tipo de cambio USD → MN
- [x] Exportación de reportes PDF (tabla y lista detallada)
- [x] Importación/sincronización de precios con OCR (tesseract.js)
- [x] Motor de prompts para anuncios con IA (familias, variantes y rotación)
- [x] Importación de imágenes generadas con IA (asociación automática por nombre)
- [x] Generación de imágenes con IA (Pollinations)
- [x] Descarga masiva de imágenes en ZIP (JSZip)
- [x] Selector de moneda de comisión (USD/MN) por proveedor con override个别 por producto

### Por implementar

- [ ] **Aplicación Electron** funcional para escritorio
- [ ] **Autenticación mejorada** con JWT y hashes de contraseñas
- [ ] **Múltiples gestores** con roles y permisos
- [ ] **Exportar reportes** a Excel/CSV
- [ ] **Panel de comisiones** por proveedor con resumen mensual y desglose por moneda
- [ ] **Notificaciones** cuando una venta cambia de estado
- [ ] **Integración con Facebook Catalog** para Dynamic Ads
- [ ] **Compartir módulo `escHtml()`/`escAttr()`** como utilidad centralizada
- [ ] **Unificar generación de IDs** en el backend para todos los recursos

---

## Licencia

Proyecto privado — DaniMarvis Store.
