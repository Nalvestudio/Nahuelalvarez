# nalv.estudio — Plancha de stickers a medida y prendas personalizadas

Sitio completo para vender: cada cliente arma **su propia plancha de 58 × 50 cm** ($18.000).
Sube los diseños que quiera, cada uno con su medida y cantidad, y el sistema los acomoda
automáticamente dejando **0,5 cm entre stickers** y contra el borde. Si no entran todos, suma otra
plancha (también $18.000). Vos administrás todo desde un panel privado.

## Qué incluye

- **Tienda pública** (`/`): el flujo principal es **armar la plancha**. Primero el cliente elige
  dónde va a pegar el sticker (termo, funda de celular, notebook, etc.) y el sitio le **recomienda
  medidas** (editables en `SIZE_GUIDE` de `pricing.js`); después sube el diseño, elige medida y
  cantidad (botones 5/10/25/50/100 y **Llenar la plancha**), lo agrega a la plancha y ve en vivo cómo se acomoda y cuánto espacio usa.
  También hay una pestaña para pedir un **sticker suelto** fuera de la plancha.
- **Checkout** (`/checkout.html`): datos del cliente, retiro o envío, y datos bancarios
  para transferir. Genera un número de pedido y un link directo a WhatsApp para mandar
  el comprobante.
- **Panel de administración** (`/admin.html`): login con usuario/contraseña, listado de
  pedidos con las imágenes subidas por cada cliente, y cambio de estado (pendiente de
  pago → pagado → en producción → listo → entregado).
- **Backend en Node/Express** que guarda los pedidos en un archivo `data/shop.json`
  (sin base de datos aparte, y sin ninguna dependencia que necesite compilarse — por
  eso un `npm install` normal alcanza, incluso en Windows sin Visual Studio) y
  **recalcula el precio en el servidor** al confirmar el pedido (nunca confía en el
  precio que manda el navegador).

## Prendas personalizadas (`/remeras.html`)

Diseñador a **escala real**: la silueta de cada prenda está dibujada con las medidas reales (en cm)
de cada talle, así que el cliente ve cuánto ocupa su diseño. Incluye:

- **6 prendas** con sus tablas de talles: remera básica (XS–XXL), remera talle especial (6–10),
  remera niño (6–16), crop top (S–XL), musculosa (S–XXL) y buzo canguro frisa (S–XXL).
- **7 colores**, **talle en escala**, vista **frente / espalda**.
- **Estampa**: adelante, o adelante y atrás (cada lado con su propio diseño). No se venden prendas lisas.
- El cliente **arrastra** el diseño, lo **agranda** con el punto naranja o con el control de ancho, y
  ve en centímetros el tamaño y a cuántos cm del cuello queda.
- **Quitar fondo** del logo con un clic (tolerancia, elegir color de fondo con el cuentagotas, e incluir
  huecos interiores). Funciona en el navegador, sin servicios externos. Anda muy bien con fondos de un
  solo color; con fotos de fondo complejo no.
- El pedido guarda las imágenes y la ubicación en cm de cada estampa, y el panel admin lo muestra.

**Precios** (de tu lista; editables en el bloque de prendas de `pricing.js`). El escalón depende del total de prendas *estampadas* del pedido: **Minorista 1–10 u., Intermedio 11–14 u., Mayorista 15+ u.** Doble estampa = adelante y atrás (suma $3.000 en remeras y tops, $6.000 en buzos).

| Prenda | Minorista (1 / doble) | Intermedio (1 / doble) | Mayorista (1 / doble) |
|---|---|---|---|
| Remera clásica | $17.000 / $20.000 | $14.000 / $17.000 | $13.000 / $15.000 |
| Remera talle especial | $19.000 / $22.000 | $16.000 / $19.000 | $14.000 / $16.000 |
| Musculosa | $15.000 / $18.000 | $12.500 / $15.500 | $10.000 / $13.000 |
| Crop top | $13.000 / $16.000 | $11.000 / $14.000 | $9.000 / $12.000 |
| Buzo canguro | $38.000 / $44.000 | $33.000 / $39.000 | $30.000 / $36.000 |
| Remera niño | $13.600 / $16.600 | $11.200 / $14.200 | $10.400 / $13.400 |

> ⚠️ **Valores que tu lista no traía:**
> - **Remera niño:** no está en tu lista; la calculé como 20% menos que la clásica (`PRECIO_NINO_MULT` = 0.8) más $3.000 por doble estampa. Pasame los reales si querés.
> - En la lista, el mayorista del talle especial decía "$14.00 / $16.00": lo tomé como $14.000 / $16.000.

Los costos de tu lista están en `PRENDA_COSTOS` solo como referencia interna: no se muestran ni se envían al navegador.

## Envíos a todo el país (Correo Argentino)

En el checkout el cliente elige **retiro en local** (gratis) o **envío a todo el país por Correo Argentino**, a domicilio o a sucursal (más barato). Para el envío completa provincia, localidad, código postal, DNI de quien recibe y la dirección (o la sucursal). El costo se calcula en el servidor según la **provincia** (3 zonas) y el **peso estimado** del paquete (prendas + planchas + embalaje) y se suma al total. En el panel de administración cada pedido muestra los datos listos para cargar la etiqueta en Mi Correo (destinatario, DNI, dirección o sucursal, localidad, CP, teléfono) y el envío cobrado. El aviso por mail también los trae.

> ⚠️ **Las tarifas son una estimación.** Salen de las tarifas de lista del servicio Clásico de MiCorreo publicadas por terceros (1, 5 y 10 kg para tres zonas; el resto se interpola) y las provincias están agrupadas por distancia a Buenos Aires. Correo Argentino las actualiza seguido y con convenio (Paq.ar / emprendedores) pagás menos. Para ajustarlas: editá `TARIFAS`, `PROVINCES` y los pesos en `shipping.js` (ya incluyen un margen de seguridad: remera ≈ 0,30 kg, buzo ≈ 0,85 kg, embalaje 0,30 kg), o usá `SHIPPING_ADJUST_PCT` en el `.env` (ej. `-15` = 15% menos). Compará con el cotizador de Mi Correo antes de vender. Si envías de más o de menos, la diferencia es tuya.

