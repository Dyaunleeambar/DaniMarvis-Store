import sharp from 'sharp';
import { existsSync } from 'fs';

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
