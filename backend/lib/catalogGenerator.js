import { formatCurrency } from './currency.js';
import { ensureWebp } from './imageUtils.js';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

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

export async function buildCatalogHtml(products, uploadsDir) {
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

  if (uploadsDir && existsSync(uploadsDir)) {
    const files = readdirSync(uploadsDir);
    const destDir = join(uploadsDir, '..', '..', 'public-catalog', 'images');
    mkdirSync(destDir, { recursive: true });

    for (const p of products) {
      const images = parseImages(p);
      for (const url of images) {
        if (isLocalImage(url)) {
          const filename = url.replace('/uploads/', '');
          if (files.includes(filename)) {
            const src = join(uploadsDir, filename);
            const dest = join(destDir, filename);
            if (existsSync(src) && !existsSync(dest)) {
              copyFileSync(src, dest);
            }
            if (!p._localImage) {
              // Convert first image to WebP
              const webpDest = await ensureWebp(dest);
              if (webpDest && webpDest !== dest) {
                p._localImage = `images/${basename(webpDest)}`;
              } else {
                p._localImage = `images/${filename}`;
              }
            }
          }
        }
      }
      if (!p._localImage && images.length > 0) {
        p._localImage = images[0];
      }
    }
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
        <div class="product-card__img">${imgHtml}<span class="product-card__cat">${escapeHtml(p.category || '')}</span></div>
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
      --rose-glow: rgba(201,132,122,.18);
      --dark: #221815;
      --dark-2: #2d2220;
      --bg: #f5f3f0;
      --bg-card: #ffffff;
      --bg-card-alt: #faf8f6;
      --border: #e5e0dc;
      --text: #1a1412;
      --text-secondary: #6b5e5a;
      --text-muted: #9e918d;
      --success: #25D366;
      --success-dark: #1da851;
      --radius: 14px;
      --radius-sm: 8px;
      --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
      --shadow-md: 0 6px 16px rgba(34,24,21,.08);
      --shadow-lg: 0 12px 32px rgba(34,24,21,.14);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-serif: 'Georgia', 'Times New Roman', serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #17110f;
        --bg-card: #241c19;
        --bg-card-alt: #2a201d;
        --border: #3a2d2a;
        --text: #f0edeb;
        --text-secondary: #c0b5b0;
        --text-muted: #8a7e7a;
        --rose-glow: rgba(201,132,122,.14);
        --shadow: 0 1px 3px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.28);
        --shadow-md: 0 6px 18px rgba(0,0,0,.35);
        --shadow-lg: 0 16px 36px rgba(0,0,0,.5);
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
      position: relative;
      background:
        radial-gradient(circle at 15% 20%, rgba(201,132,122,.35), transparent 45%),
        radial-gradient(circle at 85% 80%, rgba(201,132,122,.2), transparent 50%),
        linear-gradient(160deg, var(--dark) 0%, var(--dark-2) 100%);
      color: #fff;
      padding: 40px 20px 34px;
      text-align: center;
      overflow: hidden;
    }
    .header::after {
      content: '';
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(201,132,122,.5), transparent);
    }
    .header__inner { position: relative; z-index: 1; }
    .header__logo {
      font-family: var(--font-serif);
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: .01em;
    }
    .header__logo span { color: var(--rose-light); }
    .header__sub {
      font-size: .82rem;
      color: rgba(255,255,255,.55);
      margin-top: 6px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .header__wa {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 18px;
      padding: 10px 22px;
      background: var(--success);
      color: #fff;
      border-radius: 50px;
      font-size: .85rem;
      font-weight: 600;
      box-shadow: 0 6px 18px rgba(37,211,102,.3);
      transition: transform .15s, box-shadow .15s;
    }
    .header__wa:hover {
      color: #fff;
      transform: translateY(-1px);
      box-shadow: 0 8px 22px rgba(37,211,102,.4);
    }

    /* ── Container ────────────────────────────────────────── */
    .container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }

    /* ── Results bar ─────────────────────────────────────── */
    .results-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 4px 0 16px;
      font-size: .78rem;
      color: var(--text-muted);
    }
    .results-bar strong { color: var(--text-secondary); font-weight: 600; }

    /* ── Filters ─────────────────────────────────────────── */
    .filters-sticky {
      position: sticky;
      top: 0;
      z-index: 40;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      margin: 0 -18px;
      padding: 14px 18px 12px;
      border-bottom: 1px solid var(--border);
    }
    .search-input {
      width: 100%;
      padding: 10px 16px;
      border: 1px solid var(--border);
      border-radius: 50px;
      background: var(--bg-card);
      color: var(--text);
      font-size: .88rem;
      font-family: var(--font-sans);
      outline: none;
      transition: border-color .15s, box-shadow .15s;
      margin-bottom: 10px;
    }
    .search-input:focus {
      border-color: var(--rose);
      box-shadow: 0 0 0 3px var(--rose-glow);
    }
    .search-input::placeholder { color: var(--text-muted); }

    .filters {
      display: flex;
      gap: 8px;
      align-items: center;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding: 2px 0;
      mask-image: linear-gradient(90deg, transparent, #000 16px, #000 calc(100% - 16px), transparent);
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 16px, #000 calc(100% - 16px), transparent);
    }
    .filters::-webkit-scrollbar { display: none; }
    .cat-btn {
      flex-shrink: 0;
      padding: 7px 16px;
      border: 1px solid var(--border);
      border-radius: 50px;
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: .78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all .15s;
      font-family: var(--font-sans);
      text-transform: capitalize;
      white-space: nowrap;
    }
    .cat-btn:hover { border-color: var(--rose); color: var(--rose); }
    .cat-btn.active {
      background: var(--rose);
      color: #fff;
      border-color: var(--rose);
      box-shadow: 0 4px 12px var(--rose-glow);
    }

    /* ── Product grid ────────────────────────────────────── */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 18px;
    }
    .product-card {
      position: relative;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow);
      transition: box-shadow .25s ease, transform .25s ease, border-color .25s ease;
      cursor: pointer;
      display: flex;
      flex-direction: column;
    }
    .product-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-3px);
      border-color: var(--rose-light);
    }
    .product-card__img {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      background: var(--bg-card-alt);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .product-card__img img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform .4s ease;
    }
    .product-card:hover .product-card__img img { transform: scale(1.06); }
    .product-card__cat {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 3px 10px;
      background: rgba(26,20,18,.62);
      backdrop-filter: blur(4px);
      color: #fff;
      font-size: .65rem;
      font-weight: 600;
      letter-spacing: .03em;
      text-transform: capitalize;
      border-radius: 50px;
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
      padding: 14px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      flex: 1;
    }
    .product-card__name {
      font-size: .92rem;
      font-weight: 600;
      color: var(--text);
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: calc(1.35em * 2);
    }
    .product-card__price {
      font-family: var(--font-mono);
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--rose-dark);
      margin-top: 2px;
    }
    .product-card__desc {
      font-size: .78rem;
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
      margin-top: auto;
      padding-top: 10px;
    }
    .btn-wa {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 9px 12px;
      background: var(--success);
      color: #fff;
      border-radius: var(--radius-sm);
      font-size: .8rem;
      font-weight: 600;
      font-family: var(--font-sans);
      transition: background .15s, transform .15s;
      text-decoration: none;
    }
    .btn-wa:hover { background: var(--success-dark); color: #fff; transform: translateY(-1px); }
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
      padding: 70px 20px;
      color: var(--text-secondary);
      grid-column: 1 / -1;
    }
    .empty-msg .empty-icon {
      width: 56px; height: 56px;
      margin: 0 auto 14px;
      border-radius: 50%;
      background: var(--bg-card-alt);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
    .empty-msg h3 { font-size: 1.1rem; margin-bottom: 4px; color: var(--text); }

    .footer {
      text-align: center;
      padding: 36px 24px 28px;
      color: var(--text-muted);
      font-size: .78rem;
      border-top: 1px solid var(--border);
      margin-top: 40px;
    }
    .footer__brand {
      font-family: var(--font-serif);
      font-size: 1rem;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .footer__brand span { color: var(--rose); }

    .back-to-top {
      position: fixed;
      right: 18px;
      bottom: 18px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--dark);
      color: #fff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-lg);
      cursor: pointer;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: opacity .2s, transform .2s, visibility .2s;
      z-index: 50;
    }
    .back-to-top.show { opacity: 1; visibility: visible; transform: translateY(0); }

    @media (max-width: 600px) {
      .product-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
      .product-card__body { padding: 10px 12px 12px; }
      .product-card__name { font-size: .82rem; }
      .product-card__price { font-size: 1rem; }
      .product-card__desc { display: none; }
      .header { padding: 30px 16px 26px; }
      .header__logo { font-size: 1.5rem; }
      .modal-img { height: 220px; }
      .container { padding: 20px 12px 32px; }
      .filters-sticky { margin: 0 -12px; padding: 12px 12px 10px; }
    }
  </style>
</head>
<body>

  <header class="header">
    <div class="header__inner">
      <div class="header__logo">DANI <span>MARVIS</span> <small style="font-family:var(--font-sans);font-size:.5rem;font-weight:400;letter-spacing:.08em;opacity:.55;vertical-align:middle">Store</small></div>
      <div class="header__sub">Catálogo de productos</div>
      <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" class="header__wa">
        Escríbenos por WhatsApp
      </a>
    </div>
  </header>

  <div class="container">
    <div class="filters-sticky">
    <input type="text" class="search-input" id="search" placeholder="Buscar producto..." />
    <div class="filters">
      <button class="cat-btn active" data-cat="all">Todos</button>
      ${categoryBtns}
    </div>
    </div>

    <div class="results-bar">
      <span id="results-count"></span>
    </div>

    <div class="product-grid" id="product-grid">
      ${productCards}
    </div>

    <div class="footer">
      <div class="footer__brand">DANI <span>MARVIS</span> Store</div>
      Catálogo generado el ${generatedDate}
    </div>
  </div>

  <button class="back-to-top" id="back-to-top" aria-label="Volver arriba">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
  </button>

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
      const resultsCount = document.getElementById('results-count');
      const total = cards.length;

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
            msg.innerHTML = '<div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><h3>Sin resultados</h3><p>Intenta con otro t' + String.fromCharCode(233) + 'rmino o categor' + String.fromCharCode(237) + 'a.</p>';
            grid.appendChild(msg);
          }
        } else if (empty) {
          empty.remove();
        }
        resultsCount.textContent = visible === total
          ? total + ' producto' + (total === 1 ? '' : 's') + ' disponibles'
          : 'Mostrando ' + visible + ' de ' + total + ' productos';
      }
      filter();

      catBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          catBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeCat = btn.dataset.cat;
          btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          filter();
        });
      });

      search.addEventListener('input', () => {
        query = search.value.toLowerCase().trim();
        filter();
      });

      // Back to top
      const backToTop = document.getElementById('back-to-top');
      window.addEventListener('scroll', () => {
        backToTop.classList.toggle('show', window.scrollY > 600);
      }, { passive: true });
      backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  </script>

</body>
</html>`;
}

export async function generateCatalogFile(products, outputDir, uploadsDir) {
  const html = await buildCatalogHtml(products, uploadsDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'index.html'), html, 'utf-8');
  return html;
}
