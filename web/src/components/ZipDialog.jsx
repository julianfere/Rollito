import { useEffect, useRef, useState } from 'react';
import { canShareFiles, loadShareFiles, shareFiles } from '../lib/share.js';
import styles from './ZipDialog.module.css';

// Peso real del artefacto. En KB por debajo de 1 MB: un zip liviano
// mostraba "0,0 MB" al redondear a un decimal.
const weight = (n) => {
  if (!n) return '—';
  return n < 1048576
    ? Math.max(1, Math.round(n / 1024)) + ' KB'
    : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
};
const est = (n, per) => (n * per).toFixed(1).replace('.', ',') + ' MB';

// Estimación por copia, para avisar antes de una descarga pesada con datos móviles.
const PER_ORIGINAL = 6.4;
const PER_LITE = 0.9;
const HEAVY_MB = 50;

/** Diálogo de descarga: elegir calidad → progreso → listo (handoff). */
export default function ZipDialog({ code, photos, onClose, onSaid }) {
  const shareable = useRef(canShareFiles()).current;
  const n = photos.length;
  // `photos` es un array nuevo en cada render del padre; la precarga depende de
  // esta clave estable para no dispararse en bucle.
  const key = photos.map((p) => p.id).join(',');
  const heavy = n * PER_ORIGINAL > HEAVY_MB;

  // Con muchas copias arrancamos en liviana: en el celular, bajar cientos de
  // megas con datos es la vía rápida a que se corte.
  const [quality, setQuality] = useState(heavy ? 'lite' : 'original');
  const [phase, setPhase] = useState('choose');
  const [pct, setPct] = useState(0);
  const [token, setToken] = useState(null);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState(null);   // copias ya bajadas, listas para compartir
  const [loadPct, setLoadPct] = useState(0);
  const poll = useRef(null);

  // Precarga para el camino de compartir: al abrir el diálogo y cada vez que
  // cambia la calidad. Sin esto, el fetch caería dentro del click y vencería
  // la activación del usuario en redes lentas.
  useEffect(() => {
    if (!shareable || phase !== 'choose') return;
    const ctrl = new AbortController();
    setFiles(null);
    setLoadPct(0);
    loadShareFiles({ photos, quality, onProgress: setLoadPct, signal: ctrl.signal })
      .then(setFiles)
      .catch((err) => { if (err?.name !== 'AbortError') setFiles(null); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareable, phase, key, quality]);

  /**
   * Camino del celular: hoja de compartir → "Guardar imágenes" va a la galería.
   *
   * Los archivos se precargan al elegir la calidad (efecto de abajo), así este
   * handler llama a shareFiles() sin ningún await por delante y no se pierde la
   * activación del usuario.
   */
  const share = async () => {
    setError(null);
    const res = await shareFiles(files);
    if (res.ok) {
      onSaid?.(n === 1 ? 'Copia lista para guardar' : 'Copias listas para guardar');
      onClose();
      return;
    }
    if (res.reason === 'cancelled') return; // cerró la hoja: no es un error
    setError(res.reason === 'expired'
      ? 'Tardó demasiado en preparar las copias. Probá con el zip.'
      : 'No pudimos abrir el menú de compartir. Probá con el zip.');
  };

  const startZip = async () => {
    setError(null);
    setPhase('work');
    setPct(0);
    try {
      const r = await fetch(`/api/r/${code}/zip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoIds: photos.map((p) => p.id), quality }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? 'no pudimos armar el zip'); setPhase('choose'); return; }
      setToken(body.token);
    } catch {
      setError('no pudimos armar el zip');
      setPhase('choose');
    }
  };

  // Progreso: el job vive en el server, acá sólo lo consultamos.
  useEffect(() => {
    if (!token || phase !== 'work') return;
    poll.current = setInterval(async () => {
      const r = await fetch(`/api/zip/${token}/status`);
      if (!r.ok) return;
      const j = await r.json();
      setPct(j.pct ?? 0);
      if (j.state === 'done') { setBytes(j.bytes ?? 0); setPhase('done'); }
      if (j.state === 'error') { setError('se cortó el armado'); setPhase('choose'); }
    }, 400);
    return () => clearInterval(poll.current);
  }, [token, phase]);

  useEffect(() => () => clearInterval(poll.current), []);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        {phase === 'choose' && (
          <>
            <h2 className={styles.title}>
              {n} {n === 1 ? 'copia lista' : 'copias listas'} para viajar
            </h2>
            <p className={styles.blurb}>
              {shareable
                ? 'Elegí la calidad y te las mando al teléfono. Desde ahí, «Guardar imágenes» las deja en tus fotos.'
                : '¿Cómo las querés? El original es el archivo tal cual salió de la cámara.'}
            </p>

            <div className={styles.options}>
              <button
                className={`${styles.option} ${quality === 'original' ? styles.on : ''}`}
                onClick={() => setQuality('original')}
              >
                <span className={styles.optName}>Original, tal cual salió</span>
                <span className={styles.optMeta}>
                  {shareable ? est(n, PER_ORIGINAL) : `zip de ${est(n, PER_ORIGINAL)}`} · calidad completa
                </span>
              </button>
              <button
                className={`${styles.option} ${quality === 'lite' ? styles.on : ''}`}
                onClick={() => setQuality('lite')}
              >
                <span className={styles.optName}>Liviana para redes</span>
                <span className={styles.optMeta}>
                  {shareable ? est(n, PER_LITE) : `zip de ${est(n, PER_LITE)}`} · perfecta para historias
                </span>
              </button>
            </div>

            {heavy && quality === 'original' && (
              <p className={styles.warn}>
                Son {est(n, PER_ORIGINAL)}. Si estás con datos, la liviana baja mucho más rápido.
              </p>
            )}

            {error && <p className={styles.error} role="alert">{error}</p>}

            <div className={styles.actions}>
              <button className={styles.ghost} onClick={onClose}>Después</button>
              {shareable ? (
                <>
                  <button className={styles.ghost} onClick={startZip}>Bajar zip</button>
                  <button className={styles.primary} onClick={share} disabled={!files}>
                    {files ? 'Guardar en el teléfono' : `Preparando… ${loadPct}%`}
                  </button>
                </>
              ) : (
                <button className={styles.primary} onClick={startZip}>Armar el zip</button>
              )}
            </div>
          </>
        )}

        {phase === 'work' && (
          <>
            <h2 className={styles.title}>Armando tu rollo…</h2>
            <p className={`mono ${styles.progressLabel}`}>
              {Math.round(pct)}% · juntando {n} {n === 1 ? 'copia' : 'copias'}
            </p>
            <div className={styles.track}>
              <div className={styles.bar} style={{ width: `${pct}%` }} />
            </div>
            <p className={`mono ${styles.note}`}>podés cerrar esto, el zip sigue vivo un rato</p>
            <div className={styles.actions}>
              <button className={styles.ghost} onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className={styles.check} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className={styles.title}>Listo, ya son tuyas</h2>
            <p className={styles.blurb}>
              {n} {n === 1 ? 'copia' : 'copias'} · {weight(bytes)} en tus descargas.
            </p>
            <div className={styles.actions}>
              <a className={styles.primary} href={`/api/zip/${token}`}>Bajar el zip</a>
              <button className={styles.ghost} onClick={onClose}>Seguir mirando</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
