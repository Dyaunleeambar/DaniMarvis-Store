// Tests de envio_rapido.js: la señal de "red quieta" que permite cerrar la
// pestaña apenas el post se envió, y el sondeo que reemplaza esperas fijas.
// Se importa el módulo REAL; la página es un EventEmitter falso.
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { readFileSync } from 'node:fs';
import { confirmRedDeConfig } from '../backend/lib/groupPublisher/index.js';
import { mergePublishConfig } from '../backend/lib/settingsMerge.js';
const require_ = createRequire(import.meta.url);
const { esRelevante, nombreOperacion, vigilarRed, redQuieta, sondearHasta } = require_('../utilidades/fb-ranking/envio_rapido.js');

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const req = (method, url, postData = '') => ({ method: () => method, url: () => url, postData: () => postData });

console.log('1. qué peticiones cuentan\n');
ok('POST a graphql cuenta', esRelevante('POST', 'https://www.facebook.com/api/graphql/'));
ok('POST de subida de fotos cuenta', esRelevante('POST', 'https://upload.facebook.com/ajax/react_composer/attachments/photo/upload?x=1'));
ok('GET a graphql NO cuenta', !esRelevante('GET', 'https://www.facebook.com/api/graphql/'));
ok('POST a una imagen NO cuenta', !esRelevante('POST', 'https://scontent.xx.fbcdn.net/v/foto.jpg'));
ok('POST de telemetría NO cuenta', !esRelevante('POST', 'https://www.facebook.com/ajax/bz'));

console.log('\n2. nombre de la operación (solo para el log)\n');
ok('lo extrae', nombreOperacion(req('POST', 'u', 'a=1&fb_api_req_friendly_name=ComposerStoryCreateMutation&b=2')) === 'ComposerStoryCreateMutation');
ok('sin nombre -> vacío', nombreOperacion(req('POST', 'u', 'a=1')) === '');
ok('postData que revienta -> vacío', nombreOperacion({ postData: () => { throw new Error('x'); } }) === '');

console.log('\n3. vigilarRed + redQuieta\n');
{
  let t = 1000; const ahora = () => t;
  const page = new EventEmitter(); page.off = page.removeListener.bind(page);
  const v = vigilarRed(page, { ahora });
  ok('sin tráfico: no está quieta (no vio ningún envío)', !redQuieta(v.estado()));
  const mut = req('POST', 'https://www.facebook.com/api/graphql/', 'fb_api_req_friendly_name=ComposerStoryCreateMutation');
  page.emit('request', mut);
  ok('mutation en vuelo: no está quieta', !redQuieta(v.estado()) && v.estado().enVuelo === 1);
  t += 3000;
  ok('en vuelo sigue sin ser quieta aunque pase el tiempo', !redQuieta(v.estado()));
  page.emit('requestfinished', mut); // termina a t=4000
  t += 500;
  ok('recién terminó: falta el colchón', !redQuieta(v.estado()), JSON.stringify(v.estado()));
  t += 1200;
  ok('terminó y pasó el colchón: quieta', redQuieta(v.estado()), JSON.stringify(v.estado()));
  ok('registró el nombre de la operación', v.estado().nombres[0] === 'ComposerStoryCreateMutation');
  const ruido = req('POST', 'https://www.facebook.com/api/graphql/'); page.emit('request', ruido);
  ok('una petición nueva en vuelo la vuelve a romper', !redQuieta(v.estado()));
  page.emit('requestfailed', ruido);
  const otra = req('GET', 'https://www.facebook.com/api/graphql/'); page.emit('request', otra);
  ok('un GET no cuenta como en vuelo', v.estado().enVuelo === 0);
  v.detener();
  ok('detener() quita los listeners', page.listenerCount('request') === 0 && page.listenerCount('requestfinished') === 0 && page.listenerCount('requestfailed') === 0);
}

