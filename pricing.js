// pricing.js
// Única fuente de verdad para el cálculo de precios.
// El frontend consulta /api/price para mostrar el precio en vivo,
// pero el precio final SIEMPRE se recalcula acá en el servidor al crear el pedido.
// Así un usuario no puede manipular el precio editando el HTML/JS del navegador.

const MIN_CM = 2;
const MAX_CM = 15;

// STICKER SUELTO: precio fijo por unidad, sin importar el tamaño (2 a 15 cm), en pesos ARS.  (EDITÁ ACÁ)
// Es más caro que en la plancha a propósito: la plancha conviene para cantidades.
const SINGLE_PRICE = 800;

function clampSize(sizeCm) {
  const n = Number(sizeCm);
  if (Number.isNaN(n)) return 5;
  return Math.min(MAX_CM, Math.max(MIN_CM, n));
}

const unitPriceForSize = () => SINGLE_PRICE;
// Sin descuentos por cantidad en sueltos (queda la función por si algún día querés volver a usarlos)
const discountForQty = () => 0;

// items: [{ sizeCm, qty }, ...]  (todos los items de UN pedido, para calcular el descuento combinado)
function calcOrder(items) {
  const totalQty = items.reduce((acc, it) => acc + Math.max(1, parseInt(it.qty, 10) || 1), 0);
  const discount = discountForQty(totalQty);

  const lines = items.map((it) => {
    const size = clampSize(it.sizeCm);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unit = unitPriceForSize(size);
    const lineSubtotal = unit * qty;
    const lineTotal = Math.round((lineSubtotal * (1 - discount)) / 10) * 10;
    return { sizeCm: size, qty, unitPrice: unit, subtotal: lineSubtotal, total: lineTotal };
  });

  const total = lines.reduce((acc, l) => acc + l.total, 0);

  return { lines, totalQty, discount, total };
}

// ==========================================================================
// PLANCHA DE STICKERS — el cliente arma su propia plancha de 58 x 50 cm por un
// precio fijo, con los diseños que quiera (cada uno con su medida y cantidad).
// Si lo que arma no entra en una plancha, se suman planchas (cada una al mismo precio).
// Siempre se deja un margen mínimo entre stickers y contra el borde para el corte.
// ==========================================================================

const SHEET = {
  widthCm: 58,        // ancho de la plancha
  lengthCm: 50,       // largo de la plancha
  price: 18000,       // precio de cada plancha de 58 x 50 cm, ARS  (EDITÁ ACÁ)
  gapCm: 0.5,         // separación mínima entre stickers (y contra el borde) en cm  (EDITÁ ACÁ)
  maxStickerCm: 30,   // lado más grande permitido para un sticker de la plancha
};

// Medidas recomendadas según el uso (se muestran en la web para guiar al cliente).
// min/max/ideal son el ANCHO del sticker en cm.
const SIZE_GUIDE = [
  { id: 'termo', label: 'Termo / botella', min: 4, ideal: 5, max: 7, tip: 'Varios chicos de 4 a 6 cm se ven mejor que uno grande. Dejá 1 grande de 7 cm como estrella.' },
  { id: 'funda', label: 'Funda de celular', min: 3, ideal: 4, max: 6, tip: 'La parte de atrás mide unos 7 × 15 cm: de 3 a 5 cm entran 2 o 3 sin tapar la cámara.' },
  { id: 'notebook', label: 'Notebook', min: 5, ideal: 8, max: 12, tip: 'La tapa de una notebook de 14" mide unos 32 × 22 cm: combiná 1 de 10 cm con varios de 5 a 7 cm.' },
  { id: 'cuaderno', label: 'Cuaderno / carpeta', min: 5, ideal: 7, max: 10, tip: 'Tapas de 21 × 30 cm: de 6 a 8 cm queda equilibrado.' },
  { id: 'mate', label: 'Mate / vaso', min: 3, ideal: 4, max: 6, tip: 'Superficie curva y chica: elegí stickers de 3 a 5 cm.' },
  { id: 'casco', label: 'Casco / bici / auto', min: 8, ideal: 10, max: 15, tip: 'Se ven de lejos: de 8 a 12 cm. El vinilo UV aguanta sol y agua.' },
];

// Acomodado automático (nesting) con el método MaxRects: ubica cada sticker (rectángulo
// ancho x alto) en el mejor hueco libre de la plancha, de mayor a menor. Si no entra en
// la plancha actual, abre una nueva. Es una estimación conservadora (no rota los stickers).
// items: [{ sizeCm (ancho), aspect (alto/ancho), qty }]
function stickerDims(it) {
  const w0 = clampSheetSize(it.sizeCm);
  let aspect = Number(it.aspect);
  if (!(aspect > 0)) aspect = 1;
  aspect = Math.min(10, Math.max(0.1, aspect));
  let w = Math.round(w0 * 10) / 10, h = Math.round(w * aspect * 10) / 10;
  const maxSide = SHEET.maxStickerCm;
  if (h > maxSide) { w = Math.round((w * maxSide / h) * 10) / 10; h = maxSide; } // se achica manteniendo proporción
  if (w < 1) w = 1;
  return { w, h };
}

