/**
 * Plan A: extracción asistida por estructura.
 *
 * Estas pruebas fijan el comportamiento que se midió sobre las imágenes reales de
 * backend/uploads/import (folletos de proveedor). Son funciones puras: no levantan
 * Tesseract ni dependen de red, así que pueden correr en cada `npm run check`.
 *
 * Los casos salen de errores observados en la línea base:
 *   - "120 MINUTOS" se proponía como precio 120 (falso positivo).
 *   - "Challenger- 255ES" se proponía como 255 (modelo, no precio).
 *   - "$1.500" se leía como 1.5 (separador de miles mal interpretado).
 *   - "585usd" y "75 Usd" SÍ son precios y deben seguir detectándose.
 */
import {
  extractPrice, parsearNumero, aplanarLineas, textoConfiable, bestMatches,
} from '../backend/lib/ocr.js';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const precio = (t) => { const r = extractPrice(t); return r ? r.value : null; };

console.log('\n1. precios reales que deben detectarse');
{
  ok('"585usd" -> 585', precio('[KD 2 T 585usd') === 585);
  ok('"20000mAh 75 Usd" -> 75', precio('de 20000mAh 75 Usd') === 75);
  ok('"$1.500" -> 1500 (no 1.5)', precio('Precio $1.500') === 1500);
  ok('"$1.234,56" -> 1234.56', precio('$1.234,56') === 1234.56);
  ok('entero solo en su línea -> se acepta', precio('  1500  ') === 1500);
}

console.log('\n2. falsos positivos que NO deben proponerse');
{
  ok('"120 MINUTOS" -> null', precio('(O 120 MINUTOS') === null);
  ok('"Challenger- 255ES" -> null (modelo)', precio('Challenger- 255ES') === null);
  ok('"700W" -> null', precio('700W €') === null);
  ok('"1.8 LITROS" -> null', precio('» 1.8 LITROS') === null);
  ok('entero pegado a un nombre sin moneda -> null', precio('Arroz 1250') === null);
}

console.log('\n2b. el "2" de "KD 2 T 585usd" no se roba la moneda del 585');
{
  ok('elige 585, no 2', precio('[KD 2 T 585usd') === 585);
}

console.log('\n2c. límites de rango');
{
  ok('0 se descarta', precio('$0') === null);
  ok('> 5000 se descarta', precio('$9999') === null);
}

console.log('\n3. parsearNumero respeta separadores de miles');
{
  ok('"1.500" -> 1500', parsearNumero('1.500') === 1500);
  ok('"1.234,56" -> 1234.56', parsearNumero('1.234,56') === 1234.56);
  ok('"75" -> 75', parsearNumero('75') === 75);
  ok('"0,99" -> 0.99', parsearNumero('0,99') === 0.99);
}

console.log('\n4. aplanarLineas aplana blocks -> lines con bbox y confianza');
{
  const blocks = [
    { paragraphs: [{ lines: [
      { words: [{ text: 'Hola' }, { text: 'mundo' }], confidence: 88.4, bbox: { x0: 1, y0: 2 } },
      { words: [], confidence: 90, bbox: { x0: 0, y0: 0 } },
    ] }] },
  ];
  const out = aplanarLineas(blocks);
  ok('devuelve una sola línea (la vacía se descarta)', out.length === 1, `len=${out.length}`);
  ok('une las palabras de la línea', out[0]?.text === 'Hola mundo');
  ok('redondea la confianza', out[0]?.confidence === 88);
  ok('conserva el bbox', JSON.stringify(out[0]?.bbox) === JSON.stringify({ x0: 1, y0: 2 }));
}

console.log('\n5. textoConfiable filtra por umbral');
{
  const lines = [{ text: 'buena', confidence: 70 }, { text: 'ruido', confidence: 30 }];
  ok('deja solo las confiables', textoConfiable(lines, 50) === 'buena');
  ok('umbral configurable', textoConfiable([{ text: 'x', confidence: 40 }], 30) === 'x');
}

console.log('\n6. bestMatches devuelve candidatos ordenados por encima del umbral');
{
  const products = [{ id: '1', name: 'Olla Reina' }, { id: '2', name: 'Arroz' }, { id: '3', name: 'Zzz' }];
  const res = bestMatches(products, 'OLLA REINA 9 LITROS', 3);
  ok('el primero es el correcto', res[0] && res[0].product.id === '1');
  ok('descarta lo que no supera el umbral', res.every(r => r.score >= 0.28));
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);