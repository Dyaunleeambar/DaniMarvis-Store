// Helpers de fecha/hora compartidos por los módulos del publicador. Puros y sin
// dependencias, para que ningún módulo de acá arrastre estado ni ciclos.

export const pad = (n) => String(n).padStart(2, '0');
export const localNow = () => new Date();

export function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
  // La cola guarda published_at/created_at en ISO (UTC). Este formato es
  // comparable por string con lo que genera new Date().toISOString().
}

export function toIsoUtc(d) {
  return d.toISOString();
}

export function localDayBoundaries() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start: toIsoUtc(start), end: toIsoUtc(end) };
}

/**
 * Lee una fecha de la cola como milisegundos UTC, sea del formato que sea.
 *
 * En la base conviven DOS formatos y por eso esto no puede ser un `new Date(x)`
 * pelado: el código escribe ISO con 'Z' ('2026-10-03T15:16:14.660Z') pero los
 * `datetime('now')` de SQLite escriben '2026-10-03 15:15:33', sin 'T' y sin 'Z'.
// `new Date()` interpreta ese segundo formato como HORA LOCAL, así que según
// de dónde venga la fila el mismo instante salía corrido 4 horas. Peor: al
 * comparar dos fechas como texto, '2026-10-03 15:15' siempre ordena antes que
 * '2026-10-03T15:15' porque el espacio (0x20) va antes que la 'T', y el filtro
 * `updated_at >= '2026-10-03T13:00'` dejaba afuera justo las filas que SQLite
 * había escrito. Normalizar acá evita las dos trampas.
 */
export function fechaMs(valor) {
  if (!valor) return NaN;
  let s = String(valor).trim();
  if (!s.includes('T')) s = s.replace(' ', 'T');
  // Sin 'Z' ni offset, `new Date` lo leería como local. SQLite siempre guarda UTC.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}
