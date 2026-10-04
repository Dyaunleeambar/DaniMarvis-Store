// Tests de los límites de ritmo del disparador por fecha y del deshacer parcial.
//
// El motivo de todo esto está en el 2026-10-03. El disparador por fecha no
// tenía freno de ninguno: pasaba TODOS los vencidos como `ids` y runGroupPublish
// los sacaba de a uno con 45-135 s de pausa. Con el día duplicado (190 destinos)
//-salieron ~17 publicaciones por hora. Facebook dejó de aceptarlas a las 07:21
// sin avisar nada en pantalla (el compositor se quedaba con el texto y listo), y
// como la separación se medía contra la última publicación *exitosa* —un valor
// que con todo fallando nunca avanza— cada fallo era seguido del siguiente
// vencido: 30 errores iguales en 2 horas.
//
// Estos tests fijan las tres reglas que cortan esa cascada, más el criterio del
// deshacer, que antes era inútil: si una copia tenía un destino publicado, no
// borraba NINGUNO de los destinos de esa copia, ni los que nunca salieron.
//
// Lo que se puede probar sin navegador va con funciones puras o con la base en
// memoria (scripts/helpers/sqljs.mjs). Lo que necesita Chrome de verdad (que el
// clic en "Publicar" surta efecto) no se prueba acá: se mira en un post real.
import { abrirMemoria } from './helpers/sqljs.mjs';
import {
  evaluarLimites, cuantosPorTick, claveDuplicado, marcarDuplicadosEn,
  parsePosterDiag, classifyFailure, CAUSAS, DEFAULT_AGENDA,
} from '../backend/lib/groupPublisher.js';
import { deshacerDuplicacion } from '../backend/lib/duplicarDia.js';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MIN = 60000;

const CFG = {
  min_gap_min: 15,
  max_per_hour: 4,
  dedupe_hours: 6,
  breaker_failures: 3,
  breaker_cooldown_min: 60,
};

// ── 1. la política de ritmo ──────────────────────────────────────────────────
console.log('\n1. evaluarLimites: qué decide salir y qué frena');
{
  const ahora = Date.UTC(2026, 9, 3, 15, 0, 0);

  ok('sin intento previo, deja salir',
    evaluarLimites({ cfg: CFG, nowMs: ahora, lastAttemptMs: null, intentosHora: 0 }).ok);

  const hace5 = evaluarLimites({ cfg: CFG, nowMs: ahora, lastAttemptMs: ahora - 5 * MIN, intentosHora: 0 });
  ok('a los 5 min frena por separación', !hace5.ok && hace5.codigo === 'gap');
  ok('el motivo dice cuántos minutos faltan', /faltan 10 min/.test(hace5.motivo), hace5.motivo);

  ok('a los 15 min exactos deja salir',
    evaluarLimites({ cfg: CFG, nowMs: ahora, lastAttemptMs: ahora - 15 * MIN, intentosHora: 0 }).ok);

  const tope = evaluarLimites({ cfg: CFG, nowMs: ahora, lastAttemptMs: ahora - 20 * MIN, intentosHora: 4 });
  ok('con 4 en la hora frena por tope', !tope.ok && tope.codigo === 'tope_hora', tope.motivo);
  ok('el motivo nombra el tope', /tope de 4 publicaciones por hora/.test(tope.motivo), tope.motivo);

  ok('con 3 en la hora todavía deja salir',
    evaluarLimites({ cfg: CFG, nowMs: ahora, lastAttemptMs: ahora - 20 * MIN, intentosHora: 3 }).ok);

  // El corte automático manda sobre todo lo demás: si está activo, ni el gap ni
  // el tope son la razón por la que frena, porque hay una razón mejor.
  const corte = evaluarLimites({
    cfg: CFG, nowMs: ahora, intentosHora: 0,
    breaker: { failures: 0, fallos: 3, until: ahora + 40 * MIN, reason: 'Se hizo clic en Publicar pero el post no se envió' },
  });
  ok('con corte activo frena', !corte.ok && corte.codigo === 'breaker');
  ok('el motivo dice cuántos fallos seguidos', /3 fallos seguidos/.test(corte.motivo), corte.motivo);
  ok('el motivo dice cuándo reintentar', /reintenta en 40 min/.test(corte.motivo), corte.motivo);

  ok('pasada la hora del corte, deja salir',
    evaluarLimites({ cfg: CFG, nowMs: ahora + 61 * MIN, lastAttemptMs: null, intentosHora: 0,
      breaker: { failures: 0, fallos: 3, until: ahora + 60 * MIN, reason: 'x' } }).ok);

  // Un breaker en el pasado (o con `until` en 0) no puede frenar nunca: es el
  // estado por defecto de quien nunca tuvo un fallo.
  ok('breaker vacío no frena',
    evaluarLimites({ cfg: CFG, nowMs: ahora, breaker: { failures: 0, until: 0, reason: '' } }).ok);
}

