// Carga perezosa de librerías de exportación (jsPDF + autotable + JSZip).
// Se inyectan solo cuando el usuario exporta, en vez de bajarlas con cada visita.
const loaded = new Map();

function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(true);
    el.onerror = () => reject(new Error(`No se pudo cargar ${src}. Verificá tu conexión a internet.`));
    document.head.appendChild(el);
  });
  loaded.set(src, promise);
  return promise;
}

export async function ensurePdfLibs() {
  await loadScript('js/lib/jspdf.umd.min.js');
  await loadScript('js/lib/jspdf.plugin.autotable.min.js');
  if (!window.jspdf && !window.jsPDF) {
    throw new Error('jsPDF no se ha cargado. Verificá tu conexión a internet.');
  }
}

export async function ensureZipLibs() {
  await loadScript('js/lib/jszip.min.js');
  if (!window.JSZip) {
    throw new Error('La librería JSZip no está cargada');
  }
}