function clampSheetSize(sizeCm) {
  const n = Number(sizeCm);
  if (Number.isNaN(n)) return 5;
  return Math.min(SHEET.maxStickerCm, Math.max(MIN_CM, n));
}

function packSheet(items) {
  const { widthCm, lengthCm, gapCm } = SHEET;
  const binW = widthCm - gapCm, binH = lengthCm - gapCm; // cada sticker se "infla" con 1 gap

  const units = [];
  items.forEach((it, itemIndex) => {
    const { w, h } = stickerDims(it);
    const qty = Math.max(1, Math.min(500, parseInt(it.qty, 10) || 1));
    for (let i = 0; i < qty; i++) units.push({ itemIndex, w, h });
  });
  units.sort((a, b) => b.h * b.w - a.h * a.w || b.h - a.h);

  const pages = []; // cada página: { free: [rects], used: 0 }
  const newPage = () => { const pg = { free: [{ x: 0, y: 0, w: binW, h: binH }], used: 0, area: 0 }; pages.push(pg); return pg; };
  const placements = [];
  const EPS = 1e-6;

  function tryPlace(pg, w, h) {
    let best = null;
    for (const r of pg.free) {
      if (w <= r.w + EPS && h <= r.h + EPS) {
        const short = Math.min(r.w - w, r.h - h), long = Math.max(r.w - w, r.h - h);
        if (!best || short < best.short - EPS || (Math.abs(short - best.short) < EPS && long < best.long)) best = { x: r.x, y: r.y, short, long };
      }
    }
    return best;
  }
  function splitFree(pg, px, py, pw, ph) {
    const next = [];
    for (const r of pg.free) {
      if (px >= r.x + r.w - EPS || px + pw <= r.x + EPS || py >= r.y + r.h - EPS || py + ph <= r.y + EPS) { next.push(r); continue; }
      if (px > r.x + EPS) next.push({ x: r.x, y: r.y, w: px - r.x, h: r.h });
      if (px + pw < r.x + r.w - EPS) next.push({ x: px + pw, y: r.y, w: r.x + r.w - (px + pw), h: r.h });
      if (py > r.y + EPS) next.push({ x: r.x, y: r.y, w: r.w, h: py - r.y });
      if (py + ph < r.y + r.h - EPS) next.push({ x: r.x, y: py + ph, w: r.w, h: r.y + r.h - (py + ph) });
    }
    // descartamos huecos contenidos en otros
    pg.free = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS && (i > j || a.w < b.w - EPS || a.h < b.h - EPS)));
  }

  for (const u of units) {
    const iw = u.w + gapCm, ih = u.h + gapCm;
    let pageIdx = -1, spot = null;
    for (let i = 0; i < pages.length && !spot; i++) { spot = tryPlace(pages[i], iw, ih); if (spot) pageIdx = i; }
    if (!spot) { pages.push(null); pages.pop(); const pg = newPage(); spot = tryPlace(pg, iw, ih); pageIdx = pages.length - 1; }
    const pg = pages[pageIdx];
    splitFree(pg, spot.x, spot.y, iw, ih);
    const x = Math.round((spot.x + gapCm) * 100) / 100, y = Math.round((spot.y + gapCm) * 100) / 100;
    pg.used = Math.max(pg.used, y + u.h + gapCm);
    pg.area += u.w * u.h;
    placements.push({ itemIndex: u.itemIndex, w: u.w, h: u.h, x, y, plancha: pageIdx, fits: true });
  }

  const planchas = units.length ? pages.length : 0;
  const totalArea = pages.reduce((a, pg) => a + pg.area, 0);
  const lastUsed = planchas ? pages[planchas - 1].used : 0;
  return {
    fits: planchas > 0,
    widthCm, lengthCm, gapCm,
    planchas,
    price: planchas * SHEET.price,
    usedLengthCm: Math.round(Math.min(lengthCm, lastUsed) * 10) / 10, // largo ocupado en la última plancha
    fillPct: planchas ? Math.round((totalArea / (planchas * widthCm * lengthCm)) * 100) : 0,
    placements,
    totalUnits: units.length,
    overflowCount: 0,
  };
}

module.exports = { MIN_CM, MAX_CM, SINGLE_PRICE, unitPriceForSize, discountForQty, calcOrder, clampSize, SHEET, SIZE_GUIDE, packSheet, stickerDims };

