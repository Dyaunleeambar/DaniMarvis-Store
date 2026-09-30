// Eleccion de WHICH grupos se tildan en cada publicacion.
//
// Va en su propio archivo a proposito: el poster es un script de CommonJS que
// no se puede importar (arranca Chrome al cargarse), asi que la logica pura
// queda aca y se testea sola. Ver scripts/test-lote-grupos.mjs.

// Normaliza nombres de grupo para poder comparar. Facebook los adorna:
// "💲💲Ventas Cárdenas💲💲", "®REVOLICO ×× ©CIENFUEGOS", "☆LA VENDEDERA EN SANTA
// CLARA☆". Comparar en crudo haria que el cursor nunca encuentre el grupo donde
// quedo y el reparto arrancaria de cero en cada publicacion.
function normGrupo(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Devuelve los indices a tildar, arranca DESPUES de `desde` y da la vuelta al
// llegar al final. El wrap importa: la lista de Facebook no es multiplo del
// lote (173 grupos con lotes de 9 deja un resto de 2), asi que el ultimo lote
// tiene que completarse con los primeros del principio.
//
// Sobre el renombrado: el match exacto es el camino normal y alcanza siempre
// mientras el grupo no cambie de nombre, porque el cursor guarda el nombre que
// se vio en la corrida anterior. El fallback por substring solo cubre lo que
// se parece a un cambio menor (agregar un año, un sufijo). NO cubre
// reescrituras grandes: "compra y venta en calimete" -> "compra venta calimete"
// no coincide, y a proposito. Preferimos arrancar de 0, que es visible y
// ordenado, a arrancar desde el grupo equivocado, que saltea 9 en silencio y
// no se nota hasta mucho despues.
function elegirIndicesLote(items, n, desde) {
  const total = items.length;
  const cuantos = Math.max(1, Math.min(30, Number(n) || 9));
  if (!total || cuantos <= 1) return [];

  const objetivo = normGrupo(desde);
  let arranque = 0;
  if (objetivo) {
    const i = items.findIndex(x => normGrupo(x) === objetivo);
    if (i >= 0) arranque = i + 1;              // arrancar DESPUES del ultimo
    else {
      // el grupo se renombro o dejo de existir: coincidencia parcial, en los
      // dos sentidos, porque "compra venta en calimete" y "compra y venta en el
      // municipio de CALIMETE" son el mismo grupo escrito distinto.
      const parcial = items.findIndex(x => {
        const a = normGrupo(x);
        return a && (a.includes(objetivo) || objetivo.includes(a));
      });
      arranque = parcial >= 0 ? parcial + 1 : 0;
    }
  }
  if (arranque >= total) arranque = 0;          // estaba al final: da la vuelta

  const pedidos = [];
  for (let k = 0; k < Math.min(cuantos, total); k++) pedidos.push((arranque + k) % total);
  return pedidos;
}

module.exports = { normGrupo, elegirIndicesLote };
