import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildCatalogHtml } from '../backend/lib/catalogGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'backend', 'danimarvis.db');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public-catalog');

async function main() {
  console.log('[Catalog] Leyendo base de datos...');

  const SQL = await initSqlJs();
  const buffer = readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  const products = db.exec(`
    SELECT p.*, pr.name as provider_name
    FROM products p
    LEFT JOIN providers pr ON pr.id = p.provider_id
    WHERE p.status = 'active'
    ORDER BY p.category, p.name
  `);

  if (!products.length || !products[0].values.length) {
    console.log('[Catalog] No hay productos activos.');
    return;
  }

  const columns = products[0].columns;
  const rows = products[0].values;

  const parsed = rows.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });

  const { mkdirSync, writeFileSync } = await import('fs');
  const { join } = await import('path');

  const uploadsDir = join(PROJECT_ROOT, 'backend', 'uploads');
  const html = buildCatalogHtml(parsed, uploadsDir);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'index.html'), html, 'utf-8');

  console.log(`[Catalog] Catálogo generado: ${OUTPUT_DIR}/index.html`);
  console.log(`[Catalog] ${parsed.length} productos exportados.`);
}

main().catch(err => {
  console.error('[Catalog] Error:', err);
  process.exit(1);
});
