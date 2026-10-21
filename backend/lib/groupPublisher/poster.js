// Invocación y lectura del poster (proceso hijo Puppeteer): parseo de su salida,
// notas para la cola y clasificación de fallos. Todo lo que no abre Chrome es
// puro; spawnPoster es el único que lanza el proceso hijo.
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAccountConfig } from '../accountConfig.js';
import { getMetodoTexto } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTER_JS = path.join(__dirname, '..', '..', '..', 'utilidades', 'fb-ranking', 'group_poster.js');

// Estados que el poster emite como resultado FINAL de un grupo. Cualquier otra
// línea de stdout (banner, logs, avisos 'warn') es intermedia y NO debe tocar la
// cola. Antes el parseo acceptaba cualquier objeto con clave `ok`, y el poster
// emite un `ok:true, status:'warn'` ANTES del resultado final cuando pierde
// saltos de línea: eso hacía que un ítem quedara marcado 'published' en la BD
// sin haberse publicado nunca, mientras el resumen de la corrida contaba 0.
// `revisar` es terminal: el poster hizo el clic pero no pudo confirmar el envío
// (el compositor no se vació y Facebook no mostró aviso, típico de red lenta).
// No es un fallo declarado del canal, así que la cola lo registra para revisión
// pero no lo cuenta para el breaker (ver cola.js). Si no estuviera acá, el
// parseo lo descartaría y el ítem saldría como "Sin salida del poster".
const TERMINAL_STATUSES = new Set(['published', 'prepared', 'dry-run', 'error', 'revisar']);

/**
 * Convierte la salida del poster en un único resultado. Función pura (no toca
 * ni Chrome ni la BD) para poder testear el contrato con fixtures.
 */
export function parsePosterOutput(stdout, { err = null, allText = '' } = {}) {
  const objs = String(stdout || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x && typeof x === 'object' && !Array.isArray(x));

  // Los avisos se acumulan aparte: son diagnósticos valiosos ("faltaron saltos
  // de línea al escribir") pero no son el resultado del post. Antes se perdían
  // porque el parseo cortaba en el primero.
  const warnings = objs
    .filter(x => x.status === 'warn' || x.event === 'warn')
    .map(x => x.message || 'aviso sin detalle');

  // .find y no el último a propósito: el guard de timeout del poster no se
  // cancela cuando el worker gana la carrera, así que tras un publish OK puede
  // llegar una línea de error después. El primer terminal es el bueno.
  const line = objs.find(x => TERMINAL_STATUSES.has(x.status));

  if (line) {
    const imgA = typeof line.imagen_adjunta === 'number' ? line.imagen_adjunta : null;
    if (imgA !== null) line.img_adjunta = imgA;
    const imgP = typeof line.imagenes_pedidas === 'number' ? line.imagenes_pedidas : null;
    if (imgP !== null) line.img_pedidas = imgP;
    // `adjuntos_confirmados` es el campo de confianza del poster. Va aparte de
    // img_adjunta porque aquel numero no se puede sostener contra el DOM actual
    // de FB (da 0 con los adjuntos presentes). Este si: se apoya en que
    // aparezcan los controles de "quitar foto".
    if (typeof line.adjuntos_confirmados === 'number') line.img_confirmados = line.adjuntos_confirmados;
    if (warnings.length) line.warnings = warnings;
    return line;
  }
  return {
    ok: false,
    status: 'error',
    message: (err?.message || allText || 'Sin salida del poster').slice(0, 300),
    ...(warnings.length ? { warnings } : {}),
  };
}

export function spawnPoster({ groupUrl, messageFile, imageFiles, mode, label, debug = false, loteN = 0, loteDesde = '', debugPort = 0 }) {
  return new Promise((resolve) => {
    // El poster es un proceso hijo: sin el puerto explícito siempre se conecta
    // al 9222 (el Chrome de A). Acá se le pasa el de ESTA cuenta para que la
    // cuenta B hable con su propio Chrome.
    const port = Number(debugPort) || getAccountConfig().debugPort;
    const args = [
      '--no-sandbox',
      '--groups=' + groupUrl,
      '--message-file=' + messageFile,
      '--mode=' + mode,
      '--label=' + label,
      // 420s < 470s (el timeout de execFile de abajo): así el GUARD interno del
      // poster salta primero y emite su JSON limpio de "Timeout de la operación",
      // en vez de que el proceso padre lo mate y se pierda la salida. Antes eran
      // 300s > 280s, y el padre mataba al hijo antes: quedaba un "Command failed"
      // sin ninguna pista de qué grupo ni por qué. Se subió de 300 a 420 porque,
      // con internet lento, el poster escala sus esperas hasta 3x (el presupuesto
      // de confirmar el envío pasa de 120s a 360s) y el guard tenía que quedar
      // por encima del peor caso escalado.
      '--max-seconds=420',
      '--debug-port=' + port,
      // Técnica de pegado configurable en Ajustes. Se lee por corrida, así que
      // un cambio en el panel aplica sin reiniciar el server.
      '--metodo-texto=' + getMetodoTexto(),
    ];
    if (debug) args.push('--debug=1');
    if (imageFiles.length) args.push('--images=' + imageFiles.join(';'));
    // El lote solo se pide si hay imágenes que adjuntar: "Añadir grupos" no
    // existe en el compositor con texto solo, y el poster lo comprueba igual.
    if (loteN > 1) {
      args.push('--lote-n=' + loteN);
      if (loteDesde) args.push('--lote-desde=' + loteDesde);
    }
    execFile(process.execPath, [POSTER_JS, ...args], { timeout: 470000 }, (err, stdout, stderr) => {
      const parsed = parsePosterOutput(stdout, { err, allText: `${stdout || ''}\n${stderr || ''}` });
      // El poster escribe en stderr justo lo que uno necesita para entender un
      // fallo: la línea [SUBMIT] con el botón que encontró (si estaba deshabilitado,
      // de qué tamaño era, si venía del panel del compositor o de un fallback
      // global) y la captura del fallo. Hasta ahora eso se juntaba en `allText`,
      // que solo se usa cuando el proceso no devolvió NADA — y como siempre
      // devuelve el JSON del resultado, se descartaba. Por eso el error del
      // 2026-10-03 decía "el texto sigue en el compositor" sin decir por qué.
      const diag = parsePosterDiag(stderr);
      if (diag && Object.keys(diag).length) Object.assign(parsed, diag);
      resolve(parsed);
    });
  });
}

