// Diagnóstico de por qué no apareció el compositor de un grupo.
//
// Va en su propio archivo a propósito: el poster es un script de CommonJS que no
// se puede importar (arranca Chrome al cargarse), así que la lógica pura queda
// acá y se testea sola. Ver scripts/test-diagnostico-fb.mjs.
//
// El caso que motiva esto: la salida "No se encontró el compositor del grupo
// (¿grupo cerrado/archivado?)" era la misma tanto si el grupo estaba cerrado
// como si se había caído la sesión o Facebook había limitado la cuenta. Con una
// pista a partir del texto visible, el error dice cuál de las tres fue.

/** Pista legible a partir del texto visible de la página. '' si no reconoce nada. */
function pistaSinCompositor(texto) {
  const t = String(texto || '').toLowerCase();
  if (/inicia sesi[oó]n|iniciar sesi[oó]n|log into|log in to|crear cuenta nueva|you must log in/.test(t)) {
    return ' La página pide iniciar sesión.';
  }
  if (/bloque|restring|no puedes publicar|no pod[eé]s publicar|demasiad|has alcanzado|l[ií]mite|violaci[oó]n|normas comunitarias|temporalmente/.test(t)) {
    return ' La página muestra un aviso de bloqueo/límite de Facebook.';
  }
  if (/[uú]nete|unirte|join group|solo miembros|miembros pueden|debes ser miembro/.test(t)) {
    return ' El grupo exige unirse para poder publicar.';
  }
  if (/no est[aá] disponible|contenido no disponible|p[aá]gina no encontrada|not available/.test(t)) {
    return ' El grupo no está disponible.';
  }
  return '';
}

// Decisión de "¿el envío terminó?" a partir de una muestra de la página. Pura a
// propósito (el poster arranca Chrome al cargarse), para poder testearla.
//
// El caso que motiva esto: el compositor se vacía apenas se hace clic en
// Publicar, pero con imágenes la subida sigue después. Antes se cerraba la
// pestaña al ver el compositor vacío y se abortaba el post ("la pestaña se
// cierra mientras publica"). Hay una señal fuerte (el post ya aparece en el
// feed) y una débil (compositor vacío y sin indicadores de subida), que se exige
// sostenida varias muestras para no confundir un re-render con el fin del envío.
const ENVIO_VACIO_SOSTENIDO = 4;

/**
 * Combina una muestra ({aparecio, enCurso, conTexto}) con el contador previo.
 * Devuelve { done, vacioSostenido, motivo }. `done:true` = el envío se puede dar
 * por terminado; `motivo` explica la señal que lo decidió.
 */
function decidirEnvio(muestra, vacioSostenido) {
  const m = muestra || {};
  if (m.aparecio) return { done: true, vacioSostenido: 0, motivo: 'el post apareció en el feed' };
  if (!m.enCurso && m.conTexto === 0) {
    const n = (vacioSostenido || 0) + 1;
    if (n >= ENVIO_VACIO_SOSTENIDO) return { done: true, vacioSostenido: n, motivo: 'sin indicadores y compositor vacío' };
    return { done: false, vacioSostenido: n, motivo: '' };
  }
  return { done: false, vacioSostenido: 0, motivo: '' };
}

module.exports = { pistaSinCompositor, decidirEnvio, ENVIO_VACIO_SOSTENIDO };
