// packs.js — "Planchas armadas": planchas listas para vender (la imagen de la plancha ya armada, cuántos stickers trae y su precio).
// Las cargás vos desde el panel (pestaña "Planchas armadas"); el cliente las agrega al carrito como cualquier producto.
// Imágenes: versión web liviana en DATA_DIR/planchas (pública) y el archivo ORIGINAL para imprimir en DATA_DIR/planchas-archivos (solo admin).
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const MAX_PRICE = 10000000, MAX_STICKERS = 1000, MAX_QTY = 50;
const FMT_EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', tiff: 'tif', avif: 'avif', heif: 'heic' };
const clean = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

function mount(app, { db, requireAdmin, DATA_DIR, GALLERY_DIR }) {
  const PUB = path.join(DATA_DIR, 'planchas'), PRIV = path.join(DATA_DIR, 'planchas-archivos');
  fs.mkdirSync(PUB, { recursive: true }); fs.mkdirSync(PRIV, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 120 * 1024 * 1024, files: 1 } });

  const pub = (p) => ({ id: p.id, title: p.title, stickers: p.stickers, price: p.price, url: `/planchas/${p.thumb}`, full: `/planchas/${p.file}` });
  app.use('/planchas', require('express').static(PUB, { maxAge: '7d' }));

  // ---- público ----
  app.get('/api/planchas', (req, res) => res.json((db.read().packs || []).filter((p) => p.active).map(pub)));
  // precio SIEMPRE calculado en el servidor
  app.post('/api/pack-price', (req, res) => {
    try { res.json(priceList(db, (req.body && req.body.items) || [])); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.message, gone: true, packId: e.packId }); }
  });


  // =====================================================================
  //  ARMADOR AUTOMÁTICO DE PLANCHAS: toma stickers de la galería (una categoría o los que elijas),
  //  los acomoda en una plancha de 58 x 50 cm a 300 dpi y la publica como "plancha armada" lista para vender.
  // =====================================================================
  const { SHEET } = require('./pricing');
  const SHEET_W = SHEET.widthCm || 58, SHEET_H = SHEET.lengthCm || 50, DPI = 300, MARGIN = 0.5, GAP = 0.5;
  const px = (cm) => Math.round(cm / 2.54 * DPI);
  let job = { running: false, done: 0, total: 0, created: [], error: null, note: '' };

  // mejor grilla (cols x filas) para n stickers: la que da el sticker más grande
  function bestGrid(n) {
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cell = Math.min((SHEET_W - 2 * MARGIN - GAP * (cols - 1)) / cols, (SHEET_H - 2 * MARGIN - GAP * (rows - 1)) / rows);
      if (!best || cell > best.cell + 1e-6) best = { cols, rows, cell };
    }
    return best;
  }
  async function composeSheet(files) { // files: rutas de PNG con transparencia
    const g = bestGrid(files.length), cellPx = px(g.cell), W = px(SHEET_W), H = px(SHEET_H);
    const used = g.cols * cellPx + (g.cols - 1) * px(GAP), usedH = g.rows * cellPx + (g.rows - 1) * px(GAP);
    const x0 = Math.round((W - used) / 2), y0 = Math.round((H - usedH) / 2);
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const r = Math.floor(i / g.cols), c = i % g.cols;
      // la última fila, si queda incompleta, se centra
      const inRow = r === g.rows - 1 ? files.length - r * g.cols : g.cols;
      const off = Math.round((g.cols - inRow) * (cellPx + px(GAP)) / 2);
      const buf = await sharp(files[i], { failOn: 'none' }).trim({ threshold: 1 }).resize({ width: cellPx, height: cellPx, fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
      const m = await sharp(buf).metadata();
      parts.push({ input: buf, left: x0 + off + c * (cellPx + px(GAP)) + Math.round((cellPx - m.width) / 2), top: y0 + r * (cellPx + px(GAP)) + Math.round((cellPx - m.height) / 2) });
    }
    return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).withMetadata({ density: DPI }).png({ compressionLevel: 6 }).toBuffer();
  }
  async function savePack({ title, stickers, price, buffer, srcIds, category }) {
    const id = require('crypto').randomBytes(6).toString('hex');
    const img = sharp(buffer, { failOn: 'none', limitInputPixels: false });
    const file = id + '.webp', thumb = id + '_t.webp';
    await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).webp({ quality: 88 }).toFile(path.join(PUB, file));
    await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).webp({ quality: 82 }).toFile(path.join(PUB, thumb));
    fs.writeFileSync(path.join(PRIV, id + '.png'), buffer);
    let row;
    db.tx((d) => { d.packs = d.packs || []; d.nextPackId = d.nextPackId || 1; row = { id: d.nextPackId++, key: id, title, stickers, price, file, thumb, active: true, auto: true, category: category || null, src_ids: srcIds, created_at: new Date().toISOString() }; d.packs.push(row); });
    return row;
  }
  async function runAuto(opts) {
    const d = db.read();
    const usedIds = new Set(); (d.packs || []).forEach((p) => (p.src_ids || []).forEach((i) => usedIds.add(i)));
    let pool = (d.gallery || []).filter((g) => g.file && fs.existsSync(path.join(GALLERY_DIR, g.file)));
    if (opts.ids && opts.ids.length) { const set = new Set(opts.ids); pool = pool.filter((g) => set.has(g.id)); }
    else if (opts.category) pool = pool.filter((g) => (g.category || 'Variados') === opts.category);
    if (opts.onlyNew) pool = pool.filter((g) => !usedIds.has(g.id));
    pool.sort((a, b) => String(a.title).localeCompare(String(b.title), 'es', { numeric: true, sensitivity: 'base' }));
    const per = opts.perSheet;
    const chunks = []; for (let i = 0; i < pool.length; i += per) chunks.push(pool.slice(i, i + per));
    // la última plancha, si trae muy pocos, se suma a la anterior (solo si entra) para no vender planchas casi vacías
    if (chunks.length > 1 && chunks[chunks.length - 1].length < Math.ceil(per / 3)) { const last = chunks.pop(); chunks[chunks.length - 1].push(...last); }
    const todo = chunks.slice(0, opts.maxSheets);
    job.total = todo.length; job.note = todo.length ? '' : 'No hay stickers disponibles para armar planchas (o ya se usaron todos).';
    const label = opts.category || 'Stickers';
    const firstNo = (d.packs || []).filter((p) => p.auto && p.category === (opts.category || null)).length;
    for (let k = 0; k < todo.length; k++) {
      const ch = todo[k];
      const buf = await composeSheet(ch.map((g) => path.join(GALLERY_DIR, g.file)));
      const row = await savePack({ title: clean(`${label} · Plancha ${firstNo + k + 1}`, 70), stickers: ch.length, price: opts.price, buffer: buf, srcIds: ch.map((g) => g.id), category: opts.category || null });
      job.created.push({ id: row.id, title: row.title, stickers: row.stickers }); job.done = k + 1;
    }
  }
  const autoRoute = (req, res) => {
    if (job.running) return res.status(409).json({ error: 'Ya se están armando planchas. Esperá a que termine.', job });
    const b = req.body || {};
    const per = Math.min(60, Math.max(4, parseInt(b.perSheet, 10) || 20));
    const price = Math.round(Number(b.price) || SHEET.price);
    if (!(price >= 1 && price <= MAX_PRICE)) return res.status(400).json({ error: 'Precio inválido.' });
    const opts = { category: clean(b.category, 40) || '', ids: Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean).slice(0, 5000) : [], perSheet: per, price, maxSheets: Math.min(60, Math.max(1, parseInt(b.maxSheets, 10) || 12)), onlyNew: b.onlyNew !== false };
    if (!opts.category && !opts.ids.length) return res.status(400).json({ error: 'Elegí una categoría (o stickers) para armar las planchas.' });
    job = { running: true, done: 0, total: 0, created: [], error: null, note: '' };
    runAuto(opts).catch((e) => { console.error('plancha auto:', e); job.error = String(e.message || e).slice(0, 160); }).finally(() => { job.running = false; });
    res.json(job);
  };
  app.post('/admin/api/packs/auto', requireAdmin, autoRoute);
  app.get('/admin/api/packs/auto', requireAdmin, (req, res) => res.json(job));

  // ---- admin ----
  app.get('/admin/api/packs', requireAdmin, (req, res) => res.json((db.read().packs || []).map((p) => ({ ...pub(p), active: !!p.active, created_at: p.created_at }))));
  app.post('/admin/api/packs', requireAdmin, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Subí la imagen de la plancha (PNG, JPG o WEBP).' });
      let meta;
      try { meta = await sharp(req.file.buffer, { failOn: 'none', limitInputPixels: false }).metadata(); } catch (e) { return res.status(400).json({ error: 'No se pudo leer la imagen: el archivo no es una imagen válida o está dañado.' }); }
      if (!FMT_EXT[meta.format]) return res.status(400).json({ error: 'No se pudo leer la imagen: formato ' + (meta.format || 'desconocido') + ' no soportado (usá PNG, JPG o WEBP).' });
      if (req.body.rights !== '1') return res.status(400).json({ error: 'Tildá que el diseño es tuyo o que tenés derecho a venderlo.' });
      const title = clean(req.body.title, 70), stickers = parseInt(req.body.stickers, 10), price = Math.round(Number(req.body.price));
      if (!title) return res.status(400).json({ error: 'Poné un nombre para la plancha.' });
      if (!(stickers >= 1 && stickers <= MAX_STICKERS)) return res.status(400).json({ error: 'Indicá cuántos stickers trae (1 a ' + MAX_STICKERS + ').' });
      if (!(price >= 1 && price <= MAX_PRICE)) return res.status(400).json({ error: 'Poné un precio válido.' });
      const id = require('crypto').randomBytes(6).toString('hex');
      const img = sharp(req.file.buffer, { failOn: 'none', limitInputPixels: false }).rotate();
      const file = id + '.webp', thumb = id + '_t.webp';
      await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(PUB, file));
      await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(PUB, thumb));
      fs.writeFileSync(path.join(PRIV, `${id}.${FMT_EXT[meta.format]}`), req.file.buffer);   // original, tal cual, para imprimir
      let row;
      db.tx((d) => { d.packs = d.packs || []; d.nextPackId = d.nextPackId || 1; row = { id: d.nextPackId++, key: id, title, stickers, price, file, thumb, active: true, created_at: new Date().toISOString() }; d.packs.push(row); });
      res.json(pub(row));
    } catch (e) { console.error('pack:', e); res.status(500).json({ error: 'No se pudo guardar la plancha: ' + String(e.message || e).slice(0, 140) }); }
  });
  app.patch('/admin/api/packs/:id', requireAdmin, (req, res) => {
    let out = null, err = null;
    db.tx((d) => {
      const p = (d.packs || []).find((x) => x.id === Number(req.params.id)); if (!p) return;
      const b = req.body || {};
      if (b.title !== undefined) { const t = clean(b.title, 70); if (!t) { err = 'El nombre no puede quedar vacío.'; return; } p.title = t; }
      if (b.stickers !== undefined) { const n = parseInt(b.stickers, 10); if (!(n >= 1 && n <= MAX_STICKERS)) { err = 'Cantidad de stickers inválida.'; return; } p.stickers = n; }
      if (b.price !== undefined) { const n = Math.round(Number(b.price)); if (!(n >= 1 && n <= MAX_PRICE)) { err = 'Precio inválido.'; return; } p.price = n; }
      if (b.active !== undefined) p.active = !!b.active;
      out = p;
    });
    if (err) return res.status(400).json({ error: err });
    if (!out) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ...pub(out), active: !!out.active });
  });
  // "Sacar": deja de venderse, pero se conserva el archivo para los pedidos ya hechos
  app.delete('/admin/api/packs/:id', requireAdmin, (req, res) => {
    let ok = false;
    db.tx((d) => { const n = (d.packs || []).length; d.packs = (d.packs || []).filter((p) => p.id !== Number(req.params.id)); ok = d.packs.length < n; });
    res.status(ok ? 200 : 404).json({ ok });
  });
  // el archivo original para imprimir (lo usa el panel de pedidos)
  app.get('/admin/api/packs/:key/archivo', requireAdmin, (req, res) => {
    const key = String(req.params.key);
    if (!/^[a-f0-9]{12}$/.test(key)) return res.status(400).end();
    const f = fs.readdirSync(PRIV).find((n) => n.startsWith(key + '.'));
    if (!f) return res.status(404).json({ error: 'El archivo ya no está.' });
    res.download(path.join(PRIV, f), 'plancha-armada-' + f);
  });
}

// items: [{ packId, qty }] → { lines:[{packId,key,title,stickers,qty,unitPrice,total}], total, count }
function priceList(db, items) {
  const packs = db.read().packs || [];
  const lines = []; let total = 0, count = 0;
  (Array.isArray(items) ? items : []).slice(0, 30).forEach((it) => {
    const p = packs.find((x) => x.id === Number(it.packId) && x.active);
    if (!p) { const e = new Error('Una de las planchas armadas de tu carrito ya no está a la venta. Quitala del carrito.'); e.statusCode = 409; e.packId = Number(it.packId); throw e; }
    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(it.qty, 10) || 1));
    lines.push({ packId: p.id, key: p.key, title: p.title, stickers: p.stickers, qty, unitPrice: p.price, total: p.price * qty, thumb: `/planchas/${p.thumb}` });
    total += p.price * qty; count += qty;
  });
  return { lines, total, count };
}
module.exports = { mount, priceList };