/**
 * Saca del stderr del poster lo que sirve para diagnosticar un fallo.
 * Función pura: se puede testear con un stderr fixture.
 */
export function parsePosterDiag(stderr) {
  const txt = String(stderr || '');
  if (!txt) return {};
  const out = {};
  const submit = txt.split('\n').map(l => l.trim()).find(l => l.startsWith('[SUBMIT]'));
  if (submit) {
    try {
      const b = JSON.parse(submit.slice('[SUBMIT]'.length).trim());
      out.submit = {
        aria_disabled: b.dis ?? null,
        etiqueta: b.label ?? null,
        aria: b.aria ?? null,
        del_panel: !!b.scoped,
        tam: b.w && b.h ? `${b.w}x${b.h}` : null,
      };
    } catch { /* la línea vino corrupta: no es motivo para perder el resultado */ }
  }
  const fresh = txt.split('\n').map(l => l.trim()).find(l => l.startsWith('[FRESH]'));
  if (fresh) {
    try {
      const fr = JSON.parse(fresh.slice('[FRESH]'.length).trim());
      // [FRESH] sale en el camino de éxito: sirve para distinguir "no seMandó" de
      // "se mand\u00f3 pero no lo vimos", que antes eran el mismo error.
      if (fr && typeof fr === 'object') out.fresh = { encontrados: fr.found ?? null, articulos: fr.articles ?? null };
    } catch { /* idem */ }
  }
  return out;
}

/**
 * La evidencia del clic, en las notas del destino que falló.
 *
 * Sin esto, un "no se envió" no distingue tres cosas muy distintas: el botón
 * estaba deshabilitado y el clic no hizo nada (Facebook no lo tomó), el clic
 * cayó en un diálogo equivocado, o el post salió y no lo supimos leer. Con la
 * línea [SUBMIT] y la captura se puede decir cuál, sin adivinar.
 */
export function notaDiagnostico(result) {
  const s = result?.submit;
  const partes = [];
  if (s) {
    partes.push('botón ' + (s.del_panel ? 'del panel del compositor' : 'de la página (fallback)'));
    if (s.tam) partes.push(`de ${s.tam}`);
    if (s.aria_disabled === 'true') partes.push('DESHABILITADO: el clic no hacía nada');
    else if (s.aria_disabled) partes.push(`aria-disabled=${s.aria_disabled}`);
  }
  const aviso = String(result?.alert_text || '').trim();
  if (aviso) partes.push(`FB mostró: "${aviso.slice(0, 90)}"`);
  if (result?.screenshot) partes.push(`captura: ${result.screenshot}`);
  if (result?.fresh && result.fresh.encontrados === false) {
    partes.push('el post no aparece entre los artículos del grupo');
  }
  return partes.length ? ` | ${partes.join('; ')}` : '';
}

/**
 * Nota con los grupos del lote que el poster.tickó de verdad en el compositor.
 *
 * El poster siempre devuelve `lote_grupos` (y `grupos_en_lista`), pero en un
 * post exitoso `result.message` no se guarda en la cola, y ahí era donde venía
 * el texto del lote. La propagación a los N grupos quedaba invisible: no se
 * podía confirmar ni desde la cola ni desde los logs, porque el stdout del
 * poster se descarta y solo se parsean sus líneas JSON.
 *
 * Se escribe incluso con la lista vacía a propósito: "se pidió lote y no se
 * ticked ningún grupo" es justo lo que distingue un post que salió a un grupo
 * de uno que salió a nueve. Sin ese dato, un fallo de propagación se ve
 * idéntico a un éxito.
 *
 * Función pura: se testea sin base ni navegador.
 */
