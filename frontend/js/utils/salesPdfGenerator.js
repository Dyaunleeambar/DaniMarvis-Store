import { sanitize } from './pdfGenerator.js';

const DELIVERY_LABELS = {
  pending: 'Pendiente',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

function fmtUSD(n) {
  return '$' + Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMN(total, rate) {
  const mn = (parseFloat(total) || 0) * (parseFloat(rate) || 61000);
  return '$' + Math.round(mn).toLocaleString('es-CO') + ' MN';
}

function fmtCommission(amount, currency) {
  if (!amount || amount <= 0) return '—';
  if (currency === 'MN') return '$' + Number(amount).toLocaleString('es-CO', { maximumFractionDigits: 0 }) + ' MN';
  return fmtUSD(amount);
}

export function generateSalesPDF(sales, options = {}) {
  const jspdfLib = window.jspdf || window.jsPDF;
  if (!jspdfLib) throw new Error('jsPDF no se ha cargado. Verificá tu conexión a internet.');
  const JsPDF = jspdfLib.jsPDF || jspdfLib;
  if (typeof JsPDF !== 'function') throw new Error('jsPDF no está disponible. Recargá la página.');

  const title = options.title || 'Reporte de ventas';
  const header = options.header || 'DaniMarvis Store';
  const excludeCancelled = options.excludeCancelled !== false;

  const all = sales.filter(s => !excludeCancelled || s.delivery_status !== 'cancelled');
  const cancelledCount = excludeCancelled ? sales.length - all.length : 0;

  const doc = new JsPDF({ orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const footerText = options.footer && String(options.footer).trim() ? String(options.footer).trim() : '';
  let footerLinesCount = 0;
  if (footerText) {
    footerLinesCount = doc.splitTextToSize(sanitize(footerText), pageW - 28).length;
  }
  const bottomReserve = footerText ? 16 + footerLinesCount * 4 : 12;

  const date = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const exchangeRate = all.length > 0 ? all[0].exchange_rate : 61000;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(201, 132, 122);
  doc.text(sanitize(header), 14, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(sanitize(title), 14, 28);
  doc.text(date, 14, 34);

  doc.setDrawColor(201, 132, 122);
  doc.setLineWidth(0.5);
  doc.line(14, 38, pageW - 14, 38);

  let startY = 44;

  if (options.includeSummary !== false) {
    const totalRevenue = all.reduce((s, v) => s + (v.total_amount || 0), 0);
    const pendingComm = all
      .filter(v => !v.commission_paid)
      .reduce((s, v) => s + (v.commission_amount || 0), 0);
    const pendingUSD = all
      .filter(v => !v.commission_paid && (v.commission_currency || 'USD') === 'USD')
      .reduce((s, v) => s + (v.commission_amount || 0), 0);
    const pendingMN = all
      .filter(v => !v.commission_paid && (v.commission_currency || 'USD') === 'MN')
      .reduce((s, v) => s + (v.commission_amount || 0), 0);
    const delivered = all.filter(v => v.delivery_status === 'delivered').length;

    const lines = [
      `Ventas: ${all.length}${cancelledCount > 0 ? `  ·  Canceladas excluidas: ${cancelledCount}` : ''}`,
      `Ingresos totales: ${fmtUSD(totalRevenue)}  (≈ ${fmtMN(totalRevenue, exchangeRate)})`,
      `Comisiones pendientes: ${pendingComm === 0 ? '$0.00' : `${pendingUSD > 0 ? fmtUSD(pendingUSD) : ''}${pendingUSD > 0 && pendingMN > 0 ? ' + ' : ''}${pendingMN > 0 ? fmtCommission(pendingMN, 'MN') : ''}`}`,
      `Entregadas: ${delivered}  ·  Enviadas: ${all.filter(v => v.delivery_status === 'shipped').length}  ·  Pendientes: ${all.filter(v => v.delivery_status === 'pending').length}`,
    ];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(sanitize(lines[0]), 14, startY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(sanitize(lines[1]), 14, startY + 5);
    doc.text(sanitize(lines[2]), 14, startY + 10);
    doc.text(sanitize(lines[3]), 14, startY + 15);
    startY += 22;
  }

  const headers = ['Fecha', 'Producto', 'Proveedor', 'Cliente', 'Télefono', 'Cant', 'Total USD', 'Total MN', 'Comisión', 'Pagada', 'Entrega'];
  const colWidths = [22, 46, 30, 34, 24, 9, 20, 26, 20, 15, 20];

  const rows = all.map(s => {
    const clientName = `${s.client_name || '—'}${s.client_address ? ` (${s.client_address})` : ''}`;
    return [
      new Date(s.sale_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }),
      s.product_name || '—',
      s.provider_name || '—',
      clientName,
      s.client_phone || '—',
      String(s.quantity ?? ''),
      fmtUSD(s.total_amount || 0),
      fmtMN(s.total_amount || 0, s.exchange_rate || exchangeRate),
      fmtCommission(s.commission_amount || 0, s.commission_currency || 'USD'),
      s.commission_paid ? 'Sí' : 'No',
      DELIVERY_LABELS[s.delivery_status] || s.delivery_status || '—',
    ];
  });

  const columnStyles = {};
  headers.forEach((_, i) => {
    columnStyles[i] = { cellWidth: colWidths[i] };
  });
  ['Cant', 'Total USD', 'Total MN', 'Comisión'].forEach(h => {
    const i = headers.indexOf(h);
    columnStyles[i].halign = 'right';
  });

  if (rows.length > 0) {
    doc.autoTable({
      startY,
      head: [headers.map(h => sanitize(h))],
      body: rows.map(r => r.map(c => sanitize(c))),
      theme: 'grid',
      headStyles: {
        fillColor: [201, 132, 122],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
      alternateRowStyles: { fillColor: [245, 241, 240] },
      styles: { cellPadding: 3, overflow: 'linebreak' },
      columnStyles,
      margin: { left: 14, right: 14, bottom: bottomReserve + 2 },
      rowPageBreakAvoid: 'avoid',
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('No hay ventas para exportar.', 14, startY + 8);
  }

  if (footerText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const footerLines = doc.splitTextToSize(sanitize(footerText), pageW - 28);
    const footerBottom = pageH - 10 - footerLines.length * 4;
    doc.text(footerLines, 14, footerBottom);
    doc.setDrawColor(201, 132, 122);
    doc.setLineWidth(0.5);
    doc.line(14, footerBottom - 3, pageW - 14, footerBottom - 3);
  }

  const totalRevenue = all.reduce((s, v) => s + (v.total_amount || 0), 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(
    sanitize(`Total: ${all.length} venta(s)  ·  Ingresos: ${fmtUSD(totalRevenue)}${all.length > 0 ? `  (≈ ${fmtMN(totalRevenue, exchangeRate)})` : ''}`),
    14,
    pageH - 5
  );

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`ventas_${stamp}.pdf`);
}