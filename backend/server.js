import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { basename, dirname, join, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { initDB, getDB } from './db/database.js';
import productsRouter from './routes/products.js';
import providersRouter from './routes/providers.js';
import salesRouter from './routes/sales.js';
import categoriesRouter from './routes/categories.js';
import backupRouter from './routes/backup.js';
import { generateCatalogFile } from './lib/catalogGenerator.js';
import { ensureWebp } from './lib/imageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3456;

const uploadsDir = join(__dirname, 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, uuid() + (extname(file.originalname) || '.jpg'));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (allowed.includes(extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Solo se permiten imágenes (jpg, png, gif, webp)'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(uploadsDir));

function authMiddleware(req, res, next) {
  if (req.path === '/login') return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const payload = JSON.parse(Buffer.from(authHeader.slice(7), 'base64').toString());
    if (Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Token expirado' });
    }
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

app.use('/api', authMiddleware);

app.use('/api/products', productsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/sales', salesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/backup', backupRouter);

app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede superar los 5MB' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se seleccionó ningún archivo' });

    try {
      const webpPath = await ensureWebp(req.file.path);
      if (webpPath && webpPath !== req.file.path) {
        return res.json({ url: `/uploads/${basename(webpPath)}` });
      }
    } catch { /* fallback: return original */ }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.get('/api/counts', (req, res) => {
  const db = getDB();
  res.json({
    products: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
    providers: db.prepare('SELECT COUNT(*) as c FROM providers').get().c,
    sales: db.prepare('SELECT COUNT(*) as c FROM sales').get().c,
  });
});

app.get('/api/settings', (req, res) => {
  const db = getDB();
  const settings = db.prepare('SELECT exchange_rate, publish_config FROM settings WHERE id = 1').get();
  if (settings.publish_config) {
    try { settings.publish_config = JSON.parse(settings.publish_config); } catch { settings.publish_config = {}; }
  } else {
    settings.publish_config = {};
  }
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const db = getDB();
  const { exchange_rate, publish_config } = req.body;

  if (exchange_rate !== undefined) {
    if (!exchange_rate || exchange_rate <= 0) {
      return res.status(400).json({ error: 'Tipo de cambio inválido' });
    }
    db.prepare("UPDATE settings SET exchange_rate = ?, updated_at = datetime('now') WHERE id = 1")
      .run(exchange_rate);
  }

  if (publish_config !== undefined) {
    db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(publish_config));
  }

  const settings = db.prepare('SELECT exchange_rate, publish_config FROM settings WHERE id = 1').get();
  if (settings.publish_config) {
    try { settings.publish_config = JSON.parse(settings.publish_config); } catch { settings.publish_config = {}; }
  } else {
    settings.publish_config = {};
  }
  res.json(settings);
});

app.post('/api/generate-description', async (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  try { pc = JSON.parse(row.publish_config || '{}'); } catch {}
  const ai = pc.ai || {};

  if (!ai.enabled || !ai.api_key) {
    return res.status(400).json({ error: 'IA no configurada. Configurá la API en Ajustes > Publicaciones.' });
  }

  const { name, category, warranty, description: existingDesc } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'El nombre del producto es obligatorio' });
  }

  const userPrompt = [
    `Producto: ${name}`,
    category ? `Categoría: ${category}` : '',
    warranty ? `Garantía: ${warranty}` : '',
    existingDesc ? `Descripción actual: ${existingDesc}` : ''
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${ai.api_url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ai.api_key}`
      },
      body: JSON.stringify({
        model: ai.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: ai.system_prompt || 'Genera una descripción atractiva y profesional para un producto de catálogo de ventas.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const generated = data.choices?.[0]?.message?.content?.trim();
    if (!generated) throw new Error('La IA no generó contenido');

    res.json({ description: generated });
  } catch (err) {
    console.error('[AI] Error:', err);
    res.status(500).json({ error: 'Error al generar descripción: ' + err.message });
  }
});

app.get('/api/dashboard', (req, res) => {
  const db = getDB();

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE status = 'active') as total_products,
      (SELECT COUNT(*) FROM providers) as total_providers,
      (SELECT COUNT(*) FROM sales) as total_sales,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales) as total_revenue,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales WHERE commission_paid = 0) as pending_commissions,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales) as total_commissions
  `).get();

  const monthlySales = db.prepare(`
    SELECT strftime('%Y-%m', sale_date) as month,
           COUNT(*) as count,
           SUM(total_amount) as revenue
    FROM sales
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();

  const topProducts = db.prepare(`
    SELECT p.name, COUNT(s.id) as sold, SUM(s.total_amount) as revenue
    FROM sales s
    JOIN products p ON p.id = s.product_id
    GROUP BY s.product_id
    ORDER BY sold DESC
    LIMIT 5
  `).all();

  const recentSales = db.prepare(`
    SELECT s.*, p.name as product_name
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    ORDER BY s.created_at DESC
    LIMIT 5
  `).all();

  const settings = db.prepare('SELECT exchange_rate FROM settings WHERE id = 1').get();
  res.json({ stats, monthlySales, topProducts, recentSales, exchange_rate: settings.exchange_rate });
});

app.post('/api/login', (req, res) => {
  const db = getDB();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = db.prepare('SELECT id, username, name, role FROM users WHERE username = ? AND password = ?')
    .get(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 86400000 })).toString('base64');
  res.json({ user, token });
});

app.use('/catalogo', express.static(join(__dirname, '..', 'public-catalog')));

app.post('/api/generate-catalog', async (req, res) => {
  try {
    const db = getDB();
    const products = db.prepare(`
      SELECT p.*, pr.name as provider_name
      FROM products p
      LEFT JOIN providers pr ON pr.id = p.provider_id
      WHERE p.status = 'active' AND p.catalog_visible = 1
      ORDER BY p.category, p.name
    `).all();

    if (!products.length) {
      return res.status(400).json({ error: 'No hay productos activos para generar el catálogo' });
    }

    const catalogDir = join(__dirname, '..', 'public-catalog');
    const uploadsDir = join(__dirname, 'uploads');
    await generateCatalogFile(products, catalogDir, uploadsDir);

    res.json({
      message: 'Catálogo generado correctamente',
      products_count: products.length,
      path: catalogDir,
      filename: 'index.html'
    });
  } catch (err) {
    console.error('[Catalog] Error:', err);
    res.status(500).json({ error: 'Error al generar el catálogo: ' + err.message });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(join(__dirname, '..', 'frontend', 'index.html'));
});

async function start() {
  try {
    await initDB();
    console.log('[DB] Base de datos inicializada');
  } catch (err) {
    console.error('[DB] Error fatal al iniciar la BD:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[Server] Panel DaniMarvis corriendo en http://localhost:${PORT}`);
  });
}

start();
