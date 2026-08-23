import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid.jsx';
import SelectionBar from '../components/SelectionBar.jsx';
import Viewer from '../components/Viewer.jsx';
import Toast from '../components/Toast.jsx';
import ZipDialog from '../components/ZipDialog.jsx';
import { canShareFiles, shareOne } from '../lib/share.js';
import BurntScreen from './BurntScreen.jsx';
import useToast from '../lib/useToast.js';
import styles from './AlbumPage.module.css';

const num = (i) => '#' + String(i + 1).padStart(3, '0');

export default function AlbumPage() {
  const { code } = useParams();
  const [album, setAlbum] = useState(null);
  const [burnt, setBurnt] = useState(null);
  const [error, setError] = useState(null);
  // La selección no persiste entre visitas: cada visita arranca limpia (handoff).
  const [selected, setSelected] = useState(() => new Set());
  const [visible, setVisible] = useState(24);
  const [viewer, setViewer] = useState(null);
  const [zipOpen, setZipOpen] = useState(false);
  const [toast, say] = useToast();

  useEffect(() => {
    let alive = true;
    // Reseteo: si no, un rollo que estaba velado y se reabrió sigue mostrando
    // la pantalla vieja, porque `burnt` gana sobre `album` al renderizar.
    setBurnt(null);
    setError(null);
    setAlbum(null);
    setSelected(new Set());
    setVisible(24);
    setViewer(null);

    fetch(`/api/r/${code}`)
      .then(async (r) => {
        const body = await r.json();
        if (!alive) return;
        if (r.status === 410) return setBurnt(body);
        if (!r.ok) return setError(body.error ?? 'no se pudo abrir el rollo');
        setAlbum(body);
      })
      .catch(() => alive && setError('no se pudo abrir el rollo'));
    return () => { alive = false; };
  }, [code]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // En el celular la descarga directa deja el archivo en Descargas, fuera de la
  // galería. Con la hoja de compartir se puede guardar en Fotos de una.
  const grab = useCallback(async (photo, i) => {
    if (canShareFiles()) {
      const res = await shareOne(photo, 'original');
      if (res.ok) { say(`Copia ${num(i)} lista para guardar`); return; }
      if (res.reason === 'cancelled') return;
    }
    say(`Bajando la copia ${num(i)} en calidad original`);
    window.location.href = photo.original;
  }, [say]);

  const step = useCallback((d) => {
    setViewer((v) => (v === null ? v : (v + d + album.photos.length) % album.photos.length));
  }, [album]);

  if (burnt) return <BurntScreen album={burnt} />;
  if (error) return <div className={styles.center}>{error}</div>;
  if (!album) return <div className={styles.center} />;

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div className={styles.brand}>
          <span className={styles.light} aria-hidden="true" />
          <span className={styles.wordmark}>Rollito</span>
        </div>
        <span className={`mono ${styles.expiry}`}>{album.expiryLabel}</span>
        <button
          className={styles.secondary}
          onClick={() => setSelected(new Set(album.photos.map((p) => p.id)))}
        >
          Bajar el rollo entero
        </button>
      </header>

      <div className={styles.pad}>
        <p className={`mono ${styles.kicker}`}>
          rollo {album.code.toLowerCase()} · {album.photoCount} copias
        </p>
        <h1 className={styles.title}>{album.title}</h1>
        <p className={styles.blurb}>
          Todo está bajo la luz roja. Revelé {album.photoCount} copias: pasá por encima de una y
          tocá el tilde para llevártela. Si elegís varias salen juntas en un zip.
        </p>
      </div>

      <PhotoGrid
        photos={album.photos}
        visible={visible}
        onMore={setVisible}
        selected={selected}
        onToggle={toggle}
        onOpen={setViewer}
        onGrab={grab}
      />

      <SelectionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onTake={() => setZipOpen(true)}
      />

      {viewer !== null && (
        <Viewer
          photos={album.photos}
          index={viewer}
          onClose={() => setViewer(null)}
          onStep={step}
          selected={selected}
          onToggle={toggle}
          onGrab={grab}
        />
      )}

      {zipOpen && (
        <ZipDialog
          code={album.code.toLowerCase()}
          photos={album.photos.filter((p) => selected.has(p.id))}
          onClose={() => setZipOpen(false)}
          onSaid={say}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
