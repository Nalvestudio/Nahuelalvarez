// bot.js — "TONY": asistente de la web. Responde SOLO sobre nalv.estudio (stickers, remeras, precios,
// envíos, pagos, pedidos). Los precios y costos salen de pricing.js / shipping.js, así que nunca quedan desactualizados.
// No usa servicios externos ni cuesta nada: son reglas + datos reales de la tienda.
// Para cambiarle el nombre o el tono: BOT_NAME y los textos de abajo.
const pricing = require('./pricing');
const shipping = require('./shipping');

const BOT_NAME = 'TONY';
const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$%\- ]/g, ' ').replace(/\s+/g, ' ').trim();

function contact() {
  const wa = (process.env.WHATSAPP_NUMBER || '5492215730729').replace(/\D/g, '');
  return {
    wa, waUrl: `https://wa.me/${wa}`,
    email: process.env.ORDER_EMAIL || 'nalvarezestudio@gmail.com',
    alias: process.env.BANK_ALIAS || 'nalv.estudio',
    cvu: process.env.BANK_CVU || process.env.BANK_CBU || '0000003100053631202291',
    holder: process.env.BANK_HOLDER || 'Carlos Nahuel Alvarez',
  };
}
// Datos del local (se pueden cambiar en .env: LOCAL_ADDRESS y LOCAL_CITY)
const LOCAL_ADDRESS = () => process.env.LOCAL_ADDRESS || 'calle 45 e/ 145 y 146';
const LOCAL_CITY = () => process.env.LOCAL_CITY || 'La Plata';
const WA = (label = 'Escribir por WhatsApp') => ({ label, href: contact().waUrl });

// ---------- helpers de datos ----------
const GARMENT_WORDS = [
  ['remera_nino', /\b(nino|nina|ninos|infantil|chico|chicos|kids)\b.*\b(remera|prenda)|\bremera.*\b(nino|nina|infantil)\b/],
  ['remera_especial', /talle especial|talles? grandes?|xxxl|plus size|remera especial|talle (6|7|8|9|10)\b/],
  ['crop_top', /\bcrop\b|\btop\b/],
  ['musculosa', /musculosa|sin mangas/],
  ['buzo_canguro', /\bbuzo|canguro|hoodie|frisa|campera/],
  ['remera_basica', /remera|camiseta|\btee\b|clasica/],
];
function garmentFrom(n) {
  for (const [id, re] of GARMENT_WORDS) if (re.test(n)) return pricing.GARMENTS.find((g) => g.id === id);
  return null;
}
function garmentPriceText(g) {
  const [a, b, c] = g.prices.front, [d, e, f] = g.prices.both;
  return `**${g.label}** estampada adelante: ${money(a)} (1 a 10 u.), ${money(b)} (11 a 14) y ${money(c)} (15 o más). Con estampa adelante y atrás: ${money(d)} / ${money(e)} / ${money(f)}.`;
}
function provinceFrom(n) {
  const alias = { 'capital federal': 'caba', 'ciudad de buenos aires': 'caba', 'bs as': 'buenos_aires', 'buenos aires': 'buenos_aires', 'caba': 'caba', 'tierra del fuego': 'tierra_del_fuego', 'entre rios': 'entre_rios', 'rio negro': 'rio_negro', 'santa cruz': 'santa_cruz', 'santa fe': 'santa_fe', 'la pampa': 'la_pampa', 'la rioja': 'la_rioja', 'san juan': 'san_juan', 'san luis': 'san_luis', 'santiago del estero': 'santiago_del_estero', 'santiago': 'santiago_del_estero' };
  for (const [k, v] of Object.entries(alias)) if (n.includes(k)) return shipping.PROVINCES.find((p) => p.id === v);
  return shipping.PROVINCES.find((p) => new RegExp('\\b' + norm(p.label) + '\\b').test(n)) || null;
}
const fitCount = (cm) => { const r = pricing.packSheet([{ sizeCm: cm, aspect: 1, qty: 1000 }]); return r.placements.filter((p) => p.plancha === 0).length; };

