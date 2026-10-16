// db.js
// Almacenamiento simple en un archivo JSON (data/shop.json). Sin dependencias nativas:
// no hace falta compilar nada (a diferencia de better-sqlite3/sqlite3), así que esto
// instala y corre igual en Windows, Mac o Linux con un `npm install` normal.
//
// Usamos fs.readFileSync/writeFileSync (sincrónicos) a propósito: como Node corre en un
// solo hilo y estas llamadas no ceden el control hasta terminar, dos pedidos no pueden
// pisarse entre sí aunque lleguen "al mismo tiempo" — no hace falta un mecanismo de
// bloqueo aparte. Para una tienda chica/mediana este formato es más que suficiente;
// si algún día el archivo crece mucho y se vuelve lento, ahí sí conviene pasar a una
// base de datos real.

const fs = require('fs');
const path = require('path');
const { categorize } = require('./categorias');

const { DATA_DIR } = require('./paths');
const { renameRetry } = require('./fsafe');
const DB_FILE = path.join(DATA_DIR, 'shop.json');

function emptyDb() {
  return { nextOrderId: 1, nextSheetId: 1, nextItemId: 1, orders: [], gallery: [], nextGalleryId: 1 };
}

function readJsonFile(f) {
  const raw = fs.readFileSync(f, 'utf-8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}
function load() {
  if (!fs.existsSync(DB_FILE)) return emptyDb();
  try {
    return readJsonFile(DB_FILE) || emptyDb();
  } catch (err) {
    // Archivo dañado: NO lo pisamos. Lo guardamos aparte y probamos con la última copia automática.
    console.error('⚠️  No se pudo leer shop.json (puede estar dañado):', err.message);
    try { fs.copyFileSync(DB_FILE, path.join(DATA_DIR, 'shop-danado-' + Date.now() + '.json')); } catch (e) { /* nada */ }
    try {
      const dir = path.join(DATA_DIR, 'backups');
      const snaps = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^shop-\d{4}/.test(f)).sort().reverse() : [];
      for (const s of snaps) { try { const j = readJsonFile(path.join(dir, s)); if (j && Array.isArray(j.orders)) { console.error('   Se recuperó la copia automática ' + s); return j; } } catch (e) { /* siguiente */ } }
    } catch (e) { /* nada */ }
    return emptyDb();
  }
}


function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Escribimos primero a un archivo temporal y recién después lo renombramos al final:
  // así, si el proceso se corta justo en medio de guardar, nunca queda un shop.json
  // a medio escribir (corrupto) — en el peor caso se pierde solo el último cambio.
  const tmpFile = DB_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  renameRetry(tmpFile, DB_FILE);
}

// Crea un pedido completo (con sus stickers sueltos y sus pliegos) en una sola operación.
// input: {
//   order_code, customer_name, customer_phone, customer_email, delivery_method, address, notes,
//   total, discount,
//   items:  [{ size_cm, qty, unit_price, line_total, image_path, label }],            → sueltos
//   sheets: [{ price, width_cm, length_cm, used_length_cm,
//              items: [{ size_cm, qty, image_path, label }] }],                       → pliegos
// }
function createOrder(input) {
  const data = load();

  const id = data.nextOrderId++;
  const order = {
    id,
    // Numeración correlativa: NALV-0001, NALV-0002, ... (la asigna la base, nunca se repite)
    order_code: 'NALV-' + String(id).padStart(4, '0'),
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    customer_email: input.customer_email || null,
    delivery_method: input.delivery_method,
    address: input.address || null,
    province: input.province || null,
    city: input.city || null,
    postal_code: input.postal_code || null,
    dni: input.dni || null,
    branch: input.branch || null,
    shipping_cost: input.shipping_cost || 0,
    shipping_weight_kg: input.shipping_weight_kg || 0,
    shipping_zone: input.shipping_zone || null,
    notes: input.notes || null,
    user_id: input.user_id || null,           // cuenta del cliente (si compró estando logueado)
    marketing: !!input.marketing,             // aceptó recibir ofertas/novedades
    share_gallery: !!input.share_gallery, // el cliente permitió que sus diseños se publiquen (siempre los aprobás vos)
    total: input.total,
    discount: input.discount || 0,
    status: 'pendiente_pago',
    created_at: new Date().toISOString(),
    history: [{ status: 'pendiente_pago', at: new Date().toISOString() }],
    items: [],
    sheets: [],
    shirts: [],
    packs: (input.packs || []).map((pk) => ({ id: data.nextItemId++, pack_id: pk.pack_id, pack_key: pk.pack_key, title: pk.title, stickers: pk.stickers, qty: pk.qty, unit_price: pk.unit_price, line_total: pk.line_total, thumb: pk.thumb || null })),
  };

  (input.items || []).forEach((it) => {
    order.items.push({
      id: data.nextItemId++,
      sheet_id: null,
      size_cm: it.size_cm,
      qty: it.qty,
      unit_price: it.unit_price,
      line_total: it.line_total,
      image_path: it.image_path,
      image_orig: it.image_orig || null,
      image_thumb: it.image_thumb || null,
      image_meta: it.image_meta || null,
      label: it.label || null,
    });
  });

  (input.sheets || []).forEach((sheetInput) => {
    const sheetId = data.nextSheetId++;
    const sheet = {
      id: sheetId,
      price: sheetInput.price,
      planchas: sheetInput.planchas || 1,
      width_cm: sheetInput.width_cm,
      length_cm: sheetInput.length_cm,
      used_length_cm: sheetInput.used_length_cm,
      items: [],
    };
    (sheetInput.items || []).forEach((it) => {
      sheet.items.push({
        id: data.nextItemId++,
        sheet_id: sheetId,
        size_cm: it.size_cm,
        h_cm: it.h_cm || it.size_cm,
        qty: it.qty,
        unit_price: 0,
        line_total: 0,
        image_path: it.image_path,
        image_orig: it.image_orig || null,
        image_thumb: it.image_thumb || null,
        image_meta: it.image_meta || null,
        label: it.label || null,
      });
    });
    order.sheets.push(sheet);
  });

  (input.shirts || []).forEach((sh) => {
    order.shirts.push({
      id: data.nextItemId++,
      garment_id: sh.garment_id,
      garment_label: sh.garment_label,
      size: sh.size,
      color_id: sh.color_id,
      color_label: sh.color_label,
      color_hex: sh.color_hex,
      print: sh.print,
      print_label: sh.print_label,
      qty: sh.qty,
      unit_price: sh.unit_price,
      line_total: sh.line_total,
      front_image: sh.front_image || null,
      back_image: sh.back_image || null,
      front_orig: sh.front_orig || null, front_thumb: sh.front_thumb || null, front_meta: sh.front_meta || null,
      back_orig: sh.back_orig || null, back_thumb: sh.back_thumb || null, back_meta: sh.back_meta || null,
      label: sh.label || null,
      placements: sh.placements || null,
    });
  });

  data.orders.unshift(order); // los pedidos más nuevos van primero
  save(data);
  return order;
}

