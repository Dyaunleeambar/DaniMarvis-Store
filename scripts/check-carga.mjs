// El validador estatico comprueba los nombres, pero no ejecuta el modulo.
// Esto si: levanta el grafo real de publicationsView.js con un DOM minimo,
// que es lo que hace el navegador al importarlo. Si algo explota al cargar,
// aqui se ve.
// app.js engancha listeners a elementos del HTML al importarse, así que
// getElementById tiene que devolver algo, no null.
const nodo = () => ({
  innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener: () => {}, removeEventListener: () => {},
  appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  focus() {}, click() {}, submit() {},
});

const dom = () => ({
  getElementById: () => nodo(),
  querySelector: () => nodo(),
  querySelectorAll: () => [],
  createElement: () => nodo(),
  addEventListener: () => {},
  body: nodo(),
  location: { hash: '' },
});

globalThis.window = {
  location: { hash: '' },
  addEventListener: () => {},
  confirm: () => false,
  alert: () => {},
  scrollTo: () => {},
  history: { replaceState() {} },
};
globalThis.indexedDB = { open: () => ({ onsuccess: null, onerror: null, onupgradeneeded: null }) };
globalThis.IDBKeyRange = { bound: () => ({}), lower: () => ({}), upper: () => ({}) };
globalThis.document = dom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: {} }, configurable: true });
globalThis.FileReader = class { readAsDataURL() {} };

const mod = await import('../frontend/js/views/publicationsView.js');
console.log('exports de publicationsView:', Object.keys(mod).join(', ') || '(ninguno)');
console.log('render exportada:', typeof mod.render === 'function' ? 'sí' : 'NO');

const app = await import('../frontend/js/core/app.js');
console.log('exports de app.js:', Object.keys(app).join(', '));

const st = await import('../frontend/js/views/settingsView.js');
console.log('settingsView carga:', typeof st.render === 'function' ? 'sí' : 'NO');

const { render } = mod;
const cont = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
await render(cont);
const html = cont.innerHTML;
console.log('render() corrió sin excepción');
console.log('HTML generado:', html.length, 'caracteres');

const marcas = [
  ['calendario mensual', /agenda-grid/],
  ['días de la semana', /lun/i],
  ['filtro de grupo', /grupo/i],
  ['botón Planificador', /Planificador/i],
];
for (const [nombre, re] of marcas) {
  console.log(`  ${re.test(html) ? 'OK ' : 'FALTA'} ${nombre}`);
}

// La grilla arranca en lunes; si los rótulos no arrancan en lunes, cada día
// queda corrido una columna. Este bug ya pasó una vez.
const heads = [...html.matchAll(/agenda-dayhead[^>]*>([^<]*)</g)].map(m => m[1].trim());
const nums = [...html.matchAll(/agenda-daynum[^>]*>\s*(\d+)/g)].map(m => +m[1]);
if (heads.length === 7 && nums.length) {
  const NOM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dow = (d) => (d.getDay() + 6) % 7;   // lunes = 0
  const primer = new Date();
  primer.setDate(1);
  primer.setDate(primer.getDate() - dow(primer));   // primer día de la grilla
  const esperado = NOM[(dow(primer) + 1) % 7];   // NOM es domingo-primero
  const ok = heads[0] === esperado;
  console.log(`  ${ok ? 'OK ' : 'FALTA'} rótulos alineados con la grilla`);
  if (!ok) {
    console.log(`       la grilla arranca en ${esperado} pero el primer rótulo es "${heads[0]}"`);
    process.exitCode = 1;
  }
}

if (process.argv[2] === '--dump') console.log('\n--- HTML ---\n' + html);
