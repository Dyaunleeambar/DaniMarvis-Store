const CANVAS_SIZE = 1080;
const ROSE = '#c9847a';
const DARK = '#221815';
const WHITE = '#ffffff';
const BG = '#faf8f6';
const TEXT_MUTED = '#8a7e7a';
const WHATSAPP_GREEN = '#25D366';
const WHATSAPP_ICON_PATH = 'M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z';

export const TEMPLATES = [
  { id: 'clasica', name: 'Clásica', description: 'Degradado claro, logo, círculo y barra de información' },
  { id: 'moderna', name: 'Moderna', description: 'Fondo oscuro con acento de color' },
  { id: 'minimal', name: 'Minimal', description: 'Imagen grande y texto limpio' },
  { id: 'oferta', name: 'Oferta', description: 'Insignia OFERTA con precio destacado' },
  { id: 'postal', name: 'Postal DM', description: 'Estilo DaniMarvis Store con gradiente azul-naranja' },
];

export const ACCENT_COLORS = [
  { id: 'rose', name: 'Rosa', value: '#c9847a' },
  { id: 'red', name: 'Rojo', value: '#e63946' },
  { id: 'green', name: 'Verde', value: '#25d366' },
  { id: 'blue', name: 'Azul', value: '#1877f2' },
  { id: 'purple', name: 'Púrpura', value: '#6c5ce7' },
  { id: 'orange', name: 'Naranja', value: '#f39c12' },
];

export const DEFAULT_OPTIONS = {
  template: 'clasica',
  whatsappText: 'CONSÚLTANOS POR WHATSAPP',
  whatsappPhones: '+53 53760493 / +53 54115666',
  showLogo: true,
  accentColor: '#c9847a',
  backgroundImage: null,
};

function shadeColor(hex, percent) {
  let h = (hex || '#c9847a').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const amt = Math.round(2.55 * percent);
  r = Math.min(255, Math.max(0, r + amt));
  g = Math.min(255, Math.max(0, g + amt));
  b = Math.min(255, Math.max(0, b + amt));
  return `rgb(${r},${g},${b})`;
}

function metallicGradient(ctx, x0, y0, x1, y1, base) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, shadeColor(base, 42));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shadeColor(base, -28));
  return g;
}

function drawHeart(ctx, cx, cy, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.3, cx - s * 0.5, cy - s * 1.3, cx, cy - s * 0.45);
  ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.3, cx + s * 1.3, cy - s * 0.3, cx, cy + s * 0.9);
  ctx.closePath();
}

const TEMPLATE_DRAWERS = {
  clasica: { scheme: 'light', draw: drawClasica },
  moderna: { scheme: 'dark', draw: drawModerna },
  minimal: { scheme: 'light', draw: drawMinimal },
  oferta: { scheme: 'light', draw: drawOferta },
  postal: { scheme: 'dark', draw: drawPostal },
};

export async function generateProductImage(product, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  let bgImg = null;
  if (opts.backgroundImage) {
    if (opts.backgroundImage instanceof HTMLImageElement) {
      bgImg = opts.backgroundImage;
    } else if (typeof opts.backgroundImage === 'string') {
      try {
        bgImg = await loadImage(opts.backgroundImage);
      } catch { bgImg = null; }
    }
  }

  let productImg = null;
  const candidates = [];
  if (Array.isArray(product.images)) candidates.push(...product.images);
  if (product.image_url) candidates.push(product.image_url);
  for (const src of candidates) {
    if (!src) continue;
    try {
      productImg = await loadImage(src);
      if (productImg) break;
    } catch { /* probar siguiente */ }
  }

  const tpl = TEMPLATE_DRAWERS[opts.template] || TEMPLATE_DRAWERS.clasica;
  prepareCanvas(ctx, bgImg, tpl.scheme);
  await tpl.draw(ctx, product, opts, bgImg, productImg);

  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el archivo'))), type);
  });
}