// ---------- intenciones ----------
// kw: [regex, peso]. Gana la de mayor puntaje (mínimo 2).
const INTENTS = [
  { id: 'saludo', kw: [[/^(hola|holis|buenas|buen dia|buenas tardes|buenas noches|hey|ey|que tal|como andas|como va)\b/, 3]], short: true,
    reply: () => ({ text: `¡Buenas! Soy ${BOT_NAME}, el bot de nalv.estudio. Respondo corto y con datos reales: stickers, remeras, precios, envíos y pedidos. ¿Qué querés saber?`, chips: ['¿Cuánto sale la plancha?', 'Precios de remeras', '¿Hacen envíos?', '¿Cómo pago?'] }) },
  { id: 'gracias', kw: [[/\b(gracias|genial|perfecto|buenisimo|excelente|joya|barbaro|de una|listo|ok|dale)\b/, 2], [/\b(chau|nos vemos|hasta luego|adios)\b/, 3]], short: true,
    reply: () => ({ text: '¡De nada! Si te surge otra duda, acá estoy. 😉', chips: ['¿Cómo hago un pedido?', 'Tiempos de producción'] }) },
  { id: 'quien', kw: [[/(quien|que) sos|como te llamas|tu nombre|sos (un )?(bot|robot|humano|persona|real)|que haces|para que servis|que podes hacer|en que (me )?ayudas/, 3]],
    reply: () => ({ text: `Soy ${BOT_NAME}, el asistente automático de nalv.estudio. Te ayudo con precios, medidas, cómo armar tu plancha o tu remera, envíos, pagos y tiempos. De otros temas no hablo. Si necesitás a una persona, te paso el WhatsApp.`, links: [WA()], chips: ['¿Cómo hago un pedido?', 'Hablar con una persona'] }) },
  { id: 'como_pedir', kw: [[/como (hago|pido|compro|se hace|funciona|empiezo)|paso a paso|quiero (pedir|comprar|hacer|encargar)|como encargo|hacer un pedido/, 3], [/\b(pedido|pedir|comprar)\b/, 1], [/como (subo|cargo|agrego|pongo|mando) (mi |mis |una |un )?(imagen|diseno|foto|sticker|logo)/, 4]],
    reply: () => ({ text: '**Así de fácil:**\n1) Stickers: subí tus imágenes en "Armá tus stickers", elegí cantidad y medida, y se acomodan solas en la plancha.\n2) Remeras: entrá a "Prendas", elegí prenda, color y talle, subí tu diseño y ubicalo.\n3) Agregá al carrito y confirmá con tus datos (retiro o envío).\n4) Te damos tu número NALV-xxxx y los datos para transferir; mandás el comprobante por WhatsApp y arrancamos.', links: [{ label: 'Armar stickers', href: '/#crear' }, { label: 'Armar remera', href: '/remeras.html' }], chips: ['¿Cómo pago?', 'Tiempos de producción'] }) },
  { id: 'plancha', kw: [[/plancha|pliego|hoja/, 3], [/precio|cuanto|sale|cuesta|valor|medida|58|50 cm|como funciona|que es/, 1]],
    reply: () => { const S = pricing.SHEET; return { text: `La **plancha** mide ${S.widthCm} × ${S.lengthCm} cm y cuesta **${money(S.price)}**. Subís tus diseños (de distintas medidas si querés), elegís cantidad y se acomodan solos dejando ${String(S.gapCm).replace('.', ',')} cm entre stickers. Si no entran todos, se suma otra plancha del mismo precio.`, links: [{ label: 'Armar mi plancha', href: '/#crear' }], chips: ['¿Cuántos stickers entran?', 'Recomendación de medidas', '¿Puedo recortar mi diseño?'] }; } },
  { id: 'cuantos_entran', kw: [[/cuantos?.*(entran|caben|salen|stickers|hay)|cuanto entra|capacidad|que cantidad entra|entran en (una|la) plancha/, 4]],
    reply: () => ({ text: `En una plancha entran, aproximadamente (mismo diseño, cuadrado): **${[3, 5, 7, 10].map((c) => `${fitCount(c)} de ${c} cm`).join(', ')}**. Si mezclás medidas, la web te muestra cuánto espacio llevás ocupado y cuántos más entran. Recortando los márgenes vacíos de tu diseño entran más.`, links: [{ label: 'Armar mi plancha', href: '/#crear' }], chips: ['¿Puedo recortar mi diseño?', 'Recomendación de medidas'] }) },
  { id: 'suelto', kw: [[/suelto|individual|un solo sticker|solo uno|unidad|por unidad|pocos stickers/, 3], [/sticker.*(\d+) ?cm|(\d+) ?cm.*sticker/, 2], [/sticker.*(cuanto|precio|sale|cuesta|vale)|(cuanto|precio|sale|cuesta|vale).*sticker/, 3]],
    reply: () => ({ text: `**Sticker suelto:** ${money(pricing.SINGLE_PRICE)} por unidad, de cualquier tamaño (de ${pricing.MIN_CM} a ${pricing.MAX_CM} cm). Es más caro que en la plancha porque es por pocas unidades; si vas a pedir varios, conviene la plancha de ${money(pricing.SHEET.price)}.`, links: [{ label: 'Pedir sticker suelto', href: '/#crear' }], chips: ['¿Cuánto sale la plancha?', '¿Cuántos stickers entran?'] }) },
  { id: 'prendas_precio', kw: [[/remera|camiseta|buzo|canguro|hoodie|musculosa|crop|prenda|top\b|campera/, 3], [/precio|cuanto|sale|cuesta|valor|\$|vale|lista/, 1]],
    reply: (n) => {
      const g = garmentFrom(n);
      if (g) return { text: garmentPriceText(g) + ' El precio baja según el total de prendas estampadas del pedido.', links: [{ label: 'Diseñar mi prenda', href: '/remeras.html' }], chips: ['Descuentos por cantidad', 'Medidas recomendadas para la estampa', 'Talles'] };
      const list = pricing.GARMENTS.map((x) => `• ${x.label}: ${money(x.prices.front[0])} (adelante) · ${money(x.prices.both[0])} (adelante y atrás)`).join('\n');
      return { text: `**Prendas estampadas** (precio c/u de 1 a 10 unidades):\n${list}\nDesde 11 y desde 15 prendas el precio baja.`, links: [{ label: 'Diseñar mi prenda', href: '/remeras.html' }], chips: ['Descuentos por cantidad', 'Colores disponibles', 'Talles'] };
    } },
  { id: 'cantidad_desc', kw: [[/mayorista|por mayor|descuento|cantidad|docena|egresad|empresa|equipo|curso|varias|muchas|promo|oferta|rebaja/, 3], [/descuento|escalon|por mayor|mayorista/, 3], [/precio|cuanto|prendas|stickers/, 1], [/\b\d{2,}\b.*(remeras|prendas|stickers|buzos|musculosas)/, 4]],
    reply: () => { const g = pricing.GARMENTS[0]; return { text: `**Prendas:** el precio baja por escalón según el total de prendas estampadas del pedido: 1 a 10 u., 11 a 14 u. y 15 o más. Ej. ${g.label} adelante: ${money(g.prices.front[0])} → ${money(g.prices.front[1])} → ${money(g.prices.front[2])}.\n**Stickers:** el suelto es $800 por unidad fija; para cantidad conviene la plancha.\nSi necesitás una cantidad grande o un trabajo especial, consultanos por WhatsApp.`, links: [WA('Consultar por WhatsApp')], chips: ['Precios de remeras', '¿Cuánto sale la plancha?'] }; } },
  { id: 'medidas_estampa', kw: [[/(medida|tamano|ancho|grande|chico|cuan).*(estampa|logo|frente|espalda|pecho|diseno)|(estampa|logo|frente|espalda|pecho).*(medida|tamano|cuanto|grande|chico)|recomend.*(medida|tamano)|medidas? recomendada/, 4], [/recomend|que medida|que tamano/, 2]],
    reply: () => ({ text: '**Medidas recomendadas** para la remera:\n• Frente (suele ser chico): logo en el pecho ≈ 8 cm, chico ≈ 12 cm, mediano ≈ 20 cm, grande ≈ 28 cm.\n• Espalda: logo bajo el cuello ≈ 10 cm, mediano ≈ 25 cm, grande ≈ 32 cm, completa ≈ 38 cm.\nEn el diseñador hay botones de un toque que ya acomodan la medida y la ubicación. Para stickers: celular ~3 cm, termo/botella ~5 cm, notebook ~7 cm, auto ~10 cm.', links: [{ label: 'Diseñar mi prenda', href: '/remeras.html' }], chips: ['Talles', 'Calidad de la imagen'] }) },
  { id: 'talles', kw: [[/talle|guia de talles|tabla de talles|que talle|medidas de la (remera|prenda)|me queda|ancho de la remera|largo/, 3]],
    reply: (n) => {
      const g = garmentFrom(n) || pricing.GARMENTS[0];
      const sizes = (x) => x.sizes.map((s) => s.label).join(', ');
      const all = pricing.GARMENTS.map((x) => `• ${x.label}: ${sizes(x)}`).join('\n');
      const m = g.sizes[Math.floor(g.sizes.length / 2)];
      return { text: `**Talles disponibles:**\n${all}\nEj. ${g.label} talle ${m.label}: ${m.chestCm} cm de ancho × ${m.lengthCm} cm de largo (prenda extendida). Ahí mismo ves la guía completa con todas las medidas.`, links: [{ label: 'Ver guía de talles', href: '/remeras.html#talles' }], chips: ['Colores disponibles', 'Precios de remeras'] };
    } },
  { id: 'colores', kw: [[/color|colores|negra|blanca|negro|blanco|bordo|marino|gris|verde|tono/, 3]],
    reply: () => ({ text: `**Colores de prenda:** ${pricing.SHIRT_COLORS.map((c) => c.label).join(', ')}. Los ves en el diseñador sobre la prenda a escala real.`, links: [{ label: 'Diseñar mi prenda', href: '/remeras.html' }], chips: ['Talles', 'Medidas recomendadas para la estampa'] }) },
  { id: 'fondo', kw: [[/fondo|transparente|sacar el fondo|quitar el fondo|sin fondo|recortar el fondo/, 4]],
    reply: () => ({ text: '**Fondo:** en las **remeras** podés activar "Quitar el fondo" en el diseñador (funciona muy bien con fondos de un solo color). En los **stickers** no hace falta: el sticker se corta siguiendo tu imagen y, para que quede mejor, conviene subir un PNG con fondo transparente. Además recortamos solos los márgenes vacíos.', chips: ['¿Qué formatos aceptan?', '¿Puedo recortar mi diseño?'] }) },
  { id: 'recorte', kw: [[/recort|achicar la imagen|ajustar la imagen|que entren mas|entren mas|margen/, 4]],
    reply: () => ({ text: 'Sí. En la plancha, cada diseño tiene el botón **✂ Recortar**: arrastrás los bordes para dejar solo lo que querés imprimir. Cuanto más ajustado, más stickers entran. Al subir la imagen también recortamos solos los márgenes vacíos.', links: [{ label: 'Armar mi plancha', href: '/#crear' }], chips: ['¿Cuántos stickers entran?', '¿Cuánto sale la plancha?'] }) },
  { id: 'formato', kw: [[/formato|png|jpg|jpeg|svg|webp|pdf|calidad|resolucion|pixel|borros|dpi|se ve mal|se va a ver|baja calidad|pesa|archivo|que imagen|tipo de imagen|mejorar la imagen/, 3]],
    reply: () => ({ text: 'Aceptamos **PNG, JPG, WEBP y SVG** (hasta 10 MB). Lo ideal: PNG con fondo transparente y una imagen grande (apuntá a ~300 dpi al tamaño impreso). Guardamos tu archivo original y generamos una versión lista para imprimir que agranda y suaviza si hace falta, pero no puede inventar detalle: si tu imagen es muy chica, la web te avisa que puede verse pixelada.', chips: ['¿Y el fondo?', 'Medidas recomendadas para la estampa'] }) },
  { id: 'tiempos', kw: [[/cuanto (tarda|demora|tardan|demoran)|demora|tiempo de (produccion|entrega)|plazo|dias|cuando (esta|lo tengo|llega|lo retiro|estaria|puedo retirar)|urgente|rapido|para cuando|entrega/, 3], [/produccion|tarda|lista|listo/, 1], [/^tiempos?( de (produccion|entrega|demora))?$|tiempos? de/, 4]],
    reply: () => ({ text: '**Producción:** los pedidos chicos los hacemos en **2 o 3 días hábiles**; si son **más de 20 prendas**, en **5 días hábiles**. Se cuenta desde que se acredita el pago o la seña. Si lo enviás por Correo Argentino, a eso se suma el tiempo del correo, que depende del destino. ¿Lo necesitás para una fecha puntual? Escribinos y lo vemos.', links: [WA('Consultar fecha por WhatsApp')], chips: ['¿Cómo pago?', '¿Hacen envíos?'] }) },
  { id: 'envio', kw: [[/envio|enviar|enviarlo|mandan|mandar|mandarlo|correo argentino|despacho|encomienda|me lo mandan/, 5], [/correo|domicilio|sucursal|todo el pais|interior|a (mi )?casa|llega a/, 3], [/costo|cuanto|sale|precio|vale/, 1]],
    reply: (n) => {
      const prov = provinceFrom(n);
      let est = '';
      if (prov) {
        const w1 = shipping.weightKg({ singles: 0, planchas: 0, shirts: [{ garment: 'remera_basica', qty: 1 }] });
        const w2 = shipping.weightKg({ singles: 0, planchas: 1, shirts: [] });
        const q = (method, w) => shipping.quote({ method, province: prov.id, weight: w });
        est = `\nA **${prov.label}** (estimado): 1 remera ${money(q('correo_domicilio', w1).cost)} a domicilio / ${money(q('correo_sucursal', w1).cost)} a sucursal; 1 plancha ${money(q('correo_domicilio', w2).cost)} / ${money(q('correo_sucursal', w2).cost)}. El valor final lo ves al elegir tu provincia en el checkout.`;
      }
      const demora = /tarda|demora|dias|tiempo|llega|cuando/.test(n) ? 'El tiempo de entrega lo define Correo Argentino y depende del destino; a eso se suma la producción (2 o 3 días hábiles, o 5 si son más de 20 prendas). ' : '';
      return { text: `${demora}Sí, **enviamos a todo el país** por Correo Argentino, a domicilio o a sucursal (más barato). El costo depende de la **provincia** y del **peso** del paquete, y se suma al total en el checkout. También podés **retirar en local sin costo**.${est}`, links: [{ label: 'Armar mi pedido', href: '/#crear' }], chips: ['Retiro en local', '¿Cómo pago?', 'Tiempos de producción'] };
    } },
  { id: 'ubicacion', kw: [[/de donde (son|sos|eres|vienen|es (la )?(tienda|estudio|negocio))|donde (estan|estas|queda|queda el local|se encuentran|trabajan|son)|ubicad|ubicacion|direccion|donde (los|las) (encuentro|encontramos)|\bla plata\b|que zona|como llego|mapa/, 5]],
    reply: () => ({ text: `Somos de **${LOCAL_CITY()}** 🙌. Nuestro local está en **${LOCAL_ADDRESS()}**, ${LOCAL_CITY()}. Ahí podés **retirar tu pedido sin costo**; antes de ir escribinos por WhatsApp para confirmar que esté listo y el horario.`, links: [WA('Confirmar por WhatsApp')], chips: ['Tiempos de producción', '¿Hacen envíos?', '¿Cómo pago?'] }) },
  { id: 'retiro', kw: [[/retiro|retirar|retiras|buscar (el|mi) pedido|en persona|horario|local\b/, 3]],
    reply: () => ({ text: `El **retiro en local es gratis**: estamos en **${LOCAL_ADDRESS()}**, ${LOCAL_CITY()}. Cuando tu pedido está listo te avisamos por WhatsApp y coordinamos el horario de retiro.`, links: [WA()], chips: ['Tiempos de producción', '¿Hacen envíos?'] }) },
  { id: 'pago', kw: [[/bancari|pago|pagar|pagos|transferencia|transferir|alias|cvu|cbu|efectivo|mercado ?pago|tarjeta|cuotas|sena|deposito|datos bancarios|cuenta|comprobante|cobran|contado/, 3]],
    reply: (n) => {
      const c = contact();
      if (/tarjeta|mercado ?pago|cuotas|debito|credito/.test(n)) return { text: 'Por ahora aceptamos **transferencia bancaria** o **efectivo**; no trabajamos con tarjeta ni Mercado Pago desde la web. Si tenés una consulta particular, escribinos.', links: [WA()], chips: ['¿Cómo pago?'] };
      return { text: `Pagás por **transferencia** o **efectivo**. Al confirmar el pedido te mostramos tu número (NALV-xxxx) y el total.\nAlias: **${c.alias}**\nCVU: **${c.cvu}**\nTitular: ${c.holder}\nDespués mandanos el comprobante por WhatsApp con tu número de pedido y arrancamos.`, links: [WA('Enviar comprobante')], chips: ['Tiempos de producción', '¿Hacen envíos?'] };
    } },
  { id: 'seguimiento', kw: [[/seguimiento|mi pedido|numero de pedido|nalv-?\d+|donde esta mi|estado del pedido|rastrear|tracking|ya esta (listo|mi)|consultar (un )?pedido|no me llego/, 4]],
    reply: () => ({ text: 'Para saber cómo va tu pedido, escribinos por WhatsApp con tu **número de pedido (NALV-xxxx)** y te contamos el estado. Yo no puedo ver pedidos individuales.', links: [WA('Consultar mi pedido')], chips: ['Tiempos de producción'] }) },
  { id: 'contacto', kw: [[/whatsapp|wasap|contacto|contactar|mail|email|e-mail|instagram|tiktok|redes|hablar con|persona|humano|telefono|atencion|comunicarme|asesor|duena|dueno/, 3]],
    reply: () => { const c = contact(); return { text: `Podés escribirnos por **WhatsApp +${c.wa.replace(/^(\d{2})(\d)(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3 $4-$5')}**, al mail **${c.email}** o por Instagram y TikTok **@nalv.estudio**.`, links: [WA(), { label: 'Instagram', href: 'https://www.instagram.com/nalv.estudio/' }, { label: 'TikTok', href: 'https://www.tiktok.com/@nalv.estudio' }], chips: ['¿Cómo hago un pedido?'] }; } },
  { id: 'trabajos', kw: [[/trabajos|fotos|ejemplos|muestras|portafolio|que hacen|referencias|resultados/, 3]],
    reply: () => ({ text: 'En la sección **Trabajos realizados** de la web ves fotos y videos de pedidos reales, y más en nuestras redes.', links: [{ label: 'Ver trabajos', href: '/#trabajos' }, { label: 'Instagram', href: 'https://www.instagram.com/nalv.estudio/' }], chips: ['¿Cómo hago un pedido?'] }) },
  { id: 'subir_sticker', kw: [[/(sub[a-z]*|agreg[a-z]*|sum[a-z]*|carg[a-z]*|compart[a-z]*|aport[a-z]*|public[a-z]*|mand[a-z]*|dej[a-z]*|pon[a-z]*).*(sticker|diseno|dibujo|imagen)s?.*(galeria|pagina|web|todos|otros|otras|comunidad|gente|descarg)|que (otros|otras|la gente|todos|cualquiera) (lo |los |las )?(puedan )?(descarguen|descargar|usen|tengan)|quiero (subir|compartir|aportar|sumar|publicar) (un |unos |mis |mi )?(sticker|diseno)|(sumar|aportar) (un |mis )?(sticker|diseno)|compartir (mis|mi) (stickers?|disenos?)|que otros (puedan )?(descarguen|usen|tengan)/, 6]],
    reply: () => ({ text: '¡Dale, sumá tu sticker! 🙌 Tocá el botón, elegí la imagen y aceptá que se publique. Lo revisamos y, si está todo bien, aparece en la **Galería de stickers** para que cualquiera lo baje o lo mande a su plancha. Subí solo diseños tuyos o con permiso: sin marcas, personajes ajenos ni datos personales.', actions: [{ label: '⬆ Subir mi sticker', action: 'sugerir' }], links: [{ label: 'Ver la galería', href: '/stickers.html' }], chips: ['¿Cómo hago un pedido?', '¿Cuánto sale la plancha?'] }) },
  { id: 'galeria', kw: [[/descargar|gratis|stickers? gratis|galeria|catalogo|ya hechos|diseno(s)? (listos|hechos)|no tengo (diseno|imagen)|stickers? (recomendad|disponibles|cargados)|ver (los )?stickers/, 3]],
    reply: (n, ctx) => ctx.galleryCount ? { text: `En la **Galería de stickers** hay **${ctx.galleryCount} diseños** para ver, descargar gratis o mandar directo a tu plancha con "Usar en mi plancha". Y si querés **sumar un sticker tuyo**, decime "quiero subir un sticker".`, links: [{ label: 'Ver la galería', href: '/stickers.html' }], chips: ['Quiero subir un sticker', '¿Cómo hago un pedido?'] } : { text: 'Por ahora no hay stickers cargados en la galería. Si no tenés diseño, escribinos y vemos cómo ayudarte.', links: [WA()], chips: ['¿Cómo hago un pedido?'] } },
  { id: 'cuenta', kw: [[/(crear|abrir|hacer|tener|tengo|necesito|quiero|como (me )?(registro|registrarme)) (una |mi )?cuenta|registr|iniciar sesion|login|olvide.*(contrasena|clave)|contrasena|clave de (mi )?cuenta|mi cuenta|mis pedidos|historial de (pedidos|compras)|ver mis (pedidos|planchas|compras)/, 6]],
    reply: () => ({ text: 'Con una **cuenta** ves todos tus pedidos y planchas en un solo lugar, tus datos de envío quedan guardados y comprás más rápido. Es gratis y **comprar sin cuenta también se puede**. Si te olvidaste la contraseña, en la misma pantalla podés recuperarla.', links: [{ label: 'Crear cuenta / Ingresar', href: '/cuenta.html' }], chips: ['¿Cómo hago un pedido?', '¿Cómo pago?'] }) },
  { id: 'material', kw: [[/material|resistente|agua|dura|duran|vinilo|uv|lavar|lavado|algodon|calidad de la remera|tela|sol|exterior|se despega|adhesivo|pegar|donde se puede pegar/, 3]],
    reply: () => ({ text: 'Los **stickers** son de vinilo impreso con tecnología UV, resistentes al agua. Las **remeras** son de algodón 24/1, buena calidad. Para cuidados de lavado o usos muy específicos, consultanos por WhatsApp y te asesoramos.', links: [WA()], chips: ['Medidas recomendadas', 'Precios de remeras'] }) },
  { id: 'cambios', kw: [[/cambio|devolucion|devolver|reclamo|garantia|error|salio mal|defecto|fallado|reembolso|arrepent|cancelar|cancelacion|modificar (mi )?pedido/, 3]],
    reply: () => ({ text: 'Cada pedido es personalizado, así que cambios, cancelaciones o reclamos los resolvemos **caso por caso**. Escribinos por WhatsApp con tu número de pedido (NALV-xxxx) y lo vemos enseguida.', links: [WA()], chips: ['Hablar con una persona'] }) },
  { id: 'precios_general', block: /\b(auto|casa|celular|iphone|moto|depto|departamento|dolar|pizza|comida)\b(?!.*(sticker|calcoman|plancha|remera))/, kw: [[/precio|precios|cuanto sale|cuanto cuesta|cuanto vale|lista de precios|valores|costo|tarifa/, 2]],
    reply: () => { const min = Math.min(...pricing.GARMENTS.map((g) => g.prices.front[2])); return { text: `**Precios base:**\n• Plancha de stickers 58 × 50 cm: ${money(pricing.SHEET.price)}\n• Sticker suelto: ${money(pricing.SINGLE_PRICE)} por unidad\n• Remera clásica estampada: desde ${money(pricing.GARMENTS[0].prices.front[2])} según cantidad (${money(pricing.GARMENTS[0].prices.front[0])} la unidad)\n¿De cuál querés el detalle?`, chips: ['¿Cuánto sale la plancha?', 'Precios de remeras', 'Sticker suelto'] }; } },
  { id: 'subida', kw: [[/(no (puedo|me deja|logro|anda|carga|sube|funciona)).*(subir|cargar|imagen|archivo|foto|pagina|web|carrito|pedido|pagar|confirmar)|se traba|no carga|no me deja/, 4]],
    reply: () => ({ text: 'Probá con una imagen **PNG, JPG, WEBP o SVG de hasta 10 MB**, recargá la página e intentá de nuevo. Si sigue sin andar, escribinos por WhatsApp y lo resolvemos.', links: [WA()], chips: ['¿Qué formatos aceptan?', 'Hablar con una persona'] }) },
  { id: 'derechos', kw: [[/personaj|escudo|club|equipo de futbol|river|boca|racing|independiente|san lorenzo|pokemon|anime|disney|marvel|marca|licencia|derechos|copyright|catalogo de|stickers de (futbol|anime|dibujos|series|peliculas)/, 3]],
    reply: () => ({ text: 'No tenemos catálogo de personajes, equipos o marcas: imprimimos los diseños que subas vos. Si tu diseño usa marcas o personajes de terceros, asegurate de poder usarlo.', chips: ['¿Cómo hago un pedido?', '¿Qué formatos aceptan?'] }) },
  { id: 'insulto', kw: [[/\b(boludo|pelotudo|idiota|estupido|inutil|basura|mierda|forro|tarado|imbecil|hdp|la puta)\b/, 4]],
    reply: () => ({ text: 'Uh, qué carácter. 😅 Yo estoy para ayudarte con tu pedido: preguntame por precios, medidas, envíos o pagos y te respondo al toque.', chips: ['¿Cuánto sale la plancha?', '¿Cómo hago un pedido?'] }) },
];

