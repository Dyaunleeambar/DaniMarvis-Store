// Tests de la fusión de la config de publicación: qué se conserva y qué se pisa.
//
// El 2026-10-03 una API key quedó guardada como la máscara que el propio GET de
// ajustes devuelve. La causa fue el camino "leer, cambiar un campo, reenviar
// todo": el cliente leía los ajustes, recibía `api_key: "••••••••"`, tocaba el
// interruptor maestro y mandaba el objeto entero de vuelta. El merge solo
// protegía el caso "viene vacío" (que es lo que hace la UI, y por eso la UI
// nunca rompió nada), así que la máscara se guardó como si fuera la clave real.
//
// El síntoma fue un error que no decía nada:
// `Cannot convert argument to a ByteString because the character at index 7 has
// a value of 8226`. Node no puede poner una viñeta (U+2022 = 8226) en una
// cabecera HTTP, y "Bearer " mide 7 caracteres, así que el índice 7 era
// justamente el primer carácter de la clave. Todo lo que se usa para publicar
// andaba normal mientras la generación de descripciones estaba caída.
//
// Estos tests fijan la regla que faltaba: **enmascarado es "no enviado"**, igual
// que vacío. Y que el caso sea imposible de reintroducir por el flag de borrar.
import { mergePublishConfig, pareceSecretoValido, resolverSecreto, MASCARA } from '../backend/lib/settingsMerge.js';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

const REAL = 'sk-or-v1-' + 'a'.repeat(60);
const TOKEN = 'EAA' + 'b'.repeat(50);

function base() {
  return {
    ai: { enabled: true, api_url: 'https://openrouter.ai/api/v1', api_key: REAL, model: 'x', system_prompt: 'p' },
    facebook: { page_id: '123', access_token: TOKEN },
    master: { on: true },
    agenda: { auto: true, tick_min: 1 },
  };
}

console.log('1. la máscara NO pisa el secreto vigente  ← el bug del 2026-10-03');
{
  const r = mergePublishConfig(base(), { ai: { api_key: MASCARA } });
  ok('la API key sigue siendo la real', r.ai.api_key === REAL);
  ok('el token de Facebook también sobrevive',
    mergePublishConfig(base(), { facebook: { access_token: MASCARA } }).facebook.access_token === TOKEN);

  // El caso exacto que rompió todo: la máscara tal cual la devuelve el GET.
  ok('y tampoco si viene con menos viñetas de las esperadas', (() => {
    const r2 = mergePublishConfig(base(), { ai: { api_key: '••' } });
    return r2.ai.api_key === REAL;
  })());
  ok('ni si viene con cualquier otro carácter no-ASCII', (() => {
    const r3 = mergePublishConfig(base(), { ai: { api_key: 'sk-or-v1-á' } });
    return r3.ai.api_key === REAL;
  })());
}

console.log('\n2. vacío conserva (es lo que hace la UI y nunca debe cambiar)');
{
  ok('cadena vacía conserva', mergePublishConfig(base(), { ai: { api_key: '' } }).ai.api_key === REAL);
  ok('undefined conserva', mergePublishConfig(base(), { ai: {} }).ai.api_key === REAL);
  ok('null conserva', mergePublishConfig(base(), { ai: { api_key: null } }).ai.api_key === REAL);
  ok('y el token vacío también', mergePublishConfig(base(), { facebook: { access_token: '' } }).facebook.access_token === TOKEN);
}

console.log('\n3. un secreto nuevo sí se guarda');
{
  ok('API key nueva', mergePublishConfig(base(), { ai: { api_key: 'sk-or-v1-nueva' } }).ai.api_key === 'sk-or-v1-nueva');
  ok('token nuevo', mergePublishConfig(base(), { facebook: { access_token: 'EAA-nuevo' } }).facebook.access_token === 'EAA-nuevo');
  ok('y si no había ninguna guardada, se pone la que llega', (() => {
    const vacio = { ai: {}, facebook: {} };
    return mergePublishConfig(vacio, { ai: { api_key: 'sk-x' } }).ai.api_key === 'sk-x';
  })());
}

console.log('\n4. borrar es explícito y gana siempre');
{
  const r = mergePublishConfig(base(), { ai: { remove_ai_key: true } });
  ok('remove_ai_key borra la API key', !('api_key' in r.ai));
  ok('remove_fb_token borra el token', !('access_token' in mergePublishConfig(base(), { facebook: { remove_fb_token: true } }).facebook));
  ok('aunque venga una key en el mismo envío, el flag manda',
    !('api_key' in mergePublishConfig(base(), { ai: { remove_ai_key: true, api_key: 'sk-nueva' } }).ai));
  ok('y si no había nada que borrar, no inventa la key',
    !('api_key' in mergePublishConfig({ ai: {} }, { ai: { remove_ai_key: true } }).ai));
}

console.log('\n5. los flags remove_* no quedan guardados');
{
  // Si quedaran, el próximo guardado los volvería a aplicar y borraría el
  // secreto de nuevo — sin que el usuario pidiera nada.
  const json = JSON.stringify(mergePublishConfig(base(), { ai: { remove_ai_key: false }, facebook: { remove_fb_token: false } }));
  ok('no aparece remove_ai_key en el JSON', !json.includes('remove_ai_key'));
  ok('no aparece remove_fb_token en el JSON', !json.includes('remove_fb_token'));
}

console.log('\n6. el resto de la config no se toca');
{
  const r = mergePublishConfig(base(), { master: { on: false } });
  ok('apagar el maestro no borra la clave', r.ai.api_key === REAL);
  ok('ni el modelo ni el system_prompt', r.ai.model === 'x' && r.ai.system_prompt === 'p');
  ok('ni la agenda', r.agenda.auto === true && r.agenda.tick_min === 1);
  ok('y el cambio sí se aplica', r.master.on === false);
  ok('un envío parcial conserva las claves que no llegan',
    Object.keys(r).sort().join(',') === Object.keys(base()).sort().join(','));
}

console.log('\n7. pareceSecretoValido: el filtro de la cabecera');
{
  ok('una key real pasa', pareceSecretoValido(REAL));
  ok('un token real pasa', pareceSecretoValido(TOKEN));
  ok('la máscara no', !pareceSecretoValido(MASCARA));
  ok('viñeta suelta no', !pareceSecretoValido('sk-or•'));
  ok('el reemplazo U+FFFD no', !pareceSecretoValido('sk-or' + String.fromCharCode(0xFFFD)));
  ok('un emoji no', !pareceSecretoValido('sk-🔑'));
  ok('vacío o no-string no', !pareceSecretoValido('') && !pareceSecretoValido(null) && !pareceSecretoValido(42));
  ok('con espacio interno sí (es legal)', pareceSecretoValido('sk or v1 abc'));
  ok('resolverSecreto respeta el quitar', resolverSecreto({ incoming: 'x', vigente: REAL, quitar: true }) === undefined);
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);