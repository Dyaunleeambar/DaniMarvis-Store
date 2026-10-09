// Tests de duplicarDia: llevar un día entero del calendario a otro día.
//
// Se importa la lógica real (backend/lib/duplicarDia.js) contra una base sql.js
// EN MEMORIA con el mismo esquema, así el test no toca la del servidor.
//
// El caso que motiva esto es el historial. La versión anterior de esta
// operación MOVER el día: cambiaba publication_date de cada publicación y
// archivaba lo publicado. El día de origen quedaba vacío en el calendario (lo
// archivado no se ve, ver el filtro de /agenda) y toda la agenda de un día llena
// de publicaciones desaparecía de un golpe. Estos tests fijan lo contrario: el
// origen queda intacto y la copia es lo único que aparece nuevo.
import { abrirMemoria } from './helpers/sqljs.mjs';
import { planDuplicacionDia, duplicarPublicacion, acotarPlan, contextoRotacion, offsetRotacion, reubicarDuplicadas } from '../backend/lib/duplicarDia.js';
import { transaccion } from '../backend/lib/transaccion.js';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
    id TEXT PRIMARY KEY, origen_id TEXT, clon_id TEXT, desde TEXT, hasta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;
const { db } = await abrirMemoria(ESQUEMA);

let n = 0;
const uid = () => 'id-' + (++n);
const hora = (local) => new Date(local).toISOString();   // 'YYYY-MM-DDTHH:MM' local → UTC ISO

