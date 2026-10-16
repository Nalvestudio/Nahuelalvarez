// dtf-worker.js — corre en un hilo aparte (así el sitio no se traba mientras la IA trabaja).
// Toma el diseño del pedido y genera el archivo para imprimir en DTF: PNG con transparencia, a la medida exacta
// (cm reales) y 300 dpi. Si la imagen es chica para esa medida, la agranda con IA (Real-ESRGAN, corre en tu servidor).
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const sharp = require('sharp');

const DPI = 300, MAX_SIDE = 9000, TILE = 96, PAD = 10, SCALE = 4;


// Rellena los píxeles transparentes (y los bordes semitransparentes) con el color del dibujo más cercano.
// Sin esto, el negro "escondido" en la zona transparente se mezcla con el borde y la IA dibuja halos oscuros.
function bleedColors(data, w, h, maxDist) {
  const n = w * h, known = new Uint8Array(n); const queue = new Int32Array(n); let qh = 0, qt = 0;
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] >= 250) { known[p] = 1; queue[qt++] = p; }
  if (qt === 0 || qt === n) return;
  const dist = new Uint8Array(n);
  while (qh < qt) {
    const p = queue[qh++], x = p % w, y = (p / w) | 0, d = dist[p]; if (d >= maxDist) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx; if (known[q]) continue;
      known[q] = 1; dist[q] = d + 1; data[q * 4] = data[p * 4]; data[q * 4 + 1] = data[p * 4 + 1]; data[q * 4 + 2] = data[p * 4 + 2]; queue[qt++] = q;
    }
  }
}

async function run() {
  const { src, out, wCm, hCm, baseW, baseH } = workerData;
  const post = (m) => parentPort.postMessage(m);
  let img = sharp(src, { failOn: 'none' }).ensureAlpha();
  const m0 = await img.metadata();
  // si el archivo ya venía agrandado, volvemos al tamaño "real" de la imagen para que la IA trabaje sobre los píxeles verdaderos
  let w = m0.width, h = m0.height;
  if (baseW && baseH && baseW < w * 0.92) { img = img.resize(baseW, baseH, { kernel: 'lanczos3' }); w = baseW; h = baseH; }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  w = info.width; h = info.height;

  // la medida manda en el ANCHO; el alto sale de la proporción real de la imagen (nunca se deforma)
  let targetW = Math.round((wCm / 2.54) * DPI), targetH = Math.round(targetW * h / w);
  const k0 = Math.min(1, MAX_SIDE / Math.max(targetW, targetH)); targetW = Math.round(targetW * k0); targetH = Math.round(targetH * k0);
  const needAI = w < targetW * 0.97 && Math.max(w, h) * SCALE <= 40000;
  let used = 'ninguna';
  let pipeInput, pipeInfo;

  if (needAI) {
    bleedColors(data, w, h, 24);
    const ort = require('onnxruntime-web');
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, require('os').cpus().length - 1 || 1));
    const session = await ort.InferenceSession.create(path.join(__dirname, 'models', 'realesr-general-x4v3.onnx'), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const W4 = w * SCALE, H4 = h * SCALE;
    const rgbOut = Buffer.alloc(W4 * H4 * 3);
    const tx = Math.ceil(w / TILE), ty = Math.ceil(h / TILE), total = tx * ty;
    let done = 0;
    for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
      const x0 = i * TILE, y0 = j * TILE, tw = Math.min(TILE, w - x0), th = Math.min(TILE, h - y0);
      const iw = tw + 2 * PAD, ih = th + 2 * PAD;
      const inp = new Float32Array(3 * iw * ih);
      for (let y = 0; y < ih; y++) {
        const sy = Math.min(h - 1, Math.max(0, y0 - PAD + y));
        for (let x = 0; x < iw; x++) {
          const sx = Math.min(w - 1, Math.max(0, x0 - PAD + x)), p = (sy * w + sx) * 4, o = y * iw + x;
          inp[o] = data[p] / 255; inp[iw * ih + o] = data[p + 1] / 255; inp[2 * iw * ih + o] = data[p + 2] / 255;
        }
      }
      const res = await session.run({ input: new ort.Tensor('float32', inp, [1, 3, ih, iw]) });
      const o = res.output.data, ow = iw * SCALE, oh = ih * SCALE;
      for (let y = 0; y < th * SCALE; y++) {
        const oy = y + PAD * SCALE, dy = y0 * SCALE + y;
        for (let x = 0; x < tw * SCALE; x++) {
          const ox = x + PAD * SCALE, dx = x0 * SCALE + x, q = (dy * W4 + dx) * 3, s = oy * ow + ox;
          const r = o[s], g = o[ow * oh + s], b = o[2 * ow * oh + s];
          rgbOut[q] = r < 0 ? 0 : r > 1 ? 255 : (r * 255 + 0.5) | 0;
          rgbOut[q + 1] = g < 0 ? 0 : g > 1 ? 255 : (g * 255 + 0.5) | 0;
          rgbOut[q + 2] = b < 0 ? 0 : b > 1 ? 255 : (b * 255 + 0.5) | 0;
        }
      }
      done++; post({ type: 'progress', pct: Math.round((done / total) * 92) });
    }
    // transparencia: se agranda aparte (suave y sin halos) y se une a los colores que devolvió la IA
    const alphaRaw = Buffer.alloc(w * h); for (let p = 0; p < w * h; p++) alphaRaw[p] = data[p * 4 + 3];
    const hasAlpha = alphaRaw.some((v) => v < 255);
    let rgb = sharp(rgbOut, { raw: { width: W4, height: H4, channels: 3 } });
    if (hasAlpha) {
      const a4 = await sharp(alphaRaw, { raw: { width: w, height: h, channels: 1 } }).resize(W4, H4, { kernel: 'cubic' }).extractChannel(0).blur(1.3).linear(3, -255).raw().toBuffer(); // borde suave: se agranda, se difumina un poco y se vuelve a endurecer
      const rgba = Buffer.alloc(W4 * H4 * 4);
      for (let p = 0, q = 0, r = 0; p < W4 * H4; p++, q += 4, r += 3) { rgba[q] = rgbOut[r]; rgba[q + 1] = rgbOut[r + 1]; rgba[q + 2] = rgbOut[r + 2]; rgba[q + 3] = a4[p]; }
      pipeInput = rgba; pipeInfo = { width: W4, height: H4, channels: 4 };
    } else { pipeInput = rgbOut; pipeInfo = { width: W4, height: H4, channels: 3 }; }
    used = 'IA (Real-ESRGAN ×4)';
  } else { pipeInput = data; pipeInfo = { width: w, height: h, channels: 4 }; }

  let p = sharp(pipeInput, { raw: pipeInfo });
  let finalW = pipeInfo.width, finalH = pipeInfo.height;
  if (Math.abs(finalW - targetW) > 2) { p = p.resize(targetW, targetH, { kernel: 'lanczos3', fit: 'fill' }); finalW = targetW; finalH = targetH; }
  if (!needAI && finalW > w) p = p.sharpen({ sigma: 0.6, m1: 0.5, m2: 1.4 });
  await p.withMetadata({ density: Math.round(finalW / (wCm / 2.54)) }).png({ compressionLevel: 6 }).toFile(out);
  post({ type: 'done', width: finalW, height: finalH, dpi: Math.round(finalW / (wCm / 2.54)), method: used, srcW: w, srcH: h });
}
run().catch((e) => parentPort.postMessage({ type: 'error', message: String(e && e.message || e) }));
