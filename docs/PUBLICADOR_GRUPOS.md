# Publicador automático de grupos — anatomía interna

Documento de referencia para **mantener y modificar la UI del publicador**. No es una guía de
instalación ni de uso: es el mapa de qué hay dónde, qué contrato hay entre capas, y dónde
están las trampas. Todas las referencias son `archivo:línea`.

> 📄 Hay otro documento que se parece en el nombre pero es otro sistema:
> [`GUIA_PUBLICACION_AUTOMATICA_META.md`](./GUIA_PUBLICACION_AUTOMATICA_META.md) es el módulo
> de **Rutinas de Página** (Graph API oficial de Meta, publica en tu Page). Este documento es
> el **publicador de grupos** (navegador real por CDP, escribe en la interfaz de cada grupo).
> No comparten código ni base de datos.

---

## Mapa de archivos

| Archivo | Rol |
|---|---|
| `frontend/js/views/pubQueueView.js` (1220) | Toda la UI de la cola. Una sola vista con 5 pestañas, y el form de alta/edición con selector de origen (catálogo o redacción propia) |
| `frontend/js/views/settingsView.js:154-203` | Config del auto-publicado (dentro del form de plantilla) |
| `frontend/js/db/api.js:133-143` | Los 9 métodos HTTP de la cola y el publicador |
| `backend/lib/groupPublisher.js` (644) | Orquestador: config, selección, placeholders, spawn del poster, worker, estado en vivo |
| `backend/routes/groupPublish.js` (43) | `/api/group-publish` → 202 + `runId` |
| `backend/routes/pubQueue.js` (201) | CRUD de la cola, `/due`, `/timer` |
| `backend/lib/chromeLauncher.js` (106) | Auto-arranque de Chrome en el 9222 + perfil con sesión |
| `utilidades/fb-ranking/group_poster.js` (892) | El scraper CDP que escribe en el grupo |
| `backend/db/database.js:268-282, 388-406` | Esquema y migraciones de `publication_queue` |

**El motor de BD es sql.js (WASM)**: la base completa vive en memoria y `saveDB()` escribe
todo el archivo en cada `run()`. `DB_PATH` es fijo (`database.js:10`), no se puede redirigir por
config — relevante si querés pruebas aisladas.

---

## Modelo de datos — `publication_queue`

Creada en `database.js:268-282`; `images` y `pending_approval` llegan por `ALTER` en
`migratePubQueue()` (`database.js:388-406`). No hay `CHECK` ni `ENUM`: `status` es texto libre.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | TEXT PK | UUID v4. **El backend nunca lo genera: lo manda el front** (`pubQueue.js:111`) |
| `publication_id` | TEXT | FK → `publications.id`. Puede ser `NULL` |
| `group_name` | TEXT | Se compara con `LOWER()` para los cooldowns |
| `group_url` | TEXT | Si viene vacía, `resolveGroupUrl()` la busca en `facebook_groups` |
| `status` | TEXT | `pending` \| `published` \| `prepared` \| `skipped` — ver abajo |
| `scheduled_at` | TEXT | Programación. **La UI no lo manda nunca** (ver Trampa 2) |
| `published_at` | TEXT | Momento de publicación. Base del cap diario, gap y cooldown |
| `variant_index` | INTEGER | Lo pone el front. **El backend no lo lee** |
| `variant_text` | TEXT | Texto final. Si vacío, el publisher usa `p.publish_text` |
| `images` | TEXT | **String JSON** de rutas `/uploads/...` o URLs. Máx 6 |
| `notes` | TEXT | Log de la corrida. **Nunca se muestra en la UI** |
| `pending_approval` | INTEGER | `1` = el grupo exige aprobación del admin |
| `created_at` / `updated_at` | TEXT | Orden secondary del "due" y auditoría |

### Los 4 estados y quién los escribe

| Estado | Lo pone | Cuándo |
|---|---|---|
| `pending` | Default del esquema | Toda fila nueva. **También en que queda un ítem que falló** |
| `published` | `groupPublisher.js:317` (auto) · `pubQueue.js:139` (PATCH manual) | `result.ok && mode==='publish'` |
| `prepared` | `groupPublisher.js:320` | `result.ok && mode==='prepare'` |
| `skipped` | Solo el front: `pubQueueView.js:449` | Botón "Omitir" |

`error`, `warn` y `dry-run` **existen solo en el JSON del poster**, nunca en la columna `status`.

> **Consecuencia de diseño:** no hay estado `failed`. Cuando un post falla, `updateQueue`
> solo escribe `notes` y deja el ítem en `pending` → se reintenta en la próxima corrida. Si
> querés que la UI distinga "falló" de "nunca se intentó", hay que agregar el estado.

---

## Flujo de una corrida

