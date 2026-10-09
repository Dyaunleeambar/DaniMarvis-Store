import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Perfil de Chrome histórico de la cuenta A. Se deja como default para no
// cambiar el comportamiento existente: la segunda instancia (B) se distingue
// solo por variables de entorno (FB_DEBUG_PROFILE), sin tocar el código de A.
const DEFAULT_PROFILE = 'C:/Users/Dani/fb-leave/fb-debug-perfil';

/**
 * Config de la instancia/cuenta actual, tomada del entorno.
 *
 * Todos los defaults reproducen EXACTAMENTE lo que hacía el sistema antes de
 * soportar dos cuentas: id 'A', puerto 9222, el perfil de siempre y sin proxy.
 * La cuenta B es la misma base de código arrancada con otras variables de
 * entorno (ACCOUNT_ID=B, FB_DEBUG_PORT=9223, FB_DEBUG_PROFILE=.../perfil-b,
 * PROXY_SERVER=...), sin cambios en el código.
 */
export function getAccountConfig() {
  return {
    id: String(process.env.ACCOUNT_ID || 'A'),
    debugPort: Number(process.env.FB_DEBUG_PORT) || 9222,
    profileDir: String(process.env.FB_DEBUG_PROFILE || DEFAULT_PROFILE),
    proxy: String(process.env.PROXY_SERVER || '').trim(),
  };
}

/**
 * Carpeta de uploads de esta instancia. Por defecto la histórica
 * (backend/uploads); la cuenta B usa una propia para no mezclar imágenes ni
 * derrames archivos temporales en la de A.
 */
export function getUploadsDir() {
  return process.env.DANIMARVIS_UPLOADS
    ? resolve(process.env.DANIMARVIS_UPLOADS)
    : join(__dirname, '..', 'uploads');
}