export function notaLote(result) {
  const estado = result?.lote_estado;
  const grupos = Array.isArray(result?.lote_grupos) ? result.lote_grupos.filter(Boolean) : null;
  const enLista = Number(result?.grupos_en_lista) || 0;

  // Sin `lote_estado` (corridas viejas o error antes de armar el lote) se cae al
  // comportamiento anterior: se anota el conteo si hubo, y la ausencia de grupos
  // solo se menciona si el poster sí mandó el array.
  if (!estado) {
    if (!Array.isArray(result?.lote_grupos)) return '';
    if (!grupos.length) return ' | lote: NO se tildó ningún grupo extra';
    return ` | lote: ${grupos.length}${enLista ? '/' + enLista : ''} grupos [${grupos.join(' | ')}]`.slice(0, 240);
  }

  if (estado === 'ok' && grupos && grupos.length) {
    // El tope es 240 y no 300 a propósito: `notes` se corta a 500 chars al final y
    // con 300 el lote se comía la nota de imágenes. El conteo va primero, así que
    // si trunca, lo que sobrevive es el dato que importa ("salió a 9 grupos").
    return ` | lote: ${grupos.length}${enLista ? '/' + enLista : ''} grupos [${grupos.join(' | ')}]`.slice(0, 240);
  }

  // Se intentó repartir y no se pudo: se avisa fuerte. El post SÍ salió (al grupo
  // destino), así que el status sigue 'published', pero la nota tiene que dejar
  // claro que NO se propagó a los N grupos. Sin esto, el 2026-10-16 nueve posts
  // que solo salieron a un grupo quedaron indistinguibles de un éxito total.
  if (estado === 'sin-boton') {
    return ` | ATENCIÓN lote: el botón "Añadir grupos" no apareció; el post salió SOLO en el grupo destino`;
  }
  if (estado === 'sin-grupos') {
    return ` | ATENCIÓN lote: no se pudo tildar ningún grupo${enLista ? ` de ${enLista}` : ''}; el post salió SOLO en el grupo destino`;
  }
  // 'no-aplicable': sin imágenes o lote apagado — no meter ruido en la nota.
  return '';
}

/**
 * Clasifica por qué falló un post, para que la UI no muestre un "error" pelado.
 * Mismo criterio que usa dailyRanking.js para separar sesión de navegador:
 *  - 'noBrowser': no hay Chrome escuchando en 9222
 *  - 'sesion':    el perfil de Facebook venció y hay muro de login
 */
/**
 * Pista accionable según la causa. Sin esto la UI muestra el mensaje crudo del
 * poster y el usuario no tiene ni idea de si reintentar sirve.
 */
export const CAUSAS = {
  noBrowser: 'No se pudo abrir Chrome. Prendé el navegador con depuración en el puerto 9222.',
  sesion: 'La sesión de Facebook venció o cambió. Entrá de nuevo y reintentá.',
  compositor: 'El compositor de Facebook no apareció, o el post no confirmó. Suele ser Facebook lento o un diálogo viejo tapándolo, no el grupo. Reintentá en un rato.',
  // Esta es la causa del 2026-10-03 y merece su propia línea. El compositor
  // aparece, se escribe el texto, se hace clic en "Publicar"... y no pasa nada.
  // Facebook no muestra ningún aviso, así que no es un error visible: es un
  // rechazo silencioso. Salió 30 veces seguidas en 2 horas y el corte automático
  // ahora frena esa cascada, pero mientras tanto la pista útil es otra: si el
  // botón salió deshabilitado, el clic fue a la nada y el problema es el ritmo.
  compositor_texto: 'Se hizo clic en Publicar y el texto se quedó en el compositor: Facebook no aceptó el envío y no mostró aviso. Casi siempre es que rechazó el ritmo de publicaciones. Bajá el ritmo y esperá antes de reintentar.',
};

export function classifyFailure(message) {
  const m = String(message || '');
  if (/no se pudo conectar a chrome|puerto 9222|localhost:9222|failed to fetch browser websocket|econnrefused|could not connect to chrome/i.test(m)) return 'noBrowser';
  if (/sesi[oó]n de facebook requerida|sesi[oó]n (expirada|venci[oó]da)|\/login|checkpoint|cookie_consent/i.test(m)) return 'sesion';
  // Va antes que 'compositor' y es más específica: el texto quedó adentro, o sea
  // que el compositor SÍ apareció y el clic no surtió efecto. Antes esto caía en
  // el mismo cajón que "no encontramos el compositor", que es otro problema.
  if (/se hizo clic en publicar pero el post no se envi[oó]|pero el post no se envi[oó]|sigue en el compositor/i.test(m)) return 'compositor_texto';
  // El poster no comprueba si el grupo está cerrado: solo que no halló el
  // compositor. Sin esta línea la UI lo muestra como "Error" pelado y el
  // usuario no tiene ni idea de que reintentar a ciegas no va a servir.
  if (/no se encontr[oó] el compositor|no se encontr[oó] el bot[oó]n publicar|el texto no qued[oó] en el compositor|pero el post no se envi[oó]|sigue en el compositor/i.test(m)) return 'compositor';
  return null;
}
