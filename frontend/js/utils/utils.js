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

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDateInput(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toISOString().slice(0, 16);
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
