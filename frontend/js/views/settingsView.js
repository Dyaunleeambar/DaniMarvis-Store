import { api } from '../db/api.js';
import { showToast, confirmDialog, openModal, closeModal, setModalCloseGuard } from '../core/app.js';

let currentContainer = null;
let currentSettings = null;

export async function render(container) {
  currentContainer = container;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Cargando configuración...</div>';

  try {
    const [settings, categories, providerStyles, status] = await Promise.all([
      api.getSettings(),
      api.getCategories(),
      api.getProviderStyles(),
      // El estado trae los valores efectivos de las cuentas A y B (base →
      // entorno → default). Se usa solo para PINTAR los campos: si no hay
      // sesión o el endpoint falla, la sección de cuentas se pinta con los
      // defaults de la config guardada.
      api.getStatus().catch(() => null),
    ]);
    currentSettings = settings;
    renderPage(container, settings, categories, providerStyles, status);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

// Límite numérico para los campos del disparador por fecha.
//
// El backend recampa igual (getAgendaConfig), pero recampar acá evita mandar
// NaN: `parseInt('abc') || 15` da 15 por casualidad, y `Number('abc')` da NaN
// que se serializa como `null` en el JSON. Este helper es el único lugar donde
// se decide qué se guarda, así que los rangos están anotados junto al valor.
function limite(valor, def, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Valores a pintar para una cuenta: lo guardado si realmente está configurado,
 * o si no, el efectivo que informó el servidor (que ya mezcló base, entorno y
 * default).
 *
 * Lo que se pinta es lo que se va a reenviar, así que un campo "sin configurar"
 * tiene que pintarse con el valor que el servidor YA está usando: si se pintara
 * vacío, el primer "Guardar cuentas" congelaría en la base lo que hoy viene del
 * entorno y que nadie estaba editando.
 *
 * El proxy es la excepción a propósito: un string vacío guardado es "sin proxy"
 * explícito, y tiene que pintarse vacío, no heredar el de otro lado.
 */
function pintarCuenta(id, guardada, efectivas) {
  const g = guardada && typeof guardada === 'object' ? guardada : {};
  const e = efectivas.find((c) => c && c.id === id) || {};
  const portN = Number(g.debugPort);
  const portOk = Number.isFinite(portN) && portN >= 1024 && portN <= 65535;
  const perfilOk = typeof g.profileDir === 'string' && g.profileDir.trim() !== '';
  return {
    label: (typeof g.label === 'string' && g.label.trim()) || e.label || `Cuenta ${id}`,
    profileDir: perfilOk ? g.profileDir.trim() : (e.profileDir ?? ''),
    debugPort: portOk ? portN : (e.debugPort ?? ''),
    proxy: typeof g.proxy === 'string' ? g.proxy.trim() : (e.proxy ?? ''),
    // Perfil de Facebook esperado (referencia + verificación). Si no hay guardado
    // ni efectivo, queda vacío: no se verifica y no se pinta nada raro.
    fbProfile: (typeof g.fbProfile === 'string' && g.fbProfile.trim()) || (e.fbProfile || ''),
  };
}

function bloqueCuenta(id, c) {
  return `
    <fieldset style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:12px">
      <legend style="font-weight:600;font-size:.85rem;padding:0 6px">${id === 'A' ? '👤' : '👥'} Cuenta ${id}</legend>
      <div class="form-row">
        <div class="form-group">
          <label>Nombre / etiqueta</label>
          <input type="text" name="ct_${id}_label" class="form-control" value="${esc(c.label)}" placeholder="Cuenta ${id}" />
        </div>
        <div class="form-group">
          <label>Puerto de depuración de Chrome</label>
          <input type="number" name="ct_${id}_port" class="form-control" min="1024" max="65535" value="${esc(c.debugPort)}" />
          <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Cada cuenta abre su Chrome en su propio puerto (9222 / 9223).</small>
        </div>
      </div>
      <div class="form-group">
        <label>Perfil de Chrome (sesión de Facebook)</label>
        <input type="text" name="ct_${id}_profile" class="form-control" value="${esc(c.profileDir)}" placeholder="C:/Users/Dani/fb-leave/fb-debug-perfil${id === 'B' ? '-b' : ''}" />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Ruta del <code>--user-data-dir</code>: ahí vive la sesión de Facebook de esa cuenta. Las dos rutas tienen que ser DISTINTAS.</small>
      </div>
      <div class="form-group">
        <label>Proxy (opcional, para IP distinta por cuenta)</label>
        <input type="text" name="ct_${id}_proxy" class="form-control" value="${esc(c.proxy)}" placeholder="http://usuario:clave@host:puerto" />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Vacío = sale por la IP de esta máquina.</small>
      </div>
      <div class="form-group">
        <label>Perfil de Facebook que debe usar esta cuenta</label>
        <input type="text" name="ct_${id}_fbprofile" class="form-control" value="${esc(c.fbProfile)}" placeholder="https://www.facebook.com/profile.php?id=..." />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
          Se usa para <strong>verificar</strong> que al publicar la sesión de esa carpeta de Chrome sea este perfil.
          La app NO inicia sesión sola: logueate a mano con el botón de abajo. Vacío = no se verifica.
        </small>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
        <button type="button" class="btn btn--secondary" data-open-login="${id}">Abrir Chrome para loguear</button>
        <button type="button" class="btn btn--ghost" data-check-profile="${id}">Verificar sesión</button>
        <span data-profile-status="${id}" style="font-size:.8rem;color:var(--text-secondary)"></span>
      </div>
    </fieldset>`;
}

/** Sección de Ajustes con las dos cuentas de Facebook que usa el publicador. */
function cuentasCardHTML(CUENTAS) {
  return `
      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">Cuentas de Facebook (A y B)</h3>
        <p style="margin:0 0 12px;font-size:.82rem;color:var(--text-secondary)">
          Cada corrida publica con <strong>una</strong> cuenta, y con ella se abre su Chrome, su
          perfil de Facebook y su proxy. El <strong>modo</strong> decide cuál: en <em>alternar</em>,
          una corrida A, la siguiente B. Los cambios se aplican al volver a publicar, sin reiniciar.
        </p>
        <form id="cuentas-form">
          <div class="form-group">
            <label>Cuenta que publica</label>
            <select name="ct_modo" class="form-control">
              <option value="alternado" ${CUENTAS.modo === 'alternado' ? 'selected' : ''}>Alternar entre A y B (una corrida A, la siguiente B)</option>
              <option value="A" ${CUENTAS.modo === 'A' ? 'selected' : ''}>Siempre la cuenta A</option>
              <option value="B" ${CUENTAS.modo === 'B' ? 'selected' : ''}>Siempre la cuenta B</option>
            </select>
          </div>
          ${bloqueCuenta('A', CUENTAS.A)}
          ${bloqueCuenta('B', CUENTAS.B)}
          <div class="form-actions" style="margin-top:16px">
            <button type="submit" class="btn btn--primary">Guardar cuentas</button>
          </div>
        </form>
      </div>`;
}

/** Escapa el valor para poder meterlo en un atributo del template. */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Sección de Ajustes con la técnica de pegado del texto. Se puede elegir para
 * probar en publicaciones reales cuál funciona mejor: la fidelidad al publicar
 * no se ve en el compositor, así que hay que compararla en el muro.
 */
function metodoTextoCardHTML(METODO) {
  return `
      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">Técnica para poner el texto</h3>
        <p style="margin:0 0 12px;font-size:.82rem;color:var(--text-secondary)">
          Cómo se escribe el texto en el compositor. Si la técnica elegida falla, el publicador
          cae solo al <strong>teclado</strong> (nunca queda peor que antes) y lo deja anotado.
        </p>
        <form id="metodo-texto-form">
          <div class="form-group">
            <label>Técnica</label>
            <select name="mt_metodo" class="form-control">
              <option value="teclado" ${METODO === 'teclado' ? 'selected' : ''}>Teclado (actual) — tipea caracter a caracter, probado pero lento</option>
              <option value="insertText" ${METODO === 'insertText' ? 'selected' : ''}>A · Inserción directa (Input.insertText) — rápido; deja el texto en un solo bloque</option>
              <option value="ctrlv" ${METODO === 'ctrlv' ? 'selected' : ''}>B · Portapapeles + Ctrl+V — pegado real; pisa tu portapapeles</option>
              <option value="pasteEvent" ${METODO === 'pasteEvent' ? 'selected' : ''}>C · Pegado sintético — como B pero sin usar el portapapeles (recomendado)</option>
            </select>
          </div>
          <p id="mt-aviso" style="display:none;margin:0 0 12px;font-size:.8rem;color:var(--warning,#e8a300)">
            Ojo con la técnica B: escribe el portapapeles del sistema en cada post. Si copiás algo
            mientras corre, el pegado puede tomar ese texto ajeno (hay una guarda que suele detectarlo,
            pero no es infalible).
          </p>
          <div class="form-actions" style="margin-top:8px">
            <button type="submit" class="btn btn--primary">Guardar técnica</button>
          </div>
        </form>
      </div>`;
}

// Rangos, valores de siempre y perfiles de Ajustes > Tiempos. COPIA de
// backend/lib/groupPublisher/tiempos.js (TIEMPOS_UI): la vista no puede importar
// el backend. scripts/test-tiempos.mjs verifica que este literal sea idéntico;
// si cambias un rango o un perfil, cámbialo en los dos sitios. El backend vuelve
// a validar todo al guardar, esto solo guía los campos de la pantalla.
const TIEMPOS_UI = {
  "defaults": {
    "composer_s": 3.2,
    "aviso_s": 2.2,
    "vaciado_s": 30,
    "confirmacion_s": 120,
    "muestras_vacio": 6,
    "colchon_red_s": 1.5
  },
  "limites": {
    "composer_s": {
      "min": 1.5,
      "max": 5
    },
    "aviso_s": {
      "min": 1,
      "max": 6
    },
    "vaciado_s": {
      "min": 10,
      "max": 60
    },
    "confirmacion_s": {
      "min": 30,
      "max": 120
    },
    "muestras_vacio": {
      "min": 3,
      "max": 10,
      "entero": true
    },
    "colchon_red_s": {
      "min": 0.5,
      "max": 5
    }
  },
  "perfiles": {
    "seguro": {
      "composer_s": 3.2,
      "aviso_s": 2.2,
      "vaciado_s": 30,
      "confirmacion_s": 120,
      "muestras_vacio": 6,
      "colchon_red_s": 1.5,
      "confirm_red": false
    },
    "rapido": {
      "composer_s": 2.5,
      "aviso_s": 1.5,
      "vaciado_s": 15,
      "confirmacion_s": 60,
      "muestras_vacio": 4,
      "colchon_red_s": 1,
      "confirm_red": true
    }
  }
};

const TIEMPOS_CAMPOS = [
  { clave: 'composer_s', grupo: 'Compositor', titulo: 'Espera por intento (s)',
    ayuda: 'Cuánto espera tras cada intento de abrir el compositor (hasta 6 intentos). Más bajo reintenta antes.', paso: 0.1 },
  { clave: 'aviso_s', grupo: 'Después de publicar', titulo: 'Ventana del aviso «Publicando…» (s)',
    ayuda: 'Tras pulsar Publicar, cuánto se busca el aviso de confirmación de Facebook.', paso: 0.1 },
  { clave: 'vaciado_s', grupo: 'Después de publicar', titulo: 'Tope para que el compositor se vacíe (s)',
    ayuda: 'Si el texto sigue en el compositor pasado este tiempo, se avisa y se sigue.', paso: 1 },
  { clave: 'confirmacion_s', grupo: 'Después de publicar', titulo: 'Tope para confirmar el envío (s)',
    ayuda: 'Si pasa este tiempo sin confirmación se cierra igual y se anota «no se pudo confirmar».', paso: 1 },
  { clave: 'muestras_vacio', grupo: 'Cierre de la pestaña', titulo: 'Lecturas seguidas con el compositor vacío',
    ayuda: 'Cada lectura es de ~1 s. Menos lecturas cierra antes, con menos certeza.', paso: 1 },
  { clave: 'colchon_red_s', grupo: 'Cierre de la pestaña', titulo: 'Colchón de red quieta (s)',
    ayuda: 'Silencio de red exigido antes de cerrar. Solo cuenta con la confirmación rápida.', paso: 0.1 },
];

/**
 * Sección de Ajustes > Tiempos. Tres perfiles: Seguro (los valores de siempre),
 * Rápido y Personalizado (cada tiempo editable dentro de su rango). La
 * confirmación rápida por red vive acá: apagada, el publicador solo MIDE cuándo
 * habría podido cerrar la pestaña (`[ENVIO-RED]` en el log) sin cambiar nada;
 * encendida, cierra apenas la red confirma el envío.
 */
function tiemposCardHTML(perfil, valores, confirmRed) {
  const grupos = [];
  for (const c of TIEMPOS_CAMPOS) {
    let g = grupos.find((x) => x.nombre === c.grupo);
    if (!g) { g = { nombre: c.grupo, campos: [] }; grupos.push(g); }
    g.campos.push(c);
  }
  const lim = TIEMPOS_UI.limites;
  const camposHTML = grupos.map((g) => `
          <fieldset style="border:0;padding:0;margin:0 0 12px">
            <legend style="font-weight:600;font-size:.85rem;margin-bottom:6px">${g.nombre}</legend>
            ${g.campos.map((c) => `
            <div class="form-group" style="margin-bottom:8px">
              <label style="display:block">${c.titulo}
                <span style="color:var(--text-secondary);font-size:.78rem">(de siempre: ${TIEMPOS_UI.defaults[c.clave]}; permitido ${lim[c.clave].min}–${lim[c.clave].max})</span>
              </label>
              <input type="number" class="form-control" name="t_${c.clave}" step="${c.paso}"
                min="${lim[c.clave].min}" max="${lim[c.clave].max}" value="${valores[c.clave]}">
              <small style="color:var(--text-secondary)">${c.ayuda}</small>
            </div>`).join('')}
          </fieldset>`).join('');
  return `
      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">Tiempos del publicador</h3>
        <p style="margin:0 0 12px;font-size:.82rem;color:var(--text-secondary)">
          Ajusta cuánto espera el publicador en cada fase. <strong>Seguro</strong> son los valores de
          siempre; <strong>Rápido</strong> los acorta; en <strong>Personalizado</strong> puedes probar
          cada tiempo. Con internet lento el publicador los multiplica solo (hasta 3 veces).
        </p>
        <p style="margin:0 0 12px;font-size:.8rem;color:var(--warning,#e8a300)">
          Ojo: un tiempo demasiado corto puede cerrar la pestaña mientras Facebook todavía envía el
          post. El post se pierde y aun así queda registrado como publicado (con la nota «no se pudo
          confirmar el envío»). Cambia de a un parámetro y revisa el log (<code>[TIEMPOS]</code> y
          <code>[ENVIO-RED]</code>) antes de seguir.
        </p>
        <form id="tiempos-form">
          <div class="form-group">
            <label>Perfil</label>
            <select name="t_perfil" class="form-control">
              <option value="seguro" ${perfil === 'seguro' ? 'selected' : ''}>Seguro — los valores de siempre</option>
              <option value="rapido" ${perfil === 'rapido' ? 'selected' : ''}>Rápido — esperas más cortas y confirmación rápida</option>
              <option value="personalizado" ${perfil === 'personalizado' ? 'selected' : ''}>Personalizado — tú eliges cada tiempo</option>
            </select>
          </div>
          ${camposHTML}
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="t_confirm_red" ${confirmRed ? 'checked' : ''}>
              Confirmación rápida: cerrar la pestaña apenas la red confirme el envío
            </label>
            <small style="color:var(--text-secondary)">Apagada, el publicador solo anota en el log cuándo habría podido cerrar.</small>
          </div>
          <div class="form-actions" style="margin-top:8px">
            <button type="submit" class="btn btn--primary">Guardar tiempos</button>
          </div>
        </form>
      </div>`;
}

function renderPage(container, settings, categories, providerStyles, status) {
  const pc = settings.publish_config || {};
  const template = pc.template || '';
  const ai = pc.ai || {};
  const fb = pc.facebook || {};
  const ap = pc.autopublish || {};
  const ag = pc.agenda || {};
  // Defaults del backend (DEFAULT_AGENDA en backend/lib/groupPublisher/config.js).
  // Se repiten acá para que los campos nazcan con el valor real en pantalla:
  // estas claves no viven en la base hasta que el usuario las toque, así que sin
  // esto los inputs se verían vacíos aunque el servidor esté aplicando otro valor.
  const AG = {
    auto: true, tick_min: 1, catchup_hours: 24,
    min_gap_min: 15, max_per_hour: 4, dedupe_hours: 6,
    breaker_failures: 3, breaker_cooldown_min: 60,
    auto_retry: true, retry_max: 2, retry_delay_min: 15,
  };
  const ms = pc.master || { on: true };
  const rk = pc.ranking || {};

  // Cuentas de Facebook (A y B): lo que se guarda en `publish_config.cuentas`.
  // Se prefilan con los valores EFECTIVOS que devuelve /api/status (base →
  // entorno → default), así quien llega con variables de entorno ve lo que está
  // usando en vez de campos vacíos.
  const savedCuentas = (pc.cuentas && typeof pc.cuentas === 'object') ? pc.cuentas : {};
  const efectivas = (status && Array.isArray(status.cuentas)) ? status.cuentas : [];
  const CUENTAS = {
    modo: ['alternado', 'A', 'B'].includes(savedCuentas.modo) ? savedCuentas.modo
      : ['alternado', 'A', 'B'].includes(status?.modo) ? status.modo : 'alternado',
    A: pintarCuenta('A', savedCuentas.A, efectivas),
    B: pintarCuenta('B', savedCuentas.B, efectivas),
  };

  // Técnica de pegado del texto (publish_config.metodo_texto). Cualquier valor
  // raro cae a 'teclado', igual que en el backend.
  const METODO = ['teclado', 'insertText', 'ctrlv', 'pasteEvent'].includes(pc.metodo_texto)
    ? pc.metodo_texto : 'teclado';

  // Tiempos (publish_config.tiempos). Mismo criterio que resolverTiempos() del
  // backend: sin `tiempos` guardado, quien ya tenía la confirmación rápida activada
  // (publish_config.confirm_red === true) queda como "personalizado".
  const tg = pc.tiempos && typeof pc.tiempos === 'object' ? pc.tiempos : null;
  const PERFILES_OK = ['seguro', 'rapido', 'personalizado'];
  const TIEMPOS_PERFIL = tg && PERFILES_OK.includes(tg.perfil) ? tg.perfil : (pc.confirm_red === true ? 'personalizado' : 'seguro');
  const TIEMPOS_PERSONAL = { ...TIEMPOS_UI.defaults, ...((tg && tg.valores) || {}) };
  const TIEMPOS_RED_PERSONAL = tg ? tg.confirm_red === true : pc.confirm_red === true;
  const TIEMPOS_INICIAL = TIEMPOS_PERFIL === 'personalizado' ? TIEMPOS_PERSONAL : TIEMPOS_UI.perfiles[TIEMPOS_PERFIL];

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Configuración</h1>
          <p>Tipo de cambio, categorías y texto de publicación</p>
        </div>
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card">
          <h3 style="margin:0 0 16px">Tipo de cambio</h3>
          <form id="settings-form">
            <div class="form-group">
              <label>Tipo de cambio (1 USD = ? MN)</label>
              <input type="number" name="exchange_rate" class="form-control"
                value="${settings.exchange_rate}" min="1" step="1" required />
              <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                Se usa en ventas e imágenes promocionales. Actualízalo según la tasa del día.
              </small>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Guardar</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h3 style="margin:0 0 12px">Info</h3>
          <ul style="font-size:.85rem;color:var(--text-secondary);line-height:1.8;padding-left:16px;margin:0">
            <li>Los precios de productos se ingresan en <strong>USD</strong></li>
            <li>Las comisiones pueden ser en <strong>USD</strong> o <strong>MN</strong> según el proveedor</li>
            <li>En ventas, el total se muestra en USD + MN</li>
            <li>Al renombrar una categoría, los productos asociados se actualizan automáticamente</li>
          </ul>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">Plantilla de publicación</h3>
        <p style="margin:0 0 16px;font-size:.82rem;color:var(--text-secondary)">
          Definí el formato del texto que se genera automáticamente. Usá los placeholders
          <code>{NAME}</code>, <code>{PRICE}</code>, <code>{DESCRIPTION}</code>,
          <code>{WARRANTY}</code>, <code>{CATEGORY}</code>, <code>{STOCK}</code>
          para insertar datos del producto.
        </p>
        <form id="publish-template-form">
          <div class="form-group">
            <label>Plantilla</label>
            <textarea name="template" class="form-control" style="min-height:220px;font-family:monospace;font-size:.82rem;line-height:1.5">${escHtml(template)}</textarea>
          </div>

          <details style="margin-top:16px" ${ai.enabled ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">⚙ Generación con IA (opcional)</summary>
            <div style="margin-top:12px">
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
                  <input type="checkbox" name="ai_enabled" value="1" ${ai.enabled ? 'checked' : ''} style="width:16px;height:16px" />
                  Habilitar generación automática de descripciones con IA
                </label>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>API URL</label>
                  <input type="url" name="ai_api_url" class="form-control" value="${escAttr(ai.api_url || 'https://openrouter.ai/api/v1')}" placeholder="https://openrouter.ai/api/v1" />
                </div>
                <div class="form-group">
                  <label>Modelo</label>
                  <input type="text" name="ai_model" class="form-control" value="${escAttr(ai.model || 'nex-agi/nex-n2.5-mini:free')}" placeholder="nex-agi/nex-n2.5-mini:free" />
                  <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Para importar por IA en Importar/Sincronizar, el modelo debe soportar <b>visión</b>. Probado: <code>inclusionai/ling-3.0-flash-vl</code>. Si no, usá el motor Local (OCR).</small>
                </div>
              </div>
              <div class="form-group">
                <label>API Key</label>
                <input type="password" name="ai_api_key" class="form-control" value="${ai._api_key_set ? '' : escAttr(ai.api_key || '')}" placeholder="${ai._api_key_set ? 'Configurada — dejá vacío para conservar' : 'sk-or-v1-... / AIza...'}" style="${ai._api_key_set ? 'border-color:var(--success)' : ''}" />
                ${ai._api_key_set ? `<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:.78rem;color:var(--text-secondary)"><input type="checkbox" name="ai_remove_key" value="1" /> Eliminar API Key guardada</label>` : ''}
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                  Probá gratis con <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>
                  (URL: <code>https://openrouter.ai/api/v1</code>, modelo: <code>nex-agi/nex-n2.5-mini:free</code>)
                  o con <a href="https://console.groq.com" target="_blank" rel="noopener">Groq</a>
                  (URL: <code>https://api.groq.com/openai/v1</code>, modelo: <code>llama-3.3-70b-versatile</code>).
                  Los modelos <code>:free</code> de OpenRouter cambian; si fallan, elegí otro de la lista <a href="https://openrouter.ai/models?fmt=cards&order=top-weekly&q=free" target="_blank" rel="noopener">free</a>.
                </small>
              </div>
              <div class="form-group">
                <label>Prompt del sistema</label>
                <textarea name="ai_system_prompt" class="form-control" style="min-height:100px;font-size:.82rem">${escHtml(ai.system_prompt || '')}</textarea>
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">Instrucciones para la IA sobre cómo generar la descripción del producto</small>
              </div>
            </div>
          </details>

          <details style="margin-top:12px" ${fb.page_id ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">🌐 Publicación en Facebook (opcional)</summary>
            <div style="margin-top:12px">
              <div class="form-row">
                <div class="form-group">
                  <label>Facebook Page ID</label>
                  <input type="text" name="fb_page_id" class="form-control" value="${escAttr(fb.page_id || '')}" placeholder="Ej: 123456789012345" />
                </div>
                <div class="form-group">
                  <label>Instagram Account ID (opcional)</label>
                  <input type="text" name="fb_instagram_id" class="form-control" value="${escAttr(fb.instagram_id || '')}" placeholder="Ej: 17841400000000000" />
                </div>
              </div>
              <div class="form-group">
                <label>Facebook Page Access Token</label>
                <input type="password" name="fb_access_token" class="form-control" value="${fb._access_token_set ? '' : escAttr(fb.access_token || '')}" placeholder="${fb._access_token_set ? 'Token configurado — dejá vacío para conservar' : 'EAAC...'}" style="${fb._access_token_set ? 'border-color:var(--success)' : ''}" />
                ${fb._access_token_set ? `<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:.78rem;color:var(--text-secondary)"><input type="checkbox" name="fb_remove_token" value="1" /> Eliminar token guardado</label>` : ''}
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                  Token de larga duración. Se genera desde Facebook Developers. Requiere permisos: <code>pages_manage_posts</code>, <code>pages_read_engagement</code>.
                </small>
              </div>
              <div class="form-group">
                <label>Expiración del token (fecha)</label>
                <input type="date" name="fb_token_expires_at" class="form-control" value="${escAttr(fb.token_expires_at || '')}" />
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                  Los tokens de página duran 60 días. Guardá la fecha de vencimiento para que el panel te avise en Rutinas de Página.
                </small>
              </div>
            </div>
          </details>

          <details open style="margin-top:12px;border:1px solid ${ms.on ? 'var(--success)' : 'var(--danger, #dc3545)'};border-radius:12px;padding:16px;background:${ms.on ? 'rgba(40,199,111,.05)' : 'rgba(220,53,69,.05)'}">
            <summary style="cursor:pointer;font-weight:700;font-size:.95rem;color:${ms.on ? 'var(--success)' : 'var(--danger, #dc3545)'}">🔌 Interruptor maestro del publicador</summary>
            <p style="margin:8px 0 12px;font-size:.8rem;color:var(--text-secondary)">
              Es la llave general de <strong>todo</strong> el publicador: el disparador por fecha, el
              worker automático y hasta el botón "Publicar ahora". Apagado, el sistema no publica
              nada aunque haya publicaciones pendientes o vencidas; quedan esperando en la cola y
              salen cuando lo prendas de nuevo.
            </p>
            <div class="form-group" style="margin:0">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;font-size:.9rem">
                <input type="checkbox" name="ms_on" value="1" ${ms.on === false ? '' : 'checked'} style="width:18px;height:18px" />
                ${ms.on === false
                  ? '<strong style="color:var(--danger, #dc3545)">Publicador APAGADO — no se publica nada hasta que lo prendas</strong>'
                  : '<strong style="color:var(--success)">Publicador ENCENDIDO</strong>'}
              </label>
            </div>
          </details>

          <details style="margin-top:12px" open>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">📅 Disparador por fecha ${ag.auto === false ? '(apagado)' : '(activo)'}</summary>
            <p style="margin:8px 0 12px;font-size:.8rem;color:var(--text-secondary)">
              Es el reloj que publica lo que agendás en <strong>Publicaciones</strong>. Revisa la agenda
              cada minuto y, cuando llega la hora de un evento, publica en todos sus grupos.
              No tiene límite de posts, ni franja horaria, ni separación: la hora y los grupos los
      elegís vos, evento por evento.
            </p>
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
                <input type="checkbox" name="ag_auto" value="1" ${ag.auto === false ? '' : 'checked'} style="width:16px;height:16px" />
                Publicar solo lo que está agendado
              </label>
              <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:4px">
                Apagado, podés seguir agendando: los eventos se acumulan como vencidos y se publican
                todos juntos cuando lo vuelvas a prender.
              </small>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Revisar la agenda cada (min)</label>
                <input type="number" name="ag_tick" class="form-control" min="1" max="15" value="${ag.tick_min ?? AG.tick_min}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">1 minuto = lo más exacto. Se aplica al guardar, sin reiniciar.</small>
              </div>
              <div class="form-group">
                <label>Recuperar vencidos hasta (h)</label>
                <input type="number" name="ag_catchup" class="form-control" min="0" max="168" value="${ag.catchup_hours ?? AG.catchup_hours}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Si el server estuvo apagado, se publica lo que venció dentro de esta ventana. Lo más
                  viejo que esto queda marcado como <em>Omitida</em>: no se publica solo, para no salir
                  un post de hace tres días sin que lo veas.
                </small>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Separación mínima entre posts (min)</label>
                <input type="number" name="ag_gap" class="form-control" min="1" max="1440" value="${ag.min_gap_min ?? AG.min_gap_min}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Espera mínima desde el último <em>intento</em>, no desde el último post: si
                  un post falla, la espera igual corre. Contra el reloj real cada corrida
                  tarda 2-4 min, así que abajo de 4 no cambia nada.
                </small>
              </div>
              <div class="form-group">
                <label>Tope de intentos por hora</label>
                <input type="number" name="ag_hour" class="form-control" min="1" max="60" value="${ag.max_per_hour ?? AG.max_per_hour}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Techo duro por hora, contando también los que fallan y los que clickeás a mano.
                  <strong>Ojo:</strong> el ritmo real es el menor de los dos límites,
                  <code>min(60/separación, tope)</code>. Con 15 y 4 dan 4/hora: son el mismo
                  número. Para publicar más hay que bajar <em>los dos</em>.
                </small>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>No repetir texto en el mismo grupo (h)</label>
                <input type="number" name="ag_dedupe" class="form-control" min="0" max="168" value="${ag.dedupe_hours ?? AG.dedupe_hours}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  0 desactiva la guardia: el duplicado se cancela solo y queda esperando
                  decisión tuya en el calendario.
                </small>
              </div>
              <div class="form-group">
                <label>Fallos que pausan el disparador</label>
                <input type="number" name="ag_brk_n" class="form-control" min="1" max="20" value="${ag.breaker_failures ?? AG.breaker_failures}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Con la pausa de al lado: corta todo y avisa, en vez de seguir insistiendo
                  contra Facebook. Son los que dejaron 30 errores iguales el 2026-10-03.
                </small>
              </div>
              <div class="form-group">
                <label>Pausa del corte (min)</label>
                <input type="number" name="ag_brk_min" class="form-control" min="5" max="1440" value="${ag.breaker_cooldown_min ?? AG.breaker_cooldown_min}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Cuánto queda cortado después de alcanzar el número de fallos de arriba.
                </small>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:6px">
                  <input type="checkbox" name="ag_autoretry" ${ag.auto_retry !== false ? 'checked' : ''} />
                  Reintentar solos los fallos de red
                </label>
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  Solo timeouts y cortes de conexión. Los errores de ritmo, grupo cerrado
                  o sin permiso NO se reintentan solos (ahí reintentar empeora).
                </small>
              </div>
              <div class="form-group">
                <label>Máx. reintentos automáticos</label>
                <input type="number" name="ag_retry_max" class="form-control" min="0" max="10" value="${ag.retry_max ?? AG.retry_max}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  0 desactiva el reintento aunque el interruptor esté prendido. Al agotarse
                  queda en error para que lo mires vos.
                </small>
              </div>
              <div class="form-group">
                <label>Espera antes de reintentar (min)</label>
                <input type="number" name="ag_retry_delay" class="form-control" min="1" max="1440" value="${ag.retry_delay_min ?? AG.retry_delay_min}" />
                <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">
                  No es inmediato a propósito: esperar deja que se recupere la red y evita
                  que el reintento cuente como insistencia contra Facebook. Respeta el gap
                  y el tope por hora de arriba.
                </small>
              </div>
            </div>
            <p style="margin:10px 0 0;font-size:.78rem;color:var(--text-secondary)">
              <strong>Requiere el server encendido.</strong> Este reloj vive en el proceso del backend:
              si apagás la app, no hay nadie mirando la agenda. Por eso existe la ventana de
              recuperación de arriba.
            </p>
          </details>

          <details style="margin-top:12px" ${ap.enabled ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--text-secondary)">🤖 Worker con límites (opcional) — ${ap.enabled ? `activo · máx ${ap.daily_cap ?? 6}/día · ${ap.hours_from ?? 8}:00–${ap.hours_to ?? 21}:00 · gap ${ap.min_gap_min ?? 45} min · cada ${ap.tick_min ?? 5} min` : 'apagado'}</summary>
            <p style="margin:8px 0 12px;font-size:.8rem;color:var(--text-secondary)">
              Es un segundo reloj, más conservador, pensado para publicar sin que vos tengas que agendar
              nada. Mira lo que quedó en <em>pendiente</em> y lo publica usando tu Chrome
              (requiere <code>--remote-debugging-port=9222</code> logueado en Facebook), imitando un
              flujo natural: cap diario, franja horaria y separación entre posts.
            </p>
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
                <input type="checkbox" name="ap_enabled" value="1" ${ap.enabled ? 'checked' : ''} style="width:16px;height:16px" />
                Habilitar el worker automático cada 5 minutos
              </label>
            </div>
            <div class="form-group">
              <label>Modo por defecto</label>
              <select name="ap_mode" class="form-control">
                <option value="publish" ${ap.mode !== 'prepare' ? 'selected' : ''}>Publicar directo</option>
                <option value="prepare" ${ap.mode === 'prepare' ? 'selected' : ''}>Preparar en pestaña (borrador, publicás vos)</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Cap diario (posts)</label>
                <input type="number" name="ap_daily_cap" class="form-control" min="1" max="200" value="${ap.daily_cap ?? 6}" />
              </div>
              <div class="form-group">
                <label>Franja desde (hora)</label>
                <input type="number" name="ap_hours_from" class="form-control" min="0" max="23" value="${ap.hours_from ?? 8}" />
              </div>
              <div class="form-group">
                <label>Franja hasta (hora)</label>
                <input type="number" name="ap_hours_to" class="form-control" min="1" max="24" value="${ap.hours_to ?? 21}" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Separación entre posts (min)</label>
                <input type="number" name="ap_min_gap" class="form-control" min="5" max="600" value="${ap.min_gap_min ?? 45}" />
              </div>
              <div class="form-group">
                <label>Posts por tick del worker</label>
                <input type="number" name="ap_batch" class="form-control" min="1" max="20" value="${ap.worker_batch ?? 3}" />
              </div>
              <div class="form-group">
                <label>Temporizador: cada cuántos minutos mira la cola</label>
                <input type="number" name="ap_tick" class="form-control" min="1" max="120" value="${ap.tick_min ?? 5}" />
                <small style="color:var(--text-secondary);font-size:.72rem">Se aplica al guardar, sin reiniciar.</small>
              </div>
            </div>
            <p style="margin:10px 0 0;font-size:.78rem;color:var(--text-secondary)">
              <strong>Ojo:</strong> el worker con límites agarra todo lo pendiente, <em>incluido lo que
              vos agendaste para un momento concreto</em>. Si lo dejás prendido junto con el disparador
              por fecha, vas a tener dos relojes compitiendo por las mismas filas. Lo normal es usar
              uno solo: el disparador por fecha, que publica exactamente lo que agendaste.
            </p>
          </details>

          <details style="margin-top:12px" ${rk.auto_enabled !== false ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9rem;color:var(--rose)">📊 Ranking de grupos (automatización diaria)</summary>
            <p style="margin:8px 0 12px;font-size:.8rem;color:var(--text-secondary)">
              Todos los días a la hora indicada, la app lee la Biblioteca de Contenido de Facebook y
              guarda cuántas vistas generó cada grupo. La corrida apunta al <strong>día en curso</strong>
              (tarde, para que el día esté casi completo): la Biblioteca de Contenido ya no muestra los
              posts de ayer, así que un día perdido no se recupera después.
              El "mínimo de grupos" es solo una <strong>señal de aviso</strong>: si el día se detectan menos
              grupos que ese número, la corrida se guarda igual marcada como "datos bajos", en vez de
              descartarse. Subilo solo si querés descartar días flojos a mano.
            </p>
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
                <input type="checkbox" name="rk_auto_enabled" value="1" ${rk.auto_enabled !== false ? 'checked' : ''} style="width:16px;height:16px" />
                Habilitar la corrida diaria automática
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Hora de la corrida</label>
                <input type="time" name="rk_time" class="form-control" value="${rk.time || '10:00'}" />
              </div>
              <div class="form-group">
                <label>Mínimo de grupos (solo aviso)</label>
                <input type="number" name="rk_min_groups" class="form-control" min="1" max="200" value="${rk.min_groups ?? 8}" />
                <small style="color:var(--text-muted);font-size:.75rem;display:block;margin-top:2px">Por debajo de este número el día se marca como "datos bajos" (no se descarta).</small>
              </div>
              <div class="form-group">
                <label>Rondas de scroll (detalle vs. velocidad)</label>
                <input type="number" name="rk_rounds" class="form-control" min="30" max="600" value="${rk.rounds ?? 260}" />
              </div>
            </div>
          </details>

          <div class="form-actions" style="margin-top:16px">
            <button type="submit" class="btn btn--primary">Guardar plantilla</button>
          </div>
        </form>
      </div>

      ${cuentasCardHTML(CUENTAS)}

      ${metodoTextoCardHTML(METODO)}

      ${tiemposCardHTML(TIEMPOS_PERFIL, TIEMPOS_INICIAL, TIEMPOS_PERFIL === 'personalizado' ? TIEMPOS_RED_PERSONAL : TIEMPOS_INICIAL.confirm_red)}

      <div class="card" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Categorías de productos</h3>
            <p style="margin:4px 0 0;font-size:.82rem;color:var(--text-secondary)">${categories.length} categoría(s) disponibles en formularios y filtros</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" id="btn-add-category">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva categoría
          </button>
        </div>

        ${categories.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>No hay categorías. Agrega la primera.</p></div>'
          : `<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th style="width:100px">Productos</th>
                    <th style="width:120px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${categories.map(c => `
                    <tr>
                      <td><span style="font-weight:500">${escHtml(c.name)}</span></td>
                      <td><span style="font-size:.82rem;color:var(--text-secondary)">${c.product_count || 0}</span></td>
                      <td>
                        <div class="actions-cell">
                          <button type="button" class="btn btn--sm btn--ghost btn-edit-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Editar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button type="button" class="btn btn--sm btn--ghost btn-delete-category" data-id="${c.id}" data-name="${escAttr(c.name)}" title="Eliminar" style="color:var(--error)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>

      <div class="card" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0">Estilos de Proveedor</h3>
            <p style="margin:4px 0 0;font-size:.82rem;color:var(--text-secondary)">Perfiles visuales que usa el motor de prompts al generar anuncios. Asigná un estilo a cada proveedor desde la sección de Proveedores.</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" id="btn-add-style">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo estilo
          </button>
        </div>
        ${providerStyles.length === 0
          ? '<div class="empty-state" style="padding:24px"><p>No hay estilos configurados.</p></div>'
          : `<div style="display:flex;flex-direction:column;gap:12px">
              ${providerStyles.map(s => {
                const palette = typeof s.palette === 'object' ? s.palette : {};
                return `
                <details style="border:1px solid var(--border);border-radius:8px;padding:0">
                  <summary style="cursor:pointer;padding:12px 16px;font-weight:600;display:flex;align-items:center;gap:10px">
                    <span class="badge badge--active">${escHtml(s.code)}</span>
                    <span>${escHtml(s.name)}</span>
                    <span style="font-size:.78rem;color:var(--text-muted);margin-left:auto">${escHtml(s.style_name)}</span>
                  </summary>
                  <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px">
                    <div class="style-palette-section" data-code="${s.code}">
                      ${paletteBuilderHTML(palette)}
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de fondo</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="background_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.background_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de acentos</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="accent_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.accent_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Reglas de firma</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="signature_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.signature_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Restricciones del perfil</label>
                      <textarea class="form-control style-rule" data-code="${s.code}" data-field="negative_rules" style="min-height:60px;font-size:.8rem">${escHtml(s.negative_rules)}</textarea>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label style="font-size:.78rem">Envío gratis (texto del prompt)</label>
                      <input type="text" class="form-control style-rule" data-code="${s.code}" data-field="shipping_rule" value="${escAttr(s.shipping_rule || '')}" placeholder="Envío: GRATIS a ..." />
                      <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Texto que aparece en el prompt generado. Si está vacío, usa el valor por defecto.</small>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center">
                      <button type="button" class="btn btn--primary btn--sm btn-save-style" data-code="${s.code}">Guardar estilo</button>
                      <button type="button" class="btn btn--sm btn--ghost btn-delete-style" data-code="${s.code}" data-name="${escAttr(s.name)}" style="color:var(--error);margin-left:auto">Eliminar</button>
                    </div>
                  </div>
                </details>`;
              }).join('')}
            </div>`
        }
      </div>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.exchange_rate = parseFloat(data.exchange_rate);

    try {
      await api.updateSettings(data);
      currentSettings = { exchange_rate: data.exchange_rate };
      showToast('Tipo de cambio actualizado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('publish-template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const publish_config = {
      template: fd.get('template') || '',
      master: {
        on: fd.get('ms_on') === '1'
      },
      ai: {
        enabled: fd.get('ai_enabled') === '1',
        api_url: fd.get('ai_api_url') || '',
        api_key: fd.get('ai_api_key') || '',
        model: fd.get('ai_model') || '',
        system_prompt: fd.get('ai_system_prompt') || '',
        remove_ai_key: fd.get('ai_remove_key') === '1'
      },
      facebook: {
        page_id: fd.get('fb_page_id') || '',
        instagram_id: fd.get('fb_instagram_id') || '',
        access_token: fd.get('fb_access_token') || '',
        token_expires_at: fd.get('fb_token_expires_at') || '',
        remove_fb_token: fd.get('fb_remove_token') === '1'
      },
      autopublish: {
        enabled: fd.get('ap_enabled') === '1',
        mode: fd.get('ap_mode') || 'publish',
        daily_cap: parseInt(fd.get('ap_daily_cap'), 10) || 6,
        hours_from: parseInt(fd.get('ap_hours_from'), 10) || 8,
        hours_to: parseInt(fd.get('ap_hours_to'), 10) || 21,
        min_gap_min: parseInt(fd.get('ap_min_gap'), 10) || 45,
        // Ya no se manda cooldown_min: si se enviara, el backend volvería a
        // guardarlo en la config y el cooldown reaparecería en el worker.
        worker_batch: parseInt(fd.get('ap_batch'), 10) || 3,
        tick_min: parseInt(fd.get('ap_tick'), 10) || 5
      },
      agenda: {
        auto: fd.get('ag_auto') === '1',
        tick_min: limite(fd.get('ag_tick'), 1, 1, 15),
        catchup_hours: limite(fd.get('ag_catchup'), 24, 0, 168),
        // Límites de ritmo. Antes vivían solo en DEFAULT_AGENDA (código) y no había
        // forma de verlos ni tocarlos desde acá. Los rangos son los mismos clamps
        // de getAgendaConfig() en backend/lib/groupPublisher/config.js.
        min_gap_min: limite(fd.get('ag_gap'), 5, 1, 1440),
        max_per_hour: limite(fd.get('ag_hour'), 12, 1, 60),
        // 0 tiene que poder DESACTIVAR el dedupe (lo dice el default del backend),
        // por eso no puede caer en el `|| default`: de ahí el helper `limite`.
        dedupe_hours: limite(fd.get('ag_dedupe'), 6, 0, 168),
        breaker_failures: limite(fd.get('ag_brk_n'), 3, 1, 20),
        breaker_cooldown_min: limite(fd.get('ag_brk_min'), 60, 5, 1440),
        // Reintento automático de fallos transitorios. `retry_max` con 0 lo
        // desactiva sin apagar el interruptor, así que usa el helper `limite`.
        auto_retry: fd.get('ag_autoretry') === 'on',
        retry_max: limite(fd.get('ag_retry_max'), 2, 0, 10),
        retry_delay_min: limite(fd.get('ag_retry_delay'), 15, 1, 1440)
      },
      ranking: {
        auto_enabled: fd.get('rk_auto_enabled') === '1',
        time: fd.get('rk_time') || '10:00',
        min_groups: parseInt(fd.get('rk_min_groups'), 10) || 8,
        rounds: parseInt(fd.get('rk_rounds'), 10) || 260
      }
    };

    try {
      const res = await api.updateSettings({
        exchange_rate: currentSettings?.exchange_rate || settings?.exchange_rate || 61000,
        publish_config
      });
      currentSettings = res;
      showToast('Plantilla de publicación guardada', 'success');
      render(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Cuentas de Facebook: se manda SOLO `cuentas`, y el merge del servidor lo
  // fusiona cuenta por cuenta sobre lo ya guardado (no toca plantilla, IA ni
  // agenda, y ningún temporizador se rearma porque no vienen ni autopublish
  // ni agenda en este envío).
  document.getElementById('cuentas-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const leer = (id) => {
      // Puerto vacío = "usar el default de esta cuenta": se manda 0 y el backend
      // lo descarta (fuera de rango) y cae en el default. Si se enviara '' o
      // 1024 forzado, un campo en blanco dejaría esa cuenta sin funcionar.
      const port = String(fd.get(`ct_${id}_port`) || '').trim();
      return {
        label: String(fd.get(`ct_${id}_label`) || '').trim(),
        profileDir: String(fd.get(`ct_${id}_profile`) || '').trim(),
        debugPort: port ? limite(port, 0, 1024, 65535) : 0,
        proxy: String(fd.get(`ct_${id}_proxy`) || '').trim(),
        fbProfile: String(fd.get(`ct_${id}_fbprofile`) || '').trim(),
      };
    };
    const A = leer('A');
    const B = leer('B');
    const modo = ['alternado', 'A', 'B'].includes(fd.get('ct_modo')) ? fd.get('ct_modo') : 'alternado';

    // Dos Chrome no pueden arrancar con el mismo perfil (el segundo ve el lock
    // y le entrega la URL al que ya está abierto) ni en el mismo puerto.
    if (A.profileDir && B.profileDir && A.profileDir.toLowerCase() === B.profileDir.toLowerCase()) {
      showToast('A y B comparten la ruta de perfil: las dos cuentas necesitan rutas distintas.', 'error');
      return;
    }
    if (A.debugPort && A.debugPort === B.debugPort) {
      showToast('A y B comparten el puerto de depuración: usá dos puertos distintos (p. ej. 9222 y 9223).', 'error');
      return;
    }

    try {
      const res = await api.updateSettings({
        exchange_rate: currentSettings?.exchange_rate || settings?.exchange_rate || 61000,
        publish_config: { cuentas: { modo, A, B } },
      });
      currentSettings = res;
      showToast('Cuentas de Facebook guardadas', 'success');
      render(container);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Abrir el Chrome de una cuenta para loguearse a mano. La app NO escribe
  // credenciales: solo abre la ventana de esa cuenta (su perfil/puerto/proxy) en
  // el login de Facebook, y después consulta qué perfil quedó logueado.
  const pintarEstadoPerfil = (id, profile, expected) => {
    const el = document.querySelector(`[data-profile-status="${id}"]`);
    if (!el) return;
    if (!profile) { el.textContent = ''; return; }
    if (!profile.loggedIn) {
      el.textContent = profile.reason === 'sin_sesion'
        ? 'Sin sesión: logueate en la ventana que se abrió.'
        : `No se pudo leer el perfil (${profile.reason || 'error'}).`;
      el.style.color = 'var(--warning, #b8860b)';
      return;
    }
    const coincide = !expected || profile.profileUrl === expected;
    const nombre = profile.nombre ? `${profile.nombre} · ` : '';
    el.textContent = coincide
      ? `OK: ${nombre}${profile.profileUrl}`
      : `OJO: logueado como ${nombre}${profile.profileUrl} (se esperaba ${expected})`;
    el.style.color = coincide ? 'var(--success, #2e7d32)' : 'var(--danger, #c62828)';
  };
  document.querySelectorAll('[data-open-login]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.openLogin;
      btn.disabled = true;
      btn.textContent = 'Abriendo...';
      try {
        const r = await api.openAccountLogin(id, { url: 'https://www.facebook.com/login' });
        if (r && r.profile) pintarEstadoPerfil(id, r.profile, r.expected);
        showToast(`Chrome de la cuenta ${id} abierto. Iniciá sesión ahí y después tocá "Verificar sesión".`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Abrir Chrome para loguear';
      }
    });
  });
  document.querySelectorAll('[data-check-profile]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.checkProfile;
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = 'Verificando...';
      try {
        const r = await api.getAccountProfile(id);
        pintarEstadoPerfil(id, r.profile, r.expected);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  });

  // Técnica de pegado del texto: se manda SOLO `metodo_texto`, y el merge del
  // servidor lo fusiona sobre lo ya guardado (no toca cuentas, plantilla, IA ni
  // agenda, así que no rearma ningún temporizador).
  const mtForm = document.getElementById('metodo-texto-form');
  if (mtForm) {
    const sel = mtForm.querySelector('select[name="mt_metodo"]');
    const aviso = document.getElementById('mt-aviso');
    const pintarAviso = () => { if (aviso) aviso.style.display = sel.value === 'ctrlv' ? 'block' : 'none'; };
    sel.addEventListener('change', pintarAviso);
    pintarAviso();
    mtForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const metodo_texto = ['teclado', 'insertText', 'ctrlv', 'pasteEvent'].includes(sel.value) ? sel.value : 'teclado';
      try {
        const res = await api.updateSettings({
          exchange_rate: currentSettings?.exchange_rate || settings?.exchange_rate || 61000,
          publish_config: { metodo_texto },
        });
        currentSettings = res;
        showToast('Técnica de texto guardada', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Tiempos: se manda SOLO `tiempos` y el merge del servidor lo fusiona sobre lo
  // guardado. Los valores del perfil personalizado se conservan aunque el usuario
  // pruebe otro perfil: solo se sobrescriben cuando guarda estando en "personalizado".
  const tForm = document.getElementById('tiempos-form');
  if (tForm) {
    const selPerfil = tForm.querySelector('select[name="t_perfil"]');
    const chkRed = tForm.querySelector('input[name="t_confirm_red"]');
    const claves = TIEMPOS_CAMPOS.map((c) => c.clave);
    const input = (k) => tForm.querySelector(`input[name="t_${k}"]`);
    let personal = { ...TIEMPOS_PERSONAL };
    let redPersonal = TIEMPOS_RED_PERSONAL;
    let perfilActual = selPerfil.value;

    const leerInputs = () => {
      const v = {};
      for (const k of claves) {
        const n = Number(input(k).value);
        const lim = TIEMPOS_UI.limites[k];
        v[k] = Number.isFinite(n) && input(k).value !== ''
          ? Math.min(lim.max, Math.max(lim.min, n)) : TIEMPOS_UI.defaults[k];
      }
      return v;
    };
    const pintar = () => {
      const esPers = selPerfil.value === 'personalizado';
      const base = esPers ? personal : TIEMPOS_UI.perfiles[selPerfil.value];
      for (const k of claves) { input(k).value = base[k]; input(k).disabled = !esPers; }
      chkRed.checked = esPers ? redPersonal : base.confirm_red === true;
      chkRed.disabled = !esPers;
    };
    selPerfil.addEventListener('change', () => {
      if (perfilActual === 'personalizado') { personal = leerInputs(); redPersonal = chkRed.checked; }
      perfilActual = selPerfil.value;
      pintar();
    });
    pintar();

    tForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const perfil = ['seguro', 'rapido', 'personalizado'].includes(selPerfil.value) ? selPerfil.value : 'seguro';
      if (perfil === 'personalizado') { personal = leerInputs(); redPersonal = chkRed.checked; }
      try {
        const res = await api.updateSettings({
          exchange_rate: currentSettings?.exchange_rate || settings?.exchange_rate || 61000,
          publish_config: { tiempos: { perfil, valores: personal, confirm_red: redPersonal } },
        });
        currentSettings = res;
        showToast('Tiempos guardados', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  document.getElementById('btn-add-category')?.addEventListener('click', () => openCategoryForm());
  container.querySelectorAll('.btn-edit-category').forEach(btn => {
    btn.addEventListener('click', () => openCategoryForm(btn.dataset.id, btn.dataset.name));
  });
  container.querySelectorAll('.btn-delete-category').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.id, btn.dataset.name));
  });

  container.querySelectorAll('.btn-save-style').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      const fields = container.querySelectorAll(`.style-rule[data-code="${code}"]`);
      const data = {};
      fields.forEach(el => { data[el.dataset.field] = el.value; });
      const paletteSection = container.querySelector(`.style-palette-section[data-code="${code}"]`);
      if (paletteSection) {
        data.palette = collectPaletteFrom(paletteSection);
      }
      try {
        await api.updateProviderStyle(code, data);
        showToast(`Estilo ${code} actualizado`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  initPaletteBuilder();
  refreshPaletteSummaries();

  document.getElementById('btn-add-style')?.addEventListener('click', () => openStyleForm());

  container.querySelectorAll('.btn-delete-style').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(`¿Eliminar el estilo "${btn.dataset.name}" (${btn.dataset.code})?`, {
        title: 'Eliminar estilo',
        danger: true,
        confirmText: 'Eliminar'
      });
      if (!ok) return;
      try {
        await api.deleteProviderStyle(btn.dataset.code);
        showToast('Estilo eliminado', 'success');
        render(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function openCategoryForm(id = null, name = '') {
  openModal(`
    <div class="modal-header">
      <h2>${id ? 'Editar categoría' : 'Nueva categoría'}</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <form id="category-form">
      <div class="form-group">
        <label>Nombre *</label>
        <input type="text" name="name" class="form-control" value="${escAttr(name)}" required autofocus />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">${id ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('category-form');
  const initialSnapshot = snapshotForm(form);

  setModalCloseGuard(async () => {
    if (snapshotForm(form) === initialSnapshot) return true;
    return confirmDialog('¿Descartar los cambios sin guardar?', {
      title: 'Cambios sin guardar',
      confirmText: 'Descartar',
      danger: true,
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const trimmed = new FormData(e.target).get('name').trim();
    if (!trimmed) {
      showToast('El nombre no puede estar vacío', 'error');
      return;
    }

    try {
      if (id) {
        await api.updateCategory(id, { name: trimmed });
        showToast('Categoría actualizada', 'success');
      } else {
        await api.createCategory({ name: trimmed });
        showToast('Categoría creada', 'success');
      }
      closeModal(true);
      const categories = await api.getCategories();
      renderPage(currentContainer, currentSettings, categories);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteCategory(id, name) {
  const ok = await confirmDialog(
    `¿Eliminar la categoría "${name}"? Solo es posible si ningún producto la usa.`,
    { title: 'Eliminar categoría', confirmText: 'Eliminar', danger: true }
  );
  if (!ok) return;

  try {
    await api.deleteCategory(id);
    showToast('Categoría eliminada', 'success');
    const categories = await api.getCategories();
    renderPage(currentContainer, currentSettings, categories);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

const BRAND_BASE_COLORS = [
  { label: 'Navy', hex: '#08245A' },
  { label: 'Deep Navy', hex: '#061633' },
  { label: 'Naranja', hex: '#FF6A00' },
  { label: 'Dorado', hex: '#D9A928' },
  { label: 'Blanco', hex: '#FFFFFF' },
];

function normalizePaletteEntries(palette = {}) {
  const entries = Object.entries(palette || {}).filter(([k]) => k);
  if (entries.length === 0) return [{ label: '', hex: '#08245A', pct: 0 }];
  return entries.map(([label, val]) => {
    if (val && typeof val === 'object' && typeof val.hex === 'string') {
      const pct = Number(val.pct);
      return { label, hex: val.hex, pct: Number.isFinite(pct) ? pct : 0 };
    }
    return { label, hex: typeof val === 'string' ? val : '#08245A', pct: 0 };
  });
}

function paletteBuilderHTML(existingPalette = {}) {
  const rows = normalizePaletteEntries(existingPalette);
  return `
    <div class="form-group">
      <label>Paleta de colores y proporciones</label>
      <div style="margin-bottom:10px">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">Paleta base DaniMarvis (referencia):</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${BRAND_BASE_COLORS.map(c => `
            <span title="${escHtml(c.label)}: ${c.hex}" style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;color:var(--text-muted);background:var(--bg);padding:3px 8px;border-radius:12px">
              <span style="width:14px;height:14px;border-radius:50%;background:${c.hex};border:1px solid var(--border);display:inline-block;flex-shrink:0"></span>
              ${c.hex}
            </span>
          `).join('')}
        </div>
      </div>
      <div class="palette-rows" style="display:flex;flex-direction:column;gap:6px">
        ${rows.map(r => paletteRowHTML(r.label, r.hex, r.pct)).join('')}
      </div>
      <button type="button" class="btn btn--sm btn--ghost palette-add-btn" style="margin-top:6px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Agregar color
      </button>
      <div class="palette-summary"></div>
      <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:4px">Colores específicos de este estilo. Mové la barra para ajustar la proporción de cada color; en el prompt se envía como rango (±10%).</small>
    </div>
  `;
}

function paletteRowHTML(label = '', hex = '#08245A', pct = 0) {
  const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `
    <div class="palette-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px">
      <input type="text" class="form-control palette-label" placeholder="Nombre" value="${escAttr(label)}" style="flex:1 1 110px;font-size:.82rem" />
      <input type="color" class="palette-color" value="${hex}" style="width:34px;height:30px;padding:2px;border:1px solid var(--border);border-radius:4px;cursor:pointer;flex-shrink:0" />
      <span class="palette-hex" style="font-size:.72rem;font-family:monospace;color:var(--text-muted);min-width:52px">${escHtml(hex)}</span>
      <div style="flex:1 1 150px;display:flex;align-items:center;gap:6px;min-width:150px">
        <input type="range" class="palette-pct" min="0" max="100" step="1" value="${safePct}" style="flex:1" title="Proporción del color" />
        <input type="number" class="palette-pct-num" min="0" max="100" value="${safePct}" style="width:50px;font-size:.8rem;padding:4px 6px;border:1px solid var(--border);border-radius:4px" />
        <span style="font-size:.75rem;color:var(--text-muted)">%</span>
      </div>
      <button type="button" class="btn btn--sm btn--ghost palette-remove" style="color:var(--error);padding:2px 4px;flex-shrink:0" title="Eliminar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function setPalettePct(row, v) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const s = row.querySelector('.palette-pct');
  const n = row.querySelector('.palette-pct-num');
  if (s) s.value = clamped;
  if (n) n.value = clamped;
}

function normalizePalette(root) {
  const formGroup = root.closest('.form-group') || (root.classList && root.classList.contains('form-group') ? root : null);
  if (!formGroup) return;
  const rows = Array.from(formGroup.querySelectorAll('.palette-row'));
  if (rows.length === 0) return;
  const pcts = rows.map(r => Number(r.querySelector('.palette-pct').value) || 0);
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const each = Math.floor(100 / rows.length);
    rows.forEach((r, i) => setPalettePct(r, i === rows.length - 1 ? 100 - each * (rows.length - 1) : each));
  } else {
    let assigned = 0;
    rows.forEach((r, i) => {
      if (i === rows.length - 1) {
        setPalettePct(r, 100 - assigned);
      } else {
        const v = Math.round((pcts[i] / sum) * 100);
        setPalettePct(r, v);
        assigned += v;
      }
    });
  }
  renderPaletteSummary(root);
}

function renderPaletteSummary(root) {
  const formGroup = root.closest ? root.closest('.form-group') : null;
  const container = formGroup || root;
  const box = container.querySelector && container.querySelector('.palette-summary');
  if (!box) return;
  const rows = Array.from(container.querySelectorAll('.palette-row'));
  const items = rows.map(row => ({
    hex: row.querySelector('.palette-color').value,
    pct: Number(row.querySelector('.palette-pct').value) || 0,
    name: (row.querySelector('.palette-label').value || '').trim(),
  }));
  const total = items.reduce((s, i) => s + Math.max(0, i.pct), 0);
  if (items.length === 0) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;height:14px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
        ${items.map(i => `<div title="${escAttr(i.name)} ${i.pct}%" style="flex:${Math.max(i.pct, 0.1)};background:${i.hex};min-width:${i.pct > 0 ? '2px' : '0'}"></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:.72rem;color:var(--text-muted)">Total: <b>${total}%</b>${total > 100 ? ' <span style="color:#b8860b">(supera 100%)</span>' : ''}</span>
        <button type="button" class="btn btn--sm btn--ghost palette-reset-btn" style="padding:2px 8px;font-size:.75rem">Normalizar a 100%</button>
      </div>
    </div>
  `;
}

function refreshPaletteSummaries() {
  document.querySelectorAll('.palette-rows').forEach(rowsEl => {
    renderPaletteSummary(rowsEl);
  });
}

function collectPaletteFrom(root) {
  const palette = {};
  (root || document).querySelectorAll('.palette-row').forEach(row => {
    const label = row.querySelector('.palette-label').value.trim();
    const hex = row.querySelector('.palette-color').value;
    const pctInput = row.querySelector('.palette-pct');
    const pct = Number(pctInput ? pctInput.value : 0);
    if (label) palette[label] = { hex, pct: Math.max(0, Math.min(100, Math.round(pct || 0))) };
  });
  return palette;
}

function collectPalette() {
  return collectPaletteFrom(document);
}

function initPaletteBuilder() {
  if (window._paletteBuilderInit) return;
  window._paletteBuilderInit = true;

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('palette-color')) {
      const hex = e.target.value;
      const row = e.target.closest('.palette-row');
      row.querySelector('.palette-hex').textContent = hex;
    } else if (e.target.classList.contains('palette-pct')) {
      const row = e.target.closest('.palette-row');
      setPalettePct(row, e.target.value);
      renderPaletteSummary(row);
    } else if (e.target.classList.contains('palette-pct-num')) {
      const row = e.target.closest('.palette-row');
      const n = Number(e.target.value);
      const clamped = Math.max(0, Math.min(100, Math.round(n || 0)));
      setPalettePct(row, clamped);
      renderPaletteSummary(row);
    } else if (e.target.classList.contains('palette-label')) {
      const row = e.target.closest('.palette-row');
      renderPaletteSummary(row);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.palette-remove')) {
      const row = e.target.closest('.palette-row');
      const parent = row.parentElement;
      if (parent.querySelectorAll('.palette-row').length > 1) {
        row.remove();
        renderPaletteSummary(row);
      } else {
        showToast('Debe haber al menos un color', 'warning');
      }
    }
    if (e.target.closest('.palette-add-btn')) {
      const rowsContainer = e.target.closest('.form-group').querySelector('.palette-rows');
      if (rowsContainer) {
        rowsContainer.insertAdjacentHTML('beforeend', paletteRowHTML('', '#08245A', 0));
        renderPaletteSummary(rowsContainer);
      }
    }
    if (e.target.closest('.palette-reset-btn')) {
      normalizePalette(e.target.closest('.form-group'));
    }
  });
}

function openStyleForm() {
  openModal(`
    <div class="modal-header">
      <h2>Nuevo estilo de proveedor</h2>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 16px">
      Creá un nuevo perfil visual para un proveedor. El ADN de la marca (paleta base, tipografía, personalidad) se mantiene siempre como base. Este estilo se superpone como variación visual.
    </p>
    <form id="style-form">
      <div class="form-row" style="grid-template-columns:1fr 2fr">
        <div class="form-group">
          <label>Código del estilo *</label>
          <input type="text" name="code" class="form-control" placeholder="Ej: NP" maxlength="5" required style="text-transform:uppercase;font-weight:700;font-family:monospace" />
          <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Identificador corto (máx. 5 caracteres)</small>
        </div>
        <div class="form-group">
          <label>Nombre del estilo *</label>
          <input type="text" name="name" class="form-control" placeholder="Ej: MiPime Nuevo Proveedor" required />
        </div>
      </div>
      <div class="form-group">
        <label>Nombre interno (prompt) *</label>
        <input type="text" name="style_name" class="form-control" placeholder="Ej: DANIMARVIS_CUSTOM" required style="font-family:monospace;font-size:.85rem" />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Nombre que aparece en el prompt generado. Formato recomendado: DANIMARVIS_XXX</small>
      </div>
      ${paletteBuilderHTML({})}
      <div class="form-group">
        <label>Reglas de fondo</label>
        <textarea name="background_rules" class="form-control" rows="3" placeholder="Describí cómo deben ser los fondos de los anuncios de este proveedor..."></textarea>
      </div>
      <div class="form-group">
        <label>Reglas de acentos</label>
        <textarea name="accent_rules" class="form-control" rows="3" placeholder="Describí cómo usar los colores de acento..."></textarea>
      </div>
      <div class="form-group">
        <label>Reglas de firma visual</label>
        <textarea name="signature_rules" class="form-control" rows="3" placeholder="Elementos visuales distintivos de este estilo..."></textarea>
      </div>
      <div class="form-group">
        <label>Restricciones del perfil</label>
        <textarea name="negative_rules" class="form-control" rows="3" placeholder="Qué NO hacer en los anuncios de este estilo..."></textarea>
      </div>
      <div class="form-group">
        <label>Texto de envío</label>
        <input type="text" name="shipping_rule" class="form-control" placeholder="Envío: GRATIS a ..." />
        <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-top:2px">Si está vacío, se usa el valor por defecto.</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn--primary">Crear estilo</button>
      </div>
    </form>
  `, 'modal-content--wide');

  initPaletteBuilder();
  refreshPaletteSummaries();

  document.getElementById('style-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.code = data.code.trim().toUpperCase();
    data.name = data.name.trim();
    data.style_name = data.style_name.trim();
    data.palette = collectPalette();
    if (!data.code || !data.name || !data.style_name) {
      showToast('Código, nombre y nombre de estilo son obligatorios', 'error');
      return;
    }
    try {
      await api.createProviderStyle(data);
      showToast(`Estilo ${data.code} creado`, 'success');
      closeModal(true);
      render(currentContainer);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function snapshotForm(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
