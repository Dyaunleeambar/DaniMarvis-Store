// Duplicar un día entero del calendario.
//
// "Pasar todo lo programado del martes al jueves" son decenas de publicaciones
// a la vez, y eso NO es un bucle de POST /:id/planificar desde el front: si la
// quinta falla, el usuario no sabe qué se copió. Va una operación de servidor,
// en transacción, que devuelve el detalle de lo que hizo para que la vista
// pueda ofrecer deshacer.
//
// Y no mueve: DUPLICA. El día de origen no se toca —ni su fecha, ni sus
// destinos, ni su historial—, porque una publicación sólo puede estar en un
// punto del calendario a la vez. Mover el día se comía el historial del día
// anterior: lo publicado pasaba a 'archived' (que la vista del día esconde) y en
// su lugar aparecían destinos pendientes nuevos. Con la copia, el origen sigue
// intacto y el destino arranca de cero.
//
// El plan se calcula con UNA función y se usa en los dos endpoints (la vista
// previa y la aplicación), así es imposible que lo que se muestra antes de
// confirmar difiera de lo que pasa después.
//
// Va en lib/ y no en la ruta porque necesita `db` como parámetro: así el test
// puede correrla contra una base en memoria sin tocar la del servidor.
import { createRequire } from 'module';
import { v4 as uuid } from 'uuid';
import { aggregateEstado } from './agendaEstado.js';

// La normalización de nombres de grupo vive en el compositor (es la que hace
// que el cursor encuentre el grupo aunque cambie de emoji o acento). Se importa
// el archivo tal cual en vez de reimplementarla acá: si el compositor y la
// agenda no normalizan igual, los conflictos se calculan sobre otra cosa.
const require_ = createRequire(import.meta.url);
const { normGrupo } = require_('../../utilidades/fb-ranking/lote_grupos.js');

// ── Aleatoriedad determinista ───────────────────────────────────────────────
//
// El plan se calcula DOS veces: una para la vista previa del modal (GET) y otra
// para aplicar (POST). Si "reordenar" usara Math.random, lo que el usuario ve en
// el modal no sería lo que se aplica. Por eso todo se deriva de una semilla fija
// a partir de origen→destino: el mismo par de días da siempre el mismo resultado,
// así la previa y el apply coinciden y repetir la operación es reproducible.

