// Tests de Ajustes > Tiempos: rangos, perfiles, compatibilidad con la config
// vieja, merge al guardar y cableado hasta el poster.
//
// Lo que se prueba: la lógica pura (rangos y perfiles), que lo guardado nunca
// quede fuera de rango, que el poster y el panel usen los MISMOS rangos que el
// backend (hay tres copias: backend ESM, poster CJS y el literal de la vista) y
// el cableado. El efecto real sobre Facebook no se prueba acá: se mide en el log
// ([TIEMPOS], [TIEMPOS-CFG], [ENVIO-RED]).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  TIEMPOS_DEFAULTS, TIEMPOS_LIMITES, TIEMPOS_PERFILES, TIEMPOS_UI,
  normalizarValor, normalizarTiempos, resolverTiempos, tiemposParaPoster,
  confirmRedDeConfig,
} from '../backend/lib/groupPublisher/index.js';
import { mergePublishConfig } from '../backend/lib/settingsMerge.js';

const require_ = createRequire(import.meta.url);
const poster = require_('../utilidades/fb-ranking/tiempos_poster.js');
const { decidirEnvio, ENVIO_VACIO_SOSTENIDO } = require_('../utilidades/fb-ranking/diagnostico_fb.js');
// Se normaliza el fin de línea: en Windows git deja los archivos en CRLF y los
// patrones multilínea de abajo (el literal TIEMPOS_UI) no encontraban `};\n`.
const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const CLAVES = Object.keys(TIEMPOS_DEFAULTS);

console.log('1. rangos: un valor nunca queda fuera de lo permitido\n');
{
  for (const k of CLAVES) {
    const { min, max } = TIEMPOS_LIMITES[k];
    ok(`${k}: por debajo del mínimo sube a ${min}`, normalizarValor(k, -5) === min);
    ok(`${k}: por encima del máximo baja a ${max}`, normalizarValor(k, 99999) === max);
    ok(`${k}: el valor de siempre es válido`, normalizarValor(k, TIEMPOS_DEFAULTS[k]) === TIEMPOS_DEFAULTS[k]);
    ok(`${k}: basura cae al valor de siempre`, [undefined, null, '', 'abc', NaN, {}, true].every((v) => normalizarValor(k, v) === TIEMPOS_DEFAULTS[k]));
  }
  ok('un número escrito como texto se acepta', normalizarValor('vaciado_s', '25') === 25);
  ok('muestras_vacio es entero', normalizarValor('muestras_vacio', 4.6) === 5);
  ok('los segundos se redondean a 0,1', normalizarValor('aviso_s', 2.349) === 2.3);
  ok('los topes de espera no superan el valor de siempre (guard de 600 s)',
    TIEMPOS_LIMITES.confirmacion_s.max === TIEMPOS_DEFAULTS.confirmacion_s && TIEMPOS_LIMITES.vaciado_s.max >= TIEMPOS_DEFAULTS.vaciado_s);
  const n = normalizarTiempos({ composer_s: 0, confirmacion_s: 1e9 });
  ok('normalizarTiempos devuelve todas las claves, todas en rango',
    CLAVES.every((k) => n[k] >= TIEMPOS_LIMITES[k].min && n[k] <= TIEMPOS_LIMITES[k].max), JSON.stringify(n));
  ok('normalizarTiempos(null) = valores de siempre', eq(normalizarTiempos(null), TIEMPOS_DEFAULTS));
}

console.log('\n2. perfiles\n');
{
  ok('los perfiles seguro y rápido están dentro de los rangos',
    ['seguro', 'rapido'].every((p) => CLAVES.every((k) => TIEMPOS_PERFILES[p][k] === normalizarValor(k, TIEMPOS_PERFILES[p][k]))));
  ok('seguro = los valores de siempre y sin confirmación rápida',
    CLAVES.every((k) => TIEMPOS_PERFILES.seguro[k] === TIEMPOS_DEFAULTS[k]) && TIEMPOS_PERFILES.seguro.confirm_red === false);
  ok('rápido es más corto que seguro en los topes de espera',
    TIEMPOS_PERFILES.rapido.confirmacion_s < TIEMPOS_PERFILES.seguro.confirmacion_s
    && TIEMPOS_PERFILES.rapido.vaciado_s < TIEMPOS_PERFILES.seguro.vaciado_s
    && TIEMPOS_PERFILES.rapido.muestras_vacio < TIEMPOS_PERFILES.seguro.muestras_vacio);
  ok('rápido activa la confirmación rápida', TIEMPOS_PERFILES.rapido.confirm_red === true);

  const r0 = resolverTiempos({});
  ok('sin config: perfil seguro, nada cambia solo', r0.perfil === 'seguro' && r0.confirm_red === false && CLAVES.every((k) => r0[k] === TIEMPOS_DEFAULTS[k]));
  ok('resolverTiempos(null) no revienta', resolverTiempos(null).perfil === 'seguro');
  ok('perfil rápido usa los valores del perfil', resolverTiempos({ tiempos: { perfil: 'rapido' } }).confirmacion_s === 60);
  ok('seguro IGNORA valores guardados (no se cuelan cambios)',
    resolverTiempos({ tiempos: { perfil: 'seguro', valores: { confirmacion_s: 31 }, confirm_red: true } }).confirmacion_s === 120);
  const p = resolverTiempos({ tiempos: { perfil: 'personalizado', valores: { confirmacion_s: 45, aviso_s: 99 }, confirm_red: true } });
  ok('personalizado usa lo guardado, limitado a su rango', p.confirmacion_s === 45 && p.aviso_s === 6 && p.confirm_red === true, JSON.stringify(p));
  ok('personalizado: confirm_red solo con true estricto',
    resolverTiempos({ tiempos: { perfil: 'personalizado', confirm_red: 'true' } }).confirm_red === false);
  ok('perfil desconocido cae a seguro', resolverTiempos({ tiempos: { perfil: 'turbo' } }).perfil === 'seguro');
}