```
POST /api/group-publish/run  →  202 { runId }   (5 ms, no espera)
   │
   └─ startGroupPublish()            siembra currentRun para que el 1er poll la vea
        └─ runGroupPublish()          fire-and-forget
             ├─ ensureDebugChrome()   arranca Chrome 9222 si el puerto no responde
             ├─ pickForRun()          aplica cap/gap/cooldown/franja  (o filter por ids)
             └─ por ítem:
                  resolveGroupUrl() → resolveImages() → writeMessageFile()
                  → spawnPoster()   proceso Node hijo, timeout 280 s
                  → updateQueue()    escribe status/notes/pending_approval
                  → espera 45-135 s
```

`GET /api/group-publish/status` se consulta cada 2 s desde el front y devuelve
`{ running, chrome, config, current, lastResult }`.

### `phase`, el ciclo de vida de una corrida

`starting` → `starting_chrome` → `picking` → `publishing` ⇄ `waiting` → `done`
(con salidas a `empty` si no hay vencidas, o `error` si falla Chrome/una excepción).

`currentRun` se actualiza **por ítem** y **se conserva al terminar**, así que la UI puede
mostrar el desenlace. `elapsed_s` lo calcula el servidor a propósito: `started` viene recortado
a 19 chars sin la `Z`, y el JS lo parsearía como hora local (4 h de desfase en Venezuela).

### `auto` vs `force` — la diferencia que más te va a afectar

| | `auto: true` (sin `ids`) | `force: true` |
|---|---|---|
| Tope de lote | `cfg.worker_batch` | 30 fijos |
| Cooldown por grupo | se aplica | **ignorado** |
| Franja horaria | se aplica | **ignorada** |
| Cap diario | se aplica | **ignorado** |
| Gap mínimo | se aplica | **ignorado** |
| Exige `cfg.enabled` | sí | no |

> ⚠️ **Los tres botones de la UI mandan `force: true`** (`pubQueueView.js:403` y los handlers de
> la línea 373). O sea: la UI ignora todas las protecciones. `Correr vencidos` no es "el
> comportamiento del worker", es una corrida sin límites salvo el tope de 30.

> ⚠️ Además, cooldown y gap se evalúan **una sola vez, al armar el lote**. Como `updateQueue`
> marca `published` ítem por ítem durante la corrida, un mismo grupo con 2 filas en la cola
> **se publica dos veces en la misma corrida**.

### El worker

Existe desde el commit que cerró la Trampa 1. `startGroupPublishScheduler()`
(`groupPublisher.js:609`) se llama desde `server.js:453`, después de que la BD carga, y
dispara un tick cada `SCHEDULER_INTERVAL_MS` = 5 min (`groupPublisher.js:523`).

El tick (`runSchedulerTick`, `groupPublisher.js:532`) es corto y tiene cuatro salidas posibles:

| Situación | Resultado en `last_tick_result` |
|---|---|
| Ya hay una corrida en curso | `skipped: "ya hay una corrida en curso"` |
| `cfg.enabled` en `false` | `skipped: "auto-publicado deshabilitado"` |
| `pickForRun()` devuelve 0 | `skipped: "no hay publicaciones vencidas"` |
| Hay trabajo | `started: true` + `runId` |

> ⚠️ **El chequeo de `pickForRun()` antes de arrancar es lo que hace que esto sea usable.**
> `runGroupPublish()` llama a `ensureDebugChrome({launch: true })` en su primer paso
> (`groupPublisher.js:370`), así que sin ese filtro el worker abriría Chrome cada 5 minutos
> aunque no hubiera nada que publicar. Con el filtro, un tick sin trabajo no toca el navegador.

> ⚠️ **`enabled` es un interruptor real, y en esta base ya está en `true`.** Con el worker
> armado, publicar dejó de ser 100% manual. Ver "Antes de tocar nada" arriba.

`GET /api/group-publish/status` expone el bloque `scheduler` (`schedulerState()`,
`groupPublisher.js:599`) con `active`, `interval_ms`, `last_tick`, `next_tick` y
`last_tick_result`, para que la UI pueda mostrar la próxima corrida en vez de un
"cada 5 minutos" que no existía.

---

# La UI

## Montaje y navegación

`pubQueueView.js` exporta un único `render(container)` (`:167`). El router lo importa en
`core/app.js:19` y lo despacha por el hash `#/pub-queue` (título en `core/config.js:17`).

`render()` resuelve la pestaña desde el query del hash (`?tab=...`), llama a `renderPage()` y
arranca `startTimerRefresh()` (re-render cada 30 s, `:1068`).

**Pestañas** — los 5 botones se declaran en `renderPage()` (`:197-203`) y se despachan en el
`switch` de `:216-222`. Cada una tiene su render:

| Pestaña | `currentTab` | Render | Qué muestra |
|---|---|---|---|
| Pendientes | `pending` | `renderPending()` `:225` | La cola + barra de progreso + config |
| Agregar a cola | `add` | `renderAddForm()` `:484` | Form de alta |
| Historial | `history` | `renderHistory()` `:998` | Publicadas / omitidas / pendientes de aprobación |
| Temporizadores | `timers` | `renderTimers()` `:1056` | Cooldowns por grupo |
| Grupos | `groups` | `renderGroups()` `:1096` | Alta/baja de `facebook_groups` |

