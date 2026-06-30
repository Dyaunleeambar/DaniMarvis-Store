import { formatCurrency } from './currency.js';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const WHATSAPP_NUMBER = '5353760493';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isLocalImage(url) {
  return url && url.startsWith('/uploads/');
}

function isExternalUrl(url) {
  return url && url.startsWith('http');
}

function parseImages(p) {
  if (Array.isArray(p.images)) return p.images;
  if (typeof p.images === 'string') {
    try { return JSON.parse(p.images); } catch { return []; }
  }
  return [];
}

export function buildCatalogHtml(products, uploadsDir) {
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

  if (uploadsDir && existsSync(uploadsDir)) {
    const files = readdirSync(uploadsDir);
    products.forEach(p => {
      const images = parseImages(p);
      images.forEach(url => {
        if (isLocalImage(url)) {
          const filename = url.replace('/uploads/', '');
          if (files.includes(filename)) {
            const destDir = join(uploadsDir, '..', '..', 'public-catalog', 'images');
            mkdirSync(destDir, { recursive: true });
            const src = join(uploadsDir, filename);
            const dest = join(destDir, filename);
            if (existsSync(src) && !existsSync(dest)) {
              copyFileSync(src, dest);
            }
            if (!p._localImage) {
              p._localImage = `images/${filename}`;
            }
          }
        }
      });
      if (!p._localImage && images.length > 0) {
        p._localImage = images[0];
      }
    });
  }

  const productCards = products.map((p, idx) => {
    const initials = escapeHtml(p.name).charAt(0).toUpperCase();
    let imgHtml;
    if (p._localImage) {
      imgHtml = `<img src="${escapeHtml(p._localImage)}" alt="${escapeHtml(p.name)}" loading="lazy" />`;
    } else if (isExternalUrl(p.image_url)) {
      imgHtml = `<div class="no-img"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>`;
    } else {
      imgHtml = `<div class="no-img">${initials}</div>`;
    }

    const text = `Hola, me interesa *${p.name}*. Precio: ${formatCurrency(p.price)}. ¿Está disponible?`;
    const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

    return `
      <div class="product-card" data-category="${escapeHtml(p.category || '')}" data-idx="${idx}">
        <div class="product-card__img">${imgHtml}</div>
        <div class="product-card__body">
          <h3 class="product-card__name">${escapeHtml(p.name)}</h3>
          <div class="product-card__price">${formatCurrency(p.price)}</div>
          ${p.description ? `<p class="product-card__desc">${escapeHtml(p.description.slice(0, 100))}${p.description.length > 100 ? '...' : ''}</p>` : ''}
          <div class="product-card__actions">
            <a href="${waLink}" target="_blank" class="btn-wa">Consultar</a>
          </div>
        </div>
      </div>`;
  }).join('\n          ');

  const productsJson = JSON.stringify(products.map(p => ({
    name: p.name,
    price: p.price,
    description: p.description || '',
    category: p.category || '',
    image_url: isExternalUrl(p.image_url) ? p.image_url : '',
    image_local: p._localImage || '',
  })));

  const categoryBtns = categories.map(c =>
    `<button class="cat-btn" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join('\n            ');

  const generatedDate = new Date().toLocaleString('es-CU', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DaniMarvis Store — Catálogo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --rose: #c9847a;
      --rose-light: #e8b4ad;
      --rose-dark: #a8645a;
      --dark: #221815;
      --bg: #f5f3f0;
      --bg-card: #ffffff;
      --border: #e5e0dc;
      --text: #1a1412;
      --text-secondary: #6b5e5a;
      --text-muted: #9e918d;
      --success: #25D366;
      --radius: 12px;
      --shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06);
      --shadow-lg: 0 4px 20px rgba(0,0,0,.12);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1412;
        --bg-card: #241c19;
        --border: #3a2d2a;
        --text: #f0edeb;
        --text-secondary: #c0b5b0;
        --text-muted: #8a7e7a;
        --shadow: 0 1px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.24);
        --shadow-lg: 0 4px 16px rgba(0,0,0,.4);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; -webkit-font-smoothing: antialiased; scroll-behavior: smooth; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
    }
    a { color: var(--rose); text-decoration: none; }
    img { max-width: 100%; height: auto; display: block; }

    /* ── Header ──────────────────────────────────────────── */
    .header {
      background: var(--dark);
      color: #fff;
      padding: 24px 20px;
      text-align: center;
    }
    .header__logo {
      font-family: Georgia, serif;
      font-size: 1.6rem;
      font-weight: 700;
    }
    .header__logo span { color: var(--rose); }
    .header__sub {
      font-size: .85rem;
      color: rgba(255,255,255,.6);
      margin-top: 4px;
    }
    .header__wa {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      padding: 8px 20px;
      background: var(--success);
      color: #fff;
      border-radius: 50px;
      font-size: .85rem;
      font-weight: 600;
      transition: opacity .15s;
    }
    .header__wa:hover { opacity: .85; color: #fff; }

    /* ── Container ────────────────────────────────────────── */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 16px;
    }

    /* ── Filters ─────────────────────────────────────────── */
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 20px;
      align-items: center;
    }
    .cat-btn {
      padding: 6px 16px;
      border: 1px solid var(--border);
      border-radius: 50px;
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: .8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all .15s;
      font-family: var(--font-sans);
    }
    .cat-btn:hover { border-color: var(--rose); color: var(--rose); }
    .cat-btn.active {
      background: var(--rose);
      color: #fff;
      border-color: var(--rose);
    }
    .search-input {
      flex: 1;
      min-width: 200px;
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 50px;
      background: var(--bg-card);
      color: var(--text);
      font-size: .85rem;
      font-family: var(--font-sans);
      outline: none;
      transition: border-color .15s;
    }
    .search-input:focus { border-color: var(--rose); }
    .search-input::placeholder { color: var(--text-muted); }

    /* ── Product grid ────────────────────────────────────── */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .product-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow);
      transition: box-shadow .2s, transform .2s;
      cursor: pointer;
    }
    .product-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
    }
    .product-card__img {
      width: 100%;
      height: 200px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .product-card__img img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .no-img {
      font-size: 2.8rem;
      font-weight: 700;
      color: var(--text-muted);
      opacity: .3;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .product-card__body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .product-card__name {
      font-size: .95rem;
      font-weight: 600;
      color: var(--text);
    }
    .product-card__price {
      font-family: var(--font-mono);
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--rose-dark);
    }
    .product-card__desc {
      font-size: .8rem;
      color: var(--text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .product-card__actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .btn-wa {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--success);
      color: #fff;
      border-radius: var(--radius);
      font-size: .8rem;
      font-weight: 600;
      font-family: var(--font-sans);
      transition: opacity .15s;
      text-decoration: none;
    }
    .btn-wa:hover { opacity: .85; color: #fff; }
    .btn-wa::before {
      content: '';
      width: 16px;
      height: 16px;
      background: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='white' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M17.6 6.3A8.7 8.7 0 0 0 12 4a8.8 8.8 0 0 0-7.6 13.2L3 21l3.9-1.3A8.8 8.8 0 0 0 12 20.6 8.8 8.8 0 0 0 17.6 6.3zM12 19a7 7 0 0 1-3.6-1l-.3-.1-2.7.9.9-2.6-.2-.3A7 7 0 1 1 19 12a7 7 0 0 1-7 7z'/%3E%3C/svg%3E") center/contain no-repeat;
      flex-shrink: 0;
    }
    .btn-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 12px;
      background: var(--bg-card);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: .8rem;
      font-weight: 500;
      font-family: var(--font-sans);
      transition: all .15s;
      text-decoration: none;
    }
    .btn-link:hover { border-color: var(--rose); color: var(--rose); }

    /* ── Modal / Preview ─────────────────────────────────── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
      opacity: 0;
      visibility: hidden;
      transition: opacity .25s, visibility .25s;
    }
    .modal-overlay.open {
      opacity: 1;
      visibility: visible;
    }
    .modal-content {
      background: var(--bg-card);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      transform: scale(.95) translateY(10px);
      transition: transform .25s;
    }
    .modal-overlay.open .modal-content {
      transform: scale(1) translateY(0);
    }
    .modal-img {
      width: 100%;
      height: 280px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .modal-img img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .modal-img .no-img {
      font-size: 4rem;
    }
    .modal-body {
      padding: 24px;
    }
    .modal-body h2 {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .modal-body .price {
      font-family: var(--font-mono);
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--rose-dark);
      margin-bottom: 12px;
    }
    .modal-body .desc {
      font-size: .9rem;
      color: var(--text-secondary);
      line-height: 1.6;
      margin-bottom: 8px;
    }
    .modal-body .category-tag {
      display: inline-block;
      padding: 3px 10px;
      background: var(--bg);
      border-radius: 50px;
      font-size: .75rem;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    .modal-body .btn-wa {
      width: 100%;
      padding: 12px;
      font-size: .95rem;
      margin-bottom: 8px;
    }
    .modal-body .btn-link {
      width: 100%;
      padding: 12px;
      font-size: .9rem;
    }
    .modal-close {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,.5);
      border: none;
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      transition: background .15s;
    }
    .modal-close:hover { background: rgba(0,0,0,.7); }

    .empty-msg {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
      grid-column: 1 / -1;
    }
    .empty-msg h3 { font-size: 1.1rem; margin-bottom: 4px; color: var(--text); }

    .footer {
      text-align: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: .8rem;
      border-top: 1px solid var(--border);
      margin-top: 32px;
    }

    @media (max-width: 600px) {
      .product-grid { grid-template-columns: 1fr; }
      .header { padding: 20px 16px; }
      .header__logo { font-size: 1.3rem; }
      .modal-img { height: 220px; }
    }
  </style>
</head>
<body>

  <header class="header">
    <div class="header__logo">DANI <span>MARVIS</span></div>
    <div class="header__sub">Catálogo de productos</div>
    <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" class="header__wa">
      Escríbenos por WhatsApp
    </a>
  </header>

  <div class="container">
    <div class="filters">
      <button class="cat-btn active" data-cat="all">Todos</button>
      ${categoryBtns}
      <input type="text" class="search-input" id="search" placeholder="Buscar producto..." />
    </div>

    <div class="product-grid" id="product-grid">
      ${productCards}
    </div>

    <div class="footer">
      DaniMarvis Store — Catálogo generado el ${generatedDate}
    </div>
  </div>

  <!-- Preview Modal -->
  <div class="modal-overlay" id="preview-modal">
    <div style="position:relative;width:100%;max-width:500px">
      <button class="modal-close" id="modal-close-btn">&times;</button>
      <div class="modal-content" id="modal-content"></div>
    </div>
  </div>

  <script>
    const products = ${productsJson};

    function escape(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function formatPrice(n) {
      return 'USD ' + Number(n).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    }

    function buildWaLink(name, price) {
      const text = 'Hola, me interesa *' + name + '*. Precio: ' + formatPrice(price) + '. ' + String.fromCharCode(191) + 'Est' + String.fromCharCode(225) + ' disponible?';
      return 'https://wa.me/${WHATSAPP_NUMBER}?text=' + encodeURIComponent(text);
    }

    function openPreview(idx) {
      const p = products[idx];
      if (!p) return;

      let imgHtml;
      if (p.image_local) {
        imgHtml = '<img src="' + escape(p.image_local) + '" alt="' + escape(p.name) + '" />';
      } else if (p.image_url) {
        imgHtml = '<div class="no-img"><svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>';
      } else {
        imgHtml = '<div class="no-img">' + escape(p.name.charAt(0).toUpperCase()) + '</div>';
      }

      const waLink = buildWaLink(p.name, p.price);

      document.getElementById('modal-content').innerHTML =
        '<div class="modal-img">' + imgHtml + '</div>' +
        '<div class="modal-body">' +
          '<h2>' + escape(p.name) + '</h2>' +
          '<div class="price">' + formatPrice(p.price) + '</div>' +
          (p.category ? '<span class="category-tag">' + escape(p.category) + '</span>' : '') +
          (p.description ? '<p class="desc">' + escape(p.description) + '</p>' : '') +
          '<a href="' + waLink + '" target="_blank" class="btn-wa">Consultar por WhatsApp</a>' +
        '</div>';

      document.getElementById('preview-modal').classList.add('open');
    }

    function closePreview() {
      document.getElementById('preview-modal').classList.remove('open');
    }

    document.addEventListener('DOMContentLoaded', () => {
      const grid = document.getElementById('product-grid');
      const search = document.getElementById('search');
      const catBtns = document.querySelectorAll('.cat-btn');
      const cards = Array.from(grid.querySelectorAll('.product-card'));

      // Card click → preview
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.product-card');
        if (!card) return;
        const idx = card.dataset.idx;
        if (idx !== undefined) openPreview(parseInt(idx));
      });

      // Modal close
      document.getElementById('modal-close-btn').addEventListener('click', closePreview);
      document.getElementById('preview-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePreview();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePreview();
      });

      // Filters
      let activeCat = 'all';
      let query = '';

      function filter() {
        cards.forEach(card => {
          const cat = card.dataset.category;
          const name = card.querySelector('.product-card__name')?.textContent?.toLowerCase() || '';
          const desc = card.querySelector('.product-card__desc')?.textContent?.toLowerCase() || '';
          const matchCat = activeCat === 'all' || cat === activeCat;
          const matchSearch = !query || name.includes(query) || desc.includes(query);
          card.style.display = matchCat && matchSearch ? '' : 'none';
        });
        const visible = cards.filter(c => c.style.display !== 'none').length;
        const empty = grid.querySelector('.empty-msg');
        if (visible === 0) {
          if (!empty) {
            const msg = document.createElement('div');
            msg.className = 'empty-msg';
            msg.innerHTML = '<h3>Sin resultados</h3><p>Intenta con otro t' + String.fromCharCode(233) + 'rmino o categor' + String.fromCharCode(237) + 'a.</p>';
            grid.appendChild(msg);
          }
        } else if (empty) {
          empty.remove();
        }
      }

      catBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          catBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeCat = btn.dataset.cat;
          filter();
        });
      });

      search.addEventListener('input', () => {
        query = search.value.toLowerCase().trim();
        filter();
      });
    });
  </script>

</body>
</html>`;
}

export function generateCatalogFile(products, outputDir, uploadsDir) {
  const html = buildCatalogHtml(products, uploadsDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'index.html'), html, 'utf-8');
  return html;
}


