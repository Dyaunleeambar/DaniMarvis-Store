// node --check solo parsea: no resuelve los imports, asi que un nombre que no
// exista pasa el chequeo y revienta en el navegador. Esto si los resuelve.
import fs from 'fs';
import path from 'path';

const RAIZ = process.cwd();
const dirs = ['frontend/js', 'backend'];

const archivos = [];
const recorrer = (d) => {
  for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const rel = path.join(d, e.name);
    if (e.isDirectory()) recorrer(rel);
    else if (e.name.endsWith('.js')) archivos.push(rel);
  }
};
dirs.forEach(recorrer);

/** Nombres que un módulo exporta, sin ejecutarlo. */
function exportsDe(file) {
  const src = fs.readFileSync(path.join(RAIZ, file), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const nom = parte.trim().split(/\s+as\s+/).pop().trim();
      if (nom) out.add(nom);
    }
  }
  if (/^\s*export\s+default\b/m.test(src)) out.add('default');
  return out;
}

const cache = new Map();
const cacheExport = (f) => {
  if (!cache.has(f)) cache.set(f, exportsDe(f));
  return cache.get(f);
};

let fallos = 0;
const err = (msg) => { console.log(`  FALLA ${msg}`); fallos++; };

for (const file of archivos) {
  const src = fs.readFileSync(path.join(RAIZ, file), 'utf8');
  const importRe = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(importRe)) {
    const clausula = m[1];
    const esp = m[2];
    const destino = esp.startsWith('.')
      ? path.relative(RAIZ, path.resolve(path.dirname(path.join(RAIZ, file)), esp)).replace(/\\/g, '/')
      : null;

    if (!destino) continue;                                  // paquete de npm
    if (!fs.existsSync(path.join(RAIZ, destino))) { err(`${file} -> ${esp} (no existe el archivo)`); continue; }

    const disponibles = cacheExport(destino);

    // import { a, b as c } from '...'
    for (const br of clausula.matchAll(/\{([^}]*)\}/g)) {
      for (const parte of br[1].split(',')) {
        const orig = parte.trim().split(/\s+as\s+/)[0].trim();
        if (!orig) continue;
        if (!disponibles.has(orig)) {
          err(`${file} importa { ${orig} } de ${esp} y ese módulo no lo exporta`);
        }
      }
    }
    // import X, { ... } from '...'  /  import X from '...'
    const porDefecto = clausula.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
    for (const nom of porDefecto.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!disponibles.has('default')) {
        err(`${file} importa { default: ${nom} } de ${esp} y ese módulo no tiene default`);
      }
    }
  }
}

// --- Segunda pasada: se USA una función exportada sin importarla -------------
// La pasada de arriba valida que lo IMPORTADO exista, pero no mira los
// identificadores que se USAN. Ese fue el bug del 2026-10-17: `server.js` llamaba
// `generateCatalogFile(...)` en la ruta /api/generate-catalog sin haberla
// importado. La función existía y estaba exportada, así que `node --check` y la
// primera pasada quedaron verdes; el error ("generateCatalogFile is not defined")
// solo aparecía al tocar la ruta en caliente. Acá se caza ese caso.
//
// Se limita a `backend` a propósito: en el frontend los nombres llegan por HTML
// (`onclick="closeModal()"`), por imports dinámicos o por `window`, y daría
// falsos positivos. Los comentarios y los strings se reemplazan por espacios
// antes de buscar, para que un `foo()` mencionado en un comentario no cuente.
// Se hace con un recorrido carácter a carácter (y no con regex) porque un `//`
// dentro de una URL (`http://…`) o un apóstrofo dentro de un template partían
// las expresiones regulares y se comían código real.
const esBackend = (f) => /^backend[\\/]/.test(f);

function soloCodigo(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blanco = (c) => (c === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blanco(src[i]); i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += ' '; i++;
      while (i < n) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === q) { out += ' '; i++; break; }
        out += blanco(src[i]); i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const expUnico = new Map();
for (const f of archivos) {
  if (!esBackend(f)) continue;
  for (const n of cacheExport(f)) {
    if (!expUnico.has(n)) expUnico.set(n, []);
    expUnico.get(n).push(f);
  }
}

for (const f of archivos) {
  if (!esBackend(f)) continue;
  const src = fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const cuerpo = soloCodigo(src);

  const libres = new Set();
  // imports estáticos (nombres, alias y default)
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"]/g)) {
    const cl = m[1];
    for (const br of cl.matchAll(/\{([^}]*)\}/g)) {
      for (const p of br[1].split(',')) {
        const orig = p.trim().split(/\s+as\s+/)[0].trim();
        const alias = p.trim().split(/\s+as\s+/).pop().trim();
        if (orig) libres.add(orig);
        if (alias) libres.add(alias);
      }
    }
    const def = cl.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
    if (def && !def.startsWith('*')) libres.add(def);
  }
  // imports dinámicos: traen los exports del módulo
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const esp = m[1];
    if (!esp.startsWith('.')) continue;
    const full = path.resolve(path.dirname(path.join(RAIZ, f)), esp);
    if (!fs.existsSync(full)) continue;
    const dest = path.relative(RAIZ, full).replace(/\\/g, '/');
    for (const n of cacheExport(dest)) libres.add(n);
  }
  // declaraciones locales
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) libres.add(m[1]);

  for (const [nombre, duenos] of expUnico) {
    if (duenos.length !== 1 || duenos[0] === f) continue;
    if (libres.has(nombre)) continue;
    const re = new RegExp('(?<![\\w.$])' + nombre + '\\s*\\(');
    if (re.test(cuerpo)) err(`${f}: usa ${nombre}() (exportada por ${duenos[0]}) sin importarla`);
  }
}

console.log(fallos
  ? `\n${fallos} problema(s) de import en ${archivos.length} archivos`
  : `\nOK: los imports de ${archivos.length} archivos resuelven`);
process.exit(fallos ? 1 : 0);
