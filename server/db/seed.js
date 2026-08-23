// Seed de desarrollo: crea un rollo con fotos generadas (gradientes cálidos,
// los mismos tonos del prototipo) para poder ver la galería con datos reales.
import sharp from 'sharp';
import { join } from 'node:path';
import { db, DATA_DIR } from './index.js';
import { makeCode } from '../lib/albums.js';

const TONES = [
  ['#6b4a34', '#3a281d'], ['#8a5a38', '#452e1e'], ['#4f4433', '#241f18'],
  ['#7d5f3c', '#3d2c1c'], ['#5c4b3a', '#2b2118'], ['#93643c', '#4a3220'],
  ['#6f5340', '#332619'], ['#4a4a3a', '#22221a'], ['#86513a', '#3f251b'],
  ['#5f4a35', '#2c2118'], ['#7a6141', '#382b1d'], ['#4d3d30', '#251d16'],
];
const SHAPES = [1, 1, 0.75, 1, 1.33, 1, 1, 0.8];
const COUNT = 48;

const svg = (w, h, [a, b], n) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
     <defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
       <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
     </linearGradient></defs>
     <rect width="${w}" height="${h}" fill="url(#g)"/>
     <text x="50%" y="50%" fill="rgba(240,226,212,0.22)" font-size="${Math.round(h / 6)}"
       font-family="Georgia,serif" text-anchor="middle" dominant-baseline="middle"
       >#${String(n).padStart(3, '0')}</text>
   </svg>`);

db.exec('DELETE FROM photos; DELETE FROM albums;');

const expires = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
const code = process.env.SEED_CODE ?? makeCode(5);
const album = db.prepare(
  `INSERT INTO albums (title, code, slug, expires_at, is_open) VALUES (?,?,?,?,1)`
).run('Cumple de Lu', code, 'cumple-de-lu', expires);

const insert = db.prepare(
  `INSERT INTO photos (album_id, original_path, webp_path, width, height, bytes, sort, state)
   VALUES (?,?,?,?,?,?,?,'ready')`);

for (let i = 0; i < COUNT; i++) {
  const ratio = SHAPES[i % SHAPES.length];
  const w = 1600, h = Math.round(1600 / ratio);
  const tone = TONES[i % TONES.length];
  const original = join(DATA_DIR, 'originals', `seed_${i}.jpg`);
  const preview = join(DATA_DIR, 'previews', `seed_${i}.webp`);

  await sharp(svg(w, h, tone, i + 1)).jpeg({ quality: 92 }).toFile(original);
  // derivada: lado largo ~1600, calidad ~72 (handoff)
  const info = await sharp(original).resize(1600, 1600, { fit: 'inside' })
    .webp({ quality: 72 }).toFile(preview);

  insert.run(album.lastInsertRowid, original, preview, info.width, info.height, info.size, i);
}

console.log(`rollo "${'Cumple de Lu'}" · código ${code} · ${COUNT} copias`);
console.log(`abrí  http://localhost:5173/r/${code.toLowerCase()}`);
