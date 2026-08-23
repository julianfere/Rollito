# Rollito

Centro de distribución de fotos self-hosted, pensado para correr en una Raspberry Pi.
El fotógrafo ("el revelador") sube las fotos desde un panel; los amigos entran por link,
eligen las copias que quieren y se las llevan. Sin cuentas, sin Drive.

Implementado a partir del handoff de diseño (`design_handoff_rollito/README.md` en el
proyecto de Claude Design). Los tokens de `web/src/styles/tokens.css` son los valores
finales del handoff: no improvisar colores ahí.

## Stack

- **Backend** — Node + Fastify, SQLite vía `better-sqlite3`
- **Imágenes** — `sharp` (derivada WebP, lado largo ~1600, calidad ~72)
- **Front** — React + Vite, CSS Modules
- **ZIP** — `archiver` (streaming, sin cargar todo en RAM)
- **Sesión del admin** — cookie firmada con HMAC (`@fastify/cookie`)

Un solo proceso sirve API y front compilado: es lo único que hay que levantar en la Pi.

## Arrancar

```bash
npm install
npm run seed     # crea un rollo de prueba con 48 fotos generadas
npm run dev      # Fastify :8087 + Vite :5173
```

El seed imprime el código del rollo. Con `SEED_CODE=4F7K2 npm run seed` lo fijás.

Producción:

```bash
npm run build && npm start   # sirve todo desde :8087
```

> El puerto por defecto es **8087** (el 8080 estaba ocupado en la máquina de desarrollo).
> Se cambia con `PORT`.

## Estructura

```
server/
  index.js          entrypoint; en prod sirve web/dist con fallback SPA
  db/schema.sql     albums · photos · reopen_requests · zips
  db/seed.js        datos de desarrollo (fotos generadas con sharp)
  lib/albums.js     reglas de vencimiento y códigos
  routes/           albums.js (galería, 410 si venció) · media.js (previews, original)
web/public/         favicon (SVG + PNG + .ico) y manifest
web/src/
  styles/tokens.css tokens del handoff — fuente de verdad visual
  components/       PhotoGrid · SelectionBar · Viewer · Toast
  pages/            AlbumPage · BurntScreen
data/               originals/ previews/ zips/ + rollito.sqlite (no versionado)
```

## Configuración

Copiá `.env.example` a `.env` y ajustá:

| Variable | Para qué |
| --- | --- |
| `PORT` | puerto del server (default **8087**) |
| `ADMIN_PASSWORD` | clave del cuarto oscuro — **cambiala** |
| `SESSION_SECRET` | firma de la cookie de sesión |
| `DATA_DIR` | dónde viven originales, previews, zips y la base |
| `NOTIFY_WEBHOOK` | URL que recibe el aviso de reapertura (ntfy, Gotify, Telegram, Slack). Sin esto, el pedido sólo queda en el log |
| `PUBLIC_URL` | base para armar el link del aviso |

## Estado

Las siete pantallas del handoff están implementadas y verificadas en browser
(`node verify.mjs` recorre los flujos de punta a punta):

| Ruta | Pantalla |
| --- | --- |
| `/` | Home: portada, input de código y resolución contra la API |
| `/r/:code` | Galería: grilla, selección, visor y descarga |
| `/r/:code` (vencido) | "Se veló" + pedido de reapertura |
| `/admin` | Panel del revelador |
| `/admin/login` | Login |

- **Galería** — grilla `auto-fill minmax(190px)`, scroll infinito de 24 en 24,
  halo de selección, previews WebP con `loading="lazy"`.
- **Visor** — mide el contenedor y calcula `h = min(boxH, boxW/ratio)` como pide
  el handoff; teclado `←` `→` `Esc`, swipe >48px en táctil.
- **ZIP** — job en background con progreso real, dos calidades (original sin
  recomprimir, liviana re-encodeada con `sharp`), descarga por token y barrido
  por TTL de 24h. Verificado: el artefacto es un zip válido y `lite` pesa ~1/5.
- **Guardar en el teléfono** — en móvil, la acción principal usa la hoja de
  compartir del sistema (Web Share API) en vez del ZIP: «Guardar imágenes» manda
  las copias **directo a la galería**. Ver la sección de abajo.
- **Panel** — dropzone con drag & drop, subida multipart, cola de conversión con
  concurrencia 2, lista de rollos, copiar link, cerrar/reabrir y diálogo de
  vencimiento (presets, fecha exacta, sin vencimiento).
