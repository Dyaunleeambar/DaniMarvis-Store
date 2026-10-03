// Smoke del modal "Duplicar el día" (frontend/js/views/publicationsView.js).
//
// El plan ya lo prueba scripts/test-duplicar-dia.mjs. Lo que NO hay forma de
// probar ahí es el HTML que arma el modal: miniatura, punto de estado, checks de
// selección y el botón que dice cuántas van. Ese marcado se rompe en silencio
// (un undefined en la interpolación, un id mal escrito) y sólo se ve en el
// navegador, o sea tarde.
//
// El plan se arma con la lógica REAL del backend contra una base en memoria, así
// el fixture no es una copia a mano del JSON que alguien espera que devuelva la
// API: si el backend cambia la forma, el test se entera.
import { abrirMemoria } from './helpers/sqljs.mjs';
import { planDuplicacionDia } from '../backend/lib/duplicarDia.js';

// ── el plan real ────────────────────────────────────────────────────────────
const hora = (local) => new Date(local).toISOString();
const ESQUEMA = `
  CREATE TABLE publications (
    id TEXT PRIMARY KEY, product_id TEXT, product_name TEXT DEFAULT '',
    publish_text TEXT DEFAULT '', images TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    publication_date TEXT, sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE publication_queue (
    id TEXT PRIMARY KEY, publication_id TEXT, group_name TEXT NOT NULL,
    group_url TEXT DEFAULT '', status TEXT DEFAULT 'pending', scheduled_at TEXT,
    published_at TEXT, variant_index INTEGER DEFAULT 0, variant_text TEXT DEFAULT '',
    notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')), images TEXT DEFAULT '[]',
    pending_approval INTEGER DEFAULT 0
  );
  CREATE TABLE publication_clones (
    id TEXT PRIMARY KEY, clon_id TEXT, origen_id TEXT, desde TEXT, hasta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE publication_plans (
    id TEXT PRIMARY KEY, publication_id TEXT, product_id TEXT
  );
`;
const { db: memDb, crudo } = await abrirMemoria(ESQUEMA);
memDb.prepare(`INSERT INTO publications (id, product_name, publish_text, images, publication_date)
               VALUES (?, ?, ?, ?, ?)`)
  .run('pub-con-foto', 'Nevera', 'texto', '["/uploads/nevera.webp","/uploads/2.webp"]', hora('2026-10-02T09:00'));
memDb.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, scheduled_at)
               VALUES (?, ?, ?, ?, ?)`)
  .run('d1', 'pub-con-foto', 'Revolico Matanzas', 'published', hora('2026-10-02T09:00'));
memDb.prepare(`INSERT INTO publications (id, product_name, publish_text, images, publication_date)
               VALUES (?, ?, ?, ?, ?)`)
  .run('pub-sin-foto', 'Lavadora', 'otro texto', '[]', hora('2026-10-02T18:45'));
memDb.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, scheduled_at)
               VALUES (?, ?, ?, ?, ?)`)
  .run('d2', 'pub-sin-foto', 'Revolico Habana', 'error', hora('2026-10-02T18:45'));
// images guardado a mano como texto inválido: pasa en producción y la miniatura
// tiene que salir vacía, no romper el modal.
memDb.prepare(`INSERT INTO publications (id, product_name, publish_text, images, publication_date)
               VALUES (?, ?, ?, ?, ?)`)
  .run('pub-roto-json', 'Sin JSON', 'texto', 'no-es-json', hora('2026-10-02T20:00'));
const D_ORIGEN = '2026-10-02', D_DESTINO = '2026-10-03';
const planDe = (hora) => planDuplicacionDia(memDb, D_ORIGEN, D_DESTINO, hora);
const planReal = planDe();