export async function downloadCanvas(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text) {
  return String(text || 'imagen')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'imagen';
}

// ── Background ─────────────────────────────────────────────────

function prepareCanvas(ctx, bgImg, scheme) {
  if (!bgImg) return;
  drawCover(ctx, bgImg);
  const dark = scheme === 'dark';
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_SIZE);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.62, dark ? 'rgba(26,20,18,.4)' : 'rgba(250,248,246,.45)');
  grad.addColorStop(1, dark ? 'rgba(26,20,18,.88)' : 'rgba(250,248,246,.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

function drawCover(ctx, img) {
  const scale = Math.max(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (CANVAS_SIZE - w) / 2, (CANVAS_SIZE - h) / 2, w, h);
}

// ── Templates ──────────────────────────────────────────────────

function drawClasica(ctx, product, opts, bgImg, productImg) {
  const accent = opts.accentColor;

  if (!bgImg) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_SIZE);
    grad.addColorStop(0, WHITE);
    grad.addColorStop(1, BG);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, CANVAS_SIZE - 40, CANVAS_SIZE - 40);

  if (opts.showLogo) drawLogo(ctx, 60, 50);

  const imgAreaY = 160;
  const imgSize = 500;
  const imgX = (CANVAS_SIZE - imgSize) / 2;
  drawProductImage(ctx, product, productImg, imgX, imgAreaY, imgSize, Math.min(imgSize / 2, 60));

  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = 'bold 42px "Georgia", "Times New Roman", serif';
  const nameLines = wrapText(ctx, product.name, 900);
  let y = imgAreaY + imgSize + 32;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    y += 52;
  });

  y += 10;
  ctx.fillStyle = accent;
  ctx.font = 'bold 58px "Georgia", serif';
  ctx.fillText(formatPrice(product.price), CANVAS_SIZE / 2, y);

  y += 66;
  const barW = 700;
  const barH = 52;
  const barX = (CANVAS_SIZE - barW) / 2;
  ctx.fillStyle = DARK;
  roundRect(ctx, barX, y, barW, barH, 26);
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = 'bold 24px "Inter", "Arial", sans-serif';
  const commText = product.commission_value > 0
    ? `Comisión: ${formatPrice(product.commission_value)}`
    : 'Sin comisión';
  ctx.fillText(commText, CANVAS_SIZE / 2 - 110, y + 34);

  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillRect(CANVAS_SIZE / 2 + 20, y + 12, 1.5, barH - 24);

  ctx.fillStyle = WHITE;
  const warrantyText = product.warranty ? `Garantía: ${product.warranty}` : 'Sin garantía';
  ctx.fillText(warrantyText, CANVAS_SIZE / 2 + 150, y + 34);

  y = y + barH + 22;
  drawWhatsappCta(ctx, opts, CANVAS_SIZE / 2, y);

  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '18px "Inter", "Arial", sans-serif';
  ctx.fillText('DaniMarvis Store — Tu gestor de confianza', CANVAS_SIZE / 2, CANVAS_SIZE - 24);
}

function drawModerna(ctx, product, opts, bgImg, productImg) {
  const accent = opts.accentColor;

  if (!bgImg) {
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, CANVAS_SIZE, 18);
  }

  if (opts.showLogo) drawLogo(ctx, 60, 46, { color: WHITE, accent, muted: '#b9adaa' });

  const imgAreaY = 150;
  const imgSize = 600;
  const imgX = (CANVAS_SIZE - imgSize) / 2;
  drawProductImage(ctx, product, productImg, imgX, imgAreaY, imgSize, 36);

  ctx.textAlign = 'center';
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 40px "Inter", "Arial", sans-serif';
  const nameLines = wrapText(ctx, product.name, 880);
  let y = imgAreaY + imgSize + 40;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    y += 48;
  });

  y += 14;
  ctx.fillStyle = accent;
  ctx.font = 'bold 72px "Inter", "Arial", sans-serif';
  ctx.fillText(formatPrice(product.price), CANVAS_SIZE / 2, y);

  y += 40;
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CANVAS_SIZE / 2 - 160, y);
  ctx.lineTo(CANVAS_SIZE / 2 + 160, y);
  ctx.stroke();

  y += 20;
  drawWhatsappCta(ctx, opts, CANVAS_SIZE / 2, y);

  ctx.fillStyle = '#b9adaa';
  ctx.font = '18px "Inter", "Arial", sans-serif';
  ctx.fillText('DaniMarvis Store — Tu gestor de confianza', CANVAS_SIZE / 2, CANVAS_SIZE - 24);
}