// Todos los pedidos, más nuevos primero, cada uno con sus items y pliegos ya anidados
// (listo para que el panel de admin lo renderice directo, sin tener que cruzar tablas).
function getAllOrders() {
  return load().orders;
}

function updateOrderStatus(orderId, status) {
  const data = load();
  const order = data.orders.find((o) => o.id === Number(orderId));
  if (!order) return false;
  if (order.status !== status) {
    order.status = status;
    (order.history = order.history || []).push({ status, at: new Date().toISOString() });
  }
  save(data);
  return true;
}
// Cambia datos internos de un pedido (nota del administrador). Nunca borra pedidos.
function updateOrderMeta(orderId, patch) {
  const data = load();
  const order = data.orders.find((o) => o.id === Number(orderId));
  if (!order) return null;
  if (patch.admin_note !== undefined) order.admin_note = String(patch.admin_note || '').slice(0, 2000);
  save(data);
  return order;
}

// ---------- Galería de stickers para descargar ----------
function galleryAll() { return (load().gallery || []); }
function galleryAdd(entry) {
  const data = load();
  data.gallery = data.gallery || [];
  data.nextGalleryId = data.nextGalleryId || 1;
  const row = { id: data.nextGalleryId++, title: entry.title, file: entry.file, thumb: entry.thumb || null, hash: entry.hash || null, featured: !!entry.featured, category: entry.category || categorize(entry.title), cat_auto: !entry.category, source: entry.source, order_code: entry.order_code || null, created_at: new Date().toISOString() };
  data.gallery.unshift(row);
  save(data);
  return row;
}
function galleryRemove(id) {
  const data = load();
  const i = (data.gallery || []).findIndex((g) => g.id === Number(id));
  if (i < 0) return null;
  const [row] = data.gallery.splice(i, 1);
  save(data);
  return row;
}
function galleryRename(id, title, featured, category) {
  const data = load();
  const row = (data.gallery || []).find((g) => g.id === Number(id));
  if (!row) return null;
  if (title) { row.title = title; if (row.cat_auto) row.category = categorize(title); }
  if (featured !== undefined) row.featured = !!featured;
  if (category) { row.category = String(category).slice(0, 40); row.cat_auto = false; }
  save(data);
  return row;
}
function getOrder(id) { return load().orders.find((o) => o.id === Number(id)) || null; }

// Acceso genérico para los módulos nuevos (cuentas, gastos, contactos, pendientes): leer / modificar y guardar de una.
function read() { return load(); }
function tx(fn) { const data = load(); const out = fn(data); save(data); return out; }

module.exports = { read, tx, createOrder, getAllOrders, updateOrderStatus, updateOrderMeta, galleryAll, galleryAdd, galleryRemove, galleryRename, getOrder };
