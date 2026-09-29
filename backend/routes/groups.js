import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const groups = db.prepare(
    'SELECT * FROM facebook_groups ORDER BY sort_order ASC, name ASC'
  ).all();
  res.json(groups);
});

router.post('/', (req, res) => {
  const db = getDB();
  const name = (req.body.name || '').trim();
  const url = (req.body.url || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const exists = db.prepare('SELECT id FROM facebook_groups WHERE name = ? COLLATE NOCASE').get(name);
  if (exists) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM facebook_groups').get();
  const group = { id: uuid(), name, url, sort_order: maxOrder.m + 1 };

  db.prepare('INSERT INTO facebook_groups (id, name, url, sort_order) VALUES (?, ?, ?, ?)').run(
    group.id, group.name, group.url, group.sort_order
  );

  res.status(201).json(group);
});

/**
 * Importa la lista de grupos suscritos que devuelve el sondeo.
 *
 * Idempotente y en lote, a diferencia del POST /: la clave es el fb_id (el
 * número que Facebook le da al grupo), no el nombre. Así:
 *  - correr el sondeo dos veces no duplica nada
 *  - si el usuario renombró un grupo en Facebook, se actualiza en el lugar
 *  - dos grupos distintos con el mismo nombre conviven sin pisarse
 *
 * El nombre se usa solo cuando el item viene sin fb_id (alta manual).
 */
router.post('/import', (req, res) => {
  const db = getDB();
  const items = Array.isArray(req.body.groups) ? req.body.groups : null;
  if (!items) return res.status(400).json({ error: 'Se esperaba { groups: [...] }' });
  if (items.length > 2000) return res.status(400).json({ error: 'Demasiados grupos en un solo lote' });

  let maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM facebook_groups').get().m;
  const creados = [];
  const actualizados = [];
  const omitidos = [];
  const errores = [];

  for (const raw of items) {
    const name = String(raw?.name || '').trim();
    const url = String(raw?.url || '').trim();
    const m = url.match(/\/groups\/(\d+)/);
    const fbId = String(raw?.fb_id || (m ? m[1] : '')).trim();

    if (!name) { omitidos.push({ name: name || '(sin nombre)', motivo: 'sin nombre' }); continue; }
    if (!fbId && !url) { omitidos.push({ name, motivo: 'sin fb_id ni url' }); continue; }

    const actual = fbId
      ? db.prepare('SELECT * FROM facebook_groups WHERE fb_id = ?').get(fbId)
      : null;

    if (actual) {
      // Solo se pisa si algo cambió, para no ensuciar updated_at de 120 filas.
      if (actual.name !== name || (url && actual.url !== url)) {
        db.prepare("UPDATE facebook_groups SET name = ?, url = ?, updated_at = datetime('now') WHERE id = ?")
          .run(name, url || actual.url, actual.id);
        actualizados.push({ id: actual.id, name, fbId });
      } else {
        omitidos.push({ name, motivo: 'ya estaba' });
      }
      continue;
    }

    // Sin fb_id, se evita el duplicado por nombre como hacía el POST original.
    const porNombre = db.prepare('SELECT * FROM facebook_groups WHERE name = ? COLLATE NOCASE').get(name);
    if (porNombre) {
      // Le falta el fb_id: se completa para que la próxima importación lo compare bien.
      if (fbId && !porNombre.fb_id) {
        try {
          db.prepare('UPDATE facebook_groups SET fb_id = ? WHERE id = ?').run(fbId, porNombre.id);
          actualizados.push({ id: porNombre.id, name, fbId, motivo: 'se le asoció el fb_id al existente' });
        } catch (e) { errores.push(`${name}: ${e.message}`); }
      } else {
        omitidos.push({ name, motivo: 'ya existe con ese nombre' });
      }
      continue;
    }

    const id = uuid();
    try {
      db.prepare('INSERT INTO facebook_groups (id, name, url, sort_order, fb_id) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, url, maxOrder + 1, fbId || null);
      maxOrder++;
      creados.push({ id, name, fbId });
    } catch (e) {
      errores.push(`${name}: ${e.message}`);
    }
  }

  res.json({
    recibidos: items.length,
    creados: creados.length,
    actualizados: actualizados.length,
    omitidos: omitidos.length,
    errores: errores.length,
    detalle: { creados, actualizados, omitidos: omitidos.slice(0, 40), errores: errores.slice(0, 20) },
  });
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Grupo no encontrado' });

  const name = (req.body.name ?? existing.name).toString().trim();
  const url = (req.body.url ?? existing.url).toString().trim();
  if (!name) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const duplicate = db.prepare('SELECT id FROM facebook_groups WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, req.params.id);
  if (duplicate) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });

  db.prepare('UPDATE facebook_groups SET name = ?, url = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(name, url, req.params.id);

  const updated = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.patch('/reorder', (req, res) => {
  const db = getDB();
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'Se esperaba un array order' });
  }
  for (let i = 0; i < order.length; i++) {
    db.prepare('UPDATE facebook_groups SET sort_order = ? WHERE id = ?').run(i, order[i]);
  }
  res.json({ message: 'Orden actualizado' });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM facebook_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Grupo no encontrado' });

  db.prepare('DELETE FROM facebook_groups WHERE id = ?').run(req.params.id);
  res.json({ message: 'Grupo eliminado' });
});

export default router;