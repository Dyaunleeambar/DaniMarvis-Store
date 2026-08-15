# DaniMarvis-Store — Biblioteca de Prompts para ChatGPT v1.0

> Espec derivada de **"DaniMarvis Visual System v1.0"**. Modo de uso: **Opción A — anuncio completo** en el modo de edición de imágenes de ChatGPT, adjuntando la fotografía real del producto.
>
> Alimenta y sustenta la futura integración CRM del panel (`scripts/prompts.json` es el espejo en JSON).

---

## 0. Cómo usar esta biblioteca

1. **Adjunta la foto real del producto** en ChatGPT (modo edición de imagen).
2. Copia el **[CONTRATO GLOBAL]** (sección 1) y pégalo en el mensaje.
3. Elige la familia según el producto (sección 3) y pega su bloque de composición.
4. Sustituye los `{SLOTS}` por los datos del producto (sección 2).
5. Si necesitas un prompt ya rellenado, usa los ejemplos de la **sección 6** (los 4 pilotos).
6. Regenera hasta que la pieza pase el checklist (sección 7).

**Selección de familia (resumen del Visual System §14):**

| Si el producto... | Usa familia |
|---|---|
| Alto interés visual + información sencilla | **A — HERO** |
| Técnico con varias especificaciones | **B — CATALOG** |
| El precio/oportunidad es el argumento central | **C — OFFER** |
| Recreativo o aspiracional | **D — LIFESTYLE** |

---

## 1. Contrato global de marca

Bloque fijo que se antepone a **todo** prompt. No lo modifiques.

```text
Eres un diseñador publicitario sénior de DaniMarvis-Store. Crea un anuncio
publicitario fotorrealista a partir de la FOTOGRAFÍA REAL del producto que
acompaña a esta instrucción (modo edición: úsala como referencia exacta del
producto, no la redibujes desde cero).

FORMATO DE SALIDA: cuadrado 1:1, 1080×1080 px.

IDENTIDAD DE MARCA — DaniMarvis-Store
- Estética: moderna, limpia, técnica y comercial. Premium accesible,
  nunca apariencia de flyer barato.
- Paleta (usa estos colores exactos):
  * Navy profundo #0D2B4E — color estructural dominante (confianza y seriedad).
  * Naranja vibrante #F46B32 — acento dinámico (acción y energía).
  * Dorado #C9A227 — uso selectivo, sobre todo en el precio
    (valor y protagonismo comercial).
  * Blanco #FFFFFF — texto y espacios de respiración.
  * Coral #C9847A — solo como firma cromática sutil del logo.
- Iluminación: equilibrada y profesional. Sombras realistas y discretas,
  reflejo sutil bajo el producto.
- Líneas y diagonales: limpias y controladas. Cohesión visual,
  sin elementos caóticos.

REGLAS DE VERACIDAD (obligatorias)
- El producto de la foto es la FUENTE DE VERDAD: no cambies proporciones,
  colores, forma, componentes ni accesorios.
- No inventes características técnicas, funciones ni accesorios.
- Sin marcas de agua, textos basura, logos inventados ni elementos irrelevantes.
- Los únicos textos permitidos son los listados en [TEXTO EXACTO] y debes
  reproducirlos carácter por carácter. Si no puedes garantizarlos perfectos,
  NO escribas texto y deja el espacio vacío y limpio.
- Márgenes seguros: mínimo 10% del marco libre de información en cada borde.
```

---

## 2. Bloque de datos autorizados (slots)

| Slot | Qué se rellena | Regla |
|---|---|---|
| `{NOMBRE}` | Nombre del producto en MAYÚSCULAS | Desde el CRM. Ej: `NEVERA PREMIER 3.5 PIES` |
| `{PRECIO}` | Precio formateado | Desde el CRM. Ej: `$270 USD` |
| `{CTA}` | Llamado a la acción | Configurable. Por defecto: `CONSULTA POR WHATSAPP` |
| `{GARANTIA}` | Garantía exacta | **Solo si existe**. `GARANTÍA 2 MESES`, `GARANTÍA 1 MES`, `GARANTÍA 15 DÍAS`. Si no hay garantía registrada → **omitir el bloque completo** (no usar "GARANTÍA DE CALIDAD") |
| `{CARACTERISTICAS}` | Máx. 4 especificaciones autorizadas | Solo datos del CRM, una por línea |
| `{ESCENA}` | Escenario (solo familia D) | Configurable por producto |

