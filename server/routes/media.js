import { createReadStream, existsSync } from 'node:fs';
import sharp from 'sharp';
import { basename } from 'node:path';
import { db } from '../db/index.js';
import { isBurnt } from '../lib/albums.js';
import { regeneratePreview } from '../lib/archive.js';

export default async function mediaRoutes(app) {
  /** Preview WebP. Cache largo: el id es inmutable. */
  app.get('/media/:file', async (req, reply) => {
    const id = Number.parseInt(req.params.file, 10);
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    if (!photo) return reply.code(404).send({ error: 'no está esa copia' });

    let path = photo.webp_path;

    // Rollo reabierto: al archivarlo se borró la derivada. Se regenera acá y
    // no en bloque al reabrir — el rollo abre al instante y sólo se paga por
    // las fotos que alguien realmente mira.
    if (!path || !existsSync(path)) {
      try {
        path = await regeneratePreview(photo);
      } catch (err) {
        req.log.warn({ photo: id, err: String(err) }, 'no se pudo regenerar la preview');
        return reply.code(404).send({ error: 'no está esa copia' });
      }
      if (!path) return reply.code(404).send({ error: 'no está esa copia' });
    }

    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('image/webp')
      .send(createReadStream(path));
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
