// categorias.js — ordena los stickers por tema para que el cliente encuentre rápido lo que le gusta.
// Cada sticker se clasifica solo según las palabras de su nombre; vos podés cambiarle la categoría desde el panel
// (lo que cambies a mano no se pisa). Los nombres más específicos van primero.

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// orden = cómo se muestran en la web
const CATS = [
  { name: 'Argentina y fútbol', emoji: '🇦🇷', re: /argentin|seleccion|malvinas|messi|mundial|scaloni|\bdibu\b|\bm 10\b|\bgoat\b|alvarez|\bboca\b|\briver\b|futbol|\bgol\b|partido|estadio|\breme\b|\bafa\b|\bcopa\b|campeon|bandera|asado|\bpibe/ },
  { name: 'Mates y termos', emoji: '🧉', re: /\bmates?\b|termo|cebad|yerba|bombilla/ },
  { name: 'Música', emoji: '🎵', re: /bad bunny|soda stereo|dtmf|cancion|musica|\brock\b|cumbia|\btrap\b|duki|spotify|5sos|vinilo|\bbanda\b|concierto/ },
  { name: 'Gatos y animales', emoji: '🐱', re: /\bgat[oa]s?\b|\bcat\b|\bcats\b|perr[oa]|\bdog\b|animal|capibara|\bsapo\b|pajaro|tortuga|\bpato\b/ },
  { name: 'Series, pelis y dibujos', emoji: '🎬', re: /simpson|jojo|patrick|sheldon|pelicula|\bserie\b|anime|naruto|dragon ball|pokemon|disney|star wars|marvel|bob esponja|south park|\brick\b|teoria del|goku|shrek|netflix/ },
  { name: 'Famosos y personajes', emoji: '⭐', re: /cirio|alpine|lawerta|argento\b|pedro sanchez|famos|youtuber|streamer|ibai|coscu|pergolini|milei|cristina|maradona/ },
  { name: 'Fiestas y fechas', emoji: '🎉', re: /navidad|navideno|cumple|fiesta|halloween|pascua|san valentin|dia del|brillante|a(n|ñ)o nuevo/ },
  { name: 'Memes y frases', emoji: '😂', re: /\bmemes?\b|lmao|\bxd\b|wazaa|jaja|frases?\b|quotes?\b|sarcas|funny|chistos|neuronas|cerra el|caso cerrado|\boigo\b|me llaman|mentira|avergonz|\baura\b|pipipi|\bplata\b|yaaa|ya voy|disociando|\bloca\b|altura|bastatrola|vinito|inteligencia|informados|no mi reyna|edicion limitada|pendeja|gemelas|ahi va|reyna|reina|bumper|me esta|asi estan|mucho menos|gracias capitan/ },
];
// Categorías que no se detectan por el nombre: se usan al cargar por carpetas (packs de stickers libres, banderas, emojis).
const EXTRAS = [
  { name: 'Memes argentinos', emoji: '😂' },
  { name: 'Frases argentinas', emoji: '🗣️' },
  { name: 'Comida argentina', emoji: '🥩' },
  { name: 'Cultura argentina', emoji: '🇦🇷' },
  { name: 'Banderas', emoji: '🏳️' },
];
const OTROS = { name: 'Variados', emoji: '✨' };
const ORDER = CATS.map((c) => c.name).concat(EXTRAS.map((c) => c.name), [OTROS.name]);

function categorize(title) {
  const t = norm(title);
  for (const c of CATS) if (c.re.test(t)) return c.name;
  return OTROS.name;
}
const emojiOf = (name) => (CATS.find((c) => c.name === name) || EXTRAS.find((c) => c.name === name) || (name === OTROS.name ? OTROS : null) || { emoji: '🏷️' }).emoji;

// Los nombres de archivo que vienen de un .zip hecho en Windows traen cosas como "As#U00ed" (= "Así") o "#L01f603" (= 😃).
function decodeName(t) {
  return String(t || '')
    .replace(/#U([0-9a-fA-F]{4})/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/#L([0-9a-fA-F]{6})/g, (m, h) => { const n = parseInt(h, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : m; })
    .replace(/#L[0-9a-fA-F]{0,5}$/, '').replace(/#U[0-9a-fA-F]{0,3}$/, '')   // código cortado al final (el nombre se recorta a 60 letras)
    .normalize('NFKC')                                                       // letras "decoradas" (𝐒𝐭𝐢𝐜𝐤𝐞𝐫𝐬) → normales
    .replace(/\s+/g, ' ').trim();
}
// Nombres que no dicen nada ("Descarga 2026 10 12T21…", "13c8508a…", solo símbolos) → se reemplazan por "Sticker 123".
function isJunkTitle(t) {
  const s = String(t || '').trim();
  if (!s) return true;
  if (!/[\p{L}\p{N}]/u.test(s.replace(/[\u{1D400}-\u{1D7FF}\u{1F000}-\u{1FAFF}←-⯿]/gu, ''))) return true; // sin letras ni números "normales"
  if (/^(descarga|download|image|imagen|img|foto|photo|captura|screenshot|whatsapp image)[\s\d\-t_.]*$/i.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  if (/^(instagram|shein|stickers?|pegatinas?|other|mo|yo|stickers? para (whatsapp|ediciones de videos)|sticker que puedes usar)$/i.test(s)) return true; // títulos genéricos
  return false;
}

// Nombre de carpeta → categoría: saca números de orden ("01 - "), códigos raros, y si coincide con una categoría conocida usa su nombre oficial.
function folderCategory(name) {
  let n = decodeName(String(name || '')).replace(/^\d+[\s._)-]+/, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (!n || /^(stickers?|imagenes|images|fotos|descargas|downloads|todos|all)$/i.test(n)) return '';
  const hit = ORDER.find((c) => norm(c) === norm(n)); return hit || n.charAt(0).toUpperCase() + n.slice(1);
}

// Categorías ya revisadas a ojo para los stickers de la primera carga (clave = huella del archivo original).
let INICIALES = {};
try { INICIALES = require('./categorias-iniciales.json'); } catch (e) { /* sin archivo: se usa solo el nombre */ }
const inicial = (hash) => (hash && INICIALES[hash]) || null;

module.exports = { folderCategory, inicial, CATS, ORDER, OTROS, categorize, emojiOf, decodeName, isJunkTitle };
