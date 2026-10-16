require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');

const db = require('./db');
const mailer = require('./mail');
const bot = require('./bot');
const extras = require('./extras');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const os = require('os');
const orderArt = require('./orderart');
const orderFolder = require('./orderfolder');
const cats = require('./categorias');
const recover = require('./recover');
const APP_VERSION = '2026.10.16-a';
const { processDesign, sanitizeCrop, sanitizeBg } = require('./images');
const shipping = require('./shipping');
const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
const { calcOrder, MIN_CM, MAX_CM, SHEET, SIZE_GUIDE, packSheet, stickerDims, GARMENTS, SHIRT_COLORS, calcShirts, quoteGarment } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 3000;

const { DATA_DIR, UPLOAD_DIR, custom: CUSTOM_DATA } = require('./paths');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const TMP_DIR = path.join(UPLOAD_DIR, '_tmp'); // originales subidos mientras la persona arma el pedido
fs.mkdirSync(TMP_DIR, { recursive: true });

// Sesiones guardadas en un archivo (data/sessions.json): así los clientes siguen logueados aunque reinicies el servidor.
class FileStore extends session.Store {
  constructor(file) {
    super();
    this.file = file; this.map = {}; this.timer = null;
    try { this.map = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { this.map = {}; }
  }
  _flush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      Object.keys(this.map).forEach((k) => { const e = this.map[k] && this.map[k].cookie && this.map[k].cookie.expires; if (e && new Date(e).getTime() < now) delete this.map[k]; });
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.map)); require('./fsafe').renameRetry(this.file + '.tmp', this.file); } catch (e) { console.error('No se pudieron guardar las sesiones:', e.message); }
    }, 400);
    this.timer.unref();
  }
  get(sid, cb) {
    const s = this.map[sid];
    if (!s) return cb(null, null);
    const e = s.cookie && s.cookie.expires;
    if (e && new Date(e).getTime() < Date.now()) { delete this.map[sid]; return cb(null, null); }
    cb(null, s);
  }
  set(sid, sess, cb) { this.map[sid] = JSON.parse(JSON.stringify(sess)); this._flush(); cb && cb(); }
  destroy(sid, cb) { delete this.map[sid]; this._flush(); cb && cb(); }
  touch(sid, sess, cb) { if (this.map[sid]) { this.map[sid].cookie = JSON.parse(JSON.stringify(sess.cookie)); this._flush(); } cb && cb(); }
}

// ---------- Middlewares base ----------
// Detrás del proxy del hosting (Render, Railway…): así se ven la IP real del cliente y el https
app.set('trust proxy', 1);
// En un servidor publicado (no en tu PC) el panel NO abre con la clave de ejemplo
const IS_PUBLIC = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
const WEAK_PASS = ['', 'admin', 'cambiaesta123', 'cambia-esto'];
if (IS_PUBLIC && WEAK_PASS.includes(process.env.ADMIN_PASSWORD || '')) console.error('⚠ ADMIN_PASSWORD sin configurar: el panel de administrador queda bloqueado hasta que pongas una clave propia.');
if (IS_PUBLIC && !process.env.SESSION_SECRET) console.error('⚠ Falta SESSION_SECRET (una frase larga al azar).');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-cambiame',
    store: new FileStore(path.join(DATA_DIR, 'sessions.json')),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// ---------- Config pública (para que el frontend pinte datos de la tienda) ----------
app.get('/api/config', (req, res) => {
  res.json({
    storeName: process.env.STORE_NAME || 'nalv.estudio',
    local: { address: process.env.LOCAL_ADDRESS || 'calle 45 e/ 145 y 146', city: process.env.LOCAL_CITY || 'La Plata' },
    minCm: MIN_CM,
    maxCm: MAX_CM,
    sheet: SHEET,
    sizeGuide: SIZE_GUIDE,
    garments: GARMENTS,
    colors: SHIRT_COLORS,
    bank: {
      alias: process.env.BANK_ALIAS || 'nalv.estudio',
      cvu: process.env.BANK_CVU || process.env.BANK_CBU || '0000003100053631202291',
      holder: process.env.BANK_HOLDER || 'Carlos Nahuel Alvarez',
    },
    shipping: { provinces: shipping.PROVINCES.map((p) => ({ id: p.id, label: p.label })), methods: shipping.METHODS },
    whatsapp: (process.env.WHATSAPP_NUMBER || '5492215730729').replace(/\D/g, ''),
    email: process.env.ORDER_EMAIL || 'nalvarezestudio@gmail.com',
  });
});

// ---------- Cálculo de precio en vivo (solo para mostrar; no es la fuente de verdad) ----------
app.post('/api/price', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.json({ lines: [], total: 0, totalQty: 0, discount: 0 });
  const result = calcOrder(items);
  res.json(result);
});

// ---------- Precio en vivo de remeras ----------
app.post('/api/shirt-price', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.json({ lines: [], total: 0, totalQty: 0, discount: 0 });
  res.json(calcShirts(items));
});

app.post('/api/garment-quote', (req, res) => {
  const { garment, qty, otherPrinted } = req.body || {};
  res.json(quoteGarment(garment, qty, otherPrinted));
});

// ---------- Empaquetado en vivo de la plancha de stickers (58 x 50 cm) ----------
// Cotización de envío (Correo Argentino estimado) para el carrito actual
app.post('/api/shipping-quote', (req, res) => {
  const b = req.body || {};
  const w = shipping.weightKg({
    singles: (Array.isArray(b.singles) ? b.singles : []).reduce((a, x) => a + Math.max(1, parseInt(x.qty, 10) || 1), 0),
    planchas: (Array.isArray(b.sheets) ? b.sheets : []).reduce((a, x) => a + Math.max(1, parseInt(x.planchas, 10) || 1), 0),
    shirts: (Array.isArray(b.shirts) ? b.shirts : []).map((x) => ({ garment: x.garment, qty: Math.max(1, parseInt(x.qty, 10) || 1) })),
  });
  res.json(shipping.quote({ method: b.method, province: b.province, weight: w }));
});

// Trabajos realizados: fotos y videos de public/trabajos + links de posts de Instagram / TikTok (public/trabajos/_trabajos.json)
const WORKS_DIR = path.join(__dirname, 'public', 'trabajos');
app.get('/api/trabajos', (req, res) => {
  let posts = { instagram: [], tiktok: [] };
  try { posts = Object.assign(posts, JSON.parse(fs.readFileSync(path.join(WORKS_DIR, '_trabajos.json'), 'utf8'))); } catch (e) { /* sin posts */ }
  const ok = (u) => typeof u === 'string' && /^https:\/\/(www\.)?(instagram\.com|tiktok\.com)\//.test(u);
  let files = [];
  try { files = fs.readdirSync(WORKS_DIR).filter((f) => /\.(jpe?g|png|webp|gif|mp4|webm)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })); } catch (e) { /* sin carpeta */ }
  res.json({
    media: files.map((f) => ({
      type: /\.(mp4|webm)$/i.test(f) ? 'video' : 'image',
      url: '/trabajos/' + encodeURIComponent(f),
      caption: f.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[_-]+/g, ' '),
    })),
    instagram: (posts.instagram || []).filter(ok),
    tiktok: (posts.tiktok || []).filter(ok),
  });
});

// Videos de fondo de la portada: todos los mp4/webm de public/fondo (sin sonido), rotan solos.
app.get('/api/fondo', (req, res) => {
  let files = [];
  try { files = fs.readdirSync(path.join(__dirname, 'public', 'fondo')).filter((f) => /\.(mp4|webm)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })); } catch (e) { /* sin videos */ }
  res.json({ videos: files.map((f) => '/fondo/' + encodeURIComponent(f)) });
});

// Cuántas copias de un diseño entran todavía en la(s) plancha(s) que ya tiene armadas el cliente.
app.post('/api/sheet-fill', (req, res) => {
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 60);
  const sizeCm = Number(req.body.sizeCm), aspect = Number(req.body.aspect) || 1;
  if (!(sizeCm > 0)) return res.status(400).json({ error: 'Medida inválida' });
  const target = items.length ? Math.max(1, packSheet(items).planchas) : 1;
  let lo = 0, hi = 400;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const p = packSheet([...items, { sizeCm, aspect, qty: mid }]);
    if (p.planchas <= target) lo = mid; else hi = mid - 1;
  }
  res.json({ qty: lo, planchas: target });
});

app.post('/api/sheet-pack', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 60) : [];
  if (!items.length) {
    return res.json({ fits: false, widthCm: SHEET.widthCm, lengthCm: SHEET.lengthCm, gapCm: SHEET.gapCm, planchas: 0, price: 0, usedLengthCm: 0, fillPct: 0, placements: [], totalUnits: 0, overflowCount: 0 });
  }
  res.json(packSheet(items));
});

// ---------- Bot de ayuda ("TONY") ----------
const botHits = new Map();
app.get('/api/bot/info', (req, res) => res.json({ name: bot.BOT_NAME, chips: bot.SUGGEST_DEFAULT, chipsByPage: bot.SUGGEST_BY_PAGE, wa: `https://wa.me/${(process.env.WHATSAPP_NUMBER || '5492215730729').replace(/\D/g, '')}` }));
app.post('/api/bot', (req, res) => {
  const k = req.ip + ':' + Math.floor(Date.now() / 60000);
  const n = (botHits.get(k) || 0) + 1; botHits.set(k, n);
  if (botHits.size > 5000) botHits.clear();
  if (n > 40) return res.status(429).json({ text: 'Vas muy rápido, esperá un minutito. 😅', chips: [] });
  const page = ['remeras', 'checkout'].includes(req.body.page) ? req.body.page : 'home';
  res.json(bot.answer(req.body.message, page, { galleryCount: db.galleryAll().length, featuredCount: db.galleryAll().filter((g) => g.featured).length }));
});

// ---------- Subida de imágenes para el configurador ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 60 }, // 12MB por archivo
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato de imagen no soportado'), ok);
  },
});

