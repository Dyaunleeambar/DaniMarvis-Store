// Cálculo de garantías a partir de la fecha de venta y el texto de garantía del
// producto ("1 mes", "15 días", "1 año", ...) que se guarda en productos.warranty.
//
// El vencimiento se congela POR VENTA en sales.warranty_end (YYYY-MM-DD, día
// local): si mañana cambia la garantía del producto, las ventas viejas no se
// mueven. El usuario puede además editarlo a mano en el modal de la venta.
//
// Convención de fechas: sale_date se guarda como hora local de pared ("2026-09-07T16:08"),
// así que todos los cálculos acá usan getFullYear/getMonth/getDate locales, nunca toISOString().

const pad2 = (n) => String(n).padStart(2, '0');

/** Texto libre ("1 mes", "meses" en plural, "1.5 años", "90 días", "2 semanas") → duración. */
export function parseWarranty(text) {
  if (!text) return null;
  const t = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([a-zñáéíóú]+)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num) || num <= 0) return null;
  const unit = m[2];
  if (/^mes(es)?$/.test(unit)) return { months: num };
  if (/^a[nñ]o(s)?$/.test(unit)) return { years: num };
  if (/^d[ií]a(s)?$/.test(unit)) return { days: num };
  if (/^semanas?$/.test(unit)) return { days: num * 7 };
  return null;
}

/** Suma la duración a una fecha conservando el día (los meses cortos limitan). */
export function addDuration(baseDate, dur) {
  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) return null;
  const { years = 0, months = 0, days = 0 } = dur || {};
  const d = new Date(baseDate.getTime());
  const totalMonths = months + years * 12;
  if (totalMonths) {
    const origDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + totalMonths);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(origDay, lastDay));
  }
  if (days) d.setDate(d.getDate() + days);
  return d;
}

export function fmtLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Vencimiento (YYYY-MM-DD) de una venta según su fecha y la garantía del producto. */
export function computeWarrantyEndDate(saleDate, warrantyText) {
  const dur = parseWarranty(warrantyText);
  if (!dur) return null;
  const base = new Date(String(saleDate || '').slice(0, 16));
  if (isNaN(base.getTime())) return null;
  const end = addDuration(base, dur);
  return end ? fmtLocalDate(end) : null;
}

/** Días calendario (locales) desde hoy hasta el vencimiento. Hoy = 0, mañana = 1, ayer = -1. */
export function daysUntilEnd(endDate, now = new Date()) {
  if (!endDate) return null;
  const end = new Date(String(endDate).slice(0, 10) + 'T00:00:00');
  if (isNaN(end.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

/**
 * Recordatorios para el Dashboard:
 *  - expiringNow: garantías que vencen HOY o MAÑANA (la alerta que pide el usuario).
 *  - recentlyExpired: vencidas hace menos de 14 días, por si quiere llamar igual.
 * Devuelve listas ya armadas con el texto del producto, el cliente y el teléfono.
 */
export function getWarrantyReminders(db, { now = new Date() } = {}) {
  const sales = db.prepare(`
    SELECT s.id as sale_id, s.sale_date, s.warranty_end, s.client_name, s.client_phone,
           p.name as product_name, p.warranty as product_warranty
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    WHERE s.delivery_status <> 'cancelled'
      AND s.warranty_end IS NOT NULL
      AND s.warranty_end <> ''
    ORDER BY s.warranty_end ASC
  `).all();

  const expiringNow = [];
  const recentlyExpired = [];
  for (const s of sales) {
    const days = daysUntilEnd(s.warranty_end, now);
    if (days === null) continue;
    const item = {
      sale_id: s.sale_id,
      product_name: s.product_name || '—',
      product_warranty: s.product_warranty || '',
      warranty_end: s.warranty_end,
      sale_date: s.sale_date,
      client_name: s.client_name || '',
      client_phone: s.client_phone || '',
      days_until: days,
    };
    if (days === 0 || days === 1) {
      item.expires_label = days === 0 ? 'hoy' : 'mañana';
      expiringNow.push(item);
    } else if (days < 0 && days >= -14) {
      recentlyExpired.push(item);
    }
  }

  return {
    expiringNow,
    recentlyExpired,
    count: expiringNow.length,
  };
}