function semillaDe(desde, hasta) {
  let h = 2166136261;
  for (const c of `${desde}->${hasta}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinista (mulberry32) sembrado con el par origen→destino. */
function rngDe(desde, hasta) {
  let a = semillaDe(desde, hasta);
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Permutación de posiciones para reordenar los horarios.
 *
 * Fisher–Yates sembrado, y si sale la identidad se intercambian las dos primeras
 * para garantizar que el orden SIEMPRE cambie cuando hay más de una publicación.
 * Una permutación es una biyección: es exactamente el mismo conjunto de franjas,
 * repartido entre las publicaciones en otro orden, sin crear ni perder horas.
 */
function permutacionReordenar(n, rng) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  if (n > 1 && idx.every((v, i) => v === i)) {
    [idx[0], idx[1]] = [idx[1], idx[0]];
  }
  return idx;
}

/** Desplazamiento en el catálogo, en [1, N-1]. 0 = no se puede rotar. */
export function offsetRotacion(desde, hasta, n) {
  if (!n || n <= 1) return 0;
  return 1 + (semillaDe(desde, hasta) % (n - 1));
}

/**
 * Contexto de rotación de destinos: el catálogo, el índice por nombre normalizado
 * y el desplazamiento. Devuelve null si no hay a dónde rotar (0 o 1 grupos).
 *
 * Se centraliza acá para que la vista previa y el apply usen exactamente el mismo
 * catálogo y el mismo offset; si cada uno lo calculara por su lado, lo que se
 * muestra y lo que se aplica podrían diferir.
 */
export function contextoRotacion(db, desde, hasta) {
  const catalogo = db.prepare('SELECT name, url FROM facebook_groups ORDER BY sort_order, name').all();
  const offset = offsetRotacion(desde, hasta, catalogo.length);
  if (!offset) return null;
  const indice = new Map(catalogo.map((g, i) => [normGrupo(g.name), i]));
  return { catalogo, indice, offset };
}

/**
 * Grupo al que va un destino tras correr `offset` posiciones en el catálogo.
 *
 * Sumar una constante módulo N es inyectivo: dos grupos distintos de una misma
 * publicación siguen siendo distintos después de correr, así que no se crean
 * choques nuevos. Si el grupo del origen no está en el catálogo (lo borraron), se
 * deja tal cual: no hay a dónde correrlo.
 */
export function grupoRotado(nombre, url, catalogo, indice, offset) {
  if (!offset || !catalogo.length) return { group_name: nombre, group_url: url || '' };
  const pos = indice.get(normGrupo(nombre));
  if (pos == null) return { group_name: nombre, group_url: url || '' };
  const g = catalogo[(pos + offset) % catalogo.length];
  return { group_name: g.name, group_url: g.url || '' };
}

/** "HH:MM" en hora local del servidor, igual que el `hora_local` del GET /. */
function horaLocalDe(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" del día local de un ISO, para detectar lo que se cae de fecha. */
function fechaLocalDe(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "HH:MM" → { h, m }, o null si no viene o no es una hora válida.
 *
 * Un valor inválido no es un error: es lo mismo que no haber elegido hora, y el
 * plan cae en el comportamiento de siempre. El input del front es type="time", así
 * que el caso raro es una llamada a mano.
 */
function parseHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Nombre de una publicación para los textos del plan. */
function nombreDe(p) {
  return p.product_name || (p.publish_text ? p.publish_text.slice(0, 38) : 'Publicación');
}

/**
 * Un día local (YYYY-MM-DD) acotado a UTC ISO, con el final EXCLUSIVO.
 *
 * Mismo criterio que el rango de /uso-dia y el de la agenda: scheduled_at y
 * publication_date viven en UTC, pero el calendario agrupa por día local, así
 * que el corte va en la medianoche local del servidor.
 */
function limitesDiaLocal(fecha) {
  const desdeIso = new Date(`${fecha}T00:00:00`).toISOString();
  const hastaIso = new Date(new Date(`${fecha}T00:00:00`).getTime() + 86400000).toISOString();
  return { desdeIso, hastaIso };
}

/** Columnas reales de una tabla, menos las que no se copian. */
function columnasParaCopiar(db, tabla, excluir) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all()
    .map(c => c.name)
    .filter(n => !excluir.includes(n));
}

/**
 * Primera imagen de una publicación, para la miniatura de la vista previa.
 *
 * Va tolerante a propósito: `images` es un JSON en texto que se puede haber
 * escrito a mano, y un modal que se rompe porque una publicación tiene "{}" es
 * peor que uno con la miniatura vacía.
 */
function primeraImagen(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    const u = Array.isArray(v) ? v.find(x => typeof x === 'string' && x.trim()) : '';
    return typeof u === 'string' ? u : '';
  } catch { return ''; }
}

/**
 * Copia una publicación y TODOS sus destinos al `iso` indicado, y deja el
 * vínculo origen → copia en `publication_clones`.
 *
 * Las columnas se leen del esquema real (PRAGMA table_info) en vez de listar
 * campos a mano: si `publications` o `publication_queue` ganan una columna, la
 * copia la arrastra sin que haya que tocar este código.
 *
 * De la publicación quedan fuera id y los sellos de tiempo. De los destinos,
 * además: TODOS nacen 'pending' con published_at en NULL, que es lo que hace que
 * el día destino se vuelva a publicar. Da igual lo que tuvieran en el origen
 * (published, error, cancelled, archived): ese estado no se pierde, sigue
 * intacto en el día de origen, que es justo lo que la copia promete no tocar.
 */
export function duplicarPublicacion(db, pubId, iso, desde, hasta, rotacion = null) {
  const orig = db.prepare('SELECT * FROM publications WHERE id = ?').get(pubId);
  if (!orig) throw new Error(`la publicación ${pubId} ya no existe`);
  const destinos = db.prepare('SELECT * FROM publication_queue WHERE publication_id = ?').all(pubId);

  const clonId = uuid();
  const colsPub = columnasParaCopiar(db, 'publications',
    ['id', 'created_at', 'updated_at', 'publication_date']);
  db.prepare(`
    INSERT INTO publications (id, publication_date, ${colsPub.join(', ')})
    VALUES (?, ?, ${colsPub.map(() => '?').join(', ')})
  `).run(clonId, iso, ...colsPub.map(c => orig[c] ?? null));

  const colsDest = columnasParaCopiar(db, 'publication_queue',
    ['id', 'publication_id', 'status', 'published_at', 'scheduled_at', 'created_at', 'updated_at']);
  const iGrupo = colsDest.indexOf('group_name');
  const iUrl = colsDest.indexOf('group_url');
  for (const d of destinos) {
    const valores = colsDest.map(c => d[c] ?? null);
    // Con `rotacion`, cada destino salta a los grupos siguientes del catálogo.
    // Se conserva el resto de la fila (variante, imágenes, pending_approval): sólo
    // cambia a qué grupo apunta.
    if (rotacion) {
      const r = grupoRotado(d.group_name, d.group_url, rotacion.catalogo, rotacion.indice, rotacion.offset);
      if (iGrupo >= 0) valores[iGrupo] = r.group_name;
      if (iUrl >= 0) valores[iUrl] = r.group_url;
    }
    db.prepare(`
      INSERT INTO publication_queue (id, publication_id, status, published_at, scheduled_at, ${colsDest.join(', ')})
      VALUES (?, ?, 'pending', NULL, ?, ${colsDest.map(() => '?').join(', ')})
    `).run(uuid(), clonId, iso, ...valores);
  }

  db.prepare(`
    INSERT INTO publication_clones (id, origen_id, clon_id, desde, hasta)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuid(), pubId, clonId, desde, hasta);

  return clonId;
}

