'use strict';
// Tiempos configurables, lado del poster (CJS).
//
// Copia de los rangos de backend/lib/groupPublisher/tiempos.js (el poster no
// puede importar ese módulo ESM). scripts/test-tiempos.mjs verifica que ambas
// listas sean idénticas. El poster vuelve a limitar lo que recibe: aunque el
// backend ya lo validó, si alguien lanza el poster a mano con `--tiempos=...`
// un valor fuera de rango no puede dejarlo sin esperas ni con esperas absurdas.

const DEFAULTS = Object.freeze({
  composer_s: 3.2,
  aviso_s: 2.2,
  vaciado_s: 30,
  confirmacion_s: 120,
  muestras_vacio: 6,
  colchon_red_s: 1.5,
  gap_min: 15,
});

const LIMITES = Object.freeze({
  composer_s: { min: 1.5, max: 5 },
  aviso_s: { min: 1, max: 6 },
  vaciado_s: { min: 10, max: 60 },
  confirmacion_s: { min: 30, max: 120 },
  muestras_vacio: { min: 3, max: 10, entero: true },
  colchon_red_s: { min: 0.5, max: 5 },
  gap_min: { min: 5, max: 300 },
});

function aNumero(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
  return Number(v);
}

function normalizarValor(clave, v) {
  const lim = LIMITES[clave];
  let n = aNumero(v);
  if (!Number.isFinite(n)) return DEFAULTS[clave];
  n = Math.min(lim.max, Math.max(lim.min, n));
  return lim.entero ? Math.round(n) : Math.round(n * 10) / 10;
}

/**
 * Lee el argumento `--tiempos=<json>`. Sin argumento, JSON roto o valores raros:
 * cae a los valores de siempre, nunca revienta.
 */
function leerTiempos(argJson) {
  let src = {};
  if (argJson) {
    try {
      const p = JSON.parse(argJson);
      if (p && typeof p === 'object') src = p;
    } catch (_) { /* JSON inválido: se usan los de siempre */ }
  }
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = normalizarValor(k, src[k]);
  return out;
}

module.exports = { DEFAULTS, LIMITES, leerTiempos };
