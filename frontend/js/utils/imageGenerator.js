const CANVAS_SIZE = 1080;
const ROSE = '#c9847a';
const ROSE_DARK = '#a8645a';
const DARK = '#221815';
const WHITE = '#ffffff';
const BG = '#faf8f6';
const TEXT_MUTED = '#8a7e7a';

export async function generateProductImage(product) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_SIZE);
  grad.addColorStop(0, WHITE);
  grad.addColorStop(1, BG);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Subtle decorative border
  ctx.strokeStyle = ROSE;
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, CANVAS_SIZE - 40, CANVAS_SIZE - 40);

  // ── Logo ────────────────────────────────────────────────────
  drawLogo(ctx, 60, 50);

  // ── Product Image ───────────────────────────────────────────
  const imgAreaY = 150;
  const imgSize = 540;
  const imgX = (CANVAS_SIZE - imgSize) / 2;

  if (product.image_url) {
    try {
      const img = await loadImage(product.image_url);
      drawImageCropped(ctx, img, imgX, imgAreaY, imgSize, imgSize);
    } catch {
      drawImagePlaceholder(ctx, imgX, imgAreaY, imgSize, imgSize);
    }
  } else {
    drawImagePlaceholder(ctx, imgX, imgAreaY, imgSize, imgSize);
  }

  // ── Product Name ────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = 'bold 42px "Georgia", "Times New Roman", serif';
  const nameLines = wrapText(ctx, product.name, 900);
  let textY = imgAreaY + imgSize + 36;
  nameLines.forEach(line => {
    ctx.fillText(line, CANVAS_SIZE / 2, textY);
    textY += 52;
  });

  // ── Price ───────────────────────────────────────────────────
  textY += 12;
  ctx.fillStyle = ROSE_DARK;
  ctx.font = 'bold 58px "Georgia", serif';
  const priceText = formatPrice(product.price);
  ctx.fillText(priceText, CANVAS_SIZE / 2, textY);

  // ── Commission + Warranty bar ───────────────────────────────
  textY += 70;
  const barY = textY;
  const barW = 700;
  const barH = 52;
  const barX = (CANVAS_SIZE - barW) / 2;

  ctx.fillStyle = DARK;
  roundRect(ctx, barX, barY, barW, barH, 26);
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = 'bold 24px "Inter", "Arial", sans-serif';
  ctx.textAlign = 'center';

  const commText = product.commission_value > 0
    ? `Comisión: ${formatPrice(product.commission_value)}`
    : 'Sin comisión';
  ctx.fillText(commText, CANVAS_SIZE / 2 - 110, barY + 34);

  // Separator
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillRect(CANVAS_SIZE / 2 + 20, barY + 12, 1.5, barH - 24);

  const warrantyText = product.warranty ? `Garantía: ${product.warranty}` : 'Sin garantía';
  ctx.fillStyle = WHITE;
  ctx.fillText(warrantyText, CANVAS_SIZE / 2 + 150, barY + 34);

  // ── CTA ─────────────────────────────────────────────────────
  textY = barY + barH + 48;
  ctx.fillStyle = ROSE;
  ctx.font = '600 28px "Inter", "Arial", sans-serif';
  ctx.fillText('📲  Escríbeme y llévate este producto', CANVAS_SIZE / 2, textY);

  // WhatsApp button
  textY += 64;
  const btnW = 460;
  const btnH = 64;
  const btnX = (CANVAS_SIZE - btnW) / 2;
  ctx.fillStyle = '#25D366';
  roundRect(ctx, btnX, textY, btnW, btnH, 32);
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = 'bold 30px "Inter", "Arial", sans-serif';
  ctx.fillText('💬  Comprar por WhatsApp', CANVAS_SIZE / 2, textY + 41);

  // ── Footer brand ────────────────────────────────────────────
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '18px "Inter", "Arial", sans-serif';
  ctx.fillText('DaniMarvis Store — Tu gestor de confianza', CANVAS_SIZE / 2, CANVAS_SIZE - 44);

  return canvas;
}

function drawLogo(ctx, x, y) {
  const logoSize = 56;
  ctx.save();
  ctx.translate(x, y);

  // Bag icon
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.quadraticCurveTo(10, 8, logoSize / 2, 8);
  ctx.quadraticCurveTo(logoSize - 10, 8, logoSize - 10, 22);
  ctx.stroke();
  ctx.strokeRect(4, 22, logoSize - 8, logoSize - 22);

  // DM text
  ctx.fillStyle = DARK;
  ctx.font = 'bold 28px "Georgia", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('D', 14, 42);
  ctx.fillStyle = ROSE;
  ctx.fillText('M', 36, 42);

  // Heart
  ctx.fillStyle = ROSE;
  ctx.beginPath();
  ctx.moveTo(49, 38);
  ctx.quadraticCurveTo(49, 33, 46, 33);
  ctx.quadraticCurveTo(43.5, 33, 43, 35.5);
  ctx.quadraticCurveTo(42.5, 33, 40, 33);
  ctx.quadraticCurveTo(37, 33, 37, 38);
  ctx.quadraticCurveTo(37, 44, 46, 50);
  ctx.quadraticCurveTo(49, 44, 49, 38);
  ctx.fill();

  ctx.restore();

  // Brand text next to logo
  ctx.fillStyle = DARK;
  ctx.font = 'bold 28px "Georgia", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('DANI ', x + logoSize + 14, y + logoSize / 2);
  ctx.fillStyle = ROSE;
  ctx.fillText('MARVIS', x + logoSize + 90, y + logoSize / 2);
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '16px "Inter", "Arial", sans-serif';
  ctx.fillText('Store', x + logoSize + 178, y + logoSize / 2);
}

function drawImageCropped(ctx, img, x, y, size, radius) {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();

  // Border
  ctx.strokeStyle = 'rgba(0,0,0,.04)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, radius);
  ctx.stroke();
}

function drawImagePlaceholder(ctx, x, y, size, radius) {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();

  // Gradient background
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, '#f0edeb');
  grad.addColorStop(1, '#e5e0dc');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, size, size);

  // Icon
  ctx.fillStyle = '#c0b5b0';
  ctx.font = '80px "Inter", "Arial", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📷', x + size / 2, y + size / 2 - 10);

  ctx.fillStyle = '#9e918d';
  ctx.font = '20px "Inter", "Arial", sans-serif';
  ctx.fillText('Sin imagen', x + size / 2, y + size / 2 + 50);

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

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
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
  return lines.length ? lines : [text];
}

function formatPrice(price) {
  return '$' + Number(price).toLocaleString('es-CO');
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
