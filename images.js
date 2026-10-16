// images.js — guarda cada diseño del pedido en buena calidad:
//   · el ORIGINAL tal cual lo subió el cliente,
//   · una versión "lista para imprimir" (PNG): con el recorte / quitar fondo aplicados sobre el original
//     a resolución completa y, si la imagen es chica para el tamaño que se imprime, agrandada a ~300 dpi
//     (reescalado de alta calidad + un leve afilado; suaviza y mejora el borde, pero NO inventa detalle),
//   · una miniatura liviana para el panel.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Bg = require('./public/js/bg-remove.js');

const TARGET_DPI = 300;     // resolución de impresión a la que se apunta
const MAX_UPSCALE = 4;      // nunca agrandamos más de 4x (más no mejora, solo empasta)
const MAX_SIDE = 8000;      // tope de píxeles del lado más largo
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

function qualityOf(dpi) {
  if (dpi == null) return 'vectorial';
  if (dpi >= 250) return 'excelente';
  if (dpi >= 170) return 'buena';
  if (dpi >= 110) return 'media';
  return 'baja';
}

const sane01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
function sanitizeCrop(c) {
  if (!c || typeof c !== 'object') return null;
  const x = sane01(c.x), y = sane01(c.y);
  const w = Math.min(1 - x, sane01(c.w)), h = Math.min(1 - y, sane01(c.h));
  if (w < 0.01 || h < 0.01 || (w > 0.995 && h > 0.995)) return null;
  return { x, y, w, h };
}
function sanitizeBg(b) {
  if (!b || !Array.isArray(b.key) || b.key.length !== 3) return null;
  const key = b.key.map((v) => Math.min(255, Math.max(0, Math.round(Number(v) || 0))));
  return { key, tol: Math.min(100, Math.max(0, Number(b.tol) || 30)), holes: !!b.holes };
}

// spec: { buffer, mime, id, crop?, bg?, wCm?, hCm?, fitCm? } → { original, print, thumb, meta } (rutas /uploads/...)
async function processDesign(spec, uploadDir) {
  const { buffer, mime, id } = spec;
  const isSvg = mime === 'image/svg+xml';
  const origName = `${id}_original.${EXT[mime] || 'png'}`;
  fs.writeFileSync(path.join(uploadDir, origName), buffer);

  const opts = isSvg ? { density: 300 } : {};
  const meta0 = await sharp(buffer, opts).metadata();
  const swap = (meta0.orientation || 1) >= 5;
  const nativeW = swap ? meta0.height : meta0.width, nativeH = swap ? meta0.width : meta0.height;

  // 1) normalizar orientación (EXIF) / SVG → PNG
  let buf = buffer;
  if (isSvg || (meta0.orientation || 1) > 1) buf = await sharp(buffer, opts).rotate().png().toBuffer();
  let w = nativeW, h = nativeH;

  // 2) recorte (fracciones de la imagen completa)
  const crop = sanitizeCrop(spec.crop);
  if (crop) {
    const left = Math.min(w - 1, Math.round(crop.x * w)), top = Math.min(h - 1, Math.round(crop.y * h));
    const cw = Math.max(1, Math.min(w - left, Math.round(crop.w * w))), ch = Math.max(1, Math.min(h - top, Math.round(crop.h * h)));
    buf = await sharp(buf).extract({ left, top, width: cw, height: ch }).toBuffer();
    w = cw; h = ch;
  }

  // 3) quitar fondo a resolución completa (misma lógica que el navegador)
  const bg = sanitizeBg(spec.bg);
  let hasAlphaOut = false;
  if (bg) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Bg.coreRemove(data, info.width, info.height, bg.key, bg.tol, bg.holes);
    buf = await sharp(Buffer.from(out.buffer, out.byteOffset, out.length), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    hasAlphaOut = true;
    // recorte posterior al quitar fondo (el marco ajustado al dibujo ya sin fondo)
    const c2 = sanitizeCrop(spec.crop2);
    if (c2) {
      const left = Math.min(w - 1, Math.round(c2.x * w)), top = Math.min(h - 1, Math.round(c2.y * h));
      const cw = Math.max(1, Math.min(w - left, Math.round(c2.w * w))), ch = Math.max(1, Math.min(h - top, Math.round(c2.h * h)));
      buf = await sharp(buf).extract({ left, top, width: cw, height: ch }).toBuffer();
      w = cw; h = ch;
    }
  }

  // 4) medida impresa → resolución efectiva y, si hace falta, agrandado
  let wCm = Number(spec.wCm) || 0, hCm = Number(spec.hCm) || 0;
  if (spec.fitCm) { const m = Math.max(w, h); wCm = spec.fitCm * w / m; hCm = spec.fitCm * h / m; }
  const dpi = !isSvg && wCm > 0 ? Math.round(w / (wCm / 2.54)) : null;
  let outW = w, outH = h, upscaled = false;
  let pipe = sharp(buf);
  if (wCm > 0) {
    const wantW = Math.ceil((wCm / 2.54) * TARGET_DPI);
    let k = wantW / w;
    if (k > 1.05) {
      k = Math.min(k, MAX_UPSCALE, MAX_SIDE / Math.max(w, h));
      if (k > 1.05) {
        outW = Math.round(w * k); outH = Math.round(h * k); upscaled = true;
        pipe = pipe.resize(outW, outH, { kernel: 'lanczos3' }).sharpen({ sigma: 0.7, m1: 0.6, m2: 1.6 });
      }
    }
  }
  if (!upscaled && Math.max(w, h) > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(w, h);
    outW = Math.round(w * k); outH = Math.round(h * k);
    pipe = pipe.resize(outW, outH, { kernel: 'lanczos3' });
  }
  const printName = `${id}_print.png`;
  await pipe.png({ compressionLevel: 6 }).toFile(path.join(uploadDir, printName));

  // 5) miniatura para el panel
  const thumbName = `${id}_thumb.webp`;
  await sharp(path.join(uploadDir, printName)).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(uploadDir, thumbName));

  return {
    original: `/uploads/${origName}`,
    print: `/uploads/${printName}`,
    thumb: `/uploads/${thumbName}`,
    meta: {
      nativeW, nativeH, cropW: w, cropH: h, printW: outW, printH: outH,
      wCm: Math.round(wCm * 10) / 10, hCm: Math.round(hCm * 10) / 10,
      dpi, quality: qualityOf(dpi), upscaled, bgRemoved: hasAlphaOut || !!bg, cropped: !!crop, mime,
    },
  };
}

module.exports = { processDesign, sanitizeCrop, sanitizeBg, qualityOf };
