import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

let workerPromise = null;
let chain = Promise.resolve();

function getWorker() {
  if (!workerPromise) workerPromise = createWorker('spa+eng', 1, { logger: () => {} });
  return workerPromise;
}

async function runOcr(input) {
  const png = await sharp(input)
    .rotate()
    .resize({ width: 2500 })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
  const worker = await getWorker();
  const { data } = await worker.recognize(Buffer.from(png), {}, { psm: 3 });
  return data.text || '';
}

export function ocrImage(input) {
  const job = chain.then(() => runOcr(input));
  chain = job.catch(() => {});
  return job;
}

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenSet(s) {
  return new Set(normalizeText(s).split(/\s+/).filter(t => t.length > 1));
}

export function fuzzyScore(productName, ocrText) {
  const pt = normalizeText(productName).split(/\s+/).filter(t => t.length > 1);
  const ot = tokenSet(ocrText);
  if (!pt.length || !ot.size) return 0;
  let shared = 0;
  let bonus = 0;
  for (const t of pt) {
    if (ot.has(t)) {
      shared += 1;
      if (t.length >= 4) bonus += 1;
    }
  }
  let sub = 0;
  for (const t of pt) {
    if (t.length < 3) continue;
    for (const w of ot) {
      if (w.length >= 3 && (t.includes(w) || w.includes(t))) {
        sub += 0.5;
        break;
      }
    }
  }
  const denom = pt.length;
  return Math.min(1, (shared + bonus * 0.5 + sub) / (denom + denom * 0.5));
}

export function extractPrice(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let best = null;
  const re = /([0-9]+(?:[.,][0-9]{1,2})?)/g;
  for (const line of lines) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const raw = m[1];
      const value = parseFloat(raw.replace(',', '.'));
      if (isNaN(value) || value < 1 || value > 5000) continue;
      const before = line.slice(Math.max(0, m.index - 6), m.index);
      const after = line.slice(m.index + raw.length, m.index + raw.length + 8);
      const context = before + after;
      let score = 0;
      if (/US\$|\$|USD|CUC|CUP|MN/i.test(context)) score += 4;
      if (/lts|lt|litro|litros|kg|kilo|volts|volt|v\b|amp|watts|w\b|pies|pulg|pie\b|corriente|130|110|220/i.test(after)) score -= 6;
      const isInt = !/[.,]/.test(raw);
      if (isInt && raw.length >= 2 && raw.length <= 4) score += 2;
      if (line.trim() === raw) score += 1;
      if (score > 0 && (!best || score > best.score)) {
        best = { value, raw, score };
      }
    }
  }
  return best;
}

export function bestMatch(products, ocrText) {
  const scored = products
    .map(p => ({ product: p, score: fuzzyScore(p.name, ocrText) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 0.28) return null;
  return { product: top.product, score: top.score };
}