// =========================================================================
// PRENDAS (remeras, crop top, musculosa, buzo)
//
// LISTA DE PRECIOS — editá acá los valores. Cada prenda tiene:
//   both:  precio con DOBLE estampa (adelante y atrás), mismos 3 escalones
//   front: precio ESTAMPADA según la cantidad de prendas estampadas del pedido
//          [minorista, intermedio, mayorista]
// El escalón se define con el total de prendas CON estampa del pedido (se suman todas).
// Los costos de tu lista NO se usan en la web: están abajo solo como referencia interna.
// =========================================================================
const TIERS = [
  { min: 1, label: '1 a 10 u.', name: 'Minorista' },
  { min: 11, label: '11 a 14 u.', name: 'Intermedio' },
  { min: 15, label: '15 o más', name: 'Mayorista' },
];

// Precios de tu lista (nalv.estudio): cada prenda tiene los 3 escalones para 1 estampa (front) y
// doble estampa (both). La doble estampa suma $3.000 en remeras/tops y $6.000 en buzos.
// ⚠️ Tu lista NO trae "Remera niño": se calcula como % de la Remera Clásica (0.8 = 20% más barata).
const PRECIO_NINO_MULT = 0.8;

const PRINT_LABELS = { front: 'Estampa adelante', both: 'Doble estampa (adelante y atrás)' };

const PRENDA_COSTOS = { remera_basica: 5800, remera_especial: 6800, crop_top: 4200, musculosa: 5000, buzo_canguro: 20000 }; // referencia interna

const round50 = (n) => Math.round(n / 50) * 50;
// Solo se vende prenda estampada. front/both = [minorista, intermedio, mayorista]
const CLASICA_PRICES = { front: [17000, 14000, 13000], both: [20000, 17000, 15000] };

const GARMENTS = [
  { id: 'remera_basica', label: 'Remera clásica', geometry: 'tee', prices: CLASICA_PRICES, material: 'Algodón 24/1 · buena calidad',
    sizes: [
      { id: 'XS', label: 'XS', chestCm: 42, lengthCm: 62 }, { id: 'S', label: 'S', chestCm: 47, lengthCm: 66 },
      { id: 'M', label: 'M', chestCm: 49, lengthCm: 68 }, { id: 'L', label: 'L', chestCm: 51, lengthCm: 70 },
      { id: 'XL', label: 'XL', chestCm: 53, lengthCm: 72 }, { id: 'XXL', label: 'XXL', chestCm: 55, lengthCm: 74 },
    ] },
  { id: 'remera_especial', label: 'Remera talle especial', geometry: 'tee', prices: { front: [19000, 16000, 14000], both: [22000, 19000, 16000] }, material: 'Algodón 24/1 · buena calidad',
    sizes: [
      { id: '6', label: '6', chestCm: 59, lengthCm: 78 }, { id: '7', label: '7', chestCm: 61, lengthCm: 80 },
      { id: '8', label: '8', chestCm: 63, lengthCm: 82 }, { id: '9', label: '9', chestCm: 65, lengthCm: 84 },
      { id: '10', label: '10', chestCm: 67, lengthCm: 86 },
    ] },
  { id: 'remera_nino', label: 'Remera niño', geometry: 'tee',
    prices: { front: CLASICA_PRICES.front.map((x) => round50(x * PRECIO_NINO_MULT)), both: CLASICA_PRICES.front.map((x) => round50(x * PRECIO_NINO_MULT) + 3000) },
    material: 'Algodón 24/1 · buena calidad',
    sizes: [
      { id: '6', label: '6', chestCm: 32, lengthCm: 46 }, { id: '8', label: '8', chestCm: 34, lengthCm: 48 },
      { id: '10', label: '10', chestCm: 36, lengthCm: 50 }, { id: '12', label: '12', chestCm: 38, lengthCm: 52 },
      { id: '14', label: '14', chestCm: 40, lengthCm: 54 }, { id: '16', label: '16', chestCm: 42, lengthCm: 56 },
    ] },
  { id: 'crop_top', label: 'Crop top', geometry: 'crop', prices: { front: [13000, 11000, 9000], both: [16000, 14000, 12000] }, material: 'Algodón 24/1 · buena calidad',
    sizes: [
      { id: 'S', label: 'S', chestCm: 40, lengthCm: 40 }, { id: 'M', label: 'M', chestCm: 42, lengthCm: 42 },
      { id: 'L', label: 'L', chestCm: 44, lengthCm: 44 }, { id: 'XL', label: 'XL', chestCm: 46, lengthCm: 46 },
    ] },
  { id: 'musculosa', label: 'Musculosa', geometry: 'tank', prices: { front: [15000, 12500, 10000], both: [18000, 15500, 13000] }, material: 'Algodón 24/1 · buena calidad',
    sizes: [
      { id: 'S', label: 'S', chestCm: 48, lengthCm: 66 }, { id: 'M', label: 'M', chestCm: 50, lengthCm: 68 },
      { id: 'L', label: 'L', chestCm: 52, lengthCm: 70 }, { id: 'XL', label: 'XL', chestCm: 54, lengthCm: 72 },
      { id: 'XXL', label: 'XXL', chestCm: 56, lengthCm: 74 },
    ] },
  { id: 'buzo_canguro', label: 'Buzo canguro frisa', geometry: 'hoodie', prices: { front: [38000, 33000, 30000], both: [44000, 39000, 36000] }, material: 'Friza · con capucha y bolsillo',
    sizes: [
      { id: 'S', label: 'S', chestCm: 50, lengthCm: 62 }, { id: 'M', label: 'M', chestCm: 52, lengthCm: 64 },
      { id: 'L', label: 'L', chestCm: 54, lengthCm: 66 }, { id: 'XL', label: 'XL', chestCm: 56, lengthCm: 68 },
      { id: 'XXL', label: 'XXL', chestCm: 58, lengthCm: 70 },
    ] },
];

