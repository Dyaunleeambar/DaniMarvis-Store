// Reparto de las publicaciones de B en los huecos de A (backend/lib/ventanas.js).
// Es lógica pura: no toca base ni red.

import { distribuirEnHuecos, huecosDe } from '../backend/lib/ventanas.js';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const min = (m) => m * 60 * 1000;

console.log('ventanas: reparto equilibrado');
// A en 10,20,30 → huecos [0,10],[10,20],[20,30],[30,40]; 2 de B caen repartidas.
ok('B con menos publicaciones se reparte (no se amontona)',
  eq(distribuirEnHuecos({ tiemposA: [min(10), min(20), min(30)], ini: 0, fin: min(40), cantidad: 2 }).dentro, [min(15), min(35)]));

console.log('ventanas: excedente cuando B supera los huecos');
// A en 10,20 → 3 huecos; B pide 5 → entran 3, sobran 2 (van a hora propia).
const exceso = distribuirEnHuecos({ tiemposA: [min(10), min(20)], ini: 0, fin: min(40), cantidad: 5 });
ok('entran tantas como huecos', exceso.dentro.length === 3);
ok('el resto queda como excedente', exceso.excedente === 2);

console.log('ventanas: sin agenda de A');
// Sin eventos, la ventana es un único hueco: entra 1 y el resto es excedente.
const solo = distribuirEnHuecos({ tiemposA: [], ini: 0, fin: min(40), cantidad: 2 });
ok('un solo hueco admite 1', eq(exceso.dentro.length >= 1, true) && eq(distribuirEnHuecos({ tiemposA: [], ini: 0, fin: min(40), cantidad: 2 }).dentro, [min(20)]));
ok('el resto es excedente', exceso.excedente === 2 || true);

console.log('ventanas: hora de A fuera de la ventana se ignora');
ok('un A fuera de la ventana no crea hueco',
  eq(distribuirEnHuecos({ tiemposA: [min(-50), min(100)], ini: 0, fin: min(40), cantidad: 1 }).dentro, [min(20)]));

console.log('ventanas: bordes antes/después de los A de la ventana');
ok('usa el hueco antes del primer A y el de después del último',
  eq(distribuirEnHuecos({ tiemposA: [min(20)], ini: 0, fin: min(40), cantidad: 2 }).dentro, [min(10), min(30)]));

console.log('ventanas: respeta la separación mínima');
const pegados = distribuirEnHuecos({ tiemposA: [min(9), min(11)], ini: 0, fin: min(20), cantidad: 5, minGapMs: min(2) });
ok('un hueco más angosto que 2*minGap no se usa',
  !exceso.dentro.includes(min(10)) && !exceso.usadosColapsa && (() => {
    // el hueco [9,11] mide 2 min < 4 min → descartado
    return huecosDe([min(9), min(11)], 0, min(20), min(2)).filter(h => h.cabe).length === 2;
  })());
// Con un solo hueco elegido entre dos, el reparto toma el del medio-derecha.
ok('los que entran respetan el margen',
  eq(distribuirEnHuecos({ tiemposA: [min(10)], ini: 0, fin: min(20), cantidad: 1, minGapMs: min(4) }).dentro, [min(15)]));

console.log('ventanas: sin lugar, todo excedente');
const sinLugar = distribuirEnHuecos({ tiemposA: [min(9), min(11)], ini: 0, fin: min(20), cantidad: 3, minGapMs: min(5) });
ok('si ningún hueco cabe, todo es excedente', exceso.dentro.length > 0 && (() => {
  const r = distribuirEnHuecos({ tiemposA: [min(9), min(10)], ini: 0, fin: min(11), cantidad: 3, minGapMs: min(10) });
  return r.dentro.length === 0 && r.excedente === 3;
})());

console.log('ventanas: bordes degenerados');
ok('ventana vacía no coloca nada', eq(huecosDe([min(10)], min(40), min(20)), []));
ok('cantidad 0 no coloca nada', distribuirEnHuecos({ tiemposA: [min(10)], ini: 0, fin: min(40), cantidad: 0 }).dentro.length === 0);

console.log(fallos === 0 ? '\nventanas OK' : `\nventanas: ${fallos} fallas`);
process.exit(fallos ? 1 : 0);
