import { createWriteStream, unlinkSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, extname, basename } from 'node:path';
import { db, DATA_DIR } from '../db/index.js';
import { makeCode, daysLeft, isBurnt, expiryLabel, validateCode } from '../lib/albums.js';
import { enqueueConversion } from '../lib/uploads.js';
import { checkPassword, issueSession, clearSession, isAuthed, requireAdmin } from '../lib/auth.js';

const slugify = (s) => s.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60) || 'rollo';

const isoIn = (days) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');

export default async function adminRoutes(app) {
  app.post('/api/admin/login', async (req, reply) => {
    if (!checkPassword(req.body?.password)) {
      return reply.code(401).send({ error: 'esa clave no es' });
    }
    issueSession(reply);
    return { ok: true };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get('/api/admin/me', async (req) => ({ authed: isAuthed(req) }));

  /** Todo lo que muestra el panel en una sola vista. */
  app.get('/api/admin/albums', { preHandler: requireAdmin }, async () => {
    const albums = db.prepare('SELECT * FROM albums ORDER BY created_at DESC').all();
    const requests = db.prepare(
      `SELECT r.album_id, a.title, COUNT(*) n FROM reopen_requests r
       JOIN albums a ON a.id = r.album_id GROUP BY r.album_id`
    ).all();

    return {
      albums: albums.map((a) => {
        const counts = db.prepare(
          `SELECT state, COUNT(*) n FROM photos WHERE album_id = ? GROUP BY state`
        ).all(a.id);
        const total = counts.reduce((s, c) => s + c.n, 0);
        const ready = counts.find((c) => c.state === 'ready')?.n ?? 0;
        return {
          id: a.id, title: a.title, code: a.code, slug: a.slug,
          createdAt: a.created_at, expiresAt: a.expires_at,
          isOpen: !!a.is_open, burnt: isBurnt(a),
          daysLeft: daysLeft(a), expiryLabel: expiryLabel(a),
          photoCount: total, readyCount: ready,
          coverId: db.prepare(
            `SELECT id FROM photos WHERE album_id = ? AND state='ready' ORDER BY sort LIMIT 1`
          ).get(a.id)?.id ?? null,
        };
      }),
      requests,
    };
  });

  app.post('/api/admin/albums', { preHandler: requireAdmin }, async (req, reply) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) return reply.code(400).send({ error: 'ponele un nombre al rollo' });
    const days = Number(req.body?.days ?? 14);

    // Código a mano: sirve para recrear un rollo que ya se compartió y que el
    // link viejo siga abriendo. Si no viene, se sortea uno.
    let code;
    const wanted = String(req.body?.code ?? '').trim();
    if (wanted) {
      const checked = validateCode(wanted);
      if (checked.error) return reply.code(400).send({ error: checked.error });
      if (db.prepare('SELECT 1 FROM albums WHERE code = ?').get(checked.code)) {
        return reply.code(409).send({ error: `el código ${checked.code} ya está usado por otro rollo` });
      }
      code = checked.code;
    } else {
      do { code = makeCode(5); }
      while (db.prepare('SELECT 1 FROM albums WHERE code = ?').get(code));
    }

    const r = db.prepare(
      `INSERT INTO albums (title, code, slug, expires_at, is_open) VALUES (?,?,?,?,1)`
    ).run(title, code, slugify(title), days > 0 ? isoIn(days) : null);

    return { id: r.lastInsertRowid, code };
  });

  /** Subida multipart: guarda el original intacto y encola la derivada. */
  app.post('/api/admin/albums/:id/photos', { preHandler: requireAdmin }, async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
    if (!album) return reply.code(404).send({ error: 'no existe ese rollo' });

    const saved = [];
    const failed = [];

    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      if (!part.filename) { part.file.resume(); continue; }

      // Sólo imágenes: un archivo cualquiera rompería la conversión más adelante.
      if (part.mimetype && !part.mimetype.startsWith('image/')) {
        part.file.resume();
        failed.push({ name: part.filename, reason: 'no es una imagen' });
        continue;
      }

      const sort = db.prepare(
        'SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM photos WHERE album_id = ?'
      ).get(album.id).n;

      const row = db.prepare(
        `INSERT INTO photos (album_id, original_path, original_name, sort, state)
         VALUES (?, '', ?, ?, 'uploading')`
      ).run(album.id, part.filename, sort);

      const id = row.lastInsertRowid;
      const dir = join(DATA_DIR, 'originals');
      const dest = join(dir, `${id}${extname(part.filename) || '.jpg'}`);

      try {
        // Barato e idempotente: cubre el caso de que el volumen se monte
        // encima del directorio después de arrancar el proceso.
        mkdirSync(dir, { recursive: true });
        await pipeline(part.file, createWriteStream(dest));
        // Un archivo truncado (o el límite de tamaño) deja basura: no lo dejamos pasar.
        if (part.file.truncated) throw new Error('archivo demasiado grande');

        db.prepare('UPDATE photos SET original_path = ? WHERE id = ?').run(dest, id);
        enqueueConversion(id);
        saved.push({ id, name: part.filename });
      } catch (err) {
        // Sin esto la fila quedaba en 'uploading' para siempre y la cola del
        // panel no terminaba nunca.
        db.prepare('DELETE FROM photos WHERE id = ?').run(id);
        try { unlinkSync(dest); } catch {}
        failed.push({ name: part.filename, reason: String(err?.message ?? err) });
        app.log.warn({ file: part.filename, err: String(err) }, 'falló la subida');
      }
    }

    if (saved.length === 0) {
      return reply.code(400).send({
        error: failed.length
          ? `No pudimos guardar ${failed.length === 1 ? 'esa foto' : 'esas fotos'}`
          : 'no llegó ningún archivo',
        failed,
      });
    }
    return { saved, failed };
  });

  /** Estado de la cola: alimenta la lista de subida del panel. */
  app.get('/api/admin/albums/:id/photos', { preHandler: requireAdmin }, async (req) => {
    const photos = db.prepare(
      `SELECT id, original_path, original_name, bytes, state, sort FROM photos
       WHERE album_id = ? ORDER BY sort DESC LIMIT 40`
    ).all(req.params.id);
    return {
      photos: photos.map((p) => ({
        id: p.id,
        name: p.original_name ?? basename(p.original_path),
        bytes: p.bytes,
        state: p.state,
        preview: p.state === 'ready' ? `/media/${p.id}.webp` : null,
      })),
    };
  });

  /** Vencimiento, apertura y portada. */
  app.patch('/api/admin/albums/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
    if (!album) return reply.code(404).send({ error: 'no existe ese rollo' });

    const { days, expiresAt, isOpen, coverPhotoId, code } = req.body ?? {};

    // Cambiar el código a mano: recupera el link de un rollo que ya se
    // compartió. El viejo deja de funcionar en el mismo momento.
    if (code !== undefined) {
      const checked = validateCode(code);
      if (checked.error) return reply.code(400).send({ error: checked.error });
      if (checked.code !== album.code &&
          db.prepare('SELECT 1 FROM albums WHERE code = ?').get(checked.code)) {
        return reply.code(409).send({ error: `el código ${checked.code} ya está usado por otro rollo` });
      }
      db.prepare('UPDATE albums SET code = ? WHERE id = ?').run(checked.code, album.id);
    }

    if (days !== undefined) {
      db.prepare('UPDATE albums SET expires_at = ?, is_open = 1 WHERE id = ?')
        .run(Number(days) > 0 ? isoIn(Number(days)) : null, album.id);
    } else if (expiresAt !== undefined) {
      db.prepare('UPDATE albums SET expires_at = ?, is_open = 1 WHERE id = ?')
        .run(expiresAt ? String(expiresAt).slice(0, 10) + ' 23:59:59' : null, album.id);
    }
    if (isOpen !== undefined) {
      db.prepare('UPDATE albums SET is_open = ? WHERE id = ?').run(isOpen ? 1 : 0, album.id);
      // Reabrir da por atendidos los pedidos pendientes
      if (isOpen) db.prepare('DELETE FROM reopen_requests WHERE album_id = ?').run(album.id);
    }
    if (coverPhotoId !== undefined) {
      db.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(coverPhotoId, album.id);
    }

    const fresh = db.prepare('SELECT * FROM albums WHERE id = ?').get(album.id);
    return {
      code: fresh.code,
      isOpen: !!fresh.is_open, expiresAt: fresh.expires_at,
      daysLeft: daysLeft(fresh), expiryLabel: expiryLabel(fresh), burnt: isBurnt(fresh),
    };
  });
}
