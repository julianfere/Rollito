// Archivado de rollos velados: lo que libera espacio en la Pi.
//
// Un rollo velado no se mira ni se descarga (albums.js y media.js cortan con
// 410), así que lo que queda en disco es peso muerto. Al velarlo:
//
//   1. los originales se recomprimen con mozjpeg — NO se reescalan;
//   2. las previews se borran (son caché: se regeneran solas al reabrir);
//   3. los zips del rollo se barren sin esperar el TTL de 24h.
//
// Medido sobre el data/ de desarrollo (90 fotos, 69.1 MB): q92 deja 24.2 MB,
// ahorra 45 MB (65%). q100 *agranda* el archivo un 6% — no usar. Las previews
// eran 1.2 MB en total: el ahorro real está en los originales, no en el caché.
//
// Es DESTRUCTIVO y a propósito: el JPEG de cámara se pierde y no vuelve con
// reopen(). El original de cámara vive en la máquina del fotógrafo; la Pi es
// el centro de distribución, no el archivo maestro.
import sharp from 'sharp';
import { existsSync, statSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { db, DATA_DIR } from '../db/index.js';
import { join, basename } from 'node:path';

const QUALITY = 92;

/** Sólo se recomprime JPEG: recodificar un PNG/HEIC cambiaría el formato del archivo. */
const RECOMPRESSIBLE = new Set(['jpeg']);

/**
 * Recomprime un original en su lugar. Devuelve los bytes ahorrados (0 si no
 * se tocó). Escribe a un temporal y renombra: si el proceso se cae a mitad,
 * el original queda intacto en vez de truncado.
 */
async function shrinkOriginal(photo) {
  const src = photo.original_path;
  if (!src || !existsSync(src)) return 0;

  const before = statSync(src).size;
  const meta = await sharp(src).metadata();
  if (!RECOMPRESSIBLE.has(meta.format)) return 0;

  const tmp = `${src}.shrink`;
  try {
    // Sin rotate() ni resize(): reescribir la orientación EXIF cambiaría cómo
    // se ve la foto en el visor, y el reescalado no es lo que se acordó acá.
    await sharp(src).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(tmp);

    const after = statSync(tmp).size;
    // Un JPEG ya optimizado puede salir más grande: en ese caso no se toca.
    if (after >= before) { unlinkSync(tmp); return 0; }

    renameSync(tmp, src);
    db.prepare('UPDATE photos SET bytes = ? WHERE id = ?').run(after, photo.id);
    return before - after;
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw err;
  }
}

/**
 * Archiva un rollo velado. Idempotente: correrlo dos veces no rompe nada ni
 * vuelve a recomprimir lo ya recomprimido de forma perceptible.
 */
export async function archiveAlbum(albumId, log) {
  const photos = db.prepare('SELECT * FROM photos WHERE album_id = ?').all(albumId);
  let freed = 0;
  let shrunk = 0;
  let previews = 0;

  for (const p of photos) {
    try {
      const saved = await shrinkOriginal(p);
      if (saved > 0) { freed += saved; shrunk++; }
    } catch (err) {
      // Una foto que falla no puede abortar el archivado de las otras 89.
      log?.warn({ photo: p.id, err: String(err) }, 'no se pudo recomprimir el original');
    }

    // La preview es caché reconstruible: se borra siempre, aunque el original
    // no se haya podido recomprimir.
    if (p.webp_path && existsSync(p.webp_path)) {
      try {
        freed += statSync(p.webp_path).size;
        unlinkSync(p.webp_path);
        previews++;
      } catch (err) {
        log?.warn({ photo: p.id, err: String(err) }, 'no se pudo borrar la preview');
      }
    }
    // webp_path a NULL aunque el archivo ya no estuviera: es lo que hace que
    // media.js la regenere on-demand. state queda como está — las grillas
    // filtran por state='ready' y el rollo tiene que seguir listando sus fotos.
    db.prepare('UPDATE photos SET webp_path = NULL WHERE id = ?').run(p.id);
  }

  // Los zips del rollo no esperan el TTL: un zip 'original' pesa como todos
  // los originales juntos y ya nadie lo puede descargar.
  const zips = db.prepare('SELECT * FROM zips WHERE album_id = ?').all(albumId);
  for (const z of zips) {
    if (z.path && existsSync(z.path)) {
      try { freed += statSync(z.path).size; unlinkSync(z.path); } catch {}
    }
    db.prepare('DELETE FROM zips WHERE id = ?').run(z.id);
  }

  db.prepare(`UPDATE albums SET archived_at = datetime('now') WHERE id = ?`).run(albumId);

  const summary = { albumId, shrunk, previews, zips: zips.length, freed };
  log?.info(summary, 'rollo archivado');
  return summary;
}

/**
 * Regenera la preview de una foto a partir del original. La usa media.js
 * cuando llega un pedido y la derivada no está (rollo reabierto).
 *
 * Mismos parámetros que uploads.js: si divergen, una foto se vería distinta
 * según si su preview es la original o una regenerada.
 */
export async function regeneratePreview(photo) {
  if (!photo?.original_path || !existsSync(photo.original_path)) return null;

  const dest = join(DATA_DIR, 'previews', `${photo.id}.webp`);
  const info = await sharp(photo.original_path)
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(dest);

  db.prepare('UPDATE photos SET webp_path = ?, width = ?, height = ? WHERE id = ?')
    .run(dest, info.width, info.height, photo.id);

  return dest;
}

/**
 * Archiva los rollos que ya vencieron y todavía no se archivaron. El
 * vencimiento por fecha no dispara nada por sí solo (isBurnt() se evalúa al
 * leer), así que sin este barredor un rollo vencido nunca liberaría espacio.
 */
export async function sweepBurntAlbums(log) {
  const due = db.prepare(
    `SELECT id FROM albums
     WHERE archived_at IS NULL
       AND (is_open = 0 OR (expires_at IS NOT NULL AND expires_at <= datetime('now')))`
  ).all();

  const results = [];
  for (const a of due) {
    try { results.push(await archiveAlbum(a.id, log)); }
    catch (err) { log?.error({ album: a.id, err: String(err) }, 'falló el archivado'); }
  }
  return results;
}

/**
 * Borra archivos de data/ que ninguna fila referencia.
 *
 * Aparecen cuando una fila se borra sin su archivo: la subida fallida de
 * admin.js hace unlink, pero un rollo eliminado con ON DELETE CASCADE, un
 * seed re-corrido o una caída a mitad de subida dejan el archivo huérfano.
 * En el data/ de desarrollo eran 39 archivos = 67 MB, contra 1.7 MB de fotos
 * vivas: la basura pesaba 40x más que los rollos.
 *
 * dryRun por defecto — esto borra archivos que no están en la base, así que
 * conviene mirar la lista antes de ejecutarlo de verdad.
 */
export function sweepOrphanFiles({ dryRun = true, log } = {}) {
  const referenced = new Set();
  for (const r of db.prepare('SELECT original_path, webp_path FROM photos').all()) {
    if (r.original_path) referenced.add(basename(r.original_path));
    if (r.webp_path) referenced.add(basename(r.webp_path));
  }

  // Archivar pone webp_path a NULL, así que la preview de una foto viva queda
  // sin referencia y por nombre parecería basura. No lo es: es caché válido y
  // borrarla obligaría a regenerarla. El id del archivo la delata.
  for (const p of db.prepare('SELECT id FROM photos').all()) {
    referenced.add(`${p.id}.webp`);
  }
  for (const z of db.prepare('SELECT path FROM zips').all()) {
    if (z.path) referenced.add(basename(z.path));
  }

  const found = [];
  let bytes = 0;
  for (const sub of ['originals', 'previews', 'zips']) {
    const dir = join(DATA_DIR, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;          // .gitkeep
      if (referenced.has(name)) continue;
      const full = join(dir, name);
      let size = 0;
      try { size = statSync(full).size; } catch { continue }
      found.push({ path: full, bytes: size });
      bytes += size;
      if (!dryRun) { try { unlinkSync(full); } catch (err) {
        log?.warn({ file: full, err: String(err) }, 'no se pudo borrar el huérfano');
      } }
    }
  }

  log?.info({ files: found.length, bytes, dryRun }, 'huérfanos');
  return { files: found, count: found.length, bytes, dryRun };
}
