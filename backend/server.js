import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDB, getDB } from './db/database.js';
import productsRouter from './routes/products.js';
import providersRouter from './routes/providers.js';
import salesRouter from './routes/sales.js';
import categoriesRouter from './routes/categories.js';
import backupRouter from './routes/backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'frontend')));

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
  const settings = db.prepare('SELECT exchange_rate FROM settings WHERE id = 1').get();
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const db = getDB();
  const { exchange_rate } = req.body;
  if (!exchange_rate || exchange_rate <= 0) {
    return res.status(400).json({ error: 'Tipo de cambio inválido' });
  }
  db.prepare('UPDATE settings SET exchange_rate = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(exchange_rate);
  const settings = db.prepare('SELECT exchange_rate FROM settings WHERE id = 1').get();
  res.json(settings);
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
