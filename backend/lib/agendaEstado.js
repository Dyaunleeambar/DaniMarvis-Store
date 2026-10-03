// Estado agregado de un evento del calendario, a partir de sus destinos.
//
// Vive aparte y no dentro de routes/agenda.js porque el plan de duplicar el día
// necesita exactamente la misma cuenta para el punto de color de cada fila de la
// vista previa: si el modal dijera "Programada" y el calendario "Publicada",
// el usuario dudaría de cuál de los dos está mintiendo. Una sola función, dos
// consumidores.
//
// No es una tabla calculada ni una columna guardada: depende de `now`, porque
// "Programada" y "Vencida" son el mismo conjunto de filas 'pending' en momentos
// distintos. Por eso el llamador pasa la hora en milisegundos.
export function aggregateEstado(destinos, nowMs) {
  const st = destinos.map(d => d.status);
  const tiene = s => st.includes(s);

  const pendientes = destinos.filter(d => d.status === 'pending');
  const publicadas = destinos.filter(d => d.status === 'published');
  const errores = destinos.filter(d => d.status === 'error');
  const canceladas = destinos.filter(d => d.status === 'cancelled');
  const omitidas = destinos.filter(d => d.status === 'omitted');
  const archivadas = destinos.filter(d => d.status === 'archived');

  if (destinos.length === 0) return { estado: 'material', etiqueta: 'Material' };

  // Una publicación que se desarmó deja de contar, pero se muestra como tal.
  if (pendientes.length === 0 && publicadas.length === 0) {
    if (omitidas.length) return { estado: 'omitida', etiqueta: 'Omitida' };
    if (archivadas.length) return { estado: 'cancelada', etiqueta: 'Histórico' };
    if (canceladas.length) return { estado: 'cancelada', etiqueta: 'Cancelada' };
  }

  // Publicada = no queda nada vivo por publicar. OJO: se compara contra lo que
  // falta por salir, NO con `destinos.length`: cuando una publicación se
  // reprogramó, quedan filas 'archived' (el historial) y puede haber 'cancelled'
  // (desarmadas o descartadas), y con el conteo completo una publicación que ya
  // salió nunca llegaba a "Publicada" y se caía en "Material".
  if (tiene('published') && !pendientes.length && !errores.length) {
    return { estado: 'publicada', etiqueta: 'Publicada' };
  }
  if (errores.length && !pendientes.length) return { estado: 'error', etiqueta: 'Error' };

  // Quedan pendientes: vencida o programada según la hora.
  if (publicadas.length && pendientes.length) {
    const vencidas = pendientes.some(d => horaDe(d) !== null && horaDe(d) <= nowMs);
    return vencidas
      ? { estado: 'parcial_vencida', etiqueta: 'Parcial · vencida' }
      : { estado: 'parcial', etiqueta: 'Parcial' };
  }
  if (pendientes.length) {
    const vencidas = pendientes.filter(d => horaDe(d) !== null && horaDe(d) <= nowMs).length;
    if (vencidas && vencidas === pendientes.length) return { estado: 'vencida', etiqueta: 'Vencida' };
    if (vencidas) return { estado: 'parcial_vencida', etiqueta: 'Parcial · vencida' };
    return { estado: 'programada', etiqueta: 'Programada' };
  }
  return { estado: 'material', etiqueta: 'Material' };
}

/**
 * Hora de un destino en milisegundos, o null si no tiene.
 *
 * Acepta el `_ms` ya normalizado que arma routes/agenda.js, pero también calcula
 * desde `scheduled_at`: el plan de duplicar el día lee los destinos con una
 * consulta más chica y no lleva `_ms` puesto.
 */
function horaDe(d) {
  if (d._ms !== undefined) return d._ms;
  if (!d.scheduled_at) return null;
  const ms = new Date(String(d.scheduled_at).replace(' ', 'T')).getTime();
  return Number.isNaN(ms) ? null : ms;
}
