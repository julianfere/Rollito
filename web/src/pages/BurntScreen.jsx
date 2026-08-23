import { useState } from 'react';
import { useParams } from 'react-router-dom';
import Toast from '../components/Toast.jsx';
import useToast from '../lib/useToast.js';
import styles from './BurntScreen.module.css';

export default function BurntScreen({ album }) {
  const { code } = useParams();
  const [asked, setAsked] = useState(false);
  const [toast, say] = useToast();

  const ask = async () => {
    await fetch(`/api/r/${code}/reopen-request`, { method: 'POST' });
    setAsked(true);
    say('Le llegó el aviso al celu del revelador');
  };

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        </div>
        <h1 className={styles.title}>Este rollo <em>se veló</em></h1>
        <p className={styles.blurb}>
          {album.title ? `«${album.title}» estuvo` : 'Estuvo'} abierto
          {album.openedDays ? ` ${album.openedDays} días` : ''} y ya se cerró.
          Nada se perdió: el revelador lo puede volver a abrir cuando quiera.
        </p>
        <button className={styles.primary} onClick={ask} disabled={asked}>
          {asked ? 'Ya le avisamos' : 'Pedir que lo revelen de nuevo'}
        </button>
        <p className={`mono ${styles.note}`}>le llega un aviso al celular del revelador</p>
      </div>
      <Toast message={toast} />
    </div>
  );
}