// Palabras que indican que la pregunta es de la tienda (si no entendimos la respuesta, mandamos a WhatsApp)
const DOMAIN = /sticker|calcoman|pegatina|plancha|remera|prenda|buzo|musculosa|crop|estamp|diseno|pedido|precio|envio|pago|talle|color|nalv|vinilo|imagen|logo|foto|compra|medida|\bcm\b|entrega|retiro|produccion|pagina|sitio|carrito|checkout|cantidad|descuento|web\b|tienda|negocio|estudio|factura|presupuesto|cuit|\biva\b|stock|disponib|personaliz/;

const OFF_HINT = /clima|llover|pronostico|futbol|partido|mundial|politic|president|receta|bitcoin|dolar|horoscopo|chiste|pelicula|cancion|tarea|matematica|capital de|quien (gano|es|fue)|programar|codigo|\bia\b|chatgpt|inteligencia artificial|noticias|signo|amor|novia|novio|cuanto es \d/;
const OFF_TEXT = 'Eso me excede: yo solo hablo de nalv.estudio (stickers, remeras, precios, envíos, pagos y pedidos). Probá con alguna de estas. 😎';
const SUGGEST_DEFAULT = ['¿Cuánto sale la plancha?', 'Precios de remeras', '¿Hacen envíos?', '¿Cómo pago?', 'Tiempos de producción'];
const SUGGEST_BY_PAGE = {
  remeras: ['Medidas recomendadas para la estampa', 'Talles', 'Colores disponibles', 'Precios de remeras', '¿Y el fondo?'],
  checkout: ['¿Hacen envíos?', '¿Cómo pago?', 'Retiro en local', 'Tiempos de producción'],
};

