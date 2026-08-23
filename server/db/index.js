import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = process.env.DATA_DIR?.trim();

/**
 * Siempre absoluta. Una ruta relativa depende del directorio de trabajo del
 * proceso: en Docker eso hacía que las subidas fallaran con
 * `ENOENT ... open 'data/originals/3.jpg'` en vez de escribir en /data.
 * `?.trim()` + `||` en vez de `??` para que DATA_DIR="" tampoco pase.
 */
const DATA_DIR = raw ? resolve(raw) : join(here, '..', '..', 'data');

// Los subdirectorios tienen que existir antes de la primera subida: sin esto,
// el createWriteStream del original tira ENOENT aunque DATA_DIR esté bien.
for (const sub of ['', 'originals', 'previews', 'zips']) {
  mkdirSync(join(DATA_DIR, sub), { recursive: true });
}

export const db = new Database(join(DATA_DIR, 'rollito.sqlite'));
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

export { DATA_DIR };
