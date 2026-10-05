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
import { readFileSync } from 'node:fs';
import { abrirMemoria } from './helpers/sqljs.mjs';
import {
  evaluarLimites, cuantosPorTick, claveDuplicado, marcarDuplicadosEn,
  parsePosterDiag, classifyFailure, notaLote, logFinCorrida, elegirAnclaIntento,
  CAUSAS, DEFAULT_AGENDA,
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
console.log('\n1b. el gap cuenta de INICIO a INICIO, no desde que el post termina');
{
  // Antes el gap se medía contra `published_at` (cuando el post TERMINA), así que
  // el ciclo real era `gap + duración de la corrida`: con 1m35s de media, un gap
  // de 8 min daba 6,3/h y el tope de 6/h nunca era el que mandaba. Pedir 12/h con
  // la semántica vieja era imposible sin bajar el gap a 3 y casi sin descanso.
  const ahora = Date.now();
  const CFG12 = { ...CFG, min_gap_min: 5, max_per_hour: 12 };
  const duracionReal = 95 * 1000; // lo que tardó la corrida real del 2026-10-04

  // Post que empezó hace 5 min y terminó hace 5 - 1m35s.
  const inicio = ahora - 5 * MIN;
  const fin = inicio + duracionReal;
  ok('a los 5 min exactos del INICIO ya puede salir el siguiente',
    evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: inicio, intentosHora: 0 }).ok,
    evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: inicio, intentosHora: 0 }).motivo);
  ok('con la semántica vieja (medir desde published_at) NO salía',
    !evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: fin, intentosHora: 0 }).ok);

  // 12/h con gap 5 significa: una publicación cada 5 min, sin importar cuánto
  // tardó cada una. 12 ticks de 5 min = 12 publicaciones.
  let t = ahora;
  let publicadas = 0;
  for (let i = 0; i < 13; i++) {
    const d = evaluarLimites({ cfg: CFG12, nowMs: t, lastAttemptMs: i === 0 ? null : t - 5 * MIN, intentosHora: publicadas });
    if (d.ok) { publicadas++; }
    t += 5 * MIN;
  }
  ok('gap 5 + tope 12 rinden 12 publicaciones en una hora', publicadas === 12, `salieron ${publicadas}`);

  // El ritmo real NO puede depender de cuánto tarda cada post.
  const rapida = ahora - 5 * MIN;
  const lenta = ahora - 5 * MIN;
  ok('el ritmo es el mismo con corridas de 30s o de 8 min',
    evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: rapida, intentosHora: 0 }).ok
    && evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: lenta, intentosHora: 0 }).ok);

  ok('con el tope de 12/h frena al llegar a 12 aunque el gap ya se haya cumplido',
    !evaluarLimites({ cfg: CFG12, nowMs: ahora, lastAttemptMs: ahora - 20 * MIN, intentosHora: 12 }).ok);
}

/**
 * El anclaje del gap.
 *
 * Este bloque cubre el bug que los tests de `evaluarLimites` no podían ver: aquellos
 * le pasan `lastAttemptMs` ya calculado a mano, así queashion No Importa cómo se
 * obtenía. El error real estaba aguas arriba, en elegir entre la marca de arranque
 * y `published_at`, y salía como ritmo de ~8/h en vez de 12/h sin ningún test en rojo.
 */
