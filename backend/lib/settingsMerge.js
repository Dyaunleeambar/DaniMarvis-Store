// Fusionar la config de publicación con lo que llega del cliente.
//
// Vive acá y no en el handler de PUT /api/settings por una razón concreta: este
// archivo decide si un secreto se guarda o se conserva, y equivocarse ahí borra
// la API key del usuario sin dejar rastro. El 2026-10-03 pasó de verdad — un
// cliente leyó los ajustes, le devolvieron la clave enmascarada, cambió un
// campo y reenvió todo: la máscara quedó guardada como si fuera la clave real.
// Desde entonces el publicador de grupos anduvo normal y la generación de
// descripciones tiraba
// `Cannot convert argument to a ByteString because the character at index 7 has
// a value of 8226`, que es el error de Node cuando una viñeta (U+2022) viaja en
// una cabecera HTTP. Índice 7 = "Bearer " mide 7, así que el carácter 8226 era la
// clave.
//
// La regla que faltaba: **enmascarado es "no enviado"**, igual que vacío.

/** La máscara que el propio servidor devuelve en los GET (server.js). */
export const MASCARA = '•'.repeat(8);

/**
 * ¿Este valor sirve como clave/token?
 *
 * Un secreto de Facebook o de OpenRouter es SIEMPRE ASCII imprimible: letras,
 * dígitos y un puñado de signos. Si viene una viñeta, un reemplazo U+FFFD o
 * cualquier cosa fuera de ASCII, no es un secreto: es la máscara, o basura.
 *
 * Se acepta el espacio (0x20) a propósito porque es legal en un secreto. Lo que
 * no se acepta es cualquier cosa fuera de ASCII: el bug venía de ser
 * demasiado permisivo con los caracteres raros, y el lugar de ser estrictos es
 * acá, no cuando el byte explota en una cabecera.
 */
export function pareceSecretoValido(valor) {
  if (typeof valor !== 'string' || !valor) return false;
  if (valor === MASCARA) return false;
  return !/[^\x20-\x7E]/.test(valor);
}

/**
 * Decide el valor final de un secreto entre lo que llega y lo que ya está.
 *
 * `quitar` (los flags remove_ai_key / remove_fb_token) gana siempre: borrar es
 * una acción explícita del usuario y no se ignora nunca.
 */
export function resolverSecreto({ incoming, vigente, quitar = false }) {
  if (quitar) return undefined;
  if (pareceSecretoValido(incoming)) return incoming;
  return vigente;
}

/** Escribe el secreto en `destino`, o lo borra si quedó sin valor. */
function aplicarSecreto(destino, nombre, incoming, vigente, quitar) {
  const valor = resolverSecreto({ incoming, vigente, quitar });
  if (valor) destino[nombre] = valor;
  else delete destino[nombre];
}

/**
 * Fusiona la config entrante con la vigente.
 *
 * - Las claves de primer nivel que no llegan se conservan.
 * - `ai` y `facebook` se mezclan campo por campo, para que mandar solo la API
 *   key no borre la URL, el modelo ni el system_prompt.
 * - Los flags `remove_*` se aplican y después se borran del resultado: si
 *   quedaran guardados, el próximo guardado los volvería a aplicar y borraría
 *   el secreto de nuevo.
 * - Enmascarado, vacío o basura = conservar lo vigente. Nunca pisar un secreto
 *   con un valor que no lo es.
 *
 * @param {object} existing config guardada (objeto ya parseado)
 * @param {object} incoming  config que manda el cliente
 * @returns {object} la config a guardar
 */
export function mergePublishConfig(existing = {}, incoming = {}) {
  const actual = existing && typeof existing === 'object' ? existing : {};
  const nuevo = incoming && typeof incoming === 'object' ? incoming : {};

  const ai = { ...(actual.ai || {}), ...(nuevo.ai || {}) };
  const facebook = { ...(actual.facebook || {}), ...(nuevo.facebook || {}) };

  aplicarSecreto(
    ai, 'api_key',
    nuevo.ai?.api_key, actual.ai?.api_key,
    !!nuevo.ai?.remove_ai_key
  );
  aplicarSecreto(
    facebook, 'access_token',
    nuevo.facebook?.access_token, actual.facebook?.access_token,
    !!nuevo.facebook?.remove_fb_token
  );

  delete ai.remove_ai_key;
  delete facebook.remove_fb_token;

  return { ...actual, ...nuevo, ai, facebook };
}