function drawMinimal(ctx, product, opts, bgImg, productImg) {
  const accent = opts.accentColor;

  if (!bgImg) {
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  const hasLogo = opts.showLogo;
  const imgY = hasLogo ? 190 : 60;
  const imgW = 940;
  const imgH = 520;
  const imgX = (CANVAS_SIZE - imgW) / 2;

  if (hasLogo) drawLogo(ctx, 60, 46);
  drawProductImage(ctx, product, productImg, imgX, imgY, imgW, imgH, 20);

  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = 'bold 44px "Inter", "Arial", sans-serif';
  const nameLines = wrapText(ctx, product.name, 900);
  let y = imgY + imgH + 40;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    y += 54;
  });

  y += 12;
  ctx.fillStyle = accent;
  ctx.font = 'bold 62px "Inter", "Arial", sans-serif';
  ctx.fillText(formatPrice(product.price), CANVAS_SIZE / 2, y);

  y += 42;
  drawWhatsappCta(ctx, opts, CANVAS_SIZE / 2, y);

  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '16px "Inter", "Arial", sans-serif';
  ctx.fillText('DaniMarvis Store', CANVAS_SIZE / 2, CANVAS_SIZE - 36);
}

function drawOferta(ctx, product, opts, bgImg, productImg) {
  const accent = opts.accentColor;

  if (!bgImg) {
    const grad = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    grad.addColorStop(0, WHITE);
    grad.addColorStop(1, hexToRgba(accent, 0.18));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  ctx.fillStyle = accent;
  roundRect(ctx, 770, 56, 250, 82, 16);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px "Inter", "Arial", sans-serif';
  ctx.fillText('OFERTA', 895, 98);
  ctx.textBaseline = 'alphabetic';

  if (opts.showLogo) drawLogo(ctx, 60, 50);

  const imgSize = 520;
  const imgX = (CANVAS_SIZE - imgSize) / 2;
  drawProductImage(ctx, product, productImg, imgX, 170, imgSize, Math.min(imgSize / 2, 60));

  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = 'bold 42px "Georgia", "Times New Roman", serif';
  const nameLines = wrapText(ctx, product.name, 900);
  let y = 170 + imgSize + 34;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    y += 52;
  });

  y += 12;
  ctx.fillStyle = accent;
  ctx.font = 'bold 68px "Inter", "Arial", sans-serif';
  ctx.fillText(formatPrice(product.price), CANVAS_SIZE / 2, y);

  y += 42;
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '26px "Inter", "Arial", sans-serif';
  ctx.fillText('Precio especial por tiempo limitado', CANVAS_SIZE / 2, y);

  y += 62;
  drawWhatsappCta(ctx, opts, CANVAS_SIZE / 2, y);

  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '18px "Inter", "Arial", sans-serif';
  ctx.fillText('DaniMarvis Store — Tu gestor de confianza', CANVAS_SIZE / 2, CANVAS_SIZE - 44);
}