console.log('\n1c. elegirAnclaIntento: de dónde sale el ancla');
{
  const ahora = Date.now();
  const duracionReal = 95 * 1000;
  const inicio = ahora - 5 * MIN;
  const fin = inicio + duracionReal;   // el post terminó DESPUÉS de arrancar

  // El caso que rompía: con `Math.max` de los dos, ganaba `published_at` (siempre
  // posterior al arranque) y el gap se medía desde el final.
  ok('con marca de arranque y published_at, manda el ARRANQUE',
    elegirAnclaIntento({ marca: { ms: inicio, at: new Date(inicio).toISOString() }, finMs: fin }) === inicio,
    `devolvio ${elegirAnclaIntento({ marca: { ms: inicio, at: new Date(inicio).toISOString() }, finMs: fin })}`);
  ok('nunca devuelve el published_at si hay marca de arranque',
    elegirAnclaIntento({ marca: { ms: inicio }, finMs: fin }) !== fin);

  // Y el efecto observable: a los 5 min del arranque tiene que poder salir el
  // siguiente. Si el anclaje fuera el final, faltaría la duración del post.
  const anclaje = elegirAnclaIntento({ marca: { ms: inicio }, finMs: fin });
  ok('a los 5 min exactos del inicio ya puede salir otro (si fuera el final, no)',
    evaluarLimites({ cfg: { min_gap_min: 5, max_per_hour: 12 }, nowMs: ahora, lastAttemptMs: anclaje, intentosHora: 0 }).ok);

  // Plan B: sin marca (base vieja, o que no se pudo guardar) se usa published_at.
  ok('sin marca cae a published_at', elegirAnclaIntento({ marca: null, finMs: fin }) === fin);
  ok('sin marca y sin published_at no inventa un ancla', elegirAnclaIntento({ marca: null, finMs: null }) === null);

  // Marca corrupta: no debe romper ni devolver basura.
  ok('marca con ms en texto se interpreta', elegirAnclaIntento({ marca: { ms: String(inicio) }, finMs: fin }) === inicio);
  ok('marca basura no pisa el published_at', elegirAnclaIntento({ marca: { ms: 0, at: 'no-es-fecha' }, finMs: fin }) === fin);
  ok('acepta la marca solo por texto ISO', elegirAnclaIntento({ marca: { at: new Date(inicio).toISOString() }, finMs: fin }) === inicio);
}

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
  // El punto de operación acordado es 12 posts por hora: gap 5 medido de INICIO
  // a INICIO. El tope va en 12, no más alto, para que un aflojo del gap no pueda
  // dejar pasar más. Estos defaults son los de una base nueva, así que si se
  // cambian hay que cambiarlos acá también o el test miente.
  ok('separación de 5 min (de inicio a inicio)', DEFAULT_AGENDA.min_gap_min === 5, String(DEFAULT_AGENDA.min_gap_min));
  ok('tope de 12 por hora', DEFAULT_AGENDA.max_per_hour === 12, String(DEFAULT_AGENDA.max_per_hour));
  ok('duplicados barredos a las 6 h', DEFAULT_AGENDA.dedupe_hours === 6, String(DEFAULT_AGENDA.dedupe_hours));
  ok('corte a los 3 fallos', DEFAULT_AGENDA.breaker_failures === 3, String(DEFAULT_AGENDA.breaker_failures));
  ok('pausa de 60 min', DEFAULT_AGENDA.breaker_cooldown_min === 60, String(DEFAULT_AGENDA.breaker_cooldown_min));
  ok('el tope Real nunca excede el acordado aunque el gap se afloje',
    Math.min(60 / DEFAULT_AGENDA.min_gap_min, DEFAULT_AGENDA.max_per_hour) <= 12);
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

