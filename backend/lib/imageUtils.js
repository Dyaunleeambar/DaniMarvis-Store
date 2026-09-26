import sharp from 'sharp';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const SUBFOLDERS = ['import', 'generated', 'copilot'];

const WEBP_QUALITY = 82;
const WEBP_EXT_RE = /\.(jpe?g|png|gif)$/i;

/**
 * Ensures a WebP version of the given image exists alongside it.
 * Returns the WebP path if available, or null.
 */
export async function ensureWebp(inputPath) {
  if (!existsSync(inputPath)) return null;
  const webpPath = inputPath.replace(WEBP_EXT_RE, '.webp');
  if (inputPath === webpPath) return inputPath;
  if (existsSync(webpPath)) return webpPath;
  try {
    await sharp(inputPath).webp({ quality: WEBP_QUALITY }).toFile(webpPath);
    return webpPath;
  } catch {
    return null;
  }
}

/**
 * Converts an image buffer to WebP buffer.
 */
export async function toWebpBuffer(input) {
  return sharp(input).webp({ quality: WEBP_QUALITY }).toBuffer();
}

/**
 * Given a URL path like "/uploads/abc.jpg", returns "/uploads/abc.webp".
 */
export function webpUrl(url) {
  if (!url) return url;
  return url.replace(WEBP_EXT_RE, '.webp');
}

/**
 * Resolves a local image reference (URL path like "/uploads/import/abc.jpg"
 * or "abc.jpg") to its absolute path inside the uploads directory.
 * Tries the full path first (respecting subfolders like import/ or generated/),
 * then falls back to a basename search across known subfolders.
 * Returns the absolute path if found, or null.
 */
export function resolveLocalUpload(relPath) {
  if (!relPath) return null;
  if (/^https?:\/\//i.test(relPath)) return null;
  const clean = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^uploads\//, '');
  if (!clean) return null;

  // 1) ruta completa, respetando subcarpetas (evita escape de directorio)
  const full = path.resolve(UPLOADS_DIR, clean);
  if (full.startsWith(UPLOADS_DIR + path.sep) && existsSync(full)) return full;

  // 2) respaldo: buscar por nombre de archivo en subcarpetas conocidas
  const filename = clean.split('/').pop();
  if (!filename) return null;
  for (const sub of ['', ...SUBFOLDERS]) {
    const candidate = path.join(UPLOADS_DIR, sub, filename);
    if (existsSync(candidate)) return candidate;
  }

  console.warn(`[imageUtils] Imagen local no encontrada en uploads/: ${relPath}`);
  return null;
}