Todas escriben dentro del mismo `#pubq-tab-content` (`:204`). Cambiar de pestaña re-renderiza
el contenedor completo, no hay estado compartido entre pestañas salvo `currentTab`.

## Los 9 endpoints que consume la UI

**Lectura** (los 4 en un `Promise.all` en `renderPending`, `:228-233`):

| Método | Devuelve | Para qué |
|---|---|---|
| `GET /pub-queue` | **Todo**, sin filtrar por estado | La lista que se renderiza |
| `GET /pub-queue/due` | Solo `pending` y vencidas | Alimenta `dueIds` → qué botón se muestra |
| `GET /pub-queue/timer` | Cooldown por grupo, 4 h **fijas** | El badge ⏳ y el botón "Publicado" |
| `GET /group-publish/status` | Estado de la corrida | Barra de progreso + config efectiva |

**Acción:**

| Método | Quién lo llama | Efecto |
|---|---|---|
| `POST /group-publish/run` | "Correr vencidos" | 202, corre todas las vencidas |
| `POST /group-publish/run/:id` | "Auto-publicar" / "Preparar" | 202, corre un ítem |
| `PATCH /pub-queue/:id` | Editar · "Publicado" · "Omitir" | Actualiza `status`/`notes`/`variant_text`/`images` |
| `DELETE /pub-queue/:id` | "Quitar" | Borra la fila |
| `POST /pub-queue` | Form de alta | Inserta **una fila por grupo seleccionado** |

## Anatomía de una tarjeta de ítem

`renderPending()` (`:279-325`) arma cada tarjeta. Los tres estados visuales:

| Condición | Etiqueta | Botones que aparecen |
|---|---|---|
| `isDue && status!=='prepared'` | ⏰ Listo para publicar | 🚀 Auto-publicar · 🧰 Preparar en pestaña |
| `status === 'prepared'` | 🧰 Preparado en pestaña | 🚀 Publicar ahora |
| `item.scheduled_at && !isDue` | 📅 Programado para … | (ninguno de publicación) |
| resto | ✓ Listo | solo Abrir grupo / Editar / Publicado / Omitir / Quitar |

Tres flags calculados por ítem:

- **`timer`** (`:280`) — de `timerMap`, indexado por `group_name.toLowerCase()`. Si no hay
  publicación previa, el timer **no existe** y `canPublish` sale `true`.
- **`canPublish`** (`:281`) — solo affects el botón "Publicado" (lo pone translúcido).
- **`isDue`** (`:282`) — `dueIds.has(item.id)`. **Es el que decide qué se puede publicar.**

El texto es un `div.pubq-copy-text` con `data-text`, y el click lo copia al portapapeles (`:329`).
Los handlers de cada botón se enganchan con `querySelectorAll` por clase después del render.

## La barra de progreso — contrato con el backend

Agregada en el último refactor. Son 4 funciones y un contenedor:

| Pieza | Línea | Rol |
|---|---|---|
| `runProgressHtml(status)` | `:51` | Escribe dentro de `#pubq-run-progress` |
| `chromeBadgeHtml(chrome)` | `:85` | Badge "Chrome 9222 OK / caído" |
| `startPublishPoll(onDone)` | `:95` | Polling cada `POLL_MS` (`:21`, 2000 ms) |
| `stopPublishPoll()` | `:113` | Cancela el intervalo |
| `runOutcome(cur)` | `:121` | Traduce el `current` final a un toast |

`trackRun()` (`:373`) es el handler común de los tres botones: dispara, y sigue la corrida por
polling. Cuando termina, busca la fila del ítem en `cur.results` y muestra el toast; en modo
`prepare` abre `window.open(row.url)`.

**Detalles que importan si tocás esto:**

- El poll vive en una **variable de módulo** (`publishPoll`, `:18`), no en el DOM. `cleanup()`
  (`:1217`) lo cancela al salir de la vista.
- `startPublishPoll` corre un `tick()` **inmediato** además del primer intervalo, para no
  esperar 2 s en mostrar.
- Un poll fallido **no corta el seguimiento** (`:101-103`): hace `return` y espera al siguiente.
- Al re-renderizar por el refresh de 30 s, el contenido de `#pubq-run-progress` se pierde, pero
  el poll lo repinta en ≤2 s. Se autorrepara.
- Si se recarga la página con una corrida en curso, `renderPending` detecta
  `autoStatus.running` y retoma el seguimiento (`:360-369`).

## El bloque de configuración

`barHtml` (`:253`) es la tarjeta superior: badge de config, badge de Chrome, resumen de la
última corrida y el botón "Correr vencidos". El texto de config se arma en `:243-245` desde
`autoStatus.config`, que ya viene **mergeado con los defaults y clampeado** por
`getAutopublishConfig()` — no es el valor crudo de la BD.

