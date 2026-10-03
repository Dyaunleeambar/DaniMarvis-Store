// Transacciones sobre el wrapper de la BD.
//
// Existe como módulo aparte y no dentro de db/database.js por una razón concreta:
// para poder probarla contra una base en memoria. El comportamiento que importa
// —"dentro de una transacción no se guarda el archivo"— depende de que el wrapper
// de Statement.run() mire una bandera, y esa bandera vive en el objeto db. Pasando
// el db por parámetro, el test usa ESTA misma función y no una copia.
//
// El problema que resuelve, medido en sql.js: este módulo reescribe el archivo de
// la BD después de cada run(), y el guardado es db.export(), que CIERRA la
// transacción abierta con un ROLLBACK antes de serializar. O sea que un
// "BEGIN → INSERT → COMMIT" a mano perdía la fila insertada y el COMMIT terminaba
// en "cannot commit - no transaction is active". Por eso el guardado se difiere
// hasta el final: el archivo sigue con los datos previos hasta que la operación
// termina, y ahí se escribe una sola vez.

/**
 * Ejecuta `fn` dentro de una transacción sobre `db`.
 *
 * Es sincrónico a propósito: Node no atiende otro request en medio de un handler
 * sincrónico, así que el aislamiento no depende de la concurrencia, sino de que un
 * error a mitad de camino no deje la base partida.
 *
 * Anida: sólo la llamada más externa abre y cierra la transacción y guarda el
 * archivo. Si `fn` tira, deshace todo lo que hizo y el error sube.
 *
 * `db.enTransaccion` es la bandera que consulta Statement.run() antes de guardar.
 */
export function transaccion(db, fn) {
  const raiz = !db.enTransaccion;
  if (raiz) db.exec('BEGIN');
  db.enTransaccion = true;

  let salida;
  try {
    salida = fn();
  } catch (err) {
    db.enTransaccion = false;
    if (raiz) {
      try { db.exec('ROLLBACK'); } catch { /* la transacción ya estaba caída */ }
    }
    throw err;
  }

  db.enTransaccion = false;
  if (raiz) {
    db.exec('COMMIT');
    db.guardar();          // una sola escritura al archivo, al final
  }
  return salida;
}