function drawPostal(ctx, product, opts, bgImg, productImg) {
  const NAVY = '#0d2b4e';
  const YELLOW = '#f5c518';

  if (!bgImg) {
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  const slogan = extractSloganText(product);

  // ── Header ──────────────────────────────────────────────────
  const headerH = 96;
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(0, 0, CANVAS_SIZE, headerH);
  if (opts.showLogo) {
    drawLogo(ctx, 60, (headerH - 56) / 2, { color: WHITE, accent: YELLOW, muted: 'rgba(255,255,255,.5)' });
  }

  // ── Título + eslogan ────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.fillStyle = WHITE;
  ctx.font = '900 52px "Arial Black", "Helvetica Neue", "Arial", sans-serif';
  const nameUpper = (product.name || '').trim().toUpperCase();
  const nameLines = wrapText(ctx, nameUpper, 860);
  let y = headerH + 74;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, y);
    y += 60;
  });

  if (slogan) {
    y += 4;
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = 'italic 30px "Georgia", "Times New Roman", serif';
    ctx.fillText(slogan, CANVAS_SIZE / 2, y);
    y += 30;
  } else {
    y += 24;
  }

  // ── Sistema de radios 1:3 ─────────────────────────────────────
  // grande = hombros diagonales del amarillo · contenido = esquinas del blanco
  const RADIUS_BIG = Math.round(CANVAS_SIZE * 0.075);   // ≈81px (7.5% del lienzo)
  const RADIUS_SMALL = Math.round(RADIUS_BIG / 3);      // ≈27px

  // ── Módulo de precio (blanco): se mide primero — su ancho y su
  //    borde derecho definen dónde "aterriza" sobre el amarillo ──
  const priceMain = formatPrice(product.price);
  const priceUnit = 'USD';
  ctx.font = '900 62px "Arial Black", "Helvetica Neue", "Arial", sans-serif';
  const mainW = ctx.measureText(priceMain).width;
  ctx.font = '700 26px "Arial", "Helvetica Neue", sans-serif';
  const unitW = ctx.measureText(priceUnit).width;
  const gapPU = 12;
  const padX = 42;
  const contentW = mainW + gapPU + unitW;
  const priceW = Math.max(280, contentW + padX * 2);
  const priceH = 130;

  // Panel más cuadrado: ancho reducido y centrado (antes ocupaba
  // todo el ancho del lienzo y quedaba muy apaisado)
  const zoneW = Math.round(CANVAS_SIZE * 0.7);
  const zoneX = Math.round((CANVAS_SIZE - zoneW) / 2);

  // Bordes derechos alineados sobre la misma vertical (arista continua)
  const priceX = zoneX + zoneW - priceW;
  const priceY = y + 16;
  // Costura: el blanco aterriza de lleno sobre el borde superior del amarillo
  const zoneY = priceY + priceH;

  const footerRowY = CANVAS_SIZE - 164;
  const zoneBottom = footerRowY - 34;
  const zoneH = Math.max(300, zoneBottom - zoneY);

  // ── Panel amarillo: hombros grandes en diagonal (arriba-izq / abajo-der),
  //    esquinas rectas gemelas (abajo-izq / arriba-der, esta última se
  //    disuelve bajo el módulo blanco) ──
  ctx.fillStyle = YELLOW;
  roundRectCorners(ctx, zoneX, zoneY, zoneW, zoneH, {
    tl: RADIUS_BIG, tr: 0, br: RADIUS_BIG, bl: 0,
  });
  ctx.fill();

  // Foto del producto: ~4.5% de aire interior, el conjunto respira
  // apoyado sobre la zona baja del panel (más aire arriba que abajo)
  const imgPad = Math.round(CANVAS_SIZE * 0.045);
  const imgPadTop = Math.round(imgPad * 1.7);
  const imgX = zoneX + imgPad;
  const imgW = zoneW - imgPad * 2;
  const imgY = zoneY + imgPadTop;
  const imgH = Math.max(140, zoneH - imgPadTop - imgPad);
  drawProductImage(ctx, product, productImg, imgX, imgY, imgW, imgH, RADIUS_SMALL);

  // ── Módulo de precio: costura escalonada con el amarillo ──────
  // abajo-izq recta (aterriza sobre el borde del amarillo) · abajo-der
  // con radio contenido (recibe la esquina recta del amarillo)
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = WHITE;
  roundRectCorners(ctx, priceX, priceY, priceW, priceH, {
    tl: RADIUS_SMALL, tr: RADIUS_SMALL, br: RADIUS_SMALL, bl: 0,
  });
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.textAlign = 'left';
  const groupStartX = priceX + (priceW - contentW) / 2;
  const priceBaselineY = priceY + priceH / 2 + 22;
  ctx.fillStyle = NAVY;
  ctx.font = '900 62px "Arial Black", "Helvetica Neue", "Arial", sans-serif';
  ctx.fillText(priceMain, groupStartX, priceBaselineY);
  ctx.fillStyle = '#5c7a99';
  ctx.font = '700 26px "Arial", "Helvetica Neue", sans-serif';
  ctx.fillText(priceUnit, groupStartX + mainW + gapPU, priceBaselineY - 3);

  // ── Pie (posición fija, ya no depende del largo del título) ──
  if (product.warranty) {
    ctx.font = 'bold 17px "Arial", "Helvetica Neue", sans-serif';
    const warrantyText = `GARANTÍA ${product.warranty}`;
    const warrantyTextW = ctx.measureText(warrantyText).width;
    const badgeW = Math.max(160, warrantyTextW + 48);
    const badgeH = 52;
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    roundRect(ctx, 60, footerRowY, badgeW, badgeH, 12);
    ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'center';
    ctx.fillText(warrantyText, 60 + badgeW / 2, footerRowY + 33);
  }

  ctx.fillStyle = YELLOW;
  ctx.font = '34px "Arial", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('🚚', CANVAS_SIZE - 60, footerRowY + 36);
  ctx.fillStyle = WHITE;
  ctx.font = 'italic bold 30px "Georgia", "Times New Roman", serif';
  ctx.textAlign = 'right';
  ctx.fillText('Envío Gratis', CANVAS_SIZE - 105, footerRowY + 36);

  drawWhatsappCta(ctx, opts, CANVAS_SIZE / 2, footerRowY + 70);
}

