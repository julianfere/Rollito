import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(here, '..', '..', 'data');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'rollito.sqlite'));
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

export { DATA_DIR };
