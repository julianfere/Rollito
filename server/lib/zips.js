// Armado de ZIP como job en background con progreso consultable.
// El handoff pide streaming (nada de cargar todo en RAM) y TTL del artefacto.
import archiver from 'archiver';
import { createWriteStream, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { db, DATA_DIR } from '../db/index.js';

const TTL_HOURS = 24;
const LITE_LONG_EDGE = 1600;
const LITE_QUALITY = 72;

/** Progreso en memoria: el artefacto vive en disco, el avance no hace falta persistirlo. */
const jobs = new Map();

export function getJob(token) {
  return jobs.get(token) ?? null;
}

export function createZipJob({ albumId, photoIds, quality }) {
  const token = randomBytes(12).toString('hex');
  const expires = new Date(Date.now() + TTL_HOURS * 3600e3)
    .toISOString().slice(0, 19).replace('T', ' ');
  const path = join(DATA_DIR, 'zips', `${token}.zip`);

  db.prepare(
    `INSERT INTO zips (album_id, token, photo_ids, quality, path, expires_at)
     VALUES (?,?,?,?,?,?)`
  ).run(albumId, token, JSON.stringify(photoIds), quality, path, expires);

  jobs.set(token, { state: 'work', pct: 0, done: 0, total: photoIds.length, bytes: 0 });
  run(token, photoIds, quality, path).catch((err) => {
    jobs.set(token, { state: 'error', pct: 0, error: String(err?.message ?? err) });
  });

  return token;
}

async function run(token, photoIds, quality, outPath) {
  const rows = db.prepare(
    `SELECT * FROM photos WHERE id IN (${photoIds.map(() => '?').join(',')})`
  ).all(...photoIds);

  const out = createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: quality === 'lite' ? 6 : 0 } });
  // level 0 para originales: los JPG ya están comprimidos, recomprimir sólo quema CPU de la Pi
  const closed = new Promise((res, rej) => {
    out.on('close', res);
    out.on('error', rej);
    archive.on('error', rej);
  });
  archive.pipe(out);

  let done = 0;
  for (const p of rows) {
    const name = p.original_name ?? basename(p.original_path);
    if (quality === 'lite') {
      const buf = await sharp(p.original_path)
        .resize(LITE_LONG_EDGE, LITE_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: LITE_QUALITY })
        .toBuffer();
      archive.append(buf, { name: name.replace(extname(name), '.jpg') });
    } else {
      archive.file(p.original_path, { name });
    }
    done++;
    const j = jobs.get(token);
    if (j) jobs.set(token, { ...j, done, pct: Math.round((done / rows.length) * 100) });
  }

  await archive.finalize();
  await closed;

  jobs.set(token, {
    state: 'done', pct: 100, done, total: rows.length,
    bytes: existsSync(outPath) ? statSync(outPath).size : 0,
  });
}

/** Borra artefactos vencidos. Se llama al arrancar y cada hora. */
export function sweepExpiredZips() {
  const stale = db.prepare(`SELECT * FROM zips WHERE expires_at < datetime('now')`).all();
  for (const z of stale) {
    if (z.path && existsSync(z.path)) { try { unlinkSync(z.path); } catch {} }
    db.prepare('DELETE FROM zips WHERE id = ?').run(z.id);
    jobs.delete(z.token);
  }
  return stale.length;
}
