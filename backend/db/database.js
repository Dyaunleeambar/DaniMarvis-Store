import initSqlJs from 'sql.js';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'danimarvis.db');

let db = null;

class Statement {
  #stmt;
  constructor(stmt) { this.#stmt = stmt; }

  all(...params) {
    if (params.length) this.#stmt.bind(params);
    const rows = [];
    while (this.#stmt.step()) rows.push(this.#stmt.getAsObject());
    this.#stmt.free();
    return rows;
  }

  get(...params) {
    if (params.length) this.#stmt.bind(params);
    const hasRow = this.#stmt.step();
    const row = hasRow ? this.#stmt.getAsObject() : undefined;
    this.#stmt.free();
    return row;
  }

  run(...params) {
    if (params.length) this.#stmt.bind(params);
    this.#stmt.step();
    const modified = db.getRowsModified();
    this.#stmt.free();
    saveDB();
    return modified;
  }
}

export function saveDB() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Error al guardar:', err.message);
  }
}

export async function initDB() {
  if (db) return;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.exec('PRAGMA foreign_keys = ON;');

  // Wrap db.prepare before schema/seed so Statement.all() is available
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => new Statement(orig(sql));

  createSchema();
  seedIfEmpty();
  migrateImages();
  migratePublishText();
  migrateProviderInfo();
  migrateCatalogVisible();
  migratePublishConfig();
  migratePublicationDate();
  migrateExportsKind();
  migratePubQueue();
  migratePromptEngine();
  migrateGeneratedImages();
  migrateCommissionCurrency();
  migrateProviderStyleCode();
  migrateProviderStyles();
  migrateWarrantyRules();
  migrateFacebookGroups();
  saveDB();
}