function isSloganCode(slogan) {
  if (/^(modelo|ref|referencia|serie)\b/i.test(slogan)) return true;
  if (/^[A-Z0-9][A-Z0-9\-.‑]*(?:\s*\/\s*[A-Z0-9][A-Z0-9\-.‑]*)*\s*$/i.test(slogan)) return true;
  if (/^\d+(\.\d+)?\s*(kg|kgs|l|litros|litro|w|wh|mAh|pies|pulg|cm|mm|lt)\b/i.test(slogan)) return true;
  if (/\(\s*[A-Z0-9]{2,}\s*\)/.test(slogan)) return true;
  if (/^\s*\w+\s*$/.test(slogan)) return true;
  return false;
}

function extractSloganText(product) {
  const name = (product.name || '').trim();
  const desc = (product.description || '').trim();
  if (!desc) return '';
  const lowerName = name.toLowerCase();
  const lowerDesc = desc.toLowerCase();
  const nameIdx = lowerName ? lowerDesc.indexOf(lowerName) : -1;

  let candidate = '';
  if (nameIdx !== -1) {
    candidate = desc.slice(nameIdx + name.length);
  } else {
    const firstLine = desc.split('\n')[0].trim();
    const dashIdx = firstLine.search(/[–—-]/);
    if (dashIdx !== -1) candidate = firstLine.slice(dashIdx);
  }

  const match = candidate.match(/^\s*[–—-]\s*([^\n.]+)/);
  if (!match) return '';
  const slogan = match[1].trim().replace(/\*\*$/g, '');
  if (!slogan || /^[💥✨‼️⭐🎁]/u.test(slogan)) return '';
  if (isSloganCode(slogan)) return '';
  return slogan;
}