// ── 2. cuántos destinos por tick ─────────────────────────────────────────────
console.log('\n2. cuántos destinos saca un tick');
{
  ok('un tick decisión OK saca 1', cuantosPorTick({ decision: { ok: true } }) === 1);
  ok('un tick frenado saca 0', cuantosPorTick({ decision: { ok: false } }) === 0);
  ok('sin decisión no saca nada', cuantosPorTick({}) === 0);
}

// ── 3. la clave de duplicado ─────────────────────────────────────────────────
console.log('\n3. claveDuplicado: cuándo dos textos son el mismo');
{
  const a = claveDuplicado('Revolico Cienfuegos', '  SE  VENDE   producto  ');
  const b = claveDuplicado('revolico cienfuegos', 'se vende producto');
  ok('espacios, mayúsculas y acentos no cuentan', a === b);
  ok('el grupo distinto NO es duplicado', claveDuplicado('Grupo A', 'x') !== claveDuplicado('Grupo B', 'x'));
  ok('el texto distinto NO es duplicado', claveDuplicado('Grupo A', 'x') !== claveDuplicado('Grupo A', 'y'));
  ok('texto vacío no revienta', typeof claveDuplicado('Grupo A', null) === 'string');
}

// ── 4. la guardia de duplicados contra la base ──────────────────────────────
console.log('\n4. marcarDuplicadosEn: aparta lo repetido y deja lo demás');
{
  const ESQUEMA = `
    CREATE TABLE publications (
      id TEXT PRIMARY KEY, publish_text TEXT DEFAULT '', images TEXT DEFAULT '[]'
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
  const { db } = await abrirMemoria(ESQUEMA);
  const ahora = Date.UTC(2026, 9, 3, 15, 0, 0);
  const iso = (ms) => new Date(ms).toISOString();

  db.prepare("INSERT INTO publications (id, publish_text) VALUES ('p1', 'SE VENDE CASA')").run();
  db.prepare("INSERT INTO publications (id, publish_text) VALUES ('p2', 'SE VENDE AUTO')").run();

  // Ya publicado hace 1 h en dos grupos distintos.
  db.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, published_at)
              VALUES ('viejo1', 'p1', 'Grupo A', 'published', ?)`).run(iso(ahora - 1 * 3600000));
  db.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, published_at)
              VALUES ('viejo2', 'p1', 'Grupo B', 'published', ?)`).run(iso(ahora - 1 * 3600000));
  // Publicado hace 20 h: fuera de la ventana de 6 h.
  db.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, published_at)
              VALUES ('reciente', 'p1', 'Grupo C', 'published', ?)`).run(iso(ahora - 20 * 3600000));

  const candidatos = [
    { id: 'dup1', group_name: 'Grupo A', variant_text: 'se vende   CASA' },  // repetido hace 1 h
    { id: 'dup2', group_name: 'Grupo B', variant_text: 'SE VENDE CASA' },     // repetido, otro grupo
    { id: 'ok1', group_name: 'Grupo C', variant_text: 'SE VENDE CASA' },      // hace 20 h: ya no cuenta
    { id: 'ok2', group_name: 'Grupo D', variant_text: 'SE VENDE CASA' },      // nunca se mandó
    { id: 'ok3', group_name: 'Grupo A', variant_text: 'SE VENDE AUTO' },      // otro texto, mismo grupo
  ];
  for (const c of candidatos) {
    db.prepare(`INSERT INTO publication_queue (id, group_name, variant_text, status)
                VALUES (?, ?, ?, 'pending')`).run(c.id, c.group_name, c.variant_text);
  }

  const r = marcarDuplicadosEn(db, candidatos, CFG, ahora);
  ok('aparta los 2 repetidos', r.omitidos === 2 && eq(r.ids.sort(), ['dup1', 'dup2']), JSON.stringify(r));
  const estado = (id) => db.prepare('SELECT status FROM publication_queue WHERE id = ?').get(id)?.status;
  ok('el repetido queda cancelado', estado('dup1') === 'cancelled');
  ok('el de hace 20 h sigue pendiente', estado('ok1') === 'pending');
  ok('el grupo nuevo sigue pendiente', estado('ok2') === 'pending');
  ok('otro texto en el mismo grupo no se toca', estado('ok3') === 'pending');

  const nota = db.prepare('SELECT notes FROM publication_queue WHERE id = ?').get('dup1').notes;
  ok('la nota explica el motivo', /omitido por duplicado/.test(nota), nota);
  ok('la nota dice hace cuánto se publicó', /hace 60 min/.test(nota), nota);

  // El descarte no puede ser silencioso: si el destino desapareciera de la cola
  // sin explicación, el usuario vería la agenda más corta y no sabría por qué.
  ok('no borra la fila, solo le cambia el estado',
    !!db.prepare('SELECT id FROM publication_queue WHERE id = ?').get('dup1'));

  // Con la guardia apagada no se aparta nada.
  const antes = candidatos.map(c => estado(c.id)).join(',');
  marcarDuplicadosEn(db, candidatos, { ...CFG, dedupe_hours: 0 }, ahora);
  ok('con dedupe_hours 0 no aparta nada', candidatos.map(c => estado(c.id)).join(',') === antes);

  // Un destino que ya no está en 'pending' no se toca (no se pisa una decisión).
  db.prepare("UPDATE publication_queue SET status = 'error' WHERE id = 'dup2'").run();
  const r2 = marcarDuplicadosEn(db, [{ id: 'dup2', group_name: 'Grupo B', variant_text: 'SE VENDE CASA' }], CFG, ahora);
  ok('un destino ya resuelto no se pisa', r2.omitidos === 0
    && db.prepare('SELECT status FROM publication_queue WHERE id = ?').get('dup2').status === 'error');
}

