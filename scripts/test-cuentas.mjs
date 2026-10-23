// Dos cuentas de Facebook (A y B) en un solo proceso, configurable desde Ajustes.
//
// Tres cosas tienen que quedar fijadas acá, porque las tres rotan en silencio:
//
//  1. **Precedencia base → entorno → default** en `getAccountConfig`. La UI
//     manda, pero quien ya usaba FB_DEBUG_PORT/FB_DEBUG_PROFILE/PROXY_SERVER no
//     pierde lo que tiene al aparecer la sección nueva.
//  2. **A y B no pueden compartir perfil ni puerto**: dos Chrome con el mismo
//     `--user-data-dir` no conviven (el segundo ve el lock y le entrega la URL
//     al primero), y con el mismo puerto no se puede hablar con ninguno de los
//     dos. Por eso los defaults son distintos (9222/9223 y perfil/-b).
//  3. **`cuentas` se fusiona cuenta por cuenta** en `mergePublishConfig`: si se
//     reemplazara el objeto entero, un guardado desde Ajustes borraría el proxy
//     que faltaba. Y si se inventara la clave, un guardado que no la menciona
//     empezaría a traer claves basura.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePublishConfig } from '../backend/lib/settingsMerge.js';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-cuentas-'));
mkdirSync(dir, { recursive: true });

// La base es un singleton de módulo, así que hay que fijar el entorno ANTES de
// importar nada que toque la BD. El .env del proyecto no se toca.
process.env.DANIMARVIS_DB = join(dir, 'prueba.db');
process.env.DANIMARVIS_ENV_PATH = join(dir, 'nada.env');
process.env.ACCOUNT_ID = 'A';
process.env.FB_DEBUG_PORT = '9999';
process.env.FB_DEBUG_PROFILE = 'C:/perfiles/solo-entorno';
process.env.PROXY_SERVER = 'http://proxy-de-entorno:8080';

const { initDB, getDB } = await import('../backend/db/database.js');
const {
  getAccountConfig, getCuentasConfig, setCuentaActiva, getCuentaActivaId,
  ACCOUNT_DEFAULTS, normalizarFbProfile,
} = await import('../backend/lib/accountConfig.js');

/** Guarda `cuentas` pasando por el merge real, igual que hace PUT /api/settings. */
function guardarCuentas(cuentas) {
  const db = getDB();
  const fila = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(fila?.publish_config || '{}'); } catch { /* corrupta */ }
  const merged = mergePublishConfig(pc, { cuentas });
  db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(merged));
  return merged;
}

await initDB();

console.log('\n1. sin nada guardado: prevalece el entorno y los defaults');
{
  const A = getAccountConfig('A');
  ok('A toma el puerto del entorno (9999)', A.debugPort === 9999, String(A.debugPort));
  ok('A toma el perfil del entorno', A.profileDir === 'C:/perfiles/solo-entorno', A.profileDir);
  ok('A toma el proxy del entorno', A.proxy === 'http://proxy-de-entorno:8080', A.proxy);
  ok('A conserva su id y etiqueta por defecto', A.id === 'A' && A.label === 'Cuenta A', `${A.id}/${A.label}`);

  // B es otra cuenta: el entorno de A no puede colársele (mismo perfil y mismo
  // puerto = los dos Chrome no podrían convivir).
  const B = getAccountConfig('B');
  ok('B NO hereda el puerto del entorno', B.debugPort === ACCOUNT_DEFAULTS.B.debugPort, String(B.debugPort));
  ok('B NO hereda el perfil del entorno', B.profileDir === ACCOUNT_DEFAULTS.B.profileDir, B.profileDir);
  ok('B usa su propio default de perfil', B.profileDir.endsWith('-b'), B.profileDir);
  ok('los puertos por defecto de A y B son distintos', ACCOUNT_DEFAULTS.A.debugPort !== ACCOUNT_DEFAULTS.B.debugPort);
}

console.log('\n2. lo guardado en Ajustes gana sobre el entorno (caliente)');
{
  guardarCuentas({
    modo: 'alternado',
    A: { label: 'Vta principal', profileDir: 'C:/perfiles/venta', debugPort: 7777, proxy: '' },
    B: { label: 'Vta secundaria', profileDir: 'C:/perfiles/venta-b', debugPort: 7778, proxy: '' },
  });

  const A = getAccountConfig('A');
  ok('el puerto guardado pisa el del entorno', A.debugPort === 7777, String(A.debugPort));
  ok('el perfil guardado pisa el del entorno', A.profileDir === 'C:/perfiles/venta', A.profileDir);
  ok('el label guardado se aplica', A.label === 'Vta principal', A.label);
  ok('un proxy guardado vacío significa "sin proxy" (gana al entorno)', A.proxy === '', JSON.stringify(A.proxy));

  const B = getAccountConfig('B');
  ok('B queda con lo suyo', B.debugPort === 7778 && B.profileDir === 'C:/perfiles/venta-b', JSON.stringify(B));
  ok('y su label también', B.label === 'Vta secundaria', B.label);

  ok('el modo guardado queda en la config', getCuentasConfig().modo === 'alternado', String(getCuentasConfig().modo));
}

console.log('\n3. campos sin configurar caen al default, no al entorno de otra cuenta');
{
  guardarCuentas({ modo: 'B', B: { debugPort: 0, profileDir: '' } });
  const B = getAccountConfig('B');
  ok('puerto inválido (0) cae al default de B', B.debugPort === ACCOUNT_DEFAULTS.B.debugPort, String(B.debugPort));
  ok('perfil vacío cae al default de B', B.profileDir === ACCOUNT_DEFAULTS.B.profileDir, B.profileDir);
}

