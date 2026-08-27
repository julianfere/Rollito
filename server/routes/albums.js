import { db } from '../db/index.js';
import { isBurnt, daysLeft, expiryLabel } from '../lib/albums.js';
import { notifyReopenRequest } from '../lib/notify.js';

export default async function albumRoutes(app) {
  /** Metadata + previews del rollo. 410 si venció (handoff: "410 si venció"). */
  app.get('/api/r/:code', async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE code = ?')
      .get(req.params.code.toUpperCase());

    if (!album) return reply.code(404).send({ error: 'no existe ese rollo' });

    if (isBurnt(album)) {
      return reply.code(410).send({
        burnt: true,
        title: album.title,
        // el front necesita saber cuántos días estuvo abierto para el copy
        openedDays: album.expires_at ? 14 : null,
      });
    }

    const photos = db.prepare(
      `SELECT id, width, height, bytes, sort FROM photos
       WHERE album_id = ? AND state = 'ready' ORDER BY sort, id`
    ).all(album.id);

    return {
      code: album.code,
      title: album.title,
      createdAt: album.created_at,
      photoCount: photos.length,
      daysLeft: daysLeft(album),
      expiryLabel: expiryLabel(album),
      photos: photos.map(p => ({
        id: p.id,
        w: p.width,
        h: p.height,
        // ?v: el id se reutiliza si la base se recrea, y la respuesta va con
        // Cache-Control immutable. Sin esto el browser sirve del cache la
        // preview que ese id tenía en la base anterior, de otro rollo.
        preview: `/media/${p.id}.webp?v=${p.bytes ?? 0}`,
        original: `/api/photo/${p.id}/original`,
        lite: `/api/photo/${p.id}/lite`,
      })),
    };
  });

  /** Pedido de reapertura. Dispara el aviso al admin. */
  app.post('/api/r/:code/reopen-request', async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE code = ?')
      .get(req.params.code.toUpperCase());
    if (!album) return reply.code(404).send({ error: 'no existe ese rollo' });

    db.prepare('INSERT INTO reopen_requests (album_id) VALUES (?)').run(album.id);
    const pending = db.prepare(
      'SELECT COUNT(*) n FROM reopen_requests WHERE album_id = ?'
    ).get(album.id).n;

    await notifyReopenRequest({ album, pending, log: app.log });
    return { ok: true };
  });

  /** Resolver un código desde la Home: dice si existe y si está velado. */
  app.get('/api/resolve/:code', async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE code = ?')
      .get(String(req.params.code ?? '').toUpperCase());
    if (!album) return reply.code(404).send({ error: 'no encontramos ese rollo' });
    return { code: album.code, title: album.title, burnt: isBurnt(album) };
  });
}
