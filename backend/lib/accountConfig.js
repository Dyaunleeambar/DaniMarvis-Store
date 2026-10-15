import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { getDB } from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Perfil de Chrome histórico de la cuenta A. Se deja como default para no
// cambiar el comportamiento existente: A sigue usando el mismo perfil, puerto
// y ausencia de proxy que tenía ANTES de soportar dos cuentas.
const DEFAULT_PROFILE = 'C:/Users/Dani/fb-leave/fb-debug-perfil';

/**
 * Defaults de las dos cuentas de Facebook.
 *
 * La cuenta A reproduce EXACTAMENTE lo que el sistema hacía antes de soportar
 * dos cuentas (perfil histórico, puerto 9222, sin proxy), así que una base sin
 * nada configurado se comporta igual que siempre. La B arranca con su propio
 * perfil y puerto para que dos Chrome puedan convivir: si A y B compartieran
 * `--user-data-dir`, el segundo arranque vería el lock del perfil y entregaría
 * la URL al Chrome que ya está abierto, en lugar de arrancar uno nuevo.
 */
export const ACCOUNT_DEFAULTS = {
  A: { id: 'A', label: 'Cuenta A', profileDir: DEFAULT_PROFILE, debugPort: 9222, proxy: '' },
  B: { id: 'B', label: 'Cuenta B', profileDir: `${DEFAULT_PROFILE}-b`, debugPort: 9223, proxy: '' },
};

export const ACCOUNT_IDS = ['A', 'B'];

// Cuenta que está usando este proceso en este momento. La fija el publicador al
// arrancar una corrida y la leen el resto de los que publican (spawnPoster,
// chromeLauncher, /api/status) para que TODOS hablen de la misma cuenta sin
// tener que pasar el id a mano en cada llamada.
let cuentaActivaId = null;

/** Fija la cuenta que va a publicar esta corrida. `null` vuelve al modo config. */
export function setCuentaActiva(id) {
  const limpio = String(id || '').toUpperCase();
  cuentaActivaId = ACCOUNT_IDS.includes(limpio) ? limpio : null;
  return cuentaActivaId;
}

/** `cuentas.modo` guardado en Ajustes: 'alternado' | 'A' | 'B'. */
export function getCuentasConfig() {
  try {
    const db = getDB();
    const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
    const pc = JSON.parse(row?.publish_config || '{}');
    return pc && typeof pc.cuentas === 'object' && pc.cuentas ? pc.cuentas : {};
  } catch {
    // base no inicializada todavía, o sin settings: la config vive en el entorno
    return {};
  }
}

/**
 * Cuenta activa según el modo guardado, pero SIN la asignación de corrida.
 * `alternado` arranca siempre en A: si no hubiera corrida previa, no hay con
 * qué alternar todavía.
 */
function cuentaSegunModo() {
  const modo = String(getCuentasConfig().modo || 'alternado').toUpperCase();
  return ACCOUNT_IDS.includes(modo) ? modo : 'A';
}

/** Cuenta que publica ahora: la de la corrida, o la del modo, o la del entorno. */
export function getCuentaActivaId() {
  if (cuentaActivaId) return cuentaActivaId;
  const modo = cuentaSegunModo();
  if (ACCOUNT_IDS.includes(modo)) return modo;
  const env = String(process.env.ACCOUNT_ID || '').toUpperCase();
  return ACCOUNT_IDS.includes(env) ? env : 'A';
}

/** ¿`id` es la cuenta que este proceso declara por entorno? Solo a esa le aplica. */
function esCuentaDeEntorno(id) {
  const env = String(process.env.ACCOUNT_ID || 'A').toUpperCase();
  return ACCOUNT_IDS.includes(env) ? env === id : id === 'A';
}

function puertoValido(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= 1024 && i <= 65535 ? i : null;
}

/**
 * Config de una cuenta concreta.
 *
 * Precedencia **base (Ajustes) → entorno → default**: lo que el usuario guardó
 * en Ajustes manda y se aplica en caliente (se lee en cada uso, no al arrancar);
 * el entorno sigue funcionando como override para quien ya lo venía usando; y
 * el default es el comportamiento histórico de A.
 *
 * Sin argumentos devuelve la cuenta activa de este proceso.
 *
 * @param {string} [id] 'A' | 'B'
 * @returns {{id:string,label:string,debugPort:number,profileDir:string,proxy:string}}
 */
export function getAccountConfig(id) {
  const cuentas = getCuentasConfig();
  const idFinal = (() => {
    const c = String(id || getCuentaActivaId() || '').toUpperCase();
    return ACCOUNT_IDS.includes(c) ? c : 'A';
  })();

  const def = ACCOUNT_DEFAULTS[idFinal] || ACCOUNT_DEFAULTS.A;
  const guardada = cuentas[idFinal] && typeof cuentas[idFinal] === 'object' ? cuentas[idFinal] : null;
  const esDeEntorno = esCuentaDeEntorno(idFinal);

  const envPort = puertoValido(process.env.FB_DEBUG_PORT);
  const envPerfil = String(process.env.FB_DEBUG_PROFILE || '').trim();
  const envProxy = String(process.env.PROXY_SERVER || '').trim();

  // label
  const label = String(guardada?.label || '').trim() || def.label;
  // puerto de depuración de Chrome
  const debugPort = puertoValido(guardada?.debugPort) ?? (esDeEntorno && envPort ? envPort : def.debugPort);
  // perfil de Chrome (sesión de Facebook)
  const perfilGuardado = String(guardada?.profileDir || '').trim();
  const profileDir = perfilGuardado || (esDeEntorno && envPerfil ? envPerfil : def.profileDir);
  // proxy por cuenta: es lo que le da una IP distinta a cada cuenta.
  // 'proxy' guardado como cadena vacía es "sin proxy" explícito y GANA al env.
  let proxy;
  if (guardada && typeof guardada.proxy === 'string') proxy = guardada.proxy.trim();
  else if (esDeEntorno) proxy = envProxy;
  else proxy = def.proxy;

  return { id: idFinal, label, debugPort, profileDir, proxy };
}

/**
 * Carpeta de uploads de esta instancia. Por defecto la histórica
 * (backend/uploads); la cuenta B usa una propia para no mezclar imágenes ni
 * derrames archivos temporales en la de A.
 */
export function getUploadsDir() {
  return process.env.DANIMARVIS_UPLOADS
    ? resolve(process.env.DANIMARVIS_UPLOADS)
    : join(__dirname, '..', 'uploads');
}
