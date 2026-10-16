// extras.js — cuentas de clientes, métricas / gastos / clientes (panel de admin), promos por mail,
// baja de promos y stickers sugeridos por la gente (cola de aprobación).
// Se enchufa desde server.js con mount(app, ctx).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const os = require('os');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { DATA_DIR, UPLOAD_DIR: UPLOAD_ROOT, custom: CUSTOM_DATA } = require('./paths');

const TZ = 'America/Argentina/Buenos_Aires';
const PAID = ['pagado', 'en_produccion', 'listo', 'entregado']; // plata cobrada
const PENDING = ['pendiente_pago'];
const STATUS_LABEL = { pendiente_pago: 'Pendiente de pago', pagado: 'Pagado', en_produccion: 'En producción', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
const EXPENSE_CATS = ['Materiales', 'Impresión / insumos', 'Envíos (Correo)', 'Publicidad', 'Alquiler / servicios', 'Sueldos', 'Otros'];

const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const digits = (t) => String(t || '').replace(/\D/g, '');
const clean = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const ymAR = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
const dayAR = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ymLabel = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4);

// ---------- contraseñas (scrypt con sal) ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return 's1$' + salt.toString('hex') + '$' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  try {
    const [v, saltHex, hashHex] = String(stored || '').split('$');
    if (v !== 's1') return false;
    const a = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64), b = Buffer.from(hashHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

// ---------- límite de intentos en memoria ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 20000) hits.clear();
  return arr.length > max;
}

// ---------- contactos (para promos): un registro por mail o teléfono ----------
const contactKey = (email, phone) => (email ? 'm:' + email : (digits(phone) ? 't:' + digits(phone) : ''));
function contactUpsert(data, { name, email, phone, marketing }) {
  email = normEmail(email);
  const key = contactKey(email, phone);
  if (!key) return null;
  data.contacts = data.contacts || {};
  data.optouts = data.optouts || [];
  const c = data.contacts[key] || { name: '', email: email || null, phone: null, marketing: false, marketing_at: null, created_at: new Date().toISOString() };
  if (name) c.name = clean(name, 80);
  if (email) c.email = email;
  if (digits(phone)) c.phone = clean(phone, 30);
  if (marketing === true) { c.marketing = true; c.marketing_at = new Date().toISOString(); data.optouts = data.optouts.filter((e) => e !== email); }
  if (marketing === false) { c.marketing = false; if (email && !data.optouts.includes(email)) data.optouts.push(email); }
  data.contacts[key] = c;
  return key;
}

let DB = null;
function sessionUserId(req) {
  const id = req.session && req.session.userId;
  if (!id || !DB) return null;
  return (DB.read().users || []).some((u) => u.id === id) ? id : null;
}

