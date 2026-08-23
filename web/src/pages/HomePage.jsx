import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './HomePage.module.css';

// Único adorno de la home: una tira de perforaciones de 35mm al pie.
const PERFORACIONES = Array.from({ length: 40 });

export default function HomePage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const reveal = async (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/resolve/${encodeURIComponent(c)}`);
      if (!r.ok) { setError('No encontramos ese rollo. ¿Está bien el código?'); return; }
      nav(`/r/${c.toLowerCase()}`);
    } catch {
      setError('No pudimos revisar el código. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root}>
      <span className={styles.halo} aria-hidden="true" />

      <div className={styles.col}>
        <div className={styles.brand}>
          <span className={styles.light} aria-hidden="true" />
          <span className={styles.wordmark}>Rollito</span>
        </div>

        <h1 className={styles.title}>Las fotos de anoche, ya <em>reveladas</em>.</h1>
        <p className={styles.blurb}>
          Pegá el código que te mandé y elegí las copias que te quieras llevar.
          Sin cuentas, sin Drive, sin pedirle nada a nadie.
        </p>

        {/* Campo y botón como una sola pieza. */}
        <form className={styles.piece} onSubmit={reveal}>
          <label className={`mono ${styles.label}`} htmlFor="code">Código</label>
          <input
            id="code"
            className={styles.input}
            placeholder="4F7K2"
            value={code}
            maxLength={12}
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={styles.primary} disabled={busy || !code.trim()}>
            {busy ? 'Buscando…' : 'Revelar'}
          </button>
        </form>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <p className={`mono ${styles.note}`}>
          También entrás directo con el link largo que te llegó por WhatsApp.
        </p>
      </div>

      <div className={styles.strip} aria-hidden="true">
        {PERFORACIONES.map((_, i) => <span key={i} className={styles.perf} />)}
      </div>
    </div>
  );
}