---

## 3. Prompts maestros por familia

Cada bloque se pega **después del [CONTRATO GLOBAL]**.

### 3.1 A1 — HERO · IMPACT

*Objetivo: detener el scroll. Producto grande, nombre claro, precio protagonista, información mínima.*

```text
COMPOSICIÓN — VARIANTE A1 (IMPACT):
- Producto dominante: 60%–70% del encuadre, centrado o ligeramente desplazado.
- Fondo: estudio minimalista premium. Degradado suave navy #0D2B4E a un tono
  más oscuro (o gris técnico claro si el producto es oscuro). Sin elementos
  que compitan con el producto.
- Un único acento naranja #F46B32: franja o línea diagonal fina que recorra
  el fondo (controlada, no caótica).
- Sombra realista bajo el producto y reflejo sutil.
- Jerarquía de texto (bloque inferior, dentro del margen seguro):
  1. NOMBRE: "{NOMBRE}" — blanco, mayúsculas, sans-serif limpia.
  2. PRECIO: "{PRECIO}" — dorado #C9A227, el texto más grande y protagonista,
     con línea fina dorada debajo.
  3. CTA: "{CTA}" — naranja #F46B32.
  4. GARANTÍA (si existe): "{GARANTIA}" — blanco, pequeño y secundario.
- Texto mínimo: nada más que lo indicado.

[TEXTO EXACTO]
- {NOMBRE}
- {PRECIO}
- {CTA}
- {GARANTIA}   (solo si aplica)

RESTRICCIONES:
- No deformar el producto; proporciones estrictamente reales.
- Sin otros textos, marcas de agua, logos ni iconos.
- Sin sombras exageradas ni brillos falsos sobre el producto.
```

### 3.2 A2 — HERO · PREMIUM

*Objetivo: producto protagonista con contexto controlado. Refuerza confianza y percepción de tienda seria.*

```text
COMPOSICIÓN — VARIANTE A2 (PREMIUM):
- Producto protagonista: 45%–55% del encuadre, integrado en un contexto
  controlado y de calidad que refuerce confianza (un rincón de cocina, hogar
  o estudio sobrio, coherente con el producto).
- Paleta del contexto: neutros + navy #0D2B4E como acento estructural;
  un único detalle naranja #F46B32 (objeto pequeño, franja, elemento
  decorativo).
- El producto debe sentirse "en su elemento": sombra y contacto natural
  con la superficie real.
- Iluminación profesional, cinematográfica suave.
- Jerarquía de texto sobre franja navy semitransparente en el bloque inferior
  (legibilidad garantizada):
  1. NOMBRE: "{NOMBRE}" — blanco, mayúsculas.
  2. PRECIO: "{PRECIO}" — dorado #C9A227, protagonista.
  3. CTA: "{CTA}" — naranja #F46B32.
  4. GARANTÍA (si existe): "{GARANTIA}" — blanco, pequeño.

[TEXTO EXACTO]
- {NOMBRE}
- {PRECIO}
- {CTA}
- {GARANTIA}   (solo si aplica)

RESTRICCIONES:
- Mantener fidelidad física total del producto real.
- Sin texto inventado; si no puedes reproducir el texto exacto, déjalo vacío.
```

### 3.3 A3 — HERO · FOCUS

*Objetivo: producto casi aislado, máximo limpio. Proporciones estrictamente reales.*

```text
COMPOSICIÓN — VARIANTE A3 (FOCUS):
- Producto casi aislado sobre fondo neutro limpio (blanco #FFFFFF o gris
  claro #F2F2F2), centrado, ocupando 50%–60% del encuadre.
- Sin objetos de fondo ni patrones. Solo sombra flotante sutil y reflejo
  suave bajo el producto.
- Micro-acentos de marca: una línea dorada #C9A227 horizontal fina bajo el
  producto y/o un punto naranja #F46B32 pequeño en una esquina.
- Proporciones estrictamente reales: NUNCA ensanchar, estirar ni deformar
  el producto para ganar impacto.
- Jerarquía de texto (bloque inferior):
  1. NOMBRE: "{NOMBRE}" — navy #0D2B4E si el fondo es claro, blanco si es
     navy. Mayúsculas.
  2. PRECIO: "{PRECIO}" — dorado #C9A227.
  3. CTA: "{CTA}" — naranja #F46B32, discreto.
  4. GARANTÍA (si existe): "{GARANTIA}".

[TEXTO EXACTO]
- {NOMBRE}
- {PRECIO}
- {CTA}
- {GARANTIA}   (solo si aplica)

RESTRICCIONES:
- Proporciones y geometría del producto idénticas a la foto real.
- Minimalismo extremo: menos es más.
```

