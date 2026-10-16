// Subida en tandas chicas. Una sola request con 100 RAW pesa gigas, no deja
// mostrar progreso por archivo y si se corta a mitad se pierde todo. Partida
// en tandas, cada una es independiente y se puede reintentar sola.

export const MAX_FILES = 100;
const CHUNK_FILES = 5;
const CHUNK_BYTES = 25 * 1024 * 1024;

/** Agrupa respetando el orden: corta por cantidad o por peso, lo que llegue primero. */
export function chunk(items) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= CHUNK_FILES || bytes + it.size > CHUNK_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * POST de una tanda. XHR y no fetch: fetch no informa el progreso de subida.
 * Resuelve con { status, body } y rechaza si se cae la red o se aborta.
 */
export function sendChunk(url, items, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    items.forEach((it) => fd.append(it.key, it.file, it.name));

    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response ?? {} });
    xhr.onerror = () => reject(new Error('se cortó la conexión'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}
