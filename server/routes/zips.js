import { createReadStream, existsSync, statSync } from 'node:fs';
import { db } from '../db/index.js';
import { isBurnt } from '../lib/albums.js';
import { createZipJob, getJob } from '../lib/zips.js';

export default async function zipRoutes(app) {
  /** Arranca el armado. Devuelve un token para consultar el progreso. */
  app.post('/api/r/:code/zip', async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE code = ?')
      .get(req.params.code.toUpperCase());
    if (!album) return reply.code(404).send({ error: 'no existe ese rollo' });
    if (isBurnt(album)) return reply.code(410).send({ error: 'ese rollo se veló' });

    const { photoIds, quality = 'original' } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'no elegiste ninguna copia' });
    }
    if (!['original', 'lite'].includes(quality)) {
      return reply.code(400).send({ error: 'calidad inválida' });
    }

    // Sólo fotos listas y de ESTE rollo: el cliente manda ids, no le creemos.
    const ids = db.prepare(
      `SELECT id FROM photos
       WHERE album_id = ? AND state = 'ready'
         AND id IN (${photoIds.map(() => '?').join(',')})`
    ).all(album.id, ...photoIds.map(Number)).map(r => r.id);

    if (ids.length === 0) return reply.code(400).send({ error: 'esas copias no están en el rollo' });

    return { token: createZipJob({ albumId: album.id, photoIds: ids, quality }) };
  });

  /** Progreso del job. El front lo consulta cada 400ms. */
  app.get('/api/zip/:token/status', async (req, reply) => {
    const job = getJob(req.params.token);
    if (job) return job;
    // Sin job en memoria pero con fila en base: el server se reinició
    const row = db.prepare('SELECT * FROM zips WHERE token = ?').get(req.params.token);
    if (!row) return reply.code(404).send({ error: 'ese zip ya no existe' });
    if (!existsSync(row.path)) {
      return reply.code(404).send({ error: 'ese zip ya no existe' });
    }
    // bytes real del artefacto: sin esto el front muestra "0,0 MB"
    return { state: 'done', pct: 100, bytes: statSync(row.path).size };
  });

  /** Descarga del artefacto. */
  app.get('/api/zip/:token', async (req, reply) => {
    const row = db.prepare('SELECT * FROM zips WHERE token = ?').get(req.params.token);
    if (!row || !existsSync(row.path)) {
      return reply.code(404).send({ error: 'ese zip ya no existe' });
    }
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(row.album_id);
    const name = (album?.slug ?? 'rollito') + '.zip';
    return reply
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .type('application/zip')
      .send(createReadStream(row.path));
  });
}