// ── Shared drawing helpers ─────────────────────────────────────

function drawWhatsappCta(ctx, opts, cx, y) {
  const text = opts.whatsappText || 'CONSÚLTANOS POR WHATSAPP';
  const phones = opts.whatsappPhones || '';
  const btnH = 88;
  const iconSize = 42;
  const padX = 28;
  const gapIcon = 14;

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.font = '900 22px "Arial", "Helvetica Neue", sans-serif';
  const textW = ctx.measureText(text).width;
  ctx.font = '600 15px "Arial", sans-serif';
  const phonesW = phones ? ctx.measureText(phones).width : 0;

  const contentW = iconSize + gapIcon + Math.max(textW, phonesW);
  const btnW = contentW + padX * 2;
  const btnX = cx - btnW / 2;

  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = WHATSAPP_GREEN;
  roundRect(ctx, btnX, y, btnW, btnH, btnH / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const iconX = btnX + padX;
  const iconY = y + (btnH - iconSize) / 2;
  ctx.save();
  ctx.translate(iconX, iconY);
  ctx.scale(iconSize / 448, iconSize / 512);
  ctx.fillStyle = '#ffffff';
  traceSvgPath(ctx, WHATSAPP_ICON_PATH);
  ctx.fill();
  ctx.restore();

  const textX = iconX + iconSize + gapIcon;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 22px "Arial", "Helvetica Neue", sans-serif';
  ctx.fillText(text, textX, y + btnH * 0.36);
  if (phones) {
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '600 15px "Arial", sans-serif';
    ctx.fillText(phones, textX, y + btnH * 0.72);
  }

  ctx.restore();
}

function traceSvgPath(ctx, path) {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  let i = 0;
  let x = 0;
  let y = 0;
  let px = 0;
  let py = 0;
  let cmd = '';

  function num() { return parseFloat(tokens[i++]); }

  ctx.beginPath();
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; }
    switch (cmd) {
      case 'M': x = num(); y = num(); ctx.moveTo(x, y); px = x; py = y; break;
      case 'm': x += num(); y += num(); ctx.moveTo(x, y); px = x; py = y; break;
      case 'L': x = num(); y = num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'l': x += num(); y += num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'H': x = num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'h': x += num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'V': y = num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'v': y += num(); ctx.lineTo(x, y); px = x; py = y; break;
      case 'C': {
        const c1x = num(); const c1y = num(); const c2x = num(); const c2y = num(); const ex = num(); const ey = num();
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        px = c2x; py = c2y; x = ex; y = ey; break;
      }
      case 'c': {
        const c1x = x + num(); const c1y = y + num(); const c2x = x + num(); const c2y = y + num(); const ex = x + num(); const ey = y + num();
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        px = c2x; py = c2y; x = ex; y = ey; break;
      }
      case 'S': {
        const c1x = 2 * x - px; const c1y = 2 * y - py; const c2x = num(); const c2y = num(); const ex = num(); const ey = num();
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        px = c2x; py = c2y; x = ex; y = ey; break;
      }
      case 's': {
        const c1x = 2 * x - px; const c1y = 2 * y - py; const c2x = x + num(); const c2y = y + num(); const ex = x + num(); const ey = y + num();
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        px = c2x; py = c2y; x = ex; y = ey; break;
      }
      case 'Q': {
        const c1x = num(); const c1y = num(); const ex = num(); const ey = num();
        ctx.quadraticCurveTo(c1x, c1y, ex, ey);
        px = c1x; py = c1y; x = ex; y = ey; break;
      }
      case 'q': {
        const c1x = x + num(); const c1y = y + num(); const ex = x + num(); const ey = y + num();
        ctx.quadraticCurveTo(c1x, c1y, ex, ey);
        px = c1x; py = c1y; x = ex; y = ey; break;
      }
      case 'Z':
      case 'z': ctx.closePath(); break;
    }
  }
}