/**
 * Qué se duplicaría al llevar todas las publicaciones de `desde` a `hasta`.
 *
 * Sólo informa: no escribe nada. La usan el GET (vista previa) y el POST.
 *
 * Reglas, en el orden en que se aplican:
 *  - Se copia el día COMPLETO. No hay omitidas: ni lo publicado, ni lo que
 *    falló, ni lo cancelado quedan afuera. Todo lo que el día tenga se vuelve a
 *    agendar en el destino y en la copia nace pendiente.
 *  - Los HORARIOS tienen dos modos, según venga `horaInicio`:
 *      · Sin hora: cada publicación conserva la suya. Es lo menos sorprendente:
 *        el usuario cambia de día, no reprograma. OJO: la fecha se compone con
 *        componentes locales (new Date(y, m, d, hh, mm)) y no sumando días al ISO;
 *        si se sumara sobre el UTC, todo lo agendado a la tarde se correría de día
 *        (el desfase de 4 horas que ya corrigió una vez).
 *      · Con hora: el día entra como bloque. La PRIMERA publicación del día de
 *        origen cae en esa hora y las demás conservan el intervalo que tenían
 *        respecto de ella, así una mañana de 8 a 11 se lleva a la tarde entera
 *        sin deformarse. El ancla es la primera publicación, no las 00:00: si
 *        fuera la medianoche, el bloque empezaría con un hueco invisible.
 *  - Los conflictos se AVISAN, no bloquean: es la misma philosophía que
 *    /conflicts, donde la decisión es del usuario.
 *  - Cada fila trae la miniatura de la primera imagen (`imagen`) y el estado del
 *    origen (`estado`) para que la vista previa sea reconocible de un vistazo: si
 *    el modal dibujara su propio estado con otra cuenta, el usuario no sabría cuál
 *    de los dos miente.
 */
