const FIELD_LABELS = {
  name: 'Producto',
  category: 'Categoría',
  price: 'Precio (USD)',
  provider_name: 'Proveedor',
  stock: 'Stock',
  description: 'Descripción',
  warranty: 'Garantía',
  commission_value: 'Comisión (USD)',
  catalog_visible: 'Estado',
};

const DEFAULT_FIELDS = ['name', 'price', 'category', 'provider_name', 'stock'];

function sanitize(text) {
  if (!text) return '';
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '*')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '*')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '*')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '*')
    .replace(/[\u{2700}-\u{27BF}]/gu, '*')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[^\x00-\x7F]/g, (ch) => {
      const map = { '\u00D1': 'N', '\u00F1': 'n', '\u00C1': 'A', '\u00E1': 'a', '\u00C9': 'E', '\u00E9': 'e', '\u00CD': 'I', '\u00ED': 'i', '\u00D3': 'O', '\u00F3': 'o', '\u00DA': 'U', '\u00FA': 'u', '\u00DC': 'U', '\u00FC': 'u' };
      return map[ch] || '';
    });
}

function formatRow(product, fields) {
  return fields.map(f => {
    const val = product[f];
    if (f === 'price' || f === 'commission_value') return val ? `$${Number(val).toFixed(2)}` : '-';
    if (f === 'catalog_visible') return val ? 'Visible' : 'Oculto';
    return sanitize(val || '-');
  });
}

export function generatePDF(products, options = {}) {
  const jspdfLib = window.jspdf || window.jsPDF;
  if (!jspdfLib) throw new Error('jsPDF no se ha cargado. Verificá tu conexión a internet.');
  const JsPDF = jspdfLib.jsPDF || jspdfLib;
  if (typeof JsPDF !== 'function') throw new Error('jsPDF no está disponible. Recargá la página.');
  const doc = new JsPDF({ orientation: products.length > 5 ? 'landscape' : 'portrait' });
  const style = options.style || 'table';
  const fields = options.fields && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const title = options.title || 'Productos';
  const header = options.header || 'DaniMarvis Store';
  const date = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });

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
  doc.line(14, 38, doc.internal.pageSize.getWidth() - 14, 38);

  if (style === 'list') {
    renderListStyle(doc, products, fields, 44);
  } else {
    renderTableStyle(doc, products, fields, 44);
  }

  const total = products.reduce((s, p) => s + (p.price || 0), 0);
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(sanitize(`Total: ${products.length} producto(s)  ·  Valor total: $${total.toFixed(2)}`), 14, pageH - 14);

  doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
}

function renderTableStyle(doc, products, fields, startY) {
  const headers = fields.map(f => sanitize(FIELD_LABELS[f] || f));
  const rows = products.map(p => formatRow(p, fields));

  doc.autoTable({
    startY,
    head: [headers],
    body: rows,
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
    columnStyles: fields.includes('description')
      ? { [fields.indexOf('description')]: { cellWidth: 60 } }
      : {},
    margin: { left: 14, right: 14 },
  });
}

function renderListStyle(doc, products, fields, startY) {
  let y = startY;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const maxW = pageW - margin * 2;

  products.forEach((product, i) => {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 20;
    }

    doc.setFillColor(245, 241, 240);
    doc.roundedRect(margin, y, maxW, 6, 1, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(201, 132, 122);
    doc.text(`${i + 1}. ${sanitize(product.name || 'Sin nombre')}`, margin + 3, y + 4.5);

    y += 10;

    fields.forEach(f => {
      if (f === 'name') return;
      const label = FIELD_LABELS[f] || f;
      const val = formatRow(product, [f])[0];

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(sanitize(`${label}:`), margin + 3, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(val, maxW - 40);
      doc.text(lines, margin + 40, y);
      y += lines.length * 4 + 2;
    });

    y += 4;
    if (i < products.length - 1) {
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }
  });
}

export { FIELD_LABELS, DEFAULT_FIELDS };
