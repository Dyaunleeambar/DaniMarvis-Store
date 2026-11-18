import { Router } from 'express';
import { getDB, saveDB, listTables } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const data = {
    version: 2,
    exported_at: new Date().toISOString(),
  };
  for (const t of listTables()) {
    data[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  res.json(data);
});

function q(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return "'" + String(val).replace(/'/g, "''") + "'";
}

router.post('/restore', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Archivo de respaldo inválido' });
  }

  const db = getDB();
  const tables = new Set(listTables());

  // Se restaura tabla por tabla (DELETE + INSERT). Con foreign_keys activos el
  // orden de borrado/inserción podría violar integridad referencial, por lo que
  // se desactiva durante la restauración y se vuelve a activar al final.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const t of Object.keys(data)) {
      if (!tables.has(t)) continue;
      if (!Array.isArray(data[t])) continue;
      const rows = data[t];

      const existing = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t);
      const validCols = new Set(existing.map(r => r.name));

      // Una tabla VACÍA en el respaldo también se limpia. Con el `continue` que
      // había antes, restaurar un respaldo en el que esa tabla estaba vacía
      // dejaba los datos del momento intactos: el resultado no era la foto de
      // esa fecha sino un revolújido de dos. Lo que decide el borrado es que la
      // tabla esté en el JSON, no que tenga filas.
      const before = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c;
      if (before > 0) {
        db.exec('DELETE FROM ' + t);
      }

      for (const r of rows) {
        const keys = Object.keys(r).filter(k => validCols.has(k));
        if (!keys.length) continue;
        const cols = keys.join(', ');
        const vals = keys.map(k => q(r[k])).join(', ');
        db.exec(`INSERT INTO ${t} (${cols}) VALUES (${vals})`);
      }
      console.log(`[Backup] Restaurada ${t}: ${rows.length} fila(s)`);
    }

    saveDB();
    res.json({ message: 'Datos restaurados correctamente' });
  } catch (e) {
    const msg = e?.message || e?.toString() || 'Error desconocido';
    console.error('[Backup] Error al restaurar:', msg);
    res.status(500).json({ error: 'Error al restaurar los datos: ' + msg });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
});

// ---------- Listar tablas disponibles ----------
router.get('/tables', (req, res) => {
  res.json({ tables: listTables() });
});

function getValidColumns(table) {
  const db = getDB();
  const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table);
  return new Set(rows.map(r => r.name));
}

// ---------- Exportación selectiva de tablas (con filtros opcionales por tabla) ----------
router.post('/selective', (req, res) => {
  const { tables, filters = {} } = req.body || {};
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: 'Indicá al menos una tabla para exportar' });
  }

  const db = getDB();
  const availableTables = new Set(listTables());
  const data = {
    version: 2,
    exported_at: new Date().toISOString(),
    selective: true,
    tables,
    filters,
  };

  for (const t of tables) {
    if (!availableTables.has(t)) continue;
    const validCols = getValidColumns(t);
    const tableFilters = filters[t] || {};
    const conditions = [];
    const params = [];
    for (const [col, val] of Object.entries(tableFilters)) {
      if (val === '' || val === null || val === undefined) continue;
      if (!validCols.has(col)) continue;
      conditions.push(`${col} = ?`);
      params.push(val);
    }
    let sql = `SELECT * FROM ${t}`;
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    data[t] = db.prepare(sql).all(...params);
  }

  res.json(data);
});

export default router;