`#pubq-run-progress` es un `<div>` vacío dentro de esa tarjeta (`:262`); lo rellena el poll.

## Clases CSS disponibles

Las que usa la vista, para no inventar: `page`, `page-header`, `filter-bar`, `card`,
`empty-state`, `form-control`, `btn` + `btn--sm` + `--primary` / `--secondary` / `--ghost`,
`badge` + `--active` / `--pending`, `modal-header`, `modal-close`, más las de layout
(`display:flex`, `gap`, `grid`, `var(--...)`) que se usan inline.

Las clases `pubq-*` (`pubq-auto`, `pubq-prepare`, `pubq-edit`, `pubq-skip`, `pubq-delete`,
`pubq-copy-text`, `pubq-open-group`, `pubq-mark-published`, `pubq-gchk`, `pubq-g-edit`,
`pubq-g-remove`, `pubq-dot-pend`) **no están en el CSS**: son puramente ganchos para
`querySelectorAll`. Borrar una rompe el binding del botón.

## Si vas a agregar un control al form de la cola

`renderQueueForm()` (`:507`) es **reutilizable**: sirve para el alta (`renderAddForm`) y para la
edición en modal (`openEditModal`, `:980`), vía `mode: 'add' | 'edit'`. El payload se arma en
`:929-934` y hoy manda `publication_id`, `variant_index`, `variant_text` e `images`.

### Origen del texto: catálogo o redacción propia

El estado `st.origin` (`'catalog' | 'own'`, `:510`) decide de dónde sale el texto. Es el único
campo que se manda explícitamente:

| `origin` | `publication_id` que se manda | Cómo se ve el form |
|---|---|---|
| `catalog` (default) | el id de la publicación elegida | Lista de publicaciones con filtros, texto e imágenes precargados |
| `own` | `null` | La lista de publicaciones se oculta, el textarea arranca vacío, las imágenes se suben a mano |

El texto propio se guarda en `variant_text`, que el publicador ya priorizaba sobre
`publish_text` (`groupPublisher.js:237`), así que **no hizo falta nada en el backend para el
texto en sí**: `publication_id` NULL ya estaba permitido por el schema y por el `LEFT JOIN`.

Tres detalles que no son evidentes:

- `PLACEHOLDERS` (`:545`) define qué variables se ofrecen en cada modo, y `SIN_FUENTE`
  (`:554`) cuáles se rechazan al guardar. En `own` solo se ofrece `{FECHA}`: sin publicación
  asociada, `{NOMBRE}` y `{PRECIO}` no tienen de dónde sacarse.
- `setOrigin()` (`:728`) **no pisa lo que el usuario ya escribió**: solo reprecarga el default
  del modo destino si el texto sigue sin tocar (`textTouched`). Cambiar de ida y vuelta no
  borra una redacción.
- El fallback `|| publications[0]?.id` se eliminó a propósito. Con él, editar un ítem de
  redacción propia lo guardaba enganchado a la publicación #1 (`null || publications[0].id`).

En modo edición el origen no se puede cambiar: se muestra como etiqueta junto al grupo
(`:613`) y se deriva del ítem.

### Placeholders: de dónde salen los datos

`fillTemplateText()` (`groupPublisher.js:167`) reemplaza cuatro variables al publicar. Los datos
vienen de las columnas que trae `dueCandidates()` (`groupPublisher.js:184`):

| Variable | Fuente | Sin publicación asociada |
|---|---|---|
| `{FECHA}` | La fecha local del momento de publicar | Funciona |
| `{NOMBRE}` | `p.product_name` (de `publications`) | Queda literal |
| `{PRECIO}` | `pd.price` (de `products`) | Queda literal |
| `{PUBLISH_TEXT}` | `p.publish_text` | Queda literal |

Tres trampas que ya están resueltas y conviene no volver a introducir:

1. **`publications` no tiene columna de precio.** El precio vive en `products` y se une por
   `product_id`, igual que hace `routes/publications.js`. Por eso el SELECT hace
   `LEFT JOIN products pd` y no alcanza con leer de `publications`.
2. **La columna viene aliaseada** a `product_price` porque así la espera `fillTemplateText()`.
   Sin el alias, `{PRECIO}` queda literal aunque el dato esté ahí.
3. **Solo se reemplazan los placeholders que tienen dato** (`.filter(([, v]) => v !== '')`).
   Antes, sin publicación, `{PRECIO}` se convertía en `$0` y `{NOMBRE}` en vacío: un post
   publicado con el precio en $0 y sin ningún error. Ahora quedan literales, que es visible, y
   la UI además impide guardarlos.

**Trampa al guardar:** `PUT /api/settings` manda el `publish_config` **entero** y el merge del
server es shallow (`server.js:187`). Si sacás un input de Ajustes, **estás borrando ese campo**
de la config persistida (vuelve al default, no a un valor previo).