export function planDuplicacionDia(db, desde, hasta, horaInicio, opciones = {}) {
  const origen = limitesDiaLocal(desde);
  const pubs = db.prepare(`
    SELECT id, product_name, publish_text, images, publication_date
    FROM publications
    WHERE publication_date >= ? AND publication_date < ?
    ORDER BY publication_date ASC, sort_order ASC
  `).all(origen.desdeIso, origen.hastaIso);

  // Una sola pasada por los destinos. Se leen TODOS los estados: la copia los
  // lleva igual y los grupos hacen falta para los conflictos. `scheduled_at` se
  // lee sólo para el punto de color de la vista previa (aggregateEstado
  // necesita saber si lo pendiente ya venció).
  const destinosPorPub = new Map(pubs.map(p => [p.id, []]));
  if (pubs.length) {
    const filas = db.prepare(`
      SELECT publication_id, group_name, status, scheduled_at
      FROM publication_queue
      WHERE publication_id IN (${pubs.map(() => '?').join(',')})
    `).all(...pubs.map(p => p.id));
    for (const f of filas) {
      if (!destinosPorPub.has(f.publication_id)) continue;
      const ms = f.scheduled_at ? new Date(String(f.scheduled_at).replace(' ', 'T')).getTime() : null;
      destinosPorPub.get(f.publication_id).push({ ...f, _ms: Number.isNaN(ms) ? null : ms });
    }
  }

  const [ay, am, ad] = hasta.split('-').map(Number);
  const nowMs = Date.now();

  // Ancla del bloque: la primera publicación del día (la consulta viene ordenada).
  // `pubs[0]` y no las 00:00, porque si el ancla fuera la medianoche el bloque
  // arrancaría con un hueco invisible de dos horas.
  const arranque = parseHora(horaInicio);
  const anclaMs = pubs.length ? new Date(pubs[0].publication_date).getTime() : null;

  const duplicadas = [];
  for (const p of pubs) {
    const destinos = destinosPorPub.get(p.id) || [];
    const d = new Date(p.publication_date);
    let aIso;
    if (arranque && anclaMs !== null) {
      // Modo bloque: se compone la hora de arranque con componentes locales y se
      // suman los milisegundos de diferencia. Los intervalos se respetan al
      // milisegundo, que es lo que el usuario quiere al mover la mañana a la tarde.
      const base = new Date(ay, am - 1, ad, arranque.h, arranque.m, 0, 0);
      aIso = new Date(base.getTime() + (d.getTime() - anclaMs)).toISOString();
    } else {
      // Composición por componentes locales: preserva la hora de pared. En el
      // cambio de horario ese reloj puede no existir (2:30 en el salto), y ahí
      // new Date() normaliza a la primera hora válida del día; es un caso
      // marginal y es preferible a una fecha que no existe.
      aIso = new Date(ay, am - 1, ad, d.getHours(), d.getMinutes(), d.getSeconds(), 0).toISOString();
    }
    // El estado va del ORIGEN a propósito: es el que tiene hoy esa publicación en
    // el calendario, el mismo punto de color que se ve en la celda de al lado.
    duplicadas.push({
      id: p.id,
      product_name: p.product_name || '',
      publish_text: p.publish_text || '',
      nombre: nombreDe(p),
      de_iso: p.publication_date,
      de_hora: horaLocalDe(p.publication_date),
      a_iso: aIso,
      a_hora: horaLocalDe(aIso),
      a_fecha: fechaLocalDe(aIso),   // puede no ser `hasta` si el bloque se cae
      imagen: primeraImagen(p.images),
      estado: aggregateEstado(destinos, nowMs).estado,
      destinos: destinos.length,
      publicados: destinos.filter(x => x.status === 'published').length,
      grupos: [...new Set(destinos.map(x => x.group_name).filter(Boolean))],
    });
  }

  // ── Cambiar los horarios de orden (opcional) ──────────────────────────────
  //
  // Se permutan las franjas horarias entre las publicaciones: el mismo conjunto
  // de horas, repartido en otro orden. Si el día destino es fotocopia del origen,
  // esto rompe el patrón sin mover el rango del día (la primera franja sigue
  // siendo la misma). Determinista por origen→destino, así la previa coincide con
  // el apply y repetir da lo mismo.
  if (opciones.reordenar && duplicadas.length > 1) {
    const franjas = duplicadas.map(d => d.a_iso);
    const perm = permutacionReordenar(franjas.length, rngDe(desde, hasta));
    duplicadas.forEach((d, i) => {
      d.a_iso = franjas[perm[i]];
      d.a_hora = horaLocalDe(d.a_iso);
      d.a_fecha = fechaLocalDe(d.a_iso);
    });
  }

  // ── Cambiar los destinos (opcional) ───────────────────────────────────────
  //
  // Cada destino salta a los grupos siguientes del catálogo, conservando cuántos
  // tiene cada publicación. `grupos_nuevos` es lo que muestra el modal y también
  // lo que aplica la copia: un solo contexto de rotación para ambos, para que no
  // pueda diferir lo que se ve de lo que se hace.
  const rotacion = opciones.rotar_destinos ? contextoRotacion(db, desde, hasta) : null;
  if (opciones.rotar_destinos) {
    for (const d of duplicadas) {
      const destinos = destinosPorPub.get(d.id) || [];
      d.grupos_nuevos = rotacion
        ? destinos.map(x => grupoRotado(x.group_name, x.group_url, rotacion.catalogo, rotacion.indice, rotacion.offset).group_name)
        : [];
    }
  }

  // Conflictos contra lo que YA está en el día destino, en los mismos grupos y
  // dentro de la ventana de 2h que ya usa /conflicts. Las copias aún no existen
  // así que no hace falta excluirlas: entre ellas no chocan, se crean juntas.
  const conflictos = [];
  if (duplicadas.length) {
    const destino = limitesDiaLocal(hasta);
    const existentes = db.prepare(`
      SELECT pq.publication_id, pq.group_name, pq.scheduled_at, p.product_name
      FROM publication_queue pq
      LEFT JOIN publications p ON p.id = pq.publication_id
      WHERE pq.publication_id IS NOT NULL
        AND pq.scheduled_at IS NOT NULL
        AND pq.scheduled_at >= ? AND pq.scheduled_at < ?
        AND pq.status IN ('pending','published','error')
    `).all(destino.desdeIso, destino.hastaIso);

    const porGrupo = new Map();
    for (const f of existentes) {
      const clave = normGrupo(f.group_name || '');
      if (!clave) continue;
      if (!porGrupo.has(clave)) porGrupo.set(clave, []);
      porGrupo.get(clave).push(f);
    }

    const VENTANA = 2 * 3600 * 1000;
    for (const d of duplicadas) {
      const tMs = new Date(d.a_iso).getTime();
      const vistos = new Set();
      // Con rotación de destinos, el choque hay que medirlo en los grupos NUEVOS:
      // ahí es donde va a caer la copia. Usar los viejos avisaría de conflictos
      // que no van a existir y ocultaría los que sí.
      const gruposEfectivos = (d.grupos_nuevos && d.grupos_nuevos.length) ? d.grupos_nuevos : d.grupos;
      for (const g of new Set(gruposEfectivos.map(normGrupo))) {
        for (const f of porGrupo.get(g) || []) {
          const dif = Math.abs(new Date(String(f.scheduled_at).replace(' ', 'T')).getTime() - tMs);
          if (dif > VENTANA) continue;
          const clave = `${g}|${f.publication_id}`;
          if (vistos.has(clave)) continue;   // un grupo puede estar en varios destinos
          vistos.add(clave);
          conflictos.push({
            de_id: d.id,                       // de qué publicación viene: la vista
            de_nombre: d.nombre,               // previa lo usa para esconder el
            group_name: f.group_name,          // aviso si el usuario la desmarca
            hora: d.a_hora,
            con_id: f.publication_id,
            con: f.product_name || 'Sin producto',
            minutos: Math.round(dif / 60000),
          });
        }
      }
    }
  }

  const avisos = [];
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  if (hasta < hoyStr) {
    avisos.push('El día destino ya pasó: lo que quede pendiente no lo va a disparar el calendario por fecha.');
  }
  const sinDestinos = duplicadas.filter(d => d.destinos === 0).length;
  if (sinDestinos) {
    avisos.push(`${sinDestinos} publicación(es) no tienen ningún destino: la copia queda sin agendar.`);
  }
  if (opciones.rotar_destinos && !rotacion) {
    avisos.push('No hay grupos suficientes en el catálogo para rotar: los destinos quedarían iguales.');
  }
  // El bloque puede no entrar en el día: si la hora de arranque es tarde y el día
  // spanned varias horas, las últimas se caen al día siguiente (o al anterior, si
  // se eligió antes que la primera). Sin este aviso el usuario cree que duplicó
  // un día y en realidad sembró parte en el vecino.
  const fueraDeDia = duplicadas.filter(d => d.a_fecha !== hasta);
  if (fueraDeDia.length) {
    const fechas = [...new Set(fueraDeDia.map(d => d.a_fecha))].sort();
    avisos.push(
      `Con esa hora de arranque, ${fueraDeDia.length} publicación(es) caen fuera del ${hasta}: ` +
      `${fechas.map(f => `el ${f}`).join(' y ')}. Bajá la hora de arranque para que el día entre entero.`
    );
  }

  // Si este día ya se duplicó a esta fecha, decirlo ANTES de que el usuario
  // presione. Sin esto, apretar dos veces —porque la primera respuesta no llegó a
  // tiempo y parece que no pasó nada— deja el día destino con dos copias de cada
  // publicación, que es exactamente lo que pasó: dos ejecuciones, no un error.
  const previas = db.prepare(`
    SELECT COUNT(*) AS n FROM publication_clones WHERE desde = ? AND hasta = ?
  `).get(desde, hasta);
  const yaDuplicada = Number(previas?.n) || 0;
  if (yaDuplicada) {
    avisos.push(
      `Ya duplicaste el ${desde} al ${hasta} ${yaDuplicada === 1 ? '1 vez' : `${yaDuplicada} veces`}: ` +
      `si volvés a duplicar, el ${hasta} queda con las copias repetidas.`
    );
  }

  return {
    desde, hasta, hora_inicio: arranque ? horaInicio : null,
    reordenar: !!opciones.reordenar, rotar_destinos: !!opciones.rotar_destinos,
    duplicadas, conflictos, avisos, ya_duplicada: yaDuplicada,
  };
}

