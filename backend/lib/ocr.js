import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';

// El PSM va en `setParameters({ tessedit_pageseg_mode })`. Antes se pasaba como
// `recognize(img, {}, { psm: 3 })`, pero ese tercer argumento son los FORMATOS de
// salida (text/blocks/tsv…), no parámetros de Tesseract: el `psm` quedaba inerte y
// en la práctica corría el default de tesseract.js, que es PSM 6 (SINGLE_BLOCK).
// Medido sobre los folletos reales de backend/uploads/import, PSM 3 (AUTO) devuelve
// texto más limpio; PSM 6 engancha elementos gráficos del diseño. Por eso AUTO.
const PSM_MODO = PSM.AUTO;

// Debajo de esta confianza, Tesseract suele estar adivinando sobre elementos gráficos
// del diseño (rayas, sombras, iconos). Se usa para armar el texto con el que se
// decide, sin perder el texto crudo que igual se le muestra al usuario.
export const CONFIANZA_MINIMA = 50;

let workerPromise = null;
let chain = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('spa+eng', 1, { logger: () => {} })
      .then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM_MODO });
        return worker;
      });
  }
  return workerPromise;
}

/**
 * Aplana la jerarquía de Tesseract (blocks → paragraphs → lines) a una lista plana de
 * líneas con su bbox y confianza. En tesseract.js 7 no existen `data.words` ni
 * `data.lines`: la posición vive dentro de `data.blocks`, y solo llega si se pide
 * `{ blocks: true }` en el output (por defecto Tesseract solo devuelve `text`).
 */
export function aplanarLineas(blocks) {
  const out = [];
  for (const bloque of blocks || []) {
    for (const parrafo of bloque.paragraphs || []) {
      for (const linea of parrafo.lines || []) {
        const text = (linea.words || []).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
        if (text) out.push({ text, confidence: Math.round(linea.confidence || 0), bbox: linea.bbox || null });
      }
    }
  }
  return out;
}

/**
 * Reconstruye texto usando solo las líneas que superan el umbral de confianza, para
 * que el ruido gráfico no contamine la decisión (match de producto, precio).
 */
export function textoConfiable(lines, min = CONFIANZA_MINIMA) {
  return (lines || []).filter(l => l.confidence >= min).map(l => l.text).join('\n');
}

function preprocess(input) {
  return sharp(input)
    .rotate()
    .resize({ width: 2500 })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function runOcr(input) {
  const png = await preprocess(input);
  const worker = await getWorker();
  const { data } = await worker.recognize(Buffer.from(png), {}, { text: true, blocks: true });
  return { text: data.text || '', lines: aplanarLineas(data.blocks) };
}

function encolar(input) {
  const job = chain.then(() => runOcr(input));
  chain = job.catch(() => {});
  return job;
}

/** Documento OCR completo: { text, lines:[{text,confidence,bbox}] }. */
export function ocrDocument(input) {
  return encolar(input);
}

/** Texto plano (compatibilidad con el flujo anterior). */
export async function ocrImage(input) {
  return (await ocrDocument(input)).text;
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

// La moneda pegada es la señal fuerte de precio: en las imágenes reales aparece como
// "585usd", "75 Usd" o "$1500". El símbolo se busca inmediatamente antes del número y
// el código (USD/CUC/CUP/MN) inmediatamente después; una ventana ancha hacía que el "2"
// de "KD 2 T 585usd" se robara la moneda del 585.
const MONEDA_SIMBOLO = /\$/;
const MONEDA_CODIGO = /^\s*(?:usd|cuc|cup|mn)\b/i;
// Palabras que NO son precio cuando acompañan al número: unidades, medidas, duración.
// "120 MINUTOS" y "700W" son los falsos positivos que aparecen en los folletos.
const NO_PRECIO = /\b(?:lts?|litros?|kg|kilos?|volts?|volt|amp|watts?|w|pies|pulg|pie|corriente|min|minutos?|horas?|hrs?|mah)\b/i;
// Un entero pelado (sin moneda) solo se acepta si está solo en su línea: preferimos no
// proponer precio a proponer uno equivocado.
const UMBRAL_PRECIO = 4;

/**
 * Interpreta un número respetando separadores de miles, no solo decimales. En el
 * mercado de esta app (es-CO) "1.500" es mil quinientos, no 1.5 — y el `parseFloat`
 * directo miente. Se acepta agrupación por "." o "," y un decimal final de 1-2 dígitos.
 */
export function parsearNumero(raw) {
  const limpio = String(raw).replace(/[^\d.,]/g, '');
  const m = limpio.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
  if (m) return parseFloat(m[1].replace(/[.,]/g, '') + (m[2] ? '.' + m[2] : ''));
  return parseFloat(limpio.replace(',', '.'));
}

export function extractPrice(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let best = null;
  // Toma el número completo con sus separadores ("1.500", "1.234,56"), no solo 1-2
  // decimales, para no cortarlo y leerlo mal.
  const re = /[0-9][0-9.,]*[0-9]|[0-9]/g;
  for (const line of lines) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const raw = m[0];
      const value = parsearNumero(raw);
      if (isNaN(value) || value < 1 || value > 5000) continue;
      const antesCorto = line.slice(Math.max(0, m.index - 2), m.index);
      const despuesCorto = line.slice(m.index + raw.length, m.index + raw.length + 4);
      const despues = line.slice(m.index + raw.length, m.index + raw.length + 10);
      const tieneMoneda = MONEDA_SIMBOLO.test(antesCorto) || MONEDA_SIMBOLO.test(despuesCorto) || MONEDA_CODIGO.test(despuesCorto);
      const esUnidad = NO_PRECIO.test(despues);
      const digitos = String(Math.round(value)).length;
      let score = 0;
      if (tieneMoneda) score += 5;
      if (esUnidad) score -= 8;
      if (Number.isInteger(value) && digitos >= 2 && digitos <= 4) score += 2;
      if (line.trim() === raw.trim()) score += 2;
      if (score >= 4 && (!best || score > best.score)) best = { value, raw, score };
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

/**
 * Los mejores K candidatos por encima del umbral, ordenados. El flujo sigue
 * proponiendo el primero, pero tener los siguientes permite ofrecer alternativas sin
 * volver a puntuar.
 */
export function bestMatches(products, ocrText, k = 3) {
  return products
    .map(p => ({ product: p, score: fuzzyScore(p.name, ocrText) }))
    .filter(s => s.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
