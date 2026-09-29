export function formatUSD(n) {
  return '$' + Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMN(usd, rate) {
  const mn = (parseFloat(usd) || 0) * (parseFloat(rate) || 61000);
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(mn);
}

export function formatCurrency(n) {
  return formatUSD(n);
}

export function formatCommission(amount, currency) {
  if (!amount || amount <= 0) return '—';
  if (currency === 'MN') {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  }
  return formatUSD(amount);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Convierte un valor guardado en la BD a texto para un `<input type="datetime-local">`.
 *
 * El input SIEMPRE habla hora local: el navegador no acepta 'Z' ni offsets. Y un
 * input datetime-local se RELLENA con `getHours()`, no con `toISOString()`. La
 * versión anterior usaba toISOString(), que devuelve UTC, así que una publicación
 * de las 18:00 se editaba mostrando 22:00 y al guardarla quedaba corrida 4 horas
 * para siempre. Venezuela es UTC-4 fijo, pero esto funciona en cualquier zona.
 */
export function formatDateInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
       + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Inverso: lo que el usuario escribió en el input → UTC ISO para guardar.
 *
 * `new Date('YYYY-MM-DDTHH:MM')` se interpreta como hora LOCAL (por eso el
 * round-trip con formatDateInput cierra), y toISOString() devuelve UTC. Acá se
 * guarda UTC, que es lo que espera el disparador por fecha y lo que produce
 * migratePubAgenda() en las filas viejas.
 */
export function localInputToUtc(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Compara dos fechas por el DÍA local (ignora la hora). Para agrupar en el calendario. */
export function isSameLocalDay(a, b) {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear()
      && x.getMonth() === y.getMonth()
      && x.getDate() === y.getDate();
}

export function nowISO() {
  return new Date().toISOString();
}

export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function isSloganCode(slogan) {
  if (/^(modelo|ref|referencia|serie)\b/i.test(slogan)) return true;
  if (/^[A-Z0-9][A-Z0-9\-.‑]*(?:\s*\/\s*[A-Z0-9][A-Z0-9\-.‑]*)*\s*$/i.test(slogan)) return true;
  if (/^\d+(\.\d+)?\s*(kg|kgs|l|litros|litro|w|wh|mAh|pies|pulg|cm|mm|lt)\b/i.test(slogan)) return true;
  if (/\(\s*[A-Z0-9]{2,}\s*\)/.test(slogan)) return true;
  if (/^\s*\w+\s*$/.test(slogan)) return true;
  return false;
}

export function extractSlogan(product) {
  const name = (product.name || '').trim();
  const desc = (product.description || '').trim();
  if (!desc) return '';

  const lowerName = name.toLowerCase();
  const lowerDesc = desc.toLowerCase();
  const nameIdx = lowerName ? lowerDesc.indexOf(lowerName) : -1;

  let candidate = '';
  if (nameIdx !== -1) {
    candidate = desc.slice(nameIdx + name.length);
  } else {
    const firstLine = desc.split('\n')[0].trim();
    const dashIdx = firstLine.search(/[–—-]/);
    if (dashIdx !== -1) {
      candidate = firstLine.slice(dashIdx);
    }
  }

  const match = candidate.match(/^\s*[–—-]\s*([^\n.]+)/);
  if (!match) return '';

  const slogan = match[1].trim().replace(/\*\*$/g, '');
  if (!slogan || /^[💥✨‼️⭐🎁]/u.test(slogan)) return '';
  if (isSloganCode(slogan)) return '';
  return slogan;
}
