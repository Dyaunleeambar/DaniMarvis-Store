/**
 * Los modales de la Publicaciones no deben cerrarse ni quedar viejos después de una
 * acción.
 *
 * Los dos:ssAbsentados que reportó el usuario el 2026-10-05 eran bugs distintos, y
 * por eso esta prueba mira las dos mitades por separado:
 *
 *  1. "tengo que refrescar la aplicación para ver el estado real". Venía de
 *     `_agendaDuplicar`, que NO cerraba el modal: recargaba los datos y dejaba el
 *     HTML viejo pintado. El estado real aparecía solo al refrescar a mano.
 *
 *  2. "el modal se cierra y tengo que volver a abrirlo". Venía de que eliminar,
 *     desarmar y publicar ahora hacían `closeModal(true)` sin volver a pintar nada,
 *     dejando al usuario en el calendario pelado, una vez por cada publicación que
 *     quisiera borrar.
 *
 * El arreglo es `modalAgendaCtx` + `volverAlContexto()`: cada handler captura el
 * contexto al entrar, recarga y vuelve a pintar el modal del que salió. Estas
 * pruebas son sobre el código fuente a propósito — no hay DOM ni browser acá, y la
 * alternativa sería un test end-to-end que no existe en este proyecto.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = join(RAIZ, 'frontend', 'js', 'views', 'publicationsView.js');
const src = readFileSync(RUTA, 'utf8');
const lineas = src.split(/\r?\n/);

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}

/** Cuerpo de un handler `window._agendaX = ...`, hasta la próxima llave de nivel 0. */
function cuerpo(nombre) {
  const i = src.indexOf(`window.${nombre} = `);
  if (i === -1) return '';
  // Un handler puedepatchear varias líneas. Se avanza de a una línea contando
  // llaves, en vez de cortar en el primer `\n};`, que se puedeira al primer objeto
  // que se cierra al nivel 0 (un `confirmDialog({...})` partido, por ejemplo).
  let profundidad = 0;
  let started = false;
  const out = [];
  for (const linea of src.slice(i).split(/\r?\n/)) {
    out.push(linea);
    for (const ch of linea) {
      if (ch === '{') { profundidad++; started = true; }
      else if (ch === '}') profundidad--;
    }
    if (started && profundidad <= 0) break;
  }
  return out.join('\n');
}

console.log('\n1. el contexto del modal existe y se pinta');
{
  ok('se declara modalAgendaCtx', /let\s+modalAgendaCtx\s*=/.test(src));
  ok('detalle() registra el contexto', /modalAgendaCtx\s*=\s*\{\s*tipo:\s*'detalle'/.test(src));
  ok('verDia() registra el contexto', /modalAgendaCtx\s*=\s*\{\s*tipo:\s*'dia'/.test(src));
  ok('existe volverAlContexto()', /async function volverAlContexto/.test(src));
  ok('existe el aviso de que el modal sigue abierto', /function avisoModalPersistente/.test(src));
}

console.log('\n2. volverAlContexto recarga ANTES de repintar');
{
  const cuerpoFn = src.slice(src.indexOf('async function volverAlContexto'));
  const fin = cuerpoFn.indexOf('\n}');
  const fn = cuerpoFn.slice(0, fin);
  const iCargar = fn.indexOf('await cargar()');
  const iPintar = Math.max(fn.indexOf('verDia('), fn.indexOf('detalle('));
  ok('carga los datos frescos', iCargar !== -1);
  ok('y recién después repinta el modal', iPintar !== -1 && iCargar < iPintar,
    `cargar en ${iCargar}, pintar en ${iPintar}`);
}

console.log('\n3. ninguna acción deja el modal cerrado y sin repintar');
{
  // Estas son las queouchingapeaban al usuario: cerraban el modal y solo refrescaban
  // el calendario que estaba DEBAJO.
  for (const h of ['_agendaEliminar', '_agendaDesarmar', '_agendaDuplicar', '_agendaDescartarDestino']) {
    const c = cuerpo(h);
    ok(`${h} vuelve a pintar el modal`, /volverAlContexto/.test(c));
    ok(`${h} ya no cierra y abandona`, !/closeModal\(true\);\s*\n\s*await cargar\(\);/.test(c));
  }
  // El toast que confirma la acción es la mitad de la otra mitad del arreglo: sin él
  // el repintado pasa desapercibido y el usuario no sabe si la acción entró.
  ok('el toast de eliminar dice que podés seguir',
    /Publicación eliminada · podés seguir/.test(cuerpo('_agendaEliminar')));
  ok('el toast de desarmar dice que podés seguir',
    /Publicación desarmada · podés seguir/.test(cuerpo('_agendaDesarmar')));
  ok('el aviso visible explica que el modal sigue abierto',
    /sigue abierto: podés seguir aplicando acciones/.test(src));
}

console.log('\n4. el contexto se captura ANTES de cualquier await');
{
  // Si se leyera después, un confirmDialog o un `cargar()` lento dejarían el modal
  // apuntando a otra publicación y el repintado abriría algo que el usuario ya cerró.
  for (const h of ['_agendaEliminar', '_agendaDesarmar', '_agendaDuplicar', '_agendaDescartarDestino', '_agendaPublicarAhora']) {
    const c = cuerpo(h);
    const iCtx = c.indexOf('const ctx = modalAgendaCtx');
    const iAwait = c.indexOf('await ');
    ok(`${h} captura el contexto primero`, iCtx !== -1 && (iAwait === -1 || iCtx < iAwait),
      `ctx en ${iCtx}, primer await en ${iAwait}`);
  }
}

console.log('\n5. borrar no intenta reabrir lo que ya no existe');
{
  const c = cuerpo('_agendaEliminar');
  // Si veníamos del detalle de la publicación que se acaba de borrar, no hay a dónde
  // volver: `detalle(id)` no la encontraría y cerraría el modal. Se compara el id.
  ok('compara el id antes de volver', /ctx\?\.tipo\s*===\s*'detalle'\s*&&\s*ctx\.id\s*===\s*id/.test(c));
  ok('cierra si no se pudo volver', /if\s*\(!voltou[\s\S]{0,120}closeModal\(true\)/.test(c));
}

console.log('\n6. Publicar ahora no espera a que la corrida termine');
{
  const c = cuerpo('_agendaPublicarAhora');
  // La corrida dura minutos. Esperarla para repintar dejaría el modal congelado, que
  // es peor que cerrarlo.
  ok('no espera al setTimeout para repintar', !/await\s+new\s+Promise[\s\S]{0,80}cargar/.test(c));
  ok('y aun así refresca el calendario después', /setTimeout\(cargar/.test(c));
}

console.log('\n7. editar sí limpia el contexto');
{
  // Editar abre el Planificador, otra pantalla. Dejar el contexto puesto haría que
  // una acción posterior intentara reabrir el modal de una publicación que ya no se
  // está mirando.
  const c = cuerpo('_agendaEditar');
  ok('limpia modalAgendaCtx', /modalAgendaCtx\s*=\s*null/.test(c));
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);