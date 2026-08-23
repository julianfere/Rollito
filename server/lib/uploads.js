// Cola de conversión a WebP. Concurrencia baja a propósito: en una Pi
// no conviene saturar la CPU ni bloquear los requests (handoff).
import sharp from 'sharp';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { db, DATA_DIR } from '../db/index.js';

const CONCURRENCY = 2;
const LONG_EDGE = 1600;
const QUALITY = 72;

const queue = [];
let running = 0;

export function enqueueConversion(photoId) {
  queue.push(photoId);
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift();
    running++;
    convert(id).catch(() => {}).finally(() => { running--; pump(); });
  }
}

async function convert(photoId) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
  if (!photo) return;

  db.prepare(`UPDATE photos SET state = 'converting' WHERE id = ?`).run(photoId);

  const webp = join(DATA_DIR, 'previews', `${photoId}.webp`);
  const info = await sharp(photo.original_path)
    .rotate()                     // respeta el EXIF de orientación
    .resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(webp);

  db.prepare(
    `UPDATE photos SET webp_path = ?, width = ?, height = ?, bytes = ?, state = 'ready'
     WHERE id = ?`
  ).run(webp, info.width, info.height, statSync(photo.original_path).size, photoId);
}

export function queueDepth() {
  return { pending: queue.length, running };
}
