// Sesión del admin: único punto con autenticación de la app (handoff).
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'cambiame';
const COOKIE = 'rollito_admin';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const sign = (v) => createHmac('sha256', SECRET).update(v).digest('hex');

export function checkPassword(input) {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(PASSWORD);
  // longitudes distintas => timingSafeEqual tira; comparamos igual para no filtrar el largo
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueSession(reply) {
  const issued = String(Date.now());
  reply.setCookie(COOKIE, `${issued}.${sign(issued)}`, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE,
  });
}

export function clearSession(reply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

export function isAuthed(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return false;
  const [issued, mac] = raw.split('.');
  if (!issued || !mac) return false;
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return false;
  const expected = sign(issued);
  return mac.length === expected.length &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

/** preHandler para las rutas del panel. */
export async function requireAdmin(req, reply) {
  if (!isAuthed(req)) return reply.code(401).send({ error: 'entrá al cuarto oscuro' });
}
