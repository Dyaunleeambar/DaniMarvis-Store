// Tests de elegirIndicesLote: la eleccion de WHICH grupos tildar en cada
// publicacion. Se importa desde el poster real, no se reimplementa: si el
// test copiara la logica, probaria una copia y no el codigo que corre.
//
// El caso que motiva esto es el wraparound. Con 173 grupos y lotes de 9 no
// entra justo (173 = 19*9 + 2), asi que el ultimo lote tiene que dar la vuelta
// al principio. Con 121 tampoco: 121 = 13*9 + 4. Es el unico tramo donde un
// error se nota, y en vivo Habria que publicar 20 veces para verlo.
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { elegirIndicesLote } = require_('../utilidades/fb-ranking/lote_grupos.js');

let fallos = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function ok(nombre, cond, extra = '') {
  if (cond) { console.log('  ok   ' + nombre); }
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

const N = (n) => Array.from({ length: n }, (_, i) => 'Grupo ' + (i + 1));

console.log('elegirIndicesLote\n');

// Sin cursor arranca del principio
ok('sin cursor: los primeros 9', eq(elegirIndicesLote(N(173), 9, ''), [0,1,2,3,4,5,6,7,8]));

// El cursor marca el ULTIMO usado, se arranca despues
ok('cursor en el 9: sigue en el 10', eq(elegirIndicesLote(N(173), 9, 'Grupo 9'), [9,10,11,12,13,14,15,16,17]));

// El caso del wraparound. Ojo con el off-by-one: el cursor es el ULTIMO grupo
// YA tildado, asi que con el cursor en el ultimo de la lista (indice 172 de
// 173) no queda nada por delante y el lote siguiente es [0..8] limpio. El wrap
// se ve un poco antes: con el cursor en "Grupo 171" quedan 171,172 y despues
// hay que volver del principio para completar 9. El indice 170 (Grupo 171)
// ya estaba tildado: el cursor es el ULTIMO usado, no el siguiente.
const wrap = elegirIndicesLote(N(173), 9, 'Grupo 171');
ok('cursor en el 171 de 173: da la vuelta', eq(wrap, [171,172,0,1,2,3,4,5,6]),
   'obtenido ' + JSON.stringify(wrap));
ok('el wrap trae 2 del final y 7 del principio', wrap.length === 9 && wrap.includes(172));

// Con el cursor en el ULTIMO grupo, lo que sigue es el principio de la lista
ok('cursor en el ultimo de 173: reinicia limpio',
   eq(elegirIndicesLote(N(173), 9, 'Grupo 173'), [0,1,2,3,4,5,6,7,8]));

// 121 grupos: 13 lotes de 9 = 117; el 14 es 117..120 y 0..4
const wrap121 = elegirIndicesLote(N(121), 9, 'Grupo 117');
ok('121 grupos: 4 del final + 5 del principio', eq(wrap121, [117,118,119,120,0,1,2,3,4]),
   'obtenido ' + JSON.stringify(wrap121));

// Nombres con adornos: es lo que hace que el cursor no encuentre el grupo
const sucios = ['💲💲Ventas Cárdenas💲💲', 'REVOLICO CIENFUEGOS OFICIAL', 'Grupo 3',
                '☆LA VENDEDORA EN SANTA CLARA☆', 'Grupo 5', 'Grupo 6', 'Grupo 7'];
ok('cursor con emoji y simbolos', eq(elegirIndicesLote(sucios, 3, '💲💲Ventas Cárdenas💲💲'), [1,2,3]));
ok('cursor en mayusculas distintas', eq(elegirIndicesLote(N(20), 3, 'GRUPO 5'), [5,6,7]));
ok('cursor con acentos distintos', eq(elegirIndicesLote(['Compra y Venta en CALIMETE','B','C'], 2, 'compra y venta en calimete'), [1,2]));

// Renombrado menor (agrega un sufijo): lo cubre el fallback por substring
ok('renombrado menor, por substring', eq(elegirIndicesLote(['Revolico Matanzas','B','C'], 2, 'Revolico Matanzas 2024'), [1,2]));

// Renombrado grande: NO coincide, y es lo correcto. Arrancar de 0 es visible;
// arrancar desde el grupo equivocado saltaria 9 en silencio.
ok('renombrado grande: arranca de 0 a proposito',
   eq(elegirIndicesLote(['compra venta en calimete','B','C'], 2, 'compra y venta en calimete'), [0,1]));

// Lista mas corta que el lote
ok('lista de 4 con lote de 9', eq(elegirIndicesLote(N(4), 9, ''), [0,1,2,3]));

// Lote de 1 = no hacer nada (lo controla el llamador)
ok('lote de 1 devuelve vacio', eq(elegirIndicesLote(N(50), 1, ''), []));

//lista vacia
ok('lista vacia', eq(elegirIndicesLote([], 9, ''), []));

// El recorrido completo de 173 en lotes de 9 no puede repetir hasta volver al
// punto de partida, y termina cubriendola entera. Esta es la garantia que hace
// que el reparto sirva: publicar 20 veces tiene que cubrir los 173.
{
  const lista = N(173);
  let cursor = '';
  const vistos = [];
  for (let i = 0; i < 20; i++) {
    const idx = elegirIndicesLote(lista, 9, cursor);
    if (idx.length !== 9) { ok('cada lote trae 9', false, 'lote ' + i + ' trajo ' + idx.length); break; }
    for (const j of idx) vistos.push(j);
    cursor = lista[idx[idx.length - 1]];
  }
  const unicos = new Set(vistos);
  ok('20 lotes de 9 = 180 selections sobre 173 grupos', vistos.length === 180, 'hubo ' + vistos.length);
  ok('se repiten solo por el wrap (180 > 173)', unicos.size === 173, 'unicos ' + unicos.size);
  const primeros20 = vistos.slice(0, 20);
  ok('los primeros 20 lotes no repiten', new Set(primeros20).size === 20);
}

console.log('\n' + (fallos ? fallos + ' FALLAS' : 'todo ok'));
process.exit(fallos ? 1 : 0);