const SHIRT_COLORS = [
  { id: 'blanco', label: 'Blanco', hex: '#F4F2EC' },
  { id: 'negro', label: 'Negro', hex: '#161616' },
  { id: 'gris', label: 'Gris', hex: '#A6A6A0' },
  { id: 'marino', label: 'Azul marino', hex: '#1F2A44' },
  { id: 'bordo', label: 'Bordó', hex: '#5C1F2A' },
  { id: 'verde', label: 'Verde militar', hex: '#4B5320' },
  { id: 'arena', label: 'Arena', hex: '#D8C8A8' },
];

function tierIndex(qty) {
  let idx = 0;
  TIERS.forEach((t, i) => { if (qty >= t.min) idx = i; });
  return idx;
}

// printedQty: total de prendas del pedido (todas llevan estampa; define el escalón de precio)
function garmentUnitPrice(garment, print, printedQty) {
  const t = tierIndex(Math.max(1, printedQty));
  return print === 'both' ? garment.prices.both[t] : garment.prices.front[t];
}

function sanitizeGarmentItem(it) {
  const garment = GARMENTS.find((g) => g.id === it.garment) || GARMENTS[0];
  const size = garment.sizes.find((s) => s.id === String(it.size)) || garment.sizes[Math.floor(garment.sizes.length / 2)];
  const color = SHIRT_COLORS.find((c) => c.id === it.colorId) || SHIRT_COLORS[0];
  const print = it.print === 'both' ? 'both' : 'front';
  const qty = Math.max(1, Math.min(500, parseInt(it.qty, 10) || 1));
  return { garment, size, color, print, qty };
}

// items: [{ garment, size, colorId, print, qty }]
function calcShirts(items) {
  const clean = items.map(sanitizeGarmentItem);
  const printedQty = clean.reduce((a, c) => a + c.qty, 0);
  const lines = clean.map((c) => {
    const unit = garmentUnitPrice(c.garment, c.print, printedQty);
    return {
      garment: c.garment.id, garmentLabel: c.garment.label,
      size: c.size.id, colorId: c.color.id, colorLabel: c.color.label, colorHex: c.color.hex,
      print: c.print, printLabel: PRINT_LABELS[c.print],
      qty: c.qty, unitPrice: unit, total: unit * c.qty,
    };
  });
  return { lines, printedQty, total: lines.reduce((a, l) => a + l.total, 0) };
}

// Precios unitarios de las 3 opciones de estampa + tabla de escalones (para el diseñador)
function quoteGarment(garmentId, qty, otherPrinted) {
  const garment = GARMENTS.find((g) => g.id === garmentId) || GARMENTS[0];
  const q = Math.max(1, parseInt(qty, 10) || 1);
  const other = Math.max(0, parseInt(otherPrinted, 10) || 0);
  return {
    unit: { front: garmentUnitPrice(garment, 'front', other + q), both: garmentUnitPrice(garment, 'both', other + q) },
    tiers: TIERS.map((t, i) => ({ label: t.label, name: t.name, min: t.min, front: garment.prices.front[i], both: garment.prices.both[i] })),
    activeTier: tierIndex(other + q),
    backExtra: garment.prices.both[0] - garment.prices.front[0],
  };
}

module.exports.GARMENTS = GARMENTS;
module.exports.SHIRT_COLORS = SHIRT_COLORS;
module.exports.PRINT_LABELS = PRINT_LABELS;
module.exports.calcShirts = calcShirts;
module.exports.quoteGarment = quoteGarment;