## Trabajos realizados (Instagram y TikTok)

La tienda tiene una sección **Trabajos realizados** con botones a [Instagram @nalv.estudio](https://www.instagram.com/nalv.estudio/) y [TikTok @nalv.estudio](https://www.tiktok.com/@nalv.estudio). Desde acá no pude ver el contenido de esas cuentas (piden iniciar sesión), así que la galería arranca vacía y la llenás vos de dos maneras:

- **Fotos y videos propios:** copiá los archivos (JPG, PNG, WEBP, GIF, MP4 o WEBM) a `public/trabajos/`. Aparecen solos; el nombre del archivo es el texto que se ve (`01-Termo personalizado.jpg` → "Termo personalizado"). Se ordenan por nombre. Lo más prolijo: descargá tus propios videos de Instagram/TikTok y subilos acá.
- **Publicaciones de las redes:** pegá los links de cada publicación en `public/trabajos/_trabajos.json`, por ejemplo `{"instagram": ["https://www.instagram.com/p/XXXX/"], "tiktok": ["https://www.tiktok.com/@nalv.estudio/video/123456"]}`. Se muestran con un botón "Ver publicación" y recién ahí se cargan los scripts de Instagram/TikTok, para que la página no se ponga lenta.

No hace falta reiniciar el servidor.

**Ya cargados:** 64 fotos y 8 videos tuyos (optimizados y sin sonido) en `public/trabajos/`. En la tienda se muestran en orden aleatorio, de a 12 con botón "Ver más", y las fotos se agrandan al tocarlas. Para quitar una, borrá el archivo.

### Videos de fondo de la portada

Los videos de `public/fondo/` (7 clips de hasta 9 segundos, sin sonido) se reproducen de fondo en la portada, uno tras otro con fundido y en orden distinto en cada visita. Agregá o borrá archivos MP4 o WEBM de esa carpeta y listo. Se pausan cuando no se ven, y no se cargan si la persona tiene activado "reducir movimiento" o ahorro de datos. Conviene que cada clip pese menos de 1 MB (480–540 px de ancho alcanza, porque está detrás de un velo claro).

> Las fotos muestran a clientes reales y algunas estampas son de personajes o marcas de terceros: asegurate de tener permiso de las personas que aparecen y de poder mostrar esos diseños.

## 1. Requisitos

- Node.js 18 o superior.
- Nada más — ninguna dependencia del proyecto necesita compilarse, así que `npm install`
  funciona en Windows, Mac o Linux sin instalar Visual Studio ni Build Tools.
  (El paquete `sharp`, que se usa para procesar las imágenes que suben los clientes,
  trae binarios ya compilados para Windows/Mac/Linux, así que tampoco debería pedir
  compilar nada; si en tu máquina llegara a fallar, avisame y lo cambiamos por una
  alternativa 100% JavaScript.)

## 2. Instalación local

```bash
npm install
cp .env.example .env
```

Abrí `.env` y completá:

- `ADMIN_USER` / `ADMIN_PASSWORD`: para entrar a `/admin.html`.
- `BANK_ALIAS`, `BANK_CVU`, `BANK_HOLDER`: lo que se le muestra al cliente para transferir (ya vienen cargados con los datos de nalv.estudio).
- `WHATSAPP_NUMBER`: tu número con código de país, sin espacios ni `+` (ya cargado: `5492215730729`).
- `ORDER_EMAIL`, `SMTP_USER`, `SMTP_PASS`: **aviso por mail de cada pedido**, con el detalle y los diseños adjuntos. Para que el sitio pueda enviarlo necesita una contraseña de aplicación de Gmail: activá la verificación en 2 pasos en tu cuenta de Google, entrá a https://myaccount.google.com/apppasswords, creá una y pegala en `SMTP_PASS` (sin espacios). No uses tu contraseña normal. Si lo dejás vacío, todo funciona igual y los pedidos se ven en `/admin.html`.
- `STORE_NAME`: el nombre que aparece en el pie de página y el título de las pestañas.
- `SESSION_SECRET`: cualquier texto largo y random (para las cookies de sesión del admin).

Arrancar:

```bash
npm start
```

Y abrir `http://localhost:3000`.

## 3. Ajustar precios y tamaños

Todo el cálculo de precios vive en **`pricing.js`**, con comentarios en español. Ahí podés
cambiar:

- `SINGLE_PRICE`: precio por unidad del **sticker suelto** (hoy **$800**, de cualquier tamaño y sin descuento por cantidad, porque con pocas unidades sale más caro de producir). Para volumen conviene la plancha.
- `SHEET`: precio, medidas y separación (`gapCm`, hoy 0,5 cm) de la plancha de 58×50 cm.
- `MIN_CM` / `MAX_CM`: el rango que permite la regla (por defecto 2 a 15cm).

El precio de las prendas está en `GARMENTS` del mismo archivo.

## 4. Poner el sitio en producción (online, con dominio propio)

La forma más simple es un servicio que corra Node de forma persistente. Dos opciones
gratis/económicas y sencillas para este proyecto:

### Opción A — Render.com (recomendada, tiene plan gratis)

1. Subí esta carpeta a un repositorio de GitHub.
2. En Render: **New → Web Service**, conectá el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. En la sección **Environment**, cargá las mismas variables que tenés en `.env`.
5. **Importante:** agregá un "Persistent Disk" (Render lo ofrece en el plan pago) montado
   en `/opt/render/project/src/data` y otro en `.../uploads`, para que los pedidos y las
   imágenes no se borren cada vez que Render reinicia el servicio. En el plan gratis el
   disco no es persistente — para vender en serio conviene el plan más económico con disco,
   o migrar a Opción B.

### Opción B — un VPS chico (DigitalOcean, Hetzner, etc.)

1. Instalá Node 18+ en el servidor.
2. Subí el proyecto (git clone o scp).
3. `npm install && npm start`, y usá [pm2](https://pm2.keymetrics.io/) para que quede
   corriendo siempre: `npx pm2 start server.js --name stickers`.
4. Poné [Nginx](https://nginx.org/) delante como proxy reverso hacia el puerto 3000 y
   activá HTTPS gratis con [Certbot](https://certbot.eff.org/).

### Dominio

El sitio ya está rebrandeado como **nalv.estudio**. Comprá el dominio donde prefieras y
apuntalo al servicio elegido (Render te da instrucciones de DNS; en un VPS apuntás el
registro A a la IP del servidor).

> ⚠️ Ojo: al buscar "nalv.estudio" no encontré evidencia de que `.estudio` exista como
> extensión de dominio registrable (sí existen `.studio` y `.study`, en inglés). Antes de
> imprimir tarjetas o invertir en marca, verificá en un buscador de dominios (NIC.ar,
> Namecheap, etc.) si `.estudio` está disponible o si te conviene `nalv.studio`,
> `nalv.com.ar` o `nalvestudio.com` como alternativa real.

## 5. Pasar a Mercado Pago más adelante

Hoy el pago es manual (transferencia + comprobante por WhatsApp). El día que quieras cobro
automático, se integra con **Mercado Pago Checkout Pro**: se crea una "preferencia de pago"
desde `server.js` en el mismo lugar donde hoy se guarda el pedido, y Mercado Pago te
redirige a una pantalla de pago ya armada. Avisame cuando quieras dar ese paso y lo
armamos — la base (pedidos, precios, panel admin) ya queda lista para conectarlo.

## 6. Estructura del proyecto

```
server.js            → servidor Express y endpoints de la API
pricing.js           → reglas de precio de stickers, planchas y prendas (única fuente de verdad)
db.js                → guarda/lee los pedidos en data/shop.json (sin dependencias nativas)
data/shop.json        → "base de datos" en JSON (se crea sola al arrancar)
uploads/              → imágenes que suben los clientes
public/
  index.html          → tienda / configurador de stickers y planchas
  remeras.html        → diseñador de remeras
  js/remeras.js       → lógica del diseñador
  js/cart-ui.js       → carrito (drawer) compartido
  img/nalv-logo.png   → logo
  checkout.html        → checkout
  admin.html            → panel de pedidos
  css/style.css        → estilos
  js/app.js            → lógica del configurador
  js/cart.js           → carrito (localStorage)
  js/checkout.js        → lógica del checkout
```

## 7. Seguridad — antes de vender de verdad

- Cambiá `ADMIN_PASSWORD` y `SESSION_SECRET` por valores propios (no dejes los de ejemplo).
- Serví el sitio con HTTPS (Render lo da gratis; en un VPS usá Certbot).
- Hacé backups periódicos de `data/shop.json` y de la carpeta `uploads/`.

## Armar la plancha (flujo del cliente)

El cliente sube sus imágenes (una o varias juntas), elige la cantidad y cada diseño **se acomoda solo** en la plancha, sin pedir nombre. En la lista de la derecha puede cambiar cantidad y ancho de cada diseño, quitarlo, o **recortarlo** (arrastrando los bordes) para que entren más. Al subir, se recortan solos los márgenes transparentes (o blancos si es un JPG) del dibujo. La separación entre stickers es `gapCm` en `pricing.js` (ahora **0,5 cm**; subila si tu corte necesita más).

## Stickers para descargar (galería)

En la web aparece la sección **“Stickers para descargar”** (con botón *Descargar* y *Usar en mi plancha*) apenas cargues el primer sticker; hasta entonces queda oculta. Se maneja desde `/admin.html`, abajo de los pedidos:

- **Subir los tuyos:** elegí la imagen, ponele nombre y tildá que es tuya o tenés derecho a compartirla.
- **Diseños de clientes:** en el checkout hay un casillero opcional *“Permito que nalv.estudio publique mis diseños…”*. Si lo tildan, ese pedido muestra un botón **Publicar** en cada sticker. **Nada se publica solo**: lo revisás y lo aprobás vos uno por uno (fijate que no tenga personajes/marcas ajenas, caras de terceros ni datos personales).
- **Sacar:** botón *Sacar* en la galería del panel. Los archivos se guardan en `data/galeria/` (hacé backup junto con `data/shop.json`).

> Importante: bajar una imagen de Pinterest o Google *no* te da derecho a revenderla ni a republicarla; la mayoría son de terceros o personajes con marca. Publicá solo lo que sea tuyo, de dominio público o con licencia que lo permita.

## Numeración de pedidos y archivos en buena calidad

- **Pedidos numerados:** cada pedido recibe un número correlativo **NALV-0001, NALV-0002…** (el cliente lo ve al confirmar y lo usa para mandar el comprobante). En `/admin.html` están ordenados del más nuevo al más viejo y podés **buscar por número, nombre o teléfono** y filtrar por estado.
- **Se guarda el original:** mientras el cliente arma el pedido, el navegador sube en segundo plano el archivo **original** (hasta 12 MB); la vista previa usa una versión liviana, pero lo que queda guardado en el pedido es el original.
- **Archivo "listo para imprimir":** por cada diseño el sistema genera un PNG aplicando el **recorte y el quitar fondo sobre el original a resolución completa** y, si la imagen es chica para la medida que se imprime, la **agranda hasta ~300 dpi** (reescalado de alta calidad + leve afilado, hasta 4×). Esto suaviza bordes y evita el efecto "escalonado", pero **no inventa detalle**: una imagen muy chica sigue siendo chica. Por eso cada archivo muestra su **calidad real** (excelente / buena / media / baja con los dpi), y el cliente recibe un aviso si su imagen es chica para el tamaño elegido. Los SVG se rasterizan en el navegador (≈1000–1200 px).
- **Panel:** cada archivo tiene miniatura nítida, botón para **verlo en grande** (sobre fondo cuadriculado, blanco, negro o del color de la prenda), **⬇ Imprimir** y **⬇ Original**, y cada pedido tiene **⬇ Todo el pedido (.zip)** con carpetas por plancha/prendas, nombres descriptivos (talle, color, medidas, cantidad) y un `pedido.txt` resumen.
- **Privacidad:** las imágenes de los clientes (`/uploads`) solo se ven con la sesión de administrador. Los originales sin pedido se borran solos a los 14 días.
- Hacé backup de la carpeta `uploads/` junto con `data/shop.json`: ahora guarda más (original + imprimir + miniatura de cada diseño).

## Medidas recomendadas en el diseñador de remeras

Al subir el diseño aparecen botones de un toque que ponen **ancho + ubicación** en la prenda. Adelante (suele ser chico): *Logo en el pecho* ≈ 8 cm (lado izquierdo de quien la usa), *Chico* ≈ 12 cm, *Mediano* ≈ 20 cm, *Grande* ≈ 28 cm. Espalda: *Logo bajo el cuello* ≈ 10 cm, *Mediano* ≈ 25 cm, *Grande* ≈ 32 cm, *Espalda completa* ≈ 38 cm. Las medidas se ajustan al talle/prenda y solo se ofrecen las que entran. Cada botón muestra **ancho × largo** (el largo sale de la proporción de tu imagen). Para cambiarlas editá `REC` en `public/js/remeras.js`.

**Margen vacío:** al subir, el marco del diseño se ajusta solo al dibujo (se sacan los márgenes transparentes o blancos), así la medida en cm es la del dibujo y puede llegar justo al borde de la guía. Hay un casillero "Ajustar el marco al dibujo" para desactivarlo. El archivo de impresión también sale recortado.

## Bot de ayuda: "TONY"

Botón flotante abajo a la derecha (en la home, en Prendas y en el checkout). Responde **solo sobre la tienda**: precios de plancha / stickers sueltos / cada prenda, descuentos por cantidad, medidas recomendadas, talles, colores, fondo y recorte, formatos y calidad, tiempos de producción, envíos (con costo estimado si nombran una provincia), retiro, pagos (alias/CVU), cómo hacer un pedido, contacto. Lo que no es de la tienda lo rechaza con humor ("Eso me excede…") y lo que es de la tienda pero no sabe lo manda a tu WhatsApp, sin inventar.

- **Siempre actualizado:** los precios, costos de envío y datos de pago los toma de `pricing.js`, `shipping.js` y tu `.env`; si cambiás un precio, el bot ya contesta el nuevo.
- **Gratis y sin servicios externos:** son reglas, no usa IA de pago. Es predecible, pero solo entiende las preguntas que tiene cargadas; las respuestas y palabras clave están en `bot.js` (lista `INTENTS`). Para cambiarle el nombre editá `BOT_NAME` en `bot.js` y los textos de `public/js/bot.js`.
- No ve pedidos individuales (privacidad): para el estado de un pedido manda a tu WhatsApp con el número NALV-xxxx.


## Local y ubicación

Somos de **La Plata**: el local está en calle 45 e/ 145 y 146. Esa dirección la usa el bot TONY (preguntas como "¿de dónde son?", "¿dónde queda?", "retiro") y el aviso de retiro del checkout. Se cambia con `LOCAL_ADDRESS` y `LOCAL_CITY` en `.env`.

## Subir muchos stickers a la galería (carga masiva)

Panel de admin → "Galería de stickers para descargar" → **Subir muchos juntos**. Tildá que tenés derecho a compartirlos y elegí:
- **Elegir archivos**: seleccioná todos juntos (Ctrl+A dentro de la carpeta).
- **Elegir carpeta**: sube la carpeta entera.
- **Subir un .zip**: un ZIP con las imágenes (hasta 300 MB y 1000 imágenes; si tu hosting limita el tamaño de subida, usá carpeta, que va de a 10).

Se aceptan PNG, JPG y WEBP (hasta 15 MB c/u). El nombre del archivo pasa a ser el nombre del sticker (`mate-argentino.png` → "Mate argentino"); después podés **renombrar** o **sacar** cada uno. Los repetidos se detectan y se saltean, así que si se corta la subida podés repetirla sin duplicar. En la web hay buscador por nombre. Cada sticker se guarda en PNG (hasta 1200 px) más una miniatura liviana para que la galería cargue rápido.


## Cuentas de clientes (`/cuenta.html`)

Los clientes pueden **crear una cuenta** (nombre, email, contraseña) o seguir comprando sin cuenta. Con cuenta ven **Mis pedidos** (cada pedido con sus planchas, medidas, cantidades, miniaturas, estado y descarga de su archivo), guardan su dirección de envío y el checkout les precarga los datos. Pueden cambiar la contraseña, **borrar su cuenta** (los pedidos quedan sin vínculo, para la contabilidad) y elegir si reciben promos.
- Las contraseñas se guardan con scrypt (nunca en texto plano) y las sesiones duran 30 días (se guardan en `data/sessions.json`, así no se pierden al reiniciar).
- **Olvidé mi contraseña**: manda un link por mail si configuraste `SMTP_USER`/`SMTP_PASS`. Si no, en el panel → *Clientes y promos* → "Generar clave temporal" y se la pasás al cliente.
- Solo se vinculan a la cuenta los pedidos hechos **con la sesión iniciada**.
- Poné `PUBLIC_URL=https://tudominio.com` en `.env` para que los links de los mails (recuperar clave, baja de promos) usen tu dominio.

## Panel de admin: métricas, gastos, clientes y promos

`/admin.html` ahora tiene pestañas:
- **Pedidos**: lo de siempre.
- **Métricas y gastos**: pedidos del mes, **facturado** del mes, **gastos**, **ganancia** (facturado − gastos), ticket promedio, pendiente de cobro, totales y un gráfico + tabla de los **últimos 12 meses** (con planchas, stickers sueltos y prendas vendidas). "Facturado" cuenta los pedidos con pago confirmado (pagado / en producción / listo / entregado, envío incluido); los pendientes de pago no suman hasta que los marques como pagados y los cancelados no cuentan. Los **gastos los cargás vos** (fecha, concepto, categoría, monto) en la misma pestaña; cargá también lo que pagás al Correo para que la ganancia sea real.
- **Clientes y promos**: lista de clientes (de pedidos y cuentas) con pedidos, cuánto gastaron y si **aceptaron recibir promos**. Exportá **CSV**. Para **mail**: asunto + mensaje (con `{nombre}`), botón de prueba a tu casilla y envío a quienes aceptaron (necesita SMTP configurado). Para **WhatsApp**: armás el texto y tocás el botón de cada cliente, que abre el chat con el mensaje listo (WhatsApp no permite el envío masivo automático).
  - Por ley (Ley 25.326 de protección de datos y normas de comunicaciones comerciales) solo se contacta a quien lo **aceptó**: hay una casilla opcional en el checkout y al crear la cuenta. Cada mail incluye link de **baja** (`/baja`) y el cliente queda excluido al instante.
  - Gmail personal permite unos 500 mails por día; el envío va despacio a propósito.
- **Galería**: ahora también muestra los **stickers sugeridos por la gente** para aprobar o rechazar.

## Stickers que suben los clientes (bot y galería)

TONY entiende "quiero subir un sticker" y abre una ventanita (también está el botón "Sumá tu sticker" en la galería de la home). La persona elige la imagen, le pone nombre y **acepta que se publique**. El sticker queda **pendiente**: en el panel (Galería) aparece un aviso para **aprobarlo o rechazarlo** (o "Aprobar todos"). No se publica nada solo: así no aparecen marcas, personajes ajenos, fotos de personas ni contenido ofensivo con el nombre de tu estudio. Hay un límite de subidas por persona y se descartan los repetidos.

Variables nuevas en `.env`: `PUBLIC_URL`, `LOCAL_ADDRESS`, `LOCAL_CITY` (ver `.env.example`).


## Stickers recomendados (subida manual desde el panel)

Panel de admin → pestaña **Stickers y galería**. Ahí subís vos los stickers que querés mostrar a tus clientes: de a uno (con nombre) o **muchos juntos** (archivos, carpeta o .zip). Tildando **⭐ Recomendado** (al subir, o con el botón "⭐ Recomendar" de cada sticker) aparecen **arriba de todo** en la sección "Recomendados por NALV" de la home, antes del resto de la galería. Cada sticker tiene botones para descargarlo o mandarlo directo a la plancha. TONY también lo menciona cuando le preguntan qué stickers recomendamos. Podés renombrar, sacar o quitar la estrella en cualquier momento y filtrar por "Solo recomendados".

Subí solo diseños propios o con permiso/licencia de uso: marcas, personajes, clubes, artistas y fotos de personas tienen dueño y publicarlos o venderlos puede traerte reclamos.


## Probarla en tu computadora

1. Instalá **Node.js** (versión LTS) desde https://nodejs.org (una sola vez).
2. Descomprimí el .zip en una carpeta (por ejemplo `C:\nalv`).
3. **Windows:** doble clic en **`INICIAR-WINDOWS.bat`**. **Mac / Linux:** abrí una terminal en la carpeta y escribí `sh iniciar.sh`.
4. La primera vez instala lo necesario (unos minutos) y abre la tienda en http://localhost:3000. El panel de administrador está en http://localhost:3000/admin.html (usuario `admin`, clave `cambiaesta123`, que está en el archivo `.env`; cambiala cuando publiques).
5. Para apagarla, cerrá la ventana negra. Para volver a prenderla, doble clic otra vez.

Lo que cargues (stickers, planchas, pedidos de prueba) se guarda en la carpeta `nalv-datos` de tu usuario, así que no se pierde al reemplazar archivos. Los mails de promos y avisos no salen hasta que conectes tu Gmail en el panel (Clientes y promos).


## Si "no puede leer la imagen" o falla la carga de stickers

Al iniciar, la ventana negra muestra `Procesador de imágenes: OK`. Si en cambio dice que **sharp NO funciona**, cerrá la ventana, borrá la carpeta `node_modules` y volvé a abrir `INICIAR-WINDOWS.bat` (necesitás Node.js 18 o más nuevo, versión LTS). En el panel se aceptan PNG, JPG, WEBP (también GIF, TIFF, AVIF, HEIC) de hasta 80 MB cada una, de a muchas, en carpeta o en .zip; si alguna falla, el panel muestra el motivo exacto junto al nombre del archivo.


## Si "desaparecieron" stickers o planchas (faltan imágenes)
Tus datos (nombres, precios, categorías, pedidos) se guardan en `shop.json`; las imágenes están en carpetas aparte dentro de la carpeta de datos (`galeria`, `planchas`, `planchas-archivos`, `uploads`). Si el sitio se abre desde otra carpeta, las imágenes pueden haber quedado en la carpeta de una versión anterior y el sitio no las encuentra (por eso se ocultan, **no se borran**). Al arrancar, el sitio busca solo las imágenes que faltan en la carpeta del sitio, en sus carpetas vecinas, en Escritorio, Descargas, Documentos y OneDrive, y las **copia** a su lugar (nunca borra ni mueve nada). También podés hacerlo a mano: panel → *Stickers y galería* → **🔎 Buscar mis archivos en esta computadora**. Si no las encuentra, conviene volver a subirlas.

## Si en el navegador ves una versión vieja (o las miniaturas siguen rotas)
Casi siempre es porque la tienda anterior sigue abierta en **otra ventana negra** y la nueva no puede arrancar (usa el mismo puerto 3000). `INICIAR-WINDOWS.bat` ahora la cierra sola y, si no puede, la ventana te lo avisa. Para confirmar que ves la versión nueva, mirá al pie de la web: aparece el número de versión (ej. `v2026.10.13-d`); en la ventana negra también se muestra al arrancar. Si no coincide, cerrá todas las ventanas negras (o reiniciá la PC) y abrí de nuevo `INICIAR-WINDOWS.bat`.

## Si una miniatura de sticker aparece rota (ícono de imagen con el nombre)
El sitio se repara solo: al encenderlo revisa todos los stickers, rehace las miniaturas que falten o estén dañadas y busca los archivos si quedaron en otra carpeta. En la ventana negra vas a ver una línea como `Galería: 286 stickers · 280 bien · 6 miniaturas rehechas`. Si dice **SIN ARCHIVO**, esos stickers no tienen su imagen en la carpeta de datos (la web ya los oculta): en el panel → *Ajustes* → **Revisar y reparar** podés quitarlos y volver a subirlos. La carpeta de datos es la que muestra la línea `Tus datos … se guardan en:` y las imágenes están en su subcarpeta `galeria`.

## Categorías de stickers y acceso de administrador
- **Categorías:** la galería (`/stickers.html`) y la carpeta del armador agrupan los stickers por tema (🇦🇷 Argentina y fútbol, 🧉 Mates, 🎵 Música, 🐱 Animales, 🎬 Series/pelis/dibujos, ⭐ Famosos, 🎉 Fiestas, 😂 Memes y frases). Cada sticker nuevo se clasifica solo por su nombre; los de la primera carga ya vienen revisados. En el panel → *Stickers y galería* podés cambiarle la categoría a uno (menú debajo de cada sticker), **elegir varios y moverlos juntos**, o crear una categoría nueva (“➕ Otra categoría…”). Lo que cambies a mano no se pisa. El botón **🗂 Ordenar por categorías** corrige nombres raros (como “As#U00ed”) y reclasifica los que no tocaste.
- **Entrar como administrador:** desde la web, “Acceso administrador” (al pie) o directo `/admin.html`. Usuario = `ADMIN_USER` del `.env` (si no lo cambiaste: `admin`) y clave = `ADMIN_PASSWORD`. También sirve entrar con tu mail del negocio (`ORDER_EMAIL`) y la clave de admin, incluso desde el “Ingresar” de clientes: te lleva al panel.

## Publicar la web (para que funcione ya)

Necesitás un hosting que **guarde los datos en un disco persistente** (si no, cada actualización borra stickers, pedidos y clientes). La opción más rápida es **Render** (el archivo `render.yaml` ya viene preparado):

1. Creá una cuenta en **GitHub** y un repositorio **privado**; subí el contenido de esta carpeta (el `.gitignore` ya excluye `.env`, `data/` y `uploads/`, que nunca se suben).
2. En **render.com** → *New* → **Blueprint** → elegí ese repositorio. Render lee `render.yaml`, crea el servicio (plan **Starter**) y un **Disk de 5 GB** montado en `/var/data`.
3. Render te pide los datos que no se guardan en el código: `ADMIN_USER`, **`ADMIN_PASSWORD` (una clave propia y larga)**, `PUBLIC_URL`, `BANK_ALIAS`, `BANK_CVU`, `BANK_HOLDER`, `WHATSAPP_NUMBER`, `ORDER_EMAIL`. `SESSION_SECRET` se genera solo. Mientras `ADMIN_PASSWORD` no esté configurada, el panel queda bloqueado a propósito.
4. Cuando termine, entrás a la dirección que te da Render (`https://…onrender.com`), al panel `/admin.html`, conectás el mail en *Clientes y promos* y cargás stickers y planchas.
5. **Dominio propio** (ej. un .com.ar en NIC Argentina): en Render → *Settings → Custom Domains* agregás el dominio y copiás los registros DNS que te indica; el https es automático. Después actualizá `PUBLIC_URL`.

Para actualizar el sitio: subís los archivos nuevos al repositorio y Render lo vuelve a publicar solo; **los datos del disco no se tocan**. Igual, descargá la copia de seguridad del panel antes de cada actualización.

El botón "✨ Archivo DTF (IA)" necesita memoria: en el plan Starter (512 MB) puede quedar justo con imágenes grandes; si falla, subí de plan o usá "⬇ Imprimir".

Alternativas con disco persistente: Railway (plan Hobby + Volume) o un VPS propio. El código funciona igual en cualquiera: solo hay que apuntar `DATA_DIR` al disco.


## 📁 Carpeta de stickers y planchas (en el armador de la home)

Justo debajo de "Subí tu diseño" aparece la **Carpeta de stickers y planchas**, con pestañas **⭐ Recomendados**, **Todos los stickers** y **Planchas armadas**, cada uno con su nombre y un buscador. Un toque en **+ Sumar** manda el sticker a la plancha del cliente (como si lo hubiera subido), **⬇** lo descarga, y en las planchas armadas **Al carrito** la agrega con su precio. La carpeta no se muestra hasta que cargues algo. Lo que aparece lo cargás vos desde el panel: *Stickers y galería* (con nombre y ⭐ para recomendados) y *Planchas armadas* (con nombre, cantidad de stickers y precio).


## Galería de stickers (página /stickers.html)

Link **Galería** en el menú de la home (la sección "Inspiración" ya no está en la home). Es una página aparte donde se ven **todos** los stickers cargados (se van mostrando a medida que se baja, sin botones de "ver más"), con buscador. Los ⭐ recomendados salen primero. Cada sticker tiene **Descargar** (PNG) y **Usar en mi plancha** (lo abre en el armador de la home). Los stickers los cargás vos desde el panel → *Stickers y galería* (de a uno o en lote) y los que sugiere la gente aparecen cuando los aprobás. TONY también manda a la galería cuando le preguntan por stickers para descargar.


## Conectar el mail desde el panel (promos, avisos de pedidos, recuperar clave)

No hace falta tocar el `.env`: en **Panel → Clientes y promos → "1 · Conectar tu mail"** elegís Gmail (u Outlook / Yahoo / otro), escribís tu mail y pegás la **contraseña de aplicación**, y tocás "Guardar y probar". El sitio verifica la conexión y, si está bien, queda **conectado**. La contraseña se guarda cifrada en `data/mail-config.json` (no se vuelve a mostrar) y podés **cambiarla o desconectarla** cuando quieras.

Para Gmail necesitás la **contraseña de aplicación** (no la normal): activá la verificación en 2 pasos en tu cuenta de Google y creala en https://myaccount.google.com/apppasswords. Si preferís el `.env`, `SMTP_USER` / `SMTP_PASS` siguen funcionando; lo que cargues en el panel tiene prioridad.

Una vez conectado: "2 · Mandar una promo por mail" envía a todos los que aceptaron recibir promos (con botón de prueba a tu casilla), y los avisos de cada pedido nuevo y la recuperación de contraseña de los clientes también salen por ahí.

**WhatsApp** (paso 3): WhatsApp no deja mandar mensajes masivos automáticos desde una web (eso requiere la API de pago de WhatsApp Business). El panel arma el mensaje con el nombre de cada cliente: tocás **"▶ Abrir el siguiente"** y se abre el chat con el texto listo; enviás y volvés a tocar. Va marcando quién ya abriste ("✓ Enviado") y "Empezar de nuevo" reinicia la campaña.


## Archivo DTF con IA (para imprimir las remeras)

En Pedidos, cada estampa de una prenda (frente / espalda) tiene el botón **✨ Archivo DTF (IA)**. Al tocarlo, el sitio arma un **PNG con fondo transparente, a la medida exacta en cm que eligió el cliente y a 300 dpi**, y lo descarga solo cuando está listo (queda guardado, la próxima vez es inmediato). Si la imagen original es chica para esa medida, la **agranda con una IA de super-resolución (Real-ESRGAN)** que corre en tu propio servidor, sin servicios externos ni costo por uso: tarda de unos 15 segundos a un par de minutos según el tamaño, y no traba la web mientras trabaja. Si la imagen ya tiene calidad suficiente, solo la deja a la medida y 300 dpi.

Importante: la IA mejora bordes, nitidez y suaviza el "pixelado", pero **no puede inventar el detalle que la imagen no tiene**. Con imágenes muy chicas (el panel las marca como calidad "baja") el resultado mejora mucho, pero puede verse algo "pintado"; lo ideal es pedirle al cliente un archivo más grande. El botón común "⬇ Imprimir" sigue estando.

Modelo incluido en `models/` (Real-ESRGAN, licencia BSD-3, ver `models/LICENSE.txt`). Funciona con `npm install` normal (usa WebAssembly: no descarga programas nativos). Conviene un servidor con al menos 1 GB de memoria libre.


## Planchas armadas (a la venta)

Panel → pestaña **Planchas armadas**: subís la imagen de una plancha ya armada, el nombre, **cuántos stickers trae** y el **precio** (al escribir la cantidad, el precio se completa solo con "precio por sticker × cantidad"; lo podés cambiar). Aparece en la home en la sección "Planchas armadas" (y en el menú) con botón **Agregar al carrito**; la sección no se muestra hasta que cargues la primera. En cada pedido te queda la plancha con el botón **⬇ Imprimir** que baja tu archivo original. Podés editar precio y cantidad, pausar la venta o sacarla (los pedidos ya hechos conservan el archivo). Todo se guarda en `nalv-datos` y entra en la copia de seguridad.

Cargá solo diseños propios o con licencia: personajes, marcas, clubes y equipos tienen dueño y venderlos puede traerte reclamos.


## Excel de control (pedidos, gastos y facturación por mes)

Panel → **Métricas y gastos** → botón **⬇ Descargar Excel**. Trae 3 hojas: **Resumen mensual** (pedidos, cobrado por transferencia, cobrado en efectivo, total facturado, gastos, ganancia y pendiente de cobro; son fórmulas, si corregís algo en Excel se recalcula), **Pedidos** (todos, con cliente, estado, forma de cobro y totales) y **Gastos**.

Para que separe transferencia y efectivo, en cada pedido (pestaña Pedidos) elegí **Cobro: transferencia / efectivo** cuando te pagan. Si un pedido pagado no tiene forma de cobro, aparece como "Sin definir". La tabla "Mes a mes" del panel también muestra esa separación.


## Que no se pierdan los stickers, pedidos, métricas y clientes (IMPORTANTE)

**Desde esta versión los datos se guardan solos FUERA de la carpeta del sitio**, en la carpeta `nalv-datos` dentro de tu usuario (ej. `C:\Users\Carlos\nalv-datos`, `/home/carlos/nalv-datos`). Ahí quedan pedidos, métricas, gastos, clientes, cuentas, stickers, fotos de los pedidos y el mail conectado. Por eso podés **reemplazar, actualizar o borrar la carpeta del sitio** y todo sigue ahí.

- La primera vez que arranque, el sitio **copia** lo que ya tenías en `data/` y `uploads/` a `nalv-datos` (no borra nada). Al iniciar, la consola muestra `💾 Tus datos se guardan en: …`.
- Para usar otra ubicación (por ejemplo el **disco persistente** de tu hosting), poné `DATA_DIR=` en el `.env` (ej. `DATA_DIR=/var/data/nalv` en Render con un Disk montado en `/var/data`).
- **Si el sitio está en un hosting gratuito sin disco persistente** (Render free, etc.), cada actualización borra TODO lo que no esté en un disco persistente: hace falta contratar el disco (Render: Disks), usar un VPS o tu propia PC. No se puede evitar desde el código.
- **Copia de seguridad**: Panel → pestaña **Copia de seguridad** → descargar un .zip con todo (y **Restaurar** con otro botón). Además, cada día se guarda sola una copia de pedidos y clientes en `nalv-datos/backups` (las últimas 30). Descargá una copia antes de cada actualización y guardala en otro lado (Drive, pendrive).
- **Cómo actualizar sin riesgo**: 1) descargá la copia de seguridad; 2) reemplazá los archivos del sitio por los nuevos (no hace falta copiar `data/` ni `uploads/`); 3) `npm install` y arrancá. Conservá tu `.env`.

## Stickers libres incluidos + armado automático de planchas

**Stickers argentinos incluidos (~275) — ya vienen cargados.** En `packs-libres/stickers-libres.zip` hay stickers hechos por nalv.estudio: **97 memes con jerga argentina**, **151 frases** y **dibujos de cosas nuestras** (mate, termo, asado, choripán, empanada, medialuna, alfajor, dulce de leche, fernet con coca, colectivo, Obelisco, Sol de Mayo, escarapela, bandera, camiseta albiceleste, copa, hornero, ceibo, sombrero gaucho, bandoneón, guitarra, truco, mapa de Argentina y de las Malvinas). Al abrir el sitio por primera vez se agregan solos, separados en categorías. Si ya tenías la versión anterior, la primera vez también se sacan los 1.271 emojis y banderas genéricos que traía (solo esos). Para recargarlos: **/admin.html → Stickers y galería → “Cargar stickers argentinos”** (no duplica). Licencias en `packs-libres/LICENCIAS-LIBRES.txt`.

**Carpetas = categorías.** Al subir un .zip (o una carpeta entera con “Elegir carpeta”) con el tilde “Usar las carpetas como categorías”, cada subcarpeta pasa a ser una categoría. Así podés cargar los stickers de tu amigo Tint o los tuyos ya ordenados: `MisStickers/Mates/...`, `MisStickers/Boca/...`.

**Planchas automáticas.** **/admin.html → Planchas armadas → “Armar planchas automáticas”**: elegís una categoría, cuántos stickers por plancha y el precio, y el sitio acomoda solo los stickers en planchas de 58 × 50 cm a 300 dpi, listas para imprimir (el archivo grande queda guardado para el pedido). Aparecen en “Planchas armadas” de la web.

**Armador del cliente.** En la home, “Armá tus stickers”: el cliente elige la plancha de 58 × 50, suma stickers de la carpeta (o sube los suyos), ve la medida recomendada de cada uno, y cambia cantidad, ancho y alto.

**Importante:** stickers de marcas, series, clubes o famosos (Disney, Simpsons, Messi, Boca, etc.) tienen dueño. Cargalos solo si tenés permiso; el sitio te pide confirmarlo con un tilde.

**Si faltan imágenes de tus stickers** (aviso “SIN ARCHIVO” en la ventana negra o cartel amarillo en el panel): volvé a subir tu .zip o carpeta de stickers desde el panel. Los stickers ya cargados recuperan su imagen y conservan nombre y categoría; no se duplican.

## Carpeta automática: arrastrás y se sube sola

Dentro de tu carpeta de datos (en Windows: `C:\Users\TU-USUARIO\nalv-datos\stickers-nuevos`) hay una carpeta que el sitio mira cada 15 segundos. Todo lo que copies ahí (imágenes sueltas, carpetas o .zip) se sube solo a la galería de la web.
- **Subcarpetas = categorías:** `stickers-nuevos\Boca\…` crea la categoría "Boca".
- Lo ya subido se mueve a `_cargados`; lo que no se pudo leer queda en `_con-problemas`. No se borra nada.
- El sitio tiene que estar abierto (la ventana negra de `INICIAR-WINDOWS.bat`).
- Se abre desde el panel: **Stickers y galería → “Abrir la carpeta”**. Con “Subir ahora lo que haya” no esperás los 15 segundos.
- Al poner archivos ahí confirmás que tenés derecho a publicarlos (propios, libres o con permiso).

## Subir muchos stickers a la vez
- **Panel → Stickers y galería:** el panel "Subir muchos juntos" va primero. Elegí varios archivos (Ctrl+A en la carpeta), una carpeta o un .zip, o **arrastralos** al panel. El formulario de abajo también acepta varios archivos a la vez. La casilla de permiso queda recordada.
- **Carpeta automática** (`nalv-datos\stickers-nuevos`): copiás y se suben solos.
- **Botón "Sumá tu sticker" de la web:** la gente puede elegir hasta 40 imágenes juntas; quedan en la cola de aprobación.

## Pedidos: qué te llega y cómo se guardan (versión 2026.10.15-b)

**Qué recibís en cada pedido** (Panel → Pedidos):
- **📋 Para producir:** resumen de un vistazo (stickers sueltos, planchas 58×50 y cuántos stickers llevan, prendas a estampar).
- **La plancha armada tal como la armó el cliente:** cada plancha completa de **58 × 50 cm a 300 dpi** (6850 × 5906 px) con todos los diseños ya acomodados, lista para imprimir. Se ve en miniatura, se abre en grande y se descarga con un clic. Si pidió más de una plancha, aparece cada una.
- **Los diseños por separado:** cada diseño con **⬇ Imprimir** (recorte/fondo aplicados, ~300 dpi) y **⬇ Original** (tal cual lo subió el cliente). Lo mismo para cada remera/buzo (frente y espalda).
- **La maqueta de cada prenda:** la remera con la estampa donde la ubicó el cliente (para controlar la posición al estampar).
- **⬇ Todo el pedido (.zip):** trae todo lo anterior ordenado por carpetas + `pedido.txt`.

**Cómo se guardan:** además de la base (`shop.json`) con copia diaria, **cada pedido se guarda también en su propia carpeta legible**: `<tus datos>/pedidos/NALV-0001_Nombre/` con `pedido.txt` (resumen), `pedido.json` (todos los datos) y `archivos/` (cada diseño, listo para imprimir y original). Se crea sola al entrar el pedido, se actualiza al cambiar el estado o la nota, y al arrancar el sitio completa las carpetas que falten. Desde el panel podés abrir esa carpeta (cuando el sitio corre en tu PC). **El panel no tiene ningún botón para borrar pedidos.** La copia completa (pedidos + imágenes) está en la pestaña **Copia de seguridad**.

**Control de pedidos:** contadores por estado (tocá uno para filtrar), buscador (número, nombre, teléfono, mail), filtro por fechas, estado + forma de cobro, **nota interna** por pedido, **historial de estados** con fecha y hora, botones de **WhatsApp y mail** al cliente, **⬇ Excel** con todo, aviso (globito naranja) con los pedidos pendientes de pago, y el listado se actualiza solo cada minuto.

**Seguimiento para el cliente:** `/seguimiento.html` — con el número de pedido y su teléfono ve el estado (esperando pago, pago recibido, en producción, listo, entregado). Aparece al confirmar el pedido y en el pie de la web.