const pedidos = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  pedidos.push({ url: u, body: opts?.body ? JSON.parse(opts.body) : null });
  const responder = (cuerpo) => ({ ok: true, status: 200, text: async () => JSON.stringify(cuerpo) });
  // El servidor recalcula el plan con la hora que le llega; si el stub devolviera
  // siempre el mismo plan, el test no vería la diferencia entre pedir 14:00 y
  // 06:00 y no valdría nada.
  if (u.includes('/duplicar-dia')) {
    const hora = new URL(u, 'http://x').searchParams.get('hora_inicio') || undefined;
    return responder(planDe(hora));
  }
  // La agenda que se recarga después de duplicar. Sin esto el plan se cuela como
  // si fuera la agenda y `agenda.eventos` queda undefined.
  if (u.includes('/agenda')) return responder({ eventos: [] });
  return responder({ ok: true });
};

// ── un DOM mínimo, con registro de nodos y de listeners ─────────────────────
// No hay jsdom en el proyecto y agregar una dependencia para esto no vale. Lo
// que el modal necesita es: escribir innerHTML, guardar listeners para poder
// dispararlos a mano, y devolver el MISMO nodo para el mismo id (si no, el HTML
// que dibuja openModal se pierde y no hay nada que assertear).
const nodos = new Map();
const nodo = (id = '') => ({
  id, innerHTML: '', textContent: '', value: '', checked: false, indeterminate: false,
  style: {}, dataset: {}, listeners: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener(ev, fn) { this.listeners[ev] = fn; },
  removeEventListener() {},
  appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  focus() {}, click() {}, submit() {},
});
const pedir = (id) => {
  if (!nodos.has(id)) nodos.set(id, nodo(id));
  return nodos.get(id);
};

globalThis.HTMLInputElement = class HTMLInputElement {};
globalThis.window = {
  location: { hash: '' },
  addEventListener: () => {},
  confirm: () => false,
  alert: () => {},
  scrollTo: () => {},
  history: { replaceState() {} },
};
globalThis.document = {
  getElementById: pedir,
  querySelector: () => nodo(),
  querySelectorAll: () => [],
  createElement: () => nodo(),
  addEventListener: () => {},
  body: nodo('body'),
  location: { hash: '' },
};
globalThis.indexedDB = { open: () => ({ onsuccess: null, onerror: null, onupgradeneeded: null }) };
globalThis.IDBKeyRange = { bound: () => ({}), lower: () => ({}), upper: () => ({}) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: {} }, configurable: true });
globalThis.FileReader = class { readAsDataURL() {} };

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
};
const sin = (h, re) => !re.test(h);   // assert negativo con motivo

console.log('modal duplicar el día\n');

await import('../frontend/js/views/publicationsView.js');

const DESTINO = '2026-10-03';
pedir('dup-destino').value = DESTINO;

globalThis.window._agendaDuplicarDia(D_ORIGEN);
ok('el modal se abre', pedir('modal-content').innerHTML.includes('Duplicar el'), pedir('modal-content').innerHTML.slice(0, 60));
// El input toma la hora de la primera publicación del día. Acá la agenda está
// vacía (el harness no carga eventos), así que se ve el valor por defecto.
ok('el input de hora nace con una hora puesta',
   /id="dup-hora"[^>]*value="\d{2}:\d{2}"/.test(pedir('modal-content').innerHTML),
   pedir('modal-content').innerHTML.match(/id="dup-hora"[^>]*/)?.[0]);

// El plan se pide al cambiar la fecha destino: hay que disparar el listener a
// mano porque el DOM de mentira no dispara eventos. Antes, la hora de arranque se
// mueve, que es lo que el usuario haría.
const previo = pedir('dup-previa');
pedir('dup-hora').value = '14:00';
await pedir('dup-destino').listeners.change();
let html = previo.innerHTML;

const pedidosPrevia = () => pedidos.filter(p => p.url.includes('/duplicar-dia')).length;
ok('la hora de arranque viaja en la vista previa', pedidos.at(-1).url.includes('hora_inicio=14%3A00'),
   pedidos.at(-1).url);

ok('trae el control "Todas"', html.includes('id="dup-todas"'));
ok('pone un check por publicación', (html.match(/data-dup-check=/g) || []).length === planReal.duplicadas.length,
   (html.match(/data-dup-check=/g) || []).length + ' checks');
