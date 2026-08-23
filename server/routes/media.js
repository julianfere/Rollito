import { createReadStream, existsSync } from 'node:fs';
import sharp from 'sharp';
import { basename } from 'node:path';
import { db } from '../db/index.js';
import { isBurnt } from '../lib/albums.js';

export default async function mediaRoutes(app) {
  /** Preview WebP. Cache largo: el id es inmutable. */
  app.get('/media/:file', async (req, reply) => {
    const id = Number.parseInt(req.params.file, 10);
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    if (!photo?.webp_path || !existsSync(photo.webp_path)) {
      return reply.code(404).send({ error: 'no está esa copia' });
    }
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('image/webp')
      .send(createReadStream(photo.webp_path));
  });

  /**
   * Copia liviana en JPG para compartir desde el celular.
   * El preview es WebP y no todos los destinos lo aceptan al guardar en Fotos,
   * así que para compartir servimos JPG.
   */
  app.get('/api/photo/:id/lite', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo || !existsSync(photo.original_path)) {
      return reply.code(404).send({ error: 'no está esa copia' });
    }
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(photo.album_id);
    if (isBurnt(album)) return reply.code(410).send({ error: 'ese rollo se veló' });

    const buf = await sharp(photo.original_path)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('image/jpeg')
      .send(buf);
  });

  /** Descarga individual en calidad original — respeta el vencimiento del rollo. */
  app.get('/api/photo/:id/original', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo || !existsSync(photo.original_path)) {
      return reply.code(404).send({ error: 'no está esa copia' });
    }
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(photo.album_id);
    if (isBurnt(album)) return reply.code(410).send({ error: 'ese rollo se veló' });

    return reply
      .header('Content-Disposition',
        `attachment; filename="${basename(photo.original_path)}"`)
      .send(createReadStream(photo.original_path));
  });
}
