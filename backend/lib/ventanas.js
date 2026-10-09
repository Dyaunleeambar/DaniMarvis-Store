// Distribución de las publicaciones de B en los huecos que deja la agenda de A.
//
// Regla (decidida con el usuario): A NUNCA se mueve. B publica en los espacios
// libres entre las publicaciones de A dentro de su ventana [ini, fin]. Si B
// tiene MÁS publicaciones que huecos, el excedente se queda en su propia hora
// programada (no se fuerza una segunda B dentro del mismo hueco, para no
// amontonar dos seguidas).
//
// Ejemplo del usuario: A A A B A B A B A A A. Con más publicaciones de A que de
// B, las de B quedan repartidas —no todas pegadas al principio—, que es lo que
// hace `elegirHuecosRepartidos`.
//
// Todo se maneja en epoch ms (números) para no arrastrar ambigüedad de zona
// horaria: quien llama formatea a su formato de guardado.

/** Un hueco es un intervalo [desde, hasta] entre dos eventos de A (o entre el
 *  borde de la ventana y el primer/último de A). */
export function huecosDe(tiemposA, ini, fin, minGapMs = 0) {
  const inicio = Number(ini);
  const finMs = Number(fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(finMs) || finMs <= inicio) return [];
  const eventos = (Array.isArray(tiemposA) ? tiemposA : [])
    .map(Number)
    .filter(t => Number.isFinite(t) && t >= inicio && t <= finMs)
    .sort((a, b) => a - b);
  const bordes = [inicio, ...eventos, finMs];
  const huecos = [];
  for (let i = 0; i < bordes.length - 1; i++) {
    const desde = bordes[i];
    const hasta = bordes[i + 1];
    const ancho = hasta - desde;
    if (ancho <= 0) continue;
    huecos.push({ desde, hasta, ancho, cabe: ancho >= 2 * minGapMs });
  }
  return huecos;
}

/**
 * Elige `k` huecos repartidos lo más parejo posible entre los `G` disponibles,
 * con el patrón de "puntos medios" (como intercalar en una recta). Evita que B
 * se amontone al principio cuando tiene menos publicaciones que huecos.
 */
function indicesRepartidos(G, k) {
  if (k <= 0 || G <= 0) return [];
  if (k >= G) return Array.from({ length: G }, (_, i) => i);
  const usados = new Set();
  for (let i = 0; i < k; i++) {
    const idx = Math.min(G - 1, Math.floor(((i + 0.5) * G) / k));
    usados.add(idx);
  }
  // Si el redondeo colapsó dos índices, rellena los huecos libres de menor a mayor.
  let j = 0;
  while (usados.size < k && j < G) { usados.add(j); j++; }
  return [...usados].sort((a, b) => a - b);
}

/**
 * Devuelve hasta `cantidad` horarios (ms) para B, ubicados en los huecos de A.
 *
 * - `tiemposA`: momentos (ms) en que A ya tiene algo agendado.
 * - `[ini, fin]`: ventana de B (ms).
 * - `cantidad`: cuántas publicaciones quiere meter B.
 * - `minGapMs`: separación mínima exigida a cada lado de un A (por defecto 0).
 *
 * Retorna `{ dentro, excedente, huecosA, huecosUsados }`: `dentro` son los
 * horarios colocados en huecos (ms, ordenados); `excedente` es cuántas de las
 * `cantidad` no entraron y deben quedarse en la hora propia de B.
 */
export function distribuirEnHuecos({ tiemposA = [], ini, fin, cantidad = 0, minGapMs = 0 }) {
  const n = Math.max(0, Number(cantidad) || 0);
  const huecos = huecosDe(tiemposA, ini, fin, minGapMs);
  const usables = huecos.filter(h => h.cabe);
  if (n === 0 || usables.length === 0) {
    return { dentro: [], excedente: n, huecosA: huecos.length, huecosUsados: 0 };
  }
  const k = Math.min(n, usables.length);
  const dentro = indicesRepartidos(usables.length, k).map((gi) => {
    const h = usables[gi];
    const medio = (h.desde + h.hasta) / 2;
    return Math.round(Math.min(h.hasta - minGapMs, Math.max(h.desde + minGapMs, medio)));
  }).sort((a, b) => a - b);
  return { dentro, excedente: n - dentro.length, huecosA: huecos.length, huecosUsados: dentro.length };
}
