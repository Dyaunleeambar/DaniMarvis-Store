const FIELD_LABELS = {
  name: 'Producto',
  category: 'Categoría',
  price: 'Precio (USD)',
  provider_name: 'Proveedor',
  stock: 'Stock',
  description: 'Descripción',
  warranty: 'Garantía',
  commission_value: 'Comisión',
  catalog_visible: 'Estado',
  photo: 'Foto',
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

function isBulletLine(l) {
  return /^(?:[💥✅✔️✨⭐🎯‼️⚡🧊]|[-•▪])\s*\S/.test(l);
}

const BULLET_PREFIX = /^[^\S\r\n]*(?:[💥✅✔️✨⭐🎯‼️⚡🧊]|[-•▪])+\s*/;

// Conserva el bloque de características esenciales y omite el párrafo publicitario.
// Si existe "Características esenciales", conserva desde esa frase hasta el final;
// si no, conserva desde el primer bullet hasta el final. El nombre ya va en su columna.
function formatDescription(text) {
  if (!text) return '';
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);

  const cleaned = l => l.replace(/[*_#]/g, '').toLowerCase();
  const markerIdx = lines.findIndex(l => /caracter[ií]sticas\s+esenciales/i.test(cleaned(l)));

  let slice;
  if (markerIdx !== -1) {
    slice = lines.slice(markerIdx);
  } else {
    const firstBullet = lines.findIndex(isBulletLine);
    slice = firstBullet !== -1 ? lines.slice(firstBullet) : lines;
  }

  return slice.map(l => sanitize(l.replace(/[*_#]/g, '').replace(BULLET_PREFIX, ''))).join('\n');
}

function formatRow(product, fields) {
  return fields.map(f => {
    const val = product[f];
    if (f === 'price') return val ? `$${Number(val).toFixed(2)}` : '-';
    if (f === 'commission_value') {
      if (!val) return '-';
      const currency = product.commission_currency || 'USD';
      return currency === 'MN' ? `$${Number(val).toFixed(0)} MN` : `$${Number(val).toFixed(2)}`;
    }
    if (f === 'catalog_visible') return val ? 'Visible' : 'Oculto';
    if (f === 'description') return formatDescription(val);
    return sanitize(val || '-');
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar'));
    img.src = url;
  });
}

// Carga la primera imagen del producto y la convierte a dataURL JPEG.
async function getProductImage(product) {
  const candidates = [];
  if (Array.isArray(product.images)) candidates.push(...product.images);
  if (product.image_url) candidates.push(product.image_url);
  for (const src of candidates) {
    if (!src) continue;
    try {
      const img = await loadImage(src);
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      const maxDim = 800;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.78), w, h };
    } catch { /* probar siguiente */ }
  }
  return null;
}

export async function generatePDF(products, options = {}) {
  const jspdfLib = window.jspdf || window.jsPDF;
  if (!jspdfLib) throw new Error('jsPDF no se ha cargado. Verificá tu conexión a internet.');
  const JsPDF = jspdfLib.jsPDF || jspdfLib;
  if (typeof JsPDF !== 'function') throw new Error('jsPDF no está disponible. Recargá la página.');

  const style = options.style || 'table';
  const fields = options.fields && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const title = options.title || 'Productos';
  const header = options.header || 'DaniMarvis Store';
  const photoEnabled = fields.includes('photo');

  // Con foto: tabla con la imagen grande en la primera columna (apaisada para más ancho).
  const orientation = photoEnabled ? 'landscape' : (products.length > 5 ? 'landscape' : 'portrait');
  const doc = new JsPDF({ orientation });

  let photoData = {};
  if (photoEnabled) {
    for (const p of products) {
      if (p.id in photoData) continue;
      photoData[p.id] = await getProductImage(p);
    }
  }

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
  } else if (photoEnabled) {
    renderTableWithPhotos(doc, products, fields, 44, photoData, title);
  } else {
    renderTableStyle(doc, products, fields, 44);
  }

  const total = products.reduce((s, p) => s + (p.price || 0), 0);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  if (options.footer) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const footerLines = doc.splitTextToSize(sanitize(options.footer), pageW - 28);
    const footerTop = pageH - 20 - footerLines.length * 4;
    doc.text(footerLines, 14, footerTop);
    doc.setDrawColor(201, 132, 122);
    doc.setLineWidth(0.5);
    doc.line(14, footerTop - 3, pageW - 14, footerTop - 3);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(sanitize(`Total: ${products.length} producto(s)  ·  Valor total: $${total.toFixed(2)}`), 14, pageH - 14);

  doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
}

function renderTableStyle(doc, products, fields, startY) {
  const textFields = fields.filter(f => f !== 'photo');
  const headers = textFields.map(f => sanitize(FIELD_LABELS[f] || f));
  const rows = products.map(p => formatRow(p, textFields));
  const descIdx = textFields.indexOf('description');

  const columnStyles = {};
  if (descIdx >= 0) columnStyles[descIdx] = { cellWidth: 60 };

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
    columnStyles,
    margin: { left: 14, right: 14 },
    rowPageBreakAvoid: 'avoid',
  });
}

// Tabla con foto: nombre en la 1ra columna (con la imagen debajo, grande),
// campos en las siguientes y la descripción como última columna. Sin cortes.
function renderTableWithPhotos(doc, products, fields, startY, photoData, title) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const pad = 3;
  const usable = pageW - margin * 2;

  // Orden: nombre primero, descripción al final, resto en medio.
  const selected = fields.filter(f => f !== 'photo');
  const textFields = [
    ...(selected.includes('name') ? ['name'] : []),
    ...selected.filter(f => f !== 'name' && f !== 'description'),
    ...(selected.includes('description') ? ['description'] : []),
  ];
  if (textFields.length === 0) return;

  // Anchos de columna
  const nameColW = textFields.includes('name') ? 80 : 0;
  const descColW = textFields.includes('description') ? 80 : 0;
  const fixedW = nameColW + descColW;
  const otherCount = textFields.length - (textFields.includes('name') ? 1 : 0) - (textFields.includes('description') ? 1 : 0);
  const colWidths = textFields.map(f => {
    if (f === 'name') return nameColW;
    if (f === 'description') return descColW;
    return otherCount > 0 ? Math.max(14, (usable - fixedW) / otherCount) : 0;
  });
  const headers = textFields.map(f => sanitize(FIELD_LABELS[f] || f));
  const headersTotal = colWidths.reduce((a, b) => a + b, 0);
  // Si sobra/ancho, distribuir la diferencia en las columnas del medio para que encaje
  if (otherCount > 0) {
    const diff = usable - headersTotal;
    colWidths.forEach((w, i) => {
      const isOther = textFields[i] !== 'name' && textFields[i] !== 'description';
      if (isOther) colWidths[i] += diff / otherCount;
    });
  }
  if (colWidths.length) colWidths[colWidths.length - 1] += (usable - colWidths.reduce((a, b) => a + b, 0));

  const headerH = 9;
  const colsX = [];
  {
    let x = margin;
    for (const w of colWidths) { colsX.push(x); x += w; }
  }

  const lineH = (t) => (t === 'name' ? 5.2 : 4);

  function wrap(val, w) {
    return doc.splitTextToSize(val, Math.max(10, w - pad * 2));
  }

  // ── Encabezado ──
  function drawHeader(y) {
    doc.setFillColor(201, 132, 122);
    doc.rect(margin, y, usable, headerH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    textFields.forEach((f, ci) => {
      const x = colsX[ci];
      doc.text(headers[ci], x + pad, y + headerH / 2 + 1.2);
    });
    doc.setDrawColor(201, 132, 122);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, usable, headerH, 'S');
  }

  // ── Preparar filas ──
  const prepped = products.map(product => {
    const cells = {};
    let imgDisp = null;
    textFields.forEach((f, ci) => {
      const w = colWidths[ci];
      if (f === 'name') {
        const nameVal = sanitize(product.name || 'Sin nombre');
        const nameLines = wrap(nameVal, w);
        let textH = nameLines.length * lineH('name') + pad * 2;
        const img = photoData[product.id];
        if (img) {
          const dispW = w - pad * 2;
          const maxH = 130;
          const scale = Math.min(1, dispW / img.w, maxH / img.h);
          imgDisp = { w: img.w * scale, h: img.h * scale };
          textH += imgDisp.h + 6;
        }
        cells[f] = { text: nameLines, h: textH, img: imgDisp, dataUrl: imgDisp ? photoData[product.id].dataUrl : null };
      } else {
        const val = formatRow(product, [f])[0];
        const lines = wrap(val, w);
        cells[f] = { text: lines, h: lines.length * lineH(f) + pad * 2, img: null };
      }
    });
    const rowH = Math.max(...Object.values(cells).map(c => c.h));
    return { product, cells, rowH };
  });

  // ── Dibujar ──
  let y = startY;
  const bottomLimit = pageH - 18;
  const topOnNewPage = 16;

  drawHeader(y);
  y += headerH;

  prepped.forEach(({ product, cells, rowH }, ri) => {
    // Si la fila no entra completa, pasar a una nueva página
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = topOnNewPage;
      drawHeader(y);
      y += headerH;
    }

    // Fondo alternado
    if (ri % 2 === 1) {
      doc.setFillColor(245, 241, 240);
      doc.rect(margin, y, usable, rowH, 'F');
    }

    // Celdas: texto y, en el nombre, también la imagen
    textFields.forEach((f, ci) => {
      const x = colsX[ci];
      const cell = cells[f];
      doc.setFont('helvetica', f === 'name' ? 'bold' : 'normal');
      doc.setFontSize(f === 'name' ? 9 : 8);
      doc.setTextColor(50, 50, 50);
      doc.text(cell.text, x + pad, y + pad + 2.4);

      if (f === 'name' && cell.img) {
        const iw = cell.img.w;
        const ih = cell.img.h;
        const ix = x + pad;
        const iy = y + pad + cell.text.length * lineH('name') + 2;
        doc.setFillColor(255, 255, 255);
        doc.rect(ix - 1, iy - 1, iw + 2, ih + 2, 'F');
        doc.addImage(cell.dataUrl, 'JPEG', ix, iy, iw, ih);
      }
    });

    // Bordes de la fila
    doc.setDrawColor(220, 215, 213);
    doc.setLineWidth(0.2);
    colsX.forEach(x => {
      doc.line(x, y, x, y + rowH);
    });
    doc.line(margin, y + rowH, margin + usable, y + rowH);

    y += rowH;
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
      if (f === 'name' || f === 'photo') return;
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
