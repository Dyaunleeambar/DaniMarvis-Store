/**
 * El PSM de Tesseract debe aplicarse de verdad.
 *
 * `recognize(image, options, output)`: el tercer argumento son FORMATOS de salida
 * (text/blocks/tsv…), no parámetros. El código pasaba `{ psm: 3 }` ahí, así que el
 * PSM quedaba inerte y en la práctica corría el default de tesseract.js (PSM 6,
 * SINGLE_BLOCK). Sobre los folletos reales de backend/uploads/import eso mete ruido
 * (engancha elementos gráficos), mientras que PSM 3 (AUTO) devuelve texto limpio.
 *
 * Prueba sobre el código fuente: no hay DOM ni se quiere levantar un worker de OCR
 * en cada `npm run check` (sería lento y dependería de la red de traineddata).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(RAIZ, 'backend', 'lib', 'ocr.js'), 'utf8');
// Sin comentarios: el comentario que explica el bug menciona `{ psm: 3 }` y si no se
// descarta, el propio chequeo del bug da falso positivo.
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

console.log('\n1. el PSM se aplica con la API correcta');
{
  ok('importa PSM de tesseract.js', /import\s*\{[^}]*\bPSM\b[^}]*\}\s*from\s*'tesseract\.js'/.test(src));
  ok('usa setParameters({ tessedit_pageseg_mode })',
    /setParameters\(\s*\{\s*tessedit_pageseg_mode\s*:/.test(src));
  ok('el modo es PSM.AUTO (el que el código pretendía)', /PSM_MODO\s*=\s*PSM\.AUTO/.test(src));
}

console.log('\n2. no se vuelve a colar el psm en el argumento equivocado');
{
  // El bug original: `worker.recognize(png, {}, { psm: 3 })`.
  ok('ningún recognize() pasa psm como formato de salida', !/\{\s*psm\s*:/.test(codigo));
  ok('el 3er argumento solo pide formatos (text + blocks), sin psm',
    /worker\.recognize\(Buffer\.from\(png\),\s*\{\},\s*\{\s*text:\s*true,\s*blocks:\s*true\s*\}\)/.test(codigo));
}

console.log('\n3. el preprocesamiento sigue intacto');
{
  for (const [paso, re] of [
    ['rotate', /\.rotate\(\)/],
    ['resize 2500', /\.resize\(\{\s*width:\s*2500\s*\}\)/],
    ['grayscale', /\.grayscale\(\)/],
    ['normalize', /\.normalize\(\)/],
    ['sharpen', /\.sharpen\(\)/],
  ]) ok('mantiene ' + paso, re.test(src));
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);