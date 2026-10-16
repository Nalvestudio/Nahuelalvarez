// orderfolder.js — copia de seguridad "legible" de cada pedido, en una carpeta común y corriente de tu PC:
//   <tus datos>/pedidos/NALV-0001_Nombre-del-cliente/
//        pedido.txt   (resumen para leer)      pedido.json (todos los datos del pedido)
//        archivos/    (cada diseño: *_IMPRIMIR.png y el original que subió el cliente)
// Se arma sola cuando entra un pedido, se actualiza cuando cambiás el estado/nota, y al arrancar
// completa los pedidos que todavía no tengan su carpeta. NUNCA borra nada.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, UPLOAD_DIR } = require('./paths');

const DIR = path.join(DATA_DIR, 'pedidos');
const slug = (t, n = 30) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n) || 'cliente';
const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
const STATUS = { pendiente_pago: 'Pendiente de pago', pagado: 'Pagado', en_produccion: 'En producción', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
const folderOf = (o) => path.join(DIR, `${o.order_code}_${slug(o.customer_name)}`);

function put(src, dst) {
  if (!src || fs.existsSync(dst)) return;
  const f = path.join(UPLOAD_DIR, path.basename(String(src)));
  if (!fs.existsSync(f)) return;
  try { fs.linkSync(f, dst); } catch (e) { try { fs.copyFileSync(f, dst); } catch (x) { /* sin espacio / sin permiso: queda en uploads igual */ } }
}

function summary(o) {
  const L = [`PEDIDO ${o.order_code}`, `Fecha: ${new Date(o.created_at).toLocaleString('es-AR')}`, `Estado: ${STATUS[o.status] || o.status}${o.payment_method ? ' · cobro: ' + o.payment_method : ''}`, `Total: ${money(o.total)}${o.shipping_cost ? ' (incluye envío ' + money(o.shipping_cost) + ')' : ''}`, '',
    `CLIENTE: ${o.customer_name} · ${o.customer_phone}${o.customer_email ? ' · ' + o.customer_email : ''}`];
  L.push(o.delivery_method === 'retiro' ? 'ENTREGA: retiro en local' : `ENTREGA: ${o.delivery_method} · DNI ${o.dni || '—'} · ${o.address || o.branch || ''} · ${o.city || ''} ${o.province || ''} CP ${o.postal_code || ''}`);
  if (o.notes) L.push('NOTAS DEL CLIENTE: ' + o.notes);
  if (o.admin_note) L.push('NOTA INTERNA: ' + o.admin_note);
  L.push('');
  (o.items || []).forEach((it) => L.push(`Sticker suelto ${it.size_cm} cm × ${it.qty}${it.label ? ' — ' + it.label : ''}`));
  (o.sheets || []).forEach((sh, i) => { L.push(`Plancha ${i + 1} (${sh.width_cm}×${sh.length_cm} cm × ${sh.planchas || 1}) — ${money(sh.price)}`); (sh.items || []).forEach((it) => L.push(`    ${it.qty} × ${it.size_cm}×${it.h_cm || it.size_cm} cm${it.label ? ' ' + it.label : ''}`)); });
  (o.packs || []).forEach((k) => L.push(`Plancha armada «${k.title}» × ${k.qty}`));
  (o.shirts || []).forEach((sh) => L.push(`${sh.garment_label} ${sh.color_label} talle ${sh.size} × ${sh.qty} (${sh.print_label || sh.print})`));
  L.push('', 'HISTORIAL:', ...(o.history || []).map((h) => `  ${new Date(h.at).toLocaleString('es-AR')} → ${STATUS[h.status] || h.status}`));
  L.push('', 'La plancha armada completa (58×50 cm, 300 dpi) y las maquetas de las prendas se descargan desde el panel (Pedidos → Todo el pedido .zip).');
  return L.join('\n');
}

function save(o) {
  try {
    const dir = folderOf(o), fdir = path.join(dir, 'archivos');
    fs.mkdirSync(fdir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pedido.json'), JSON.stringify(o, null, 2));
    fs.writeFileSync(path.join(dir, 'pedido.txt'), summary(o));
    let n = 0;
    const pair = (base, print, orig) => { n++; const nn = String(n).padStart(2, '0'); put(print, path.join(fdir, `${nn}_${base}_IMPRIMIR.png`)); if (orig) put(orig, path.join(fdir, `${nn}_${base}_original${path.extname(orig)}`)); };
    (o.items || []).forEach((it) => pair(`suelto_${slug(it.label, 20)}_${it.size_cm}cm_x${it.qty}`, it.image_path, it.image_orig));
    (o.sheets || []).forEach((sh, si) => (sh.items || []).forEach((it) => pair(`plancha${si + 1}_${slug(it.label, 20)}_${it.size_cm}x${it.h_cm || it.size_cm}cm_x${it.qty}`, it.image_path, it.image_orig)));
    (o.shirts || []).forEach((sh) => {
      const b = `${slug(sh.garment_label, 16)}_${slug(sh.color_label, 12)}_talle${slug(sh.size, 4)}`;
      pair(`${b}_FRENTE`, sh.front_image, sh.front_orig);
      if (sh.back_image) pair(`${b}_ESPALDA`, sh.back_image, sh.back_orig);
    });
    return dir;
  } catch (e) { console.error('[pedidos] no pude guardar la carpeta de', o && o.order_code, e.message); return null; }
}

// al arrancar: completa lo que falte (pedidos viejos o carpeta borrada por error)
function backfill(orders) {
  let n = 0;
  for (const o of orders || []) { if (!fs.existsSync(path.join(folderOf(o), 'pedido.json'))) { if (save(o)) n++; } }
  return n;
}
module.exports = { DIR, save, backfill, folderOf };