- **Crear rollo** — modal propio (`NewAlbumDialog`) con nombre y vencimiento en
  el mismo paso. La cola de subida muestra **la tanda actual**, no todo el rollo:
  así el contador cierra en «0 en proceso» y aparece el botón para cerrarla.
  Cancelar no deja rollos vacíos, porque el rollo se crea recién al confirmar.
- **Login** — cookie HMAC httpOnly; `/admin` redirige si no hay sesión y vuelve a
  quedar protegido al salir.
- **Vencimiento** — al vencer o cerrar, la API devuelve 410 y el front muestra
  "se veló"; el pedido de reapertura queda en `reopen_requests` y dispara el aviso.
- **Responsive** — breakpoint único en 760px.

## Por qué en el celular no se baja un ZIP

Un ZIP funciona bien en la compu, pero en el teléfono es el formato equivocado:

- **iOS** lo manda a Archivos. Aunque Safari lo descomprima, las fotos quedan en
  una carpeta suelta y **no entran al rollo de cámara**: hay que abrir cada una y
  «Guardar imagen», de a una.
- **Android** lo deja en Descargas, hace falta una app que descomprima y tampoco
  aparecen en la galería.

Y el caso mayoritario es justamente el teléfono: los amigos entran por un link que
les llegó por WhatsApp.

Por eso en móvil la acción principal es **«Guardar en el teléfono»**, que abre la
hoja de compartir del sistema con las copias como archivos JPG. Desde ahí,
«Guardar imágenes» las deja en la galería sin pasar por ningún ZIP. El botón
«Bajar zip» sigue disponible como respaldo, y en escritorio el ZIP sigue siendo
el único camino.

### Detalles de implementación (`web/src/lib/share.js`)

La Web Share API tiene dos trampas que rompen la mayoría de las implementaciones;
las dos están contempladas:

1. **La activación del usuario se consume al llamar `share()`**, de forma
   síncrona. Si se hace `await fetch(...)` de las imágenes dentro del click y la
   red está lenta, la activación vence (~5 s en Chrome, menos en WebKit) y falla
   con `NotAllowedError`. Por eso los archivos se **precargan** al elegir la
   calidad y el botón queda en «Preparando… N %» hasta tenerlos: cuando se toca,
   `share()` se llama sin ningún `await` por delante.
2. **iOS falla o descarta los archivos si se manda `title`/`text`/`url` junto a
   `files`.** El objeto lleva `files` y nada más.

Otros detalles: se detecta por **capacidad + dispositivo táctil**, no por
user-agent — en escritorio la API existe (Chrome/Edge en Windows, Safari en
macOS) pero compartir es peor experiencia que descargar. `AbortError` se trata
como «el usuario cerró la hoja», no como error. Las copias se sirven como **JPG**
(`/api/photo/:id/lite`, lado largo 2048) porque no todos los destinos aceptan
WebP al guardar en Fotos.

**Soporte real:** iOS 15+ (Safari y todo browser en iOS), Android Chrome 76+.
Firefox no lo soporta en ninguna plataforma, y en escritorio sólo hay soporte
parcial — en todos esos casos cae al ZIP automáticamente. **Requiere HTTPS**
(salvo `localhost`): si servís la Pi por HTTP plano en la red local, `navigator.share`
no existe y todos ven el ZIP.

## Lo que falta

- **Notificación**: el webhook está listo pero sin proveedor configurado. Poné
  `NOTIFY_WEBHOOK` apuntando a tu ntfy/Telegram y ya avisa al celular.
- **Progreso de subida real**: la barra del panel muestra el estado
  (`subiendo` / `revelando webp` / `lista`), no el porcentaje byte a byte. Para eso
  falta SSE o `XMLHttpRequest.upload.onprogress`.
- **RAW**: el handoff los menciona; `sharp` no decodifica todos los formatos RAW,
  haría falta `dcraw`/`libraw` para la derivada.
- **Portada elegible**: la API acepta `coverPhotoId` pero el panel todavía usa
  la primera foto.
- **Compartir con muchas copias**: no hay límite especificado en la API, pero la
  hoja de iOS se degrada con muchos archivos. Si se eligen 100+ copias conviene
  el ZIP; hoy no hay un tope explícito.
- **HTTPS en la Pi**: para que «Guardar en el teléfono» funcione en la red local
  hace falta un certificado (mkcert o Tailscale). Sin eso queda sólo el ZIP.
- Self-hostear las fuentes en WOFF2 (en la Pi conviene no depender de Google Fonts).
- Tests automatizados propiamente dichos: hoy la verificación son scripts de humo
  con Playwright, no una suite.
- **Progreso real por archivo** en la subida: la barra refleja el estado
  (`subiendo` / `revelando webp` / `lista`), no el porcentaje de bytes.
