// paths.js — DÓNDE se guardan tus datos (pedidos, métricas, clientes, stickers cargados, mail conectado, fotos de los pedidos).
//
// Los datos viven FUERA de la carpeta del sitio, para que actualizar, reemplazar o borrar la carpeta del sitio no los toque:
//   1) Si definís DATA_DIR en el .env, se usa esa carpeta (ej. el disco persistente de tu hosting: /var/data/nalv).
//   2) Si no, se usa automáticamente la carpeta  <tu usuario>/nalv-datos  (ej. C:\Users\Carlos\nalv-datos).
//   3) Solo si esa carpeta no se puede crear/escribir, se usa "data" y "uploads" dentro del sitio (y el panel te avisa).
// La primera vez que arranca con la ubicación nueva, COPIA lo que haya en data/ y uploads/ del sitio (no borra nada).
// Los archivos de los pedidos van a DATA_DIR/uploads (a menos que definas UPLOAD_DIR).
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCAL_DATA = path.join(__dirname, 'data');
const LOCAL_UP = path.join(__dirname, 'uploads');

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; } catch (e) { return false; }
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.gitkeep' || e.name === '_tmp' || e.name === 'backups') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

const envDir = process.env.DATA_DIR && process.env.DATA_DIR.trim() ? path.resolve(process.env.DATA_DIR.trim()) : '';
let DATA_DIR, custom, auto = false;
if (envDir) { DATA_DIR = envDir; custom = true; fs.mkdirSync(DATA_DIR, { recursive: true }); }
else {
  const home = path.join(os.homedir() || '', 'nalv-datos');
  if (os.homedir() && writable(home)) { DATA_DIR = home; custom = true; auto = true; }
  else { DATA_DIR = LOCAL_DATA; custom = false; }
}
const UPLOAD_DIR = process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim()
  ? path.resolve(process.env.UPLOAD_DIR.trim())
  : (custom ? path.join(DATA_DIR, 'uploads') : LOCAL_UP);

// Migración única: si la carpeta de datos nueva está vacía y el sitio tiene datos adentro, se copian.
if (custom && !fs.existsSync(path.join(DATA_DIR, 'shop.json')) && fs.existsSync(path.join(LOCAL_DATA, 'shop.json'))) {
  try {
    copyDir(LOCAL_DATA, DATA_DIR);
    copyDir(LOCAL_UP, UPLOAD_DIR);
    console.log('[datos] Copié tus datos del sitio a ' + DATA_DIR);
  } catch (e) { console.error('[datos] No pude copiar los datos existentes:', e.message); }
}

module.exports = { DATA_DIR, UPLOAD_DIR, custom, auto };