console.log('\n3. compatibilidad: quien ya activó la confirmación rápida (confirm_red suelto)\n');
{
  const r = resolverTiempos({ confirm_red: true });
  ok('sin tiempos guardados, confirm_red=true sigue activo (personalizado)', r.perfil === 'personalizado' && r.confirm_red === true);
  ok('y con los valores de siempre', CLAVES.every((k) => r[k] === TIEMPOS_DEFAULTS[k]));
  ok('confirmRedDeConfig respeta el perfil rápido', confirmRedDeConfig({ tiempos: { perfil: 'rapido' } }) === true);
  ok('confirmRedDeConfig: seguro = apagada', confirmRedDeConfig({ tiempos: { perfil: 'seguro' } }) === false);
  ok('una vez guardados los tiempos, manda lo guardado (no el flag viejo)',
    resolverTiempos({ confirm_red: true, tiempos: { perfil: 'personalizado', confirm_red: false } }).confirm_red === false);
}

console.log('\n4. guardar: el merge conserva y limita\n');
{
  const base = { metodo_texto: 'pasteEvent', agenda: { lote_desde: 'grupo X' }, ai: { api_key: 'sk-or-v1-' + 'a'.repeat(40) } };
  const m = mergePublishConfig(base, { tiempos: { perfil: 'personalizado', valores: { confirmacion_s: 45, muestras_vacio: 999 }, confirm_red: true } });
  ok('guarda el perfil y los valores', m.tiempos.perfil === 'personalizado' && m.tiempos.valores.confirmacion_s === 45);
  ok('lo guardado ya viene limitado (999 -> 10)', m.tiempos.valores.muestras_vacio === 10);
  ok('todas las claves quedan guardadas', CLAVES.every((k) => k in m.tiempos.valores));
  ok('conserva técnica de texto, cursor de lote y API key',
    m.metodo_texto === 'pasteEvent' && m.agenda.lote_desde === 'grupo X' && m.ai.api_key.startsWith('sk-or-v1-'));
  const solo = mergePublishConfig(m, { tiempos: { perfil: 'rapido' } });
  ok('cambiar solo el perfil NO borra los valores personalizados', solo.tiempos.perfil === 'rapido' && solo.tiempos.valores.confirmacion_s === 45);
  ok('ni la confirmación rápida personalizada', solo.tiempos.confirm_red === true);
  ok('perfil inválido se ignora (conserva el anterior)', mergePublishConfig(m, { tiempos: { perfil: 'turbo' } }).tiempos.perfil === 'personalizado');
  ok('guardar otra cosa no inventa `tiempos`', !('tiempos' in mergePublishConfig(base, { metodo_texto: 'teclado' })));
  ok('guardar otra cosa no toca los tiempos ya guardados',
    eq(mergePublishConfig(m, { metodo_texto: 'teclado' }).tiempos, m.tiempos));
  ok('confirm_red solo se guarda con true estricto',
    mergePublishConfig({}, { tiempos: { confirm_red: 'true' } }).tiempos.confirm_red === false);
}