function drawLogo(ctx, x, y, { color = DARK, accent = ROSE, muted = TEXT_MUTED } = {}) {
  const logoSize = 56;
  ctx.save();
  ctx.translate(x, y);

  const metalGrad = metallicGradient(ctx, 0, 0, logoSize, logoSize, accent);

  // Asa arqueada
  ctx.strokeStyle = metalGrad;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(13, 25);
  ctx.quadraticCurveTo(13, 6, logoSize / 2, 6);
  ctx.quadraticCurveTo(logoSize - 13, 6, logoSize - 13, 25);
  ctx.stroke();

  // Cuerpo de la bolsa: fondo oscuro + borde metálico
  const bagX = 2, bagY = 24, bagW = logoSize - 4, bagH = logoSize - 24;
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  roundRect(ctx, bagX, bagY, bagW, bagH, 5);
  ctx.fill();
  ctx.strokeStyle = metalGrad;
  ctx.lineWidth = 3;
  roundRect(ctx, bagX, bagY, bagW, bagH, 5);
  ctx.stroke();

  // Letras D / M — grandes, llenando el cuerpo de la bolsa
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 30px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText('D', bagX + bagW * 0.3, bagY + bagH / 2 + 1);
  ctx.fillStyle = metalGrad;
  ctx.fillText('M', bagX + bagW * 0.7, bagY + bagH / 2 + 1);

  // Corazón — cuelga de la esquina inferior derecha, como un dije
  const heartCx = bagX + bagW - 3;
  const heartCy = bagY + bagH + 1;
  ctx.fillStyle = metallicGradient(ctx, heartCx - 10, heartCy - 10, heartCx + 10, heartCy + 10, accent);
  drawHeart(ctx, heartCx, heartCy, 20);
  ctx.fill();

  ctx.restore();

  // Wordmark — anchos medidos dinámicamente para que MARVIS/Store no se encimen
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px "Georgia", serif';
  const daniText = 'DANI ';
  const marvisText = 'MARVIS';
  const daniW = ctx.measureText(daniText).width;
  ctx.fillStyle = color;
  ctx.fillText(daniText, x + logoSize + 14, y + logoSize / 2);
  const marvisX = x + logoSize + 14 + daniW;
  ctx.fillStyle = accent;
  ctx.fillText(marvisText, marvisX, y + logoSize / 2);
  const marvisW = ctx.measureText(marvisText).width;
  ctx.fillStyle = muted;
  ctx.font = '16px "Inter", "Arial", sans-serif';
  ctx.fillText('Store', marvisX + marvisW + 8, y + logoSize / 2);
}

function drawProductImage(ctx, product, img, x, y, w, h, radius) {
  if (img) {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    coverIntoRect(ctx, img, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.05)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();
  } else {
    drawImagePlaceholder(ctx, x, y, w, h, radius);
  }
}

function coverIntoRect(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function drawImagePlaceholder(ctx, x, y, w, h, radius) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();

  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#f0edeb');
  grad.addColorStop(1, '#e5e0dc');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = '#c0b5b0';
  ctx.font = '80px "Inter", "Arial", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📷', x + w / 2, y + h / 2 - 10);

  ctx.fillStyle = '#9e918d';
  ctx.font = '20px "Inter", "Arial", sans-serif';
  ctx.fillText('Sin imagen', x + w / 2, y + h / 2 + 50);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectCorners(ctx, x, y, w, h, r) {
  const tl = r.tl || 0, tr = r.tr || 0, br = r.br || 0, bl = r.bl || 0;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.quadraticCurveTo(x, y, x + tl, y);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || 'Producto').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text || 'Producto'];
}

function formatPrice(price) {
  return '$' + Number(price || 0).toLocaleString('es-CO');
}

function hexToRgba(hex, alpha = 1) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(201,132,122,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