// ---------- Subida del ORIGINAL (calidad completa) mientras se arma el pedido ----------
// El navegador manda una versión liviana para la vista previa y el original por acá; al confirmar el pedido
// solo viaja el id. Los originales sin pedido se borran solos a los 14 días.
const uploadOriginal = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});
const uploadHits = new Map();
app.post('/api/design-upload', (req, res, next) => {
  const hr = Math.floor(Date.now() / 3600000), key = req.ip + ':' + hr;
  const n = (uploadHits.get(key) || 0) + 1; uploadHits.set(key, n);
  if (uploadHits.size > 5000) uploadHits.clear();
  if (n > 400) return res.status(429).json({ error: 'Demasiadas subidas, probá más tarde.' });
  next();
}, uploadOriginal.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Formato no soportado' });
    const meta = await sharp(req.file.buffer).metadata();
    if (!meta.width || !meta.height) throw new Error('imagen inválida');
    const id = crypto.randomBytes(8).toString('hex');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[req.file.mimetype];
    fs.writeFileSync(path.join(TMP_DIR, `${id}.${ext}`), req.file.buffer);
    res.json({ id, width: meta.width, height: meta.height });
  } catch (e) { res.status(400).json({ error: 'No se pudo leer la imagen.' }); }
});
setInterval(() => {
  try {
    const old = Date.now() - 14 * 24 * 3600 * 1000;
    fs.readdirSync(TMP_DIR).forEach((f) => { const fp = path.join(TMP_DIR, f); if (fs.statSync(fp).mtimeMs < old) fs.unlinkSync(fp); });
  } catch (e) { /* nada para limpiar */ }
}, 6 * 3600 * 1000).unref();

// ---------- Crear pedido ----------
// multipart/form-data con:
//   items:  JSON string [{ sizeCm, qty, label }]              → stickers sueltos
//   sheets: JSON string [{ items:[{ sizeCm, aspect, qty, label }] }]  → planchas de 58 x 50 cm (el servidor calcula cuántas hacen falta)
//   shirts: JSON string [{ garment, size, colorId, print:'front'|'both', qty, label, placements:{front:{wCm,hCm,cx,top},back:{…}} }]
//   images: los archivos, EN ESTE ORDEN: sueltos, luego diseños de cada hoja, luego, por cada prenda, su estampa de adelante y (si es doble) la de atrás
//   customerName, customerPhone, customerEmail, deliveryMethod, address, notes
app.post('/api/orders', upload.array('images', 60), async (req, res) => {
  try {
    const items = JSON.parse(req.body.items || '[]');
    const sheets = JSON.parse(req.body.sheets || '[]');
    const shirts = JSON.parse(req.body.shirts || '[]');
    const packsIn = JSON.parse(req.body.packs || '[]');
    shirts.forEach((sh) => { if (!['front', 'both'].includes(sh.print)) sh.print = 'front'; });
    const shirtImageCount = (sh) => (sh.print === 'both' ? 2 : 1);
    if (items.length + sheets.length + shirts.length + packsIn.length === 0) {
      return res.status(400).json({ error: 'El pedido está vacío.' });
    }

    const { customerName, customerPhone, customerEmail, address, notes, province, city, postalCode, dni, branch } = req.body;
    let deliveryMethod = req.body.deliveryMethod;
    if (deliveryMethod === 'envio') deliveryMethod = 'correo_domicilio'; // compatibilidad con carritos viejos
    if (!customerName || !customerPhone || !deliveryMethod) {
      return res.status(400).json({ error: 'Faltan datos de contacto o entrega.' });
    }
    if (!shipping.METHODS[deliveryMethod]) {
      return res.status(400).json({ error: 'Elegí cómo querés recibir tu pedido.' });
    }
    if (deliveryMethod !== 'retiro') {
      if (!shipping.PROVINCES.find((p) => p.id === province)) return res.status(400).json({ error: 'Elegí la provincia de destino.' });
      if (!city || !postalCode) return res.status(400).json({ error: 'Completá localidad y código postal.' });
      if (!/^\d{7,8}$/.test(String(dni || '').replace(/\D/g, ''))) return res.status(400).json({ error: 'Ingresá un DNI válido (solo números): lo pide el Correo para entregar.' });
      if (deliveryMethod === 'correo_domicilio' && !address) return res.status(400).json({ error: 'Falta la dirección de entrega (calle y número).' });
      if (deliveryMethod === 'correo_sucursal' && !branch) return res.status(400).json({ error: 'Indicá en qué sucursal de Correo Argentino querés retirar (localidad o dirección).' });
    }

    // Recalculamos SIEMPRE en el servidor: nunca confiamos en el precio del navegador.
    const pricedSingles = items.length ? calcOrder(items) : { lines: [], total: 0, discount: 0 };

    const pricedSheets = sheets.map((sheet) => {
      const sheetItems = (Array.isArray(sheet.items) ? sheet.items : []).slice(0, 60);
      const packing = packSheet(sheetItems);
      if (!packing.fits) {
        const err = new Error('La plancha está vacía. Agregá al menos un diseño.');
        err.statusCode = 400;
        throw err;
      }
      return { items: sheetItems, packing, price: packing.price };
    });

    const pricedShirts = shirts.length ? calcShirts(shirts) : { lines: [], total: 0 };
    const pricedPacks = packsIn.length ? require('./packs').priceList(db, packsIn) : { lines: [], total: 0, count: 0 };

    const productsTotal = pricedSingles.total + pricedSheets.reduce((a, sh) => a + sh.price, 0) + pricedShirts.total + pricedPacks.total;
    const weight = shipping.weightKg({
      singles: pricedSingles.lines.reduce((a, l) => a + l.qty, 0),
      planchas: pricedSheets.reduce((a, sh) => a + sh.packing.planchas, 0) + pricedPacks.count,
      shirts: pricedShirts.lines.map((l) => ({ garment: l.garment, qty: l.qty })),
    });
    const ship = shipping.quote({ method: deliveryMethod, province, weight });
    if (!ship.ok) return res.status(400).json({ error: ship.error });
    const total = productsTotal + ship.cost;

    // ---- Imágenes: una "ranura" por diseño, en el orden: sueltos → diseños de cada plancha → prendas (frente, espalda) ----
    // Cada ranura trae el id del original ya subido (ref) o, si no hay, viene como archivo en `images` (mismo orden).
    const specs = [];
    pricedSingles.lines.forEach((line, i) => specs.push({ ref: items[i] && items[i].ref, fitCm: line.sizeCm }));
    pricedSheets.forEach((sh) => sh.items.forEach((it) => {
      const d = stickerDims(it);
      specs.push({ ref: it.ref, crop: it.crop, wCm: d.w, hCm: d.h });
    }));
    shirts.forEach((sh) => {
      const pl = sh.placements || {}, rf = sh.refs || {};
      const one = (side) => ({ ref: rf[side] && rf[side].ref, bg: rf[side] && rf[side].bg, crop: rf[side] && rf[side].crop, crop2: rf[side] && rf[side].crop2, wCm: Number(pl[side] && pl[side].wCm) || 20, hCm: Number(pl[side] && pl[side].hCm) || 20 });
      specs.push(one('front'));
      if (sh.print === 'both') specs.push(one('back'));
    });
    const REF_RE = /^[a-f0-9]{16}$/;
    const tmpFile = (ref) => {
      if (!REF_RE.test(String(ref || ''))) return null;
      try { return fs.readdirSync(TMP_DIR).find((f) => f.startsWith(ref + '.')) || null; } catch (e) { return null; }
    };
    let needFiles = 0;
    for (const sp of specs) {
      if (sp.ref) {
        if (!tmpFile(sp.ref)) return res.status(409).json({ error: 'Alguno de los diseños de tu carrito venció. Quitalo del carrito y volvelo a subir.' });
      } else needFiles++;
    }
    if ((req.files || []).length !== needFiles) {
      return res.status(400).json({ error: 'Falta la imagen de algún diseño del pedido.' });
    }

    const baseId = crypto.randomBytes(5).toString('hex');
    let fileCursor = 0;
    const jobs = specs.map((sp, i) => {
      if (sp.ref) {
        const f = tmpFile(sp.ref);
        const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[path.extname(f).slice(1)] || 'image/png';
        return { ...sp, id: `${baseId}${i}`, buffer: () => fs.readFileSync(path.join(TMP_DIR, f)), mime };
      }
      const file = req.files[fileCursor++];
      // sin original subido: usamos la imagen que mandó el navegador (ya con recorte / fondo aplicados)
      return { ...sp, crop: null, crop2: null, bg: null, id: `${baseId}${i}`, buffer: () => file.buffer, mime: file.mimetype };
    });
    const results = new Array(jobs.length);
    for (let i = 0; i < jobs.length; i += 3) {
      await Promise.all(jobs.slice(i, i + 3).map(async (j, k) => {
        try { results[i + k] = await processDesign({ ...j, buffer: j.buffer() }, UPLOAD_DIR); }
        catch (e) { console.error('No se pudo procesar una imagen:', e.message); const err = new Error('No pudimos leer una de las imágenes. Probá con otro archivo PNG o JPG.'); err.statusCode = 400; throw err; }
      }));
    }
    const imagePaths = results.map((r) => r.print);
    let cursor = 0;
    const take = (n) => results.slice(cursor, (cursor += n));
    const singleRes = take(items.length);
    const sheetResGroups = pricedSheets.map((s) => take(s.items.length));
    const shirtRes = shirts.map((sh) => {
      const r = take(shirtImageCount(sh));
      return { front: r[0] || null, back: r[1] || null };
    });

    const created = db.createOrder({
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail || null,
      user_id: (extras.sessionUserId ? extras.sessionUserId(req) : null),
      marketing: req.body.marketing === '1',
      delivery_method: deliveryMethod,
      address: address || null,
      province: (shipping.PROVINCES.find((p) => p.id === province) || {}).label || null,
      city: city || null,
      postal_code: postalCode || null,
      dni: dni ? String(dni).replace(/\D/g, '') : null,
      branch: branch || null,
      shipping_cost: ship.cost,
      shipping_weight_kg: weight,
      shipping_zone: ship.zone,
      notes: notes || null,
      share_gallery: req.body.shareGallery === '1',
      total,
      discount: pricedSingles.discount,

      // stickers sueltos
      items: pricedSingles.lines.map((line, idx) => ({
        size_cm: line.sizeCm,
        qty: line.qty,
        unit_price: line.unitPrice,
        line_total: line.total,
        image_path: singleRes[idx].print, image_orig: singleRes[idx].original, image_thumb: singleRes[idx].thumb, image_meta: singleRes[idx].meta,
        label: (items[idx] && items[idx].label) || null,
      })),

      // planchas de stickers (58 x 50 cm)
      sheets: pricedSheets.map((sheet, sIdx) => ({
        price: sheet.price,
        planchas: sheet.packing.planchas,
        width_cm: SHEET.widthCm,
        length_cm: SHEET.lengthCm,
        used_length_cm: sheet.packing.usedLengthCm,
        items: sheet.items.map((it, idx) => ({
          size_cm: stickerDims(it).w,
          h_cm: stickerDims(it).h,
          qty: Math.max(1, parseInt(it.qty, 10) || 1),
          image_path: sheetResGroups[sIdx][idx].print, image_orig: sheetResGroups[sIdx][idx].original, image_thumb: sheetResGroups[sIdx][idx].thumb, image_meta: sheetResGroups[sIdx][idx].meta,
          label: it.label || null,
        })),
      })),

      // planchas armadas (a la venta)
      packs: pricedPacks.lines.map((l) => ({ pack_id: l.packId, pack_key: l.key, title: l.title, stickers: l.stickers, qty: l.qty, unit_price: l.unitPrice, line_total: l.total, thumb: l.thumb })),

      // prendas estampadas
      shirts: pricedShirts.lines.map((line, idx) => {
        const raw = shirts[idx] || {};
        const place = (p) => (p ? {
          wCm: Number(p.wCm) || 0, hCm: Number(p.hCm) || 0, cx: Number(p.cx) || 0, top: Number(p.top) || 0, fromNeck: Number(p.fromNeck) || 0,
        } : null);
        return {
          garment_id: line.garment,
          garment_label: line.garmentLabel,
          size: line.size,
          color_id: line.colorId,
          color_label: line.colorLabel,
          color_hex: line.colorHex,
          print: line.print,
          print_label: line.printLabel,
          qty: line.qty,
          unit_price: line.unitPrice,
          line_total: line.total,
          front_image: shirtRes[idx].front.print, front_orig: shirtRes[idx].front.original, front_thumb: shirtRes[idx].front.thumb, front_meta: shirtRes[idx].front.meta,
          back_image: shirtRes[idx].back ? shirtRes[idx].back.print : null, back_orig: shirtRes[idx].back ? shirtRes[idx].back.original : null,
          back_thumb: shirtRes[idx].back ? shirtRes[idx].back.thumb : null, back_meta: shirtRes[idx].back ? shirtRes[idx].back.meta : null,
          label: raw.label || null,
          // medidas y ubicación de cada estampa en cm (desde el centro y desde el borde del cuello/hombro)
          placements: { front: place(raw.placements && raw.placements.front), back: place(raw.placements && raw.placements.back) },
        };
      }),
    });

    const orderCode = created.order_code;
    orderFolder.save(created); // copia legible del pedido en tu carpeta de datos
    try { extras.afterOrder(db, created); } catch (e) { console.error('contacto:', e.message); }
    // limpiamos los originales temporales que ya quedaron guardados en el pedido
    specs.forEach((sp) => { const f = sp.ref && tmpFile(sp.ref); if (f) { try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch (e) { /* ya no estaba */ } } });

    // Aviso por mail (no frena la respuesta al cliente si falla)
    const lines = [];
    items.forEach((it, i) => { const l = pricedSingles.lines[i]; if (l) lines.push(`Sticker suelto ${l.sizeCm} cm × ${l.qty}${it.label ? ' (' + it.label + ')' : ''} — ${money(l.total)}`); });
    pricedSheets.forEach((sh, i) => {
      lines.push(`Plancha ${SHEET.widthCm}×${SHEET.lengthCm} cm × ${sh.packing.planchas} — ${money(sh.price)}`);
      sh.items.forEach((it) => { const d = stickerDims(it); lines.push(`    ${Math.max(1, parseInt(it.qty, 10) || 1)} × ${d.w}×${d.h} cm${it.label ? ' ' + it.label : ''}`); });
    });
    pricedPacks.lines.forEach((l) => lines.push(`Plancha armada «${l.title}» (${l.stickers} stickers) × ${l.qty} — ${money(l.total)}`));
    pricedShirts.lines.forEach((l) => lines.push(`${l.garmentLabel} ${l.colorLabel} talle ${l.size}, ${l.printLabel} × ${l.qty} — ${money(l.total)}`));
    const provLabel = (shipping.PROVINCES.find((p) => p.id === province) || {}).label || '';
    const deliveryText = deliveryMethod === 'retiro' ? 'Retiro en local' : [
      shipping.METHODS[deliveryMethod] + ` — envío ${money(ship.cost)} (≈ ${weight} kg)`,
      `   Destinatario: ${customerName} · DNI ${String(dni).replace(/\D/g, '')} · Tel. ${customerPhone}`,
      deliveryMethod === 'correo_domicilio' ? `   Dirección: ${address}` : `   Sucursal: ${branch}`,
      `   ${city}, ${provLabel} · CP ${postalCode}`,
    ].join('\n');
    if (req.body.shareGallery === '1') lines.push('✔ El cliente permite publicar sus diseños de stickers en la galería (revisalos en el panel antes de publicar).');
    lines.push(`Subtotal productos: ${money(productsTotal)}`);
    if (ship.cost) lines.push(`Envío: ${money(ship.cost)}`);
    mailer.sendOrderMail({
      code: orderCode, name: customerName, phone: customerPhone, email: customerEmail, delivery: deliveryMethod,
      deliveryText, address, notes, total, lines, imagePaths,
    }, UPLOAD_DIR).catch((e) => console.error('No se pudo enviar el mail del pedido:', e.message));

    res.json({ orderCode, total, productsTotal, shippingCost: ship.cost, discount: pricedSingles.discount });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'No se pudo crear el pedido. Intentá de nuevo.' });
  }
});