### 3.4 B — CATALOG

*Objetivo: presentar productos técnicos. Organizar especificaciones en módulos legibles sin saturar.*

```text
COMPOSICIÓN — VARIANTE B (CATALOG):
- Estructura de ficha técnica publicitaria en 1:1. Producto a la izquierda
  o centro-superior, 40%–50% del encuadre.
- Fondo: navy #0D2B4E oscuro o blanco, según contraste con el producto.
  Limpio, sin competir.
- Prioridad visual estricta:
  1. PRODUCTO (imagen real).
  2. NOMBRE: "{NOMBRE}" — gran titular.
  3. ESPECIFICACIONES (máx. 4 autorizadas), organizadas en módulos/píldoras
     legibles (tarjetas o líneas con iconos geométricos delgados, mismo estilo):
     {CARACTERISTICAS}
  4. PRECIO: "{PRECIO}" — dorado #C9A227, destacado.
  5. CTA: "{CTA}" — naranja #F46B32.
  6. GARANTÍA (si existe): "{GARANTIA}".
- Las especificaciones se ORGANIZAN, no saturan: si hay más de 4, mostrar
  solo las 4 principales.

[TEXTO EXACTO]
- {NOMBRE}
- {PRECIO}
- {CTA}
- {GARANTIA}   (solo si aplica)
- Especificaciones: {CARACTERISTICAS}

RESTRICCIONES:
- No inventar especificaciones: solo las listadas.
- Iconos simples y coherentes; nada complejo ni realista.
```

### 3.5 C — OFFER

*Objetivo: precio y oportunidad protagonistas. Debe parecer conveniente, nunca barato. Una sola idea fuerte por pieza.*

```text
COMPOSICIÓN — VARIANTE C (OFFER):
- El PRECIO y la oportunidad son los protagonistas. Tono: oferta seria,
  NUNCA flyer barato.
- Producto 40%–55% del encuadre, presentado con calidad premium
  (iluminación profesional, sombra realista).
- Fondo: navy #0D2B4E con acento dorado #C9A227 suave o naranja #F46B32
  moderado. Luz radial o degradado sutil que concentre la atención al centro.
- UN solo mensaje comercial fuerte por pieza (regla C): no apilar ofertas,
  descuentos y beneficios a la vez.
- Jerarquía:
  1. PRECIO: "{PRECIO}" — dorado #C9A227, MUY grande, protagonista absoluto,
     con línea fina dorada.
  2. NOMBRE: "{NOMBRE}" — blanco, mayúsculas, secundario.
  3. CTA: "{CTA}" — naranja #F46B32, claro.
  4. GARANTÍA (si existe): "{GARANTIA}" — pequeño, genera confianza.
- Sin rayos, sin colores estridentes en exceso, sin emojis.

[TEXTO EXACTO]
- {PRECIO}
- {NOMBRE}
- {CTA}
- {GARANTIA}   (solo si aplica)

RESTRICCIONES:
- No inventar descuentos, ofertas ni beneficios no registrados.
```

### 3.6 D — LIFESTYLE

*Objetivo: vender la experiencia. Entorno aspiracional o cotidiano coherente, con fidelidad física total.*

```text
COMPOSICIÓN — VARIANTE D (LIFESTYLE):
- Vende la experiencia: el producto en un entorno aspiracional o cotidiano
  coherente con su uso real. Escenario sugerido: {ESCENA}.
- El producto mantiene su fidelidad física al 100%: proporciones, colores,
  componentes y accesorios idénticos a la foto real.
- Regla: vender sensación, NO inventar especificaciones.
- Luz cinematográfica suave; atmósfera cálida o limpia según el producto.
  Las personas solo si se ven naturales y no tapan el producto.
- Texto mínimo, discreto y elegante (bloque inferior con halo sutil para
  legibilidad):
  1. NOMBRE: "{NOMBRE}" — blanco o navy según el fondo.
  2. PRECIO: "{PRECIO}" — dorado #C9A227.
  3. CTA: "{CTA}" — naranja #F46B32.
  4. GARANTÍA (si existe): "{GARANTIA}".
- La composición puede cambiar radicalmente, pero debe reconocerse como
  DaniMarvis-Store (paleta y limpieza).

[TEXTO EXACTO]
- {NOMBRE}
- {PRECIO}
- {CTA}
- {GARANTIA}   (solo si aplica)

RESTRICCIONES:
- No inventar especificaciones técnicas.
- El producto nunca debe verse alterado por el entorno.
```

