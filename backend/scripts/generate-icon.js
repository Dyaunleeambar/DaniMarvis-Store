import { createCanvas, loadImage, registerFont } from 'canvas';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SIZE = 256;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');
const R = 40;

// ── Background rounded rect ──
function roundRect(x, y, w, h, r) {
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

// ── Gradient background ──
const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
grad.addColorStop(0, '#0f2b5e');
grad.addColorStop(0.5, '#1a5ba0');
grad.addColorStop(1, '#0f2b5e');
roundRect(0, 0, SIZE, SIZE, R);
ctx.fillStyle = grad;
ctx.fill();

// ── Inner border glow ──
roundRect(3, 3, SIZE - 6, SIZE - 6, R - 3);
ctx.strokeStyle = 'rgba(255,255,255,0.12)';
ctx.lineWidth = 2;
ctx.stroke();

// ── Washing machine icon ──
ctx.save();
const cx = SIZE / 2;
const machineTop = 50;
const machineH = 80;
const machineW = 70;

// Machine body
ctx.beginPath();
ctx.roundRect(cx - machineW / 2, machineTop, machineW, machineH, 8);
ctx.fillStyle = 'rgba(255,255,255,0.2)';
ctx.fill();
ctx.strokeStyle = 'rgba(255,255,255,0.7)';
ctx.lineWidth = 2.5;
ctx.stroke();

// Door circle
ctx.beginPath();
ctx.arc(cx, machineTop + machineH / 2, 22, 0, Math.PI * 2);
ctx.strokeStyle = 'rgba(255,255,255,0.7)';
ctx.lineWidth = 2.5;
ctx.stroke();

// Door inner highlight
ctx.beginPath();
ctx.arc(cx, machineTop + machineH / 2, 16, 0, Math.PI * 2);
ctx.strokeStyle = 'rgba(255,255,255,0.35)';
ctx.lineWidth = 1.5;
ctx.stroke();

// Control panel dots
for (let i = 0; i < 3; i++) {
  ctx.beginPath();
  ctx.arc(cx - 16 + i * 16, machineTop + 12, 3, 0, Math.PI * 2);
  ctx.fillStyle = i === 2 ? '#4fc3f7' : 'rgba(255,255,255,0.5)';
  ctx.fill();
}
ctx.restore();

// ── "DM" text ──
ctx.save();
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';

// Shadow
ctx.shadowColor = 'rgba(0,0,0,0.3)';
ctx.shadowBlur = 6;
ctx.shadowOffsetX = 2;
ctx.shadowOffsetY = 2;
ctx.font = 'bold 58px sans-serif';
ctx.fillStyle = '#ffffff';
ctx.fillText('DM', cx, 200);

// Subtle underline accent
ctx.shadowColor = 'transparent';
ctx.beginPath();
ctx.moveTo(cx - 40, 222);
ctx.lineTo(cx + 40, 222);
ctx.strokeStyle = '#4fc3f7';
ctx.lineWidth = 3;
ctx.lineCap = 'round';
ctx.stroke();

ctx.restore();

// ── Save PNG ──
const outDir = join(__dirname, '..', 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const pngPath = join(outDir, 'icon.png');
const buf = canvas.toBuffer('image/png');
fs.writeFileSync(pngPath, buf);
console.log(`PNG icon saved: ${pngPath} (${(buf.length / 1024).toFixed(1)} KB)`);

// ── Generate smaller sizes ──
for (const size of [64, 48, 32, 16]) {
  const s = createCanvas(size, size);
  const sx = s.getContext('2d');
  sx.drawImage(canvas, 0, 0, size, size);
  fs.writeFileSync(join(outDir, `icon-${size}.png`), s.toBuffer('image/png'));
  console.log(`  icon-${size}.png saved`);
}