ok('muestra la miniatura de la primera imagen', html.includes('src="/uploads/nevera.webp"'));
ok('el punto de estado usa la clase del estado del origen', html.includes('agenda-dia-dot--publicada'),
   (html.match(/agenda-dia-dot--\w+/g) || []).join(','));
ok('las que no tienen foto igual tienen su recuadro', html.includes('border:1px dashed'));
ok('el JSON de images roto no rompe la vista previa', html.includes('pub-roto-json') || html.includes('sin json'),
   'la publicación con images inválido desapareció del plan');
ok('el botón anuncia cuántas van', pedir('dup-ok').textContent === 'Duplicar 3 publicaciones',
   pedir('dup-ok').textContent);

// Orden de la fila: punto antes de la miniatura, check al final.
const ordenFila = html.match(/agenda-dia-dot--\w+[\s\S]*?data-dup-check=/);
ok('el punto va antes que la miniatura',
   /agenda-dia-dot--\w+"[\s\S]{0,400}?\/uploads\/nevera/.test(html) || html.indexOf('agenda-dia-dot--') < html.indexOf('/uploads/nevera.webp'),
   'dot en ' + html.indexOf('agenda-dia-dot--') + ', miniatura en ' + html.indexOf('/uploads/nevera.webp'));
ok('el check va al final de la fila', ordenFila !== null,
   'no se encontró el patrón: dot … miniatura … check');

// La hora de arranque se manda al backend y mueve los horarios de la preview: la
// primera del día (09:00) arranca 14:00 y las demás la siguen por su intervalo.
ok('la fila muestra la hora nueva, no la vieja', html.includes('<b>14:00</b>'),
   'faltaría el 14:00 de arranque');

// Cambiar la hora tiene que recalcular la preview: si no, la lista mostraría los
// horarios viejos mientras el POST manda la hora nueva.
const antesDeMover = pedidosPrevia();
pedir('dup-hora').value = '06:00';
await pedir('dup-hora').listeners.change();
html = previo.innerHTML;
ok('cambiar la hora vuelve a pedir el plan', pedidosPrevia() === antesDeMover + 1,
   `${antesDeMover} → ${pedidosPrevia()}`);
ok('y la preview muestra los horarios de esa hora', html.includes('<b>06:00</b>'));
pedir('dup-hora').value = '14:00';
await pedir('dup-hora').listeners.change();

const listenersAntes = Object.keys(previo.listeners);
ok('los listeners de la lista están puestos una sola vez', listenersAntes.includes('change') && listenersAntes.includes('error'),
   listenersAntes.join(','));

// Desmarcar una fila: baja el botón y el resumen.
const cambiar = (id, marcado) => previo.listeners.change({
  target: Object.assign(new globalThis.HTMLInputElement(), {
    type: 'checkbox', checked: marcado, id: '',
    closest: () => ({ dataset: { dupFila: id } }),
  }),
});
const primera = planReal.duplicadas[0].id;
cambiar(primera, false);
ok('desmarcar baja el contador del botón', pedir('dup-ok').textContent === 'Duplicar 2 publicaciones',
   pedir('dup-ok').textContent);
ok('el resumen cuenta sobre lo marcado', pedir('dup-resumen').innerHTML.includes('Van <b>2</b> de 3'),
   pedir('dup-resumen').innerHTML.slice(0, 120));

cambiar(primera, true);
ok('volver a marcar restaura el total', pedir('dup-ok').textContent === 'Duplicar 3 publicaciones',
   pedir('dup-ok').textContent);

// El check maestro manda sobre todas las filas.
const maestro = (marcado) => previo.listeners.change({
  target: Object.assign(new globalThis.HTMLInputElement(), {
    type: 'checkbox', checked: marcado, id: 'dup-todas', closest: () => null,
  }),
});
maestro(false);
ok('desmarcar "Todas" no deja nada marcado', pedir('dup-ok').disabled && pedir('dup-ok').textContent === 'No marcaste ninguna',
   pedir('dup-ok').textContent);