---

## 4. Regla de garantía (Visual System §11)

| Dato en CRM | Texto a renderizar |
|---|---|
| `15 días` | `GARANTÍA 15 DÍAS` |
| `1 mes` | `GARANTÍA 1 MES` |
| `2 meses` | `GARANTÍA 2 MESES` |
| `no tiene` / vacío | **No mostrar sello ni mención** |
| cualquier otro valor | Reproducir el valor exacto |

Nunca usar "GARANTÍA DE CALIDAD" ni sustitutos ambiguos.

---

## 5. Ejemplos rellenados — los 4 pilotos

Prompts completos (contrato + composición + datos) listos para copiar. Adjunta SIEMPRE la foto real del producto.

### 5.1 Nevera Premier 3.5 pies → A1 · IMPACT ($270 USD · garantía 2 meses)

```text
Eres un diseñador publicitario sénior de DaniMarvis-Store. Crea un anuncio
publicitario fotorrealista a partir de la FOTOGRAFÍA REAL del producto que
acompaña a esta instrucción (modo edición: úsala como referencia exacta del
producto, no la redibujes desde cero).

FORMATO DE SALIDA: cuadrado 1:1, 1080×1080 px.

IDENTIDAD DE MARCA — DaniMarvis-Store
- Estética: moderna, limpia, técnica y comercial. Premium accesible,
  nunca apariencia de flyer barato.
- Paleta (usa estos colores exactos):
  * Navy profundo #0D2B4E — color estructural dominante (confianza y seriedad).
  * Naranja vibrante #F46B32 — acento dinámico (acción y energía).
  * Dorado #C9A227 — uso selectivo, sobre todo en el precio
    (valor y protagonismo comercial).
  * Blanco #FFFFFF — texto y espacios de respiración.
  * Coral #C9847A — solo como firma cromática sutil del logo.
- Iluminación: equilibrada y profesional. Sombras realistas y discretas,
  reflejo sutil bajo el producto.
- Líneas y diagonales: limpias y controladas. Cohesión visual,
  sin elementos caóticos.

REGLAS DE VERACIDAD (obligatorias)
- El producto de la foto es la FUENTE DE VERDAD: no cambies proporciones,
  colores, forma, componentes ni accesorios.
- No inventes características técnicas, funciones ni accesorios.
- Sin marcas de agua, textos basura, logos inventados ni elementos irrelevantes.
- Los únicos textos permitidos son los listados en [TEXTO EXACTO] y debes
  reproducirlos carácter por carácter. Si no puedes garantizarlos perfectos,
  NO escribas texto y deja el espacio vacío y limpio.
- Márgenes seguros: mínimo 10% del marco libre de información en cada borde.

COMPOSICIÓN — VARIANTE A1 (IMPACT):
- Producto dominante: 60%–70% del encuadre, centrado o ligeramente desplazado.
- Fondo: estudio minimalista premium. Degradado suave navy #0D2B4E a un tono
  más oscuro. Sin elementos que compitan con el producto.
- Un único acento naranja #F46B32: franja o línea diagonal fina que recorra
  el fondo (controlada, no caótica).
- Sombra realista bajo el producto y reflejo sutil.
- Jerarquía de texto (bloque inferior, dentro del margen seguro):
  1. NOMBRE: "NEVERA PREMIER 3.5 PIES" — blanco, mayúsculas, sans-serif limpia.
  2. PRECIO: "$270 USD" — dorado #C9A227, el texto más grande y protagonista,
     con línea fina dorada debajo.
  3. CTA: "CONSULTA POR WHATSAPP" — naranja #F46B32.
  4. GARANTÍA: "GARANTÍA 2 MESES" — blanco, pequeño y secundario.
- Texto mínimo: nada más que lo indicado.

[TEXTO EXACTO]
- NEVERA PREMIER 3.5 PIES
- $270 USD
- CONSULTA POR WHATSAPP
- GARANTÍA 2 MESES

RESTRICCIONES:
- No deformar el producto; proporciones estrictamente reales.
- Sin otros textos, marcas de agua, logos ni iconos.
- Sin sombras exageradas ni brillos falsos sobre el producto.
```

