/**
 * chromeLauncher.js
 * Garantiza que haya una instancia de Chrome con debugging remoto (puerto 9222)
 * y el perfil aislado donde queda guardada la sesión de Facebook, ANTES de que
 * corra el scraper de la Biblioteca de Contenido.
 *
 * Misma receta que ranking_grupos.bat (C:\Users\Dani\fb-leave), pero sin matar
 * el Chrome del usuario: solo lanzamos si el puerto 9222 no responde ya.
 */
import { spawn } from 'child_process';
import fs from 'fs';

const DEBUG_PORT = Number(process.env.FB_DEBUG_PORT) || 9222;
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/Dani/AppData/Local/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const FB_DEBUG_PROFILE = process.env.FB_DEBUG_PROFILE || 'C:/Users/Dani/fb-leave/fb-debug-perfil';
const CONTENT_LIBRARY_URL = 'https://www.facebook.com/professional_dashboard/content/content_library/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function portResponds(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
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
export async function ensureRankingChrome({ launch = true } = {}) {
  // el scraper conecta a un Chrome EXISTENTE: si el puerto ya responde, listo.
  if (await portResponds(DEBUG_PORT)) {
    return { ok: true, status: 'already_running', port: DEBUG_PORT };
  }
  if (!launch) return { ok: false, status: 'not_running', port: DEBUG_PORT };

  const exe = CHROME_PATHS.find(p => p && fs.existsSync(p));
  if (!exe) {
    return { ok: false, status: 'no_chrome', port: DEBUG_PORT, error: 'Chrome no encontrado' };
  }
  if (!fs.existsSync(FB_DEBUG_PROFILE)) {
    // si el perfil no existe lo crea Chrome; warning para que sepan que hay que
    // darle la sesión en el primer arranque.
    console.warn(`[ChromeLauncher] perfil no existe aún, se creará: ${FB_DEBUG_PROFILE}`);
  }

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${FB_DEBUG_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    CONTENT_LIBRARY_URL,
  ];

  let child;
  try {
    child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    return { ok: false, status: 'launch_error', port: DEBUG_PORT, error: err.message };
  }

  const up = await waitForPort(DEBUG_PORT, 45000);
  if (up) {
    console.log(`[ChromeLauncher] Chrome lanzado (pid ${child.pid}) con puerto ${DEBUG_PORT} y perfil ${FB_DEBUG_PROFILE}`);
    return { ok: true, status: 'launched', port: DEBUG_PORT };
  }
  return {
    ok: false, status: 'timeout', port: DEBUG_PORT,
    error: `Chrome lanzado pero el puerto ${DEBUG_PORT} no respondió en 45s`,
  };
}