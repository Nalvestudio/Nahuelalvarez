// orderart.js — arma, a partir de un pedido guardado, lo que armó el cliente:
//  • la PLANCHA completa (58 × 50 cm) con cada sticker en su lugar, lista para imprimir (hasta 300 dpi)
//  • la MAQUETA de cada prenda (la remera con la estampa donde la puso el cliente)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { packSheet, SHEET, GARMENTS } = require('./pricing');
const Garments = require('./public/js/garments.js');

const pxOf = (cm, dpi) => Math.max(1, Math.round(cm / 2.54 * dpi));
const fileIn = (dir, p) => { if (!p) return null; const f = path.join(dir, path.basename(String(p))); try { return fs.statSync(f).size > 0 ? f : null; } catch (e) { return null; } };

// Los mismos datos con los que se calculó el pedido → el acomodo es el mismo que vio el cliente.
function sheetPlan(sheet) {
  const items = (sheet.items || []).map((it) => ({ sizeCm: it.size_cm, aspect: (it.h_cm || it.size_cm) / it.size_cm, qty: it.qty }));
  return { items, packing: packSheet(items) };
}

async function sheetPng(sheet, planchaIdx, dir, dpi = 300) {
  const { packing } = sheetPlan(sheet);
  const W = pxOf(SHEET.widthCm, dpi), H = pxOf(SHEET.lengthCm, dpi);
  const mine = packing.placements.filter((p) => p.plancha === planchaIdx);
  if (!mine.length) return null;
  const cache = new Map(), layers = [];
  for (const p of mine) {
    const it = sheet.items[p.itemIndex], file = fileIn(dir, it && it.image_path);
    if (!file) continue;
    const w = pxOf(p.w, dpi), h = pxOf(p.h, dpi), key = `${p.itemIndex}:${w}x${h}`;
    if (!cache.has(key)) cache.set(key, await sharp(file).resize(w, h, { fit: 'fill' }).png().toBuffer());
    layers.push({ input: cache.get(key), left: Math.min(W - w, pxOf(p.x, dpi)), top: Math.min(H - h, pxOf(p.y, dpi)) });
  }
  const base = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const img = await base.composite(layers).png({ compressionLevel: dpi > 100 ? 6 : 9 }).withMetadata({ density: dpi }).toBuffer();
  return img;
}
const planchaCount = (sheet) => sheetPlan(sheet).packing.planchas || 0;

const sizeOf = (g, id) => (g.sizes || []).find((s) => s.id === id) || g.sizes[Math.floor(g.sizes.length / 2)];
async function shirtMockup(sh, side, dir, width = 900) {
  const g = GARMENTS.find((x) => x.id === sh.garment_id) || GARMENTS[0], size = sizeOf(g, sh.size);
  const view = side === 'back' ? 'back' : 'front';
  const r = Garments.render(g.geometry, size.chestCm, size.lengthCm, view, sh.color_hex || '#E4E1D7');
  const pl = sh.placements && sh.placements[view];
  const printFile = fileIn(dir, view === 'back' ? sh.back_image : sh.front_image);
  const x0 = -(r.ext.halfW + 3), y0 = r.ext.top - 2, vw = (r.ext.halfW + 3) * 2, vh = r.ext.bottom + 4 - y0;
  let imgTag = '';
  if (pl && printFile) {
    const px = Math.min(1600, Math.round(pl.wCm * 60)), buf = await sharp(printFile).resize({ width: px, withoutEnlargement: true }).png().toBuffer();
    imgTag = `<image href="data:image/png;base64,${buf.toString('base64')}" x="${pl.cx - pl.wCm / 2}" y="${pl.top}" width="${pl.wCm}" height="${pl.hCm}" preserveAspectRatio="none"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${vw} ${vh}" width="${width}" height="${Math.round(width * vh / vw)}">
    <defs><linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></linearGradient></defs>
    <rect x="${x0}" y="${y0}" width="${vw}" height="${vh}" fill="#F5F4EF"/>${r.svg}${imgTag}</svg>`;
  return sharp(Buffer.from(svg), { density: 96 }).png().toBuffer();
}
module.exports = { sheetPng, planchaCount, shirtMockup, sheetPlan };
