// Tests de la técnica de texto configurable (teclado / insertText / ctrlv /
// pasteEvent).
//
// Contexto: el 2026-10-16 el post más largo tardaba ~93 s SOLO en tipearse (char
// a char con 12 ms + un Enter por línea), comiéndose un tercio del presupuesto
// de 300 s por grupo, y alimentaba los fallos "Protocol error
// (Input.dispatchKeyEvent): Target closed" y "Attempted to use detached Frame".
// Se midió en un grupo real que no todas las técnicas dejan la MISMA estructura
// en el editor Lexical de Facebook, así que la técnica se hizo configurable para
// poder comparar en publicaciones reales.
//
// Lo que se prueba acá es la parte pura (matemática de fidelidad y elección) y
// el cableado (que el poster y el panel realmente usen lo que dicen). El pegado
// contra Facebook de verdad NO se prueba acá: se mira en un post real.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  metodoTextoDeConfig, METODOS_TEXTO, DEFAULT_METODO_TEXTO, parsePosterOutput,
} from '../backend/lib/groupPublisher/index.js';

const require = createRequire(import.meta.url);
const { normMetodo, metricasDeInfo, verificarTexto, saltosPerdidos } = require('../utilidades/fb-ranking/metodo_texto.js');

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── 1. elegir la técnica ─────────────────────────────────────────────────────
console.log('\n1. normMetodo / metodoTextoDeConfig: valor desconocido = teclado');
{
  for (const m of METODOS_TEXTO) ok(`reconoce ${m}`, normMetodo(m) === m);
  ok('espacios se recortan', normMetodo('  ctrlv ') === 'ctrlv');
  ok('vacío cae a teclado', normMetodo('') === 'teclado');
  ok('null cae a teclado', normMetodo(null) === 'teclado');
  ok('basura cae a teclado', normMetodo('pegar-magico') === 'teclado');

  ok('la config elige la técnica', metodoTextoDeConfig({ metodo_texto: 'pasteEvent' }) === 'pasteEvent');
  ok('config vacía usa el default', metodoTextoDeConfig({}) === DEFAULT_METODO_TEXTO);
  ok('el default es teclado (nada cambia solo)', DEFAULT_METODO_TEXTO === 'teclado');
  ok('config nula no revienta', metodoTextoDeConfig(null) === 'teclado');
  ok('técnica inválida cae a teclado', metodoTextoDeConfig({ metodo_texto: 'xyz' }) === 'teclado');
}

// ── 2. métricas de fidelidad ─────────────────────────────────────────────────
console.log('\n2. metricasDeInfo: una métrica que sirve para las 4 técnicas');
{
  const src = ['linea de cincuenta y un caracteres para que sea textoo', 'b' + 'x'.repeat(52), 'c' + 'x'.repeat(52), 'd' + 'x'.repeat(52)].join('\n');
  const lenOk = src.length; // texto completo pegado

  // insertText mete TODO en un solo <p> con \n dentro del texto.
  const ins = metricasDeInfo({ len: lenOk, bloques: 1, nlTexto: 3 }, src);
  ok('insertText: lineas = los \\n del texto + 1 (no los bloques)', ins.lineas === 4, String(ins.lineas));
  ok('insertText: verifica OK', verificarTexto(ins));

  // teclado/pegado crean un <p> por línea y no dejan \n en nodos de texto.
  const par = metricasDeInfo({ len: lenOk, bloques: 4, nlTexto: 0 }, src);
  ok('pegado: lineas = los bloques <p>', par.lineas === 4, String(par.lineas));
  ok('pegado: verifica OK', verificarTexto(par));

  // El conteo no puede depender de los saltos visuales (soft-wrap) que inflan
  // innerText: `len` puede ser mayor y eso NO debe romper nada.
  const wrap = metricasDeInfo({ len: lenOk + 200, bloques: 4, nlTexto: 0 }, src);
  ok('soft-wrap: el largo de más no molesta', verificarTexto(wrap));

  ok('cuenta las líneas del origen', metricasDeInfo({}, src).lineasSrc === 4);
  ok('trata \\r\\n como un solo salto', metricasDeInfo({}, 'a\r\nb').lineasSrc === 2);
}

// ── 3. verificación (texto completo) ─────────────────────────────────────────
console.log('\n3. verificarTexto: el texto tiene que estar completo');
{
  // 4 líneas de ~50 chars, como un post real corto.
  const lineas = [1, 2, 3, 4].map((n) => `linea ${n} ` + 'x'.repeat(42));
  const src = lineas.join('\n');
  const bueno = metricasDeInfo({ len: src.length, bloques: 4, nlTexto: 0 }, src);
  ok('texto completo verifica', verificarTexto(bueno));

  const corto = metricasDeInfo({ len: 5, bloques: 1, nlTexto: 0 }, src);
  ok('texto casi vacío NO verifica', !verificarTexto(corto));
  ok('0 chars NO verifica', !verificarTexto(metricasDeInfo({ len: 0, bloques: 0, nlTexto: 0 }, src)));

  // Se pegó solo la primera línea: faltan saltos además de texto.
  const faltan = metricasDeInfo({ len: lineas[0].length, bloques: 1, nlTexto: 0 }, src);
  ok('faltando la mayoría de las líneas NO verifica', !verificarTexto(faltan));

  // Se tolera -1 por la línea final en blanco (caso teclado 160 vs 161).
  const src3 = Array.from({ length: 20 }, (_, i) => `l${i} ` + 'y'.repeat(40)).join('\n');
  const off = metricasDeInfo({ len: src3.length, bloques: 19, nlTexto: 0 }, src3);
  ok('tolera una línea final en blanco', verificarTexto(off));
}

