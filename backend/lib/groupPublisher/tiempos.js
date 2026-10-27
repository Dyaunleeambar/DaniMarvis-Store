// Tiempos configurables del publicador (Ajustes > Tiempos).
//
// Este módulo es PURO (sin base de datos) para poder usarlo desde el merge de la
// config y desde los tests. Los valores se guardan en publish_config.tiempos y
// se validan ACÁ, en el backend: la pantalla también limita los campos, pero
// quien manda es este archivo (un cliente viejo o una config editada a mano no
// pueden dejar un tiempo fuera de rango).
//
// El poster es CJS y no puede importar este módulo; tiene su copia en
// utilidades/fb-ranking/tiempos_poster.js. scripts/test-tiempos.mjs verifica que
// ambas listas coincidan y que el literal que usa el panel también.
//
// Por qué hay mínimos: un tiempo demasiado corto no hace fallar la publicación,
// hace algo peor — el poster cierra la pestaña mientras Facebook todavía está
// enviando y el post se pierde, pero se registra como publicado (cuando no se
// confirma el envío a tiempo, el poster igual informa `published` con la nota
// "no se pudo confirmar el envío"). Los mínimos son el piso por debajo del cual
// eso deja de ser un riesgo razonable.

// Valores de siempre (los que el poster tenía fijos en el código).
export const TIEMPOS_DEFAULTS = Object.freeze({
  composer_s: 3.2,      // espera tras cada intento de abrir el compositor (tope del rango aleatorio)
  aviso_s: 2.2,         // ventana para ver el aviso "Publicando…" tras pulsar Publicar
  vaciado_s: 30,        // tope para que el compositor se vacíe tras publicar
  confirmacion_s: 120,  // tope para confirmar que el envío salió
  muestras_vacio: 6,    // lecturas seguidas (~1 s c/u) con el compositor vacío para dar por enviado
  colchon_red_s: 1.5,   // silencio de red exigido por la confirmación rápida
  gap_min: 15,          // separación mínima entre publicaciones consecutivas (s)
});

// Rangos permitidos. Los topes de espera no suben por encima del valor de
// siempre: el guard global de 600 s por grupo se calculó con esos valores.
export const TIEMPOS_LIMITES = Object.freeze({
  composer_s: { min: 1.5, max: 5 },
  aviso_s: { min: 1, max: 6 },
  vaciado_s: { min: 10, max: 60 },
  confirmacion_s: { min: 30, max: 120 },
  muestras_vacio: { min: 3, max: 10, entero: true },
  colchon_red_s: { min: 0.5, max: 5 },
  gap_min: { min: 5, max: 300 },
});

export const TIEMPOS_CLAVES = Object.freeze(Object.keys(TIEMPOS_DEFAULTS));

// Perfiles. "personalizado" no está acá: usa los valores que guardó el usuario.
export const TIEMPOS_PERFILES = Object.freeze({
  seguro: Object.freeze({ ...TIEMPOS_DEFAULTS, confirm_red: false }),
  rapido: Object.freeze({
    composer_s: 2.5, aviso_s: 1.5, vaciado_s: 15, confirmacion_s: 60,
    muestras_vacio: 4, colchon_red_s: 1, confirm_red: true, gap_min: 30,
  }),
});
export const PERFIL_NOMBRES = Object.freeze(['seguro', 'rapido', 'personalizado']);
export const PERFIL_DEFAULT = 'seguro';

/** Lo que usa el panel: una sola fuente para el literal que lleva la vista. */
export const TIEMPOS_UI = Object.freeze({
  defaults: TIEMPOS_DEFAULTS,
  limites: TIEMPOS_LIMITES,
  perfiles: TIEMPOS_PERFILES,
});

function aNumero(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
  return Number(v);
}

/** Un valor suelto, dentro de su rango; lo que no sea número cae al default. */
export function normalizarValor(clave, v) {
  const def = TIEMPOS_DEFAULTS[clave];
  const lim = TIEMPOS_LIMITES[clave];
  if (def === undefined || !lim) return undefined;
  let n = aNumero(v);
  if (!Number.isFinite(n)) return def;
  n = Math.min(lim.max, Math.max(lim.min, n));
  return lim.entero ? Math.round(n) : Math.round(n * 10) / 10;
}

/** Normaliza un objeto de valores: toda clave presente, todo dentro de su rango. */
export function normalizarTiempos(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of TIEMPOS_CLAVES) out[k] = normalizarValor(k, src[k]);
  return out;
}

/**
 * Tiempos efectivos a partir de la config guardada. Devuelve
 * { perfil, ...valores, confirm_red }.
 *
 * Compatibilidad: antes de existir esta sección, la confirmación rápida vivía en
 * publish_config.confirm_red. Si no hay `tiempos` guardado y ese flag está en
 * true, se respeta como perfil personalizado (valores de siempre + confirmación
 * rápida) para que quien ya la activó no vea cambiar nada.
 */
export function resolverTiempos(pc) {
  const cfg = pc && typeof pc === 'object' ? pc : {};
  const t = cfg.tiempos && typeof cfg.tiempos === 'object' ? cfg.tiempos : null;
  const legacyRed = cfg.confirm_red === true;

  let perfil = t && PERFIL_NOMBRES.includes(t.perfil) ? t.perfil : (legacyRed ? 'personalizado' : PERFIL_DEFAULT);

  if (perfil === 'seguro' || perfil === 'rapido') {
    return { perfil, ...TIEMPOS_PERFILES[perfil] };
  }
  const confirmRed = t ? t.confirm_red === true : legacyRed;
  return { perfil: 'personalizado', ...normalizarTiempos(t && t.valores), confirm_red: confirmRed };
}

/** Los valores numéricos que recibe el poster (sin el flag, que va aparte). */
export function tiemposParaPoster(pc) {
  const r = resolverTiempos(pc);
  const out = {};
  for (const k of TIEMPOS_CLAVES) out[k] = r[k];
  return out;
}
