import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast.jsx';
import ExpiryDialog from '../components/ExpiryDialog.jsx';
import NewAlbumDialog from '../components/NewAlbumDialog.jsx';
import useToast from '../lib/useToast.js';
import { MAX_FILES, chunk, sendChunk } from '../lib/upload.js';
import styles from './AdminPage.module.css';

const mb = (b) => (b == null ? '—' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const eta = (s) => (s < 60 ? `~${Math.max(5, Math.round(s / 5) * 5)} s` : `~${Math.round(s / 60)} min`);
const pct = (n, d) => `${d ? (n / d) * 100 : 0}%`;

// Estados de cada foto de la tanda. Los primeros los pone el panel; desde
// 'uploading' en adelante vienen del server ('uploading' ahí = en cola de revelado).
const STATE_LABEL = {
  waiting: 'en espera', sending: 'subiendo', uploading: 'en cola',
  converting: 'revelando', ready: 'lista', failed: 'falló', canceled: 'cancelada',
};
const PLURAL = { ready: 'listas', failed: 'fallaron', canceled: 'canceladas' };
const SENT = new Set(['uploading', 'converting', 'ready']);
let seq = 0;

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);       // fotos de la tanda en curso
  const [target, setTarget] = useState(null);   // rollo al que se sube
  const [expiry, setExpiry] = useState(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(null); // archivos esperando nombre de rollo
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const fileInput = useRef(null);
  const abortRef = useRef(null);
  const rate = useRef(null);                    // { t0, b0 } para estimar cuánto falta
  const nav = useNavigate();

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/albums');
    if (r.status === 401) { nav('/admin/login'); return; }
    setData(await r.json());
  }, [nav]);

  useEffect(() => { load(); }, [load]);

  /** Aplica `patch` (objeto o función del item) a los items cuyas claves están en `keys`. */
  const update = useCallback((keys, patch) => {
    setItems((list) => list.map((it) => (keys.has(it.key)
      ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) }
      : it)));
  }, []);

  // `load` cambia `data` en cada llamada y con eso su identidad; si estuviera en
  // las dependencias de los efectos de abajo, cada refresco reiniciaría el
  // intervalo y la cola nunca terminaba de estabilizarse.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Ids ya guardados que todavía no terminaron de revelarse. Como string para
  // que el efecto sólo se reinicie cuando cambia el conjunto, no en cada render.
  const pendingIds = items
    .filter((it) => it.id && it.status !== 'ready')
    .map((it) => it.id).join(',');

  // Seguimos la conversión de lo que ya llegó, mientras siguen subiendo las demás.
  useEffect(() => {
    if (!target || !pendingIds) return;
    let alive = true;
    const tick = async () => {
      const r = await fetch(`/api/admin/albums/${target}/photos?ids=${pendingIds}`).catch(() => null);
      if (!alive || !r?.ok) return;
      const { photos } = await r.json();
      if (!alive) return;
      const byId = new Map(photos.map((p) => [p.id, p]));
      setItems((list) => list.map((it) => {
        const p = it.id && byId.get(it.id);
        return p && p.state !== it.status ? { ...it, status: p.state, preview: p.preview } : it;
      }));
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => { alive = false; clearInterval(timer); };
  }, [target, pendingIds]);

  // Todo revelado: refrescamos los rollos para que aparezcan conteo y portada.
  const settled = items.length > 0 && !busy && !pendingIds;
  useEffect(() => { if (settled) loadRef.current(); }, [settled]);

  /**
   * Sube los items al rollo indicado, de a tandas y en orden (una a la vez:
   * el cuello es el upload de la conexión, y así el orden del rollo respeta el
   * elegido). El id llega por parámetro a propósito: leer `target` del estado
   * acá no servía, porque después de crear un rollo `setTarget()` todavía no
   * se reflejó y las fotos se subían al rollo equivocado (o a ninguno).
   */
  const run = useCallback(async (albumId, todo) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setTarget(albumId);
    rate.current = null;
    const url = `/api/admin/albums/${albumId}/photos`;
    let ok = 0;
    let bad = 0;

    for (const group of chunk(todo)) {
      if (ctrl.signal.aborted) break;
      const keys = new Set(group.map((it) => it.key));
      const total = group.reduce((n, it) => n + it.size, 0);
      update(keys, { status: 'sending', sent: 0, error: null });

      // El progreso es de la request entera: lo repartimos en orden entre los
      // archivos, que es como viajan dentro del multipart.
      const onProgress = (ratio) => {
        const sentBy = new Map();
        let left = ratio * total;
        for (const it of group) {
          sentBy.set(it.key, Math.min(it.size, Math.max(0, left)));
          left -= it.size;
        }
        update(keys, (it) => ({ sent: sentBy.get(it.key) }));
      };

      // Un corte de red o un 5xx se reintenta una vez; un 4xx no tiene arreglo.
      let res = null;
      let error = 'se cortó la conexión';
      for (let attempt = 0; attempt < 2 && !res && !ctrl.signal.aborted; attempt++) {
        if (attempt) { await wait(1500); update(keys, { sent: 0 }); }
        try {
          const r = await sendChunk(url, group, { onProgress, signal: ctrl.signal });
          if (r.status >= 500) error = r.body?.error ?? `el server respondió ${r.status}`;
          else res = r;
        } catch (err) {
          if (err.name !== 'AbortError') error = err.message;
        }
      }
      if (ctrl.signal.aborted) break;
      if (res?.status === 401) { nav('/admin/login'); return; }

      const byKey = new Map();
      for (const p of res?.body?.saved ?? []) byKey.set(p.key, { status: 'uploading', id: p.id });
      for (const p of res?.body?.failed ?? []) byKey.set(p.key, { status: 'failed', error: p.reason });
      const fallback = { status: 'failed', error: res?.body?.error ?? error };
      for (const it of group) {
        if (byKey.get(it.key)?.status === 'uploading') ok++;
        else bad++;
      }
      update(keys, (it) => {
        const r = byKey.get(it.key) ?? fallback;
        return { ...r, sent: r.status === 'uploading' ? it.size : 0 };
      });
    }

    const canceled = ctrl.signal.aborted;
    if (canceled) {
      setItems((list) => list.map((it) => (it.status === 'waiting' || it.status === 'sending'
        ? { ...it, status: 'canceled', sent: 0 } : it)));
    }
    abortRef.current = null;
    setBusy(false);
    say(canceled
      ? `Subida cancelada · ${ok} ${ok === 1 ? 'llegó' : 'llegaron'}`
      : bad
        ? `${ok} en el cuarto oscuro · ${bad} no se pudo${bad === 1 ? '' : 'ieron'} subir`
        : `${ok} ${ok === 1 ? 'foto' : 'fotos'} en el cuarto oscuro`);
    loadRef.current();
  }, [update, say, nav]);

  /** Arma la tanda nueva y la sube. Más de MAX_FILES se recortan, avisando. */
  const uploadTo = useCallback((albumId, files) => {
    let list = [...files];
    if (!list.length) return;
    if (list.length > MAX_FILES) {
      say(`Van las primeras ${MAX_FILES} de ${list.length}: subí el resto en otra tanda`);
      list = list.slice(0, MAX_FILES);
    }
    const fresh = list.map((file) => ({
      key: `f${++seq}`, file, name: file.name, size: file.size,
      status: 'waiting', sent: 0, id: null, preview: null, error: null,
    }));
    setItems(fresh);
    return run(albumId, fresh);
  }, [run, say]);

  /** Vuelve a mandar las que fallaron o se cancelaron, al mismo rollo. */
  const retry = useCallback(() => {
    const again = items.filter((it) => it.status === 'failed' || it.status === 'canceled');
    if (!again.length || !target) return;
    update(new Set(again.map((it) => it.key)), { status: 'waiting', sent: 0, error: null });
    run(target, again);
  }, [items, target, update, run]);

  /** Elegir archivos: si ya hay un rollo activo van ahí; si no, pedimos nombre. */
  const pick = useCallback((files) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    // Una tanda a la vez: mezclar dos haría imposible seguir cuál es cuál.
    if (busy) { say('Esperá a que termine esta tanda'); return; }
    if (target) uploadTo(target, list);
    else setPending(list);
  }, [busy, target, uploadTo, say]);

  /** Crea el rollo y recién ahí sube: si la creación falla, no queda rollo vacío. */
  const createAndUpload = useCallback(async ({ title, days, code }) => {
    const files = pending;
    try {
      const r = await fetch('/api/admin/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, days, code }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: body.error ?? 'No pudimos crear el rollo.' };

      setPending(null);
      say(`Rollo «${title}» creado · código ${body.code}`);
      await uploadTo(body.id, files);
      return { ok: true };
    } catch {
      return { ok: false, error: 'No pudimos crear el rollo.' };
    }
  }, [pending, say, uploadTo]);

  const patch = async (id, body, msg) => {
    const r = await fetch(`/api/admin/albums/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // El error se avisa: cambiar el código puede chocar con otro rollo (409) y
    // en silencio parecía que el cambio se había aplicado.
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      say(err.error ?? 'No pudimos guardar el cambio');
      return false;
    }
    say(msg);
    load();
    return true;
  };

  /** Cambiar el código a mano: recupera el link de un rollo ya compartido. */
  const editCode = async (a) => {
    const raw = window.prompt(
      `Código de «${a.title}».

Es lo que forma el link: ${location.host}/r/CODIGO
` +
      'Poné el de un rollo que ya compartiste para que ese link vuelva a abrir.',
      a.code
    );
    if (raw === null) return;
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || code === a.code) return;
    await patch(a.id, { code }, `El link de ${a.title} ahora es /r/${code.toLowerCase()}`);
  };

  if (!data) return <div className={styles.center} />;

  const count = (st) => items.filter((it) => it.status === st).length;
  const ready = count('ready');
  const failed = count('failed') + count('canceled');
  const arrived = items.filter((it) => SENT.has(it.status)).length;
  const totalBytes = items.reduce((n, it) => n + it.size, 0);
  const sentBytes = items.reduce((n, it) => n + (SENT.has(it.status) ? it.size : it.sent), 0);
  const targetTitle = data.albums.find((a) => a.id === target)?.title ?? null;

  // Cuánto falta de subida, con la velocidad promedio desde que arrancó la tanda.
  let left = null;
  if (busy) {
    const now = Date.now();
    if (!rate.current) rate.current = { t0: now, b0: sentBytes };
    const secs = (now - rate.current.t0) / 1000;
    const speed = (sentBytes - rate.current.b0) / secs;
    const pendingBytes = items.reduce((n, it) =>
      n + (it.status === 'waiting' || it.status === 'sending' ? it.size - it.sent : 0), 0);
    if (secs > 3 && speed > 0) left = eta(pendingBytes / speed);
  }

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div className={styles.brand}>
          <span className={styles.light} aria-hidden="true" />
          <span className={styles.wordmark}>Rollito</span>
        </div>
        <span className={`mono ${styles.chip}`}>cuarto oscuro</span>
        <span className={styles.who}>El revelador</span>
        <button
          className={styles.secondary}
          onClick={async () => {
            await fetch('/api/admin/logout', { method: 'POST' });
            nav('/admin/login');
          }}
        >
          Salir
        </button>
      </header>

      {data.requests?.map((rq) => (
        <div key={rq.album_id} className={styles.requests}>
          <span className={styles.bell} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
          </span>
          <span className={styles.requestText}>
            {rq.n} {rq.n === 1 ? 'amigo pidió' : 'amigos pidieron'} que revelés «{rq.title}» de nuevo
          </span>
          <button
            className={styles.reopen}
            onClick={() => patch(
              rq.album_id,
              { days: 7, isOpen: true },
              `«${rq.title}» está abierto 7 días más`
            )}
          >
            Revelar 7 días más
          </button>
        </div>
      ))}

      <h2 className={styles.section}>Revelar un rollo nuevo</h2>

      <div
        className={`${styles.dropzone} ${drag ? styles.dragging : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
      >
        <div className={styles.dropIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v13" />
            <polyline points="7 8 12 3 17 8" />
            <path d="M5 21h14" />
          </svg>
        </div>
        <h3 className={styles.dropTitle}>Soltá las fotos acá</h3>
        <p className={styles.dropNote}>
          JPG o RAW. De cada una guardo el original y saco una copia liviana en WebP para el preview.
        </p>
        <button
          className={styles.primary}
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {busy ? 'Subiendo…' : 'Elegir del disco'}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; pick(f); }}
        />
      </div>

      {items.length > 0 && (
        <div className={styles.queue}>
          <div className={styles.queueHead}>
            <div className={styles.queueText}>
              <span className={`mono ${styles.queueTitle}`}>
                {busy
                  ? `Subiendo ${arrived} de ${items.length}`
                  : pendingIds
                    ? `Revelando ${ready} de ${arrived}`
                    : `${ready} ${ready === 1 ? 'foto revelada' : 'fotos reveladas'}`}
                {targetTitle ? ` · «${targetTitle}»` : ''}
              </span>
              <span className={`mono ${styles.queueSub}`}>
                {mb(sentBytes)} de {mb(totalBytes)}
                {left ? ` · falta ${left}` : ''}
                {failed > 0 && <span className={styles.bad}> · {failed} sin subir</span>}
              </span>
            </div>
            <div className={styles.queueActions}>
              {busy && (
                <button className={styles.closeQueue} onClick={() => abortRef.current?.abort()}>
                  Cancelar
                </button>
              )}
              {!busy && failed > 0 && (
                <button className={styles.closeQueue} onClick={retry}>
                  Reintentar {failed}
                </button>
              )}
              {!busy && !pendingIds && (
                <button
                  className={styles.closeQueue}
                  onClick={() => { setItems([]); setTarget(null); }}
                >
                  Listo
                </button>
              )}
            </div>
          </div>

          {/* Dos capas: lo subido (naranja) y, encima, lo ya revelado (verde). */}
          <div className={styles.total} role="progressbar" aria-label="Fotos reveladas"
            aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={ready}>
            <span className={styles.totalSent} style={{ width: pct(sentBytes, totalBytes) }} />
            <span className={styles.totalReady} style={{ width: pct(ready, items.length) }} />
          </div>

          <ul className={styles.sheet}>
            {items.map((it) => (
              <li
                key={it.key}
                className={`${styles.cell} ${styles[`is_${it.status}`] ?? ''}`}
                title={`${it.name} · ${mb(it.size)} · ${it.error ?? STATE_LABEL[it.status]}`}
              >
                {it.preview && <img src={it.preview} alt="" />}
                {it.status === 'sending' && (
                  <span className={styles.cellBar} style={{ width: pct(it.sent, it.size) }} />
                )}
              </li>
            ))}
          </ul>

          <div className={`mono ${styles.legend}`}>
            {['waiting', 'sending', 'uploading', 'converting', 'ready', 'failed', 'canceled']
              .map((st) => [st, count(st)])
              .filter(([, n]) => n > 0)
              .map(([st, n]) => (
                <span key={st}>
                  <i className={`${styles.dot} ${styles[`is_${st}`]}`} />
                  {n} {(n > 1 && PLURAL[st]) || STATE_LABEL[st]}
                </span>
              ))}
          </div>

          {items.some((it) => it.error) && (
            <ul className={styles.errors}>
              {items.filter((it) => it.error).map((it) => (
                <li key={it.key} className="mono">
                  <span className={styles.name}>{it.name}</span>
                  <span className={styles.bad}>{it.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h2 className={styles.section}>Mis rollos</h2>

      <div className={styles.albums}>
        {data.albums.map((a) => (
          <div key={a.id} className={styles.album}>
            <span className={styles.cover}>
              {a.coverId && <img src={`/media/${a.coverId}.webp`} alt="" />}
            </span>

            <div className={styles.info}>
              <div className={styles.titleRow}>
                <span className={styles.albumTitle}>{a.title}</span>
                <span
                  className={`mono ${styles.tag} ${
                    a.burnt ? '' : a.daysLeft !== null && a.daysLeft <= 3 ? styles.tagWarn : styles.tagOk
                  }`}
                >
                  {a.burnt
                    ? 'velado'
                    : a.daysLeft === null
                      ? 'sin vencimiento'
                      : `abierto · ${a.daysLeft} días`}
                </span>
              </div>
              <span className={`mono ${styles.meta}`}>
                {a.photoCount} {a.photoCount === 1 ? 'copia' : 'copias'} · {a.createdAt.slice(0, 10).split('-').reverse().join('/')}
              </span>
            </div>

            <div className={styles.linkCol}>
              <div className={styles.codeRow}>
                <span className={styles.code}>{a.code}</span>
                <button
                  className={styles.copy}
                  onClick={() => {
                    navigator.clipboard?.writeText(`${location.origin}/r/${a.code.toLowerCase()}`);
                    say(`Link de ${a.title} copiado`);
                  }}
                >
                  Copiar link
                </button>
              </div>
              <a className={`mono ${styles.link}`} href={`/r/${a.code.toLowerCase()}`}>
                {location.host}/r/{a.code.toLowerCase()}
              </a>
            </div>

            <div className={styles.rowActions}>
              <button className={styles.secondary} onClick={() => setExpiry(a)}>
                Vencimiento
              </button>
              <button className={styles.secondary} onClick={() => editCode(a)}>
                Cambiar código
              </button>
              <button
                className={a.isOpen ? styles.secondary : styles.sage}
                onClick={() => patch(
                  a.id,
                  { isOpen: !a.isOpen },
                  a.isOpen ? `${a.title} quedó cerrado` : `${a.title} está abierto otra vez`
                )}
              >
                {a.isOpen ? 'Cerrar ahora' : 'Revelar de nuevo'}
              </button>
              <button
                className={styles.secondary}
                disabled={busy}
                onClick={() => { setTarget(a.id); setItems([]); fileInput.current?.click(); }}
              >
                Subir acá
              </button>
            </div>
          </div>
        ))}
      </div>

      {pending && (
        <NewAlbumDialog
          fileCount={pending.length}
          onCreate={createAndUpload}
          onClose={() => setPending(null)}
        />
      )}

      {expiry && (
        <ExpiryDialog
          album={expiry}
          onClose={() => setExpiry(null)}
          onSave={(body) => { patch(expiry.id, body, 'Vencimiento guardado'); setExpiry(null); }}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