function crearPublicacion({ fecha, nombre = 'Producto', destinos = [], texto = 'texto', sort = 0 }) {
  const id = uid();
  db.prepare(`INSERT INTO publications (id, product_id, product_name, publish_text, images, publication_date, sort_order)
              VALUES (?, 'prod-1', ?, ?, '["/uploads/a.webp"]', ?, ?)`)
    .run(id, nombre, texto, fecha, sort);
  for (const d of destinos) {
    db.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, group_url, status,
                  scheduled_at, published_at, variant_index, variant_text, images, pending_approval)
                VALUES (?, ?, ?, 'https://fb/g', ?, ?, ?, 0, 'texto del destino', '[]', ?)`)
      .run(uid(), id, d.grupo, d.status, d.fecha || fecha,
           d.status === 'published' ? hora('2026-10-02T10:05') : null, d.aprobacion || 0);
  }
  return id;
}

const pub = (id) => db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
const cola = (id) => db.prepare('SELECT * FROM publication_queue WHERE publication_id = ? ORDER BY group_name').all(id);
const enDia = (fecha) => db.prepare(`
  SELECT COUNT(*) AS n FROM publications
  WHERE publication_date >= ? AND publication_date < ?`).get(
    new Date(`${fecha}T00:00:00`).toISOString(),
    new Date(new Date(`${fecha}T00:00:00`).getTime() + 86400000).toISOString()).n;
const clonDe = (origenId) => db.prepare('SELECT clon_id FROM publication_clones WHERE origen_id = ?').get(origenId)?.clon_id;

console.log('duplicarDia\n');

// ── un día con las cinco situaciones que se pueden encontrar ───────────────
const D = '2026-10-02', H = '2026-10-03';
const pPublicada = crearPublicacion({ fecha: hora('2026-10-02T09:00'), nombre: 'Nevera',
  destinos: [{ grupo: 'Revolico Matanzas', status: 'published' }] });
const pPendiente = crearPublicacion({ fecha: hora('2026-10-02T13:30'), nombre: 'Lavadora',
  destinos: [{ grupo: 'Revolico Habana', status: 'pending' }] });
const pError = crearPublicacion({ fecha: hora('2026-10-02T18:45'), nombre: 'Aire',
  destinos: [{ grupo: 'Revolico Santiago', status: 'error' }] });
const pMixta = crearPublicacion({ fecha: hora('2026-10-02T21:15'), nombre: 'Ventilador', destinos: [
  { grupo: 'Grupo A', status: 'published' }, { grupo: 'Grupo B', status: 'pending' },
  { grupo: 'Grupo C', status: 'error' }, { grupo: 'Grupo D', status: 'cancelled' },
  { grupo: 'Grupo E', status: 'archived' }] });
const pSolitaria = crearPublicacion({ fecha: hora('2026-10-02T07:05'), nombre: 'Sin agendar' });
// Un día que no es el de origen, para que no se cuele en el plan
const pOtroDia = crearPublicacion({ fecha: hora('2026-10-05T10:00'), nombre: 'Otro día',
  destinos: [{ grupo: 'Revolico Matanzas', status: 'pending' }] });

const colaAntes = Object.fromEntries([pPublicada, pPendiente, pError, pMixta, pSolitaria]
  .map(id => [id, cola(id).map(d => `${d.group_name}:${d.status}:${d.scheduled_at}:${d.published_at}`).join('|')]));

// Vista previa: informa, NO escribe
const plan = planDuplicacionDia(db, D, H);
ok('la vista previa no escribe nada', enDia(H) === 0 && enDia(D) === 5, `destino con ${enDia(H)}`);
ok('duplica el día COMPLETO, sin omitidas', plan.duplicadas.length === 5,
   'obtenidas ' + plan.duplicadas.length);
ok('no se cuela la publicación de otro día', !plan.duplicadas.some(d => d.id === pOtroDia));
ok('cuenta los destinos de cada una',
   eq(plan.duplicadas.find(d => d.id === pMixta).destinos, 5));
ok('cuenta cuántos estaban publicados',
   plan.duplicadas.find(d => d.id === pMixta).publicados === 1);
ok('avisa de la publicación sin destinos', /no tienen ningún destino/.test(plan.avisos.join(' ')));
ok('sin omitidas en el plan', plan.omitidas === undefined);

// Lo que usa la miniatura y el punto de color de la vista previa.
//
// Ojo con el estado: "Programada" y "Vencida" son las mismas filas 'pending' en
// momentos distintos, así que el fixture es del 2 de octubre y el reloj del
// runner ya puede estar pasado. Por eso lo pendiente se compara contra la hora,
// en vez de hardcodear 'programada'.
const vencida = (iso) => Date.now() > new Date(iso).getTime();
ok('trae la primera imagen de la publicación',
   plan.duplicadas.every(d => d.imagen === '/uploads/a.webp'),
   JSON.stringify(plan.duplicadas.map(d => d.imagen)));
ok('el estado del origen calza con el calendario',
   plan.duplicadas.find(d => d.id === pPublicada).estado === 'publicada'
   && plan.duplicadas.find(d => d.id === pError).estado === 'error'
   && plan.duplicadas.find(d => d.id === pSolitaria).estado === 'material',
   plan.duplicadas.map(d => d.estado).join(','));
ok('lo pendiente es programada si falta, vencida si ya pasó',
   plan.duplicadas.find(d => d.id === pPendiente).estado
     === (vencida(hora('2026-10-02T13:30')) ? 'vencida' : 'programada'),
   plan.duplicadas.find(d => d.id === pPendiente).estado);
ok('con parte publicada y algo pendiente queda parcial',
   plan.duplicadas.find(d => d.id === pMixta).estado
     === (vencida(hora('2026-10-02T21:15')) ? 'parcial_vencida' : 'parcial'),
   plan.duplicadas.find(d => d.id === pMixta).estado);
ok('trae el nombre corto para los textos del modal',
   plan.duplicadas.find(d => d.id === pPublicada).nombre === 'Nevera');

// Conserva la hora local (el caso del desfase de 4 horas)
const deNevera = plan.duplicadas.find(d => d.id === pPublicada);
ok('conserva la hora de pared (09:00 → 09:00)', deNevera.de_hora === '09:00' && deNevera.a_hora === '09:00',
   deNevera.de_hora + ' -> ' + deNevera.a_hora);
const deTarde = plan.duplicadas.find(d => d.id === pMixta);
ok('conserva la hora de la noche (21:15 → 21:15)', deTarde.de_hora === '21:15' && deTarde.a_hora === '21:15',
   deTarde.de_hora + ' -> ' + deTarde.a_hora);
ok('la fecha destino es un día local más', deNevera.a_iso.slice(0, 10) === '2026-10-03', deNevera.a_iso);

// Aplicar
transaccion(db, () => {
  for (const d of plan.duplicadas) d.clon_id = duplicarPublicacion(db, d.id, d.a_iso, D, H);
});

ok('el día destino tiene las 5 copias', enDia(H) === 5, 'obtenidas ' + enDia(H));
ok('el día origen sigue con las 5', enDia(D) === 5, 'obtenidas ' + enDia(D));
ok('las copias no pisan a las originales',
   enDia(D) === 5 && db.prepare(`SELECT COUNT(*) AS n FROM publications WHERE id IN (?,?,?,?,?)`)
     .get(pPublicada, pPendiente, pError, pMixta, pSolitaria).n === 5);

// ── el origen intacto, fila por fila ────────────────────────────────────────
let intactas = 0;
for (const [id, antes] of Object.entries(colaAntes)) {
  const ahora = cola(id).map(d => `${d.group_name}:${d.status}:${d.scheduled_at}:${d.published_at}`).join('|');
  if (antes === ahora) intactas++;
}
ok('los destinos del origen no cambiaron ni de estado ni de horario', intactas === 5, intactas + ' de 5');
ok('lo publicado del origen sigue published (noarchived)',
   cola(pPublicada)[0].status === 'published' && !!cola(pPublicada)[0].published_at);
ok('el origen no tiene destinos nuevos',
   cola(pMixta).length === 5 && db.prepare(`SELECT COUNT(*) AS n FROM publication_queue WHERE publication_id = ?`).get(pPublicada).n === 1);

// ── la copia ───────────────────────────────────────────────────────────────
const cMixta = clonDe(pMixta);
ok('el vínculo origen → copia quedó registrado', !!cMixta && pub(cMixta).id === cMixta);
const colaCopia = cola(cMixta);
ok('la copia tiene los 5 destinos, todos pending',
   colaCopia.length === 5 && colaCopia.every(d => d.status === 'pending'),
   JSON.stringify(colaCopia.map(d => d.status)));
ok('la copia no arrastra el published_at',
   colaCopia.every(d => d.published_at === null));
ok('la copia conserva los mismos grupos',
   eq(colaCopia.map(d => d.group_name), ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D', 'Grupo E']));
ok('los destinos de la copia caen en la fecha del clon',
   colaCopia.every(d => d.scheduled_at === pub(cMixta).publication_date));
ok('se copió también el destino archivado del origen',
   colaCopia.some(d => d.group_name === 'Grupo E'));
ok('se copió el texto y las imágenes del destino',
   colaCopia.every(d => d.variant_text === 'texto del destino' && d.images === '[]'));
ok('copia contenido, hora y orden de la publicación',
   pub(cMixta).publish_text === pub(pMixta).publish_text
   && pub(cMixta).images === pub(pMixta).images
   && pub(cMixta).product_id === pub(pMixta).product_id
   && pub(cMixta).product_name === pub(pMixta).product_name
   && pub(cMixta).publication_date === plan.duplicadas.find(d => d.id === pMixta).a_iso);
ok('la copia sin destinos también se copia', !!clonDe(pSolitaria) && cola(clonDe(pSolitaria)).length === 0);
ok('el worker tiene trabajo en el día nuevo',
   db.prepare(`SELECT COUNT(*) AS n FROM publication_queue WHERE status='pending' AND publication_id IN
               (SELECT clon_id FROM publication_clones)`).get().n === 8,
   db.prepare(`SELECT COUNT(*) AS n FROM publication_queue WHERE status='pending' AND publication_id IN
               (SELECT clon_id FROM publication_clones)`).get().n + ' pendientes');

// Duplicar dos veces el mismo día no se come el origen
const plan2 = planDuplicacionDia(db, D, H);
transaccion(db, () => {
  for (const d of plan2.duplicadas) duplicarPublicacion(db, d.id, d.a_iso, D, H);
});
ok('duplicar dos veces deja 15 publicaciones en total',
   db.prepare('SELECT COUNT(*) AS n FROM publications').get().n === 16,   // 5 orig + 5 + 5 + la de otro día
   db.prepare('SELECT COUNT(*) AS n FROM publications').get().n + '');

// ── deshacer ────────────────────────────────────────────────────────────────
const clonesABorrar = db.prepare('SELECT clon_id FROM publication_clones').all().map(r => r.clon_id);
const antesDeBorrar = db.prepare('SELECT COUNT(*) AS n FROM publications').get().n;
for (const clonId of clonesABorrar) {
  db.prepare('DELETE FROM publication_queue WHERE publication_id = ?').run(clonId);
  db.prepare('DELETE FROM publication_clones WHERE clon_id = ?').run(clonId);
  db.prepare('DELETE FROM publications WHERE id = ?').run(clonId);
}
ok('deshacer deja sólo las originales',
   db.prepare('SELECT COUNT(*) AS n FROM publications').get().n === antesDeBorrar - 10);
ok('deshacer no toca los destinos del origen',
   db.prepare(`SELECT COUNT(*) AS n FROM publication_queue WHERE publication_id = ?`).get(pMixta).n === 5);
ok('no quedan vínculos colgados',
   db.prepare('SELECT COUNT(*) AS n FROM publication_clones').get().n === 0);
ok('no queda ni una publicación huérfana en la cola',
   db.prepare(`SELECT COUNT(*) AS n FROM publication_queue pq
               WHERE pq.publication_id IS NOT NULL
                 AND pq.publication_id NOT IN (SELECT id FROM publications)`).get().n === 0);

// ── conflictos contra lo que ya está en el destino ─────────────────────────
console.log('conflictos');
db.prepare('DELETE FROM publication_queue WHERE publication_id = ?').run(pOtroDia);
crearPublicacion({ fecha: hora('2026-10-03T09:40'), nombre: 'Ya existente',
  destinos: [{ grupo: 'Revolico Matanzas', status: 'pending', fecha: hora('2026-10-03T09:40') }] });
const conChoque = planDuplicacionDia(db, D, H);
ok('avisa el choque en el mismo grupo a menos de 2h',
   conChoque.conflictos.some(c => c.con === 'Ya existente' && c.minutos === 40),
   JSON.stringify(conChoque.conflictos));
ok('el choque sabe de qué publicación viene, para filtrarlo con la selección',
   conChoque.conflictos.every(c => conChoque.duplicadas.some(d => d.id === c.de_id && d.nombre === c.de_nombre)));
ok('el choque no bloquea: la duplicación sigue planeándose',
   conChoque.duplicadas.length === 5);
const sinChoque = planDuplicacionDia(db, D, '2026-10-09');
ok('sin choque si el destino está lejos', sinChoque.conflictos.length === 0,
   JSON.stringify(sinChoque.conflictos));

// ── la hora de arranque: el día entra como bloque ───────────────────────────
console.log('hora de arranque');
// El fixture del día: 07:05, 09:00, 13:30, 18:45, 21:15. Los intervalos contra
// la primera son 0, 1:55, 6:25, 11:40 y 14:10.
const bloque = planDuplicacionDia(db, D, H, '14:00');
const horas = (p) => p.duplicadas.map(d => d.a_hora);
ok('la primera publicación cae en la hora pedida', horas(bloque)[0] === '14:00', horas(bloque).join(','));
ok('las demás conservan el intervalo respecto de la primera',
   eq(horas(bloque), ['14:00', '15:55', '20:25', '01:40', '04:10']), horas(bloque).join(','));
ok('el bloque no deforma: los intervalos salen idénticos al milisegundo',
   eq(bloque.duplicadas.map(d => d.a_iso),
      bloque.duplicadas.map(d => new Date(new Date(bloque.duplicadas[0].a_iso).getTime() +
        (new Date(d.de_iso) - new Date(bloque.duplicadas[0].de_iso))).toISOString())));
ok('el plan avisa si el bloque no entra en el día',
   bloque.duplicadas.some(d => d.a_fecha !== H) && /caen fuera del/.test(bloque.avisos.join(' ')),
   bloque.avisos.join(' | '));
ok('la fila dice en qué fecha cae cuando no es el día destino',
   bloque.duplicadas.filter(d => d.a_fecha !== H).length === 2);

// Pedir la hora que ya tenía la primera publicación tiene que dar lo mismo que
// no pedir nada: es el valor con el que el modal abre el input.
const misma = planDuplicacionDia(db, D, H, '07:05');
ok('arrancar a la hora de la primera es igual que no arrancar a ninguna',
   eq(misma.duplicadas.map(d => d.a_iso), plan.duplicadas.map(d => d.a_iso)));

// Sin hora, o con una que no existe, sigue el comportamiento de siempre.
ok('una hora inválida no rompe: cae en "cada una con la suya"',
   eq(planDuplicacionDia(db, D, H, '25:00').duplicadas.map(d => d.a_iso),
      plan.duplicadas.map(d => d.a_iso))
   && eq(planDuplicacionDia(db, D, H, 'no es hora').duplicadas.map(d => d.a_iso),
      plan.duplicadas.map(d => d.a_iso)));
ok('el plan recuerda la hora que usó', bloque.hora_inicio === '14:00' && plan.hora_inicio === null);

// ── el aviso de "ya lo duplicaste" ───────────────────────────────────
// La razón de existir: si la primera ejecución tarda y la respuesta no llega a
// tiempo, el usuario aprieta otra vez y el día destino queda con cada
// publicación repetida. El plan tiene que avisar ANTES del clic.
//
// Va al final y con días destino propios: si duplicara al 3/oct, los tests de
// selección de abajo encontrarían un día destino que ya tenía copias y la
// comparación de horarios no diría nada.
console.log('ya duplicado');
ok('un día sin duplicar no avisa',
   plan.ya_duplicada === 0 && !plan.avisos.some(a => /Ya duplicaste/.test(a)),
   JSON.stringify(plan.avisos));

const UNA = '2026-10-20', DOS = '2026-10-21';
// El ISO lo decide el plan del día destino, no el `hasta` del vínculo: la copia
// cae donde dice a_iso. Usar el a_iso de otro plan siembra las copias en el día
// que ese plan dice, que es justo el día de los tests de selección.
transaccion(db, () => {
  const sola = planDuplicacionDia(db, D, UNA);
  duplicarPublicacion(db, sola.duplicadas[0].id, sola.duplicadas[0].a_iso, D, UNA);
});
const primera = planDuplicacionDia(db, D, UNA);
ok('una sola vez lo dice en singular',
   primera.ya_duplicada === 1 && primera.avisos.some(a => /Ya duplicaste.* 1 vez:/.test(a)),
   JSON.stringify(primera.avisos));

transaccion(db, () => {
  for (const d of planDuplicacionDia(db, D, DOS).duplicadas) {
    duplicarPublicacion(db, d.id, d.a_iso, D, DOS);
  }
});
const repetido = planDuplicacionDia(db, D, DOS);
ok('después de duplicar, el plan cuenta las veces',
   repetido.ya_duplicada === plan.duplicadas.length, String(repetido.ya_duplicada));
ok('y el aviso dice cuántas', repetido.avisos.some(a => a.includes(`${plan.duplicadas.length} veces`)),
   JSON.stringify(repetido.avisos));
ok('el aviso no cambia el plan ni lo impide', repetido.duplicadas.length === plan.duplicadas.length);
ok('acotarPlan deja pasar el contador', acotarPlan(repetido, [pPendiente]).ya_duplicada === repetido.ya_duplicada);
ok('otro día destino no se contamina', planDuplicacionDia(db, D, '2026-10-22').ya_duplicada === 0);
ok('ni el día que los tests de selección usan', planDuplicacionDia(db, D, H).ya_duplicada === 0);

// ── la selección de la vista previa ─────────────────────────────────────────
console.log('selección');
const elegidas = [pPendiente, pMixta, pError];
const acotado = acotarPlan(conChoque, elegidas);
ok('acota el plan a lo marcado', eq(
   [...acotado.duplicadas.map(d => d.id)].sort(), [...elegidas].sort()));
ok('los conflictos de lo desmarcado no avisan',
   acotado.conflictos.every(c => elegidas.includes(c.de_id)));
ok('sin `ids` se copia el día entero (comportamiento por defecto)',
   acotarPlan(conChoque, undefined).duplicadas.length === 5
   && acotarPlan(conChoque, []).duplicadas.length === 0);
ok('un id que ya no está en el plan no rompe: va en `fuera`',
   eq(acotarPlan(conChoque, [...elegidas, 'id-fantasma']).fuera, ['id-fantasma']));
ok('acotar no muta el plan original', conChoque.duplicadas.length === 5);

// Con la selección acotada, en la fila de más destinos:
transaccion(db, () => {
  for (const d of acotado.duplicadas) duplicarPublicacion(db, d.id, d.a_iso, D, H);
});
const enDestino = db.prepare('SELECT COUNT(*) AS n FROM publications WHERE publication_date >= ? AND publication_date < ?')
  .get(new Date(`${H}T00:00:00`).toISOString(),
       new Date(new Date(`${H}T00:00:00`).getTime() + 86400000).toISOString()).n;
ok('sólo se copian las marcadas',
   // las 3 copias + la 'Ya existente' que se creó para el caso de conflicto
   Number(enDestino) === 4, `${JSON.stringify(enDestino)} (${typeof enDestino})`);
// Scopadas al día destino: contar la tabla entera acopla este test al de "ya
// duplicado", que también crea vínculos (en otros días, para no tocar éste).
ok('las no marcadas siguen sin copia',
   db.prepare('SELECT COUNT(*) AS n FROM publication_clones WHERE hasta = ?').get(H).n === 3,
   db.prepare('SELECT COUNT(*) AS n FROM publication_clones WHERE hasta = ?').get(H).n + '');
ok('las copias son de lo marcado y sólo de eso',
   db.prepare('SELECT COUNT(*) AS n FROM publication_clones WHERE hasta = ? AND origen_id NOT IN (?,?,?)')
     .get(H, elegidas[0], elegidas[1], elegidas[2]).n === 0);

// ── reordenar horarios y rotar destinos ─────────────────────────────────────
// Ambas opciones sirven para que el día nuevo no sea calcado del origen. La
// previa y el apply comparten la semilla origen→destino, así que son
// deterministas: pedir el mismo par de días da siempre el mismo plan.
console.log('reordenar y rotar destinos');
db.exec(`CREATE TABLE IF NOT EXISTS facebook_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT DEFAULT '', sort_order INTEGER DEFAULT 0)`);
const catalogoSeed = ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D', 'Grupo E',
  'Grupo F', 'Grupo G', 'Grupo H', 'Revolico Matanzas', 'Revolico Habana', 'Revolico Santiago'];
catalogoSeed.forEach((name, i) => db.prepare(
  'INSERT INTO facebook_groups (id, name, url, sort_order) VALUES (?,?,?,?)'
).run('g' + i, name, 'https://fb/' + name, i));

const R = '2026-12-01';
const baseR = planDuplicacionDia(db, D, R);
const reorden = planDuplicacionDia(db, D, R, null, { reordenar: true });

ok('reordenar no cambia el conjunto de horas: es una permutación',
   eq([...reorden.duplicadas.map(d => d.a_iso)].sort(), [...baseR.duplicadas.map(d => d.a_iso)].sort()));
ok('reordenar sí cambia el orden de las filas',
   !eq(reorden.duplicadas.map(d => d.a_iso), baseR.duplicadas.map(d => d.a_iso)));
ok('reordenar es determinista (misma semilla, mismo resultado)',
   eq(reorden.duplicadas.map(d => d.a_iso),
      planDuplicacionDia(db, D, R, null, { reordenar: true }).duplicadas.map(d => d.a_iso)));

const rotar = planDuplicacionDia(db, D, R, null, { rotar_destinos: true });
const filaMixta = rotar.duplicadas.find(d => d.id === pMixta);
ok('rotar expone los grupos nuevos por publicación',
   Array.isArray(filaMixta.grupos_nuevos) && filaMixta.grupos_nuevos.length === 5,
   JSON.stringify(filaMixta.grupos_nuevos));
ok('rotar mueve CADA destino a un grupo distinto',
   filaMixta.grupos_nuevos.every((g, i) => g !== filaMixta.grupos[i]),
   JSON.stringify([filaMixta.grupos, filaMixta.grupos_nuevos]));
ok('rotar mantiene los destinos distintos entre sí (es una biyección)',
   new Set(filaMixta.grupos_nuevos).size === filaMixta.grupos_nuevos.length);
ok('rotar conserva la cantidad de destinos por publicación',
   rotar.duplicadas.every(d => d.destinos === 0 || d.grupos_nuevos.length === d.destinos));
ok('rotar es determinista',
   eq(rotar.duplicadas.find(d => d.id === pMixta).grupos_nuevos, filaMixta.grupos_nuevos));
ok('sin la opción no hay grupos nuevos', baseR.duplicadas.every(d => d.grupos_nuevos === undefined));
ok('el plan recuerda las opciones aplicadas',
   reorden.reordenar === true && reorden.rotar_destinos === false
   && rotar.rotar_destinos === true && rotar.reordenar === false
   && baseR.reordenar === false && baseR.rotar_destinos === false);
ok('el corrimiento nunca es 0 con más de un grupo',
   [2, 3, 5, 11].every(m => offsetRotacion(D, R, m) >= 1 && offsetRotacion(D, R, m) <= m - 1));
ok('no hay rotación posible con 0 o 1 grupos',
   offsetRotacion(D, R, 0) === 0 && offsetRotacion(D, R, 1) === 0);

// La copia real tiene que caer en los grupos que mostró la previa: previa y apply
// comparten `contextoRotacion`, así que no pueden discrepar.
const RT = '2026-12-02';
const planRT = planDuplicacionDia(db, D, RT, null, { reordenar: true, rotar_destinos: true });
const rot = contextoRotacion(db, D, RT);
transaccion(db, () => {
  for (const d of planRT.duplicadas) duplicarPublicacion(db, d.id, d.a_iso, D, RT, rot);
});
const clonRT = db.prepare('SELECT clon_id FROM publication_clones WHERE origen_id = ? AND hasta = ?').get(pMixta, RT)?.clon_id;
const previsto = planRT.duplicadas.find(d => d.id === pMixta);
ok('la copia cae en los grupos que mostró la previa',
   eq(cola(clonRT).map(d => d.group_name).sort(), [...previsto.grupos_nuevos].sort()),
   JSON.stringify(cola(clonRT).map(d => d.group_name)));
ok('la copia rotada conserva el resto de la fila (variante, imágenes)',
   cola(clonRT).every(d => d.variant_text === 'texto del destino' && d.images === '[]'));
ok('el origen no se movió de grupos',
   eq(cola(pMixta).map(d => d.group_name).sort(),
      ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D', 'Grupo E'].sort()));

console.log(fallos ? `\n${fallos} FALLA(S)` : '\ntodo ok');
process.exit(fallos ? 1 : 0);