// ---------- Admin: login ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

const adminHits = new Map();
// El usuario admin es ADMIN_USER (por defecto "admin"); también se acepta tu mail del negocio (ORDER_EMAIL / SMTP_USER),
// porque los navegadores suelen autocompletar el mail en vez del usuario.
function isAdminLogin(user, pass) {
  if (IS_PUBLIC && WEAK_PASS.includes(process.env.ADMIN_PASSWORD || '')) return false;
  const u = String(user || '').trim().toLowerCase(), adminPass = process.env.ADMIN_PASSWORD || 'admin';
  const names = [process.env.ADMIN_USER || 'admin', process.env.ORDER_EMAIL, process.env.SMTP_USER].filter(Boolean).map((x) => String(x).trim().toLowerCase());
  return !!u && names.includes(u) && String(pass || '') === adminPass;
}
app.post('/admin/api/login', (req, res) => {
  const { username, password } = req.body;
  const now = Date.now(), arr = (adminHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 12) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
  arr.push(now); adminHits.set(req.ip, arr);
  if (IS_PUBLIC && WEAK_PASS.includes(process.env.ADMIN_PASSWORD || '')) return res.status(503).json({ error: 'Falta configurar ADMIN_PASSWORD en el servidor (variables de entorno).' });

  if (isAdminLogin(username, password)) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

app.post('/admin/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/admin/api/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- Seguimiento del pedido (cliente): número + teléfono ----------
const trackHits = new Map();
const TRACK_LABELS = { pendiente_pago: 'Esperando el pago', pagado: 'Pago recibido', en_produccion: 'En producción', listo: 'Listo para retirar / despachar', entregado: 'Entregado', cancelado: 'Cancelado' };
app.post('/api/track', (req, res) => {
  const now = Date.now(), arr = (trackHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 20) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
  arr.push(now); trackHits.set(req.ip, arr);
  const digits = String((req.body && req.body.code) || '').replace(/\D/g, ''), phone = String((req.body && req.body.phone) || '').replace(/\D/g, '');
  const o = digits ? db.getAllOrders().find((x) => x.order_code === 'NALV-' + digits.padStart(4, '0')) : null;
  if (!o || phone.length < 6 || String(o.customer_phone || '').replace(/\D/g, '').slice(-8) !== phone.slice(-8)) return res.status(404).json({ error: 'No encontramos ese pedido. Revisá el número y el teléfono con el que lo hiciste.' });
  res.json({
    code: o.order_code, status: o.status, label: TRACK_LABELS[o.status] || o.status, created_at: o.created_at, total: o.total, delivery_method: o.delivery_method,
    history: (o.history || []).map((h) => ({ label: TRACK_LABELS[h.status] || h.status, at: h.at })),
    resumen: [].concat((o.items || []).map((i) => `Sticker ${i.size_cm} cm × ${i.qty}`), (o.sheets || []).map((sh) => `Plancha ${sh.width_cm}×${sh.length_cm} cm × ${sh.planchas || 1}`), (o.packs || []).map((k) => `${k.title} × ${k.qty}`), (o.shirts || []).map((sh) => `${sh.garment_label} ${sh.color_label} talle ${sh.size} × ${sh.qty}`)),
  });
});

// ---------- Admin: pedidos ----------
app.get('/admin/api/orders', requireAdmin, (req, res) => {
  res.json(db.getAllOrders());
});

app.post('/admin/api/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowed = ['pendiente_pago', 'pagado', 'en_produccion', 'listo', 'entregado', 'cancelado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const ok = db.updateOrderStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: 'Pedido no encontrado' });
  const o = db.getOrder(req.params.id); if (o) orderFolder.save(o);
  res.json({ ok: true, history: o ? o.history : [] });
});
// nota interna del pedido (solo la ves vos)
app.post('/admin/api/orders/:id/nota', requireAdmin, (req, res) => {
  const o = db.updateOrderMeta(req.params.id, { admin_note: req.body && req.body.note });
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  orderFolder.save(o);
  res.json({ ok: true });
});
app.get('/admin/api/pedidos/info', requireAdmin, (req, res) => res.json({ dir: orderFolder.DIR, total: db.getAllOrders().length, local: !IS_PUBLIC }));
app.post('/admin/api/pedidos/abrir', requireAdmin, (req, res) => {
  if (IS_PUBLIC) return res.status(400).json({ error: 'Esto solo funciona cuando el sitio corre en tu computadora.' });
  try { fs.mkdirSync(orderFolder.DIR, { recursive: true }); const cp = require('child_process'), cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'; const ch = cp.spawn(cmd, [orderFolder.DIR], { detached: true, stdio: 'ignore' }); ch.on('error', () => {}); ch.unref(); res.json({ ok: true, carpeta: orderFolder.DIR }); }
  catch (e) { res.json({ ok: false, carpeta: orderFolder.DIR }); }
});

// ---------- Archivo DTF (mejorado con IA) de un diseño de prenda ----------
// POST /admin/api/dtf { print: "/uploads/xxxx_print.png" } → arranca (o reutiliza) el archivo para imprimir en DTF.
// GET  /admin/api/dtf?print=… → estado / progreso. El PNG final queda en uploads/xxxx_dtf.png (solo se ve con sesión de admin).
const dtf = require('./dtf');
const PRINT_RE = /^\/uploads\/([a-f0-9]{8,32})_print\.png$/;
function findDesign(printPath) {
  for (const o of db.getAllOrders()) {
    for (const sh of (o.shirts || [])) {
      if (sh.front_image === printPath) return { o, meta: sh.front_meta };
      if (sh.back_image === printPath) return { o, meta: sh.back_meta };
    }
  }
  return null;
}
function dtfJob(printPath, start) {
  const m = PRINT_RE.exec(String(printPath || ''));
  if (!m) return { error: 'Archivo inválido.' };
  const found = findDesign(printPath);
  if (!found || !found.meta) return { error: 'No encontré ese diseño en los pedidos.' };
  const src = path.join(UPLOAD_DIR, `${m[1]}_print.png`);
  if (!fs.existsSync(src)) return { error: 'El archivo del diseño ya no está en el servidor.' };
  const meta = found.meta, wCm = Number(meta.wCm) || 20;
  const out = path.join(UPLOAD_DIR, `${m[1]}_dtf.png`);
  if (!start) { const cur = dtf.status(m[1]); if (cur) return { job: cur, id: m[1] }; if (!fs.existsSync(out)) return { job: { state: 'none', pct: 0 }, id: m[1] }; }
  const job = dtf.request(m[1], out, { src, wCm, hCm: Number(meta.hCm) || wCm, baseW: meta.cropW, baseH: meta.cropH });
  return { job, id: m[1] };
}
const dtfReply = (r) => r.error ? { state: 'error', error: r.error } : ({ state: r.job.state, pct: r.job.pct, info: r.job.info || null, error: r.job.error || null, url: r.job.state === 'ready' ? `/uploads/${r.id}_dtf.png` : null });
app.post('/admin/api/dtf', requireAdmin, (req, res) => res.json(dtfReply(dtfJob(req.body && req.body.print, true))));
app.get('/admin/api/dtf', requireAdmin, (req, res) => res.json(dtfReply(dtfJob(req.query.print, false))));

// ---------- Galería de stickers para descargar ----------
// Solo se publica lo que VOS aprobás en el panel: (a) stickers que subís vos, o (b) diseños de pedidos
// cuyo cliente marcó el permiso. Nada se publica solo.
const GALLERY_DIR = path.join(DATA_DIR, 'galeria');
fs.mkdirSync(GALLERY_DIR, { recursive: true });
const galleryPublic = (g) => ({ id: g.id, title: g.title, category: g.category || cats.OTROS.name, url: `/galeria/${g.thumb || g.file}`, full: `/galeria/${g.file}`, download: `/api/galeria/${g.id}/descargar`, featured: !!g.featured });

// Guarda la imagen completa (PNG, hasta 1200 px) y una miniatura liviana (WebP 360 px) para mostrar en la grilla.
async function saveGalleryImage(buffer) {
  const base = crypto.randomBytes(8).toString('hex');
  const file = base + '.png', thumb = base + '_t.webp';
  const img = sharp(buffer, { failOn: 'none', limitInputPixels: false }).rotate();
  await img.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toFile(path.join(GALLERY_DIR, file));
  await img.clone().resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(GALLERY_DIR, thumb));
  galSet = null;
  return { file, thumb };
}
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const cleanTitle = (t) => cats.decodeName(String(t || '').replace(/[\u0000-\u001f<>]/g, '')).slice(0, 60).trim() || 'Sticker';

