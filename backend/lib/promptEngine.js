// ─── BRAND DNA (Capa 1 — identidad global, nunca desaparece) ────────────────

const BRAND_DNA = `[BRAND_DNA]
Marca: DaniMarvis-Store
Paleta base:
  - Navy principal #08245A → fondos, cabeceras, estructura
  - Deep Navy #061633 → profundidad y contraste
  - Naranja #FF6A00 → acción, energía, CTA, líneas y acentos
  - Dorado #D9A928 → principalmente precio y detalles de valor
  - Blanco #FFFFFF → claridad y espacio de respiración
  - Coral/rojo del logo → conservar firma cromática original
Proporción orientativa: 60–70% azul, 20–30% producto/espacio, 5–10% naranja, <5% dorado.
El dorado queda reservado principalmente para precio/valor salvo instrucción específica de campaña.
Tipografía: sans serif geométrica (Montserrat o equivalente). Legibilidad y consistencia.
Efectos: sombras suaves, reflejos sutiles, iluminación equilibrada.
Composición: líneas/diagonales limpias y controladas.
Personalidad: moderna, seria, confiable, limpia, técnica, comercial y accesible.
Regla rectora: VARIAR LA EXPRESIÓN, NUNCA LA IDENTIDAD.
No usar explosiones, rayos, fuego, exceso de brillos, emojis, marcos innecesarios ni estética genérica de compraventa.`;

// ─── PROVIDER STYLE DEFAULT (cuando el proveedor no tiene perfil) ────────────

const DEFAULT_PROVIDER_STYLE = {
  code: 'DEFAULT',
  name: 'DaniMarvis Genérico',
  style_name: 'DANIMARVIS_DEFAULT',
  background_rules: 'Fondo navy estructural estándar. Blanco para respiración.',
  accent_rules: 'Naranja controlado como acento. Dorado en precio.',
  signature_rules: 'Estilo DaniMarvis estándar.',
  negative_rules: '',
};

// ─── FORMATOS ───────────────────────────────────────────────────────────────

const FORMATS = {
  '1:1': { width: 1080, height: 1080, label: '1:1 — Feed cuadrado', safe_margin: '8%' },
  '4:5': { width: 1080, height: 1350, label: '4:5 — Feed móvil (recomendado)', safe_margin: '6%' },
  '9:16': { width: 1080, height: 1920, label: '9:16 — Stories / Reels', safe_margin: '10%' },
};

// ─── CTA WHATSAPP ───────────────────────────────────────────────────────────

const CTA_WHATSAPP = `[CTA_WHATSAPP]
Incluir un botón de consulta por WhatsApp, con el icono oficial de WhatsApp
y los números de contacto "+53 53760493 / +53 54115666".
Diseñar el botón integrado y coherente con el resto de la composición,
sin detalles rígidos: el generador ajusta forma, color y tipografía a la pieza.`;

// ─── RESTRICCIONES ──────────────────────────────────────────────────────────

const NEGATIVE_RULES = `[RESTRICCIONES]
No inventar características, precios, garantías, entregas, instalación, accesorios,
certificaciones ni disponibilidad.
No deformar el producto. No alterar proporciones, colores, controles, materiales ni accesorios reales.
No agregar logos o marcas ficticias.
No producir texto basura o ilegible.
No saturar con iconos, emojis, explosiones, rayos, fuego, brillos excesivos ni marcos innecesarios.
No usar estética genérica de compraventa.
No añadir watermarks ni elementos irrelevantes.
No usar texto que no esté respaldado por datos del CRM.
El producto y los datos verificados del CRM son la fuente de verdad.
La calidad visual y el objetivo comercial tienen prioridad sobre cualquier patrón rígido.`;

const SHIPPING_DEFAULT = 'Envío: GRATIS a Matanzas, Cienfuegos y Villa Clara';

// ─── QA CHECKLIST (se inyecta al final del prompt) ──────────────────────────

const QA_CHECKLIST = `[QA_CHECKLIST]
Validar antes de publicar:
☐ ¿El producto coincide con la imagen real?
☐ ¿Nombre, modelo y precio coinciden con el CRM?
☐ ¿La moneda es correcta?
☐ ¿Todas las características visibles están respaldadas?
☐ ¿Garantía y entrega están confirmadas?
☐ ¿El logo DaniMarvis-Store es correcto?
☐ ¿El perfil de proveedor corresponde al supplier_id del CRM?
☐ ¿El producto conserva proporciones, colores, controles y accesorios reales?
☐ ¿El precio es legible en móvil?
☐ ¿El CTA es correcto?
☐ ¿La pieza mantiene márgenes de seguridad?
☐ ¿El estilo del proveedor se reconoce sin competir con la marca?
☐ ¿La composición se ve como DaniMarvis-Store y no como una plantilla genérica?`;

