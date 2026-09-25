# Guía: Publicación automática en tu Página de Facebook (API oficial de Meta)

**Objetivo:** configurar el módulo "Rutinas de Página" de DaniMarvis-Store para que tu
Página de Facebook se publique sola (con agendado nativo de Meta) **sin intervención
humana y cumpliendo las políticas de Meta**.

> ✅ Todo lo de esta guía usa la **Graph API oficial**. Nada de sesiones, cookies,
> evasión ni automatización gris. Es el mismo mecanismo que usan programas como
> Buffer o Hootsuite. Riesgo de baneo de tu cuenta: 0.

---

## Qué lográs al final

1. Cada día, a los horarios que definas (por defecto 09:00, 13:30 y 18:00),
   DaniMarvis le pide a Meta que publique en tu Página un post de un producto
   (texto + todas sus fotos), rotando productos para no repetir el mismo seguido.
2. **Meta** es quien publica (no tu servidor): si la laptop está apagada, la
   publicación sale igual.
3. Desde el panel ves todo el historial: qué se agendó, cuándo, si hubo error.

---

## Requisitos previos

- Tener una cuenta de Facebook con una **Página empresarial** (si aún no estás
  publicando desde una Página, creala; incluso los grupos se pueden cruzar desde ahí).
- Acceso a https://developers.facebook.com con tu cuenta (el mismo login de FB).
- Un producto en DaniMarvis con al menos una imagen cargada (los posts llevan las
  fotos del producto).

---

## Paso 1 — Crear (o usar) una app de desarrollador

1. Entra a https://developers.facebook.com e inicia sesión con tu Facebook.
2. Arriba a la derecha → **My Apps** → **Create App**.
3. Tipo de app: elige **"Business"** (si no aparece, elige "Other"/"Nothing" y
   describe "automatización de publicaciones de mi propia página"). Ponle un nombre,
   por ejemplo `Danimarvis Publisher`.
4. Agrégalo con tu cuenta de Facebook. **NO** completes el formulario de revisión de
   permisos ("App Review"): como es tu propia app y tu propia página, funciona en modo
   **Desarrollo** sin pasar la revisión.

> 💡 Si ya tenés una app (la creaste antes), podes reutilizarla.

---

## Paso 2 — Generar el token de usuario con permisos

