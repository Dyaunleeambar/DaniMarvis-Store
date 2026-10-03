// Transacciones de la BD.
//
// El caso que motiva esto se golpeó en producción: "Duplicar el día" devolvía
// "cannot commit - no transaction is active" y se comía las copias. La causa no
// era la duplicación sino que este proyecto reescribe el archivo de la BD después
// de cada run(), y guardar es db.export(), que CIERRA la transacción abierta con
// un rollback. O sea: BEGIN → INSERT → COMMIT a mano pierde la fila y revienta el
// COMMIT.
//
// Estos tests fijan el contrato de lib/transaccion.js con la función real, contra
// una base en memoria cuyo shim guarda en cada escritura igual que el servidor.
import { abrirMemoria } from './helpers/sqljs.mjs';
import { transaccion } from '../backend/lib/transaccion.js';
import { planDuplicacionDia, duplicarPublicacion } from '../backend/lib/duplicarDia.js';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
};

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
`;

console.log('transacciones\n');

const { db } = await abrirMemoria(ESQUEMA);
db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
  .run('p1', 'Uno', new Date('2026-10-02T09:00').toISOString());

// ── por qué no se puede a mano ───────────────────────────────────────────────
let falloManual = '';
try {
  db.exec('BEGIN');
  db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
    .run('p-manual', 'Manual', new Date('2026-10-02T10:00').toISOString());
  db.exec('COMMIT');
} catch (err) {
  falloManual = err.message;
}
ok('BEGIN/COMMIT a mano revienta (por eso existe transaccion())',
   /no transaction is active/.test(falloManual), falloManual || 'no falló, y entonces el shim no es fiel');
ok('y además la escritura se perdió en el camino',
   db.prepare('SELECT COUNT(*) AS n FROM publications WHERE id = ?').get('p-manual').n === 0,
   'la fila quedó, o sea que db.export() no está cerrando la transacción');

// ── transaccion() ────────────────────────────────────────────────────────────
db.resetGuardadas();
transaccion(db, () => {
  db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
    .run('p2', 'Dos', new Date('2026-10-02T11:00').toISOString());
  db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
    .run('p3', 'Tres', new Date('2026-10-02T12:00').toISOString());
});
ok('la transacción escribe todo', db.prepare('SELECT COUNT(*) AS n FROM publications').get().n === 3);
ok('guarda el archivo UNA vez, al final', db.guardadas === 1, db.guardadas + ' guardadas');
ok('no queda abierta', db.enTransaccion === false);

db.resetGuardadas();
let errTirado = null;
try {
  transaccion(db, () => {
    db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
      .run('p4', 'Cuatro', new Date('2026-10-02T13:00').toISOString());
    throw new Error('se rompió a mitad de camino');
  });
} catch (err) {
  errTirado = err.message;
}
ok('el error sube', errTirado === 'se rompió a mitad de camino', errTirado || 'no subió');
ok('un fallo a mitad no deja nada a medias',
   db.prepare('SELECT COUNT(*) AS n FROM publications WHERE id = ?').get('p4').n === 0);
ok('y tampoco guarda el archivo', db.guardadas === 0, db.guardadas + ' guardadas');
ok('la bandera se limpió igual', db.enTransaccion === false);

// Anidamiento: sólo la más externa abre, cierra y guarda.
db.resetGuardadas();
transaccion(db, () => {
  db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
    .run('p5', 'Cinco', new Date('2026-10-02T14:00').toISOString());
  transaccion(db, () => {
    db.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
      .run('p6', 'Seis', new Date('2026-10-02T15:00').toISOString());
  });
});
ok('anidar guarda una sola vez', db.guardadas === 1, db.guardadas + ' guardadas');
ok('anidar escribe todo', db.prepare('SELECT COUNT(*) AS n FROM publications').get().n === 5);

// ── la promesa del todo o nada, sobre la operación real ──────────────────────
// Con la tabla de vínculos, que es la que usa duplicarPublicacion.
const { db: db2 } = await abrirMemoria(ESQUEMA + `
  CREATE TABLE publication_clones (
    id TEXT PRIMARY KEY, origen_id TEXT, clon_id TEXT, desde TEXT, hasta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
for (const [i, h] of ['09:00', '11:00', '13:00', '15:00', '17:00'].entries()) {
  db2.prepare('INSERT INTO publications (id, product_name, publication_date) VALUES (?, ?, ?)')
    .run('pub' + i, 'P' + i, new Date(`2026-10-02T${h}:00`).toISOString());
  db2.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, scheduled_at)
               VALUES (?, ?, ?, ?, ?)`)
    .run('q' + i, 'pub' + i, 'Grupo ' + i, 'pending', new Date(`2026-10-02T${h}:00`).toISOString());
}
const plan = planDuplicacionDia(db2, '2026-10-02', '2026-10-03');
let n = 0;
try {
  transaccion(db2, () => {
    for (const d of plan.duplicadas) {
      if (++n === 3) throw new Error('se cayó el worker a la tercera');
      duplicarPublicacion(db2, d.id, d.a_iso, '2026-10-02', '2026-10-03');
    }
  });
} catch { /* el error es lo que estamos probando */ }
ok('duplicar el día a medias no deja copias colgadas',
   db2.prepare('SELECT COUNT(*) AS n FROM publications WHERE publication_date >= ?')
     .get(new Date('2026-10-03T00:00:00').toISOString()).n === 0);
ok('ni destinos huérfanos',
   db2.prepare(`SELECT COUNT(*) AS n FROM publication_queue pq WHERE pq.publication_id IS NOT NULL
                AND pq.publication_id NOT IN (SELECT id FROM publications)`).get().n === 0);
ok('ni vínculos a medias', db2.prepare('SELECT COUNT(*) AS n FROM publication_clones').get().n === 0);

// Y ahora la operación completa, sin fallos, que es el caso de uso real.
transaccion(db2, () => {
  for (const d of plan.duplicadas) duplicarPublicacion(db2, d.id, d.a_iso, '2026-10-02', '2026-10-03');
});
ok('sin fallos, se copian las 5',
   db2.prepare('SELECT COUNT(*) AS n FROM publications WHERE publication_date >= ?')
     .get(new Date('2026-10-03T00:00:00').toISOString()).n === 5);
ok('el origen sigue con las suyas',
   db2.prepare(`SELECT COUNT(*) AS n FROM publications WHERE publication_date < ?`)
     .get(new Date('2026-10-03T00:00:00').toISOString()).n === 5);
ok('quedan 5 vínculos origen → copia', db2.prepare('SELECT COUNT(*) AS n FROM publication_clones').get().n === 5);

console.log(fallos ? `\n${fallos} FALLA(S)` : '\ntodo ok');
process.exit(fallos ? 1 : 0);