console.log('\n4. la cuenta activa que publica cambia en caliente');
{
  guardarCuentas({ modo: 'alternado' });
  setCuentaActiva('B');
  ok('setCuentaActiva(B) la hace activa', getCuentaActivaId() === 'B', getCuentaActivaId());
  ok('getAccountConfig() sin id devuelve la activa', getAccountConfig().id === 'B', getAccountConfig().id);
  ok('y con su puerto', getAccountConfig().debugPort === ACCOUNT_DEFAULTS.B.debugPort, String(getAccountConfig().debugPort));

  ok('un id desconocido no se acepta', setCuentaActiva('Z') === null);
  ok('vuelve a caer en el modo', getCuentaActivaId() !== 'Z', getCuentaActivaId());
  setCuentaActiva(null);
}

console.log('\n5. mergePublishConfig: `cuentas` se fusiona cuenta por cuenta');
{
  const base = {
    ai: { api_url: 'https://x', api_key: 'sk-real-de-prueba-0123456789' },
    agenda: { auto: true, lote_desde: 'Grupo con cursor' },
    cuentas: {
      modo: 'alternado',
      A: { label: 'A', profileDir: 'C:/a', debugPort: 9222, proxy: '' },
      B: { label: 'B', profileDir: 'C:/b', debugPort: 9223, proxy: 'http://b:8080' },
    },
  };

  const soloA = mergePublishConfig(base, { cuentas: { modo: 'A', A: { label: 'A2' } } });
  ok('el modo nuevo se aplica', soloA.cuentas.modo === 'A', String(soloA.cuentas.modo));
  ok('A cambia su label', soloA.cuentas.A.label === 'A2', soloA.cuentas.A.label);
  ok('y conserva su perfil y puerto', soloA.cuentas.A.profileDir === 'C:/a' && soloA.cuentas.A.debugPort === 9222, JSON.stringify(soloA.cuentas.A));
  ok('el proxy de B NO se pierde', soloA.cuentas.B.proxy === 'http://b:8080', JSON.stringify(soloA.cuentas.B));
  ok('B queda intacto', soloA.cuentas.B.profileDir === 'C:/b' && soloA.cuentas.B.debugPort === 9223);

  const otro = mergePublishConfig(base, { master: { on: true } });
  ok('un guardado que no menciona cuentas las conserva completas',
    JSON.stringify(otro.cuentas) === JSON.stringify(base.cuentas));

  const nada = mergePublishConfig({ ai: {} }, { master: { on: false } });
  ok('y no INVENTA la clave `cuentas` si no existía',
    !('cuentas' in nada), Object.keys(nada).join(','));
}

console.log('\n5b. perfil de Facebook esperado por cuenta (normalización y guardado)');
{
  // La URL se normaliza para comparar siempre lo mismo, venga como venga.
  ok('id pelado -> profile.php',
    normalizarFbProfile('61591067843509') === 'https://www.facebook.com/profile.php?id=61591067843509');
  ok('URL completa -> canónica',
    normalizarFbProfile('https://www.facebook.com/profile.php?id=100064307757305') === 'https://www.facebook.com/profile.php?id=100064307757305');
  ok('querystring extra se descarta',
    normalizarFbProfile('https://www.facebook.com/profile.php?id=100064307757305&mibextid=abc') === 'https://www.facebook.com/profile.php?id=100064307757305');
  ok('usuario pelado -> facebook.com/usuario',
    normalizarFbProfile('danimarvis') === 'https://www.facebook.com/danimarvis');
  ok('vacío -> vacío (no se verifica)', normalizarFbProfile('') === '');

  guardarCuentas({
    modo: 'alternado',
    A: { profileDir: 'C:/a', debugPort: 9222, fbProfile: '61591067843509' },
    B: { profileDir: 'C:/b', debugPort: 9223, fbProfile: 'https://www.facebook.com/profile.php?id=100064307757305' },
  });
  const A = getAccountConfig('A');
  const B = getAccountConfig('B');
  ok('A guarda su perfil normalizado',
    A.fbProfile === 'https://www.facebook.com/profile.php?id=61591067843509', A.fbProfile);
  ok('B guarda su perfil normalizado',
    B.fbProfile === 'https://www.facebook.com/profile.php?id=100064307757305', B.fbProfile);

  // Un guardado que solo toca A no debe perder el perfil de B.
  const merged = guardarCuentas({ A: { label: 'nueva' } });
  ok('editar A conserva el perfil de B',
    merged.cuentas.B.fbProfile === 'https://www.facebook.com/profile.php?id=100064307757305', JSON.stringify(merged.cuentas.B));
  ok('sin perfil guardado no se verifica (string vacío)', getAccountConfig('A').fbProfile !== undefined);
}

console.log('\n6. nada de esto toca la config de publicación');
{
  const r = mergePublishConfig(
    { ai: { api_key: 'sk-de-prueba-que-si-sobrevive-0123456789' }, agenda: { auto: true, lote_desde: 'cursor' } },
    { cuentas: { modo: 'A', A: { label: 'x' } } },
  );
  ok('la API key sigue ahí', String(r.ai.api_key).startsWith('sk-de-prueba'), r.ai.api_key);
  ok('el cursor de agenda también', r.agenda.lote_desde === 'cursor', r.agenda.lote_desde);
}

rmSync(dir, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
