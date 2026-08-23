import { useState } from 'react';
import styles from './ExpiryDialog.module.css';

const PRESETS = [7, 14, 30, 0];
const fmt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export default function ExpiryDialog({ album, onSave, onClose }) {
  const [days, setDays] = useState(album.daysLeft ?? 14);
  const [until, setUntil] = useState(
    album.expiresAt ? album.expiresAt.slice(0, 10) : ''
  );
  const [mode, setMode] = useState('preset');

  const preview = mode === 'date' && until
    ? `Se vela el ${fmt(until)}`
    : days === 0
      ? 'Queda abierto para siempre'
      : `Se vela en ${days} días`;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <h2 className={styles.title}>Vencimiento de «{album.title}»</h2>
        <p className={styles.blurb}>
          Cuando se cumple, el link deja de abrir hasta que vos lo revelés otra vez.
        </p>

        <div className={styles.presets}>
          {PRESETS.map((d) => (
            <button
              key={d}
              className={`${styles.pill} ${mode === 'preset' && days === d ? styles.on : ''}`}
              onClick={() => { setDays(d); setMode('preset'); }}
            >
              {d === 0 ? 'Sin vencimiento' : `${d} días`}
            </button>
          ))}
        </div>

        <label className={`mono ${styles.label}`} htmlFor="until">O una fecha exacta</label>
        <input
          id="until"
          className={styles.date}
          type="date"
          value={until}
          onChange={(e) => { setUntil(e.target.value); setMode('date'); }}
        />

        <p className={styles.preview}>{preview}</p>

        <div className={styles.actions}>
          <button className={styles.ghost} onClick={onClose}>Cancelar</button>
          <button
            className={styles.primary}
            onClick={() => onSave(mode === 'date' && until ? { expiresAt: until } : { days })}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
