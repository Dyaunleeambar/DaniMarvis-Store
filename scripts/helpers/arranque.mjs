/**
 * Fixture para test-persistencia-config.mjs.
 *
 * Arranca la base de verdad (initDB y todas sus migraciones) contra el archivo
 * que le pase DANIMARVIS_DB, y según el subcomando:
 *   set   -> escribe una publish_config con una API key y los límites del reloj
 *   check -> imprime el publish_config resultante, para que el test compare
 *
 * Se ejecuta en un proceso aparte a propósito: el módulo tiene un singleton de
 * `db`, así que en el mismo proceso no se puede arrancar dos veces, que es
 * justamente lo que hay que probar.
 */
import { initDB, getDB } from '../../backend/db/database.js';

const sub = process.argv[2];
const KEY = 'sk-test-esta-es-una-api-key-falsa-de-73-caracteres-de-longitud-ok-123';

await initDB();

if (sub === 'set') {
  const db = getDB();
  const fila = db.prepare("SELECT publish_config FROM settings WHERE id = 1").get();
  let pc = {};
  try { pc = JSON.parse(fila?.publish_config || '{}'); } catch { /* estaba corrupta */ }
  pc.ai = { ...(pc.ai || {}), api_key: KEY, enabled: true };
  pc.agenda = { ...(pc.agenda || {}), min_gap_min: 5, max_per_hour: 12, grupos_por_post: 9 };
  pc.master = { ...(pc.master || {}), on: true };
  db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(pc));
  console.log(JSON.stringify({ ok: true, escrito: true }));
} else {
  const crudo = getDB().prepare("SELECT publish_config FROM settings WHERE id = 1").get()?.publish_config;
  let pc = {};
  try { pc = JSON.parse(crudo || '{}'); } catch { /* no parsea */ }
  console.log(JSON.stringify({
    vacio: crudo === null || crudo === '',
    largo: String(crudo || '').length,
    pc,
  }));
}