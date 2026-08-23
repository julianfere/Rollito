import { useEffect, useRef, useState } from 'react';
import styles from './NewAlbumDialog.module.css';

const PRESETS = [7, 14, 30, 0];

/**
 * Nombre y vencimiento del rollo nuevo, antes de subir.
 * Reemplaza al window.prompt: bloqueaba la página, no se puede estilar y no
 * permitía elegir el vencimiento en el mismo paso.
 */
export default function NewAlbumDialog({ fileCount, onCreate, onClose }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);

  // Esc cierra, como cualquier diálogo de la app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const submit = async (e) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) { setError('Ponele un nombre para encontrarlo después.'); return; }
    setBusy(true);
    setError(null);
    const res = await onCreate({ title: name, days });
    if (!res?.ok) {
      setError(res?.error ?? 'No pudimos crear el rollo.');
      setBusy(false);
    }
    // Si salió bien, el padre cierra el diálogo.
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="nuevo-rollo">
      <form className={styles.panel} onSubmit={submit}>
        <h2 className={styles.title} id="nuevo-rollo">Revelar un rollo nuevo</h2>
        <p className={styles.blurb}>
          {fileCount === 1
            ? 'Una foto lista para entrar al cuarto oscuro.'
            : `${fileCount} fotos listas para entrar al cuarto oscuro.`}
          {' '}Ponele nombre y decidí cuánto tiempo queda abierto.
        </p>

        <label className={`mono ${styles.label}`} htmlFor="rollo-nombre">Nombre del rollo</label>
        <input
          id="rollo-nombre"
          ref={input}
          className={styles.input}
          value={title}
          maxLength={80}
          placeholder="Cumple de Lu"
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
        />

        <span className={`mono ${styles.label}`}>Vencimiento</span>
        <div className={styles.presets}>
          {PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              className={`${styles.pill} ${days === d ? styles.on : ''}`}
              onClick={() => setDays(d)}
            >
              {d === 0 ? 'Sin vencimiento' : `${d} días`}
            </button>
          ))}
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className={styles.primary} disabled={busy || !title.trim()}>
            {busy ? 'Revelando…' : 'Revelar'}
          </button>
        </div>
      </form>
    </div>
  );
}
