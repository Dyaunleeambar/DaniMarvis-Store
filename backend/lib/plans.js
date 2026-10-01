import { v4 as uuid } from 'uuid';

/**
 * Registro de horarios que una publicación tuvo en el pasado.
 *
 * `publications.publication_date` guarda UN solo horario: es el slot que el
 * calendario muestra. Cuando el usuario reprograma a mano, ese valor se
 * sobrescribe y el horario anterior se perdía. Como una publicación sólo
 * puede vivir en un punto del calendario a la vez, el rastro de los horarios
 * anteriores va aparte, en `publication_plans`.
 *
 * OJO: acá NO se registra la distribución en el día. Esa crea una publicación
 * nueva (un clon) por vez, así que cada franja queda como un evento propio del
 * calendario y no necesita historial.
 */
export function registrarPlan(db, publicationId, nuevaFecha, origen = 'reprogramar') {
  if (!nuevaFecha) return;
  const actual = db.prepare('SELECT publication_date FROM publications WHERE id = ?').get(publicationId);
  if (!actual || !actual.publication_date || actual.publication_date === nuevaFecha) return;
  db.prepare(`
    INSERT INTO publication_plans (id, publication_id, fecha, origen)
    VALUES (?, ?, ?, ?)
  `).run(uuid(), publicationId, actual.publication_date, origen);
}