function answer(message, page, ctx = {}) {
  const raw = String(message || '').slice(0, 300);
  const n = norm(raw);
  if (!n) return { text: 'Escribime tu duda y te respondo. 😉', chips: SUGGEST_BY_PAGE[page] || SUGGEST_DEFAULT };
  const words = n.split(' ').length;
  let best = null, bestScore = 0;
  const STRONG = /sticker|calcoman|remera|plancha|pedido|nalv|prenda|buzo|musculosa|estampa|envio|talle/;
  if (OFF_HINT.test(n) && !STRONG.test(n)) return { intent: 'off_topic', text: OFF_TEXT, chips: SUGGEST_BY_PAGE[page] || SUGGEST_DEFAULT };
  for (const it of INTENTS) {
    if (it.short && words > 6) continue;
    if (it.block && it.block.test(n)) continue;
    let sc = 0;
    for (const [re, w] of it.kw) if (re.test(n)) sc += w;
    if (sc > bestScore) { best = it; bestScore = sc; }
  }
  if (best && bestScore >= 2) return { intent: best.id, ...best.reply(n, ctx) };
  if (DOMAIN.test(n)) {
    return { intent: 'sin_dato', text: 'Ese dato no lo tengo a mano. Para no inventarte nada, escribinos por WhatsApp y te responden enseguida.', links: [WA()], chips: SUGGEST_BY_PAGE[page] || SUGGEST_DEFAULT };
  }
  return { intent: 'off_topic', text: OFF_TEXT, chips: SUGGEST_BY_PAGE[page] || SUGGEST_DEFAULT };
}

module.exports = { answer, BOT_NAME, SUGGEST_DEFAULT, SUGGEST_BY_PAGE };
