import express from 'express';
import cors from 'cors';
import multer from 'multer';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { basename, dirname, join, extname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { initDB, getDB, verifyPassword, isLegacyPlaintext, hashPassword, signToken, verifyToken } from './db/database.js';
import productsRouter from './routes/products.js';
import providersRouter from './routes/providers.js';
import salesRouter from './routes/sales.js';
import categoriesRouter from './routes/categories.js';
import backupRouter from './routes/backup.js';
import publicationsRouter from './routes/publications.js';
import exportsRouter from './routes/exports.js';
import importImagesRouter from './routes/images.js';
import importRouter from './routes/import.js';
import pubQueueRouter from './routes/pubQueue.js';
import groupsRouter from './routes/groups.js';
import rankingsRouter from './routes/rankingsRouter.js';
import promptEngineRouter from './routes/promptEngine.js';
import providerStylesRouter from './routes/providerStyles.js';
import warrantyRulesRouter from './routes/warrantyRules.js';
import { generateCatalogFile } from './lib/catalogGenerator.js';
import { ensureWebp } from './lib/imageUtils.js';
import { createBackup } from './scripts/backup.js';

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
app.use(express.json({ limit: '50mb' }));
app.use(compression());
app.use(express.static(join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(uploadsDir));

function authMiddleware(req, res, next) {
  if (req.path === '/login') return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload || Date.now() > payload.exp) {
    return res.status(401).json({ error: Date.now() > payload?.exp ? 'Token expirado' : 'Token inválido' });
  }
  req.userId = payload.id;
  next();
}

// Rate limit simple en memoria (ventana deslizante por IP).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retrySec = Math.ceil((windowMs - (now - (arr.at(-1) || now))) / 1000);
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${retrySec}s.` });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

app.use('/api', authMiddleware);

app.use('/api/products', productsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/sales', salesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/backup', backupRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/images', importImagesRouter);
app.use('/api/import', importRouter);
app.use('/api/pub-queue', pubQueueRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/prompt-engine', promptEngineRouter);
app.use('/api/provider-styles', providerStylesRouter);
app.use('/api/warranty-rules', warrantyRulesRouter);

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
        try { unlinkSync(req.file.path); } catch {}
        return res.json({ url: `/uploads/${basename(webpPath)}` });
      }
    } catch { /* fallback: return original */ }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.get('/api/counts', (req, res) => {
  const db = getDB();
  res.json({
    products: db.prepare('SELECT COUNT(*) as c FROM products WHERE catalog_visible = 1').get().c,
    providers: db.prepare('SELECT COUNT(*) as c FROM providers').get().c,
    sales: db.prepare('SELECT COUNT(*) as c FROM sales').get().c,
  });
});

app.get('/api/settings', (req, res) => {
  const db = getDB();
  const settings = db.prepare('SELECT exchange_rate, publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  if (settings.publish_config) {
    try { pc = JSON.parse(settings.publish_config); } catch { pc = {}; }
  }
  let ai = pc.ai || {};
  let facebook = pc.facebook || {};
  ai = { ...ai, api_key: ai.api_key ? '••••••••' : '', _api_key_set: !!ai.api_key };
  facebook = { ...facebook, access_token: facebook.access_token ? '••••••••' : '', _access_token_set: !!facebook.access_token };
  pc.ai = ai;
  pc.facebook = facebook;
  settings.publish_config = pc;
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
    let merged = publish_config;
    if (typeof publish_config === 'object' && publish_config !== null) {
      let existing = {};
      try { existing = JSON.parse(db.prepare('SELECT publish_config FROM settings WHERE id = 1').get().publish_config || '{}'); } catch {}
      // El frontend nunca envía la key real (llega enmascarada). Vacío = conservar
      // el valor vigente; solo se borra con los flags explícitos remove_ai_key /
      // remove_fb_token.
      const ai = { ...(existing.ai || {}), ...(publish_config.ai || {}) };
      const fb = { ...(existing.facebook || {}), ...(publish_config.facebook || {}) };
      if (publish_config.ai && publish_config.ai.remove_ai_key) delete ai.api_key;
      else if (!ai.api_key) ai.api_key = (existing.ai || {}).api_key;
      if (publish_config.facebook && publish_config.facebook.remove_fb_token) delete fb.access_token;
      else if (!fb.access_token) fb.access_token = (existing.facebook || {}).access_token;
      delete ai.remove_ai_key;
      delete fb.remove_fb_token;
      merged = { ...existing, ...publish_config, ai, facebook: fb };
    }
    db.prepare("UPDATE settings SET publish_config = ?, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(merged));
  }

  const settings = db.prepare('SELECT exchange_rate, publish_config FROM settings WHERE id = 1').get();
  let pc = {};
  if (settings.publish_config) {
    try { pc = JSON.parse(settings.publish_config); } catch { pc = {}; }
  }
  let ai = pc.ai || {};
  let facebook = pc.facebook || {};
  ai = { ...ai, api_key: ai.api_key ? '••••••••' : '', _api_key_set: !!ai.api_key };
  facebook = { ...facebook, access_token: facebook.access_token ? '••••••••' : '', _access_token_set: !!facebook.access_token };
  pc.ai = ai;
  pc.facebook = facebook;
  settings.publish_config = pc;
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
    const apiUrl = ai.api_url.replace(/\/+$/, '');
    const isOpenRouter = apiUrl.includes('openrouter.ai');

    const response = await fetch(`${apiUrl}/chat/completions`, {
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
        max_tokens: 2000,
        // Algunos modelos ":free" de OpenRouter son modelos de razonamiento:
        // si no se desactiva, pueden agotar max_tokens "pensando" y devolver
        // message.content vacío aunque la respuesta sea 200 OK.
        ...(isOpenRouter ? { reasoning: { enabled: false } } : {})
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const rawBody = await response.text().catch(() => '');
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error('El proveedor no devolvió JSON válido. Revisá la URL del API en Ajustes > Generación con IA.');
    }
    const choice = data.choices?.[0];
    // Fallback por si el proveedor ignora reasoning:enabled:false y de
    // todos modos manda la respuesta al canal de razonamiento.
    const generated = (choice?.message?.content || choice?.message?.reasoning || '').trim();
    if (!generated) {
      const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
      throw new Error(`La IA no generó contenido${reason}. Probá con otro modelo en Ajustes > Generación con IA.`);
    }

    res.json({ description: generated });
  } catch (err) {
    console.error('[AI] Error:', err);
    res.status(500).json({ error: 'Error al generar descripción: ' + err.message });
  }
});

app.post('/api/generate-image', imageLimiter, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'El prompt es obligatorio' });
  }

  const q = encodeURIComponent(prompt.trim());
  const seed = Math.floor(Math.random() * 1e9);
  const url = `https://image.pollinations.ai/prompt/${q}?width=1080&height=1080&seed=${seed}&nologo=true&model=flux`;
  const timeout = 90;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Pollinations ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    res.json({ dataUrl });
  } catch (err) {
    console.error('[Image] Error:', err);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Tiempo de espera agotado (el modelo tarda en iniciarse). Intentá de nuevo.' });
    }
    res.status(500).json({ error: 'Error al generar imagen: ' + err.message });
  }
});

