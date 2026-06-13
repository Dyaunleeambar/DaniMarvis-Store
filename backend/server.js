import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDB } from './db/database.js';
import productsRouter from './routes/products.js';
import providersRouter from './routes/providers.js';
import salesRouter from './routes/sales.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use(express.static(join(__dirname, '..', 'frontend')));

// API routes
app.use('/api/products', productsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/sales', salesRouter);

// Dashboard stats
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

  res.json({ stats, monthlySales, topProducts, recentSales });
});

// Auth
app.post('/api/login', (req, res) => {
  const db = getDB();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = db.prepare('SELECT id, username, name, role FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 86400000 })).toString('base64');
  res.json({ user, token });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Server] Panel DaniMarvis corriendo en http://localhost:${PORT}`);
});
