// Reglas de dominio del rollo: vencimiento y códigos.
// El vencimiento es lo que decide si el link abre o muestra "se veló".

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; // sin I/L/O/U: se confunden al dictar

export function makeCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function daysLeft(album, now = new Date()) {
  if (!album.expires_at) return null;               // sin vencimiento
  const ms = new Date(album.expires_at + 'Z') - now;
  return Math.max(0, Math.ceil(ms / 86400000));
}

/** Un rollo está velado si lo cerraron a mano o si se pasó la fecha. */
export function isBurnt(album, now = new Date()) {
  if (!album.is_open) return true;
  const left = daysLeft(album, now);
  return left !== null && left <= 0;
}

/** Texto del chip de vencimiento — mismo microcopy que el prototipo. */
export function expiryLabel(album, now = new Date()) {
  if (isBurnt(album, now)) return 'velado';
  const left = daysLeft(album, now);
  return left === null ? 'sin vencimiento' : `se vela en ${left} días`;
}
