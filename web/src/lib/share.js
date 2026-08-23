// Compartir copias con la hoja nativa del sistema.
//
// Por qué existe esto: en el celular un ZIP es el formato equivocado. En iOS va
// a Archivos y las fotos no entran al rollo de cámara; en Android queda en
// Descargas y hace falta una app que descomprima. Con la Web Share API, en
// cambio, aparece "Guardar imágenes" y van directo a la galería.
//
// El ZIP sigue siendo el camino en escritorio y el respaldo si esto no está.
//
// Dos trampas de la API, ambas respetadas acá:
//
// 1. ACTIVACIÓN DEL USUARIO. `share()` chequea y consume la activación de forma
//    síncrona al ser llamada. Si hacemos `await fetch(...)` de los blobs dentro
//    del click y la red está lenta, la activación expira (~5s en Chrome, menos
//    en WebKit) y tira NotAllowedError. Por eso los archivos se PRECARGAN y el
//    click llama a share() sin ningún await por delante.
//
// 2. SÓLO `files`. En iOS, mandar `title`/`text`/`url` junto a `files` hace que
//    falle o que descarte los archivos. El objeto lleva `files` y nada más.

/**
 * ¿Conviene compartir en vez de descargar?
 *
 * Dos condiciones, no una: que el navegador soporte compartir archivos Y que
 * estemos en un dispositivo táctil. En escritorio la API existe (Chrome y Edge
 * en Windows, Safari en macOS) pero la hoja de compartir es peor experiencia
 * que bajar el archivo: el usuario ya tiene el explorador ahí.
 */
export function canShareFiles() {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;

  // Sin puntero fino y con pantalla chica: es un teléfono o una tablet.
  const touch = typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    matchMedia('(max-width: 1024px)').matches;
  if (!touch) return false;

  try {
    const probe = new File([new Blob(['x'])], 'probe.jpg', { type: 'image/jpeg' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Baja las copias y las deja listas como File[]. Llamar ANTES del click que
 * comparte, no adentro.
 */
export async function loadShareFiles({ photos, quality = 'lite', onProgress, signal }) {
  const files = [];
  let done = 0;

  // En paralelo, pero con la respuesta ordenada: el orden importa al guardar.
  const jobs = photos.map(async (p, i) => {
    const url = quality === 'original' ? p.original : (p.lite ?? p.preview);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('no se pudo bajar la copia ' + p.id);
    const blob = await res.blob();
    done++;
    onProgress?.(Math.round((done / photos.length) * 100));
    // Extensión y tipo reales: iOS los mira para decidir si ofrece "Guardar en Fotos".
    const jpeg = blob.type !== 'image/webp';
    return [i, new File([blob], `rollito-${String(i + 1).padStart(3, '0')}.${jpeg ? 'jpg' : 'webp'}`,
      { type: blob.type || 'image/jpeg' })];
  });

  for (const [i, file] of await Promise.all(jobs)) files[i] = file;
  return files;
}

/**
 * Abre la hoja de compartir con archivos YA cargados.
 * Llamar directo desde el handler del click, sin await por delante.
 *
 * @returns {{ok: boolean, reason?: 'cancelled'|'expired'|'unsupported'|'failed'}}
 */
export async function shareFiles(files) {
  if (!files?.length) return { ok: false, reason: 'failed' };
  if (!navigator.canShare?.({ files })) return { ok: false, reason: 'unsupported' };

  try {
    await navigator.share({ files }); // sólo files: ver nota 2 arriba
    return { ok: true };
  } catch (err) {
    // AbortError = el usuario cerró la hoja. No es un error que haya que mostrar.
    if (err?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
    // Se venció la activación (típico con red lenta): conviene caer al zip.
    if (err?.name === 'NotAllowedError') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Compartir una sola copia. Acá el fetch es uno solo y chico, pero igual
 * puede vencer la activación: si pasa, el llamador cae a la descarga normal.
 */
export async function shareOne(photo, quality = 'original') {
  if (!canShareFiles()) return { ok: false, reason: 'unsupported' };
  try {
    const files = await loadShareFiles({ photos: [photo], quality });
    return await shareFiles(files);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
