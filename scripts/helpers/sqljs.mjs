// Base sql.js en memoria para los tests, con la misma interfaz que expone
// backend/db/database.js.
//
// Hace falta el shim por dos motivos, los dos aprendidos a la mala:
//
//  1. sql.js devuelve un Statement crudo de prepare(), que bindea SÓLO un array de
//     parámetros y no tiene all/get/run. El servidor lo envuelve porque su código
//     llama con argumentos sueltos. Sin el shim, un `.run(id, nombre, ...)` sobre
//     sql.js crudo insertaría filas vacías y sin error: la peor forma de test.
//
//  2. El shim GUARDA en cada escritura, como el servidor. Eso es lo que hace
//     db.export() y fue justo lo que rompió las transacciones a mano: export()
//     cierra la transacción abierta con un rollback. Un shim que no guardara
//     pasaría los tests de duplicar el día en verde mientras el endpoint real
//     devolvía 500 y se comía las copias.
//
// Se usa la MISMA función transaccion() del servidor (backend/lib/transaccion.js):
// por eso el shim expone `enTransaccion` y `guardar`, que son lo que esa función
// toca.
import initSqlJs from 'sql.js';

/**
 * Devuelve { db, crudo } con el esquema indicado. `crudo` por si el test necesita
 * algo que el shim no expone. Cada escritura llama a crudo.export(), que es lo que
 * hace saveDB() en el servidor.
 */
export async function abrirMemoria(esquemaSql) {
  const SQL = await initSqlJs();
  const crudo = new SQL.Database();
  crudo.exec(esquemaSql);

  let guardadas = 0;
  const preparar = crudo.prepare.bind(crudo);
  const db = {
    enTransaccion: false,
    guardar: () => { guardadas++; crudo.export(); },
    get guardadas() { return guardadas; },
    resetGuardadas: () => { guardadas = 0; },
    exec: (sql) => crudo.exec(sql),
    prepare(sql) {
      const st = preparar(sql);
      return {
        all: (...p) => { if (p.length) st.bind(p); const r = []; while (st.step()) r.push(st.getAsObject()); st.free(); return r; },
        get: (...p) => { if (p.length) st.bind(p); const row = st.step() ? st.getAsObject() : undefined; st.free(); return row; },
        run: (...p) => {
          if (p.length) st.bind(p);
          st.step();
          const modified = crudo.getRowsModified();
          st.free();
          if (!db.enTransaccion) db.guardar();
          return modified;
        },
      };
    },
  };
  return { db, crudo };
}
