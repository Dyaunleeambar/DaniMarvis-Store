const IDENTITY = `[IDENTIDAD]
DaniMarvis-Store. Moderna, limpia, técnica y comercial.
Paleta: navy profundo (color estructural dominante), naranja (acento dinámico),
dorado (uso selectivo, especialmente el precio), blanco (texto y espacios de respiración).
Conservar el coral original del logo como firma cromática.
Sombras y reflejos realistas y discretos. Líneas y diagonales limpias y controladas.
Formato: 4:5 (1080×1350 px).`;

const CTA_WHATSAPP = `[CTA WHATSAPP]
Incluir un botón de consulta por WhatsApp, con el icono oficial de WhatsApp
y los números de contacto "+53 53760493 / +53 54115666".
Diseñar el botón integrado y coherente con el resto de la composición,
sin detalles rígidos: el generador ajusta forma, color y tipografía a la pieza.`;

const RESTRICTIONS = `[RESTRICCIONES]
No inventar especificaciones técnicas, garantías, instalación ni servicio posventa.
No deformar, ensanchar ni alterar proporciones, colores o componentes del producto.
No añadir texto basura, watermarks ni elementos irrelevantes.
Mantener márgenes seguros para lectura en móvil (Facebook/Instagram).`;

const SHIPPING = 'Envío: GRATIS a Matanzas, Cienfuegos y Villa Clara';