console.log('\n4. sondearHasta\n');
{
  let t = 0; const ahora = () => t; const dormir = async (ms) => { t += ms; };
  let llamadas = 0;
  const r = await sondearHasta(async () => (++llamadas === 3 ? 'listo' : null), { ventanaMs: 2000, pasoMs: 300, dormir, ahora });
  ok('corta apenas se cumple', r === 'listo' && llamadas === 3 && t === 600, `t=${t} llamadas=${llamadas}`);
  t = 0; llamadas = 0;
  const n = await sondearHasta(async () => { llamadas++; return null; }, { ventanaMs: 1000, pasoMs: 300, dormir, ahora });
  ok('si nunca se cumple, devuelve null al agotar la ventana', n === null && t >= 1000, `t=${t}`);
  t = 0;
  const unaVez = await sondearHasta(async () => 'ya', { ventanaMs: 1000, dormir, ahora });
  ok('si ya se cumple, no espera nada', unaVez === 'ya' && t === 0);
}

console.log('\n5. interruptor en Ajustes (publish_config.confirm_red)\n');
{
  ok('solo true la activa', confirmRedDeConfig({ confirm_red: true }) === true);
  ok('ausente = apagada (modo sombra)', confirmRedDeConfig({}) === false);
  ok('config nula no revienta', confirmRedDeConfig(null) === false);
  ok('"true" como texto NO la activa', confirmRedDeConfig({ confirm_red: 'true' }) === false);
  ok('1 NO la activa (solo el booleano true)', confirmRedDeConfig({ confirm_red: 1 }) === false);
  ok('false = apagada', confirmRedDeConfig({ confirm_red: false }) === false);

  // El formulario manda SOLO { confirm_red }: el merge no debe tocar lo demás.
  const guardada = { metodo_texto: 'pasteEvent', master: { on: true }, agenda: { auto: true, lote_desde: 'grupo X' }, ai: { api_key: 'sk-or-v1-' + 'a'.repeat(40) } };
  const conRed = mergePublishConfig(guardada, { confirm_red: true });
  ok('guardar confirm_red lo persiste', conRed.confirm_red === true);
  ok('y conserva la técnica de texto, el cursor de lote y la API key',
    conRed.metodo_texto === 'pasteEvent' && conRed.agenda.lote_desde === 'grupo X' && conRed.ai.api_key.startsWith('sk-or-v1-'));
  const apagada = mergePublishConfig(conRed, { confirm_red: false });
  ok('desmarcar la casilla la apaga (false pisa a true)', apagada.confirm_red === false && confirmRedDeConfig(apagada) === false);
  const sinMencion = mergePublishConfig(conRed, { metodo_texto: 'teclado' });
  ok('guardar la técnica de texto no apaga la confirmación rápida', sinMencion.confirm_red === true);

  // Cableado: backend -> poster -> flag que lee el poster; y el panel.
  const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const poster = leer('../backend/lib/groupPublisher/poster.js');
  ok("poster.js pasa --confirm-red=1 solo si está activada", /if \(getConfirmRed\(\)\) args\.push\('--confirm-red=1'\)/.test(poster));
  ok('apagada no manda ningún valor (no tapa a FB_CONFIRM_RED)', !poster.includes("'--confirm-red=0'"));
  const gp = leer('../utilidades/fb-ranking/group_poster.js');
  ok("el poster lee --confirm-red y FB_CONFIRM_RED", gp.includes("val(args, '--confirm-red')") && gp.includes('process.env.FB_CONFIRM_RED'));
  const view = leer('../frontend/js/views/settingsView.js');
  ok('el panel tiene la casilla de confirmación rápida (en Tiempos)', view.includes('id="tiempos-form"') && view.includes('name="t_confirm_red"'));
  ok('el panel guarda la confirmación rápida dentro de tiempos', view.includes('publish_config: { tiempos: { perfil, valores: personal, confirm_red: redPersonal } }'));
  ok('el panel solo la marca encendida si es true', view.includes('pc.confirm_red === true'));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