---

## Config de auto-publicado

Vive en `settings.publish_config` (columna TEXT con JSON), fila `id = 1`. La sub-clave es
`autopublish`. Defaults en `DEFAULT_AUTO_PUBLISH` (`groupPublisher.js:14-23`) y clamps en
`getAutopublishConfig()` (`:55-67`).

| Clave | Default | Clamp | Input en Ajustes |
|---|---|---|---|
| `enabled` | `false` | — | checkbox `ap_enabled` `:164` |
| `mode` | `'publish'` | solo `publish`\|`prepare` | select `ap_mode` `:170` |
| `daily_cap` | `6` | ≥1 | `ap_daily_cap` `:178` (1-200) |
| `hours_from` | `8` | **ninguno** | `ap_hours_from` `:182` (0-23) |
| `hours_to` | `21` | **ninguno** | `ap_hours_to` `:186` (1-24) |
| `min_gap_min` | `45` | ≥5 | `ap_min_gap` `:192` (5-600) |
| `cooldown_min` | `240` | ≥30 | `ap_cooldown` `:196` (30-4320) |
| `worker_batch` | `3` | 1-20 | `ap_batch` `:200` (1-20) |

`hours_to` es **excluyente**: con `hours_to: 21` ya no publica a las 21:00. Y la franja usa
`getHours()` **local** del SO, mientras `published_at` se guarda en UTC.

---

## Contrato del poster (`group_poster.js`)

Se invoca como proceso hijo (`groupPublisher.js:279-294`):

```
node group_poster.js --no-sandbox --groups=<url> --message-file=<path>
                     --mode=publish|prepare --label=<nombre> --max-seconds=300
                     [--images=a;b;c] [--debug=1]
```

Imprime por stdout **un objeto JSON por grupo** (mezclado con texto humano). El backend parsea
línea por línea y se queda con el **primer objeto cuyo `status` sea terminal** —
`published`, `prepared`, `dry-run` o `error` (`groupPublisher.js:237-263` en
`parsePosterOutput()`). Los avisos (`status: 'warn'`) se acumulan aparte en `warnings[]` y se
muestran en las notas de la cola, pero nunca cuentan como resultado.

Claves del resultado exitoso (`group_poster.js:836-845`):

| Clave | Significado |
|---|---|
| `status` | `published` \| `prepared` \| `dry-run` \| `warn` |
| `post_url` | URL del post, **o cadena vacía** si no se encontró el ancla (`:613`) |
| `imagen_adjunta` | nº de miniaturas que FB muestra de verdad |
| `imagenes_pedidas` | nº de paths que se le pasaron |
| `adjuntos_confirmados` | `1`/`0`. Señal de confianza: FB tomó los adjuntos. **Ver abajo** |
| `texto_digits` | Longitud del texto que quedó en el compositor |
| `requiere_aprobacion` | `1`/`0`, busca 3 frases de FB en el body (`:705-714`) |
| `toral_ms` | Duración. **El typo es real** (`:849`), no `total_ms` |

### Los adjuntos ya no bloquean la publicación

Antes, si el conteo de miniaturas no llegaba al total pedido, el poster abortaba y el post
**no se publicaba**. Eso quedó eliminado a propósito: un problema de adjuntos nunca puede
impedir que el post salga. En su lugar el resultado reporta qué se pudo verificar y
`updateQueue()` lo deja anotado en las notas de la cola.

El conteo exacto **no es confiable** contra el DOM actual de Facebook, y no se debe reportar
como si lo fuera. Lo medido el 2026-09-27, con 6 imágenes pedidas:

| Señal | Resultado | Por qué no sirve |
|---|---|---|
| `input[type=file]` en el compositor | 0 | React lo vacía después de procesar |
| `<img>` dentro del ancla del compositor | 0 | FB monta el panel de adjuntos **fuera** de ese subárbol |
| `<img>` `scontent` de la página | 66 → 67 | Incluye el feed; da 9 con 6 pedidas |
| Miniatura real del adjunto | `64x80` | Se confunde con miniaturas del feed (`227x227`) |
| **Controles de "quitar foto"** | **presentes** | Único booleano que sí es fiable |

Por eso `adjuntos_confirmados` es un **booleano y no un número**: si FB muestra los controles
de quitar foto, tomó los adjuntos. Las notas de la cola dicen *"FB confirmó los adjuntos"* o
*"ATENCIÓN: FB no mostró los controles de quitar foto"*, y nunca inventan un "3 de 6", porque
un número falso en la cola no lo cuestiona nadie.

Máximo **10 imágenes** por publicación (`MAX_IMAGES` en `backend/routes/pubQueue.js:10` y
`frontend/js/views/pubQueueView.js`). Cada imagen se envía **una sola vez** y, si falla, el bucle
**sigue con la siguiente** en vez de cortar el lote entero.