const FAMILIES = {
  A: {
    id: 'A',
    name: 'A — HERO',
    purpose: 'Atención + presentación',
    question: '¿Qué es y cuánto cuesta?',
    variants: {
      A1: {
        name: 'A1 — IMPACTO',
        objective: 'Detener el scroll. Producto grande, nombre claro, precio protagonista e información mínima.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto protagonista, centrado y a gran escala (~65% del lienzo).
- Nombre en mayúsculas, blanco, tipografía moderna limpia.
- Precio dorado grande, el segundo elemento más visible después del producto.
- Información mínima: solo nombre, precio y garantía confirmada.
- Sello de garantía discreto en esquina inferior izquierda (solo si está confirmado).
- [CTA WHATSAPP] centrado en la zona inferior, debajo del precio.`,
      },
      A2: {
        name: 'A2 — PREMIUM',
        objective: 'Producto protagonista con contexto controlado. Refuerza confianza y percepción de tienda seria.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto protagonista con un contexto de escenario controlado y elegante.
- Fondo navy suave con iluminación de estudio y reflejo sutil bajo el producto.
- Nombre en mayúsculas, blanco; precio dorado jerarquizado.
- Sello de garantía discreto (solo si está confirmado).
- [CTA WHATSAPP] en la zona inferior, equilibrado con el precio.`,
      },
      A3: {
        name: 'A3 — FOCUS',
        objective: 'Producto casi aislado y muy limpio. Mantener estrictamente proporciones reales.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto casi aislado sobre fondo limpio de alto contraste, sin contexto.
- Mantener estrictamente las proporciones reales: nunca ensanchar ni deformar para ganar impacto.
- Precio dorado discreto y legible; nombre en mayúsculas en la parte superior.
- [CTA WHATSAPP] centrado en la zona inferior.`,
      },
    },
  },
  B: {
    id: 'B',
    name: 'B — CATALOG',
    purpose: 'Información técnica',
    question: '¿Qué ofrece?',
    variants: {
      B1: {
        name: 'B1 — FICHA TÉCNICA',
        objective: 'Presentar especificaciones en módulos legibles sin convertir el flyer en una ficha saturada.',
        cta: 'Consulta por WhatsApp',
        composition: `- Producto centrado en escenario limpio tipo estudio, iluminación técnica.
- Especificaciones organizadas en módulos (3-4 bloques máx), cada uno con icono simple.
- Jerarquía: producto → especificación principal → precio → CTA → secundarios.
- Fondo claro o navy suave; NO saturar el flyer.
- [CTA WHATSAPP] en el bloque CTA, tras las especificaciones.`,
      },
    },
  },
  C: {
    id: 'C',
    name: 'C — OFFER',
    purpose: 'Oportunidad + acción',
    question: '¿Por qué comprar ahora?',
    variants: {
      C1: {
        name: 'C1 — PRECIO PROTAGONISTA',
        objective: 'El precio y la oportunidad tienen mayor protagonismo. Debe parecer conveniente, no barato.',
        cta: 'Solo una pieza a este precio — escríbeme',
        composition: `- Precio dorado GRANDE, elemento central dominante.
- Producto junto al precio, con sombra realista.
- Un solo mensaje comercial fuerte por pieza.
- [CTA WHATSAPP] debajo del precio; es el único CTA de la pieza.
- Sin marcos, sin "¡¡OFERTA!!" ni fuegos artificiales: conveniencia, no baratura.`,
      },
    },
  },
  D: {
    id: 'D',
    name: 'D — LIFESTYLE',
    purpose: 'Deseo + experiencia',
    question: '¿Cómo me imagino usándolo?',
    variants: {
      D1: {
        name: 'D1 — ESCENA ASPIRACIONAL',
        objective: 'Vender la experiencia de usar el producto, no especificaciones.',
        cta: 'Tu próxima aventura empieza aquí — escríbeme',
        composition: `- Entorno aspiracional o cotidiano coherente con el producto.
- El producto real integrado en la escena, proporciones intactas.
- Precio en dorado, módulo compacto en esquina.
- [CTA WHATSAPP] compacto en la esquina opuesta al precio.
- La composición puede cambiar radicalmente pero debe reconocerse como DaniMarvis.`,
      },
    },
  },
};

export const VARIANTS_ORDER = {
  A: ['A1', 'A2', 'A3'],
  B: ['B1'],
  C: ['C1'],
  D: ['D1'],
};

export function listFamilies() {
  return Object.values(FAMILIES).map(f => ({
    id: f.id,
    name: f.name,
    purpose: f.purpose,
    question: f.question,
    variants: VARIANTS_ORDER[f.id].map(key => ({
      id: key,
      name: f.variants[key].name,
      objective: f.variants[key].objective,
    })),
  }));
}

const LIFESTYLE_RE = /bicicleta|bici\b|patineta|triciclo|monopatin|juguete|gaming|piscina|colchon|inflable/i;
const TECH_RE = /bluetti|ecoflow|inversor|panel solar|bater[ií]a|estaci[oó]n de energ[ií]a|turbina|generador|litio|lifepo4|power station/i;

export function selectFamily(product) {
  const category = String(product.category || '').toLowerCase();
  const desc = String(product.description || '').toLowerCase();
  const haystack = category + ' ' + desc;
  const bullets = (String(product.description || '').match(/💥|✅|•|▪/g) || []).length;
  const price = Number(product.price) || 0;

  if (LIFESTYLE_RE.test(haystack)) return 'D';
  if (TECH_RE.test(haystack) || bullets >= 8) return 'B';
  if (price > 0 && price < 80) return 'C';
  if (bullets >= 4) return 'B';
  return 'A';
}

export function nextVariant(lastTemplate, family) {
  const order = VARIANTS_ORDER[family];
  if (order && lastTemplate && order.includes(lastTemplate)) {
    const idx = order.indexOf(lastTemplate);
    return order[(idx + 1) % order.length];
  }
  return order ? order[0] : 'A1';
}

function extractFeatures(description) {
  if (!description) return [];
  const lines = String(description).split('\n').map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[💥✅✔️✨⭐🎯‼️]/.test(l) || /^[-•▪]\s*\S/.test(l));
  const source = bullets.length >= 3 ? bullets : lines.filter(l => /:\s/.test(l) && l.length < 90);
  return source.slice(0, 8).map(l => l.replace(/^[^\S\r\n]*[💥✅✔️✨⭐🎯‼️•▪-]+\s*/, '').trim()).filter(Boolean);
}

const NONE_WARRANTY_RE = /^(no tiene|no|ninguna|sin garant|n\/a|na|—|-)$/i;

function warrantyBlock(warranty) {
  const normalized = String(warranty || '').trim();
  if (!normalized || NONE_WARRANTY_RE.test(normalized)) {
    return 'Garantía: NO registrada → NO mostrar sello de garantía. No usar "GARANTÍA DE CALIDAD" como sustituto.';
  }
  const label = normalized.toUpperCase();
  return `Garantía: ${normalized} → sello "GARANTÍA ${label}" (nunca "GARANTÍA DE CALIDAD" si no existe garantía comercial).`;
}

export function buildPrompt(product, options = {}) {
  const familyId = options.family || selectFamily(product);
  const family = FAMILIES[familyId];
  const variantKey = options.variant || VARIANTS_ORDER[familyId][0];
  const variant = family.variants[variantKey];
  const price = '$' + Number(product.price || 0).toLocaleString('es-CO') + ' USD';
  const features = extractFeatures(product.description);
  const featuresText = features.length
    ? features.join(' | ')
    : 'Ninguna especificación confirmada adicional';

  const blocks = [
    IDENTITY,
    '',
    '[PRODUCTO — FUENTE DE VERDAD]',
    'Se adjunta imagen real del producto. NO modificar proporciones, componentes,',
    'colores, forma ni accesorios.',
    '',
    '[PLANTILLA]',
    `Familia: ${family.name}`,
    `Variante: ${variant.name}`,
    `Objetivo: ${variant.objective}`,
    '',
    '[DATOS AUTORIZADOS]',
    `Nombre: ${product.name}`,
    `Precio: ${price}`,
    `Características confirmadas: ${featuresText}`,
    warrantyBlock(product.warranty),
    SHIPPING,
    `CTA: ${variant.cta}`,
    '',
    '[COMPOSICIÓN]',
    variant.composition,
    '',
    CTA_WHATSAPP,
    '',
    RESTRICTIONS,
  ];

  return blocks.join('\n');
}
