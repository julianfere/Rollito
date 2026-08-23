import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import albumRoutes from './routes/albums.js';
import mediaRoutes from './routes/media.js';
import zipRoutes from './routes/zips.js';
import adminRoutes from './routes/admin.js';
import { sweepExpiredZips } from './lib/zips.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

await app.register(fastifyCookie);
await app.register(fastifyMultipart, {
  limits: { fileSize: 200 * 1024 * 1024, files: 200 }, // RAW pesados
});

// Chequeo de vida: lo usa el HEALTHCHECK del contenedor.
app.get('/api/health', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

await app.register(albumRoutes);
await app.register(mediaRoutes);
await app.register(zipRoutes);
await app.register(adminRoutes);

// En producción el mismo proceso sirve el front compilado (una sola cosa que correr en la Pi).
const dist = join(here, '..', 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/media')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html'); // SPA fallback
  });
}

// TTL de los artefactos: barrer al arrancar y una vez por hora.
sweepExpiredZips();
const sweeper = setInterval(sweepExpiredZips, 3600e3);
sweeper.unref?.();

const port = Number(process.env.PORT ?? 8087);
await app.listen({ port, host: '0.0.0.0' });