> **A2 y A3 (misma nevera):** sustituye el bloque `COMPOSICIÓN — VARIANTE A1` por el de la sección 3.2 (A2) o 3.3 (A3), y sustituye el encabezado `VARIANTE A1 (IMPACT)` por `VARIANTE A2 (PREMIUM)` o `VARIANTE A3 (FOCUS)`. Los datos del producto son idénticos.

### 5.2 Bluetti Elite 100 V2 → B · CATALOG ($780 USD · sin garantía)

> Sin garantía registrada → **no aparece ningún texto de garantía** (se omite el punto 6 y el slot).

```text
[Pega aquí el CONTRATO GLOBAL completo de la sección 1]

COMPOSICIÓN — VARIANTE B (CATALOG):
- Estructura de ficha técnica publicitaria en 1:1. Producto a la izquierda
  o centro-superior, 40%–50% del encuadre.
- Fondo: navy #0D2B4E oscuro, limpio, sin competir con el producto.
- Prioridad visual estricta:
  1. PRODUCTO (imagen real).
  2. NOMBRE: "BLUETTI ELITE 100 V2" — gran titular.
  3. ESPECIFICACIONES (máx. 4 autorizadas), en módulos/píldoras legibles
     con iconos geométricos delgados:
     - 1800W de salida nominal · 2700W pico
     - Batería LiFePO4 · más de 4000 ciclos · 10 años de vida útil
     - Carga turbo: 80% en 45 min (entrada AC 1200W)
     - 9 puertos para electrodomésticos · respaldo UPS en 10 ms
  4. PRECIO: "$780 USD" — dorado #C9A227, destacado.
  5. CTA: "CONSULTA POR WHATSAPP" — naranja #F46B32.
- Las especificaciones se ORGANIZAN, no saturan.

[TEXTO EXACTO]
- BLUETTI ELITE 100 V2
- $780 USD
- CONSULTA POR WHATSAPP
- Especificaciones: 1800W de salida nominal · 2700W pico / Batería LiFePO4 ·
  más de 4000 ciclos · 10 años de vida útil / Carga turbo: 80% en 45 min
  (entrada AC 1200W) / 9 puertos para electrodomésticos · respaldo UPS en 10 ms

RESTRICCIONES:
- No inventar especificaciones: solo las listadas.
- No mostrar garantía (el producto no tiene garantía registrada).
- Iconos simples y coherentes; nada complejo ni realista.
```

### 5.3 Freidora de aire Milexus 4.2 L → C · OFFER ($65 USD · garantía 1 mes)

```text
[Pega aquí el CONTRATO GLOBAL completo de la sección 1]

COMPOSICIÓN — VARIANTE C (OFFER):
- El PRECIO y la oportunidad son los protagonistas. Tono: oferta seria,
  NUNCA flyer barato.
- Producto 40%–55% del encuadre, presentado con calidad premium
  (iluminación profesional, sombra realista).
- Fondo: navy #0D2B4E con acento dorado #C9A227 suave. Luz radial o degradado
  sutil que concentre la atención al centro.
- UN solo mensaje comercial fuerte por pieza: el precio.
- Jerarquía:
  1. PRECIO: "$65 USD" — dorado #C9A227, MUY grande, protagonista absoluto,
     con línea fina dorada.
  2. NOMBRE: "FREIDORA DE AIRE MILEXUS 4.2 L" — blanco, mayúsculas,
     secundario.
  3. CTA: "CONSULTA POR WHATSAPP" — naranja #F46B32, claro.
  4. GARANTÍA: "GARANTÍA 1 MES" — pequeño, genera confianza.
- Sin rayos, sin colores estridentes en exceso, sin emojis.

[TEXTO EXACTO]
- $65 USD
- FREIDORA DE AIRE MILEXUS 4.2 L
- CONSULTA POR WHATSAPP
- GARANTÍA 1 MES

RESTRICCIONES:
- No inventar descuentos, ofertas ni beneficios no registrados.
```

### 5.4 Bicicleta Challenger 24 → D · LIFESTYLE ($200 USD · garantía 1 mes)