> **Cada archivo se sube exactamente una vez.** Ya pasó: con el conteo de adjuntos roto, la
> condición "el panel ganó un adjunto" nunca se cumplía, el lazo de reintentos se agotaba siempre
> y **cada foto salía duplicada** en el post. Un archivo solo se reenvía si `uploadFile` **lanza**
> excepción, porque eso significa que el input quedó vacío. Si `uploadFile` no lanza, el archivo
> entró y no se toca otra vez, aunque no haya forma de comprobar si FB lo tomó. Ante la duda,
> perder una imagen es preferible a duplicarla.

> Cuando Facebook vuelva a cambiar el DOM del compositor, el síntoma será
> `adjuntos_confirmados: 0` con imágenes pedidas. Se diagnostica mirando el volcado
> `[MEDIA]` que emite el poster (contiene `markers`, `imgs`, `bgBlob`, `spinners` y `detect`).
> Para volcarlo a un archivo: `MEDIA_DEBUG=/ruta/absoluta/salida.json`.

Los errores son `{ group_url, ok:false, status:'error', message }` con 7 mensajes distintos.
Los que te importan para la UI: `'Sesión de Facebook requerida…'`, `'No se encontró el
compositor del grupo (¿grupo cerrado/archivado?).'` y `'Los adjuntos no quedaron subidos a
tiempo en FB; no se publicó…'` (este último **ya no se emite**: el abort se eliminó).

**`--max-seconds` no es un presupuesto global**: se reinicia en cada grupo (`:877`, dentro del
bucle `for (const [i, groupUrl] of groups.entries())`), y además `execFile` mata el proceso a los
280 s (`:291`), o sea que ese guard nunca llega a disparar por tiempo. El timeout real es 280 s.

---

## Trampas verificadas

Las que más te van a afectar si tocás la UI. Las marqué con cómo las comprobé.

### 1. ~~El worker no existe~~ → RESUELTA ✅

**Era esto:** `startGroupPublish()` solo se llamaba desde las rutas, así que publicar era 100%
manual, mientras la etiqueta de Ajustes prometía "cada 5 minutos".

**Ahora:** `startGroupPublishScheduler()` (`groupPublisher.js:609`) corre un `setInterval` de
5 min desde `server.js:453`, y `runSchedulerTick()` (`groupPublisher.js:532`) decide en función
de `enabled`, si hay corrida en curso y si `pickForRun()` encuentra trabajo real. Sin trabajo no
arranca Chrome. Estado visible en `GET /group-publish/status` → `scheduler`.

**Lo que hay que saber antes de confiar en él:**

- El `setInterval` corre aunque el server esté ocioso; solo se apoya en el `running` global.
- Una corrida con `worker_batch: 3` y 45-135 s de separación entre posts dura más que el
  intervalo, así que los ticks siguientes se acumulan y se saltan solos. Correcto, pero
  significa que el intervalo de 5 min es *máximo*, no una cadencia real.
- El ranking diario de las 23:00 comparte la instancia de Chrome con el publicador. Si la
  franja `hours_to` se deja en 24, se pueden pisar. Ver Trampa 10.
- **No hay red de contención:** si `enabled` es `true` y hay vencidas dentro de la franja, el
  worker publica solo. En esta base `autopublish.enabled` ya está en `true`.

### 3. ~~La línea `warn` marcaba ítems como publicados~~ → RESUELTA ✅

**Era esto:** `typeText()` emitía `console.log({ ok: true, status: 'warn', ... })`
(`group_poster.js:178`) antes del resultado final, y el parseo tomaba la **primera** línea con
`ok`. Consecuencia: `ok: true` → `updateQueue` ponía `status = 'published'` con
`published_at` de ahora, mientras el resumen de la corrida contaba 0 publicadas. Es decir:
**la BD decía publicado, la UI decía que no se había publicado nada, y no había error visible.**

**El arreglo tiene dos capas:**

1. **En la fuente** (`group_poster.js:178`): el aviso ahora lleva `event: 'warn'` y ya **no**
   lleva `ok`. Estructuralmente no puede confundirse con un resultado.
2. **En el consumidor** (`groupPublisher.js:237`): `TERMINAL_STATUSES` define qué es un
   resultado —`published`, `prepared`, `dry-run`, `error`— y `parsePosterOutput()`
   (`groupPublisher.js:243`) solo acepta líneas con esos status. Los avisos se acumulan aparte
   en `warnings[]` y ya no se pierden: se escriben en `notes` (`updateQueue`,
   `groupPublisher.js:297`) y llegan al `results[]` de la corrida para que la UI los pueda mostrar.

`parsePosterOutput()` es una **función pura y exportada**: no toca Chrome ni la BD, así que el
contrato se puede testear con fixtures sin riesgo de publicar. Cubierto por 16 casos
(warn+publish, solo warn, la carrera del guard de timeout, errores reales, salida basura).