export function getDB() {
  if (!db) throw new Error('Base de datos no inicializada. Llama a initDB() primero.');
  return db;
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT,
      phone TEXT,
      email TEXT,
      commission_rate REAL DEFAULT 0,
      info TEXT DEFAULT '',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      price REAL NOT NULL,
      commission_type TEXT DEFAULT 'percentage',
      commission_value REAL DEFAULT 0,
      warranty TEXT,
      provider_id TEXT,
      image_url TEXT,
      publish_text TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      catalog_visible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      provider_id TEXT,
      client_name TEXT,
      client_phone TEXT,
      client_address TEXT,
      quantity INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      commission_amount REAL DEFAULT 0,
      commission_paid INTEGER DEFAULT 0,
      exchange_rate REAL DEFAULT 61000,
      delivery_method TEXT,
      delivery_status TEXT DEFAULT 'pending',
      notes TEXT,
      sale_date TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      exchange_rate REAL NOT NULL DEFAULT 61000,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT DEFAULT '',
      publish_text TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      style TEXT DEFAULT 'table',
      kind TEXT DEFAULT 'pdf',
      fields TEXT DEFAULT '[]',
      product_ids TEXT DEFAULT '[]',
      product_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS publication_queue (
      id TEXT PRIMARY KEY,
      publication_id TEXT,
      group_name TEXT NOT NULL,
      group_url TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      published_at TEXT,
      variant_index INTEGER DEFAULT 0,
      variant_text TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (publication_id) REFERENCES publications(id)
    );
  `);
  seedCategories();
}

const DEFAULT_CATEGORIES = [
  'Electrodomésticos', 'Cocina', 'Hogar', 'Energía', 'Climatización', 'Tecnología', 'Otro'
];

function seedCategories() {
  const existing = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (existing.c === 0) {
    DEFAULT_CATEGORIES.forEach((name, i) => {
      db.run('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)', [uuid(), name, i]);
    });
  }

  const orphans = db.prepare(`
    SELECT DISTINCT category as name FROM products
    WHERE category != '' AND category NOT IN (SELECT name FROM categories)
  `).all();
  orphans.forEach((row, i) => {
    db.run('INSERT OR IGNORE INTO categories (id, name, sort_order) VALUES (?, ?, ?)',
      [uuid(), row.name, 100 + i]);
  });
}

function migrateImages() {
  try {
    db.exec("ALTER TABLE products ADD COLUMN images TEXT DEFAULT '[]'");
  } catch (_) {}
  const toMigrate = db.prepare(
    "SELECT id, image_url FROM products WHERE image_url IS NOT NULL AND image_url != '' AND (images IS NULL OR images = '[]' OR images = '[]')"
  ).all();
  for (const row of toMigrate) {
    db.prepare("UPDATE products SET images = ? WHERE id = ?").run(JSON.stringify([row.image_url]), row.id);
  }
}

function migratePublishText() {
  try {
    db.exec("ALTER TABLE products ADD COLUMN publish_text TEXT DEFAULT ''");
  } catch (_) {}
}
function migrateProviderInfo() {
  try {
    db.exec("ALTER TABLE providers ADD COLUMN info TEXT DEFAULT ''");
  } catch (_) {}
}
function migrateCatalogVisible() {
  try {
    db.exec("ALTER TABLE products ADD COLUMN catalog_visible INTEGER DEFAULT 1");
  } catch (_) {}
}

function migratePublishConfig() {
  let isNew = false;
  try {
    db.exec("ALTER TABLE settings ADD COLUMN publish_config TEXT DEFAULT '{}'");
    isNew = true;
  } catch (_) {}
  if (isNew) {
    const defaults = JSON.stringify({
      template: '#DaniMarvis_Store\nCatálogo: https://dyaunleeambar.github.io/DaniMarvis-Store/public-catalog/\nConsultas al WhatsApp: http://bit.ly/danimarvis_store\n{DESCRIPTION}\nPrecio: ${PRICE} USD\nFormas de pago: USD, MN al cambio del día previo acuerdo, Zelle\nEnvío gratis a Matanzas, Cienfuegos y Villa Clara\nWhatsApp: 54115666 / 53760493 / http://bit.ly/danimarvis_store\n#DaniMarvis_Store\nhttps://www.facebook.com/profile.php?id=61591067843509\nQuiénes somos\nGestores de ventas que trabajan directamente con importadores. Ofrecemos una experiencia de compra segura, clara y acompañada, desde la consulta hasta el hogar.',
      ai: {
        enabled: false,
        api_url: 'https://api.openai.com/v1',
        api_key: '',
        model: 'gpt-4o-mini',
        system_prompt: 'Genera una descripción atractiva y profesional para un producto de catálogo de ventas. Responde ÚNICAMENTE con el texto de la descripción, sin explicaciones adicionales. Incluye:\n1) Una línea con el nombre del producto y un eslogan corto separado por "–".\n2) Un párrafo descriptivo destacando características y beneficios.\n3) Una sección "Características esenciales" con bullets puntos clave.\nUsa un tono persuasivo pero profesional. Máximo 250 palabras.'
      }
    });
    db.prepare("UPDATE settings SET publish_config = ? WHERE id = 1").run(defaults);
  }
}

function migratePublicationDate() {
  try {
    db.exec("ALTER TABLE publications ADD COLUMN publication_date TEXT");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE publications ADD COLUMN sort_order INTEGER DEFAULT 0");
  } catch (_) {}
  const pubs = db.prepare("SELECT id, created_at FROM publications WHERE publication_date IS NULL").all();
  for (const p of pubs) {
    db.prepare("UPDATE publications SET publication_date = ? WHERE id = ?").run(p.created_at, p.id);
  }
}

function migrateExportsKind() {
  try {
    db.exec("ALTER TABLE exports ADD COLUMN kind TEXT DEFAULT 'pdf'");
  } catch (_) {}
  db.exec("UPDATE exports SET kind = 'pdf' WHERE kind IS NULL OR kind = ''");
}

function migratePubQueue() {
  try {
    db.exec("ALTER TABLE publication_queue ADD COLUMN variant_text TEXT DEFAULT ''");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE publication_queue ADD COLUMN notes TEXT DEFAULT ''");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE publication_queue ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
  } catch (_) {}
}

function migratePromptEngine() {
  try {
    db.exec("ALTER TABLE products ADD COLUMN last_template TEXT");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE products ADD COLUMN creative_history TEXT DEFAULT '[]'");
  } catch (_) {}
}

function migrateGeneratedImages() {
  const oldDir = join(__dirname, '..', 'uploads', 'copilot');
  const newDir = join(__dirname, '..', 'uploads', 'generated');
  if (fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, newDir);
      console.log('[DB] Carpeta uploads/copilot → uploads/generated');
    } catch (err) {
      console.error('[DB] No se pudo renombrar uploads/copilot:', err.message);
    }
  }
  db.exec("UPDATE exports SET style = 'generated' WHERE style = 'copilot'");
  const withImages = db.prepare("SELECT id, images FROM products WHERE images LIKE '%/uploads/copilot/%'").all();
  for (const row of withImages) {
    try {
      const images = JSON.parse(row.images || '[]').map(u => String(u).replace('/uploads/copilot/', '/uploads/generated/'));
      db.prepare("UPDATE products SET images = ? WHERE id = ?").run(JSON.stringify(images), row.id);
    } catch (_) {}
  }
  const withFields = db.prepare("SELECT id, fields FROM exports WHERE fields LIKE '%/uploads/copilot/%'").all();
  for (const row of withFields) {
    try {
      const fields = JSON.parse(row.fields || '{}');
      if (fields.url) fields.url = String(fields.url).replace('/uploads/copilot/', '/uploads/generated/');
      db.prepare("UPDATE exports SET fields = ? WHERE id = ?").run(JSON.stringify(fields), row.id);
    } catch (_) {}
  }
}

function migrateCommissionCurrency() {
  try {
    db.exec("ALTER TABLE providers ADD COLUMN commission_currency TEXT DEFAULT 'USD'");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE products ADD COLUMN commission_currency TEXT DEFAULT 'USD'");
  } catch (_) {}
  try {
    db.exec("ALTER TABLE sales ADD COLUMN commission_currency TEXT DEFAULT 'USD'");
  } catch (_) {}
}

function migrateProviderStyleCode() {
  try {
    db.exec("ALTER TABLE providers ADD COLUMN provider_style_code TEXT");
  } catch (_) {}
}

function migrateProviderStyles() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_styles (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      style_name TEXT NOT NULL,
      palette TEXT DEFAULT '{}',
      background_rules TEXT DEFAULT '',
      accent_rules TEXT DEFAULT '',
      signature_rules TEXT DEFAULT '',
      negative_rules TEXT DEFAULT '',
      shipping_rule TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec("ALTER TABLE provider_styles ADD COLUMN shipping_rule TEXT DEFAULT ''");
  } catch (_) {}

  // Backfill shipping_rule for existing styles that have empty shipping_rule
  db.prepare("UPDATE provider_styles SET shipping_rule = 'Envío: GRATIS a Matanzas, Cienfuegos y Villa Clara' WHERE code = 'GE' AND (shipping_rule IS NULL OR shipping_rule = '')").run();
  db.prepare("UPDATE provider_styles SET shipping_rule = 'Envío: GRATIS a Matanzas y Cienfuegos' WHERE code = 'EM' AND (shipping_rule IS NULL OR shipping_rule = '')").run();
  db.prepare("UPDATE provider_styles SET shipping_rule = 'Envío: GRATIS a Matanzas y Cienfuegos' WHERE code = 'MM' AND (shipping_rule IS NULL OR shipping_rule = '')").run();

  // Renombrar estilos por defecto para unificar el formato de nombres
  db.prepare("UPDATE provider_styles SET style_name = 'DANIMARVIS_G_ERIKA', updated_at = datetime('now') WHERE code = 'GE' AND style_name = 'DANIMARVIS_CLASSIC'").run();
  db.prepare("UPDATE provider_styles SET style_name = 'DANIMARVIS_MARINERO', updated_at = datetime('now') WHERE code = 'EM' AND style_name = 'DANIMARVIS_RED'").run();

  const existing = db.prepare('SELECT COUNT(*) as c FROM provider_styles').get();
  if (existing.c === 0) {
    const defaults = [
      {
        code: 'GE', name: 'MiPime Gabriel y Erika', style_name: 'DANIMARVIS_G_ERIKA',
        palette: JSON.stringify({ navy: '#08245A', deep_navy: '#061633', orange: '#FF6A00', gold: '#D9A928', white: '#FFFFFF', coral: 'conservar_firma_original' }),
        background_rules: 'Navy profundo como color estructural dominante. Blanco para respiración, títulos y módulos.',
        accent_rules: 'Naranja como acento dinámico. Dorado principalmente en el precio. Puede usar brochazos o diagonales solo como recursos secundarios.',
        signature_rules: 'Estructura clásica DaniMarvis. Navy dominante + naranja + dorado + blanco. No necesita sello público de proveedor.',
        negative_rules: 'No confundirse con el perfil MM. Los brochazos son secundarios, no principales.',
        shipping_rule: 'Envío: GRATIS a Matanzas, Cienfuegos y Villa Clara',
      },
      {
        code: 'EM', name: 'TCP El Marinero', style_name: 'DANIMARVIS_MARINERO',
        palette: JSON.stringify({ primary: 'tonos_rojos', structure: '#08245A', accent: 'rojo_familia', gold: '#D9A928', white: '#FFFFFF' }),
        background_rules: 'Cambiar el protagonismo cromático hacia una familia de tonos rojos. Los rojos funcionan como identidad del perfil, no como estética de "ofertón". Navy puede permanecer como estructura secundaria o contraste.',
        accent_rules: 'Tonos rojos como identidad del perfil. Dorado continúa reservado principalmente al precio.',
        signature_rules: 'Tonos rojos + estructura visual DaniMarvis. La estructura debe seguir siendo claramente DaniMarvis aunque el color dominante sea rojo.',
        negative_rules: 'No usar rojos como estética de "ofertón". No perder la arquitectura visual DaniMarvis.',
        shipping_rule: 'Envío: GRATIS a Matanzas y Cienfuegos',
      },
      {
        code: 'MM', name: 'MiPimeMelani', style_name: 'DANIMARVIS_MELANI',
        palette: JSON.stringify({ background: 'claro_luminoso', coral: 'suave', navy: 'secundario', gold: '#D9A928', white: '#FFFFFF' }),
        background_rules: 'Fondo predominantemente claro, limpio y luminoso. El navy reaparece como elemento estructural secundario. Detrás o alrededor del logo pueden aparecer toques sutiles de navy (pinceladas o manchas controladas).',
        accent_rules: 'Brochazos/pinceladas como recurso gráfico distintivo. Coral/rojo suave y otros acentos conviven con blanco sin saturar. Dorado para precio manteniendo sobriedad.',
        signature_rules: 'Fondo claro + brochazos + MM circular + navy sutil. Añadir un identificador interno "MM" dentro de un círculo discreto, elegante y reconocible.',
        negative_rules: 'No saturar con colores. No perder orden, legibilidad ni jerarquía comercial.',
        shipping_rule: 'Envío: GRATIS a Matanzas y Cienfuegos',
      },
    ];

    for (const d of defaults) {
      db.prepare(`INSERT INTO provider_styles (code, name, style_name, palette, background_rules, accent_rules, signature_rules, negative_rules, shipping_rule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.code, d.name, d.style_name, d.palette, d.background_rules, d.accent_rules, d.signature_rules, d.negative_rules, d.shipping_rule);
    }
    console.log('[DB] Perfiles de proveedor por defecto creados: GE, EM, MM');
  }
}

function migrateFacebookGroups() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrateWarrantyRules() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warranty_rules (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      warranty_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
  `);
}

function seedIfEmpty() {
  let result = db.exec('SELECT COUNT(*) as c FROM users');
  let count = result?.[0]?.values?.[0]?.[0] || 0;
  if (count === 0) {
    db.run('INSERT INTO users (id, username, name, password, role) VALUES (?, ?, ?, ?, ?)',
      ['usr-admin', 'admin', 'Administrador', 'admin123', 'admin']);
    console.log('[DB] Usuario admin creado: admin / admin123');
  }

  result = db.exec('SELECT COUNT(*) as c FROM settings');
  count = result?.[0]?.values?.[0]?.[0] || 0;
  if (count === 0) {
    db.run('INSERT INTO settings (id, exchange_rate) VALUES (1, 61000)');
    console.log('[DB] Tipo de cambio por defecto: 1 USD = 61000 MN');
  }
}