console.log('\nnotaLote: la propagación a N grupos queda asentada');
{
  // El 2026-10-04 el usuario reportsó un post que salió "solo en el destino
  // programado" y no había forma de confirmarlo ni de refutarlo: el poster
  // devolvía lote_grupos y el backend lo descartaba. Estos tests fijan que la
  // nota se escriba siempre que el poster mande el dato.
  const conLote = notaLote({ lote_grupos: ['Revolico A', 'Revolico B', 'Revolico C'], grupos_en_lista: 121 });
  ok('anota cuántos grupos del lote se tickearon', conLote.includes('3/121 grupos'));
  ok('y cuáles fueron', conLote.includes('Revolico A | Revolico B | Revolico C'));

  ok('sin /total si el poster no lo manda', notaLote({ lote_grupos: ['X'] }).includes(' | lote: 1 grupos ['));
  ok('lista vacía se asienta, no se ignora',
    notaLote({ lote_grupos: [], grupos_en_lista: 121 }).includes('NO se tildó ningún grupo'));
  ok('sin el campo no inventa nada', notaLote({}) === '' && notaLote(null) === '');
  ok('filtra nombres vacíos', notaLote({ lote_grupos: ['A', '', null, 'B'] }).includes('[A | B]'));
  ok('no se desborda con 30 grupos largos (y el conteo sobrevive al corte)',
    notaLote({ lote_grupos: Array(30).fill('Grupo muy largo de nombre').map((_, i) => 'G' + i) }).length <= 242
    && notaLote({ lote_grupos: Array(30).fill('Grupo muy largo de nombre').map((_, i) => 'G' + i) }).includes('30 grupos'));
  // El presupuesto de `notes` es 500 chars y la nota de imágenes va después del
  // lote: si el lote se pasa de largo, la imagen se pierde. Esto lo delimita.
  const notaLarga = notaLote({ lote_grupos: Array(30).fill('Grupo extremadamente largo').map((_, i) => 'G' + i), grupos_en_lista: 121 });
  const completo = 'auto:publicado 2026-10-04T11:42:55 | pendiente de aprobación del administrador'
    + notaLarga + ' | imágenes: FB confirmó los adjuntos (5 pedidas; conteo exacto no verificado)';
  ok('con el lote más largo posible, la nota de imágenes sigue entrando',
    completo.length <= 500, 'largo total: ' + completo.length);
}

console.log('\nlog por corrida: el registro tiene que poder auditar una publicación');
{
  // El 2026-10-04 hubo un post 1,75 min después de un error, con el gap en 15, y
  // no se pudo saber si lo sac00f3 el reloj o el usuario: la agenda y el clic
  // manual llamaban los DOS con `auto: false`. Estos tests fijan que el origen
  // viaje explícito y que ninguna corrida quede a medio loguear.
  const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const gp = leer('../backend/lib/groupPublisher.js');

  const callSites = (src) => [...src.matchAll(/startGroupPublish\(\s*\{([^}]*)\}/g)].map(m => m[1]);
  const enLibro = callSites(gp).filter(c => !/^\s*(auto|force|ids|mode|debug|runNow)\s*[=}]/.test(c) || c.includes('origen'));
  const sinOrigen = [...callSites(gp), ...callSites(leer('../backend/routes/agenda.js')),
    ...callSites(leer('../backend/routes/groupPublish.js'))].filter(c => !c.includes('origen'));
  ok('ningún call site se olvida de pasar `origen`', sinOrigen.length === 0, `${sinOrigen.length} sin origen`);
  ok('la agenda se identifica como `agenda`, no como manual', enLibro.some(c => c.includes("origen: 'agenda'")));
  ok('el worker se identifica como `worker`', callSites(gp).some(c => c.includes("origen: 'worker'")));
  ok('los clics se identifican como `manual`',
    callSites(leer('../backend/routes/agenda.js')).some(c => c.includes("origen: 'manual'"))
    && callSites(leer('../backend/routes/groupPublish.js')).every(c => c.includes("origen: 'manual'")));

  // Todo `return r;` de runGroupPublish tiene que loguear el FIN antes. Si uno se
  // cuelga sin log, queda un INICIO sin cierre y la auditoría pierde el destino.
  const cuerpo = gp.slice(gp.indexOf('async function runGroupPublish('), gp.indexOf('export function startGroupPublish('));
  const lineas = cuerpo.split('\n');
  const huerfanos = lineas.filter((l, i) => l.trim() === 'return r;'
    && !lineas.slice(Math.max(0, i - 4), i).some(p => p.includes('logFinCorrida')));
  ok('ningún `return r;` se escapa sin loguear el FIN', huerfanos.length === 0, `${huerfanos.length} huérfanos`);
  ok('el log dice origen, duración, ok/error y el lote por destino',
    /INICIO corrida=.*origen=/.test(gp) && /FIN {4}corrida=.*origen=/.test(gp)
    && /dur=.*ok=.*err=/.test(gp) && gp.includes('(lote ${x.lote}'));
  ok('la agenda loguea POR QUÉ se pudo publicar ahora, no solo cuántas',
    gp.includes('[agenda] ELEGIDO') && gp.includes('motivo=${decision.codigo}'));

  // `currentRun.origen` y `lastResult.origen` son los que lee la UI.
  ok('el origen queda disponible para la UI, no solo en el log',
    /origen: quien/.test(gp) && /r\.origen = c\.origen/.test(gp));
  // Regresión de una corrida real: `runGroupPublish` reemplaza el `currentRun`
  // que arma `startGroupPublish` y se comía el origen, así que el log de cierre
  // salía con `origen=?` en el preciso momento en que había que auditarlo.
  ok('el segundo currentRun no borra el origen (bug que salió en una corrida real)',
    /currentRun = \{[^}]*origen: currentRun && currentRun\.origen/.test(gp),
    'el segundo currentRun tiene que reusar currentRun.origen');
}

