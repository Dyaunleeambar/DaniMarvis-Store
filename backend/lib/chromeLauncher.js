/**
 * chromeLauncher.js
 * Garantiza que haya una instancia de Chrome con debugging remoto (puerto 9222)
 * y el perfil aislado donde queda guardada la sesión de Facebook, ANTES de que
 * corra cualquier cosa que necesite ese navegador por CDP.
 *
 * Lo consumen dos subsistemas:
 *  - el scraper de la Biblioteca de Contenido (rankings)
 *  - el publicador de grupos (groupPublisher)
 *
 * Misma receta que ranking_grupos.bat (C:\Users\Dani\fb-leave), pero sin matar
 * el Chrome del usuario: solo lanzamos si el puerto 9222 no responde ya.
 *
 * No es un perfil incógnito: es un perfil separado y persistente, así que la
 * sesión de Facebook sobrevive entre corridas.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import { getAccountConfig } from './accountConfig.js';

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/Dani/AppData/Local/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const CONTENT_LIBRARY_URL = 'https://www.facebook.com/professional_dashboard/content/content_library/';

/**
 * Resuelve a qué Chrome apuntar. Sin argumentos usa la config de la cuenta
 * actual (entorno): puerto 9222, perfil histórico y sin proxy para A. La
 * segunda instancia (B) solo cambia por entorno. Con argumentos explícitos se
 * puede apuntar a otra cuenta (p. ej. desde un coordinador).
 */
function resolveTarget({ port, profileDir, proxy } = {}) {
  const acc = getAccountConfig();
  return {
    port: Number(port) || acc.debugPort,
    profileDir: profileDir || acc.profileDir,
    proxy: proxy !== undefined ? String(proxy || '').trim() : acc.proxy,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function portResponds(port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * El puerto vivo NO significa que el Chrome sirva para trabajar. Se comprobó el
 * caso real: un Chrome con el renderer trabado sigue contestando
 * /json/version, así que el chequeo Weak dio por bueno un navegador muerto y el
 * poster se quedó esperando hasta agotar su timeout de 280 s. El síntoma fue
 * `Network.enable timed out` en cualquier comando de Puppeteer.
 *
 * Este chequeo de verdad se conecta a un target de página y le pide evaluar una
 * expresión. Si eso no responde, el navegador está atascado y hay que relanzarlo.
 */
/**
 * Cierra el Chrome de debug que quedó atascado, para poder relanzarlo.
 *
 * Se hace por CDP (`Browser.close`) y solo contra la instancia que YA está
 * escuchando en el puerto de debug. Jamás se buscan ni se matan procesos de
 * Chrome por nombre: el Chrome personal del usuario queda intacto.
 *
 * Sin esto, relanzar no sirve: el Chrome trabado sigue teniendo el lock del
 * perfil, el proceso nuevo arranca, ve el lock, le pasa la URL al viejo y se
 * sale, y `waitForPort` termina en timeout.
 */
async function cerrarChromeAtascado(port) {
  let browser;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${port}`,
      defaultViewport: null,
      protocolTimeout: 4000,
    });
    await browser.close();
  } catch {
    // si ni siquiera se puede cerrar, se sigue: el spawn de todas formas no va
    // a prosperar y waitForPort va a avisar.
  } finally {
    try { await browser?.disconnect(); } catch { /* noop */ }
  }
  // esperar a que el puerto se libere antes de relanzar
  for (let i = 0; i < 10 && await portResponds(port, 500); i++) await sleep(300);
}

async function portRespondsConTargetVivo(port, timeoutMs = 6000) {
  let browser;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${port}`,
      defaultViewport: null,
      protocolTimeout: timeoutMs,
    });
    const pages = await browser.pages();
    for (const p of pages) {
      try {
        await p.evaluate('1 + 1');
        return true;
      } catch {
        // ese target esta trabado: probamos con el siguiente
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    try { await browser?.disconnect(); } catch { /* noop */ }
  }
}

/**
 * Sondeo PASIVO: solo informa si hay un Chrome escuchando, no lanza nada.
 * Para que la UI pueda mostrar el estado sin disparar un arranque.
 * Timeout corto a propósito: se consulta en cada poll de /group-publish/status.
 */
export async function debugChromeReachable(port) {
  const p = Number(port) || getAccountConfig().debugPort;
  return portResponds(p, 800);
}

async function waitForPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portResponds(port)) return true;
    await sleep(400);
  }
  return false;
}

/**
 * @returns {{ok:boolean, status:string, port:number, error?:string}}
 *  status: 'already_running' | 'launched' | 'no_chrome' | 'launch_error' | 'timeout'
 */
export async function ensureDebugChrome({ launch = true, port, profileDir, proxy } = {}) {
  const t = resolveTarget({ port, profileDir, proxy });
  // los consumidores se connectan a un Chrome EXISTENTE por CDP: si el puerto
  // ya responde, no se relanza nada (ni se toca el Chrome del usuario).
  //
  // Pero "el puerto responde" no alcanza: un Chrome con el renderer trabado
  // sigue contestando /json/version y colgaría al poster hasta su timeout de
  // 280 s. Por eso, si ya hay uno, se verifica que tenga un target de página que
  // responda de verdad antes de darlo por bueno.
  if (await portResponds(t.port)) {
    if (await portRespondsConTargetVivo(t.port)) {
      return { ok: true, status: 'already_running', port: t.port };
    }
    console.warn(`[ChromeLauncher] el puerto ${t.port} responde pero el navegador no sirve (renderer trabado). Relanzando...`);
    await cerrarChromeAtascado(t.port);
  }
  if (!launch) return { ok: false, status: 'not_running', port: t.port };

  const exe = CHROME_PATHS.find(p => p && fs.existsSync(p));
  if (!exe) {
    return { ok: false, status: 'no_chrome', port: t.port, error: 'Chrome no encontrado' };
  }
  if (!fs.existsSync(t.profileDir)) {
    // si el perfil no existe lo crea Chrome; warning para que sepan que hay que
    // darle la sesión en el primer arranque.
    console.warn(`[ChromeLauncher] perfil no existe aún, se creará: ${t.profileDir}`);
  }

  const args = [
    `--remote-debugging-port=${t.port}`,
    `--user-data-dir=${t.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
  ];
  // Proxy por cuenta: es lo que le da una IP distinta a cada cuenta. Sin esto,
  // las dos salen por la IP del host (mismo host, misma IP pública).
  if (t.proxy) args.push(`--proxy-server=${t.proxy}`);
  args.push(CONTENT_LIBRARY_URL);

  let child;
  try {
    child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    return { ok: false, status: 'launch_error', port: t.port, error: err.message };
  }

  const up = await waitForPort(t.port, 45000);
  if (up) {
    console.log(`[ChromeLauncher] Chrome lanzado (pid ${child.pid}) con puerto ${t.port}`
      + ` y perfil ${t.profileDir}${t.proxy ? ` (proxy ${t.proxy})` : ''}`);
    return { ok: true, status: 'launched', port: t.port };
  }
  return {
    ok: false, status: 'timeout', port: t.port,
    error: `Chrome lanzado pero el puerto ${t.port} no respondió en 45s`,
  };
}