/**
 * Reubica las publicaciones del plan en los horarios que da el coordinador (los
 * huecos de A). Recibe `tiemposMs` (ms, ya ordenados) y los aplica a las
 * publicaciones ordenadas por su hora actual; las que no entran (excedente) se
 * quedan con la suya. Reordena el plan por hora y corrige la hora que muestran
 * los conflictos, que se calcularon con los horarios viejos.
 */
export function reubicarDuplicadas(plan, tiemposMs) {
  if (!Array.isArray(tiemposMs) || !tiemposMs.length) return plan;
  const orden = [...plan.duplicadas].sort((a, b) => new Date(a.a_iso) - new Date(b.a_iso));
  const horaPorId = new Map();
  tiemposMs.forEach((ms, k) => {
    const d = orden[k];
    if (!d) return;
    d.a_iso = new Date(ms).toISOString();
    d.a_hora = horaLocalDe(d.a_iso);
    d.a_fecha = fechaLocalDe(d.a_iso);
    horaPorId.set(d.id, d.a_hora);
  });
  plan.duplicadas.sort((a, b) => new Date(a.a_iso) - new Date(b.a_iso));
  for (const c of plan.conflictos || []) {
    if (horaPorId.has(c.de_id)) c.hora = horaPorId.get(c.de_id);
  }
  plan.distribuidas = tiemposMs.length;
  return plan;
}

