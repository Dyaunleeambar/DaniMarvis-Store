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

console.log(fallos
  ? `\n${fallos} import(s) roto(s) en ${archivos.length} archivos`
  : `\nOK: los imports de ${archivos.length} archivos resuelven`);
process.exit(fallos ? 1 : 0);
