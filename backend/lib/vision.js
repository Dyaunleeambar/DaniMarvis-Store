// Plan B: extracción asistida por un modelo de visión.
//
// A diferencia del OCR local (backend/lib/ocr.js), que solo devuelve texto y hay
// que adivinar qué número es el precio, acá se le pide al modelo directamente una
// lista de productos con su precio. Eso resuelve el caso que el OCR no puede: una
// sola foto con varios productos distintos.
//
// Reutiliza la config de Ajustes > Publicaciones (`publish_config.ai`): misma URL,
// misma API key, mismo modelo. Si el modelo no soporta imágenes, el proveedor
// rechaza la petición y el error se propaga tal cual al usuario.
//
// Este módulo NO toca la base ni la red de más: recibe una ruta de archivo y la
// config, y devuelve productos. Así se puede probar sin servidor ni Tesseract.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const MIME_POR_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/** MIME a partir de la extensión; image/jpeg como fallback razonable. */
export function mimeDeRuta(ruta) {
  return MIME_POR_EXT[extname(String(ruta || '')).toLowerCase()] || 'image/jpeg';
}

/**
 * Instrucción para el modelo. Pide JSON estricto y, sobre todo, prohíbe inventar
 * precios: un precio inventado es peor que un precio vacío, porque se aplica al
 * catálogo sin que nadie lo note.
 */
export const PROMPT_VISION = [
  'Mirá la imagen, que es una publicidad o lista de precios de un proveedor.',
  'Devolvé SOLO un JSON válido, sin texto alrededor ni marcas de código, con esta forma exacta:',
  '{"productos":[{"nombre":"nombre del producto","precio":123.45}]}',
  'Reglas:',
  '- Una entrada por cada producto distinto que se vea.',
  '- "precio" es el precio en USD, como número, o null si no hay un precio claro.',
  '- Nunca inventes ni estimes un precio. Si dudás, usá null.',
  '- "nombre" debe ser corto y descriptivo, tomado de la imagen.',
  '- Si no ves ningún producto, devolvé {"productos":[]}.',
].join('\n');

/** Convierte un precio que puede venir como número o texto a número, o NaN. */
function aNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor !== 'string') return NaN;
  let s = valor.replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decSep = lastDot > lastComma ? lastDot : (lastComma > -1 ? lastComma : -1);
  if (decSep > -1) {
    const entero = s.slice(0, decSep).replace(/[.,]/g, '');
    const decimales = s.slice(decSep + 1).replace(/[.,]/g, '');
    s = `${entero}.${decimales}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  return Number(s);
}

/**
 * Extrae la lista de productos de la respuesta cruda del modelo.
 *
 * Es tolerante a propósito: los modelos suelen envolver el JSON en ```json ... ```
 * o agregar una frase antes. Acepta también `products` (inglés) por si el modelo
 * ignora el idioma del prompt. Ante cualquier cosa que no se pueda parsear,
 * devuelve [] en vez de romper: el caller decide qué hacer.
 */
export function parsearProductos(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return [];
  let t = texto.trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();

  let data;
  try {
    data = JSON.parse(t);
  } catch {
    const i = t.indexOf('{');
    const j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return [];
    try { data = JSON.parse(t.slice(i, j + 1)); } catch { return []; }
  }

  const arr = Array.isArray(data) ? data
    : Array.isArray(data?.productos) ? data.productos
    : Array.isArray(data?.products) ? data.products
    : [];

  const out = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const nombre = String(p.nombre ?? p.name ?? p.producto ?? '').trim();
    const crudo = p.precio ?? p.price ?? null;
    let precio = crudo === null || crudo === undefined || crudo === '' ? null : aNumero(crudo);
    if (precio !== null && (!Number.isFinite(precio) || precio <= 0 || precio > 100000)) precio = null;
    if (!nombre && precio === null) continue;
    out.push({ nombre, precio });
  }
  return out;
}

/**
 * Llama al modelo de visión con una imagen y devuelve los productos detectados.
 *
 * @param {string} ruta  ruta local de la imagen
 * @param {object} cfg   { apiUrl, apiKey, model, timeoutMs? }
 * @returns {Promise<{productos:Array<{nombre:string,precio:number|null}>, crudo:string}>}
 */
export async function extraerConVision(ruta, cfg = {}) {
  const apiBase = String(cfg.apiUrl || '').replace(/\/+$/, '');
  if (!apiBase) throw new Error('Falta la URL del API en Ajustes > Publicaciones.');
  if (!cfg.apiKey) throw new Error('Falta la API key en Ajustes > Publicaciones.');

  const buffer = readFileSync(ruta);
  const dataUrl = `data:${mimeDeRuta(ruta)};base64,${buffer.toString('base64')}`;

  const isOpenRouter = apiBase.includes('openrouter.ai');
  const timeoutMs = cfg.timeoutMs || 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Respondés siempre con JSON válido, sin explicaciones.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT_VISION },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 2000,
        ...(isOpenRouter ? { reasoning: { enabled: false } } : {}),
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`El modelo tardó más de ${Math.round(timeoutMs / 1000)}s en responder.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    // OpenRouter devuelve 404 "No endpoints found that support image input" cuando
    // el modelo elegido es de solo texto. Sin este mensaje, el usuario ve un 404
    // crudo del proveedor y no entiende que el problema es el modelo, no la app.
    if (response.status === 404 && /support image input|image input/i.test(errBody)) {
      throw new Error(`El modelo "${cfg.model}" no acepta imágenes. Elegí un modelo con visión en Ajustes > Publicaciones (por ejemplo inclusionai/ling-3.0-flash-vl).`);
    }
    throw new Error(`El proveedor de IA respondió ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const rawBody = await response.text().catch(() => '');
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error('El proveedor de IA no devolvió JSON válido. Revisá la URL en Ajustes > Publicaciones.');
  }

  const choice = data.choices?.[0];
  const crudo = (choice?.message?.content || choice?.message?.reasoning || '').trim();
  if (!crudo) {
    const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
    throw new Error(`El modelo no devolvió contenido${reason}. Probá otro modelo en Ajustes > Publicaciones.`);
  }

  return { productos: parsearProductos(crudo), crudo };
}