1. Dentro de tu app, ve a **Tools → Graph API Explorer**
   (https://developers.facebook.com/tools/explorer/).
2. En el selector de arriba a la izquierda, asegurate de que esté seleccionada tu app.
3. En el campo **"Get User Access Token" / permisos**, elegí lo siguiente:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
4. Hacé clic en **Generate Access Token** y acepta el diálogo que aparece
   ("Esta app no está revisada", "Estás autorizando…"), dale continuar.
5. Ahora sí ejecutá esta consulta (pegalo en el cuadro de la Explorer y dale **Run**):

   ```
   /me/accounts?fields=name,id,access_token
   ```

   Respuesta esperada: una lista con **cada una de tus Páginas** y su `id`,
   `name` y un `access_token`.

6. **De esta lista tomá**: el **Page ID** (`id`) de tu Página de ventas y el
   `access_token` de esa página.

> ⚠️ Ese token de página que muestra la Explorer es de **corto plazo** (dura ~1‑2 h).
> No lo uses todavía: lo convertimos en el Paso 3 al de larga duración.

---

## Paso 3 — Obtener el token de larga duración (60 días)

Guardalo todo: el **App ID** y el **App Secret** de tu app están en
**App Settings → Basic** (el Secret hay que "mostrarlo" con su contraseña).

### 3.a — Convertir el token de USUARIO a largo plazo

Necesitás tu token de *usuario* (el que viste antes de elegir la página; es el
"User Access Token" si en la Explorer elegiste "User" en el selector de la izquierda).
En la Explorer, el selector superior suele mostrar la **página** una vez que la elegís;
volvé a elegir **"User"** para ver el token de usuario, o generalo en
**Tools → Access Token Tool**.

Con ese token de usuario apretá esta URL en el navegador (reemplaza los 3 valores):

```
https://graph.facebook.com/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=APP_ID
  &client_secret=APP_SECRET
  &fb_exchange_token=TOKEN_DE_USUARIO
```

Respuesta: `{"access_token":"…", "token_type":"bearer", "expires_in":5184000,…}`
→ `expires_in` 5.184.000 segundos = **60 días**. Ese es tu token de usuario largo.

### 3.b — Obtener el token de PÁGINA a largo plazo

Pegá esto en el navegador (usa el token de usuario largo del paso 3.a):

```
https://graph.facebook.com/me/accounts?access_token=TOKEN_DE_USUARIO_LARGO&fields=name,id,access_token
```

De la lista, copiá el `access_token` de **tu página**. Por estar derivado de un
token de usuario largo, este **token de página también dura 60 días**.

### 3.c — Duración total

El token de página expira **60 días después de la última "renovación"** y se renueva
de la misma forma: repetir los pasos 3.a + 3.b cada ~55–58 días (antes de que venza).

---

## Paso 4 — (Opcional pero recomendado) Verificar el token

En https://developers.facebook.com/tools/debug/ pegá el token de página:

- Debe aparecer el nombre de tu página y **expires: 60 días aprox**.
- Si dice "No scopes" o no lista permisos, repetí el Paso 2 (faltó aceptar permisos).

---

## Paso 5 — Conectar tu Página en DaniMarvis

1. Abrí el panel en `http://localhost:3456`.
2. **Ajustes → "Publicación en Facebook"** (sección de Publicaciones).
3. Pegá los datos y guardá:
   - **Facebook Page ID** → el `id` de tu página (del Paso 3.b).
   - **Facebook Page Access Token** → el token largo de página (Paso 3.b).
   - **Expiración del token (fecha)** → la fecha de hoy + 60 días (recordatorio en panel).
   - **Instagram Account ID** → dejalo vacío (se usa para IG, no para esta rutina).
4. Guardá la plantilla.

---

## Paso 6 — Crear y probar tu rutina

1. Menú lateral → **Rutinas Página**.
2. Deberías ver la tarjeta verde **"Conectada"** con tu Page ID.
3. Botón **"Probar configuración"**: valida el token y te muestra qué slots futuros
   se van a agendar. Debe decir "Configuración válida".
4. Botón **"Nueva rutina"**:
   - **Nombre**: ej. "Rutina diaria compraventa".
   - **Horarios**: `09:00,13:30,18:00` (o los que quieras, separados por coma).
   - **Antelación mínima**: dejalo en 20.
   - **Productos**: elegí algunos (o "Todos los productos activos" para rotación).
   - **Texto personalizado**: dejalo vacío para usar el texto público de cada
     producto (o usá `{NAME} {PRICE} {DESCRIPTION} {WARRANTY}`).
5. Guardá. Con el botón **"Agendar ahora"** reservás de inmediato los próximos slots
   en Meta.
6. Revisá **Historial de agendado**: verás filas "Programado" con el producto, hora y
   el Meta ID. Eso es todo: **Meta publicará solo a esa hora**.

---

## Paso 7 — Mantenimiento mensual (~1 minuto)

Cada 60 días el token vence. El panel te avisa en "Rutinas de Página" si cargaste la
fecha de expiración. Cuando venza:

1. Repetí **Paso 3.a + 3.b** (token largo nuevo).
2. En **Ajustes → Publicación en Facebook**, reemplazá el token y actualizá la fecha
   de expiración.
3. **"Agendar ahora"** para reanudar.

---

## Advertencias importantes

- **Publicamos SOLO en tu Página.** Meta prohíbe la automatización de publicaciones
  en grupos como si fueran hechas por una persona; por eso este módulo no las toca.
- El token es una llave de acceso: **no lo compartas, no lo pegues en sitios, no lo
  subas a GitHub**. Danimarvis lo guarda local en su base de datos (settings).
- Si cambiás el Page ID o el token, los agendados ya reservados en Meta seguirán
  existiendo; cancelalos desde el Historial si necesitás.
- Vuelos de prueba: conviene crear una rutina con productos reales y horarios
  cercanos (al menos 10 min de anticipación) la primera vez para ver el resultado
  real en la Página antes de confiarle frecuencia diaria.

---

## Glosario rápido

| Término | Qué significa |
|---|---|
| App (Development) | Aplicación de desarrollador de Meta; en modo desarrollo publica tu propia página sin revisión. |
| User Access Token | Token de tu persona (temporal). |
| Page Access Token | Token que actúa "como la página". Es el que usa DaniMarvis. |
| Long-lived (60 días) | Token con vigencia extendida; se renueva mientras todavía esté vigente. |
| `pages_manage_posts` | Permiso para publicar y agendar en la página. |
| Graph API Explorer | Herramienta de Meta para probar llamadas a la API sin escribir código. |
| Debugger | Herramienta de Meta para inspeccionar/validar tokens. |