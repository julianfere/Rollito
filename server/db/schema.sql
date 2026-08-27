-- Rollito — esquema. Ver "Backend a implementar" en el handoff.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS albums (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  code           TEXT    NOT NULL UNIQUE,   -- código corto público (base32, >=6 en prod)
  slug           TEXT    NOT NULL,
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT,                      -- NULL = sin vencimiento
  is_open        INTEGER NOT NULL DEFAULT 1,
  visibility     TEXT    NOT NULL DEFAULT 'link-only'
                         CHECK (visibility IN ('public','link-only')),
  archived_at    TEXT                       -- cuándo se liberó el espacio del rollo velado
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id      INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  original_path TEXT    NOT NULL,
  original_name TEXT,
  webp_path     TEXT,                       -- NULL mientras se está convirtiendo
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  taken_at      TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  state         TEXT    NOT NULL DEFAULT 'uploading'
                        CHECK (state IN ('uploading','converting','ready'))
);

CREATE TABLE IF NOT EXISTS reopen_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  token      TEXT    NOT NULL UNIQUE,
  photo_ids  TEXT    NOT NULL,              -- JSON array
  quality    TEXT    NOT NULL CHECK (quality IN ('original','lite')),
  path       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT                           -- TTL del artefacto (~24h)
);

CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id, sort);
CREATE INDEX IF NOT EXISTS idx_zips_token   ON zips(token);