// --- Que nunca se vea una imagen rota ---
// Solo se publican los stickers que tienen archivo; si falta una miniatura se regenera sola desde la imagen completa.
let galSet = null, galAt = 0;
function galFiles() {
  if (!galSet || Date.now() - galAt > 10000) { try { galSet = new Set(fs.readdirSync(GALLERY_DIR)); } catch (e) { galSet = new Set(); } galAt = Date.now(); }
  return galSet;
}
const galVisible = () => db.galleryAll().filter((g) => { const f = galFiles(); return f.has(g.file) || (g.thumb && f.has(g.thumb)); });
const fileOk = (f) => { try { return fs.statSync(path.join(GALLERY_DIR, f)).size > 0; } catch (e) { return false; } };
const thumbNameOf = (g) => g.thumb || String(g.file).replace(/\.[^.]+$/, '') + '_t.webp';
// Por si los archivos quedaron en otra carpeta (por ej. una versión anterior del sitio guardaba en data/galeria): se buscan y se copian.
const ALT_GAL_DIRS = [path.join(__dirname, 'data', 'galeria'), path.join(UPLOAD_DIR, 'galeria'), path.join(__dirname, 'public', 'galeria'), path.join(os.homedir() || '', 'nalv-datos', 'galeria')]
  .filter((d, i, a) => path.resolve(d) !== path.resolve(GALLERY_DIR) && a.indexOf(d) === i);
