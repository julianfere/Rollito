import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast.jsx';
import ExpiryDialog from '../components/ExpiryDialog.jsx';
import NewAlbumDialog from '../components/NewAlbumDialog.jsx';
import useToast from '../lib/useToast.js';
import styles from './AdminPage.module.css';

const mb = (b) => (b == null ? '—' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB');
const STATE_LABEL = { uploading: 'subiendo', converting: 'revelando webp', ready: 'lista' };
const BAR_WIDTH = { uploading: '25%', converting: '65%', ready: '100%' };

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState([]);
  const [target, setTarget] = useState(null);   // rollo al que se sube
  const [expiry, setExpiry] = useState(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(null); // archivos esperando nombre de rollo
  const [batch, setBatch] = useState(null);     // ids de la tanda que se está subiendo
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const fileInput = useRef(null);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/albums');
    if (r.status === 401) { nav('/admin/login'); return; }
    setData(await r.json());
  }, [nav]);

  useEffect(() => { load(); }, [load]);

  /** Trae del server el estado de las fotos del rollo activo. */
  const refreshQueue = useCallback(async (albumId, ids = null) => {
    const r = await fetch(`/api/admin/albums/${albumId}/photos`);
    if (!r.ok) return [];
    const { photos } = await r.json();
    // Sólo lo de esta tanda: el endpoint devuelve las últimas 40 del rollo, y al
    // subir a un rollo que ya tenía fotos el conteo mezclaba viejas con nuevas
    // y la cola nunca llegaba a "0 en proceso".
    const mias = ids ? photos.filter((p) => ids.includes(p.id)) : photos;
    setQueue(mias);
    return mias;
  }, []);

  // `load` cambia `data` en cada llamada y con eso su identidad; si estuviera en
  // las dependencias del efecto de abajo, cada refresco reiniciaría el intervalo
  // y la cola nunca terminaba de estabilizarse.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Seguimos la conversión de la tanda recién subida hasta que estén todas listas.
  useEffect(() => {
    if (!target || !batch?.length) return;
    let alive = true;
    let timer = null;

    const tick = async () => {
      if (!alive) return;
      const photos = await refreshQueue(target, batch);
      if (!alive) return;
      if (photos.length === batch.length && photos.every((p) => p.state === 'ready')) {
        clearInterval(timer);
        loadRef.current();
      }
    };

    timer = setInterval(tick, 700);
    tick();
    return () => { alive = false; clearInterval(timer); };
  }, [target, batch, refreshQueue]);

  /**
   * Sube al rollo indicado. El id llega por parámetro a propósito: leer `target`
   * del estado acá no servía, porque después de crear un rollo `setTarget()`
   * todavía no se reflejó y las fotos se subían al rollo equivocado (o a ninguno).
   */
  const uploadTo = useCallback(async (albumId, files) => {
    const list = [...files];
    if (!list.length) return;

    setBusy(true);
    setTarget(albumId);
    setQueue([]);

    try {
      const fd = new FormData();
      list.forEach((f, i) => fd.append(`f${i}`, f));
      const r = await fetch(`/api/admin/albums/${albumId}/photos`, { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        say(body.error ?? 'No pudimos subir esas fotos');
        setQueue([]);
        return;
      }
      const { saved, failed = [] } = await r.json();
      const ids = saved.map((p) => p.id);
      setBatch(ids);
      say(failed.length
        ? `${saved.length} en el cuarto oscuro · ${failed.length} no se pudo${failed.length === 1 ? '' : 'ieron'} subir`
        : `${saved.length} ${saved.length === 1 ? 'foto' : 'fotos'} en el cuarto oscuro`);
      await refreshQueue(albumId, ids);
      load();
    } catch {
      say('Se cortó la subida');
      setQueue([]);
    } finally {
      setBusy(false);
    }
  }, [say, refreshQueue, load]);

  /** Elegir archivos: si ya hay un rollo activo van ahí; si no, pedimos nombre. */
  const pick = useCallback((files) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    if (target) uploadTo(target, list);
    else setPending(list);
  }, [target, uploadTo]);

  /** Crea el rollo y recién ahí sube: si la creación falla, no queda rollo vacío. */
  const createAndUpload = useCallback(async ({ title, days }) => {
    const files = pending;
    try {
      const r = await fetch('/api/admin/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, days }),
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
    if (r.ok) { say(msg); load(); }
  };

  if (!data) return <div className={styles.center} />;

  const ready = queue.filter((p) => p.state === 'ready').length;
  const working = queue.length - ready;
  const targetTitle = data.albums.find((a) => a.id === target)?.title ?? null;

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

      {queue.length > 0 && (
        <div className={styles.queue}>
          <div className={styles.queueHead}>
            <span className={`mono ${styles.queueTitle}`}>
              {queue.length} {queue.length === 1 ? 'foto' : 'fotos'} en el cuarto oscuro
            </span>
            <span className={`mono ${styles.queueSub}`}>
              {targetTitle ? `en «${targetTitle}» · ` : ''}
              {ready} {ready === 1 ? 'lista' : 'listas'} · {working} en proceso
            </span>
            {working === 0 && (
              <button
                className={styles.closeQueue}
                onClick={() => { setQueue([]); setTarget(null); setBatch(null); }}
              >
                Listo
              </button>
            )}
          </div>

          {queue.map((p) => (
            <div key={p.id} className={styles.row}>
              <span className={styles.thumb}>
                {p.preview && <img src={p.preview} alt="" />}
              </span>
              <span className={`mono ${styles.name}`}>{p.name}</span>
              <span className={`mono ${styles.size}`}>{mb(p.bytes)}</span>
              <span className={styles.track}>
                <span
                  className={styles.bar}
                  style={{
                    width: BAR_WIDTH[p.state],
                    background: p.state === 'ready' ? 'var(--sage)' : 'var(--hot)',
                  }}
                />
              </span>
              <span className={`mono ${styles.tag} ${p.state === 'ready' ? styles.tagOk : ''}`}>
                {STATE_LABEL[p.state]}
              </span>
            </div>
          ))}
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
                onClick={() => { setTarget(a.id); setQueue([]); setBatch(null); fileInput.current?.click(); }}
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