/**
 * Acota el plan a las publicaciones marcadas en la vista previa.
 *
 * `ids` viene del front (los checks de la lista). Si no viene array —un cliente
 * viejo, o el mismo botón sin selección— el plan pasa entero: duplicar el día
 * completo es el comportamiento por defecto y el que el botón anuncia.
 *
 * Los ids que no están en el plan se devuelven en `fuera` en vez de fallar: entre
 * la vista previa y el clic pueden pasar cosas (el día cambió, la publicación se
 * borró, la reprogramaron a otro día) y para entonces ese id ya no era
 * duplicable. Tirar un 400 por eso dejaría al usuario sin salida desde el modal.
 */
export function acotarPlan(plan, ids) {
  if (!Array.isArray(ids)) return plan;
  const elegidas = new Set(ids.filter(x => typeof x === 'string' && x));
  const duplicadas = plan.duplicadas.filter(d => elegidas.has(d.id));
  const enElPlan = new Set(plan.duplicadas.map(d => d.id));
  return {
    ...plan,
    duplicadas,
    conflictos: plan.conflictos.filter(c => elegidas.has(c.de_id)),
    fuera: [...elegidas].filter(id => !enElPlan.has(id)),
  };
}
/**
 * Deshacer una duplicación, con la regla por DESTINO y no por copia.
 *
 * Recibe los `clon_id` exactos que devolvió la duplicación y borra esas copias
 * con todo lo suyo. El día de origen no se tocó, así que no hay nada que
 * restaurar: es la inversa exacta.
 *
 * Lo que NO se borra es un destino 'published': es historial real de Facebook, y
 * borrarlo sería falsearlo. La regla es por destino porque la anterior era por
 * copia, y eso la volvía inútil: si una copia tenía UN destino publicado, no
 * borraba NADA de esa copia, ni los destinos que nunca salieron. Con el día
 * duplicado del 2026-10-03 (152 vínculos, 48 copias con destinos) el deshacer
 * limpiaba 104 vínculos vacíos y dejaba vivos los 137 destinos pendientes: la
 * operación no deshacía lo que el usuario le pidió deshacer.
 *
 * Por cada copia:
 *   - borra los destinos que nunca publicaron (pending/error/cancelled/omitted/
 *     prepared);
 *   - conserva los 'published' y, con ellos, la publicación y el vínculo, para
 *     que el historial siga siendo real y la fila siga enlazada a su día;
 *   - si no queda ningún 'published', borra también plan, vínculo y publicación,
 *     que es la copia completa.
 *
 * Idempotente por clon: un clon que ya no está en `publication_clones` se
 * reporta como `omitidas`, no es un error.
 */