app.get('/api/dashboard', (req, res) => {
  const db = getDB();

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE catalog_visible = 1) as total_products,
      (SELECT COUNT(*) FROM products) as total_products_all,
      (SELECT COUNT(*) FROM providers) as total_providers,
      (SELECT COUNT(*) FROM sales) as total_sales,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales) as total_revenue,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales WHERE commission_paid = 0) as pending_commissions,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales) as total_commissions,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales WHERE commission_paid = 0 AND (commission_currency = 'USD' OR commission_currency IS NULL)) as pending_commissions_usd,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM sales WHERE commission_paid = 0 AND commission_currency = 'MN') as pending_commissions_mn
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

app.post('/api/login', loginLimiter, (req, res) => {
  const db = getDB();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = db.prepare('SELECT id, username, name, role, password FROM users WHERE username = ?')
    .get(username);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const okLikeStored = verifyPassword(password, user.password);
  // Upgrade transparente de contraseñas legadas en texto plano a hash scrypt.
  if (!okLikeStored && isLegacyPlaintext(user.password) && user.password === password) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
  } else if (!okLikeStored) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  delete user.password;
  const token = signToken({ id: user.id, exp: Date.now() + 86400000 });
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

  createBackup().catch((e) => {
    console.error('[Backup] Error automático al iniciar:', e.message);
  });

  app.listen(PORT, () => {
    console.log(`[Server] Panel DaniMarvis corriendo en http://localhost:${PORT}`);
  });
}

start();
