import { sanitize } from './pdfGenerator.js';

function num(n) {
  return Number(n).toLocaleString('es-ES');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function getJspdf() {
  const lib = window.jspdf || window.jsPDF;
  if (!lib) throw new Error('jsPDF no está disponible. Recargá la página.');
  const JsPDF = lib.jsPDF || lib;
  if (typeof JsPDF !== 'function') throw new Error('jsPDF no está disponible. Recargá la página.');
  return new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
}

function drawHeader(doc, title, metaText) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(201, 132, 122);
  doc.text(sanitize(title), 14, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(sanitize(metaText), 14, 28);
  doc.setDrawColor(201, 132, 122);
  doc.setLineWidth(0.5);
  doc.line(14, 32, pageW - 14, 32);
}

function groupTable(doc, title, rows, startY) {
  const labelTop = startY + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text(sanitize(title), 14, labelTop);

  const body = rows.map((g, i) => [
    i + 1,
    sanitize(g.grupo || 'Sin grupo'),
    Number(g.posts) || 0,
    num(g.vistas),
    num(g.impresiones),
    num(g.promedio),
  ]);

  doc.autoTable({
    startY: labelTop + 4,
    head: [['#', 'Grupo', 'Posts', 'Vistas', 'Impresiones', 'Promedio']],
    body,
    theme: 'grid',
    headStyles: { fillColor: [201, 132, 122], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, textColor: [50, 50, 50] },
    alternateRowStyles: { fillColor: [245, 241, 240] },
    styles: { cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: { 1: { cellWidth: 90 } },
    margin: { left: 14, right: 14 },
    rowPageBreakAvoid: 'avoid',
  });
  return doc.lastAutoTable.finalY + 8;
}

function drawSummary(doc, block, startY) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const line = `${block.total_posts ?? 0} publicaciones · ${block.total_groups ?? 0} grupos medidos · ${num(block.total_vistas)} visualizaciones totales`;
  doc.text(sanitize(line), 14, startY + 5);
  return startY + 10;
}

function renderBlock(doc, block, metaExtra) {
  const dateLabel = fmtDate(block.fecha);
  drawHeader(doc, `Ranking de grupos${dateLabel && dateLabel !== '—' ? ` · ${dateLabel}` : ''}`, metaExtra);
  let y = drawSummary(doc, block, 38);
  y = groupTable(doc, 'Top — más visualizaciones', block.top || [], y);
  y = groupTable(doc, 'Fondo — menos visualizaciones', block.bottom || [], y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, doc.internal.pageSize.getHeight() - 5);
}

// blocks: [{ fecha, total_posts, total_groups, total_vistas, top, bottom }]
export function exportRankingsPdf(blocks, options = {}) {
  const list = Array.isArray(blocks) ? blocks : [blocks];
  if (!list.length) throw new Error('No hay rankings para exportar');
  const doc = getJspdf();
  const meta = `${list.length} snapshot(s) · Biblioteca de Contenido`;

  list.forEach((block, i) => {
    if (i > 0) doc.addPage();
    renderBlock(doc, block, meta);
  });

  const totalName = options.filename || `Ranking_${(list[0].fecha || 'datos')}${list.length > 1 ? '_multi' : ''}`;
  doc.save(`${totalName.replace(/[^\w\-]+/g, '_')}_${Date.now()}.pdf`);
}