import { Router } from 'express';
import { getDB, saveDB } from '../db/database.js';

const router = Router();

const ALL_TABLES = [
  'products',
  'providers',
  'sales',
  'categories',
  'settings',
  'users',
  'publications',
  'publication_queue',
  'exports',
];

router.get('/', (req, res) => {
  const db = getDB();
  const data = {
    version: 2,
    exported_at: new Date().toISOString(),
  };
  for (const t of ALL_TABLES) {
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

  try {
    for (const t of ALL_TABLES) {
      if (!Array.isArray(data[t])) continue;
      const rows = data[t];
      if (!rows.length) continue;

      const existing = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t);
      const validCols = new Set(existing.map(r => r.name));
      const sampleKeys = Object.keys(rows[0]);

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
    }

    saveDB();
    res.json({ message: 'Datos restaurados correctamente' });
  } catch (e) {
    const msg = e?.message || e?.toString() || 'Error desconocido';
    console.error('[Backup] Error al restaurar:', msg);
    res.status(500).json({ error: 'Error al restaurar los datos: ' + msg });
  }
});

export default router;
