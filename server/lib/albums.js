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

/**
 * Normaliza un código escrito a mano: mayúsculas y sin separadores, para que
 * "ab-12 cd" y "AB12CD" sean el mismo rollo. Las búsquedas ya hacen
 * toUpperCase(), así que guardar en minúsculas dejaría el link roto.
 */
export function normalizeCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Valida un código propuesto a mano.
 *
 * A diferencia de makeCode(), acá se aceptan I/L/O/U: el alfabeto reducido
 * existe para que un código *sorteado* no se confunda al dictarlo, pero un
 * código a mano suele ser una palabra ("CUMPLELU") o el código de un rollo que
 * ya se compartió. Rechazarlo dejaría a la función sin poder hacer justamente
 * aquello para lo que existe: recuperar un link viejo.
 */
export function validateCode(raw) {
  const code = normalizeCode(raw);
  if (code.length < 4) return { error: 'el código necesita al menos 4 caracteres' };
  if (code.length > 24) return { error: 'el código no puede pasar de 24 caracteres' };
  return { code };
}
