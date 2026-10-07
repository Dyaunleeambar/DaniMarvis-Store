/**
 * Plan B: lectura por IA (visión).
 *
 * El parser y el armado de la petición son la parte que puede fallar en silencio:
 * si el modelo devuelve el JSON envuelto en ``` o con una frase antes, un parser
 * ingenuo descarta los productos y el usuario ve "0 productos" sin saber por qué.
 * Y si la petición se arma mal (imagen ausente, Authorization mal), el proveedor
 * responde 400 y otra vez parece que "la IA no sirve".
 *
 * Acá se prueban ambos sin pegarle a ninguna API: se reemplaza fetch por uno falso.
 */
import { mimeDeRuta, parsearProductos, extraerConVision, PROMPT_VISION } from '../backend/lib/vision.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log('  ok   ' + nombre);
  else { console.log('  FALLA ' + nombre + (extra ? '  -> ' + extra : '')); fallos++; }
}
const nombres = (arr) => arr.map(p => p.nombre).join('|');
const precios = (arr) => arr.map(p => p.precio).join('|');

console.log('\n1. mime por extensión');
{
  ok('.jpg -> image/jpeg', mimeDeRuta('a.JPG') === 'image/jpeg');
  ok('.png -> image/png', mimeDeRuta('x.png') === 'image/png');
  ok('desconocida -> image/jpeg', mimeDeRuta('x.tiff') === 'image/jpeg');
}

console.log('\n2. parseo tolerante de la respuesta del modelo');
{
  ok('JSON pelado', nombres(parsearProductos('{"productos":[{"nombre":"Olla","precio":12.5}]}')) === 'Olla');
  ok('envuelto en ```json', nombres(parsearProductos('```json\n{"productos":[{"nombre":"Ventilador","precio":30}]}\n```')) === 'Ventilador');
  ok('con frase antes del JSON', nombres(parsearProductos('Claro, aquí está:\n{"productos":[{"nombre":"Radio","precio":9}]}')) === 'Radio');
  ok('array de nivel superior', nombres(parsearProductos('[{"nombre":"Taza","precio":3}]')) === 'Taza');
  ok('clave en inglés "products"', nombres(parsearProductos('{"products":[{"name":"Cup","price":3}]}')) === 'Cup');
  ok('basura -> []', parsearProductos('no hay json acá').length === 0);
  ok('vacío -> []', parsearProductos('').length === 0);
}

console.log('\n3. normalización de precio');
{
  const r = parsearProductos('{"productos":[{"nombre":"A","precio":"1.234,56"},{"nombre":"B","precio":"75 USD"},{"nombre":"C","precio":null}]}');
  ok('"1.234,56" -> 1234.56', r[0]?.precio === 1234.56);
  ok('"75 USD" -> 75', r[1]?.precio === 75);
  ok('null se conserva como null', r[2]?.precio === null);
  const malo = parsearProductos('{"productos":[{"nombre":"D","precio":-5},{"nombre":"E","precio":0}]}');
  ok('precio <= 0 -> null', malo[0]?.precio === null && malo[1]?.precio === null);
}

console.log('\n4. se descartan entradas sin nombre ni precio');
{
  const r = parsearProductos('{"productos":[{"nombre":"","precio":null},{"nombre":"Real","precio":5}]}');
  ok('una sola entrada válida', r.length === 1 && r[0].nombre === 'Real');
}

console.log('\n5. el prompt exige JSON y prohíbe inventar precios');
{
  ok('menciona "productos"', /productos/.test(PROMPT_VISION));
  ok('pide JSON', /JSON válido/i.test(PROMPT_VISION));
  ok('prohíbe inventar', /nunca inventes/i.test(PROMPT_VISION));
}

console.log('\n6. extraerConVision arma bien la petición y parsea la respuesta');
{
  const tmp = join(tmpdir(), 'danimarvis-vision-test.jpg');
  writeFileSync(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const fetchReal = globalThis.fetch;
  let capturado = null;
  globalThis.fetch = async (url, opts) => {
    capturado = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '```json\n{"productos":[{"nombre":"Olla Reina","precio":12.5},{"nombre":"Set","precio":null}]}\n```' } }],
      }),
    };
  };

  try {
    const res = await extraerConVision(tmp, { apiUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' });
    ok('usa el endpoint /chat/completions', /\/chat\/completions$/.test(capturado.url));
    ok('manda la API key en Authorization', capturado.headers.Authorization === 'Bearer sk-test');
    ok('usa el modelo configurado', capturado.body.model === 'gpt-4o-mini');
    ok('desactiva reasoning en OpenRouter', capturado.body.reasoning?.enabled === false);
    const imagen = capturado.body.messages?.[1]?.content?.find?.(c => c.type === 'image_url');
    ok('incluye la imagen como data URL', /^data:image\/jpeg;base64,/.test(imagen?.image_url?.url || ''));
    ok('devuelve los dos productos', res.productos.length === 2);
    ok('respeta el precio numérico', res.productos[0]?.precio === 12.5 && res.productos[0]?.nombre === 'Olla Reina');
    ok('deja null el precio ausente', res.productos[1]?.precio === null);
  } finally {
    globalThis.fetch = fetchReal;
    unlinkSync(tmp);
  }
}

console.log('\n7. sin configuración de IA, falla con un mensaje claro');
{
  const tmp = join(tmpdir(), 'danimarvis-vision-test2.jpg');
  writeFileSync(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    let error = '';
    try { await extraerConVision(tmp, { apiKey: 'x' }); } catch (e) { error = e.message; }
    ok('exige API URL', /API en Ajustes/i.test(error));
  } finally {
    unlinkSync(tmp);
  }
}

console.log('\n8. modelo de solo texto -> mensaje claro, no el 404 crudo');
{
  const ruta = join(tmpdir(), 'test-vision-notxt.jpg');
  writeFileSync(ruta, 'x');
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ error: { message: 'No endpoints found that support image input', code: 404 } }),
  });
  try {
    await extraerConVision(ruta, { apiUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'modelo-de-texto' });
    ok('debería haber lanzado', false);
  } catch (e) {
    ok('dice que el modelo no acepta imágenes', /no acepta imágenes/i.test(e.message));
    ok('nombra el modelo', /modelo-de-texto/.test(e.message));
  } finally {
    globalThis.fetch = fetchReal;
    unlinkSync(ruta);
  }
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);