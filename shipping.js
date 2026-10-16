// shipping.js — envíos a todo el país con tarifa estimada de Correo Argentino (Clásico).
//
// ⚠️ Estos valores son una REFERENCIA: tarifas de lista del servicio "Clásico" de MiCorreo para
// paquetes (julio–octubre 2026, publicadas por terceros) y las zonas se agruparon por distancia a
// Buenos Aires. Si tenés convenio (Paq.ar / Mi Correo Emprendedores) tus tarifas son más bajas y
// cambian seguido. Para ajustarlas: editá TARIFAS abajo, o usá SHIPPING_ADJUST_PCT en el .env
// (ej.: -15 para un 15% menos, 10 para un 10% más).

// Tarifa "a domicilio" (ARS) por peso en kg para cada zona: [kg, precio]
const TARIFAS = {
  1: [[1, 9648], [5, 15957], [10, 21342]],   // cercanas (ej. Rosario, Córdoba, Mar del Plata)
  2: [[1, 10509], [5, 17880], [10, 25423]],  // medias   (ej. Mendoza, Tucumán, Neuquén)
  3: [[1, 10586], [5, 19724], [10, 30568]],  // lejanas  (ej. Salta, Ushuaia)
};
// A sucursal sale más barato: proporción respecto del domicilio (según tarifas de 1 kg).
const RATIO_SUCURSAL = { 1: 0.70, 2: 0.71, 3: 0.73 };

const PROVINCES = [
  { id: 'caba', label: 'Ciudad Autónoma de Buenos Aires', zone: 1 },
  { id: 'buenos_aires', label: 'Buenos Aires', zone: 1 },
  { id: 'catamarca', label: 'Catamarca', zone: 2 },
  { id: 'chaco', label: 'Chaco', zone: 2 },
  { id: 'chubut', label: 'Chubut', zone: 3 },
  { id: 'cordoba', label: 'Córdoba', zone: 1 },
  { id: 'corrientes', label: 'Corrientes', zone: 2 },
  { id: 'entre_rios', label: 'Entre Ríos', zone: 1 },
  { id: 'formosa', label: 'Formosa', zone: 3 },
  { id: 'jujuy', label: 'Jujuy', zone: 3 },
  { id: 'la_pampa', label: 'La Pampa', zone: 1 },
  { id: 'la_rioja', label: 'La Rioja', zone: 2 },
  { id: 'mendoza', label: 'Mendoza', zone: 2 },
  { id: 'misiones', label: 'Misiones', zone: 3 },
  { id: 'neuquen', label: 'Neuquén', zone: 2 },
  { id: 'rio_negro', label: 'Río Negro', zone: 2 },
  { id: 'salta', label: 'Salta', zone: 3 },
  { id: 'san_juan', label: 'San Juan', zone: 2 },
  { id: 'san_luis', label: 'San Luis', zone: 2 },
  { id: 'santa_cruz', label: 'Santa Cruz', zone: 3 },
  { id: 'santa_fe', label: 'Santa Fe', zone: 1 },
  { id: 'santiago_del_estero', label: 'Santiago del Estero', zone: 2 },
  { id: 'tierra_del_fuego', label: 'Tierra del Fuego', zone: 3 },
  { id: 'tucuman', label: 'Tucumán', zone: 2 },
];

// Peso estimado de cada cosa (kg), para calcular el del paquete
// Pesos con margen de seguridad (prenda + estampa + bolsa individual) por si el Correo cobra de más.
const PESO_PRENDA = { remera_basica: 0.30, remera_especial: 0.38, remera_nino: 0.22, crop_top: 0.22, musculosa: 0.24, buzo_canguro: 0.85 };
const PESO_PLANCHA = 0.20;     // plancha de vinilo enrollada
const PESO_STICKER_SUELTO = 0.02;
const PESO_EMBALAJE = 0.30;    // bolsa / caja

const METHODS = {
  retiro: 'Retiro en local',
  correo_domicilio: 'Correo Argentino a domicilio',
  correo_sucursal: 'Correo Argentino a sucursal',
};

function weightKg({ singles = 0, planchas = 0, shirts = [] }) {
  const prendas = shirts.reduce((a, s) => a + (PESO_PRENDA[s.garment] || 0.25) * Math.max(1, s.qty | 0), 0);
  const w = prendas + planchas * PESO_PLANCHA + singles * PESO_STICKER_SUELTO + PESO_EMBALAJE;
  return Math.round(w * 100) / 100;
}

function interpolate(points, kg) {
  const w = Math.max(points[0][0], kg); // por debajo de 1 kg se cobra 1 kg
  for (let i = 0; i < points.length - 1; i++) {
    const [w0, p0] = points[i], [w1, p1] = points[i + 1];
    if (w <= w1) return p0 + ((p1 - p0) * (w - w0)) / (w1 - w0);
  }
  const [w0, p0] = points[points.length - 2], [w1, p1] = points[points.length - 1];
  return p1 + ((p1 - p0) / (w1 - w0)) * (w - w1); // más de 10 kg: sigue la misma pendiente
}

// method: 'retiro' | 'correo_domicilio' | 'correo_sucursal'
function quote({ method, province, weight }) {
  if (method === 'retiro') return { ok: true, cost: 0, zone: null, weightKg: weight };
  const prov = PROVINCES.find((p) => p.id === province);
  if (!prov || !METHODS[method]) return { ok: false, error: 'Elegí la provincia de destino.' };
  let cost = interpolate(TARIFAS[prov.zone], weight);
  if (method === 'correo_sucursal') cost *= RATIO_SUCURSAL[prov.zone];
  const adj = Number(process.env.SHIPPING_ADJUST_PCT) || 0;
  cost = cost * (1 + adj / 100);
  cost = Math.max(0, Math.ceil(cost / 100) * 100); // redondeo hacia arriba a $100
  return { ok: true, cost, zone: prov.zone, weightKg: weight };
}

module.exports = { PROVINCES, METHODS, weightKg, quote };
