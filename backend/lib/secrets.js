/**
 * Secretos fuera de la base.
 *
 * El 2026-10-04 la `publish_config` quedó en NULL y la API key se perdió con ella:
 * una migración la degrada a tres claves sin avisar, y sin respaldo la key no se
 * recuperó hasta buscar un `.json` de hace dos días. Este módulo deja una copia
 * de la key en `.env`, que no depende de la base, y la reinyecta sola al
 * arrancar.
 *
 * Lo que se guarda acá es deliberadamente POCO: solo lo que, de perder la base,
 * no se puede recuperar de otro lado. Los ajustes de ritmo y el cursor de rotación
 * van en la base; si se pierden, se reconfiguran a mano en cinco segundos.
 */
import fs from 'fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Configurable por entorno para que las pruebas no toquen el `.env` de verdad.
export const RUTA_ENV = process.env.DANIMARVIS_ENV_PATH || join(__dirname, '..', '..', '.env');

/**
 * Lee un `.env` sin depender de `dotenv` (que no está en el proyecto).
 * Solo el formato que hace falta: `CLAVE=valor`, `#` para comentarios, comillas
 * opcionales y `export ` opcional.
 */
export function leerEnv(ruta = RUTA_ENV) {
  const salida = {};
  let texto = '';
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch { return salida; }
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else {
      // Sin comillas, todo lo que venga después de un # es comentario.
      v = v.replace(/\s+#.*$/, '').trim();
    }
    salida[m[1]] = v;
  }
  return salida;
}

/**
 * Escribe una clave en el `.env`, reemplazando la que ya estuviera. Nunca imprime
 * el valor: los secretos no van a la consola.
 */
export function escribirEnv(clave, valor, ruta = RUTA_ENV) {
  const actual = leerEnv(ruta);
  actual[clave] = valor;
  const cuerpo = [
    '# Secretos de DaniMarvisStore. Este archivo NO se sube al repositorio.',
    '# La API key también vive en la base (settings.publish_config.ai.api_key);',
    '# esta copia es la red de seguridad para cuando esa base se daña.',
    '',
    ...Object.entries(actual).map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');
  fs.writeFileSync(ruta, cuerpo, { mode: 0o600 });
  try { fs.chmodSync(ruta, 0o600); } catch { /* en Windows el modo no aplica igual */ }
}

/** La key que se use en este arranque: la del entorno gana sobre la del archivo. */
export function apiKeyDeRespaldo() {
  return String(process.env.DANIMARVIS_AI_KEY || leerEnv().DANIMARVIS_AI_KEY || '').trim();
}

/**
 * Deja la key a salvo en el `.env` si no está ahí.
 * Devuelve qué hizo, para que el arranque lo diga en el log.
 */
export function respaldarApiKey(apiKey, { ruta = RUTA_ENV } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return 'sin key que respaldar';
  const env = leerEnv(ruta);
  if (env.DANIMARVIS_AI_KEY === key) return 'ya estaba respaldada';
  escribirEnv('DANIMARVIS_AI_KEY', key, ruta);
  return 'nueva copia';
}

/**
 * Devuelve la API key efectiva y, si la base perdió la suya, la reinyecta.
 *
 * LA BASE MANDA. El `.env` es red de seguridad, no un override: si lo contrario,
 * un valor viejo guardado en el `.env` pisaría una key nueva y correcta, que es
 * justo la pérdida que esto viene a evitar. El entorno solo entra cuando la base
 * no tiene key, que es el escenario del 2026-10-04.
 */
export function reconciliarApiKey(db, { onLog = () => {} } = {}) {
  const desdeEnv = apiKeyDeRespaldo();
  let fila = null;
  try { fila = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get(); } catch { /* sin base */ }
  let pc = {};
  let configInutilizable = false;
  try {
    const crudo = fila?.publish_config;
    // NULL o '' no es "sin configurar": es la base dañada del 2026-10-04. Se
    // distingue para poder avisar, porque desde ahí se pierde todo lo demás.
    configInutilizable = crudo === null || crudo === undefined || String(crudo).trim() === '';
    pc = configInutilizable ? {} : JSON.parse(crudo || '{}');
  } catch { configInutilizable = true; }

  const enBase = String(pc?.ai?.api_key || '').trim();
  if (configInutilizable) onLog('[secretos] ATENCIÓN: publish_config llegó vacía a la base. Se pierde todo lo que vivía ahí (límites del reloj, cursor de rotación, ajustes).');
  if (enBase) return enBase;
  if (!desdeEnv) return '';

  const origen = process.env.DANIMARVIS_AI_KEY ? 'la variable de entorno' : 'el .env';
  const motivo = configInutilizable ? 'la base llegó vacía' : 'la base no traía key';
  pc.ai = { ...(pc.ai || {}), api_key: desdeEnv };
  db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(pc));
  onLog(`[secretos] API key restaurada desde ${origen} (${motivo}).`);
  return desdeEnv;
}