// ── 5. el diagnóstico del clic ───────────────────────────────────────────────
console.log('\n5. parsePosterDiag: la evidencia que antes se tiraba');
{
  ok('stderr vacío no inventa nada', eq(parsePosterDiag(''), {}));
  ok('stderr sin [SUBMIT] no inventa nada', eq(parsePosterDiag('cualquier cosa'), {}));

  const stderr = '[FRESH] {"found":true}\n[SUBMIT] {"label":"publicar","aria":"Publicar","dis":"true","scoped":true,"w":74,"h":34}';
  const d = parsePosterDiag(stderr);
  ok('lee que el botón estaba deshabilitado', d.submit?.aria_disabled === 'true');
  ok('dice de dónde salió el botón', d.submit?.del_panel === true);
  ok('guarda el tamaño', d.submit?.tam === '74x34');
  ok('lee el chequeo de artículo nuevo', d.fresh?.encontrados === true);

  const off = parsePosterDiag('[SUBMIT] {"label":"publicar","dis":"null","scoped":false,"w":30,"h":30}');
  ok('un botón habilitado se distingue de uno deshabilitado', off.submit?.aria_disabled === 'null');
  ok('el fallback global se distingue del panel', off.submit?.del_panel === false);

  ok('una línea corrupta no rompe el resultado', eq(parsePosterDiag('[SUBMIT] {no json'), {}));
  ok('varias líneas: toma la primera', parsePosterDiag('[SUBMIT] {"w":1,"h":1}\n[SUBMIT] {"w":2,"h":2}').submit.tam === '1x1');
}