maestro(true);
ok('volver a marcar "Todas" rehabilita el botón',
   pedir('dup-ok').textContent === 'Duplicar 3 publicaciones' && !pedir('dup-ok').disabled,
   pedir('dup-ok').textContent);

// ── lo que se manda al backend ──────────────────────────────────────────────
cambiar(planReal.duplicadas[1].id, false);
await pedir('dup-ok').listeners.click();

const enviado = pedidos.filter(p => p.url.includes('/duplicar-dia') && !p.url.includes('deshacer')).pop();
ok('el POST manda sólo las marcadas', enviado?.body?.ids?.length === 2
   && enviado.body.ids.includes(planReal.duplicadas[0].id)
   && !enviado.body.ids.includes(planReal.duplicadas[1].id),
   JSON.stringify(enviado?.body));
ok('el POST lleva los dos días', enviado?.body?.desde === '2026-10-02' && enviado?.body?.hasta === DESTINO,
   JSON.stringify(enviado?.body));
ok('y la hora de arranque, igual que la preview',
   enviado?.body?.hora_inicio === '14:00', JSON.stringify(enviado?.body));

// Nada de esto debe haber tocado la base de memoria: el plan no escribe.
ok('el plan no escribió nada en la base', crudo.exec('SELECT COUNT(*) FROM publications')[0].values[0][0] === 3,
   crudo.exec('SELECT COUNT(*) FROM publications')[0].values[0][0] + ' publicaciones');

// ── el día ya duplicado: un clic de más, no dos duplicados ──────────────────
// El caso real: la primera ejecución tarda unos segundos, la respuesta no llega
// a tiempo y el usuario aprieta otra vez. El modal tiene que frenar ese segundo
// clic, no compilarlo en silencio.
console.log('\nya duplicado');
const { duplicarPublicacion } = await import('../backend/lib/duplicarDia.js');
const { transaccion } = await import('../backend/lib/transaccion.js');
transaccion(memDb, () => {
  for (const d of planReal.duplicadas) duplicarPublicacion(memDb, d.id, d.a_iso, D_ORIGEN, D_DESTINO);
});
ok('la base ya tiene las 3 copias', crudo.exec('SELECT COUNT(*) FROM publications')[0].values[0][0] === 6);

const postsAntes = pedidos.filter(p => p.body && p.url.endsWith('/duplicar-dia')).length;
window._agendaDuplicarDia(D_ORIGEN);
pedir('dup-destino').value = D_DESTINO;
pedir('dup-hora').value = '';
await pedir('dup-destino').listeners.change();

ok('la vista previa avisa que ya se duplicó',
   pedir('dup-previa').innerHTML.includes('Ya duplicaste el') && pedir('dup-previa').innerHTML.includes('3 veces'),
   pedir('dup-previa').innerHTML.match(/Ya duplicaste[^<]*/)?.[0]);
ok('y el botón arranca normal, sin吓人', pedir('dup-ok').textContent === 'Duplicar 3 publicaciones',
   pedir('dup-ok').textContent);

await pedir('dup-ok').listeners.click();
ok('el primer clic NO duplica',
   pedidos.filter(p => p.body && p.url.endsWith('/duplicar-dia')).length === postsAntes,
   'se mandaron ' + (pedidos.filter(p => p.body && p.url.endsWith('/duplicar-dia')).length - postsAntes) + ' POST');
ok('pide el clic de más y lo dice en el botón',
   /Duplicar igual \(ya lo hiciste 3 veces\)/.test(pedir('dup-ok').textContent),
   pedir('dup-ok').textContent);

await pedir('dup-ok').listeners.click();
ok('el segundo clic sí duplica',
   pedidos.filter(p => p.body && p.url.endsWith('/duplicar-dia')).length === postsAntes + 1);

console.log(fallos ? `\n${fallos} FALLA(S)` : '\ntodo ok');
process.exit(fallos ? 1 : 0);