> Ojo con un detalle que se dejó intencionalmente: `parsePosterOutput` usa el **primer**
> terminal, no el último. El guard de timeout del poster (`group_poster.js:881`) no se cancela
> cuando el worker gana la carrera, así que tras un publish OK puede llegar una línea de error
> después. El primero es el bueno.

### 2. `GET /due` nunca marca como vencida lo programado para hoy 🟡

Dos consultas idénticas con **formatos de timestamp distintos**:

| Consulta | Formato del "ahora" | Línea |
|---|---|---|
| `dueCandidates()` (el publisher) | `2026-09-27T15:48:16.123Z` — `T` | `groupPublisher.js:181` |
| `GET /pub-queue/due` (la UI) | `2026-09-27 15:48:16` — espacio | `pubQueue.js:69` |

Y `scheduled_at` se almacena como lo mande el cliente. Comparando strings, en la posición 10
`'T'` (0x54) > `' '` (0x20), así que en `GET /due` un ítem programado para **hoy** sale siempre
"no vencido", incluso después de que pasara su hora. Lo comprobé ejecutando la comparación con
las dos formas: el publisher acierta, `GET /due` no.

**Alcance real:** la UI **nunca manda `scheduled_at`** (el payload de `:801-806` no lo incluye),
así que los ítems creados desde la cola siempre lo tienen en `NULL` y el bug no los afecta. Solo
pega a ítems creados por API o datos viejos — que es justo lo que muestra el badge
`📅 Programado para …` (`:287`). Si querés poder programar desde la UI, hay que unificar el
formato primero.

### 3. La línea `warn` del poster puede marcar un ítem como publicado sin haberlo publicado 🟡

`typeText()` emite un `console.log(JSON.stringify({ ok:true, status:'warn', … }))`
(`group_poster.js:171-175`) **antes** del resultado final, y el parser se queda con la
**primera** línea con `ok` (`groupPublisher.js:237-263`). Entonces: `ok:true` →
`updateQueue` marca `published` en la BD, pero el resumen de la corrida cuenta
`status==='published'` y da 0. O sea: **BD dice publicado, la UI dice que no se publicó nada**,
sin error visible.

### 4. `notes` se pisa siempre 🟢

`dueCandidates()` (`:183-189`) no selecciona la columna `notes`, así que en `updateQueue` la línea
`:263` parte siempre de `''`. Cada corrida **sobrescribe** el historial de notas en vez de
anexar. Si querés mostrar un historial de intentos en la UI, hay que agregar `pq.notes` al
SELECT.

### 5. `GET /timer` usa 4 h fijas, no `cooldown_min` 🟢

`MIN_INTERVAL_MS = 4 * 60 * 60 * 1000` hardcodeado en `pubQueue.js:10`. Hoy coincide con el
default (240), pero si cambiás el default la UI y el backend divergen sin avisar.

### 6. "Omitir" borra `published_at` 🟢

`pubQueue.js:139-141`: cualquier `status` distinto de `published` pone `published_at = NULL`. El
botón "Omitir" borra la fecha de publicación de ese ítem.

### 7. `COALESCE(pq.images, p.images)` 🟢

`'[]'` no es `NULL`, así que la cola **gana siempre** aunque esté vacía: un ítem con
`images = '[]'` ignora las fotos de `publications`.

### 8. `mode` no se valida en la API 🟢

`groupPublish.js:26` acepta cualquier string. Un `mode: 'dry-run'` hace que el poster simule pero
que `updateQueue` caiga en la rama `'prepared'`.

### 9. Dos formatos de `published_at` 🟢

`groupPublisher.js:299` escribe ISO con `Z`; `pubQueue.js:139` escribe formato SQL sin `Z`. Las
consultas de cap diario y cooldown comparan por string contra valores de ambos mundos.

### 10. Sin mutex con el ranking 🟡

Ranking y publicador comparten la **misma instancia** de Chrome (9222, mismo perfil) y sus
guards `running` son por módulo, así que pueden correr a la vez y pelearse las pestañas. El
ranking diario quedó a las 23:00; el publicador tiene su propia franja.

### 11. El Chrome de debug se cerraba solo 🟢

Diagnóstico hecho el 2026-09-28, con evidencia, no por teoría:

- Windows registra **0 crashes** de `chrome.exe` y el código **nunca** mata Chrome
  (no hay `taskkill` ni `Stop-Process`). Se descartó que "se_muera".
- La causa real: **Chrome se cierra entero cuando se cierra su última pestaña**, y
  `background_mode` está desactivado en el perfil. Comprobado: con 1 pestaña el puerto
  responde, se abre una segunda y sigue vivo, se cierra la de arranque y sigue vivo, y al
  cerrar la última el puerto da `ECONNREFUSED`.
- El launcher abre el Chrome con **una sola pestaña** (la Biblioteca de Contenido). Ese es
  el invariante frágil: si algo cierra esa pestaña, el publicador se queda sin navegador.