function recoverFile(name) {
  if (fileOk(name)) return true;
  for (const d of ALT_GAL_DIRS) {
    try { const src = path.join(d, name); if (fs.statSync(src).size > 0) { fs.copyFileSync(src, path.join(GALLERY_DIR, name)); galSet = null; console.log('[galería] recuperé ' + name + ' desde ' + d); return true; } } catch (e) { /* no está acá */ }
  }
  return false;
}
const thumbBusy = new Map();
function makeThumb(fullName, thumbName) { // regenera la miniatura (WebP 360 px) desde la imagen completa
  const key = thumbName;
  if (!thumbBusy.has(key)) {
    const tmp = path.join(GALLERY_DIR, thumbName + '.tmp' + process.pid);
    thumbBusy.set(key, sharp(path.join(GALLERY_DIR, fullName), { failOn: 'none', limitInputPixels: false }).rotate()
      .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(tmp)
      .then(() => { fs.renameSync(tmp, path.join(GALLERY_DIR, thumbName)); galSet = null; return true; })
      .catch((e) => { try { fs.unlinkSync(tmp); } catch (_) { /* nada */ } console.error('[galería] no pude armar la miniatura', thumbName + ':', e.message); return false; })
      .finally(() => thumbBusy.delete(key)));
  }
  return thumbBusy.get(key);
}
const decodes = (f) => sharp(path.join(GALLERY_DIR, f), { failOn: 'error', limitInputPixels: false }).resize(16, 16, { fit: 'inside' }).raw().toBuffer().then(() => true, () => false);
// Revisa todos los stickers. fix: regenera miniaturas rotas/faltantes. remove: quita de la galería los que no tienen ningún archivo.
async function checkGallery({ fix = false, remove = false } = {}) {
  const rep = { total: 0, ok: 0, fixable: 0, fixed: 0, onlyThumb: 0, missing: [], removed: 0 };
  const rows = db.galleryAll().slice();
  rep.total = rows.length;
  for (const g of rows) {
    const tn = thumbNameOf(g);
    if (fix) { recoverFile(g.file); recoverFile(tn); }
    const fullOk = fileOk(g.file) && (await decodes(g.file));
    const thumbOk = fileOk(tn) && (await decodes(tn));
    if (fullOk && thumbOk && (g.thumb === tn)) { rep.ok++; continue; }
    if (fullOk) {
      if (!fix) { rep.fixable++; continue; }
      try { fs.unlinkSync(path.join(GALLERY_DIR, tn)); } catch (e) { /* no estaba */ }
      if (await makeThumb(g.file, tn)) { if (g.thumb !== tn) db.tx((d) => { const r = (d.gallery || []).find((x) => x.id === g.id); if (r) r.thumb = tn; }); rep.fixed++; } else rep.missing.push({ id: g.id, title: g.title });
      continue;
    }
    if (thumbOk) { rep.onlyThumb++; continue; }
    rep.missing.push({ id: g.id, title: g.title });
  }
  if (remove) for (const m of rep.missing) { if (db.galleryRemove(m.id)) rep.removed++; }
  galSet = null;
  return rep;
}
// Orden: por categoría (Argentina primero…, "Variados" al final), recomendados primero y después por nombre.
const catRank = (c) => { const i = cats.ORDER.indexOf(c || cats.OTROS.name); return i < 0 ? cats.ORDER.length - 1 - 0.5 : i; };
const byCatTitle = (a, b) => catRank(a.category) - catRank(b.category) || String(a.category || '').localeCompare(String(b.category || ''), 'es') || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(a.title).localeCompare(String(b.title), 'es', { numeric: true, sensitivity: 'base' });
app.get('/api/galeria', (req, res) => {
  res.json(galVisible().map(galleryPublic).sort(byCatTitle));
});
app.get('/api/galeria/categorias', (req, res) => {
  const n = {}; galVisible().forEach((g) => { const c = g.category || cats.OTROS.name; n[c] = (n[c] || 0) + 1; });
  res.json(Object.keys(n).sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b, 'es')).map((name) => ({ name, emoji: cats.emojiOf(name), count: n[name] })));
});
app.get('/api/galeria/:id/descargar', (req, res) => {
  const g = db.galleryAll().find((x) => x.id === Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'No encontrado' });
  const name = g.title.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim().replace(/\s+/g, '-') || 'sticker';
  res.download(path.join(GALLERY_DIR, g.file), `nalv-${name}.png`);
});
const GAL_NAME = /^[a-f0-9]{8,32}(_t\.webp|\.png)$/i;
app.get('/galeria/:name', async (req, res) => {
  const name = req.params.name;
  if (!GAL_NAME.test(name)) return res.status(404).end();
  const thumb = /_t\.webp$/i.test(name);
  const full = thumb ? name.replace(/_t\.webp$/i, '.png') : name;
  if (thumb && !fileOk(name) && fileOk(full)) await makeThumb(full, name);          // miniatura perdida → se rehace
  recoverFile(name);
  let send = name;
  if (!fileOk(send)) { const alt = thumb ? full : name.replace(/\.png$/i, '_t.webp'); if (fileOk(alt)) send = alt; else { console.error('[galería] falta el archivo ' + name + ' en ' + GALLERY_DIR); return res.status(404).end(); } }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(send, { root: GALLERY_DIR, dotfiles: 'allow' }, (err) => { if (err && !res.headersSent) res.status(err.status || 404).end(); });
});
// ---- Archivos de imágenes que faltan (y cómo recuperarlos) ----
const recCtx = () => ({ db, DATA_DIR, UPLOAD_DIR });
app.get('/admin/api/faltantes', requireAdmin, (req, res) => {
  try { const n = recover.needed(recCtx()); res.json({ faltan: n.missing.size + n.keysMissing.size, de: n.total, carpeta: DATA_DIR, buscando: recover.status() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/recuperar', requireAdmin, (req, res) => { recover.run(recCtx()).catch((e) => console.error('[recuperar]', e.message)); res.json(recover.status()); });
app.get('/admin/api/recuperar', requireAdmin, (req, res) => res.json(recover.status()));
app.get('/admin/api/galeria/salud', requireAdmin, async (req, res) => { try { res.json(await checkGallery({})); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/admin/api/galeria/reparar', requireAdmin, async (req, res) => { try { res.json(await checkGallery({ fix: true, remove: !!(req.body && req.body.quitar) })); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/admin/api/galeria', requireAdmin, (req, res) => res.json(db.galleryAll().map((g) => ({ ...galleryPublic(g), source: g.source, order_code: g.order_code }))));

const ADMIN_MAX_MB = 80; // en el panel aceptamos archivos grandes (planchas de alta resolución)
const uploadAdminOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: ADMIN_MAX_MB * 1024 * 1024, files: 1 } });
// formatos que se aceptan en el panel (se convierten a PNG): los que lee sharp
const READABLE = ['png', 'jpeg', 'webp', 'gif', 'tiff', 'heif', 'avif'];
async function checkReadable(buffer) {
  let meta;
  try { meta = await sharp(buffer, { failOn: 'none', limitInputPixels: false }).metadata(); } catch (e) { return { ok: false, reason: 'el archivo no es una imagen válida o está dañado' }; }
  if (!READABLE.includes(meta.format)) return { ok: false, reason: `formato ${meta.format || 'desconocido'} no soportado (usá PNG, JPG o WEBP)` };
  return { ok: true, meta };
}
app.post('/admin/api/galeria', requireAdmin, uploadAdminOne.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Elegí una imagen.' });
    const chk = await checkReadable(req.file.buffer);
    if (!chk.ok) return res.status(400).json({ error: 'No se pudo leer la imagen: ' + chk.reason + '.' });
    if (req.body.rights !== '1') return res.status(400).json({ error: 'Confirmá que tenés derecho a compartir este sticker.' });
    const saved = await saveGalleryImage(req.file.buffer);
    res.json(galleryPublic(db.galleryAdd({ title: cleanTitle(req.body.title), ...saved, hash: sha1(req.file.buffer), source: 'propio', featured: req.body.featured === '1' })));
  } catch (e) { console.error('galeria:', e); res.status(500).json({ error: 'No se pudo guardar la imagen: ' + String(e.message || e).slice(0, 140) }); }
});

// ----- Carga masiva: varios archivos juntos, una carpeta entera o un .zip -----
// El panel manda de a 10 archivos por vez (así no se traba con 200+). Los repetidos se saltean solos.
const titleFromFile = (name, n) => {
  let t = path.basename(String(name || ''), path.extname(String(name || ''))).replace(/[_\-.]+/g, ' ').replace(/\s+\(\d+\)$/, '').replace(/\s+/g, ' ').trim();
  t = cats.decodeName(t);
  if (!t || cats.isJunkTitle(t) || /^[\d\s]+$/.test(t) || /^(img|image|imagen|sticker|photo|foto|whatsapp image)[\s\d]*$/i.test(t)) t = 'Sticker ' + n;
  return cleanTitle(t.charAt(0).toUpperCase() + t.slice(1));
};
async function addGalleryBatch(files, featured) { // files: [{ name, buffer }]
  const out = { added: 0, duplicates: 0, skipped: [] };
  const seen = new Set(db.galleryAll().map((g) => g.hash).filter(Boolean));
  const base = db.galleryAll().length;
  const asc = files.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true }));
  const num = new Map(asc.map((f, i) => [f, base + i + 1]));
  const ordered = asc.slice().reverse(); // se agregan al revés porque la galería muestra lo último agregado primero: así queda el "01" arriba
  for (const f of ordered) {
    try {
      const chk = await checkReadable(f.buffer);
      if (!chk.ok) { out.skipped.push({ name: f.name, reason: chk.reason }); continue; }
      const h = sha1(f.buffer);
      if (seen.has(h)) {
        // repetido: si el sticker ya estaba cargado pero se perdió su archivo (pasa si se movió la carpeta de datos), se le devuelve la imagen
        const row = db.galleryAll().find((g) => g.hash === h);
        if (row && !(fileOk(row.file) && fileOk(thumbNameOf(row)))) {
          try {
            const saved = await saveGalleryImage(f.buffer);
            db.tx((d) => { const r = (d.gallery || []).find((g) => g.hash === h); if (r) { r.file = saved.file; r.thumb = saved.thumb; } });
            out.restored = (out.restored || 0) + 1;
          } catch (e) { console.error('restaurar:', f.name, e.message); }
        }
        out.duplicates++;
        if (f.category) db.tx((d) => { const r = (d.gallery || []).find((g) => g.hash === h); if (r && r.cat_auto !== false) { r.category = f.category; r.cat_auto = false; } }); // repetido pero ahora viene en una carpeta: se le pone esa categoría
        continue;
      }
      seen.add(h);
      const saved = await saveGalleryImage(f.buffer);
      db.galleryAdd({ title: titleFromFile(f.name, num.get(f)), ...saved, hash: h, source: 'propio', featured: !!featured, category: f.category || undefined });
      out.added++;
    } catch (e) { console.error('lote:', f.name, e); out.skipped.push({ name: f.name, reason: 'no se pudo guardar (' + String(e.message || e).slice(0, 100) + ')' }); }
  }
  return out;
}
const uploadBatch = multer({ storage: multer.memoryStorage(), limits: { fileSize: ADMIN_MAX_MB * 1024 * 1024, files: 25 } });
app.post('/admin/api/galeria/lote', requireAdmin, uploadBatch.array('images', 25), async (req, res) => {
  try {
    if (req.body.rights !== '1') return res.status(400).json({ error: 'Confirmá que tenés derecho a compartir estos stickers.' });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No llegó ningún archivo.' });
    let cs = []; try { cs = JSON.parse(req.body.cats || '[]'); } catch (e) { /* sin categorías */ }
    res.json(await addGalleryBatch(req.files.map((f, i) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buffer: f.buffer, category: cs[i] ? cats.folderCategory(cs[i]) : '' })), req.body.featured === '1'));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar el lote.' }); }
});
const uploadZip = multer({ dest: os.tmpdir(), limits: { fileSize: 800 * 1024 * 1024, files: 1 } });
// Importa un .zip de stickers (las carpetas son categorías). Se usa para el .zip que sube el admin y para el pack libre incluido.
async function importZipFile(zipPath, { featured = false, useCats = true, onProgress } = {}) {
  let entries;
  try { entries = new AdmZip(zipPath).getEntries(); } catch (e) { const er = new Error('No se pudo abrir el .zip (¿está dañado?).'); er.status = 400; throw er; }
  const imgs = entries.filter((e) => !e.isDirectory && !/(^|\/)(__MACOSX|\.)/.test(e.entryName) && /\.(png|jpe?g|webp|gif|tiff?|avif|heic)$/i.test(e.entryName));
  if (imgs.length > 6000) { const er = new Error('El .zip tiene más de 6000 imágenes; dividilo en partes.'); er.status = 400; throw er; }
  const out = { added: 0, duplicates: 0, skipped: [], total: imgs.length };
  let bytes = 0;
  // carpetas del .zip = categorías (se ignora la carpeta raíz que tengan todos en común)
  const dirsOf = imgs.map((e) => e.entryName.replace(/\\/g, '/').split('/').slice(0, -1));
  let common = 0; while (dirsOf.length && dirsOf.every((d) => d.length > common && d[common] === dirsOf[0][common])) common++;
  const zipCat = (name) => { if (!useCats) return ''; const d = name.replace(/\\/g, '/').split('/').slice(0, -1); return d.length > common ? cats.folderCategory(d[common]) : ''; };
  imgs.sort((a, b) => String(b.entryName).localeCompare(String(a.entryName), 'es', { numeric: true }));
  for (let i = 0; i < imgs.length; i += 10) {
    const chunk = [];
    for (const e of imgs.slice(i, i + 10)) {
      bytes += e.header.size;
      if (e.header.size > ADMIN_MAX_MB * 1024 * 1024) { out.skipped.push({ name: e.entryName, reason: 'pesa más de ' + ADMIN_MAX_MB + ' MB' }); continue; }
      if (bytes > 3 * 1024 * 1024 * 1024) { out.skipped.push({ name: e.entryName, reason: 'el .zip descomprimido es demasiado grande' }); continue; }
      chunk.push({ name: path.basename(e.entryName), buffer: e.getData(), category: zipCat(e.entryName) });
    }
    const r = await addGalleryBatch(chunk, featured);
    out.added += r.added; out.duplicates += r.duplicates; out.restored = (out.restored || 0) + (r.restored || 0); out.skipped.push(...r.skipped);
    if (onProgress) onProgress(Math.min(i + 10, imgs.length), imgs.length, out);
  }
  return out;
}
app.post('/admin/api/galeria/zip', requireAdmin, uploadZip.single('zip'), async (req, res) => {
  const tmp = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Elegí un archivo .zip.' });
    if (req.body.rights !== '1') return res.status(400).json({ error: 'Confirmá que tenés derecho a compartir estos stickers.' });
    res.json(await importZipFile(tmp, { featured: req.body.featured === '1', useCats: req.body.usecats !== '0' }));
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error(e); res.status(500).json({ error: 'No se pudo importar el .zip.' }); }
  finally { if (tmp) fs.unlink(tmp, () => {}); }
});
// Packs de stickers libres (emojis Fluent MIT, banderas circle-flags MIT, frases originales): son uno o varios .zip en la carpeta
// packs-libres (stickers-libres-1.zip, -2, …) y se cargan con un botón. Las carpetas de cada .zip son las categorías.
const PACK_DIR = path.join(__dirname, 'packs-libres');
const packZips = () => { try { return fs.readdirSync(PACK_DIR).filter((f) => /^stickers-libres.*\.zip$/i.test(f)).sort().map((f) => path.join(PACK_DIR, f)); } catch (e) { return []; } };
let packLibreJob = { running: false, done: 0, total: 0, added: 0, duplicates: 0, error: null, finished: false };
app.get('/admin/api/pack-libre', requireAdmin, (req, res) => res.json({ available: packZips().length > 0, partes: packZips().length, ...packLibreJob }));
function startPackLibre() {
  const zips = packZips();
  if (!zips.length || packLibreJob.running) return false;
  packLibreJob = { running: true, done: 0, total: 0, added: 0, duplicates: 0, error: null, finished: false };
  (async () => {
    let doneBase = 0, addedBase = 0, dupBase = 0, totalAll = 0;
    for (const z of zips) { try { totalAll += new AdmZip(z).getEntries().filter((e) => !e.isDirectory && /\.(png|jpe?g|webp)$/i.test(e.entryName)).length; } catch (e) { /* se informa al importar */ } }
    packLibreJob.total = totalAll;
    for (const z of zips) {
      const o = await importZipFile(z, { onProgress: (d, t, o2) => { packLibreJob.done = doneBase + d; packLibreJob.added = addedBase + o2.added; packLibreJob.duplicates = dupBase + o2.duplicates; } });
      doneBase += o.total; addedBase += o.added; dupBase += o.duplicates;
      packLibreJob.done = doneBase; packLibreJob.added = addedBase; packLibreJob.duplicates = dupBase;
    }
    db.tx((d) => { d.flags = d.flags || {}; d.flags.packLibreV2 = new Date().toISOString(); }); // se carga sola una vez; si después borrás stickers, no vuelven
  })().catch((e) => { console.error(e); packLibreJob.error = 'No se pudo cargar el pack: ' + e.message; })
    .finally(() => { packLibreJob.running = false; packLibreJob.finished = true; });
  return true;
}
app.post('/admin/api/pack-libre', requireAdmin, (req, res) => {
  if (!packZips().length) return res.status(404).json({ error: 'No encuentro el .zip de stickers libres. Tiene que estar en la carpeta "packs-libres" del sitio (junto a server.js).' });
  startPackLibre();
  res.json({ available: true, ...packLibreJob });
});
// ---------- Carpeta automática: lo que pongas en "stickers-nuevos" se sube solo a la galería ----------
// Imágenes sueltas o .zip. Las subcarpetas son categorías (stickers-nuevos/Boca/… → categoría "Boca"). Lo ya cargado se mueve a "_cargados".
const INBOX = path.join(DATA_DIR, 'stickers-nuevos');
const INBOX_EXT = /\.(png|jpe?g|webp|gif|tiff?|avif|heic)$/i;
let inbox = { running: false, imported: 0, duplicates: 0, restored: 0, problems: 0, pending: 0, lastRun: null, note: '' };
// Además de la carpeta de siempre, podés elegir OTRA carpeta de tu computadora (ej: "Mis stickers" en el Escritorio) desde el panel.
const extraInbox = () => { const d = String(((db.read().settings || {}).carpetaExtra) || '').trim(); return d && !IS_PUBLIC ? d : ''; };
const inboxRoots = () => [INBOX].concat(extraInbox() && path.resolve(extraInbox()) !== path.resolve(INBOX) ? [extraInbox()] : []);
for (const r of inboxRoots()) { try { fs.mkdirSync(path.join(r, '_cargados'), { recursive: true }); } catch (e) { console.error('[carpeta]', e.message); } }
function inboxList() {
  const out = [];
  for (const root of inboxRoots()) (function walk(dir, rel) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('_') || e.name.startsWith('~')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, rel.concat(e.name));
      else if (e.isFile() && (INBOX_EXT.test(e.name) || /\.zip$/i.test(e.name))) {
        let st; try { st = fs.statSync(full); } catch (x) { continue; }
        out.push({ root, full, rel, name: e.name, size: st.size, ready: Date.now() - st.mtimeMs > 4000 && st.size > 0 });
      }
    }
  })(root, []);
  return out;
}
async function moveTo(sub, f) {
  const dir = path.join(f.root || INBOX, sub, ...f.rel); await fs.promises.mkdir(dir, { recursive: true });
  let dst = path.join(dir, f.name);
  if (fs.existsSync(dst)) dst = path.join(dir, Date.now() + '_' + f.name);
  try { await fs.promises.rename(f.full, dst); } catch (e) { await fs.promises.copyFile(f.full, dst); await fs.promises.unlink(f.full); }
}
async function scanInbox() {
  if (inbox.running) return inbox;
  const all = inboxList(), files = all.filter((f) => f.ready);
  inbox.pending = all.length;
  if (!files.length) { inbox.lastRun = new Date().toISOString(); return inbox; }
  inbox.running = true; inbox.note = `Subiendo ${files.length} archivos…`;
  try {
    const zips = files.filter((f) => /\.zip$/i.test(f.name)), imgs = files.filter((f) => !/\.zip$/i.test(f.name));
    for (const z of zips) {
      try { const o = await importZipFile(z.full, {}); inbox.imported += o.added; inbox.duplicates += o.duplicates; inbox.restored += o.restored || 0; await moveTo('_cargados', z); }
      catch (e) { console.error('[carpeta] zip', z.name, e.message); inbox.problems++; await moveTo('_con-problemas', z).catch(() => {}); }
    }
    for (let i = 0; i < imgs.length; i += 10) {
      const chunk = imgs.slice(i, i + 10), batch = [];
      for (const f of chunk) {
        try { batch.push({ f, name: f.name, buffer: await fs.promises.readFile(f.full), category: f.rel.length ? cats.folderCategory(f.rel[0]) : '' }); }
        catch (e) { inbox.problems++; }
      }
      const r = await addGalleryBatch(batch.map((b) => ({ name: b.name, buffer: b.buffer, category: b.category })), false);
      inbox.imported += r.added; inbox.duplicates += r.duplicates; inbox.restored += r.restored || 0;
      const bad = new Set((r.skipped || []).map((x) => x.name));
      for (const b of batch) { if (bad.has(b.name)) { inbox.problems++; await moveTo('_con-problemas', b.f).catch(() => {}); } else await moveTo('_cargados', b.f).catch((e) => console.error('[carpeta] mover', e.message)); }
    }
    inbox.note = `Última vez: ${inbox.imported} stickers nuevos${inbox.duplicates ? ', ' + inbox.duplicates + ' repetidos' : ''}${inbox.restored ? ', ' + inbox.restored + ' recuperados' : ''}${inbox.problems ? ', ' + inbox.problems + ' con problemas (quedaron en _con-problemas)' : ''}.`;
    console.log('📂 Carpeta de stickers: ' + inbox.note);
  } catch (e) { console.error('[carpeta]', e); inbox.note = 'Error: ' + e.message; }
  finally { inbox.running = false; inbox.lastRun = new Date().toISOString(); inbox.pending = inboxList().length; }
  return inbox;
}
setTimeout(() => { scanInbox().catch(() => {}); const t = setInterval(() => scanInbox().catch(() => {}), 15000); if (t.unref) t.unref(); }, 5000);
app.get('/admin/api/carpeta', requireAdmin, (req, res) => { const l = inboxList(); res.json({ carpeta: INBOX, extra: extraInbox(), local: !IS_PUBLIC, ...inbox, pending: l.length }); });
app.post('/admin/api/carpeta/revisar', requireAdmin, (req, res) => { scanInbox().catch(() => {}); res.json({ ok: true, ...inbox }); });
// elegir otra carpeta (o dejar vacío para volver a la de siempre)
app.post('/admin/api/carpeta/config', requireAdmin, (req, res) => {
  if (IS_PUBLIC) return res.status(400).json({ error: 'Esto solo funciona cuando el sitio corre en tu computadora.' });
  let dir = String((req.body && req.body.dir) || '').trim().replace(/^"+|"+$/g, '');
  if (dir) {
    try { dir = path.resolve(dir); fs.mkdirSync(path.join(dir, '_cargados'), { recursive: true }); if (!fs.statSync(dir).isDirectory()) throw new Error('no es carpeta'); }
    catch (e) { return res.status(400).json({ error: 'No pude usar esa carpeta (' + e.message + '). Revisá que la ruta exista, por ejemplo C:\\Users\\Alvar\\Desktop\\Mis stickers' }); }
    if (dir === path.parse(dir).root) return res.status(400).json({ error: 'Elegí una carpeta específica, no el disco entero.' });
  }
  db.tx((d) => { d.settings = d.settings || {}; d.settings.carpetaExtra = dir; });
  scanInbox().catch(() => {});
  res.json({ ok: true, extra: dir });
});
app.post('/admin/api/carpeta/abrir', requireAdmin, (req, res) => {
  if (IS_PUBLIC) return res.status(400).json({ error: 'Esto solo funciona cuando el sitio corre en tu computadora.' });
  const target = (req.body && req.body.cual === 'extra' && extraInbox()) || INBOX;
  try {
    const cp = require('child_process'), cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const ch = cp.spawn(cmd, [target], { detached: true, stdio: 'ignore' }); ch.on('error', () => {}); ch.unref();
    res.json({ ok: true, carpeta: target });
  } catch (e) { res.json({ ok: false, carpeta: target }); }
});
const cleanCat = (c) => cats.decodeName(String(c || '').replace(/[\u0000-\u001f<>]/g, '')).slice(0, 40).trim();
// Mover varios stickers juntos a una categoría: { ids:[…], category:'Mates y termos' }
app.post('/admin/api/galeria/categoria', requireAdmin, (req, res) => {
  const ids = new Set(((req.body && req.body.ids) || []).map(Number)), c = cleanCat(req.body && req.body.category);
  if (!ids.size || !c) return res.status(400).json({ error: 'Elegí stickers y una categoría.' });
  let n = 0;
  db.tx((d) => { (d.gallery || []).forEach((g) => { if (ids.has(g.id)) { g.category = c; g.cat_auto = false; n++; } }); });
  res.json({ ok: true, changed: n });
});
// Ordenar todo de nuevo: limpia nombres raros y vuelve a clasificar los que NO cambiaste a mano.
app.get('/admin/api/galeria/categorias', requireAdmin, (req, res) => {
  const n = {}; cats.ORDER.forEach((c) => { n[c] = 0; }); db.galleryAll().forEach((g) => { const c = g.category || cats.OTROS.name; n[c] = (n[c] || 0) + 1; });
  res.json(Object.keys(n).sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b, 'es')).map((name) => ({ name, emoji: cats.emojiOf(name), count: n[name] })));
});
app.post('/admin/api/galeria/ordenar', requireAdmin, (req, res) => res.json(organizeGallery()));
app.patch('/admin/api/galeria/:id', requireAdmin, (req, res) => {
  const row = db.galleryRename(req.params.id, req.body.title ? cleanTitle(req.body.title) : '', req.body.featured === undefined ? undefined : !!req.body.featured, req.body.category ? cleanCat(req.body.category) : '');
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(galleryPublic(row));
});