export function deshacerDuplicacion(db, clones) {
  const ESTADOS_NO_PUBLICADOS = "('pending','error','cancelled','omitted','prepared')";
  const borradas = [];
  const omitidas = [];
  const resumen = { destinos_borrados: 0, publicados_conservados: 0, copias_completas: 0 };

  for (const clonId of clones) {
    const vinculo = db.prepare('SELECT id FROM publication_clones WHERE clon_id = ?').get(clonId);
    if (!vinculo) {
      omitidas.push({ id: clonId, motivo: 'no es una copia de una duplicación' });
      continue;
    }
    const porEstado = db.prepare(
      "SELECT status, COUNT(*) AS n FROM publication_queue WHERE publication_id = ? GROUP BY status"
    ).all(clonId);
    const publicadas = Number(porEstado.find(r => r.status === 'published')?.n) || 0;
    const sinPublicar = porEstado
      .filter(r => r.status !== 'published')
      .reduce((acc, r) => acc + Number(r.n), 0);

    if (sinPublicar) {
      db.prepare(`DELETE FROM publication_queue WHERE publication_id = ? AND status IN ${ESTADOS_NO_PUBLICADOS}`)
        .run(clonId);
      resumen.destinos_borrados += sinPublicar;
    }

    if (publicadas) {
      omitidas.push({
        id: clonId,
        motivo: `${publicadas} destino(s) ya publicados en Facebook: se conservan como historial`,
        publicados: publicadas,
        destinos_borrados: sinPublicar,
      });
      resumen.publicados_conservados += publicadas;
      continue;
    }

    // No quedó historial: ahora sí es una copia completa y se borra entera.
    db.prepare('DELETE FROM publication_plans WHERE publication_id = ?').run(clonId);
    db.prepare('DELETE FROM publication_clones WHERE clon_id = ?').run(clonId);
    db.prepare('DELETE FROM publications WHERE id = ?').run(clonId);
    borradas.push({ id: clonId, destinos: sinPublicar, completa: true });
    resumen.copias_completas += 1;
  }

  return { borradas, omitidas, resumen };
}