// ── 6. la causa del fallo del 2026-10-03 ─────────────────────────────────────
console.log('\n6. classifyFailure: "el clic no surtió efecto" es su propia causa');
{
  const real = 'Se hizo clic en Publicar pero el post no se envió (1 editor(es) con texto, el mayor de 286362px²). El texto sigue en el compositor: el post probablemente NO se envió.';
  ok('el fallo del 3-oct es compositor_texto', classifyFailure(real) === 'compositor_texto', classifyFailure(real));
  ok('no cae en el cajón genérico del compositor', classifyFailure(real) !== 'compositor');
  ok('"no se encontró el compositor" sigue siendo compositor',
    classifyFailure('No se encontró el compositor.') === 'compositor');
  ok('"no se encontró el botón" sigue siendo compositor',
    classifyFailure('No se encontró el botón Publicar.') === 'compositor');
  ok('Chrome caído sigue siendo noBrowser',
    classifyFailure('No se pudo conectar a Chrome en el puerto 9222') === 'noBrowser');
  ok('muro de login sigue siendo sesion',
    classifyFailure('Sesión de Facebook requerida') === 'sesion');
  ok('un texto desconocido no inventa causa', classifyFailure('algo raro') === null);
  ok('la causa nueva tiene su pista accionable',
    typeof CAUSAS.compositor_texto === 'string' && /ritmo|rechaz/i.test(CAUSAS.compositor_texto));
}

// ── 7. los valores por defecto ───────────────────────────────────────────────
console.log('\n7. los límites por defecto son los acordados');
{
  ok('separación de 15 min', DEFAULT_AGENDA.min_gap_min === 15, String(DEFAULT_AGENDA.min_gap_min));
  ok('tope de 4 por hora', DEFAULT_AGENDA.max_per_hour === 4, String(DEFAULT_AGENDA.max_per_hour));
  ok('duplicados barredos a las 6 h', DEFAULT_AGENDA.dedupe_hours === 6, String(DEFAULT_AGENDA.dedupe_hours));
  ok('corte a los 3 fallos', DEFAULT_AGENDA.breaker_failures === 3, String(DEFAULT_AGENDA.breaker_failures));
  ok('pausa de 60 min', DEFAULT_AGENDA.breaker_cooldown_min === 60, String(DEFAULT_AGENDA.breaker_cooldown_min));
}