// ── 4. el aviso de saltos (incluye el caso silencioso de 0) ──────────────────
console.log('\n4. saltosPerdidos: detecta también gotBreaks = 0');
{
  const src = 'a\nb\nc\nd'; // 3 saltos, texto corto: sin tolerancia

  const todoEnUno = metricasDeInfo({ len: 7, bloques: 1, nlTexto: 0 }, src);
  const per = saltosPerdidos(todoEnUno);
  ok('TODO en un bloque ahora SÍ avisa (antes quedaba en silencio)',
    per && per.breaks === 3 && per.gotBreaks === 0, JSON.stringify(per));

  ok('texto exacto no avisa', saltosPerdidos(metricasDeInfo({ bloques: 4, nlTexto: 0 }, src)) === null);
  ok('insertText exacto no avisa', saltosPerdidos(metricasDeInfo({ bloques: 1, nlTexto: 3 }, src)) === null);
  ok('sin saltos en el origen no avisa', saltosPerdidos(metricasDeInfo({ bloques: 1 }, 'una sola linea')) === null);

  const perdioLaMitad = saltosPerdidos(metricasDeInfo({ bloques: 2, nlTexto: 0 }, src));
  ok('perder algunos saltos avisa', perdioLaMitad && perdioLaMitad.gotBreaks === 1 && perdioLaMitad.breaks === 3);

  // Texto largo: se tolera 1 línea (off-by-one del teclado en el post más largo).
  const largo = Array.from({ length: 161 }, () => 'z').join('\n');
  ok('texto largo con 1 línea de menos NO avisa',
    saltosPerdidos(metricasDeInfo({ bloques: 160, nlTexto: 0 }, largo)) === null);
  ok('texto largo colapsado a 1 línea SÍ avisa',
    saltosPerdidos(metricasDeInfo({ bloques: 1, nlTexto: 0 }, largo)) !== null);
}

// ── 5. la línea de métricas no es un resultado del post ──────────────────────
console.log('\n5. parsePosterOutput ignora la métrica (event:metodo)');
{
  const publicado = '{"group_url":"g","ok":true,"status":"published","metodo_texto":"pasteEvent"}';
  const metricas = '{"event":"metodo","status":"metodo","metodo":"pasteEvent","ms":1020,"lineas":26}';
  const r = parsePosterOutput(metricas + '\n' + publicado);
  ok('la métrica no se confunde con el resultado', r.status === 'published', r.status);
  ok('la técnica viaja en el resultado', r.metodo_texto === 'pasteEvent');

  // Sólo la métrica (sin terminal) tiene que dar error, no "publicado".
  const solo = parsePosterOutput(metricas);
  ok('sólo métricas = error (no un falso publicado)', solo.status === 'error', solo.status);
}

// ── 6. el cableado: el poster y el panel usan lo que dicen ───────────────────
console.log('\n6. cableado del poster y del panel');
{
  const gp = leer('../utilidades/fb-ranking/group_poster.js');
  ok('el poster lee --metodo-texto', gp.includes("val(args, '--metodo-texto')"));
  ok('hay dispatcher ponerTexto', /async function ponerTexto\(/.test(gp));
  ok('usa la matemática compartida', gp.includes("require('./metodo_texto.js')") && gp.includes('metricasDeInfo('));
  ok('el aviso usa saltosPerdidos (cubre 0 saltos)', gp.includes('saltosPerdidos('));
  ok('implementa las 4 técnicas', ['typeText(', 'insertTextRapido(', 'pegarConClipboard(', 'pegarEventoSintetico(']
    .every((f) => gp.includes(f)));
  ok('el pegado sintético usa DataTransfer (sin portapapeles)',
    gp.includes('new DataTransfer()') && gp.includes("new ClipboardEvent('paste'"));
  ok('Ctrl+V tiene guarda anti-contaminación (relee y compara)',
    gp.includes('navigator.clipboard.writeText') && gp.includes('navigator.clipboard.readText')
    && gp.includes('portapapeles contaminado'));
  ok('hay fallback a teclado cuando la técnica falla', gp.includes('metodo-fallo'));
  ok('emite métricas por post', gp.includes("event: 'metodo'"));

  // El backend se partió en módulos: `getMetodoTexto` vive en config.js y el
  // `--metodo-texto` con el que se le pasa al poster vive en poster.js
  // (spawnPoster). Los dos juntos son el "lib" de siempre.
  const lib = [
    '../backend/lib/groupPublisher/config.js',
    '../backend/lib/groupPublisher/poster.js',
  ].map(leer).join('\n');
  ok('el backend lee la técnica de la config', lib.includes('function getMetodoTexto()')
    && lib.includes('metodoTextoDeConfig(pc)'));
  ok('el backend la pasa al poster', lib.includes("'--metodo-texto=' + getMetodoTexto()"));

  const view = leer('../frontend/js/views/settingsView.js');
  ok('el panel tiene el select con las 4 técnicas',
    ['value="teclado"', 'value="insertText"', 'value="ctrlv"', 'value="pasteEvent"'].every((v) => view.includes(v)));
  ok('el panel guarda metodo_texto', view.includes('publish_config: { metodo_texto }'));
  ok('el panel advierte lo del portapapeles en la técnica B', view.includes('portapapeles'));
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