function mount(app, ctx) {
  DB = ctx.db;
  const { isAdminLogin, db, mailer, requireAdmin, UPLOAD_DIR, saveGalleryImage, galleryAddFromBuffer, sha1, cleanTitle } = ctx;
  const SECRET = process.env.SESSION_SECRET || 'dev-secret-cambiame';
  const publicUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const unsubToken = (email) => crypto.createHmac('sha256', SECRET).update('baja:' + normEmail(email)).digest('hex').slice(0, 32);

  // =====================================================================
  //  CUENTAS DE CLIENTES
  // =====================================================================
  const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', marketing: !!u.marketing, ship: u.ship || {}, created_at: u.created_at });
  const sessionUser = (req) => {
    const id = req.session && req.session.userId;
    if (!id) return null;
    return (db.read().users || []).find((u) => u.id === id) || null;
  };
  ctx.sessionUser = sessionUser;
  const login = (req, user) => new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 días
      resolve();
    });
  });
  const needUser = (req, res, next) => { const u = sessionUser(req); if (!u) return res.status(401).json({ error: 'Ingresá a tu cuenta.' }); req.user = u; next(); };

  app.post('/api/account/register', async (req, res) => {
    try {
      if (limited('reg:' + req.ip, 8, 3600 * 1000)) return res.status(429).json({ error: 'Demasiados registros desde acá. Probá más tarde.' });
      const name = clean(req.body.name, 80), email = normEmail(req.body.email), phone = clean(req.body.phone, 30), password = String(req.body.password || '');
      if (name.length < 2) return res.status(400).json({ error: 'Ingresá tu nombre.' });
      if (!validEmail(email)) return res.status(400).json({ error: 'Ingresá un email válido.' });
      if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
      let created = null;
      db.tx((d) => {
        d.users = d.users || []; d.nextUserId = d.nextUserId || 1;
        if (d.users.some((u) => u.email === email)) return;
        created = { id: d.nextUserId++, name, email, phone, pass: hashPw(password), marketing: req.body.marketing === true || req.body.marketing === '1', ship: {}, created_at: new Date().toISOString() };
        d.users.push(created);
        contactUpsert(d, { name, email, phone, marketing: created.marketing ? true : undefined });
      });
      if (!created) return res.status(409).json({ error: 'Ya hay una cuenta con ese email. Ingresá o recuperá tu contraseña.' });
      await login(req, created);
      res.json({ user: publicUser(created) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo crear la cuenta.' }); }
  });

  app.post('/api/account/login', async (req, res) => {
    try {
      const email = normEmail(req.body.email), password = String(req.body.password || '');
      if (limited('login:' + req.ip, 30, 10 * 60 * 1000) || limited('login:' + email, 8, 10 * 60 * 1000)) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
      // si es el mail/usuario del dueño con la clave de administrador, entra al panel
      if (isAdminLogin(req.body.email, password)) { req.session.isAdmin = true; return res.json({ admin: true }); }
      const u = (db.read().users || []).find((x) => x.email === email);
      if (!u || !checkPw(password, u.pass)) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
      await login(req, u);
      res.json({ user: publicUser(u) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo ingresar.' }); }
  });

  app.post('/api/account/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

  app.get('/api/account/me', (req, res) => { res.json({ user: publicUser(sessionUser(req)) }); });

  app.patch('/api/account/me', needUser, (req, res) => {
    const b = req.body || {};
    let out;
    db.tx((d) => {
      const u = d.users.find((x) => x.id === req.user.id);
      if (b.name !== undefined) { const n = clean(b.name, 80); if (n.length >= 2) u.name = n; }
      if (b.phone !== undefined) u.phone = clean(b.phone, 30);
      if (b.ship && typeof b.ship === 'object') {
        u.ship = { address: clean(b.ship.address, 120), province: clean(b.ship.province, 40), city: clean(b.ship.city, 60), postalCode: clean(b.ship.postalCode, 10) };
      }
      let mk;
      if (b.marketing !== undefined) { u.marketing = !!b.marketing; mk = u.marketing; }
      contactUpsert(d, { name: u.name, email: u.email, phone: u.phone, marketing: mk });
      out = publicUser(u);
    });
    res.json({ user: out });
  });

  app.post('/api/account/password', needUser, (req, res) => {
    if (limited('pw:' + req.user.id, 8, 3600 * 1000)) return res.status(429).json({ error: 'Demasiados intentos.' });
    const { current, next } = req.body || {};
    if (!checkPw(String(current || ''), req.user.pass)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    if (String(next || '').length < 8) return res.status(400).json({ error: 'La nueva contraseña tiene que tener al menos 8 caracteres.' });
    db.tx((d) => { d.users.find((x) => x.id === req.user.id).pass = hashPw(next); });
    res.json({ ok: true });
  });

  // Recuperar contraseña por mail (si el mail del sitio está configurado). Siempre responde igual para no revelar quién tiene cuenta.
  app.post('/api/account/forgot', async (req, res) => {
    const email = normEmail(req.body.email);
    const msg = mailer.enabled()
      ? 'Si ese email tiene cuenta, te mandamos un link para crear una contraseña nueva (revisá también spam).'
      : 'Por ahora no podemos mandar mails automáticos: escribinos por WhatsApp y te la reseteamos enseguida.';
    if (limited('forgot:' + req.ip, 6, 3600 * 1000)) return res.status(429).json({ error: 'Demasiados intentos. Probá más tarde.' });
    res.json({ ok: true, message: msg });
    if (!mailer.enabled() || !validEmail(email)) return;
    try {
      const token = crypto.randomBytes(32).toString('hex');
      let found = false;
      db.tx((d) => {
        const u = (d.users || []).find((x) => x.email === email);
        if (!u) return;
        found = true;
        u.reset = { hash: crypto.createHash('sha256').update(token).digest('hex'), exp: Date.now() + 3600 * 1000 };
      });
      if (!found) return;
      const link = `${publicUrl(req)}/cuenta.html#reset=${token}&e=${encodeURIComponent(email)}`;
      await mailer.sendMail({ to: email, subject: 'Crear una contraseña nueva — nalv.estudio', text: `Hola!\n\nPara crear una contraseña nueva entrá a este link (vale 1 hora):\n${link}\n\nSi no lo pediste vos, ignorá este mail.\n\nnalv.estudio` });
    } catch (e) { console.error('forgot:', e.message); }
  });

  app.post('/api/account/reset', async (req, res) => {
    try {
      const email = normEmail(req.body.email), token = String(req.body.token || ''), password = String(req.body.password || '');
      if (limited('reset:' + req.ip, 10, 3600 * 1000)) return res.status(429).json({ error: 'Demasiados intentos.' });
      if (password.length < 8) return res.status(400).json({ error: 'La contraseña tiene que tener al menos 8 caracteres.' });
      const h = crypto.createHash('sha256').update(token).digest('hex');
      let user = null;
      db.tx((d) => {
        const u = (d.users || []).find((x) => x.email === email);
        if (u && u.reset && u.reset.exp > Date.now() && u.reset.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(u.reset.hash), Buffer.from(h))) {
          u.pass = hashPw(password); u.reset = null; user = u;
        }
      });
      if (!user) return res.status(400).json({ error: 'El link venció o ya se usó. Pedí uno nuevo.' });
      await login(req, user);
      res.json({ user: publicUser(user) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo cambiar la contraseña.' }); }
  });

  // Borrar mi cuenta: se borran mis datos de cuenta y de contacto; los pedidos quedan sin vínculo (los necesitamos para la contabilidad).
  app.post('/api/account/delete', needUser, (req, res) => {
    if (!checkPw(String(req.body.password || ''), req.user.pass)) return res.status(400).json({ error: 'La contraseña no es correcta.' });
    db.tx((d) => {
      d.users = d.users.filter((u) => u.id !== req.user.id);
      (d.orders || []).forEach((o) => { if (o.user_id === req.user.id) { o.user_id = null; o.marketing = false; } });
      const k = contactKey(req.user.email, req.user.phone);
      if (d.contacts) { delete d.contacts[k]; delete d.contacts[contactKey(req.user.email, '')]; }
    });
    req.session.destroy(() => res.json({ ok: true }));
  });

  // Mis pedidos (con el detalle de cada plancha y diseño)
  const imgUrl = (f) => (f ? '/api/account/img/' + encodeURIComponent(path.basename(f)) : null);
  function orderPublic(o) {
    return {
      code: o.order_code, date: o.created_at, status: o.status, statusLabel: STATUS_LABEL[o.status] || o.status,
      total: o.total, shipping: o.shipping_cost || 0, delivery: o.delivery_method,
      singles: (o.items || []).map((i) => ({ label: i.label || 'Sticker', sizeCm: i.size_cm, qty: i.qty, thumb: imgUrl(i.image_thumb || i.image_path), file: imgUrl(i.image_orig) })),
      sheets: (o.sheets || []).map((s) => ({
        planchas: s.planchas || 1, price: s.price, widthCm: s.width_cm, lengthCm: s.length_cm,
        items: (s.items || []).map((i) => ({ label: i.label || 'Diseño', wCm: i.size_cm, hCm: i.h_cm, qty: i.qty, thumb: imgUrl(i.image_thumb || i.image_path), file: imgUrl(i.image_orig) })),
      })),
      packs: (o.packs || []).map((k) => ({ title: k.title, stickers: k.stickers, qty: k.qty, total: k.line_total, thumb: k.thumb })),
      shirts: (o.shirts || []).map((s) => ({ garment: s.garment_label, size: s.size, color: s.color_label, print: s.print_label, qty: s.qty, total: s.line_total, front: imgUrl(s.front_thumb || s.front_image), back: imgUrl(s.back_thumb || s.back_image) })),
    };
  }
  app.get('/api/account/orders', needUser, (req, res) => {
    res.json(db.getAllOrders().filter((o) => o.user_id === req.user.id).map(orderPublic));
  });
  app.get('/api/account/img/:file', needUser, (req, res) => {
    const name = path.basename(req.params.file);
    const mine = db.getAllOrders().filter((o) => o.user_id === req.user.id);
    const owned = new Set();
    const add = (v) => { if (v) owned.add(path.basename(v)); };
    mine.forEach((o) => {
      (o.items || []).forEach((i) => [i.image_path, i.image_orig, i.image_thumb].forEach(add));
      (o.sheets || []).forEach((s) => (s.items || []).forEach((i) => [i.image_path, i.image_orig, i.image_thumb].forEach(add)));
      (o.shirts || []).forEach((s) => [s.front_image, s.front_orig, s.front_thumb, s.back_image, s.back_orig, s.back_thumb].forEach(add));
    });
    if (!owned.has(name)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(UPLOAD_DIR, name), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // =====================================================================
  //  BAJA DE PROMOS (link en cada mail)
  // =====================================================================
  app.get('/baja', (req, res) => {
    const e = normEmail(req.query.e), t = String(req.query.t || '');
    const ok = validEmail(e) && t === unsubToken(e);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de novedades</title>
<body style="font-family:system-ui,sans-serif;background:#F5F4EF;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #ddd;border-radius:16px;padding:28px;max-width:420px;text-align:center">
${ok ? `<h2 style="margin-top:0">¿Dejar de recibir novedades?</h2><p>${esc(e)}</p><button id="b" style="background:#FF4D00;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-weight:700;cursor:pointer">Sí, darme de baja</button><p id="m"></p>
<script>b.onclick=async()=>{b.disabled=true;const r=await fetch('/api/baja',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({e:${JSON.stringify(e)},t:${JSON.stringify(t)}})});m.textContent=r.ok?'Listo, no te mandamos más promos.':'No se pudo, escribinos por WhatsApp.';}</script>` : '<h2>Link inválido</h2><p>Escribinos por WhatsApp y te damos de baja.</p>'}
</div></body>`);
  });
  app.post('/api/baja', (req, res) => {
    const e = normEmail(req.body.e), t = String(req.body.t || '');
    if (!validEmail(e) || t !== unsubToken(e)) return res.status(400).json({ error: 'Link inválido' });
    db.tx((d) => {
      contactUpsert(d, { email: e, marketing: false });
      (d.users || []).forEach((u) => { if (u.email === e) u.marketing = false; });
      (d.orders || []).forEach((o) => { if (normEmail(o.customer_email) === e) o.marketing = false; });
    });
    res.json({ ok: true });
  });

  // =====================================================================
  //  PANEL: MÉTRICAS Y GASTOS
  // =====================================================================
  const nowYm = () => ymAR(new Date().toISOString());
  function monthKeys(n) {
    const [y, m] = nowYm().split('-').map(Number);
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')); }
    return out;
  }
  app.get('/admin/api/metrics', requireAdmin, (req, res) => {
    const d = db.read();
    const orders = d.orders || [], expenses = d.expenses || [];
    const keys = monthKeys(12);
    const rows = Object.fromEntries(keys.map((k) => [k, { ym: k, label: ymLabel(k), orders: 0, paidOrders: 0, billed: 0, billedTransfer: 0, billedCash: 0, billedUndef: 0, shipping: 0, pending: 0, expenses: 0, profit: 0, planchas: 0, singles: 0, shirts: 0 }]));
    const total = { orders: 0, billed: 0, pending: 0, expenses: 0 };
    orders.forEach((o) => {
      if (o.status === 'cancelado') return;
      const r = rows[ymAR(o.created_at)];
      total.orders++;
      if (PAID.includes(o.status)) { total.billed += o.total; if (r) { r.billed += o.total; r.shipping += o.shipping_cost || 0; r.paidOrders++; if (o.payment_method === 'transferencia') r.billedTransfer += o.total; else if (o.payment_method === 'efectivo') r.billedCash += o.total; else r.billedUndef += o.total; } }
      if (PENDING.includes(o.status)) { total.pending += o.total; if (r) r.pending += o.total; }
      if (r) {
        r.orders++;
        r.planchas += (o.sheets || []).reduce((a, s) => a + (s.planchas || 1), 0) + (o.packs || []).reduce((a, k) => a + k.qty, 0);
        r.singles += (o.items || []).reduce((a, i) => a + i.qty, 0);
        r.shirts += (o.shirts || []).reduce((a, s) => a + s.qty, 0);
      }
    });
    expenses.forEach((e) => { total.expenses += e.amount; const r = rows[String(e.date).slice(0, 7)]; if (r) r.expenses += e.amount; });
    const months = keys.map((k) => { const r = rows[k]; r.profit = r.billed - r.expenses; return r; });
    const cur = months[months.length - 1];
    const byStatus = {};
    orders.forEach((o) => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
    const cust = buildCustomers(d);
    const expByCat = {};
    expenses.filter((e) => String(e.date).slice(0, 7) === cur.ym).forEach((e) => { expByCat[e.category] = (expByCat[e.category] || 0) + e.amount; });
    res.json({
      current: { ...cur, avgTicket: cur.paidOrders ? Math.round(cur.billed / cur.paidOrders) : 0 },
      total, months, byStatus, statusLabel: STATUS_LABEL, expByCat,
      customers: { total: cust.length, optIn: cust.filter((c) => c.marketing).length, withAccount: (d.users || []).length },
    });
  });

  app.get('/admin/api/expenses', requireAdmin, (req, res) => {
    const m = String(req.query.month || '');
    let list = (db.read().expenses || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
    if (/^\d{4}-\d{2}$/.test(m)) list = list.filter((e) => String(e.date).slice(0, 7) === m);
    res.json({ list, categories: EXPENSE_CATS });
  });
  app.post('/admin/api/expenses', requireAdmin, (req, res) => {
    const date = String(req.body.date || '').slice(0, 10), concept = clean(req.body.concept, 100), amount = Math.round(Number(req.body.amount));
    const category = EXPENSE_CATS.includes(req.body.category) ? req.body.category : 'Otros';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return res.status(400).json({ error: 'Fecha inválida.' });
    if (!concept) return res.status(400).json({ error: 'Escribí en qué fue el gasto.' });
    if (!(amount > 0) || amount > 1e9) return res.status(400).json({ error: 'Monto inválido.' });
    let row;
    db.tx((d) => { d.expenses = d.expenses || []; d.nextExpenseId = d.nextExpenseId || 1; row = { id: d.nextExpenseId++, date, concept, category, amount, created_at: new Date().toISOString() }; d.expenses.push(row); });
    res.json(row);
  });
  app.delete('/admin/api/expenses/:id', requireAdmin, (req, res) => {
    let ok = false;
    db.tx((d) => { const n = (d.expenses || []).length; d.expenses = (d.expenses || []).filter((e) => e.id !== Number(req.params.id)); ok = d.expenses.length < n; });
    res.status(ok ? 200 : 404).json({ ok });
  });

  // ---------- forma de cobro (transferencia / efectivo) ----------
  const PAY_LABEL = { transferencia: 'Transferencia', efectivo: 'Efectivo' };
  app.post('/admin/api/orders/:id/payment', requireAdmin, (req, res) => {
    const m = String(req.body.method || '');
    if (m && !PAY_LABEL[m]) return res.status(400).json({ error: 'Forma de cobro inválida.' });
    let ok = false;
    db.tx((d) => { const o = (d.orders || []).find((x) => x.id === Number(req.params.id)); if (o) { o.payment_method = m || null; ok = true; } });
    res.status(ok ? 200 : 404).json({ ok });
  });

  // ---------- Excel: resumen mensual, pedidos y gastos ----------
  app.get('/admin/api/excel', requireAdmin, async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const d = db.read();
      const orders = (d.orders || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const expenses = (d.expenses || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);
      const DELIV = { retiro: 'Retiro en local', correo_domicilio: 'Correo a domicilio', correo_sucursal: 'Correo a sucursal' };
      const ymNum = (ym) => Number(String(ym).replace('-', '')), YMFMT = '0000"-"00';
      const wb = new ExcelJS.Workbook();
      wb.creator = 'nalv.estudio'; wb.created = new Date();
      const ARS = '"$" #,##0;[Red]-"$" #,##0';
      const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4D00' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true } };
      const styleHead = (ws) => { const r = ws.getRow(1); r.height = 30; r.eachCell((c) => Object.assign(c, HEAD)); ws.views = [{ state: 'frozen', ySplit: 1 }]; };

      const ws = wb.addWorksheet('Resumen mensual');
      // --- Pedidos ---
      const wp = wb.addWorksheet('Pedidos');
      wp.columns = [
        { header: 'Pedido', key: 'code', width: 12 }, { header: 'Mes', key: 'ym', width: 9 }, { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Cliente', key: 'name', width: 26 }, { header: 'Teléfono', key: 'phone', width: 16 }, { header: 'Email', key: 'email', width: 28 },
        { header: 'Entrega', key: 'deliv', width: 20 }, { header: 'Estado', key: 'status', width: 18 }, { header: 'Forma de cobro', key: 'pay', width: 16 },
        { header: 'Productos', key: 'prod', width: 14 }, { header: 'Envío', key: 'ship', width: 12 }, { header: 'Descuento', key: 'disc', width: 12 },
        { header: 'Total', key: 'total', width: 14 }, { header: 'Cobrado', key: 'paid', width: 14 },
      ];
      orders.forEach((o) => {
        const isPaid = PAID.includes(o.status);
        const r = wp.addRow({
          code: o.order_code, ym: ymNum(ymAR(o.created_at)), date: new Date(dayAR(o.created_at) + 'T12:00:00Z'), name: o.customer_name, phone: o.customer_phone, email: o.customer_email || '',
          deliv: DELIV[o.delivery_method] || o.delivery_method || '', status: STATUS_LABEL[o.status] || o.status,
          pay: isPaid || o.payment_method ? (PAY_LABEL[o.payment_method] || 'Sin definir') : '',
          prod: (o.total || 0) - (o.shipping_cost || 0), ship: o.shipping_cost || 0, disc: o.discount || 0, total: o.total || 0, paid: isPaid ? (o.total || 0) : 0,
        });
        r.getCell('date').numFmt = 'dd/mm/yyyy';
        ['prod', 'ship', 'disc', 'total', 'paid'].forEach((k) => { r.getCell(k).numFmt = ARS; });
      });
      wp.getColumn('ym').numFmt = YMFMT; wp.getColumn('ym').alignment = { horizontal: 'center' };
      styleHead(wp);
      wp.autoFilter = { from: 'A1', to: 'N1' };

      // --- Gastos ---
      const wg = wb.addWorksheet('Gastos');
      wg.columns = [{ header: 'Mes', key: 'ym', width: 9 }, { header: 'Fecha', key: 'date', width: 12 }, { header: 'Concepto', key: 'concept', width: 38 }, { header: 'Categoría', key: 'cat', width: 24 }, { header: 'Monto', key: 'amount', width: 14 }];
      expenses.forEach((e) => {
        const r = wg.addRow({ ym: ymNum(String(e.date).slice(0, 7)), date: new Date(e.date + 'T12:00:00Z'), concept: e.concept, cat: e.category, amount: e.amount });
        r.getCell('date').numFmt = 'dd/mm/yyyy'; r.getCell('amount').numFmt = ARS;
      });
      wg.getColumn('ym').numFmt = YMFMT; wg.getColumn('ym').alignment = { horizontal: 'center' };
      styleHead(wg);
      wg.autoFilter = { from: 'A1', to: 'E1' };

      // --- Resumen mensual (con fórmulas que leen las otras hojas) ---
      
      const yms = new Set([ymAR(new Date().toISOString())]);
      orders.forEach((o) => yms.add(ymAR(o.created_at))); expenses.forEach((e) => yms.add(String(e.date).slice(0, 7)));
      const months = [...yms].sort();
      ws.columns = [
        { header: 'Mes', width: 11 }, { header: 'Pedidos', width: 10 }, { header: 'Cobrado por transferencia', width: 16 }, { header: 'Cobrado en efectivo', width: 16 },
        { header: 'Cobrado (sin forma definida)', width: 16 }, { header: 'Total facturado', width: 16 }, { header: 'Gastos', width: 14 }, { header: 'Ganancia', width: 16 }, { header: 'Pendiente de cobro', width: 16 },
      ];
      const nP = orders.length + 1, nG = expenses.length + 1;
      const rngP = (col) => `Pedidos!$${col}$2:$${col}$${Math.max(nP, 2)}`;
      const calc = Object.fromEntries(months.map((m) => [m, { n: 0, t: 0, c: 0, u: 0, g: 0, pend: 0 }]));
      orders.forEach((o) => { if (o.status === 'cancelado') return; const c = calc[ymAR(o.created_at)]; c.n++; if (PAID.includes(o.status)) { if (o.payment_method === 'transferencia') c.t += o.total; else if (o.payment_method === 'efectivo') c.c += o.total; else c.u += o.total; } if (PENDING.includes(o.status)) c.pend += o.total; });
      expenses.forEach((e) => { calc[String(e.date).slice(0, 7)].g += e.amount; });
      months.forEach((m, i) => {
        const row = i + 2, c = calc[m];
        const r = ws.getRow(row);
        r.getCell(1).value = ymNum(m); r.getCell(1).numFmt = YMFMT;
        r.getCell(2).value = { formula: `COUNTIFS(${rngP('B')},A${row},${rngP('H')},"<>Cancelado")`, result: c.n };
        r.getCell(3).value = { formula: `SUMIFS(${rngP('N')},${rngP('B')},A${row},${rngP('I')},"Transferencia")`, result: c.t };
        r.getCell(4).value = { formula: `SUMIFS(${rngP('N')},${rngP('B')},A${row},${rngP('I')},"Efectivo")`, result: c.c };
        r.getCell(5).value = { formula: `SUMIFS(${rngP('N')},${rngP('B')},A${row},${rngP('I')},"Sin definir")`, result: c.u };
        r.getCell(6).value = { formula: `C${row}+D${row}+E${row}`, result: c.t + c.c + c.u };
        r.getCell(7).value = { formula: `SUMIFS(Gastos!$E$2:$E$${Math.max(nG, 2)},Gastos!$A$2:$A$${Math.max(nG, 2)},A${row})`, result: c.g };
        r.getCell(8).value = { formula: `F${row}-G${row}`, result: c.t + c.c + c.u - c.g };
        r.getCell(9).value = { formula: `SUMIFS(${rngP('M')},${rngP('B')},A${row},${rngP('H')},"Pendiente de pago")`, result: c.pend };
        for (let k = 3; k <= 9; k++) r.getCell(k).numFmt = ARS;
      });
      const last = months.length + 1, tr = last + 1;
      const tot = ws.getRow(tr);
      tot.getCell(1).value = 'TOTAL';
      const sum = (col, key) => ({ formula: `SUM(${col}2:${col}${last})`, result: months.reduce((a, m) => a + (key === 'n' ? calc[m].n : key === 'f' ? calc[m].t + calc[m].c + calc[m].u : key === 'p' ? calc[m].t + calc[m].c + calc[m].u - calc[m].g : calc[m][key]), 0) });
      [['B', 'n'], ['C', 't'], ['D', 'c'], ['E', 'u'], ['F', 'f'], ['G', 'g'], ['H', 'p'], ['I', 'pend']].forEach(([col, key], i) => { const cell = tot.getCell(i + 2); cell.value = sum(col, key); if (i > 0) cell.numFmt = ARS; });
      tot.font = { bold: true }; tot.eachCell((c) => { c.border = { top: { style: 'medium' } }; });
      styleHead(ws);
      ws.getCell(`A${tr + 2}`).value = 'Facturado = pedidos con pago confirmado (pagado, en producción, listo o entregado), envío incluido. Los pedidos cancelados no cuentan. La forma de cobro se marca en cada pedido del panel.';
      ws.getCell(`A${tr + 2}`).font = { italic: true, color: { argb: 'FF666666' } };

      const ymNow = ymAR(new Date().toISOString());
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="nalv-control-${ymNow}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { console.error('[excel]', e); if (!res.headersSent) res.status(500).json({ error: 'No pude generar el Excel.' }); }
  });

  // =====================================================================
  //  PANEL: CLIENTES Y PROMOS
  // =====================================================================
  function waNumber(phone) {
    let p = digits(phone).replace(/^00/, '');
    if (!p) return '';
    if (p.startsWith('549')) return p;
    if (p.startsWith('54')) return '549' + p.slice(2).replace(/^9/, '');
    p = p.replace(/^0/, '');
    if (p.length === 12) p = p.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2'); // 0221 15 5730729 → quita el 15
    return p.length === 10 ? '549' + p : '';
  }
  function buildCustomers(d) {
    const map = new Map();
    const optouts = new Set(d.optouts || []);
    const get = (email, phone, name) => {
      const k = contactKey(normEmail(email), phone);
      if (!k) return null;
      if (!map.has(k)) map.set(k, { key: k, name: name || '', email: normEmail(email) || null, phone: phone || '', orders: 0, spent: 0, pending: 0, last: null, first: null, marketing: false, account: false });
      return map.get(k);
    };
    (d.orders || []).slice().reverse().forEach((o) => { // del más viejo al más nuevo: gana el dato más reciente
      const c = get(o.customer_email, o.customer_phone, o.customer_name);
      if (!c) return;
      c.name = o.customer_name || c.name; c.phone = o.customer_phone || c.phone; if (o.customer_email) c.email = normEmail(o.customer_email);
      if (o.status !== 'cancelado') { c.orders++; if (PAID.includes(o.status)) c.spent += o.total; if (PENDING.includes(o.status)) c.pending += o.total; }
      c.last = o.created_at; c.first = c.first || o.created_at;
    });
    (d.users || []).forEach((u) => { const c = get(u.email, u.phone, u.name); if (c) { c.account = true; c.name = c.name || u.name; c.first = c.first || u.created_at; } });
    Object.entries(d.contacts || {}).forEach(([k, ct]) => {
      let c = map.get(k);
      if (!c) { c = get(ct.email, ct.phone, ct.name); }
      if (c) { c.marketing = !!ct.marketing; c.consentAt = ct.marketing_at || null; if (!c.name) c.name = ct.name; }
    });
    const out = [...map.values()];
    out.forEach((c) => { if (c.email && optouts.has(c.email)) c.marketing = false; c.wa = waNumber(c.phone); });
    return out.sort((a, b) => String(b.last || b.first || '').localeCompare(String(a.last || a.first || '')));
  }
  app.get('/admin/api/customers', requireAdmin, (req, res) => {
    const list = buildCustomers(db.read());
    res.json({ list, mailEnabled: mailer.enabled(), mailUser: (mailer.getConfig() || {}).user || '', mailSource: (mailer.getConfig() || {}).source || null, store: process.env.STORE_NAME || 'nalv.estudio' });
  });
  app.get('/admin/api/customers.csv', requireAdmin, (req, res) => {
    let list = buildCustomers(db.read());
    if (req.query.consent === '1') list = list.filter((c) => c.marketing);
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    const rows = [['Nombre', 'Email', 'Teléfono', 'Pedidos', 'Gastó (cobrado)', 'Último pedido', 'Acepta promos', 'Tiene cuenta'].map(q).join(',')];
    list.forEach((c) => rows.push([c.name, c.email, c.phone, c.orders, c.spent, c.last ? dayAR(c.last) : '', c.marketing ? 'Sí' : 'No', c.account ? 'Sí' : 'No'].map(q).join(',')));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="clientes-nalv.csv"' });
    res.send('﻿' + rows.join('\r\n'));
  });

  // Reset de contraseña a pedido del cliente (si el mail automático no está configurado): devuelve una clave temporal.
  app.post('/admin/api/users/reset-password', requireAdmin, (req, res) => {
    const email = normEmail(req.body.email);
    const temp = crypto.randomBytes(6).toString('base64url');
    let found = false;
    db.tx((d) => { const u = (d.users || []).find((x) => x.email === email); if (u) { u.pass = hashPw(temp); found = true; } });
    if (!found) return res.status(404).json({ error: 'No hay una cuenta con ese email.' });
    res.json({ temp });
  });

  // ----- Configurar el mail desde el panel (sin tocar archivos) -----
  const PRESETS = { gmail: { host: 'smtp.gmail.com', port: 465, secure: true }, outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false }, yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } };
  app.get('/admin/api/mail-config', requireAdmin, (req, res) => {
    const c = mailer.getConfig();
    res.json({ enabled: !!c, user: c ? c.user : '', host: c ? c.host : '', source: c ? c.source : null });
  });
  app.post('/admin/api/mail-config', requireAdmin, async (req, res) => {
    if (limited('mailcfg:' + req.ip, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
    const user = clean(req.body.user, 120), pass = String(req.body.pass || '').replace(/\s+/g, ''), provider = String(req.body.provider || 'gmail');
    if (!validEmail(normEmail(user))) return res.status(400).json({ error: 'Escribí tu dirección de mail completa (ej: tunombre@gmail.com).' });
    if (pass.length < 6 || pass.length > 100) return res.status(400).json({ error: 'Pegá la contraseña de aplicación (no tu contraseña normal).' });
    const base = provider === 'custom'
      ? { host: clean(req.body.host, 120), port: Number(req.body.port) || 465, secure: (Number(req.body.port) || 465) === 465 }
      : (PRESETS[provider] || PRESETS.gmail);
    if (!base.host) return res.status(400).json({ error: 'Completá el servidor SMTP.' });
    const cfg = { user: normEmail(user), pass, ...base };
    try { await mailer.verify(cfg); }
    catch (e) {
      const m = String(e.message || e);
      const hint = /535|Invalid login|Username and Password|BadCredentials|AUTH/i.test(m) ? 'Google/tu proveedor rechazó el usuario o la contraseña. Con Gmail tenés que usar una “contraseña de aplicación” (requiere la verificación en 2 pasos), no la contraseña normal.'
        : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m) ? 'No se pudo conectar con el servidor de mail. Revisá el proveedor y tu conexión.' : 'No se pudo verificar: ' + m.slice(0, 160);
      return res.status(400).json({ error: hint });
    }
    mailer.saveConfig(cfg);
    res.json({ ok: true, user: cfg.user });
  });
  app.delete('/admin/api/mail-config', requireAdmin, (req, res) => { mailer.clearConfig(); res.json({ ok: true }); });

  // ----- Promos por mail: solo a quienes aceptaron recibirlas; con link de baja en cada mail -----
  let job = { running: false, total: 0, sent: 0, failed: 0, subject: '', error: '' };
  const toHtml = (text) => String(text).split(/\n{2,}/).map((p) => '<p style="margin:0 0 14px">' + p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</p>').join('');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  app.get('/admin/api/promos/status', requireAdmin, (req, res) => res.json({ ...job, campaigns: (db.read().campaigns || []).slice(-10).reverse() }));
  app.post('/admin/api/promos/mail', requireAdmin, async (req, res) => {
    if (!mailer.enabled()) return res.status(400).json({ error: 'Primero conectá tu mail en “Configurar el envío de mails” (más arriba). Mientras tanto podés usar WhatsApp.' });
    if (job.running) return res.status(409).json({ error: 'Ya hay un envío en curso.' });
    const subject = clean(req.body.subject, 150), body = String(req.body.body || '').slice(0, 5000).trim();
    if (!subject || body.length < 5) return res.status(400).json({ error: 'Completá asunto y mensaje.' });
    const base = publicUrl(req);
    const mailFor = (email, name) => {
      const first = clean(name, 40).split(' ')[0] || '';
      const link = `${base}/baja?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
      const text = body.replace(/\{nombre\}/gi, first || 'hola') + `\n\n—\nRecibís este mail porque aceptaste recibir novedades de ${process.env.STORE_NAME || 'nalv.estudio'}. Si no querés recibir más: ${link}`;
      return { to: email, subject, text, html: toHtml(body.replace(/\{nombre\}/gi, first || 'hola')) + `<hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:12px;color:#777">Recibís este mail porque aceptaste recibir novedades de ${process.env.STORE_NAME || 'nalv.estudio'}. <a href="${link}">Darme de baja</a></p>`, headers: { 'List-Unsubscribe': `<${link}>` } };
    };
    if (req.body.test) { // prueba: solo a vos
      const me = mailer.ownerEmail();
      try { await mailer.sendMail(mailFor(me, 'Nahuel')); return res.json({ ok: true, test: true, to: me }); }
      catch (e) { return res.status(500).json({ error: 'No se pudo enviar la prueba: ' + e.message }); }
    }
    const targets = buildCustomers(db.read()).filter((c) => c.marketing && c.email);
    if (!targets.length) return res.status(400).json({ error: 'Todavía no hay clientes con mail que hayan aceptado recibir promos.' });
    job = { running: true, total: targets.length, sent: 0, failed: 0, subject, error: '' };
    res.json({ ok: true, total: targets.length });
    (async () => {
      for (const c of targets) {
        try { await mailer.sendMail(mailFor(c.email, c.name)); job.sent++; } catch (e) { job.failed++; job.error = e.message.slice(0, 200); }
        await sleep(700); // sin apuro: así Gmail no lo toma como spam masivo
      }
      job.running = false;
      db.tx((d) => { d.campaigns = d.campaigns || []; d.campaigns.push({ date: new Date().toISOString(), subject, total: job.total, sent: job.sent, failed: job.failed }); });
    })();
  });


  // =====================================================================
  //  COPIAS DE SEGURIDAD (descargar / restaurar) y estado del almacenamiento
  // =====================================================================
  const DB_FILE = path.join(DATA_DIR, 'shop.json');
  const BK_DIR = path.join(DATA_DIR, 'backups');
  const SKIP_DATA = new Set(['sessions.json', 'mail-config.json', 'shop.json.tmp']); // las sesiones y la clave del mail no se copian
  function dirStats(dir, skip) {
    let files = 0, bytes = 0;
    const walk = (d) => { let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of list) { if (skip && skip.has(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { bytes += fs.statSync(f).size; files++; } catch (x) { /* nada */ } } } };
    walk(dir);
    return { files, bytes };
  }
  function snapshotDb() { // copia diaria de shop.json (protege de errores, no de perder el disco entero)
    try {
      if (!fs.existsSync(DB_FILE)) return;
      fs.mkdirSync(BK_DIR, { recursive: true });
      fs.copyFileSync(DB_FILE, path.join(BK_DIR, 'shop-' + dayAR(new Date().toISOString()) + '.json'));
      const old = fs.readdirSync(BK_DIR).filter((f) => /^shop-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(30);
      old.forEach((f) => { try { fs.unlinkSync(path.join(BK_DIR, f)); } catch (e) { /* nada */ } });
    } catch (e) { console.error('copia diaria:', e.message); }
  }
  setTimeout(snapshotDb, 5000).unref();
  setInterval(snapshotDb, 6 * 3600 * 1000).unref();

  app.get('/admin/api/storage', requireAdmin, (req, res) => {
    const d = db.read();
    const up = dirStats(UPLOAD_ROOT, new Set(['_tmp'])), gal = dirStats(path.join(DATA_DIR, 'galeria'));
    let lastAuto = null;
    try { lastAuto = fs.readdirSync(BK_DIR).filter((f) => /^shop-/.test(f)).sort().pop() || null; } catch (e) { /* sin copias todavía */ }
    res.json({ dataDir: DATA_DIR, uploadDir: UPLOAD_ROOT, custom: CUSTOM_DATA, orders: (d.orders || []).length, stickers: (d.gallery || []).length, pending: (d.pending || []).length, customers: Object.keys(d.contacts || {}).length, users: (d.users || []).length, expenses: (d.expenses || []).length, uploadsMB: Math.round(up.bytes / 1048576), galleryMB: Math.round(gal.bytes / 1048576), lastAuto });
  });

  app.get('/admin/api/backup.zip', requireAdmin, (req, res) => {
    const name = 'nalv-copia-' + dayAR(new Date().toISOString()) + '.zip';
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
    const ar = archiver('zip', { zlib: { level: 1 } });
    ar.on('error', (e) => { console.error('backup:', e.message); try { res.destroy(); } catch (x) { /* nada */ } });
    ar.pipe(res);
    ar.append(JSON.stringify({ app: 'nalv-estudio', created: new Date().toISOString(), version: 1 }), { name: 'copia-info.json' });
    try { if (fs.existsSync(DB_FILE)) ar.append(fs.readFileSync(DB_FILE), { name: 'data/shop.json' }); } catch (e) { /* nada */ }
    ['galeria', 'galeria-pendientes', 'planchas', 'planchas-archivos'].forEach((d) => { const dir = path.join(DATA_DIR, d); if (fs.existsSync(dir)) ar.directory(dir, 'data/' + d); });
    if (fs.existsSync(UPLOAD_ROOT)) ar.directory(UPLOAD_ROOT, 'uploads', (e) => (/(^|[\\/])_tmp([\\/]|$)/.test(e.name) ? false : e));
    ar.finalize();
  });

  const uploadZipBk = multer({ dest: os.tmpdir(), limits: { fileSize: 600 * 1024 * 1024, files: 1 } });
  app.post('/admin/api/restore', requireAdmin, uploadZipBk.single('zip'), (req, res) => {
    const tmp = req.file && req.file.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'Elegí el archivo .zip de la copia de seguridad.' });
      let zip; try { zip = new AdmZip(tmp); } catch (e) { return res.status(400).json({ error: 'No se pudo abrir el .zip (¿está dañado?).' }); }
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      if (!entries.some((e) => e.entryName === 'copia-info.json') || entries.length > 50000) return res.status(400).json({ error: 'Ese .zip no es una copia de seguridad de este sitio (descargala desde la pestaña “Copia de seguridad” del panel).' });
      const dbEntry = entries.find((e) => e.entryName === 'data/shop.json');
      if (dbEntry) { try { const j = JSON.parse(dbEntry.getData().toString('utf8')); if (!j || !Array.isArray(j.orders)) throw new Error('x'); } catch (e) { return res.status(400).json({ error: 'La copia tiene el archivo de datos dañado.' }); } }
      // respaldo del estado actual antes de pisar nada
      try { if (fs.existsSync(DB_FILE)) { fs.mkdirSync(BK_DIR, { recursive: true }); fs.copyFileSync(DB_FILE, path.join(BK_DIR, 'antes-de-restaurar-' + Date.now() + '.json')); } } catch (e) { /* nada */ }
      let n = 0, bytes = 0, skipped = 0;
      for (const e of entries) {
        const m = e.entryName.replace(/\\/g, '/').match(/^(data|uploads)\/(.+)$/);
        if (!m) continue;
        const rel = m[2];
        if (rel.split('/').some((p) => p === '..' || p === '' ) || path.isAbsolute(rel) || (m[1] === 'data' && (SKIP_DATA.has(rel) || rel.startsWith('backups/'))) || rel.startsWith('_tmp/')) { skipped++; continue; }
        if (e.header.size > 200 * 1024 * 1024 || (bytes += e.header.size) > 5 * 1024 * 1024 * 1024) { skipped++; continue; }
        const base = m[1] === 'data' ? DATA_DIR : UPLOAD_ROOT;
        const target = path.resolve(base, rel);
        if (!target.startsWith(path.resolve(base) + path.sep)) { skipped++; continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const buf = e.getData();
        if (m[1] === 'data' && rel === 'shop.json') { fs.writeFileSync(target + '.tmp', buf); require('./fsafe').renameRetry(target + '.tmp', target); } else fs.writeFileSync(target, buf);
        n++;
      }
      res.json({ ok: true, restored: n, skipped });
    } catch (e) { console.error('restore:', e); res.status(500).json({ error: 'No se pudo restaurar la copia.' }); }
    finally { if (tmp) fs.unlink(tmp, () => {}); }
  });

  // =====================================================================
  //  STICKERS SUGERIDOS POR LA GENTE → cola de aprobación (no se publica nada solo)
  // =====================================================================
  const PEND_DIR = path.join(require('./paths').DATA_DIR, 'galeria-pendientes');
  fs.mkdirSync(PEND_DIR, { recursive: true });
  const uploadSug = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.post('/api/galeria/sugerir', (req, res, next) => {
    if (limited('sug:' + req.ip, 60, 3600 * 1000)) return res.status(429).json({ error: 'Subiste varios hace poco. Probá más tarde.' });
    next();
  }, uploadSug.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Elegí una imagen PNG, JPG o WEBP.' });
      if (req.body.consent !== '1') return res.status(400).json({ error: 'Tenés que aceptar que se publique para que otras personas lo descarguen.' });
      const meta = await sharp(req.file.buffer, { failOn: 'none' }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) return res.status(400).json({ error: 'Formato no soportado. Subí PNG, JPG o WEBP.' });
      if ((meta.width || 0) < 200 || (meta.height || 0) < 200) return res.status(400).json({ error: 'La imagen es muy chica (mínimo 200 × 200 px).' });
      const h = sha1(req.file.buffer);
      const d0 = db.read();
      if ((d0.gallery || []).some((g) => g.hash === h) || (d0.pending || []).some((p) => p.hash === h)) return res.json({ ok: true, duplicate: true });
      const file = 'p_' + crypto.randomBytes(8).toString('hex') + '.png';
      await sharp(req.file.buffer, { failOn: 'none' }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toFile(path.join(PEND_DIR, file));
      const u = sessionUser(req);
      db.tx((d) => {
        d.pending = d.pending || []; d.nextPendingId = d.nextPendingId || 1;
        d.pending.unshift({ id: d.nextPendingId++, title: cleanTitle(req.body.title), file, hash: h, user_id: u ? u.id : null, by: clean(req.body.by, 60) || (u ? u.name : ''), created_at: new Date().toISOString() });
      });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar el sticker.' }); }
  });

  const pendPublic = (p) => ({ id: p.id, title: p.title, by: p.by, created_at: p.created_at, url: '/admin/api/pendientes/img/' + p.file });
  app.get('/admin/api/pendientes', requireAdmin, (req, res) => res.json((db.read().pending || []).map(pendPublic)));
  app.get('/admin/api/pendientes/img/:file', requireAdmin, (req, res) => res.sendFile(path.join(PEND_DIR, path.basename(req.params.file)), (e) => { if (e && !res.headersSent) res.status(404).end(); }));
  async function approve(p, title) {
    const buf = fs.readFileSync(path.join(PEND_DIR, p.file));
    await galleryAddFromBuffer(buf, cleanTitle(title || p.title), 'comunidad');
    try { fs.unlinkSync(path.join(PEND_DIR, p.file)); } catch (e) { /* ya no estaba */ }
  }
  app.post('/admin/api/pendientes/:id/aprobar', requireAdmin, async (req, res) => {
    try {
      const p = (db.read().pending || []).find((x) => x.id === Number(req.params.id));
      if (!p) return res.status(404).json({ error: 'No encontrado' });
      await approve(p, req.body && req.body.title);
      db.tx((d) => { d.pending = d.pending.filter((x) => x.id !== p.id); });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo aprobar.' }); }
  });
  app.post('/admin/api/pendientes/aprobar-todos', requireAdmin, async (req, res) => {
    let n = 0;
    try {
      for (const p of (db.read().pending || []).slice().reverse()) { await approve(p); db.tx((d) => { d.pending = d.pending.filter((x) => x.id !== p.id); }); n++; }
      res.json({ ok: true, approved: n });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Se aprobaron ' + n + ' y después hubo un error.' }); }
  });
  app.delete('/admin/api/pendientes/:id', requireAdmin, (req, res) => {
    let row = null;
    db.tx((d) => { row = (d.pending || []).find((x) => x.id === Number(req.params.id)); d.pending = (d.pending || []).filter((x) => x.id !== Number(req.params.id)); });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try { fs.unlinkSync(path.join(PEND_DIR, row.file)); } catch (e) { /* ya no estaba */ }
    res.json({ ok: true });
  });
}

// Se llama al crear un pedido: guarda/actualiza el contacto (con el permiso de promos solo si lo tildó).
function afterOrder(db, order) {
  db.tx((d) => contactUpsert(d, { name: order.customer_name, email: order.customer_email, phone: order.customer_phone, marketing: order.marketing ? true : undefined }));
}

module.exports = { mount, afterOrder, sessionUserId, hashPw, checkPw };
