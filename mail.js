// mail.js — aviso por mail de cada pedido nuevo (queda como registro en tu casilla).
// Necesita una cuenta que envíe: con Gmail, activá la verificación en 2 pasos y creá una
// "contraseña de aplicación" (https://myaccount.google.com/apppasswords). Ver README.
const path = require('path');
const nodemailer = require('nodemailer');

const fs = require('fs');
const crypto = require('crypto');

const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
const CFG_FILE = path.join(require('./paths').DATA_DIR, 'mail-config.json');
let transporter = null, transporterKey = '';

// ---------- Configuración: la que cargás desde el panel (data/mail-config.json) o, si no hay, la del .env ----------
// La contraseña de aplicación se guarda cifrada (AES-256-GCM con una clave derivada de SESSION_SECRET).
const secretKey = () => crypto.scryptSync(process.env.SESSION_SECRET || 'dev-secret-cambiame', 'nalv-mail', 32);
function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  try {
    const [iv, tag, enc] = String(blob).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}
function readPanelCfg() {
  try { const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8')); const pass = decrypt(j.pass); return j.user && pass ? { user: j.user, pass, host: j.host, port: j.port, secure: j.secure, source: 'panel' } : null; }
  catch (e) { return null; }
}
function getConfig() {
  const p = readPanelCfg();
  if (p) return p;
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT) || 465, secure: (process.env.SMTP_SECURE || 'true') !== 'false', source: 'env' };
  }
  return null;
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  fs.writeFileSync(CFG_FILE + '.tmp', JSON.stringify({ user: cfg.user, pass: encrypt(cfg.pass), host: cfg.host, port: cfg.port, secure: cfg.secure }), { mode: 0o600 });
  require('./fsafe').renameRetry(CFG_FILE + '.tmp', CFG_FILE);
  transporter = null;
}
function clearConfig() { try { fs.unlinkSync(CFG_FILE); } catch (e) { /* no había */ } transporter = null; }

function enabled() { return !!getConfig(); }
const ownerEmail = () => process.env.ORDER_EMAIL || (getConfig() || {}).user || '';

function makeTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host || 'smtp.gmail.com', port: Number(cfg.port) || 465, secure: cfg.secure !== false && cfg.secure !== 'false',
    auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000,
    tls: { rejectUnauthorized: !(cfg.host === 'localhost' || cfg.host === '127.0.0.1') },
  });
}
function getTransporter() {
  const cfg = getConfig();
  if (!cfg) throw new Error('El mail no está configurado');
  const key = [cfg.source, cfg.user, cfg.host, cfg.port, cfg.secure].join('|');
  if (!transporter || transporterKey !== key) { transporter = makeTransport(cfg); transporterKey = key; }
  return transporter;
}
// Comprueba usuario y contraseña contra el servidor de mail (sin enviar nada)
async function verify(cfg) { await makeTransport(cfg).verify(); return true; }

// order: { code, name, phone, email, delivery, address, notes, total, lines:[string], imagePaths:[string] }
async function sendOrderMail(order, uploadDir) {
  if (!enabled()) {
    console.log('✉️  Aviso por mail desactivado (faltan SMTP_USER / SMTP_PASS en .env). El pedido igual queda guardado en el panel.');
    return false;
  }
  const to = ownerEmail();
  const text = [
    `Nuevo pedido ${order.code} — ${money(order.total)}`,
    '',
    `Cliente: ${order.name}`,
    `Teléfono / WhatsApp: ${order.phone}`,
    order.email ? `Email: ${order.email}` : null,
    `Entrega: ${order.deliveryText || (order.delivery === 'retiro' ? 'Retiro en local' : order.address)}`,
    order.notes ? `Notas: ${order.notes}` : null,
    '',
    'Detalle:',
    ...order.lines.map((l) => ' • ' + l),
    '',
    `Total a cobrar: ${money(order.total)} (pendiente de pago por transferencia)`,
    'Los diseños van adjuntos. Cambiá el estado del pedido desde /admin.html.',
  ].filter((x) => x !== null).join('\n');

  const attachments = [];
  let bytes = 0;
  for (const p of (order.imagePaths || []).slice(0, 25)) {
    const file = path.join(uploadDir, path.basename(p));
    try {
      const size = require('fs').statSync(file).size;
      if (bytes + size > 18 * 1024 * 1024) break; // Gmail permite ~25 MB por mail
      bytes += size;
      attachments.push({ filename: path.basename(p), path: file });
    } catch (e) { /* imagen no encontrada: seguimos */ }
  }

  await getTransporter().sendMail({
    from: `"${process.env.STORE_NAME || 'nalv.estudio'}" <${getConfig().user}>`,
    to,
    replyTo: order.email || undefined,
    subject: `🧾 Nuevo pedido ${order.code} · ${money(order.total)} · ${order.name}`,
    text,
    attachments,
  });
  return true;
}

// Mail genérico (recuperar contraseña, promos). opts: { to, subject, text, html, headers }
async function sendMail(opts) {
  if (!enabled()) return false;
  await getTransporter().sendMail({
    from: `"${process.env.STORE_NAME || 'nalv.estudio'}" <${getConfig().user}>`,
    to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, headers: opts.headers,
    replyTo: ownerEmail(),
  });
  return true;
}

module.exports = { sendOrderMail, sendMail, enabled, getConfig, saveConfig, clearConfig, verify, ownerEmail };