// Publicar un diseño que llegó en un pedido (solo si el cliente dio el permiso)
app.post('/admin/api/galeria/desde-pedido', requireAdmin, async (req, res) => {
  try {
    const order = db.getOrder(req.body.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!order.share_gallery) return res.status(403).json({ error: 'Este cliente no dio permiso para publicar sus diseños.' });
    const imgPath = String(req.body.imagePath || '');
    const own = [...order.items.map((i) => i.image_path), ...order.sheets.flatMap((s) => s.items.map((i) => i.image_path))];
    if (!own.includes(imgPath)) return res.status(400).json({ error: 'Esa imagen no es un sticker de este pedido.' });
    const src = path.join(UPLOAD_DIR, path.basename(imgPath));
    if (!fs.existsSync(src) || path.extname(src) === '.svg') return res.status(400).json({ error: 'Imagen no disponible.' });
    const buf = fs.readFileSync(src);
    const saved = await saveGalleryImage(buf);
    res.json(galleryPublic(db.galleryAdd({ title: cleanTitle(req.body.title), ...saved, hash: sha1(buf), source: 'cliente', order_code: order.order_code })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo publicar.' }); }
});

app.delete('/admin/api/galeria/:id', requireAdmin, (req, res) => {
  const row = db.galleryRemove(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  for (const f of [row.file, row.thumb]) { if (f) try { fs.unlinkSync(path.join(GALLERY_DIR, path.basename(f))); } catch (e) { /* ya no estaba */ } }
  res.json({ ok: true });
});

// ---------- Admin: descargar todos los archivos de un pedido (.zip) ----------
const safeName = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'diseno';
app.get('/admin/api/orders/:id/zip', requireAdmin, async (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const archive = archiver('zip', { zlib: { level: 3 } });
  archive.on('error', (e) => { console.error(e); res.end(); });
  res.attachment(`${o.order_code}.zip`);
  archive.pipe(res);
  const root = o.order_code;
  const lines = [`PEDIDO ${o.order_code}`, `Fecha: ${new Date(o.created_at).toLocaleString('es-AR')}`, `Cliente: ${o.customer_name} · ${o.customer_phone}${o.customer_email ? ' · ' + o.customer_email : ''}`,
    `Total: ${money(o.total)}`, o.notes ? `Notas: ${o.notes}` : null, '', 'ARCHIVOS: *_IMPRIMIR.png = listo para imprimir (recorte/fondo aplicados, ~300 dpi) · *_original = archivo tal cual lo subió el cliente', ''].filter((x) => x !== null);
  let n = 0;
  const addFile = (p, name) => { if (!p) return; const f = path.join(UPLOAD_DIR, path.basename(p)); if (fs.existsSync(f)) archive.file(f, { name }); };
  const addPair = (folder, base, printPath, origPath, meta, info) => {
    n++;
    const nn = String(n).padStart(2, '0');
    addFile(printPath, `${root}/${folder}/${nn}_${base}_IMPRIMIR.png`);
    addFile(origPath, `${root}/${folder}/${nn}_${base}_original${origPath ? path.extname(origPath) : ''}`);
    lines.push(`${nn}. ${info}${meta ? ` — calidad ${meta.quality}${meta.dpi ? ` (${meta.dpi} dpi reales)` : ''}${meta.upscaled ? ', agrandada a ~300 dpi' : ''}` : ''}`);
  };
  (o.items || []).forEach((it) => addPair('stickers-sueltos', `${safeName(it.label)}_${it.size_cm}cm_x${it.qty}`, it.image_path, it.image_orig, it.image_meta, `Sticker suelto ${it.size_cm} cm × ${it.qty}`));
  (o.sheets || []).forEach((sh, si) => (sh.items || []).forEach((it) => addPair(`plancha-${si + 1}`, `${safeName(it.label)}_${it.size_cm}x${it.h_cm || it.size_cm}cm_x${it.qty}`, it.image_path, it.image_orig, it.image_meta, `Plancha ${si + 1}: ${it.size_cm} × ${it.h_cm || it.size_cm} cm × ${it.qty}`)));
  (o.shirts || []).forEach((sh) => {
    const base = `${safeName(sh.garment_label)}_${safeName(sh.color_label)}_talle${safeName(sh.size)}_x${sh.qty}`;
    const pl = (side) => (sh.placements && sh.placements[side] ? ` (${sh.placements[side].wCm} × ${sh.placements[side].hCm} cm, a ${sh.placements[side].fromNeck} cm del cuello)` : '');
    addPair('prendas', `${base}_FRENTE`, sh.front_image, sh.front_orig, sh.front_meta, `${sh.garment_label} ${sh.color_label} talle ${sh.size} × ${sh.qty} — FRENTE${pl('front')}`);
    if (sh.back_image) addPair('prendas', `${base}_ESPALDA`, sh.back_image, sh.back_orig, sh.back_meta, `${sh.garment_label} ${sh.color_label} talle ${sh.size} × ${sh.qty} — ESPALDA${pl('back')}`);
  });
  // lo que armó el cliente: cada plancha completa (58 × 50 cm, 300 dpi) y la maqueta de cada prenda
  try {
    for (let si = 0; si < (o.sheets || []).length; si++) {
      const n = orderArt.planchaCount(o.sheets[si]);
      for (let pi = 0; pi < n; pi++) {
        const png = await orderArt.sheetPng(o.sheets[si], pi, UPLOAD_DIR, 300);
        if (png) { archive.append(png, { name: `${root}/plancha-${si + 1}/PLANCHA_ARMADA_${pi + 1}_de_${n}_${SHEET.widthCm}x${SHEET.lengthCm}cm_300dpi.png` }); lines.push(`Plancha ${si + 1}: PLANCHA_ARMADA_${pi + 1}_de_${n} = la plancha completa tal como la armó el cliente, lista para imprimir.`); }
      }
    }
    let k = 0;
    for (const sh of (o.shirts || [])) {
      k++;
      for (const side of ['front', 'back']) {
        if (!(side === 'front' ? sh.front_image : sh.back_image)) continue;
        const png = await orderArt.shirtMockup(sh, side, UPLOAD_DIR, 1000);
        archive.append(png, { name: `${root}/prendas/${String(k).padStart(2, '0')}_${safeName(sh.garment_label)}_${safeName(sh.color_label)}_talle${safeName(sh.size)}_MAQUETA_${side === 'front' ? 'FRENTE' : 'ESPALDA'}.png` });
      }
    }
    if ((o.shirts || []).length) lines.push('MAQUETA = cómo ubicó el cliente la estampa en la prenda (para controlar la posición al estampar).');
  } catch (e) { console.error('zip: plancha armada', e.message); lines.push('(No se pudo generar la plancha armada: ' + e.message + ')'); }
  archive.append(lines.join('\n'), { name: `${root}/pedido.txt` });
  archive.finalize();
});

// Vista de lo que armó el cliente (para ver en el panel o bajar): plancha completa y maqueta de prenda
const artCache = new Map();
async function cachedArt(key, make) {
  if (artCache.has(key)) return artCache.get(key);
  const buf = await make(); artCache.set(key, buf); if (artCache.size > 40) artCache.delete(artCache.keys().next().value); return buf;
}
app.get('/admin/api/orders/:id/plancha/:si/:pi.png', requireAdmin, async (req, res) => {
  try {
    const o = db.getOrder(req.params.id), sh = o && (o.sheets || [])[Number(req.params.si)];
    if (!sh) return res.status(404).json({ error: 'No encontrada' });
    const dpi = Math.max(20, Math.min(300, parseInt(req.query.dpi, 10) || 45)), pi = Number(req.params.pi) || 0;
    const buf = await cachedArt(`s:${o.id}:${req.params.si}:${pi}:${dpi}`, () => orderArt.sheetPng(sh, pi, UPLOAD_DIR, dpi));
    if (!buf) return res.status(404).json({ error: 'No encontrada' });
    res.set('Content-Type', 'image/png'); if (req.query.descargar) res.attachment(`${o.order_code}_PLANCHA_${Number(req.params.si) + 1}-${pi + 1}_${SHEET.widthCm}x${SHEET.lengthCm}cm_${dpi}dpi.png`);
    res.send(buf);
  } catch (e) { console.error('plancha armada:', e.message); res.status(500).json({ error: 'No se pudo armar la plancha.' }); }
});
app.get('/admin/api/orders/:id/prenda/:idx/:side.png', requireAdmin, async (req, res) => {
  try {
    const o = db.getOrder(req.params.id), sh = o && (o.shirts || [])[Number(req.params.idx)];
    if (!sh) return res.status(404).json({ error: 'No encontrada' });
    const side = req.params.side === 'back' ? 'back' : 'front';
    const buf = await cachedArt(`p:${o.id}:${req.params.idx}:${side}`, () => orderArt.shirtMockup(sh, side, UPLOAD_DIR, 900));
    res.set('Content-Type', 'image/png'); if (req.query.descargar) res.attachment(`${o.order_code}_MAQUETA_${side}.png`);
    res.send(buf);
  } catch (e) { console.error('maqueta:', e.message); res.status(500).json({ error: 'No se pudo armar la maqueta.' }); }
});

// Servir imágenes subidas: SOLO el panel de admin (son diseños de clientes)
app.use('/uploads', requireAdmin, express.static(UPLOAD_DIR));


// ---------- Cuentas, métricas, gastos, clientes, promos y stickers sugeridos ----------
async function galleryAddFromBuffer(buf, title, source) {
  const saved = await saveGalleryImage(buf);
  return db.galleryAdd({ title, ...saved, hash: sha1(buf), source });
}
require('./packs').mount(app, { db, requireAdmin, DATA_DIR, GALLERY_DIR });
extras.mount(app, { isAdminLogin, db, mailer, requireAdmin, UPLOAD_DIR, saveGalleryImage, galleryAddFromBuffer, sha1, cleanTitle });

// Errores de subida (archivo muy pesado, demasiados archivos…) siempre como JSON legible
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isApi = req.path.startsWith('/api') || req.path.startsWith('/admin/api');
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo pesa demasiado' + (req.path.startsWith('/admin') ? ` (el máximo en el panel es ${ADMIN_MAX_MB} MB)` : ' (máximo 12 MB)') + '. Probá con una versión más liviana.' });
  if (err && err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Hay demasiados archivos juntos. Subilos en tandas más chicas.' });
  if (err && err.code && String(err.code).startsWith('LIMIT_')) return res.status(400).json({ error: 'No se pudo subir: ' + err.message });
  if (isApi) { console.error(err); return res.status(err.status || err.statusCode || 500).json({ error: (err && err.message) || 'Error del servidor' }); }
  next(err);
});

// Fallback simple para rutas no encontradas de la API
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

// Autodiagnóstico del procesador de imágenes (sharp): si falla, lo dice clarito en la ventana negra
(async () => {
  try {
    const px = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 77, b: 0, alpha: 1 } } }).png().toBuffer();
    await sharp(px).resize(16, 16).webp({ quality: 80 }).toBuffer();
    await sharp(px).resize(16, 16).jpeg().toBuffer();
    console.log('🖼  Procesador de imágenes: OK (sharp ' + (sharp.versions && sharp.versions.sharp || '') + ')');
  } catch (e) {
    console.error('⚠ El procesador de imágenes (sharp) NO funciona en esta computadora: ' + e.message);
    console.error('   Por eso no se pueden leer los stickers. Solución: cerrá esta ventana, borrá la carpeta "node_modules" y corré de nuevo INICIAR-WINDOWS.bat (o: npm install --include=optional). Necesitás Node.js 18 o más nuevo.');
  }
})();