// ── 8. el deshacer parcial ───────────────────────────────────────────────────
console.log('\n8. deshacerDuplicacion: borra lo que no salió, conserva lo que sí');
{
  const ESQUEMA = `
    CREATE TABLE publications (id TEXT PRIMARY KEY, publish_text TEXT DEFAULT '');
    CREATE TABLE publication_plans (publication_id TEXT, contenido TEXT);
    CREATE TABLE publication_queue (
      id TEXT PRIMARY KEY, publication_id TEXT, group_name TEXT, status TEXT DEFAULT 'pending',
      published_at TEXT, notes TEXT DEFAULT ''
    );
    CREATE TABLE publication_clones (
      id TEXT PRIMARY KEY, origen_id TEXT, clon_id TEXT, desde TEXT, hasta TEXT
    );
  `;
  const { db } = await abrirMemoria(ESQUEMA);

  const vistos = new Set();
  const poner = (pub, grupo, estado, published = null) => {
    if (!vistos.has(pub)) {
      vistos.add(pub);
      db.prepare("INSERT INTO publications (id, publish_text) VALUES (?, 'T')").run(pub);
      db.prepare(`INSERT INTO publication_clones (id, origen_id, clon_id, desde, hasta)
                  VALUES (?, 'origen', ?, '2026-10-02', '2026-10-03')`).run('v' + pub, pub);
    }
    db.prepare(`INSERT INTO publication_queue (id, publication_id, group_name, status, published_at)
                VALUES (?, ?, ?, ?, ?)`).run(`${pub}-${grupo}`, pub, grupo, estado, published);
  };
  // Una copia con un publicado y tres que nunca salieron: el caso que antes no
  // borraba nada.
  poner('c1', 'A', 'published', '2026-10-03T11:16:14.000Z');
  poner('c1', 'B', 'pending');
  poner('c1', 'C', 'error');
  poner('c1', 'D', 'cancelled');
  // Una copia que nunca publicó nada.
  poner('c2', 'A', 'pending');
  poner('c2', 'B', 'pending');
  // Una copia sin destinos (de las 104 del doble clic).
  db.prepare("INSERT INTO publications (id, publish_text) VALUES ('c3', 'T')").run();
  db.prepare(`INSERT INTO publication_clones (id, origen_id, clon_id, desde, hasta)
              VALUES ('vc3', 'origen', 'c3', '2026-10-02', '2026-10-03')`).run();

  const r = deshacerDuplicacion(db, ['c1', 'c2', 'c3', 'no-existe']);

  ok('borra los 5 destinos que nunca salieron', r.resumen.destinos_borrados === 5, JSON.stringify(r.resumen));
  ok('conserva el publicado como historial', r.resumen.publicados_conservados === 1);
  // c1 NO se borra: tiene un publicado, así que sobrevive con su historial. Las
  // que se van enteras son las dos sin nada publicado.
  ok('las 2 copias sin historial se borran enteras', r.resumen.copias_completas === 2, JSON.stringify(r.resumen));
  ok('la copia con historial no se cuenta como borrada',
    !r.borradas.some(b => b.id === 'c1') && r.omitidas.some(o => o.id === 'c1'));

  const existe = (t, id) => !!db.prepare(`SELECT 1 AS x FROM ${t} WHERE ${t === 'publication_clones' ? 'clon_id' : 'id'} = ?`).get(id);
  ok('el publicado sigue en la cola', existe('publication_queue', 'c1-A'));
  ok('los pendientes de esa copia ya no están', !existe('publication_queue', 'c1-B'));
  ok('el error de esa copia ya no está', !existe('publication_queue', 'c1-C'));
  ok('el cancelado de esa copia ya no está', !existe('publication_queue', 'c1-D'));
  ok('la publicación con historial se conserva', existe('publications', 'c1'));
  ok('su vínculo con el día de origen se conserva', existe('publication_clones', 'c1'));
  ok('la copia sin nada publicado se borra', !existe('publications', 'c2'));
  ok('su vínculo también', !existe('publication_clones', 'c2'));
  ok('la copia sin destinos también', !existe('publications', 'c3'));

  ok('un clon inexistente se reporta, no revienta',
    r.omitidas.some(o => o.id === 'no-existe' && /no es una copia/.test(o.motivo)));
  ok('el motivo del omitido dice que hay historial',
    r.omitidas.some(o => o.id === 'c1' && /conservan como historial/.test(o.motivo)));

  // Idempotente: repetir el deshacer no puede borrar el historial que se conserva.
  // La segunda pasada ya no tiene destinos sin publicar, así que no toca nada y
  // el publicado se sigue contando como historial.
  const r2 = deshacerDuplicacion(db, ['c1']);
  ok('repetir el deshacer conserva el publicado', existe('publication_queue', 'c1-A'));
  ok('repetir el deshacer no borra nada más', r2.resumen.destinos_borrados === 0);
  ok('repetir el deshacer no tira la publicación', existe('publications', 'c1'));
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
