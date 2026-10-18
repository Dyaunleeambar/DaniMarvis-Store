// notaLote: la nota que queda en la cola sobre el lote de grupos (los 9 extra
// que se tickean en el compositor además del grupo destino).
//
// El caso que motiva esto: el 2026-10-16, de 36 posts publicados, 9 solo salieron
// al grupo destino (no se repartieron a los 9 grupos) y quedaron registrados
// EXACTAMENTE igual que los 27 que sí se repartieron: status 'published' y una
// nota tibia ("NO se tildó ningún grupo extra"). No había forma de distinguir un
// éxito total de un fallo de propagación ni desde la cola ni desde el panel.
//
// Ahora el poster manda `lote_estado` y la nota lo refleja: 'no-aplicable' no
// ensucia, 'ok' lista los grupos, y 'sin-boton'/'sin-grupos' avisan fuerte.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(cond ? `  ok   ${nombre}` : `  FALLA ${nombre}${extra ? '  -> ' + extra : ''}`);
  if (!cond) fallos++;
};

// La base es un singleton de módulo: hay que fijar el entorno ANTES de importar
// groupPublisher.js, que resuelve la carpeta de uploads al cargarse.
const dir = mkdtempSync(join(tmpdir(), 'danimarvis-lote-'));
mkdirSync(dir, { recursive: true });
process.env.DANIMARVIS_DB = join(dir, 'prueba.db');
process.env.DANIMARVIS_ENV_PATH = join(dir, 'nada.env');

const { initDB } = await import('../backend/db/database.js');
const { notaLote } = await import('../backend/lib/groupPublisher/index.js');
await initDB();

console.log('\nnotaLote\n');

// 1. Lote aplicado: lista los grupos y el conteo.
{
  const n = notaLote({ lote_estado: 'ok', lote_grupos: ['G1', 'G2', 'G3'], grupos_en_lista: 120 });
  ok('ok: incluye el conteo', n.includes('lote: 3/120 grupos'), n);
  ok('ok: lista los nombres', n.includes('G1') && n.includes('G3'), n);
}

// 2. No se pudo repartir: avisa fuerte y dice que salió solo en el grupo destino.
{
  const n = notaLote({ lote_estado: 'sin-boton', lote_grupos: [], grupos_en_lista: 120 });
  ok('sin-boton: marca ATENCIÓN lote', n.includes('ATENCIÓN lote:'), n);
  ok('sin-boton: dice que salió SOLO en el grupo destino', n.includes('SOLO en el grupo destino'), n);
  ok('sin-boton: menciona el botón', n.includes('Añadir grupos'), n);
}
{
  const n = notaLote({ lote_estado: 'sin-grupos', lote_grupos: [], grupos_en_lista: 120 });
  ok('sin-grupos: marca ATENCIÓN lote', n.includes('ATENCIÓN lote:'), n);
  ok('sin-grupos: dice cuántos hay en la lista', n.includes('120'), n);
  ok('sin-grupos: dice que salió SOLO en el grupo destino', n.includes('SOLO en el grupo destino'), n);
}

// 3. No aplicable (sin imágenes o lote apagado): NO ensucia la nota. Antes
// escribía "NO se tildó ningún grupo extra" aunque nunca se hubiera intentado.
{
  const n = notaLote({ lote_estado: 'no-aplicable', lote_grupos: [], grupos_en_lista: 0 });
  ok('no-aplicable: nota vacía', n === '', JSON.stringify(n));
}

// 4. Compatibilidad: sin `lote_estado` (corrida vieja) se mantiene el formato
// anterior, para no romper el historial ya guardado.
{
  ok('sin estado y sin array: vacío', notaLote({}) === '');
  const viejo = notaLote({ lote_grupos: [], grupos_en_lista: 5 });
  ok('sin estado con lista vacía: mantiene el texto viejo', viejo.includes('NO se tildó ningún grupo extra'), viejo);
  const viejoOk = notaLote({ lote_grupos: ['X'], grupos_en_lista: 5 });
  ok('sin estado con grupos: mantiene el conteo', viejoOk.includes('lote: 1/5 grupos'), viejoOk);
}

rmSync(dir, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} prueba(s) fallaron\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
