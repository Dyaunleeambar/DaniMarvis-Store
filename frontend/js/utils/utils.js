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

export function extractSlogan(product) {
  const name = (product.name || '').trim();
  const desc = (product.description || '').trim();
  if (!desc) return '';

  const lowerName = name.toLowerCase();
  const lowerDesc = desc.toLowerCase();
  const nameIdx = lowerName ? lowerDesc.indexOf(lowerName) : -1;

  if (nameIdx === -1) return '';
  const after = desc.slice(nameIdx + name.length);
  const match = after.match(/^\s*[–—-]\s*([^\n.]+)/);
  if (!match) return '';

  const slogan = match[1].trim();
  if (!slogan || /^[💥✨‼️⭐🎁]/u.test(slogan)) return '';
  return slogan;
}