```text
[Pega aquí el CONTRATO GLOBAL completo de la sección 1]

COMPOSICIÓN — VARIANTE D (LIFESTYLE):
- Vende la experiencia: el producto en un entorno aspiracional o cotidiano
  coherente con su uso real.
- Escenario sugerido: camino urbano soleado a la hora dorada; una persona
  joven pedaleando con naturalidad, sensación de libertad y aire libre.
- El producto mantiene su fidelidad física al 100%: proporciones, colores,
  componentes y accesorios idénticos a la foto real.
- Regla: vender sensación, NO inventar especificaciones.
- Luz cinematográfica suave; atmósfera cálida. La persona no tapa el producto.
- Texto mínimo, discreto y elegante (bloque inferior con halo sutil):
  1. NOMBRE: "BICICLETA CHALLENGER 24" — blanco o navy según el fondo.
  2. PRECIO: "$200 USD" — dorado #C9A227.
  3. CTA: "CONSULTA POR WHATSAPP" — naranja #F46B32.
  4. GARANTÍA: "GARANTÍA 1 MES" — pequeño.
- La composición puede cambiar radicalmente, pero debe reconocerse como
  DaniMarvis-Store (paleta y limpieza).

[TEXTO EXACTO]
- BICICLETA CHALLENGER 24
- $200 USD
- CONSULTA POR WHATSAPP
- GARANTÍA 1 MES

RESTRICCIONES:
- No inventar especificaciones técnicas.
- El producto nunca debe verse alterado por el entorno.
```

---

## 6. Protocolo golden test

Antes de congelar cualquier prompt como "versión oficial", pruébalo con los pilotos:

| # | Producto | Familia/Variante | Resultado | Acepta | Notas |
|---|---|---|---|---|---|
| 1 | Nevera Premier 3.5 pies | A1 | | | |
| 2 | Nevera Premier 3.5 pies | A2 | | | |
| 3 | Nevera Premier 3.5 pies | A3 | | | |
| 4 | Bluetti Elite 100 V2 | B | | | |
| 5 | Freidora Milexus 4.2 L | C | | | |
| 6 | Bicicleta Challenger 24 | D | | | |

**Procedimiento:**
1. Genera la imagen con la foto real adjunta.
2. Evalúa contra el checklist (sección 7).
3. Si falla, corrige el prompt (máx. 3 iteraciones) y anota el ajuste.
4. Congela la versión validada en `scripts/prompts.json`.

**Fallos típicos de ChatGPT y su corrección:**

| Fallo | Corrección sugerida |
|---|---|
| Producto deformado/inventado | Reforzar: "usa la foto adjunta como referencia exacta; no redibujes" |
| Texto con errores | Activar la cláusula: "si no puedes reproducir el texto exacto, NO escribas texto" |
| Pieza saturada | Reducir especificaciones a 3–4; añadir "mínimo absoluto" |
| Aspecto de flyer barato | Reforzar: "premium accesible, tono serio, sin rayos ni emojis" |

---

## 7. Checklist de aceptación (Visual System §17)

- [ ] Producto coincide con la imagen real (sin deformaciones).
- [ ] Nombre y precio coinciden con el CRM.
- [ ] Todas las características están respaldadas.
- [ ] Garantía existe y coincide, si aparece. Si no hay garantía → sin sello.
- [ ] Logo correcto (o ausencia correcta de logo).
- [ ] Proporciones del producto creíbles.
- [ ] Precio legible en móvil.
- [ ] Márgenes y jerarquía correctos.
- [ ] La pieza cumple el objetivo comercial de la familia elegida.
- [ ] La publicación se reconoce como DaniMarvis aunque cambie la composición.

---

## 8. Rotación creativa (Visual System §15)

| Familia | Secuencia sugerida |
|---|---|
| A — HERO | A1 → A2 → A3 → A1 |
| B — CATALOG | B (variar ángulo y nº de specs) |
| C — OFFER | C (variar CTA) |
| D — LIFESTYLE | D (variar escena) |

Regla: no repetir la misma variante dos publicaciones seguidas del mismo producto. Registrar `last_template` y `creative_history` en el CRM.

---

## 9. Notas de evolución (pivot a Opción B)

Este spec está diseñado para Opción A (anuncio completo). Si la fidelidad del producto o el texto no alcanzan el estándar del Visual System, se puede pivotar a **Opción B (composición en dos capas)** sin rehacer nada: se reutiliza el mismo contrato, paleta y familias, pero el prompt pide **solo el escenario/fondo con zonas seguras vacías**, y el motor Canvas del panel compone encima producto real, precio, logo, garantía y CTA de forma determinista.