// ─── JERARQUÍA PUBLICITARIA ─────────────────────────────────────────────────

const HIERARCHY = `[JERARQUÍA]
Prioridad de elementos (de mayor a menor):
1. PRODUCTO → reconocible inmediatamente, forma y colores reales.
2. PRECIO → segundo foco visual, muy legible en móvil.
3. QUÉ ES → nombre, marca/modelo, capacidad o variante.
4. BENEFICIO → una frase corta, solo si está respaldada.
5. MARCA + CTA → DaniMarvis-Store y acción de contacto.
6. DATOS SECUNDARIOS → garantía, entrega, accesorios, solo si confirmados.`;

// ─── FAMILIAS CREATIVAS ─────────────────────────────────────────────────────

const FAMILIES = {
  A: {
    id: 'A',
    name: 'A — HERO',
    purpose: 'Atención + presentación',
    question: '¿Qué es y cuánto cuesta?',
    variants: {
      A1: {
        name: 'A1 — Front',
        objective: 'Producto frontal, protagonista, centrado y a gran escala. Detener el scroll.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto protagonista, centrado y a gran escala (~65% del lienzo).
- Vista frontal, recognizing form, proportions, colors, controls, and materials.
- Nombre en mayúsculas, blanco, tipografía moderna limpia.
- Precio dorado grande, segundo elemento más visible después del producto.
- Información mínima: solo nombre, precio y garantía confirmada.
- Sello de garantía discreto en esquina inferior izquierda (solo si confirmado).
- [CTA_WHATSAPP] centrado en la zona inferior, debajo del precio.`,
      },
      A2: {
        name: 'A2 — Angle',
        objective: 'Producto con ángulo controlado. Refuerza confianza y percepción de tienda seria.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto con ángulo ligeramente elevado, dando profundidad.
- Contexto de escenario controlado y elegante.
- Fondo navy suave con iluminación de estudio y reflejo sutil bajo el producto.
- Nombre en mayúsculas, blanco; precio dorado jerarquizado.
- Sello de garantía discreto (solo si confirmado).
- [CTA_WHATSAPP] en la zona inferior, equilibrado con el precio.`,
      },
      A3: {
        name: 'A3 — Float',
        objective: 'Producto casi aislado y muy limpio. Estrictamente proporciones reales.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto casi aislado sobre fondo limpio de alto contraste, sin contexto.
- Efecto de "flotación" con sombra suave bajo el producto.
- Mantener estrictamente las proporciones reales: nunca ensanchar ni deformar.
- Precio dorado discreto y legible; nombre en mayúsculas en la parte superior.
- [CTA_WHATSAPP] centrado en la zona inferior.`,
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
        name: 'B1 — Grid',
        objective: 'Especificaciones en módulos tipo grid legibles, sin saturar.',
        cta: 'Consulta por WhatsApp',
        composition: `- Producto centrado en escenario limpio tipo estudio, iluminación técnica.
- Especificaciones organizadas en grid de módulos (3-4 bloques máx), cada uno con icono simple.
- Jerarquía: producto → especificación principal → precio → CTA → secundarios.
- Fondo claro o navy suave; NO saturar el flyer.
- [CTA_WHATSAPP] en el bloque CTA, tras las especificaciones.`,
      },
      B2: {
        name: 'B2 — Minimal',
        objective: 'Mínima información visual, máxima claridad. Producto y datos esenciales.',
        cta: 'Consulta por WhatsApp',
        composition: `- Producto protagonista con fondo muy limpio.
- Solo 2-3 datos clave en texto limpio, sin iconos ni módulos decorativos.
- Espacios amplios, respiración visual.
- Precio dorado como segundo foco.
- [CTA_WHATSAPP] discreto en la parte inferior.`,
      },
      B3: {
        name: 'B3 — Detail',
        objective: 'Detalle técnico del producto. Close-up o función específica.',
        cta: 'Consulta por WhatsApp',
        composition: `- Zoom parcial o vista detallada de una función/aspecto clave del producto.
- Mantener el producto reconocible aunque sea close-up.
- Texto técnico breve explicando la función/ventaja.
- Precio dorado en módulo compacto.
- [CTA_WHATSAPP] compacto.`,
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
        name: 'C1 — Block',
        objective: 'Precio y oportunidad en bloque grande. Conveniencia, no baratura.',
        cta: 'Solo una pieza a este precio — escríbeme',
        composition: `- Precio dorado GRANDE, elemento central dominante en bloque visual.
- Producto junto al precio, con sombra realista.
- Un solo mensaje comercial fuerte por pieza.
- [CTA_WHATSAPP] debajo del precio; es el único CTA de la pieza.
- Sin marcos, sin "¡¡OFERTA!!" ni fuegos artificiales: conveniencia, no baratura.`,
      },
      C2: {
        name: 'C2 — Strike',
        objective: 'Precio tachado con descuento visible. Urgencia controlada.',
        cta: 'Escríbeme antes de que se agote',
        composition: `- Precio anterior tachado en gris, precio actual en dorado grande.
- Producto con buena presencia visual.
- Línea o diagonal naranja sutil separando secciones.
- Mensaje de urgencia: "Oferta limitada" o similar, discreto.
- [CTA_WHATSAPP] compacto.`,
      },
      C3: {
        name: 'C3 — Badge',
        objective: 'Sello/badge de oportunidad sobre el producto.',
        cta: 'Escríbeme y llévate este producto',
        composition: `- Producto con badge circular o rectangular de "Oferta" / "Precio especial".
- Badge en naranja o dorado, sin cubrir partes clave del producto.
- Precio dorado al lado del badge.
- Fondo limpio para que el badge destaque.
- [CTA_WHATSAPP] en la zona inferior.`,
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
        name: 'D1 — Home',
        objective: 'Producto integrado en escena de hogar. Experiencia cotidiana aspiracional.',
        cta: 'Tu próxima aventura empieza aquí — escríbeme',
        composition: `- Entorno de hogar coherente con el producto (sala, cocina, dormitorio, etc.).
- El producto real integrado en la escena, proporciones intactas.
- Precio en dorado, módulo compacto en esquina.
- [CTA_WHATSAPP] compacto en la esquina opuesta al precio.
- La composición puede cambiar radicalmente pero debe reconocerse como DaniMarvis.`,
      },
      D2: {
        name: 'D2 — Use',
        objective: 'Producto en uso. Mostrar la experiencia de utilizarlo.',
        cta: 'Escríbeme y prueba la diferencia',
        composition: `- Producto en uso real o simulado (manos, persona, contexto de uso).
- El producto es el foco pero la experiencia complementa.
- Iluminación cálida y natural.
- Precio dorado discreto en módulo compacto.
- [CTA_WHATSAPP] integrado en la composición.`,
      },
      D3: {
        name: 'D3 — Aspirational',
        objective: 'Escena aspiracional. Vender un estilo de vida, no solo el producto.',
        cta: 'Tu próxima aventura empieza aquí — escríbeme',
        composition: `- Escena aspiracional premium: estilo de vida elevado.
- Producto como pieza clave del estilo, no como catálogo.
- Paleta más sofisticada, manteniendo identidad DaniMarvis.
- Precio dorado muy discreto o ausente si la composición lo requiere.
- [CTA_WHATSAPP] elegante y discreto.`,
      },
    },
  },
};

export const VARIANTS_ORDER = {
  A: ['A1', 'A2', 'A3'],
  B: ['B1', 'B2', 'B3'],
  C: ['C1', 'C2', 'C3'],
  D: ['D1', 'D2', 'D3'],
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

export function listFormats() {
  return Object.entries(FORMATS).map(([key, val]) => ({
    id: key, label: val.label, width: val.width, height: val.height,
  }));
}

// ─── AUTO-SELECCIÓN ─────────────────────────────────────────────────────────

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

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

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

function formatBlock(format) {
  const f = FORMATS[format] || FORMATS['4:5'];
  return `[FORMATO]
Formato: ${f.label} (${f.width}×${f.height} px).
Mantener márgenes seguros de ${f.safe_margin} para lectura en móvil (Facebook/Instagram).
El texto principal y el precio deben estar dentro del área segura.`;
}

function parsePaletteColors(ps) {
  const raw = ps.palette && typeof ps.palette === 'object' ? ps.palette : {};
  return Object.entries(raw)
    .filter(([k]) => k)
    .map(([label, val]) => {
      if (val && typeof val === 'object' && typeof val.hex === 'string') {
        const pct = Number(val.pct);
        return { label, hex: val.hex, pct: Number.isFinite(pct) && pct > 0 ? pct : 0 };
      }
      if (typeof val === 'string' && val.startsWith('#')) {
        return { label, hex: val, pct: 0 };
      }
      return null;
    })
    .filter(Boolean);
}

function pctRange(pct) {
  if (!pct || pct <= 0) return '<5%';
  const lo = Math.max(0, Math.round(pct - 10));
  const hi = Math.min(100, Math.round(pct + 10));
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

function providerStyleBlock(providerStyle) {
  const ps = providerStyle || DEFAULT_PROVIDER_STYLE;
  const colors = parsePaletteColors(ps);

  const paletteStr = colors.length > 0
    ? colors.map(c => `  - ${c.label}: ${c.hex}`).join('\n')
    : 'Usar paleta DaniMarvis estándar.';

  const proportionStr = colors.filter(c => c.pct > 0).length > 0
    ? `Proporción orientativa de la paleta del proveedor (dentro del BRAND_DNA): ${colors
        .filter(c => c.pct > 0)
        .map(c => `${c.label} ${pctRange(c.pct)}`).join(', ')}.`
    : '';

  return `[PROVIDER_STYLE]
Proveedor: ${ps.name}
Código: ${ps.code}
Estilo: ${ps.style_name}
Paleta del perfil:
${paletteStr}
${proportionStr}
Reglas de fondo: ${ps.background_rules}
Reglas de acentos: ${ps.accent_rules}
Firma visual: ${ps.signature_rules}
${ps.negative_rules ? `Restricciones del perfil: ${ps.negative_rules}` : ''}
Regla: usar este perfil para diferenciar visualmente el origen del producto sin
convertirlo en una comunicación obligatoria para el cliente.
No permitir que el perfil de proveedor altere datos del producto, logo principal,
proporciones ni reglas de veracidad.`;
}

// ─── PROMPT BUILDER (Arquitectura v2.0) ────────────────────────────────────
// Secuencia: BRAND_DNA → PROVIDER_STYLE → CREATIVE_MODE → SUBSTYLE →
//            PRODUCT_DATA → COMMERCIAL_SETTINGS → FORMAT → QA

export function buildPrompt(product, options = {}) {
  const familyId = options.family || selectFamily(product);
  const family = FAMILIES[familyId];
  const variantKey = options.variant || VARIANTS_ORDER[familyId][0];
  const variant = family.variants[variantKey];
  const format = options.format || '4:5';
  const providerStyle = options.providerStyle || DEFAULT_PROVIDER_STYLE;

  const price = '$' + Number(product.price || 0).toLocaleString('es-CO');
  const currency = product.commission_currency || 'USD';
  const features = extractFeatures(product.description);
  const featuresText = features.length
    ? features.join(' | ')
    : 'Ninguna especificación confirmada adicional';

  const blocks = [
    BRAND_DNA,
    '',
    providerStyleBlock(providerStyle),
    '',
    HIERARCHY,
    '',
    '[PRODUCTO — FUENTE DE VERDAD]',
    'Se adjunta imagen real del producto. NO modificar proporciones, componentes,',
    'colores, forma ni accesorios.',
    product.name ? `Nombre: ${product.name}` : '',
    product.category ? `Categoría: ${product.category}` : '',
    '',
    '[CREATIVE_MODE]',
    `Modo: ${family.name}`,
    `Objetivo: ${family.question}`,
    '',
    '[SUBSTYLE]',
    `Variante: ${variant.name}`,
    `Descripción: ${variant.objective}`,
    '',
    '[DATOS_AUTORIZADOS]',
    `Nombre: ${product.name}`,
    `Precio: ${price} ${currency}`,
    `Características confirmadas: ${featuresText}`,
    warrantyBlock(product.warranty),
    providerStyle?.shipping_rule || SHIPPING_DEFAULT,
    `CTA: ${variant.cta}`,
    '',
    '[COMPOSICIÓN]',
    variant.composition,
    '',
    formatBlock(format),
    '',
    CTA_WHATSAPP,
    '',
    NEGATIVE_RULES,
    '',
    QA_CHECKLIST,
  ];

  return blocks.filter(b => b !== undefined).join('\n');
}
