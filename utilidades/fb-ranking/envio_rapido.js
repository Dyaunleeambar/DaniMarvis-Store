'use strict';
// Piezas puras para acortar el tramo "Publicar -> cerrar pestaña" sin perder
// la garantía de que el post salió.
//
// Por qué existe: se espera a que el envío termine porque cerrar la pestaña con
// una subida/mutación en vuelo ABORTA el post. La señal que se usaba (compositor
// vacío + sin indicadores de carga, sostenido varias muestras, o el post visible
// en el feed) es correcta pero lenta o dependiente de que el feed renderice.
// Acá se agrega una señal más directa: ¿quedó alguna petición del envío en vuelo?
// Si el mutation del post ya se envió y respondió, y no hay nada pendiente, cerrar
// la pestaña ya no aborta nada.

// Peticiones que importan para el envío. El host de subida de fotos está
// documentado en group_poster.js (upload.facebook.com/ajax/.../photo/upload);
// el post en sí viaja por el endpoint GraphQL.
const RELEVANTE = /upload\.facebook\.com|rupload\.facebook\.com|\/api\/graphql|\/ajax\/(react_composer|composer|upload)/i;

function esRelevante(metodo, url) {
  return String(metodo || '').toUpperCase() === 'POST' && RELEVANTE.test(String(url || ''));
}

// Nombre amistoso de la operación GraphQL (p. ej. "...StoryCreateMutation").
// Solo para el log: así, tras unas corridas se sabe el nombre real y no hay que
// adivinarlo. Nunca se usa para decidir nada.
function nombreOperacion(req) {
  try {
    const body = typeof req.postData === 'function' ? req.postData() : '';
    const m = String(body || '').match(/fb_api_req_friendly_name=([^&]+)/);
    return m ? decodeURIComponent(m[1]).slice(0, 80) : '';
  } catch (_) { return ''; }
}

/**
 * Empieza a vigilar las peticiones relevantes de `page`. Llamar justo ANTES del
 * clic en Publicar, para ver el mutation del envío.
 * `ahora` es inyectable para poder probarlo sin esperar de verdad.
 */
function vigilarRed(page, { ahora = Date.now } = {}) {
  const vuelo = new Set();
  const nombres = [];
  let terminadas = 0;
  let ultimoFin = ahora();
  const t0 = ahora();

  const alPedir = (req) => {
    if (!esRelevante(req.method(), req.url())) return;
    vuelo.add(req);
    const n = nombreOperacion(req);
    if (n && !nombres.includes(n) && nombres.length < 6) nombres.push(n);
  };
  const alTerminar = (req) => {
    if (vuelo.delete(req)) { terminadas++; ultimoFin = ahora(); }
  };
  page.on('request', alPedir);
  page.on('requestfinished', alTerminar);
  page.on('requestfailed', alTerminar);

  return {
    t0,
    /** { enVuelo, terminadas, quietoMs (desde que terminó la última), nombres } */
    estado() {
      return {
        enVuelo: vuelo.size,
        terminadas,
        quietoMs: vuelo.size ? 0 : ahora() - ultimoFin,
        nombres: nombres.slice(),
      };
    },
    detener() {
      try { page.off('request', alPedir); page.off('requestfinished', alTerminar); page.off('requestfailed', alTerminar); } catch (_) { /* la página puede estar ya cerrada */ }
    },
  };
}

/**
 * ¿La red está quieta tras el envío? Exige haber VISTO al menos una petición
 * relevante terminar (si no se vio el mutation, la quietud sería vacía y no
 * prueba nada: se cae al criterio de siempre), nada en vuelo y un colchón sin
 * actividad.
 */
function redQuieta(estado, minQuietoMs = 1500) {
  const e = estado || {};
  return e.terminadas > 0 && e.enVuelo === 0 && e.quietoMs >= minQuietoMs;
}

/**
 * Sondea `fn` hasta que devuelva algo truthy o se acabe la ventana. Devuelve ese
 * valor (o `null`). Reemplaza esperas fijas por una espera que corta apenas se
 * cumple la condición.
 */
async function sondearHasta(fn, { ventanaMs, pasoMs = 300, dormir, ahora = Date.now }) {
  const limite = ahora() + ventanaMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (ahora() >= limite) return null;
    await dormir(pasoMs);
  }
}

module.exports = { esRelevante, nombreOperacion, vigilarRed, redQuieta, sondearHasta };