const httpServer = app.listen(PORT, () => {
  console.log(`✅ Tienda de stickers (versión ${APP_VERSION}) corriendo en http://localhost:${PORT}`);
  try { const n = orderFolder.backfill(db.getAllOrders()); console.log(`📦 Pedidos: ${db.getAllOrders().length} guardados · copia legible en ${orderFolder.DIR}${n ? ` (completé ${n} carpetas)` : ''}`); } catch (e) { console.error('pedidos:', e.message); }
  console.log(`💾 Tus datos (pedidos, métricas, stickers, clientes) se guardan en: ${DATA_DIR}${CUSTOM_DATA ? '' : '  ⚠ DENTRO del sitio: definí DATA_DIR en .env'}`);
});
httpServer.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n❌ El puerto ${PORT} ya está en uso: la tienda (o una versión vieja) ya está abierta en OTRA ventana negra.`);
    console.error('   Por eso en el navegador seguís viendo la versión anterior. Cerrá esa otra ventana (o apagá la PC y volvé a abrir) y abrí este archivo de nuevo.\n');
  } else console.error('❌ No se pudo iniciar el servidor:', e && e.message);
  process.exit(1);
});
function organizeGallery() {
  const out = { renamed: 0, categorized: 0 };
  db.tx((d) => {
    for (const g of (d.gallery || [])) {
      const t = cats.decodeName(g.title);
      if (cats.isJunkTitle(t)) { const n = 'Sticker ' + String(g.id).padStart(3, '0'); if (g.title !== n) { g.title = n; out.renamed++; } }
      else if (t !== g.title) { g.title = t.slice(0, 60); out.renamed++; }
      if (!g.category || g.cat_auto !== false) {
        const c = cats.inicial(g.hash) || cats.categorize(g.title);
        if (g.category !== c || g.cat_auto !== true) { if (g.category !== c) out.categorized++; g.category = c; g.cat_auto = true; }
      }
    }
  });
  return out;
}
try { const o = organizeGallery(); if (o.renamed || o.categorized) console.log(`🗂  Stickers ordenados por categoría: ${o.categorized} clasificados, ${o.renamed} nombres corregidos`); } catch (e) { console.error('[galería] ordenar:', e.message); }
// Al arrancar: revisa la galería en segundo plano y rehace las miniaturas que falten o estén dañadas.
setTimeout(async () => {
  try {
    // 1) si faltan imágenes, se buscan en las carpetas habituales de la computadora y se copian
    try {
      const n = recover.needed(recCtx());
      if (n.missing.size + n.keysMissing.size) {
        console.log(`🔎 Faltan ${n.missing.size + n.keysMissing.size} archivos de imágenes en ${DATA_DIR}. Los busco en esta computadora (no borra ni mueve nada, solo copia)…`);
        const st = await recover.run(recCtx());
        console.log('🔎 ' + st.note);
      }
    } catch (e) { console.error('[recuperar]', e.message); }
    const r = await checkGallery({ fix: true });
    console.log(`🖼  Galería: ${r.total} stickers · ${r.ok} bien${r.fixed ? ' · ' + r.fixed + ' miniaturas rehechas' : ''}${r.missing.length ? ' · ⚠ ' + r.missing.length + ' SIN ARCHIVO en ' + GALLERY_DIR + ' (se ocultan de la web; en el panel > Ajustes podés quitarlos)' : ''}`);
  } catch (e) { console.error('[galería] revisión:', e.message); }
  // Stickers libres incluidos: se agregan solos la primera vez que arranca el sitio (en segundo plano; no duplica).
  try {
    // limpieza única: saca los 1.271 stickers genéricos (emojis y banderas) que traía la versión anterior; solo los que coinciden exactamente (por huella)
    if (!(db.read().flags || {}).limpiezaV1) {
      let hs = []; try { hs = new Set(require('./packs-libres/quitar-v1.json')); } catch (e) { hs = new Set(); }
      if (hs.size) {
        const gone = db.galleryAll().filter((g) => g.hash && hs.has(g.hash));
        gone.forEach((g) => { [g.file, thumbNameOf(g)].forEach((f) => { try { fs.unlinkSync(path.join(GALLERY_DIR, f)); } catch (e) { /* ya no estaba */ } }); });
        if (gone.length) { const ids = new Set(gone.map((g) => g.id)); db.tx((d) => { d.gallery = (d.gallery || []).filter((g) => !ids.has(g.id)); }); galSet = null; console.log(`🧹 Saqué ${gone.length} stickers genéricos de la versión anterior (emojis y banderas).`); }
      }
      db.tx((d) => { d.flags = d.flags || {}; d.flags.limpiezaV1 = new Date().toISOString(); });
    }
    const flags = (db.read().flags || {});
    if (!flags.packLibreV2 && packZips().length && startPackLibre()) console.log('🎁 Agregando los stickers argentinos incluidos a la galería (tarda un momento, la web ya se puede usar)…');
  } catch (e) { console.error('[pack libre]', e.message); }
}, 1500);
