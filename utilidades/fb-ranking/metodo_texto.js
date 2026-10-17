/**
 * metodo_texto.js — lógica PURA de la técnica de texto.
 *
 * Vive aparte de group_poster.js por un motivo práctico: la elección de técnica
 * y la verificación de fidelidad son matemática, y conviene testearlas sin Chrome
 * ni base de datos. El poster se queda con el DOM (leer bloques, contar \n) y
 * acá está todo lo que se puede decidir con números.
 *
 * El contexto de por qué existe esto: el 2026-10-16 los posts largos tardaban
 * hasta 93 s SOLO en tipear (char a char con 12 ms), lo que se comía un tercio
 * del presupuesto de 300 s por grupo y alimentaba los fallos "Target closed" /
 * "detached Frame". Se probaron 4 técnicas para meter el texto de una vez y se
 * midió que no todas dejan la misma estructura en el editor Lexical de FB.
 */

// Técnicas soportadas. `teclado` es la de siempre (probada, lenta); las otras
// tres son pegado/inserción rápida que hay que validar en publicaciones reales.
const METODOS_TEXTO = ['teclado', 'insertText', 'ctrlv', 'pasteEvent'];

/** Normaliza la técnica: cualquier valor desconocido cae a `teclado`. */
function normMetodo(m) {
  const v = String(m == null ? '' : m).trim();
  return METODOS_TEXTO.includes(v) ? v : 'teclado';
}

/**
 * Calcula las métricas de fidelidad a partir de lo que devuelve el DOM.
 *
 * @param {{len:number, bloques:number, nlTexto:number}} info  lo leído del DOM
 *   - len:     largo del innerText (lo que ve el usuario)
 *   - bloques: <p>/<div> hijos (una línea por bloque en teclado/pegado)
 *   - nlTexto: \n literales dentro de nodos de texto (caso Input.insertText)
 * @param {string} sourceText  texto original que se quiso meter
 * @returns {{len,bloques,nlTexto,lineas,lineasSrc,lenSrc}}
 *   `lineas` = cuántas líneas quedaron, sin depender de la técnica:
 *   para párrafos son los bloques; para insertText son los \n + 1 (meter N
 *   saltos deja N+1 líneas). Se toma el mayor, así ninguna técnica se mide mal.
 */
function metricasDeInfo(info, sourceText) {
  const src = String(sourceText == null ? '' : sourceText);
  const i = info || {};
  const len = Number(i.len) || 0;
  const bloques = Number(i.bloques) || 0;
  const nlTexto = Number(i.nlTexto) || 0;
  return {
    len,
    bloques,
    nlTexto,
    lineas: Math.max(bloques, nlTexto + 1),
    lineasSrc: src.split(/\r\n|\r|\n/).length,
    lenSrc: src.length,
  };
}

/**
 * ¿El compositor quedó con el texto completo? Exige dos cosas:
 *  - el largo llegó cerca del original (falta ≤ 12 chars por bordes/trim)
 *  - las líneas alcanzan (se tolera -1 por la línea final en blanco)
 */
function verificarTexto(m) {
  const esperado = Math.max(8, m.lenSrc - 12);
  const okLen = m.len >= esperado;
  const okLineas = m.lineas >= m.lineasSrc - 1;
  return okLen && okLineas;
}

/**
 * ¿Se perdieron saltos de línea? Devuelve {breaks, gotBreaks} o null si está OK.
 * Antes el aviso exigía gotBreaks > 0, así que el peor caso (TODO en un bloque,
 * gotBreaks = 0) pasaba en silencio: el post salía con el texto de corrido sin
 * que nadie lo notara.
 *
 * Se tolera 1 línea perdida en textos largos: tipear el post más largo (161
 * líneas) deja 160 bloques (off-by-one conocido, inofensivo). En textos cortos
 * no se tolera nada, porque ahí perder una línea sí se nota.
 */
function saltosPerdidos(m) {
  const breaks = Math.max(0, m.lineasSrc - 1);
  if (breaks <= 0) return null;
  const gotBreaks = Math.max(0, m.lineas - 1);
  const slack = breaks >= 10 ? 1 : 0;
  if (breaks - gotBreaks > slack) return { breaks, gotBreaks };
  return null;
}

module.exports = { METODOS_TEXTO, normMetodo, metricasDeInfo, verificarTexto, saltosPerdidos };
