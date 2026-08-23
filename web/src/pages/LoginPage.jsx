import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) { setError('Esa clave no es.'); return; }
      nav('/admin');
    } catch {
      setError('No pudimos entrar. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.icon} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        </div>
        <h1 className={styles.title}>El cuarto oscuro</h1>
        <p className={styles.blurb}>
          Sólo entra el revelador. Los amigos no necesitan nada de esto.
        </p>
        <label className={`mono ${styles.label}`} htmlFor="pw">Clave</label>
        <input
          id="pw"
          className={styles.input}
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primary} disabled={busy || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
