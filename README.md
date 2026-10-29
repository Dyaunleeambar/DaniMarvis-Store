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
- [Reglas de Garantía (Warranty Rules)](#reglas-de-garantía-warranty-rules)
- [Anuncios generados con IA](#anuncios-generados-con-ia)
- [Catálogo Público (GitHub Pages)](#catálogo-público-github-pages)
- [Publicaciones en Redes Sociales](#publicaciones-en-redes-sociales)
- [Rutinas de Página (Page Routines)](#rutinas-de-página-page-routines)
- [Publicador automático de grupos](#publicador-automático-de-grupos)
- [Ranking de grupos (Biblioteca de Contenido)](#ranking-de-grupos-biblioteca-de-contenido)
- [Sistema de Respaldos](#sistema-de-respaldos)
- [Pruebas automáticas](#pruebas-automáticas)
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
7. **Reglas de garantía automáticas** — asignar texto de garantía por palabra clave según proveedor.
8. **Generar textos de publicación** con IA (compatible con OpenAI) usando plantillas personalizables.
9. **Publicar directamente en Facebook e Instagram** mediante la Graph API.
10. **Generar un catálogo web público** con todos los productos activos, filtros por categoría, búsqueda y botón directo a WhatsApp. Se despliega en GitHub Pages.
11. **Crear anuncios con IA (ChatGPT)** — copiar prompts generados por producto e importar los resultados.
12. **Rutinas de página recurrentes** — programar publicaciones automáticas en Página FB con horarios fijos y rotación de productos.
13. **Dar seguimiento** a entregas y comisiones pendientes.
14. **Configurar el tipo de cambio** USD → MN para mostrar precios en moneda nacional.
15. **Respaldar y restaurar** todos los datos del sistema como archivos JSON.
16. **Ranking de grupos por desempeño** — medir con la Biblioteca de Contenido de Facebook qué grupos devuelven más y menos visualizaciones por publicación, con historial consultable por fecha y evolución por grupo.
17. **Publicador automático en grupos** — cola de publicaciones que se publica sola en grupos de Facebook vía CDP (Chrome real), con dos cuentas, límites de ritmo y reintento automático.

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

# 2. Instalar dependencias (un único node_modules en la raíz del proyecto)
npm install

# 3. Iniciar el servidor desde la raíz del proyecto
npm start
# Alternativa con recarga automática:
npm run dev
```

El servidor arranca en `http://localhost:3456`. La base de datos SQLite se crea automáticamente en `backend/danimarvis.db` con un usuario administrador por defecto.

> Los scripts `npm run backup` y `npm run restore` (respaldo manual con rclone a Drive) también corren desde la raíz.

### Credenciales de Acceso

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |

---

## Estructura del Proyecto

```
DaniMarvisStore/
├── package.json               # Deps y scripts npm (único node_modules del proyecto, en la raíz)
├── scripts/
│   ├── generate-catalog.js    # Script CLI para regenerar el catálogo público
│   ├── check-imports.mjs      # Valida imports/exports en backend
│   ├── check-carga.mjs        # Carga real de vistas del frontend (DOM mínimo)
│   └── test-*.mjs             # Tests de comportamiento (20+ módulos)
├── public-catalog/
│   ├── index.html             # Catálogo web estático generado (GitHub Pages)
│   └── images/                # Imágenes de productos copiadas para el catálogo
├── utilidades/
│   └── fb-ranking/
│       ├── package.json                # type=commonjs (estos scripts usan require)
│       ├── content_library_views.js    # Scraper: filas de la Biblioteca de Contenido
│       ├── analyze_views.js            # Análisis alternativo por métricas del grid
│       ├── group_poster.js             # Poster en grupos vía CDP (Chrome)
│       ├── metodo_texto.js             # Técnicas de escritura en compositor
│       └── reporte_POC_fechas.json     # Salida del scraper (gitignored)
├── electron/
│   └── main.js                # Placeholder para aplicación Electron (próximamente)
├── backend/
│   ├── server.js              # Servidor Express (puerto 3456)
│   ├── danimarvis.db          # Base de datos SQLite (auto-creada)
│   ├── uploads/               # Imágenes subidas por los usuarios
│   ├── backups/               # Respaldos JSON (gitignored)
│   ├── db/
│   │   └── database.js        # Esquema, migraciones y seed de BD
│   ├── lib/
│   │   ├── accountConfig.js    # Config de 2 cuentas FB (A/B) con puertos/perfiles/proxy
│   │   ├── agendaEstado.js     # Estado persistente del disparador por fecha
│   │   ├── catalogGenerator.js # Generador de HTML estático del catálogo público
│   │   ├── chromeLauncher.js   # Auto-arranque de Chrome con puerto 9222 + perfil FB
│   │   ├── coordination.js     # Coordinación multi-instancia (A/B) para cursos/turnos
│   │   ├── currency.js         # Formateador de precios en USD
│   │   ├── duplicarDia.js      # Duplicar un día de la agenda y deshacerlo
│   │   ├── facebook.js         # Integración con Facebook Graph API
│   │   ├── groupPublisher/     # Publicador automático de grupos (split por responsabilidades)
│   │   │   ├── config.js       # Defaults y carga de publish_config
│   │   │   ├── estado.js       # running, current, lastResult, chrome check
│   │   │   ├── cola.js         # pickForRun, updateQueue, reencolado automático
│   │   │   ├── limites.js      # Límites del worker y del disparador (agenda)
│   │   │   ├── poster.js       # Lógica de publicación en grupo (CDP)
│   │   │   ├── schedulers.js   # Worker cron + disparador por fecha
│   │   │   ├── util.js         # Helpers compartidos
│   │   │   └── index.js        # Barrel export
│   │   ├── imageUtils.js       # Conversión de imágenes a WebP con sharp
│   │   ├── ocr.js              # OCR con tesseract.js + fuzzy matching
│   │   ├── pageRoutineWorker.js# Worker de rutinas recurrentes en Página FB
│   │   ├── plans.js            # Planificador de slots para rutinas de página
│   │   ├── promptEngine.js     # Motor de prompts para anuncios IA (familias/variantes)
│   │   ├── secrets.js          # Reconciliación API key (base ↔ .env)
│   │   ├── settingsMerge.js    # Merge profundo de publish_config
│   │   ├── transaccion.js      # Helper transacciones SQLite
│   │   ├── ventanas.js         # Gestión de ventanas/pestañas CDP
│   │   ├── vision.js           # Análisis visual (fallback OCR)
│   │   └── warranty.js         # Motor de reglas de garantía por palabra clave
│   ├── jobs/
│   │   └── dailyRanking.js     # Corrida diaria del ranking + estado en disco
│   ├── routes/
│   │   ├── agenda.js           # Agenda de grupos: calendario, duplicar/deshacer día, disparador
│   │   ├── backup.js           # Exportar/restaurar datos como JSON
│   │   ├── categories.js       # CRUD categorías
│   │   ├── coordination.js     # API coordinación multi-instancia (token dedicado)
│   │   ├── exports.js          # CRUD historial de exportaciones
│   │   ├── groupPublish.js     # API del publicador de grupos (202 + status)
│   │   ├── groups.js           # CRUD grupos FB + importación idempotente desde picker
│   │   ├── images.js           # Importación de imágenes generadas con IA
│   │   ├── import.js           # Análisis OCR + aplicación de precios
│   │   ├── pageRoutines.js     # Rutinas recurrentes en Página FB (horarios, formatos)
│   │   ├── products.js         # CRUD productos + visibilidad
│   │   ├── providers.js        # CRUD proveedores
│   │   ├── providerStyles.js   # Perfiles de estilo visual por proveedor (IA)
│   │   ├── pubQueue.js         # Cola de publicación simple (un destino por item)
│   │   ├── publications.js     # CRUD publicaciones + publicar en FB/IG + reorder
│   │   ├── rankingsRouter.js   # Ranking de grupos + historial (Biblioteca de Contenido)
│   │   ├── sales.js            # CRUD ventas + PATCH estado
│   │   ├── warrantyRules.js    # Reglas de garantía automáticas por keyword/proveedor
│   │   └── rankings.js         # (legacy) Ranking básico
│   └── scripts/
│       ├── backup.js           # Exportar backup JSON (CLI)
│       ├── generate-icon.js    # Generador de ícono PNG con canvas
│       └── restore-backup.mjs  # Restaurar backup JSON (CLI)
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
│           ├── settingsView.js       # Configuración general (cuentas FB, estilos, IA, etc.)
│           ├── backupView.js         # Exportar/restaurar datos
│           ├── exportsView.js        # Panel de exportaciones (PDF + imágenes)
│           ├── exportsNewView.js     # Nueva exportación PDF
│           ├── exportsConfigView.js  # Configuración de exportaciones
│           ├── exportsImagesView.js  # Generador de imágenes promocionales
│           ├── importView.js         # Importar/sincronizar precios con OCR
│           ├── pageRoutinesView.js   # Rutinas recurrentes en Página FB
│           └── rankingsView.js       # Ranking del día + historial por fecha
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

### Publicador automático de grupos

Publica la cola en grupos de Facebook vía CDP (navegador), no por Graph API.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/group-publish/status` | Estado: `running`, `chrome`, `config`, `current`, `lastResult` |
| `POST` | `/api/group-publish/run` | Dispara las vencidas. **202** con `runId` |
| `POST` | `/api/group-publish/run/:id` | Dispara un ítem puntual. **202** con `runId` |

> Las dos rutas de disparo responden **202 al toque** y el trabajo sigue en background. El resultado no viene en la respuesta: hay que consultarlo en `/status`. Antes la ruta esperaba el run entero, y como el poster tiene `--max-seconds=600` con 45-135s entre posts, eso son minutos de request colgado.

**Payload de `POST /run`:** `{ mode?: "publish"|"prepare", force?: boolean, ids?: string[] }`

**Códigos de respuesta:** `202` aceptada · `409` (`skipped`) ya hay una corrida en curso, o auto-publicado deshabilitado.

**Campos de `GET /status`:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `running` | boolean | Hay una corrida en curso |
| `chrome` | boolean | Hay Chrome escuchando en el 9222 (sondeo real, no estimado) |
| `config` | object | Config de auto-publicado activa |
| `current` | object \| null | Progreso en vivo: `runId`, `phase`, `total`, `done`, `ok`, `errors`, `current_group`, `results[]`, `elapsed_s`, `sesion`, `noBrowser` |
| `lastResult` | object \| null | Resultado de la última corrida terminada |

`phase` es `starting` → `starting_chrome` → `picking` → `publishing` → `waiting` → `done` (o `empty` / `error`).

Los flags `sesion` y `noBrowser` distinguen *por qué* falló: **sesión de Facebook vencida** (hay muro de login) o **no hay Chrome escuchando**. Antes todo se reportaba como un `error` genérico.

### Agenda de grupos (disparador por fecha)

Es el **seguro del publicador**: publica solo lo que ya venció, con límites de ritmo. A diferencia del worker de la cola, este camino **no pasa por `pickForRun()`** — entrega los vencidos con `ids` explícitos — así que los límites de abajo son los únicos que lo frenan.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/agenda` | Calendario del mes: `disparador` (estado del tick + `limites`), `eventos`, `huerfanos`, `server_now` |
| `GET` | `/api/agenda/conflicts` | Avisos de publicaciones que se pisan en la misma franja y grupo |
| `GET` | `/api/agenda/uso-dia` | Cuánto se usó del día (publicaciones por grupo/hora) |
| `GET` | `/api/agenda/rotacion-grupos` | Cómo viene la rotación de grupos del lote |
| `POST` | `/api/agenda/:id/run` | Publicar un evento ahora, salteando la espera |
| `POST` | `/api/agenda/:id/retry` | Reintentar un evento |
| `GET` | `/api/agenda/duplicar-dia` | Plan de duplicar un día: `duplicadas`, `conflictos`, `avisos`, `ya_duplicada` |
| `POST` | `/api/agenda/duplicar-dia` | Duplica un día completo (o lo que se tilde) hacia otro día |
| `POST` | `/api/agenda/duplicar-dia/deshacer` | **Deshacer** una duplicación: borra lo que no se publicó y conserva lo que sí |

**`GET /agenda` → `disparador.limites`** dice por qué no salió nada, sin abrir el log:

| Campo | Descripción |
|-------|-------------|
| `decision` | `ok` \| `gap` \| `tope_hora` \| `breaker` |
| `motivo` | Texto legible del motivo, ej. `separación mínima de 15 min: faltan 12 min` |
| `intentos_ultima_hora` | Intentos (no aciertos) en la última hora |
| `corte_hasta` | Hasta cuándo queda pausado el disparador por fallos seguidos |

**`POST /duplicar-dia/deshacer`** — payload `{ "clones": ["id", ...] }`. Borra los destinos **no publicados** de esas copias y, si una copia no tiene ningún post publicado, borra también la publicación y su vínculo con el día de origen. Si sí tiene historial, la conserva con lo publicado y lo deja anotado en el motivo. Es idempotente: repetirlo no borra el historial.

> Deshacer **no** puede deshacer un post que ya salió en Facebook. Solo limpia la cola.

**Tiempo real en el calendario.** El estado de los eventos (pendiente → publicado/vencida) cambia en el servidor cada minuto que corre el disparador, pero la vista de Publicaciones no depende de que el usuario recargue: `publicationsView.js` deja un `setInterval` de 45 s que llama a `/api/agenda` y **repinta solo si algo cambió** (compara una firma de los eventos y del disparador, ignorando `server_now`/`next_due_at` para no repintar por un timestamp). El refresh se salta cuando la pestaña está oculta o hay un modal abierto, y el `cleanup` que devuelve `render()` lo limpia el router al navegar fuera. No hay WebSocket: el polling es suficiente porque el disparador corre cada minuto.

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
| `GET` | `/api/dashboard` | Estadísticas: totales, ingresos (comisiones cobradas de ventas no canceladas, USD y MN por separado: `income_commissions_usd` / `income_commissions_mn`), comisiones pendientes, ventas mensuales, top productos, ventas recientes, tipo de cambio |

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

### Ranking de grupos (Biblioteca de Contenido)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/rankings` | Ranking actual desde `reporte_POC_fechas.json` (Top 20 + fondo 10) |
| `POST` | `/api/rankings/refresh` | Ejecuta el scraper (`body: { date, range, desde, hasta }`) y guarda el snapshot del día en `ranking_history` |
| `GET` | `/api/rankings/history` | Fechas con historial disponible (grupos/vistas/posts por fecha) |
| `GET` | `/api/rankings/history/:date` | Top 20 / Bottom 20 de una fecha (`YYYY-MM-DD`) |
| `GET` | `/api/rankings/history/group/:name` | Evolución día a día de un grupo |

> El snapshot se almacena en la tabla `ranking_history` con clave `(fecha, grupo)` — un único snapshot por día (re-ejecutar el mismo día lo reemplaza).

---

### Rutinas de Página (Page Routines)

Publicación recurrente programada en una **Página de Facebook** (no en grupos). Permite definir rutinas con horarios fijos, formato de imagen y selección de productos.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/page-routines` | Listar rutinas (incluye `last_scheduled` del log) |
| `POST` | `/api/page-routines` | Crear rutina (`name`, `products[]`, `times[]`, `default_text`, `format`, `lead_minutes`, `active`) |
| `PUT` | `/api/page-routines/:id` | Actualizar rutina completa |
| `PATCH` | `/api/page-routines/:id/active` | Activar/desactivar rutina |
| `DELETE` | `/api/page-routines/:id` | Eliminar rutina (cancela posts programados pendientes) |
| `GET` | `/api/page-routines/logs` | Historial de programación (`routine_id`, `status`, `limit`) |
| `GET` | `/api/page-routines/test` | Test de configuración: valida token, página y muestra slots futuros |
| `POST` | `/api/page-routines/run-now` | Ejecutar ciclo de programación manualmente |
| `DELETE` | `/api/page-routines/logs/:logId` | Cancelar post programado (elimina en Meta si está `scheduled`) |

**Configuración necesaria** en `publish_config.facebook` (`page_id`, `access_token`). El worker (`pageRoutineWorker.js`) corre cada minuto y agenda posts con `lead_minutes` de antelación (mínimo 11 min). Formatos soportados: `1:1`, `4:5`, `9:16`.

---

### Reglas de Garantía (Warranty Rules)

Asignación automática de texto de garantía a productos según **palabras clave** por proveedor. Al crear/editar un producto, si su nombre contiene una keyword configurada, se sugiere/aplica la garantía correspondiente (la más larga que coincida).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/warranty-rules` | Listar reglas (`provider_id` opcional) |
| `POST` | `/api/warranty-rules` | Crear regla (`provider_id`, `keyword`, `warranty_text`) |
| `POST` | `/api/warranty-rules/bulk` | Crear/actualizar en lote (`provider_id`, `rules[]`) |
| `POST` | `/api/warranty-rules/match` | Probar coincidencia (`provider_id`, `product_name`) → devuelve `warranty` y `matched` |
| `DELETE` | `/api/warranty-rules/:id` | Eliminar regla |
| `DELETE` | `/api/warranty-rules/provider/:provider_id` | Eliminar todas las reglas de un proveedor |

---

### Estilos de Proveedor (Provider Styles)

Perfiles de **estilo visual para generación de imágenes con IA** por proveedor. Cada estilo define paleta, reglas de fondo/acento/firma/negativo/envío y un `style_name` que inyecta el motor de prompts.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/provider-styles` | Listar estilos (palette parseado) |
| `GET` | `/api/provider-styles/:code` | Obtener estilo por código |
| `POST` | `/api/provider-styles` | Crear (`code`, `name`, `style_name`, `palette`, `background_rules`, `accent_rules`, `signature_rules`, `negative_rules`, `shipping_rule`) |
| `PUT` | `/api/provider-styles/:code` | Actualizar estilo |
| `DELETE` | `/api/provider-styles/:code` | Eliminar (bloqueado si hay proveedores usándolo) |

Los proveedores referencian el estilo vía `provider_style_code`. Códigos actuales: `GE`, `EM`, `MM`.

---

### Grupos de Facebook (Groups)

CRUD de grupos para el publicador automático, con **importación idempotente** desde el picker de Facebook (clave `fb_id`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/groups` | Listar grupos (ordenados por `sort_order`) |
| `POST` | `/api/groups` | Crear grupo manual (`name`, `url`) |
| `POST` | `/api/groups/import` | Importar lote desde picker (`groups[]` con `name`, `url`, `fb_id`) — idempotente por `fb_id` |
| `PUT` | `/api/groups/:id` | Actualizar grupo |
| `PATCH` | `/api/groups/reorder` | Reordenar (`order: string[]`) |
| `DELETE` | `/api/groups/:id` | Eliminar grupo |

---

### Coordinación Multi-Instancia

API interna para coordinar **dos servidores (A y B)** que comparten la cola de publicación en grupos. Protegida con header `X-Coord-Token` (variable `COORD_TOKEN`). Solo expuesta en la instancia coordinadora (`COORD_URL` no seteado).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/coordination/estado` | Estado completo del coordinador |
| `POST` | `/api/coordination/turno/claim` | Reclamar turno para una cuenta (`account`, `leaseMs`) |
| `POST` | `/api/coordination/turno/release` | Liberar turno (`account`) |
| `GET` | `/api/coordination/lote` | Cursor actual del lote de grupos |
| `POST` | `/api/coordination/lote/commit` | Avanzar cursor (`ultimo` grupo procesado) |
| `GET` | `/api/coordination/destinos` | Previsualizar próximos N destinos (`n`) |
| `POST` | `/api/coordination/destinos/advance` | Avanzar destinos manualmente (`k`) |
| `GET` | `/api/coordination/catalogo` | Catálogo completo de grupos para reparto |
| `POST` | `/api/coordination/distribuir` | Repartir slots en ventana (`ini`, `fin`, `cantidad`, `minGapMs`) |

---

### Cola de Publicación (Publication Queue)

Cola simplificada que alimenta al publicador de grupos: **un solo destino por ítem**.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/publication-queue` | Listar toda la cola (con texto, imágenes, producto) |
| `GET` | `/api/publication-queue/due` | Ítems vencidos/listos (`status=pending`, `scheduled_at <= now`) |
| `POST` | `/api/publication-queue` | Encolar (`publication_id`, `group_name`/`group_url`/`group_ids`, `variant_text`, `scheduled_at`, `images`) |
| `PATCH` | `/api/publication-queue/:id` | Actualizar (`status`, `notes`, `variant_text`, `images`) |
| `DELETE` | `/api/publication-queue/:id` | Eliminar de la cola |

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
| `#/page-routines` | Rutinas de Página | Programación recurrente de posts en Página FB (horarios, formatos, productos) |
| `#/settings` | Configuración | Tipo de cambio, plantilla de publicación, configuración de IA, cuentas FB (A/B), estilos de proveedor, categorías |
| `#/backup` | Respaldos | Exportar e importar todos los datos del sistema como JSON |
| `#/exports` | Exportaciones | Generación de PDF, imágenes promocionales, historial de exportaciones |
| `#/rankings` | Ranking grupos | Top y menos grupos por visualizaciones + historial por fecha |

### Funcionalidades

- **Autenticación** con token Bearer en sessionStorage
- **Toast notifications** para feedback de acciones
- **Modales** para formularios de creación/edición
- **Diálogos de confirmación** (`confirmDialog`) para eliminar registros o descartar cambios sin guardar
- **Protección de formularios** — al cerrar el modal con datos modificados se pide confirmación. En Publicaciones cubre el Planificador, **Duplicar día**, **Reprogramar**, **Distribuir en el día** y **Gestionar grupos** (un `setModalCloseGuard` que compara un snapshot de los campos editables; si no cambió nada, cierra sin preguntar)
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

## Reglas de Garantía (Warranty Rules)

Asignación **automática de texto de garantía** a productos según **palabras clave** configuradas por proveedor. Cuando se crea o edita un producto, el sistema sugiere/aplica la garantía correspondiente si el nombre del producto contiene alguna keyword (gana la coincidencia más larga).

### Cómo funciona

1. **Configurar reglas** — En `#/settings` (pestaña Garantías) o vía API:
   - Seleccionar proveedor
   - Definir **palabra clave** (ej: "nevera", "lavadora", "split")
   - Definir **texto de garantía** completo (ej: "Garantía 12 meses compresor + 3 meses partes")

2. **Aplicación automática** — Al guardar un producto:
   - El backend busca reglas del proveedor del producto
   - Si el nombre del producto contiene la keyword (case-insensitive), se sugiere la garantía
   - Si hay múltiples coincidencias, **gana la keyword más larga** (más específica)
   - El usuario puede aceptar o sobrescribir

3. **Endpoint de prueba** — `POST /api/warranty-rules/match` permite testear qué garantía aplicaría a un nombre dado sin guardar.

### Características

- **Por proveedor** — Cada proveedor tiene sus propias reglas (un proveedor de neveras no pisa al de aires)
- **Carga masiva** — `POST /bulk` permite subir muchas reglas a la vez (CSV → JSON → import)
- **Idempotente** — Re-importar la misma regla actualiza el texto si cambió, no duplica
- **Eliminación en cascada** — `DELETE /provider/:provider_id` limpia todas las reglas de un proveedor

### Ejemplo

| Proveedor | Keyword | Garantía aplicada |
|-----------|---------|-------------------|
| Frigidaire | `nevera` | `Garantía 12 meses compresor / 3 meses partes / 1 mano de obra` |
| Frigidaire | `nevera no frost` | `Garantía 24 meses compresor no frost / 12 meses partes` |
| Mabe | `lavadora` | `Garantía 10 años motor / 2 años partes` |

Si el producto se llama "Nevera No Frost 300L", coincide con ambas keywords de Frigidaire → **gana "nevera no frost"** (más larga).

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

### Estilos visuales de proveedor (Provider Styles)

Perfiles completos de **estilo visual para generación de imágenes con IA** por proveedor. Se gestionan en `#/settings` (pestaña **Estilos**) y vía API `/api/provider-styles`. Cada estilo inyecta un bloque `[PROVIDER_STYLE]` estructurado en los prompts del motor de anuncios.

#### Estructura de un estilo

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `code` | STRING | Código corto único (ej: `GE`, `EM`, `MM`). Clave foránea en `providers.provider_style_code`. |
| `name` | STRING | Nombre legible (ej: "MiPime Gabriel y Erika"). |
| `style_name` | STRING | Identificador interno para el motor de prompts (ej: `DANIMARVIS_G_ERIKA`). |
| `palette` | JSON | Paleta de colores: `primary`, `secondary`, `accent`, `background`, `text`, `badge_bg`, `badge_text`. |
| `background_rules` | TEXT | Reglas de fondo: texturas, gradientes, ambientes, restricciones. |
| `accent_rules` | TEXT | Reglas de acentos: bordes, sombras, highlights, elementos decorativos. |
| `signature_rules` | TEXT | Firma visual: logo placement, watermark, tagline, posición. |
| `negative_rules` | TEXT | Restricciones: qué NO hacer (colores prohibidos, estilos vetados, elementos禁用). |
| `shipping_rule` | TEXT | Regla de envío/entrega a incluir en el copy visual.

#### Códigos actuales

| Código | Proveedor | `style_name` |
|--------|-----------|--------------|
| `GE` | MiPime Gabriel y Erika | `DANIMARVIS_G_ERIKA` |
| `EM` | TCP El Marinero | `DANIMARVIS_MARINERO` |
| `MM` | MiPimeMelani | `DANIMARVIS_MELANI` |

> **Badge de proveedor:** si la pieza incluye un badge o sello de proveedor (p. ej. en el header), los prompts instructan mostrar **solo el código** (`GE`, `EM`, `MM`, etc.), nunca el nombre completo. Aplica a todos los estilos y variantes.

#### Gestión

- **Crear/Editar** — Formulario en Settings con campos de texto largo para reglas y color picker para paleta.
- **Validación** — No se puede eliminar un estilo si hay proveedores usándolo (error 409).
- **Herencia** — El proveedor referencia el estilo vía `provider_style_code`; al generar prompt, se mergea la config del estilo con la familia/variante elegida.

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

- **Grid de productos** con imagen principal, nombre, precio en USD, características esenciales y botón "Consultar" vía WhatsApp.
- **Lista de características** — la descripción del producto se muestra como lista con viñetas: en la tarjeta solo las características esenciales (hasta 3 + "…"), y en el modal la lista completa.
- **Vista aumentada (lightbox/zoom)** — botón de lupa y clic sobre la imagen del modal abren la imagen en pantalla completa; permite hacer zoom y arrastrar para inspeccionar detalles. Se cierra con `Esc`, clic fuera o el botón "×".
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

Escribe `public-catalog/index.html` leyendo `backend/danimarvis.db` y exportando solo los productos `status = 'active'` y `catalog_visible = 1`:

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

## Rutinas de Página (Page Routines)

Programación **recurrente de publicaciones en una Página de Facebook** (no en grupos). Ideal para mantener presencia constante sin intervención manual diaria.

### Cómo funciona

1. **Crear rutina** — En `#/page-routines` se define:
   - **Nombre** identificativo
   - **Productos** a rotar (lista específica o *"todos los activos"*)
   - **Horarios** fijos (formato `HH:MM`, múltiples por día)
   - **Texto base** de la publicación (usa la misma plantilla que Publicaciones)
   - **Formato de imagen**: `1:1` (cuadrado), `4:5` (retrato), `9:16` (stories/reels)
   - **Antelación** (`lead_minutes`): minutos antes del horario para programar en Meta (mínimo 11 min)
   - **Activa/Inactiva**: interruptor para pausar sin borrar

2. **Worker automático** — Cada minuto, `pageRoutineWorker.js` revisa rutinas activas y agenda en Meta los slots que caen dentro de la ventana de `lead_minutes`. Usa `facebook.js` (Graph API) para crear *unpublished posts* programados.

3. **Rotación de productos** — Si la rutina tiene múltiples productos, el worker rota secuencialmente (round-robin) guardando el índice en `publish_config.page_routine_cursor` para que sea persistente entre reinicios.

4. **Logs** — Cada programación queda registrada en `page_schedule_log` con estado `scheduled`/`published`/`cancelled`/`failed`, permitiendo auditoría y cancelación manual.

### Características

- **Graph API nativa** — No usa CDP/Chrome; publica directo via `/{page_id}/published_posts` con `published=false` y `scheduled_publish_time`.
- **Múltiples horarios por día** — Ej: `09:00, 14:30, 20:00` todos los días.
- **Formatos adaptados** — El generador de imágenes (Canvas) produce el tamaño correcto según el formato elegido.
- **Test integrado** — Botón "Probar" valida token, página y muestra los próximos slots que se programarían.
- **Ejecución manual** — Botón "Correr ahora" fuerza un ciclo del worker fuera de su horario.
- **Cancelación** — Desde el log se puede cancelar un post programado (llama a `DELETE /{post_id}` en Graph API).

### Configuración necesaria

En **Configuración → Facebook**:
- `page_id`: ID de la Página (no perfil personal)
- `access_token`: Token de larga duración con `pages_publish_posts`, `pages_read_engagement`

> ⚠️ El token debe ser de **Página** (Page Access Token), no de usuario. Se obtiene en Graph API Explorer seleccionando la página tras autenticar la app.

---

## Publicador automático de grupos

La cola de publicaciones (`publication_queue`) puede publicarse sola en grupos de Facebook. A diferencia de la publicación por Graph API (que va a tu Page), esto **escribe en la interfaz del grupo** como un usuario: usa un Chrome real controlado por CDP.

### Cómo funciona

1. **Chrome** — `backend/lib/chromeLauncher.js` (`ensureDebugChrome`) garantiza un Chrome con `--remote-debugging-port=9222` y el perfil de `C:\Users\Dani\fb-leave\fb-debug-perfil`. Si el puerto ya responde devuelve `already_running` y **no relanza ni toca nada** (no interfiere con tu Chrome personal ni con el scraper de rankings). Si no, lo arranca y espera hasta 45s.
2. **Poster** — por cada ítem, `utilidades/fb-ranking/group_poster.js` abre el grupo en una pestaña, escribe el texto, adjunta imágenes y hace clic en Publicar. Después del clic **espera a que el envío termine de verdad** antes de cerrar la pestaña: el compositor se vacía apenas se hace clic, pero con imágenes Facebook sigue subiendo, y cerrar ahí abortaba el post ("la pestaña se cierra mientras publica").
3. **Cola** — `updateQueue` marca el ítem como `published`/`prepared`, deja el post en `pending_approval` si el grupo pide aprobación del administrador, y anota el resultado en `notes`.
4. **Ritmo** — entre posts consecutivos hay una separación aleatoria de 45-135s para simular flujo humano.

### El perfil no es incógnito

Usa `--user-data-dir` con un **perfil separado y persistente**, no `--incognito`. Es lo que permite conservar la sesión de Facebook entre corridas. Efecto práctico parecido al del Chrome personal (no lo toca, no lo cierra), pero el estado vive en otra carpeta.

### Dos cuentas de Facebook (A y B)

El publicador puede trabajar con **dos cuentas de Facebook** desde el **mismo proceso**: cada corrida publica con una sola cuenta, y con ella se abre su Chrome, su perfil (su sesión de Facebook) y su proxy. Así las dos cuentas tienen IP distinta (vía `PROXY_SERVER` por cuenta) y sesiones de Facebook separadas.

Se configuran en **Ajustes → "Cuentas de Facebook (A y B)"**, sin tocar variables de entorno ni reiniciar:

| Campo | Qué es |
|-------|--------|
| **Cuenta que publica** | `alternado` (una corrida A, la siguiente B), o fijar `A` / `B` |
| **Nombre / etiqueta** | Cómo se muestra la cuenta en los modales |
| **Puerto de depuración de Chrome** | Puerto CDP de esa cuenta (`9222` para A, `9223` para B). Deben ser **distintos**. |
| **Perfil de Chrome** | Ruta del `--user-data-dir` donde vive la sesión de Facebook de esa cuenta. Deben ser **distintas** (dos Chrome no comparten perfil). |
| **Proxy** | Opcional. Le da a esa cuenta una IP de salida distinta. Vacío = IP de la máquina. |
| **Perfil de Facebook** | Opcional. URL/nombre del perfil que debería tener logueado esa carpeta (p. ej. `profile.php?id=61591067843509`). Se usa para **verificar**, no para loguear. Vacío = no se verifica. |

**Precedencia**: lo guardado en Ajustes **gana**; si un campo está vacío se usa la variable de entorno (`ACCOUNT_ID`, `FB_DEBUG_PORT`, `FB_DEBUG_PROFILE`, `PROXY_SERVER`); y si tampoco hay, el default histórico (A: perfil `C:\Users\Dani\fb-leave\fb-debug-perfil`, 9222; B: `...-b`, 9223). El entorno solo aplica a la cuenta que declara `ACCOUNT_ID` (por defecto A), así que los defaults de A no se le cuelan a B.

Defaults por cuenta (`backend/lib/accountConfig.js`, `ACCOUNT_DEFAULTS`):

| Cuenta | Puerto | Perfil |
|--------|--------|--------|
| A | `9222` | `C:/Users/Dani/fb-leave/fb-debug-perfil` |
| B | `9223` | `C:/Users/Dani/fb-leave/fb-debug-perfil-b` |

La cuenta activa se ve en `GET /api/status` (`account`, `label`, `cuentas[]`, `modo`) y en los modales de **Distribuir en el día** y **Duplicar día a otro** (rótulo "Cuenta …").

**La app NO inicia sesión en Facebook.** El login (usuario, contraseña, 2FA, captcha) lo hace el usuario a mano una vez por cuenta; automatizarlo viola los términos de Facebook y es lo que dispara bloqueos. Lo que la app sí hace:

- **Abrir Chrome para loguear** (botón en Ajustes → `POST /api/group-publish/accounts/:id/open`): lanza el Chrome de esa cuenta con su perfil/puerto/proxy en el login de Facebook. Tras abrir, consulta qué perfil quedó logueado.
- **Verificar la sesión** (botón o `GET /api/group-publish/accounts/:id/profile`): conecta por CDP, navega a `facebook.com/me` y lee la URL final (`profile.php?id=…`). Compara con el campo **Perfil de Facebook** y muestra **OK** o **OJO: logueado como …**.
- **Verificación al publicar**: si la cuenta tiene un perfil configurado, antes de cada corrida se compara la sesión abierta contra ese perfil. Es **informativo**: si no coincide o no hay sesión, se avisa en el log y en `/status` (`current.account_profile_check`), pero **no se aborta** la publicación.

El perfil configurado se normaliza (`normalizarFbProfile` en `accountConfig.js`): acepta el id pelado, `profile.php?id=…`, la URL completa o `facebook.com/usuario`, y guarda siempre una URL canónica para poder comparar. Sin perfil configurado no se abre ninguna pestaña extra ni se verifica.

### Cómo se mete el texto (técnica configurable)

El compositor de Facebook es un editor **Lexical** que no acepta un `value`: hay que "escribirle" el texto de alguna forma. La técnica se elige en **Ajustes → "Técnica de texto"** (`publish_config.metodo_texto`, por defecto `teclado`) y se aplica **por corrida**, sin reiniciar.

| Técnica | Cómo | Tiempo típico (post largo) | Estructura que deja |
|---------|------|---------------------------|---------------------|
| `teclado` (default) | `Keyboard.type` char a char + un Enter por línea | **~21 s / hasta 93 s** en el post más largo | muchos `<p>` (uno por línea) |
| `insertText` | `Input.insertText` con el texto completo de una vez | ~1 s | **un solo `<p>`** con `\n` literales |
| `ctrlv` | Escribe el portapapeles y pulsa **Ctrl+V** real | ~1 s | muchos `<p>` |
| `pasteEvent` | Dispara un evento `paste` **sintético** con `DataTransfer` | ~1 s | muchos `<p>` (idéntico a Ctrl+V) |

Motivo de que exista: el `teclado` tarda hasta 93 s en un solo post, lo que se come un tercio del presupuesto de 300 s por grupo y alimenta los fallos `Protocol error (Input.dispatchKeyEvent): Target closed` y `Attempted to use detached Frame` (menos eventos de teclado = menos chances de que se caiga la pestaña a mitad).

Se midió en un grupo real (06-10-2026, sin publicar) y se concluyó:

- **`insertText` es exacto** en `innerText` pero cambia la estructura (un solo `<p>` con `\n`); **no se sabe todavía si Facebook respeta esos saltos al publicar**, así que no es el principal.
- **`ctrlv` y `pasteEvent` dejan el MISMO DOM** (muchos `<p>`, igual que producción), pero `ctrlv` **comparte el portapapeles del sistema**: se probó a propósito con otro texto y el compositor recibió **solo 59 caracteres ajenos** (la contaminación es real). Por eso el poster **relee el portapapeles después de escribirlo y aborta si no coincide** (`clipboardOk`).
- **`pasteEvent` da el mismo resultado que Ctrl+V real, en ~1 s, y NO toca el portapapeles** → es la técnica recomendada para probar.

El poster aplica la técnica y **verifica el compositor** (texto completo y saltos presentes) con `metricasDeInfo`/`verificarTexto`/`saltosPerdidos` (`utilidades/fb-ranking/metodo_texto.js`). Si la técnica elegida no dejó el texto, **cae a `teclado`** y lo deja anotado (`event: metodo-fallo`); si tampoco, es error. La técnica usada viaja en el resultado (`metodo_texto`) y en un `event: metodo` por post (con milisegundos y líneas) para poder comparar corridas.

### Corridas asíncronas

Una corrida no se espera: `POST /run` responde **202** con un `runId` en ~5ms y el trabajo sigue en background. El frontend hace **polling cada 2s** a `/group-publish/status` y dibuja la barra de progreso con fase, grupo actual, publicados y errores.

Motivo: el poster tiene `--max-seconds=600` con timeout de 660s, así que **incluso un solo ítem puede tardar ~10 minutos** (más con red lenta, que escala las esperas hasta 3x), y con la separación entre posts una tanda completa mucho más. Antes la ruta esperaba todo eso y `api.js` no tiene timeout, así que el botón quedaba en "Corriendo..." sin saber si coltaba o trabajando.

`GET /status` incluye `elapsed_s` calculado en el servidor a propósito: el timestamp `started` viene recortado a 19 chars sin la `Z`, así que el browser lo parsearía como hora local (4h desfasado en Venezuela).

### Fallas que se distinguen

| Flag | Significado | Qué hacer |
|------|-------------|-----------|
| `sesion` | La sesión de Facebook venció, hay muro de login | Abrí el perfil y logueate de nuevo. La corrida sigue y los posts van a fallar. |
| `noBrowser` | No hay Chrome escuchando en el 9222 | Se auto-arranca; si falla, revisá que exista `chrome.exe` y el perfil |
| `phase: error` | Otro fallo | `current.error` trae el detalle |

`GET /status` devuelve `chrome: true|false` con un sondeo real, así que la barra lo muestra antes de que intentes publicar.

### Límites de la corrida automática

Los defaults (`DEFAULT_AUTO_PUBLISH` en `backend/lib/groupPublisher.js`):

| Clave | Default | Significado |
|-------|---------|-------------|
| `enabled` | `false` | Auto-publicado habilitado |
| `mode` | `publish` | `publish` o `prepare` (deja el post en la pestaña) |
| `daily_cap` | `6` | Máx. publicaciones reales por día |
| `hours_from` / `hours_to` | `8` / `21` | Franja horaria local de actividad |
| `min_gap_min` | `45` | Separación mínima entre publicaciones consecutivas |
| `cooldown_min` | `240` | Espera mínima entre 2 posts del **mismo** grupo |
| `worker_batch` | `3` | Cuántos dispara el worker por tick |

> Los botones manuales de la UI mandan `force: true` e ignoran franja, cap y cooldowns. Prudencia: probá con **un** ítem primero, porque un lote consume el cap diario y los cooldowns de una vez.

### Límites del disparador por fecha

Estos son los de `DEFAULT_AGENDA` en `backend/lib/groupPublisher.js`, y son **otros** que los de arriba: gobiernan el disparador por fecha, no el worker de la cola.

| Clave | Default | Significado |
|-------|---------|-------------|
| `auto` | `true` | Disparador armado |
| `tick_min` | `1` | Cada cuánto mira los vencidos |
| `catchup_hours` | `24` | Vencido hace más que esto **no** se recupera solo |
| `min_gap_min` | `5` | Separación mínima, medida **de inicio a inicio** (en modo `rango`, el mínimo del rango) |
| `gap_modo` | `fijo` | `fijo` = siempre `min_gap_min`; `rango` = un valor al azar entre `min_gap_min` y `gap_max_min`, sorteado **una vez por publicación** y guardado en `_ultimoIntento.gap_ms` |
| `gap_max_min` | `5` | Máximo del rango (solo en modo `rango`); nunca menor que `min_gap_min`. Se edita en Ajustes > Tiempos |
| `max_per_hour` | `12` | Tope duro por hora |
| `grupos_por_post` | `9` | Cuántos grupos se tildan por publicación (el "lote") |
| `dedupe_hours` | `6` | No repetir el mismo texto en el mismo grupo antes de esto (`0` = no) |
| `breaker_failures` | `3` | Fallos **consecutivos** que pausan el disparador |
| `breaker_cooldown_min` | `60` | Cuánto dura esa pausa |

El gap se mide contra el **último intento**, no el último acierto: con todo fallando el acierto nunca avanzaba y cada error iba seguido del siguiente vencido.

Y se ancla al **arranque** de ese intento, no a su `published_at`. No es un detalle: `published_at` siempre es posterior al arranque, así que medir desde ahí suma la duración de cada corrida al gap. Con corridas de ~1.5 min y gap de 5, eso rendía ~8/h en vez de ~10/h. La marca de arranque vive en `publish_config._ultimoIntento` y sobrevive a reinicios; si no está, se cae a `published_at`.

> Con `min_gap_min: 5`, `grupos_por_post: 9` y un tick por minuto, el techo rondan las **10-11 publicaciones por hora** (≈100 interacciones con grupos por hora), no 12: el tick corre cada minuto, así que el intervalo efectivo es de 5 a 6 min según la fase, no 5 clavados. Para 12/h clavadas habría que bajar el gap a 4 y dejar que `max_per_hour` sea el que corta.
>
> Es un ritmo agresivo para Facebook y el sistema **no puede detectar** que la plataforma dejó de aceptar envíos en silencio. La señal más barata es ver `SIN_LOTE=1` en el cierre de las corridas, o que los posts salgan a 1 grupo cuando se pidieron 9.
>
> Cuando el reparto a los 9 grupos falla (no apareció "Añadir grupos", el picker quedó abierto, o su **lista de grupos no llegó a cargar**), el post **sí sale** al grupo destino pero queda marcado: en el detalle del calendario aparece en rojo **"OJO: no se pudo repartir a los grupos del lote; salió solo en este grupo"**. No es un fallo silencioso.
>
> El caso "lista no cargó" se arregló el 2026-10-19: 4 de 12 posts del día salieron a 1 grupo con la nota *"ATENCIÓN lote: no se pudo tildar ningún grupo"* (sin el "de 136", señal de que el picker abrió pero la lista vino vacía). El bucle de carga perezosa cortaba en la **primera** lectura vacía (~4s tras abrir el picker); si Facebook tardaba más en poblar los ~136 grupos, el lote se perdía. Ahora `seleccionarLoteGrupos` sondea hasta ~15s a que aparezca al menos un checkbox, igual que ya hacía con el botón "Añadir grupos". El fallo era intermitente según lo lento que estuviera Facebook en ese momento.
>
> El **2026-10-20** apareció un hermano de ese fallo: la lista cargaba pero **solo los primeros 20** grupos (`lote: 9/20` en las notas, en vez de `9/136`). Desde ~16:13 del 19-oct el picker dejó de scrollear más allá de la primera tanda: la detección del contenedor (subir desde el primer checkbox exigiendo `overflowY: auto|scroll`) ya no lo encontraba, así que el lote se armaba con esos 20 y se repartía **siempre a los mismos grupos**, que al saturarse hacían que Facebook rechazara el envío (7 de los 10 errores del día salieron como *"Se hizo clic en Publicar pero el post no se envió"*). Ahora `scrollLista` baja **todos** los ancestros scrolleables del primer checkbox (sin exigir `overflowY`, porque Facebook usa `overflow:clip`) y, si no hay ninguno, el div scrolleable más grande del diálogo. Se comprueba con `node scripts/test-lote-grupos.mjs`.
>
> El mismo día se amplió `clickComposerButton`: solo reconocía 4 variantes del botón de compositor ("escribe algo"…), y los grupos de compra-venta usan "Vender algo" / "Crear publicación". Los que no coincidían terminaban en *"No se encontró el compositor del grupo"*. Ahora también descarta cajas de comentarios del feed, y se reintenta abrir el compositor hasta 6 veces en vez de 4.
>
> **Internet lento (autoescalado de esperas).** El 2026-10-21 se atacó la otra mitad del problema: los tiempos de espera del poster estaban calibrados para una conexión rápida, y con red lenta el bot declaraba fallos que no lo eran. Las constantes viven en `utilidades/fb-ranking/group_poster.js` y ahora se multiplican por un factor medido en cada página:
>
> - **Se mide la red real** con la Navigation Timing API (`performance.getEntriesByType('navigation')`: `responseStart` ≈ primer byte, `domComplete` ≈ DOM listo), sin requests extra. Referencia "rápida": TTFB < 0.6s y DOM < 3s. El peor de los dos cocientes es el factor, con suelo 1 y techo 4. Se cachea para el resto de la corrida (comparten conexión) y se puede fijar a mano con `--net-scale` (0 = auto).
> - **Se escalan**: la espera al botón Publicar habilitado (`PUBLISH_WAIT_MS`), el presupuesto de adjuntos (`ensureMediaReady`), la cadencia entre imágenes (`ATTACH_WAIT_POLLS`), la confirmación del envío (`ENVIO_CONFIRM_MS`) y la espera inicial tras cargar la página.
> - **El bucle de vaciado del compositor** dejó de ser 20×1.5s = 30s fijos: ahora es por tiempo, con un presupuesto **corto y fijo** (`DRAIN_MS` = 30s, no escalado). El vaciado es una comprobación de UI ("¿quedó texto?"), no una espera de red; la prueba de verdad la hace `esperarEnvioConfirmado` contra el feed. Y si el compositor no se vació, **no se falla de una**: primero se mira el feed. Si el post está publicado, es un éxito (la lectura del editor llegó tarde); con red lenta el compositor puede quedarse con el texto un rato después de que el post ya salió.
>   - El presupuesto del vaciado es corto **a propósito**: cuando se le dio el presupuesto completo de la confirmación, las dos esperas largas quedaban en serie (2× `ENVIO_CONFIRM_MS`), el grupo se comía el guard de `--max-seconds` y moría con *"Timeout de la operación en el grupo"* — el síntoma exacto que se quería eliminar. Con el vaciado corto, el peor caso es `DRAIN_MS` + `ENVIO_CONFIRM_MS` y queda por debajo del guard.
>   - Techos actuales: guard `--max-seconds=600` y timeout del padre `660000` (subieron de 300s/330s), porque con el factor 3x el peor caso escalado no cabía en 300s.
> - **Nuevo veredicto `revisar`** (indeterminado): si el compositor no se vació y **Facebook no mostró ningún aviso**, el poster no puede afirmar que el post "no se envió". Eso ya no se cuenta como error del canal: **no alimenta el breaker** (3 fallos seguidos → pausa) ni corta corridas buenas. La fila queda marcada `auto:revisar` en las notas, visible como error para que el usuario lo revise, y el **anti-duplicado la cuenta como "posiblemente publicado"** para no mandar el mismo texto dos veces al grupo. Los fallos con aviso de Facebook siguen siendo `error` normal.
>
> **Reintento automático de fallos transitorios.** Los errores que un reintento diferido sí puede resolver (timeout del guard, `detached Frame`, `Target closed`, caídas de red) ya no esperan a que el usuario apriete "Reintentar fallidas": el destino se **reencola solo**, dejándolo en `pending` con un `scheduled_at` futuro. El reencolado lo toma el disparador normal, así que respeta el gap, el tope por hora y el breaker — no es un bucle inmediato, que es justo lo que empeora el bloqueo de Facebook. Es **deliberadamente conservador** (`esFalloTransitorio` en `backend/lib/groupPublisher/poster.js`): los errores deterministas (grupo cerrado, sin permiso), los de **ritmo** (`compositor_texto`) y los `revisar` **no** se reintentan solos. El tope de intentos vive en la nueva columna `publication_queue.attempts` (migración en `database.js`); al agotarlo, la fila queda en `error` para revisión manual, con la nota `auto-reintento N/M`. Ajustable en Ajustes > Publicaciones: `auto_retry` (interruptor), `retry_max` (0 lo desactiva, default 2) y `retry_delay_min` (default 15).

> **Esto se puso el 2026-10-03 porque no existía.** El día duplicado dejó 190 destinos y el disparador los fue sacando a ~17 por hora, hasta que Facebook dejó de aceptar los envíos sin avisar nada. Los límites se agregan en `publish_config.agenda` y el estado del corte en `publish_config._breaker`.

#### La API key vive en dos lugares

`publish_config.ai.api_key` es la fuente, y `.env` es la copia de seguridad. Al arrancar, `backend/lib/secrets.js` rellena la base desde el `.env` **solo si la base no trae key** — el `.env` nunca pisa una key que ya está en la base, para que un valor viejo no destruya una key nueva.

Esto se agregó el 2026-10-04: la `publish_config` quedó en `NULL`, la migración de la agenda leyó `{}` y la degradó para siempre a tres claves. Con eso se perdieron la API key, los límites del reloj y el cursor de rotación, **sin un solo error**. La key se recuperó de un respaldo de dos días.

`.env` está en `.gitignore`. Para regenerarlo basta con arrancar el servidor con la base sana: se escribe solo.

**Los límites del reloj y el cursor de rotación NO están respaldados.** Viven solo en la base y se reconfiguran a mano en cinco segundos, pero conviene saberlo antes de tocar la tabla `settings`.

#### Correr la base de verdad en las pruebas

`DANIMARVIS_DB` y `DANIMARVIS_ENV_PATH` apuntan la base y el `.env` a otro archivo, así que las pruebas pueden arrancar el `initDB()` completo (mismas migraciones que producción) sin tocar datos reales.

```bash
DANIMARVIS_DB=/tmp/prueba.db DANIMARVIS_ENV_PATH=/tmp/prueba.env \
  node -e "import('./backend/db/database.js').then(m => m.initDB())"
```

`npm run check` incluye `scripts/test-persistencia-config.mjs`, que verifica que la configuración sobreviva a un reinicio y que una base dañada recupere la key. Ese test también falla si toca el `.env` del proyecto: los fixtures corren contra su propio temporal.

> Dos trampas de `sql.js@1.14.1` que costaron tiempo:
>
> - El `db.prepare(...)` **crudo** no persiste y **no falla**. En la app no pasa porque `backend/db/database.js` envuelve las sentencias con un `Statement` propio que hace bind + step. En scripts sueltos, usar `db.run(sql, [params])` y verificar con una lectura después de `db.export()`.
> - No editar `backend/danimarvis.db` con el servidor vivo: `initDB()` termina en `saveDB()` y reescribe el archivo entero desde memoria.

**El interruptor maestro** (`publish_config.master.on`) es una llave aparte: mientras esté en `false` no arranca **ninguna** corrida — ni del worker, ni del disparador, ni manual.

> ⚠️ **Los clics manuales ("Publicar ahora", "Correr vencidos", "Reintentar") no pasan por estos límites.** Solo obedecen el interruptor maestro. El corte por fallos sí los cuenta, pero no los frena.

### Requisito conocido

Ranking y publicador comparten la **misma instancia** de Chrome (mismo puerto, mismo perfil) y sus guards `running` son por módulo, así que **pueden correr a la vez y pelearse las pestañas**. El ranking diario quedó a las 23:00 y el publicador tiene su propia franja: hay solapamiento posible. Pendiente un mutex compartido.

---

## Ranking de grupos (Biblioteca de Contenido)

La vista `#/rankings` mide qué grupos de Facebook devuelven **más** (y **menos**) visualizaciones por publicación, usando la **Biblioteca de Contenido** del Panel Profesional (no usa la Graph API).

### Cómo funciona

1. El scraper (`utilidades/fb-ranking/content_library_views.js`) se conecta a un Chrome local con `--remote-debugging-port=9222` (perfil con sesión de Facebook) y abre la Biblioteca de Contenido en una **pestaña nueva**.
2. Recolecta todas las filas del grid con **rueda de mouse real** (Facebook virtualiza el listado y no responde a `scrollTop` programático), filtra las publicaciones del día elegido y extrae grupo de distribución + métricas (visualizaciones, impresiones) del pie del preview.
3. Escribe `reporte_POC_fechas.json` en `C:\Users\Dani\fb-leave\`, que el backend lee como fuente del ranking.
4. El backend agrega por grupo (`posts`, `vistas`, `impresiones`, `promedio`) y guarda un **snapshot diario** en `ranking_history` (clave `(fecha, grupo)`).

### La vista

- **Ranking del día** — elegís fecha objetivo (por defecto ayer) y rango de la Biblioteca (28/90 días/Total), y botón **Actualizar ranking** (tarda ~4–7 min mientras recorre todo el listado con scroll).
- **Historial** — selector de fechas (1 entrada por día): resumen + **Top 20** y **Bottom 20** de esa fecha, y **evolución de un grupo** (vistas/posts/promedio día a día).

### Requisitos

- Chrome con el perfil logueado en Facebook. **No hace falta abrirlo a mano**: `ensureDebugChrome` lo arranca solo si el puerto 9222 no responde. Si preferís levantarlo vos, `ranking_grupos.bat` en la carpeta `fb-leave` lo hace a mano.
- Sesión de Facebook activa. Si el perfil no la tiene, el arranque abre la Biblioteca de Contenido y hay que loguearse ahí; recién después la corrida funciona.

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

## Pruebas automáticas

Todo el proyecto se verifica con un solo comando:

```bash
npm run check
```

Corre los chequeos **en cadena** y sale con código distinto de 0 si algo no cuadra, así que sirve tal cual en un hook o en CI. Cubre tres frentes:

- **Estático** — `check-imports.mjs`: que cada `import` resuelva, que el módulo exporte lo que se importa, y que no se use una función exportada sin importarla (ver abajo).
- **Carga real** — `check-carga.mjs`: levanta el grafo real de las vistas del frontend con un DOM mínimo, que es lo que hace el navegador al importarlas.
- **Comportamiento** — `test-*.mjs`: cada módulo con lógica no trivial tiene su test que importa **el módulo de verdad** (no una copia) y comprueba casos concretos: rotación de grupos, reparto del lote, límites del reloj, transacciones, duplicar el día, técnica de texto, catálogo, etc.

### La trampa que ningún chequeo veía

`node --check` solo parsea, y `check-imports.mjs` validaba que lo **importado** exista... pero ninguno miraba los identificadores que se **usan**. El 2026-10-17, al disparar *Generar catálogo*, saltó `generateCatalogFile is not defined`: la función existía y estaba exportada en `backend/lib/catalogGenerator.js`, pero `server.js` la llamaba sin importarla. Los dos chequeos quedaban verdes y el error solo aparecía al tocar la ruta en caliente. La misma revisión destapó tres hermanos más en `server.js`: `ensureWebp` (subida de imágenes) y `isLegacyPlaintext`/`hashPassword` (login legado).

`check-imports.mjs` ahora tiene una **segunda pasada** (solo `backend`) que detecta funciones exportadas usadas sin importar. Se limita al backend a propósito: en el frontend hay nombres que llegan por HTML (`onclick="closeModal()"`), por `window` o por imports dinámicos, y daría falsos positivos. El escaneo usa un recorrido carácter a carácter para ignorar comentarios y strings, porque un `//` dentro de una URL o un apóstrofo dentro de un template partían las expresiones regulares y se comían código real.

> Regla práctica: si agregás una función con lógica, agregale un `test-*.mjs` y registralo en el `check` de `package.json`. Los tests **importan el módulo real**; cuando algo solo se puede comprobar por texto (por ejemplo, que el poster use tal selector o que una ruta cablee tal función), se acepta una verificación de string en la fuente, pero solo como último recurso.

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
El dashboard muestra ingresos totales (la suma de las comisiones ya cobradas, sin contar ventas canceladas), comisiones pendientes (desglosadas por moneda: USD y MN), productos más vendidos y ventas mensuales.

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
- [x] Lista de características esenciales en tarjeta y modal del catálogo
- [x] Vista aumentada (lightbox/zoom) con arrastre en el catálogo público
- [x] Caché offline con IndexedDB
- [x] Configuración de tipo de cambio USD → MN
- [x] Exportación de reportes PDF (tabla y lista detallada)
- [x] Importación/sincronización de precios con OCR (tesseract.js)
- [x] Motor de prompts para anuncios con IA (familias, variantes y rotación)
- [x] Importación de imágenes generadas con IA (asociación automática por nombre)
- [x] Generación de imágenes con IA (Pollinations)
- [x] Descarga masiva de imágenes en ZIP (JSZip)
- [x] Selector de moneda de comisión (USD/MN) por proveedor con override个别 por producto
- [x] Ranking de grupos por visualizaciones desde la Biblioteca de Contenido, con historial por fecha y evolución por grupo
- [x] Publicador automático en grupos de Facebook vía CDP, con Chrome auto-arrancado (puerto 9222 + perfil con sesión)
- [x] Corridas del publicador asíncronas (202 + `runId`) con progreso en vivo por polling, en vez de request bloqueante
- [x] Diagnóstico de fallas del publicador: distingue sesión de Facebook vencida de Chrome no disponible
- [x] Marca de publicaciones que quedan `pending_approval` cuando el grupo pide aprobación del administrador

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
- [ ] **Mutex compartido** entre el ranking de grupos y el publicador (hoy comparten Chrome y pueden pelearse las pestañas)
- [ ] **Corte anticipado** del publicador cuando el primer ítem falla por sesión/Chrome, en vez de seguir consumiendo la cola
- [ ] **Timeout en `api.js`**: hoy `fetch` no tiene timeout, así que un endpoint colgado queda colgado

---

## Licencia

Proyecto privado — DaniMarvis Store.