console.log('\n5. las tres copias de los rangos coinciden (backend, poster y panel)\n');
{
  ok('poster: mismos valores de siempre', eq(poster.DEFAULTS, TIEMPOS_DEFAULTS));
  ok('poster: mismos rangos', eq(poster.LIMITES, TIEMPOS_LIMITES));
  const vista = leer('../frontend/js/views/settingsView.js');
  const m = vista.match(/const TIEMPOS_UI = (\{[\s\S]*?\n\});\n/);
  ok('la vista lleva el literal TIEMPOS_UI', !!m);
  let lit = null; try { lit = JSON.parse(m[1]); } catch (_) { /* se reporta abajo */ }
  ok('el literal de la vista es JSON válido', lit !== null);
  ok('vista: mismos valores de siempre, rangos y perfiles que el backend', lit !== null && eq(lit, JSON.parse(JSON.stringify(TIEMPOS_UI))));
  const camposVista = [...vista.matchAll(/\{ clave: '(\w+)'/g)].map((x) => x[1]);
  ok('la vista tiene un campo por cada tiempo', eq(camposVista.sort(), [...CLAVES].sort()), camposVista.join());
}

console.log('\n6. el poster recibe los tiempos y se defiende de valores raros\n');
{
  const json = JSON.stringify(tiemposParaPoster({ tiempos: { perfil: 'rapido' } }));
  const t = poster.leerTiempos(json);
  ok('ida y vuelta backend -> poster', t.confirmacion_s === 60 && t.muestras_vacio === 4 && t.colchon_red_s === 1);
  ok('el JSON para el poster no lleva el flag de confirmación', !json.includes('confirm_red'));
  ok('sin argumento: valores de siempre', eq(poster.leerTiempos(undefined), TIEMPOS_DEFAULTS));
  ok('JSON roto: valores de siempre', eq(poster.leerTiempos('{no es json'), TIEMPOS_DEFAULTS));
  const raro = poster.leerTiempos(JSON.stringify({ confirmacion_s: 0, vaciado_s: 99999, composer_s: 'x' }));
  ok('lanzado a mano con valores absurdos, el poster los limita',
    raro.confirmacion_s === 30 && raro.vaciado_s === 60 && raro.composer_s === TIEMPOS_DEFAULTS.composer_s, JSON.stringify(raro));

  // decidirEnvio: el mínimo de lecturas ahora es configurable
  const vacio = { aparecio: false, enCurso: false, conTexto: 0 };
  ok('decidirEnvio sin tercer argumento: igual que siempre',
    decidirEnvio(vacio, ENVIO_VACIO_SOSTENIDO - 2).done === false && decidirEnvio(vacio, ENVIO_VACIO_SOSTENIDO - 1).done === true);
  ok('con mínimo 3, cierra a la 3.ª lectura', decidirEnvio(vacio, 1, 3).done === false && decidirEnvio(vacio, 2, 3).done === true);
  ok('mínimo inválido cae al de siempre', decidirEnvio(vacio, 2, NaN).done === false && decidirEnvio(vacio, 2, 0).done === false);
  ok('el post visible en el feed sigue cerrando sin esperar lecturas', decidirEnvio({ aparecio: true }, 0, 10).done === true);
}

console.log('\n7. cableado: Ajustes -> backend -> poster\n');
{
  const gp = leer('../utilidades/fb-ranking/group_poster.js');
  const cola = leer('../backend/lib/groupPublisher/poster.js');
  const cfg = leer('../backend/lib/groupPublisher/config.js');
  ok('el lanzador pasa --tiempos en cada corrida', cola.includes("'--tiempos=' + getTiemposPoster()"));
  ok('el backend lee los tiempos de la config por corrida', cfg.includes('export function getTiemposPoster()') && cfg.includes('tiemposParaPoster(leerPublishConfig())'));
  ok('el poster lee --tiempos', gp.includes("leerTiempos(val(args, '--tiempos'))"));
  ok('el tope de confirmación sale de los tiempos', gp.includes('const ENVIO_CONFIRM_MS = Math.round(TIEMPOS.confirmacion_s * 1000)'));
  ok('el tope de vaciado sale de los tiempos', gp.includes('const DRAIN_MS = Math.round(TIEMPOS.vaciado_s * 1000)'));
  ok('la espera por intento del compositor sale de los tiempos', gp.includes('TIEMPOS.composer_s * 1000'));
  ok('la ventana del aviso «Publicando…» sale de los tiempos', gp.includes('TIEMPOS.aviso_s * 1000'));
  ok('las lecturas seguidas salen de los tiempos', gp.includes('decidirEnvio(ultimo, vacioSostenido, TIEMPOS.muestras_vacio)'));
  ok('el colchón de red sale de los tiempos', gp.includes('TIEMPOS.colchon_red_s * 1000'));
  ok('el poster deja en el log los tiempos que aplicó', gp.includes("'[TIEMPOS-CFG] '"));
  ok('con el valor de siempre el rango del compositor es 2200-3200 ms',
    Math.round(TIEMPOS_DEFAULTS.composer_s * 1000 * 0.6875) === 2200 && Math.round(TIEMPOS_DEFAULTS.composer_s * 1000) === 3200);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
