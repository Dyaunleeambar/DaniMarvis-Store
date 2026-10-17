/**
 * El catálogo se generaba bien... salvo que la función no estaba importada.
 *
 * El 2026-10-17, al disparar "Generar catálogo" desde el panel, saltó
 * `Error al generar el catálogo: generateCatalogFile is not defined`. La función
 * EXISTÍA y estaba exportada en `backend/lib/catalogGenerator.js`, pero
 * `backend/server.js` la llamaba en la ruta `/api/generate-catalog` sin haberla
 * importado. `node --check` solo parsea, y `check-imports.mjs` valida que lo
 * importado exista, pero ninguno de los dos mira los identificadores que se USAN
 * sin importar: el error solo aparecía al tocar la ruta en caliente.
 *
 * Este test cierra ese hueco por dos lados:
 *   1. Ejecuta el generador DE VERDAD contra un directorio temporal y comprueba
 *      que escriba el `index.html` con el producto.
 *   2. Comprueba el cableado de `server.js`: que importe la función y que la
 *      ruta la llame. Ese es el chequeo que habría atajado el bug.
 */
import { generateCatalogFile } from '../backend/lib/catalogGenerator.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

const dir = mkdtempSync(join(tmpdir(), 'danimarvis-catalogo-'));

console.log('\n1. el generador escribe el catálogo (función real, sin tocar el repo)');
{
  const productos = [
    {
      id: 1, name: 'Producto de Prueba', description: 'Descripcion de prueba',
      price: 1234.5, category: 'Pruebas', provider_name: 'GE',
      images: '[]', catalog_visible: 1, status: 'active',
    },
    {
      id: 2, name: 'Otro Producto', description: '', price: 20,
      category: 'Pruebas', provider_name: 'EM',
      images: '[]', catalog_visible: 1, status: 'active',
    },
  ];

  let html = '';
  try {
    html = await generateCatalogFile(productos, dir, join(dir, 'uploads'));
  } catch (e) {
    ok('generateCatalogFile corre sin excepción', false, e.message);
  }

  const archivo = join(dir, 'index.html');
  ok('escribe index.html', existsSync(archivo));
  const leido = existsSync(archivo) ? readFileSync(archivo, 'utf8') : '';
  ok('devuelve el HTML y no vacío', typeof html === 'string' && html.length > 1000, `len=${html.length}`);
  ok('el archivo en disco coincide con lo devuelto', leido === html);
  ok('incluye el nombre del producto', leido.includes('Producto de Prueba'));
  ok('incluye el otro producto', leido.includes('Otro Producto'));
  ok('incluye la categoría', leido.includes('Pruebas'));
}

console.log('\n2. el cableado de server.js (el bug real: llamarla sin importarla)');
{
  const server = readFileSync(join(RAIZ, 'backend', 'server.js'), 'utf8');

  ok('server.js importa generateCatalogFile desde ./lib/catalogGenerator.js',
    /import\s*\{[^}]*\bgenerateCatalogFile\b[^}]*\}\s*from\s*['"]\.\/lib\/catalogGenerator\.js['"]/.test(server));

  ok('la ruta /api/generate-catalog existe', /app\.post\(\s*['"]\/api\/generate-catalog['"]/.test(server));

  ok('la ruta llama a generateCatalogFile', /await\s+generateCatalogFile\(/.test(server));

  // Y que no quede una llamada sin el import correspondiente: si aparece el uso
  // pero no el import, este test lo caza aunque el resto siga verde.
  const usa = /generateCatalogFile\s*\(/.test(server);
  const importa = /import\s*\{[^}]*\bgenerateCatalogFile\b/.test(server);
  ok('si se usa, está importada', !usa || importa);
}

rmSync(dir, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
