// recover.js — "Buscar mis archivos perdidos".
// Los datos (nombres, precios, categorías, pedidos) viven en shop.json; las IMÁGENES viven en carpetas aparte
// (galeria, planchas, planchas-archivos, uploads). Si el sitio se abre desde otra carpeta, las imágenes pueden quedar
// "atrás" en la carpeta de una versión anterior. Este módulo detecta qué imágenes faltan, las busca en las carpetas
// habituales de la computadora (Escritorio, Descargas, Documentos, la carpeta donde estaba el sitio, etc.) y las COPIA
// a donde corresponden. Nunca borra ni mueve nada: solo copia.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'appdata', 'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information',
  'library', '.npm', '.cache', '.vscode', 'onedrivetemp', 'dist', 'build', 'backups', '_tmp', 'sessions']);
const base = (p) => path.basename(String(p || '').replace(/\\/g, '/'));

// Qué archivos se necesitan y en qué carpeta tienen que estar
function needed({ db, DATA_DIR, UPLOAD_DIR }) {
  const d = db.read(), want = new Map(); // nombre -> [carpetas destino posibles]
  const add = (name, dir) => { if (!name) return; const n = base(name); if (!n || n === '.' || n === '..') return; if (!want.has(n)) want.set(n, []); if (!want.get(n).includes(dir)) want.get(n).push(dir); };
  const gal = path.join(DATA_DIR, 'galeria'), pub = path.join(DATA_DIR, 'planchas'), priv = path.join(DATA_DIR, 'planchas-archivos'), pend = path.join(DATA_DIR, 'galeria-pendientes');
  (d.gallery || []).forEach((g) => { add(g.file, gal); add(g.thumb, gal); });
  (d.pending || []).forEach((p) => add(p.file, pend));
  (d.packs || []).forEach((p) => { add(p.file, pub); add(p.thumb, pub); });
  // originales de las planchas: se llaman <key>.<ext>, no sabemos la extensión → se resuelve al escanear
  const packKeys = new Map((d.packs || []).filter((p) => p.key).map((p) => [String(p.key), priv]));
  const up = (v) => add(v, UPLOAD_DIR);
  (d.orders || []).forEach((o) => {
    (o.items || []).forEach((it) => { up(it.image_path); up(it.image_orig); up(it.image_thumb); });
    (o.sheets || []).forEach((s) => (s.items || []).forEach((it) => { up(it.image_path); up(it.image_orig); up(it.image_thumb); }));
    (o.shirts || []).forEach((s) => { up(s.image_path); up(s.image_orig); up(s.image_thumb); up(s.print); up(s.preview); });
  });
  const missing = new Map(), keysMissing = new Map();
  for (const [name, dirs] of want) { if (!dirs.some((dir) => ok(path.join(dir, name)))) missing.set(name, dirs[0]); }
  for (const [key, dir] of packKeys) { let has = false; try { has = fs.readdirSync(dir).some((f) => f.startsWith(key + '.')); } catch (e) { /* carpeta nueva */ } if (!has) keysMissing.set(key, dir); }
  return { missing, keysMissing, total: want.size };
}
function ok(f) { try { return fs.statSync(f).size > 0; } catch (e) { return false; } }

function roots(DATA_DIR) {
  const home = os.homedir() || '', proj = __dirname, out = [];
  const add = (p, depth) => { if (p && fs.existsSync(p) && !out.some((r) => path.resolve(r.p) === path.resolve(p))) out.push({ p, depth }); };
  add(path.dirname(proj), 4);                       // la carpeta donde está el sitio (y sus "hermanas": versiones anteriores)
  add(proj, 3);
  for (const n of ['Desktop', 'Escritorio', 'Downloads', 'Descargas', 'Documents', 'Documentos']) add(path.join(home, n), 5);
  try { for (const n of fs.readdirSync(home)) if (/^onedrive/i.test(n)) { for (const s of ['Desktop', 'Escritorio', 'Downloads', 'Descargas', 'Documents', 'Documentos']) add(path.join(home, n, s), 5); add(path.join(home, n), 2); } } catch (e) { /* nada */ }
  add(home, 3);                                      // C:\Users\vos (nalv-datos, carpetas sueltas)
  return out;
}

let state = { running: false, found: 0, scanned: 0, missingBefore: 0, missingAfter: 0, done: false, startedAt: 0, note: '' };
const status = () => ({ ...state });

async function run(ctx, { maxMs = 90000, maxFiles = 400000 } = {}) {
  if (state.running) return status();
  const { DATA_DIR } = ctx;
  const n0 = needed(ctx);
  state = { running: true, found: 0, scanned: 0, missingBefore: n0.missing.size + n0.keysMissing.size, missingAfter: n0.missing.size + n0.keysMissing.size, done: false, startedAt: Date.now(), note: '' };
  if (!state.missingBefore) { state.running = false; state.done = true; state.note = 'No falta ningún archivo.'; return status(); }
  const missing = n0.missing, keys = n0.keysMissing, seen = new Set(), t0 = Date.now();
  const dataReal = (() => { try { return fs.realpathSync(DATA_DIR); } catch (e) { return path.resolve(DATA_DIR); } })();
  async function walk(dir, depth) {
    if (!depth || Date.now() - t0 > maxMs || state.scanned > maxFiles || (!missing.size && !keys.size)) return;
    let real; try { real = await fsp.realpath(dir); } catch (e) { return; }
    if (seen.has(real)) return; seen.add(real);
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    let n = 0;
    for (const e of ents) {
      if (Date.now() - t0 > maxMs) return;
      if (++n % 400 === 0) await new Promise((r) => setImmediate(r));
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name.toLowerCase()) || (e.name.startsWith('.') && e.name !== '.')) continue;
        await walk(full, depth - 1);
      } else if (e.isFile()) {
        state.scanned++;
        const dst = missing.get(e.name);
        let target = null, name = e.name;
        if (dst) target = path.join(dst, e.name);
        else { const m = e.name.match(/^([0-9a-f]{12})\.[a-z0-9]+$/i); if (m && keys.has(m[1])) { target = path.join(keys.get(m[1]), e.name); } }
        if (!target) continue;
        // no copiamos un archivo sobre sí mismo (el original ya está en su lugar)
        if (path.resolve(full) === path.resolve(target)) continue;
        try {
          if (!ok(full)) continue;
          await fsp.mkdir(path.dirname(target), { recursive: true });
          if (!ok(target)) await fsp.copyFile(full, target);
          state.found++;
          if (dst) missing.delete(name); else keys.delete(name.slice(0, 12));
          state.missingAfter = missing.size + keys.size;
        } catch (err) { /* sigue con el próximo */ }
      }
    }
  }
  try { for (const r of roots(DATA_DIR)) { await walk(r.p, r.depth); if (!missing.size && !keys.size) break; } }
  catch (e) { state.note = 'Error al buscar: ' + e.message; }
  state.missingAfter = missing.size + keys.size; state.running = false; state.done = true;
  if (!state.note) state.note = state.found ? `Recuperé ${state.found} archivos.${state.missingAfter ? ' Quedan ' + state.missingAfter + ' que no encontré en esta computadora.' : ''}` : 'No encontré los archivos en esta computadora.';
  return status();
}

module.exports = { run, status, needed };