- `analyze_views.js` era la trampa: hace `puppeteer.connect()` al Chrome **compartido** y al
  terminar llamaba `browser.close()`, que termina el proceso remoto y se lleva por delante
  el navegador del publicador. Ahora usa `disconnect()`.

### 12. `ensureDebugChrome` daba por sano un Chrome trabado 🟢

`portResponds()` solo pregunta por `/json/version`. Se comprobó que un Chrome con el
**renderer trabado sigue contestando ese endpoint**, así que el early-return `already_running`
le pasaba un navegador muerto al poster, que se quedaba esperando hasta agotar su timeout de
280 s. El síntoma era `Network.enable timed out` en cualquier comando de Puppeteer.

Ahora, si el puerto responde pero ningún target de página evalúa, el launcher:

1. cierra **solo** esa instancia por CDP (`Browser.close`) — nunca busca ni mata procesos de
   Chrome por nombre, así que tu Chrome personal queda intacto;
2. espera a que el puerto se libere (si no, el proceso nuevo ve el lock del perfil, le pasa la
   URL al viejo y se sale, y `waitForPort` termina en timeout);
3. relanza.

`debugChromeReachable()` sigue siendo el chequeo pasivo de 800 ms que usa la UI en cada poll,
para no pagar el coste del chequeo real en cada lectura de estado.

> Al operar: si cerrás a mano la pestaña de la Biblioteca de Contenido del Chrome de debug,
> cerrás el navegador entero. Volvés a abrirlo con la UI o dejando que el launcher lo levante.

### 13. Falso negativo al confirmar la publicación 🟢

Síntoma: `Se hizo clic en Publicar pero el post no se envió (posible limitación o mensaje de
verificación)`, cuando **el post sí se había publicado**. Confirmado a mano el 2026-09-28: el
primer intento salió, el reintento sacó una segunda copia y hubo que borrar la primera a mano.

Causa: la comprobación tomaba `cands[0]`, el **primer** `[contenteditable]` visible con texto de
toda la página, que no es necesariamente el compositor del post (puede ser un comentario, una
búsqueda o el editor de otro post). Como ese campo nunca se vacía, el chequeo-after-publicar
fallaba siempre. Es el mismo criterio erróneo que usa `clickPublish()` para ubicar el compositor.

Ahora:

- se mide el editable visible con texto de **mayor área** (el compositor es un panel grande, los
  campos de comentario chicos);
- se relee el compositor al final: si quedó vacío, se declara **publicado** (la primera lectura
  puede llegar tarde, algo normal con posts largos o de 6+ imágenes);
- si el texto sigue ahí, el error lo dice explícitamente, en vez del genérico "posible
  limitación", e incluye el aviso de bloqueo de Facebook si aparece ("límite", "verificación",
  "intenta de nuevo más tarde", "spam").

> **Al reintentar un ítem que falló así, revisá el grupo antes.** Este error implicaba que había
> que borrar el post duplicado a mano, y un "reintentar" a ciegas lo vuelve a crear. El feed no
> renderiza en modo automatizado, así que el código no puede confirmarlo solo.

---

## Puntos de extensión

| Quiero… | Tocar |
|---|---|
| Cambiar el aspecto de una tarjeta | `renderPending()` `:279-325` |
| Agregar/quitar un botón por ítem | `renderPending()` `:315-321` + su `querySelectorAll` |
| Cambiar qué se considera "vencido" | `isDue` `:282` y/o `dueCandidates()` `groupPublisher.js:183` |
| Cambiar el ritmo o las pausas | `groupPublisher.js:440-443` (los 45-135 s) |
| Agregar un paso nuevo a la corrida | `runGroupPublish()` `:357-400` + un `phase` nuevo en `runProgressHtml` |
| Cambiar qué se muestra mientras corre | `runProgressHtml()` `:51` |
| Cambiar los textos de error | `group_poster.js` (los `out({... message: '...'})`) y `classifyFailure()` `groupPublisher.js:342` |
| Agregar un estado a la cola | `createSchema` + `migratePubQueue` + los UPDATE de `updateQueue` + el filtro de `dueCandidates` + el de `renderPending` `:236` |
| Cambiar los límites automáticos | `DEFAULT_AUTO_PUBLISH` + el clamp de `getAutopublishConfig()` + el form de Ajustes |

**Al agregar un estado nuevo**, actualizá los cuatro filtros que asumen el enum:
`dueCandidates()` (`:188`), `GET /due` (`pubQueue.js:74`), el filtro de la UI (`:236`) y el de
`renderHistory` (`:1002-1004`).

---

## Ver también

- [`../README.md`](../README.md) → sección **Publicador automático de grupos** (resumen de
  usuario final) y **API REST** (los endpoints).
- `utilidades/fb-ranking/group_poster.js` → cabecera con el detalle de la sesión de Facebook.
