import initSqlJs from 'sql.js';
import fs from 'fs';
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
    this.#stmt.free();
    saveDB();
  }
}

function saveDB() {
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
  createSchema();
  seedIfEmpty();
  saveDB();

  // Wrap db.prepare to return Statement
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => new Statement(orig(sql));
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
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
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