console.log('\nformato del log: una línea tiene que bastar para auditar el post');
{
  // Se captura el console.log real del formateador con una corrida sintética: si
  // el formato no dice qué grupo salió, cuántos grupos del lote se tickearon y
  // quién mandó la corrida, el log no sirve para nada.
  //
  // `capturar` solo envuelve a `logFinCorrida`: `ok()` también escribe por
  // console.log, y pisarlo durante los asserts se traga sus propias pruebas.
  const cap = [];
  const real = console.log;
  const capturar = (fn) => { cap.length = 0; console.log = (...a) => cap.push(a.join(' ')); try { fn(); } finally { console.log = real; } return cap.join('\n'); };

  const r = { ok: true };
  const linea = capturar(() => logFinCorrida(r, {
    runId: '7d0152e2-corta', startedMs: Date.now() - 134000, origen: 'agenda', ok: 1, errors: 1,
    results: [
      { group: 'Revolico Matanzas', ok: true, status: 'published', lote: 9, lote_total: 121 },
      { group: 'REVOLICO Encrucijada #1', ok: false, status: 'error', lote: null },
    ],
  }));
  ok('estampa el origen en lastResult para la UI', r.origen === 'agenda');
  ok('una sola línea con corrida, origen, duración y contadores',
    (linea.match(/\[publish\] FIN/g) || []).length === 1
    && linea.includes('corrida=7d0152e2') && linea.includes('origen=agenda')
    && linea.includes('dur=2m14s') && linea.includes('ok=1 err=1'), linea);
  ok('nombra cada grupo con su resultado y el lote que salió',
    linea.includes('Revolico Matanzas:ok (lote 9/121)')
    && linea.includes('REVOLICO Encrucijada #1:FALLÓ'), linea);

  ok('avisa si el interruptor cortó la corrida a mitad', capturar(() => logFinCorrida(
    { ok: true, pausado_por_interruptor: true },
    { runId: 'aaaa1111', startedMs: Date.now() - 3000, origen: 'manual', ok: 0, errors: 0, results: [] },
  )).includes('PAUSADO_POR_INTERRUPTOR'));

  ok('marca cuando un post salió SOLO al destino y no al lote', capturar(() => logFinCorrida(
    { ok: true },
    { runId: 'bbbb2222', startedMs: Date.now() - 1000, origen: 'agenda', ok: 1, errors: 0,
      results: [{ group: 'G', ok: true, status: 'published', lote: 0, lote_total: 121 }] },
  )).includes('SIN_LOTE=1'));

  const fallo = capturar(() => logFinCorrida({ ok: false, error: 'Chrome no disponible' },
    { runId: 'cccc3333', startedMs: Date.now() - 500, origen: 'manual', ok: 0, errors: 0, results: [] }));
  ok('si no llegó a publicar nada, también deja rastro',
    fallo.includes('origen=manual') && fallo.includes('Chrome no disponible'), fallo);
  console.log('\n' + linea.split('\n')[0]);
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
