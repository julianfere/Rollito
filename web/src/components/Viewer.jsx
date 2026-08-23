import { useEffect, useRef, useState } from 'react';
import { canShareFiles } from '../lib/share.js';
import styles from './Viewer.module.css';

const num = (i) => '#' + String(i + 1).padStart(3, '0');

/**
 * Visor a pantalla completa.
 * El handoff pide medir el contenedor y calcular h = min(boxH, boxW/ratio):
 * no alcanza con max-width + aspect-ratio.
 */
export default function Viewer({ photos, index, onClose, onStep, selected, onToggle, onGrab }) {
  const wrap = useRef(null);
  const [box, setBox] = useState(null);
  const touchX = useRef(null);

  useEffect(() => {
    const measure = () => {
      const el = wrap.current;
      if (el?.clientWidth && el?.clientHeight) {
        setBox({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') onStep(1);
      if (e.key === 'ArrowLeft') onStep(-1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep, onClose]);

  const photo = photos[index];
  const on = selected.has(photo.id);

  const ratio = photo.w && photo.h ? photo.w / photo.h : 1;
  let frame = { aspectRatio: String(ratio), maxWidth: '100%', maxHeight: '100%' };
  if (box) {
    const h = Math.min(box.h, box.w / ratio);
    frame = { height: Math.floor(h) + 'px', width: Math.floor(h * ratio) + 'px' };
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Visor de copias">
      <div className={styles.top}>
        <span className={styles.counter}>{num(index)} / {photos.length}</span>
        <span className={`mono ${styles.caption}`}>copia {index + 1} de {photos.length}</span>
        <button className={styles.close} onClick={onClose} aria-label="Cerrar visor">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div
        className={styles.stage}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 48) onStep(dx < 0 ? 1 : -1); // swipe >48px
          touchX.current = null;
        }}
      >
        <button className={styles.nav} onClick={() => onStep(-1)} aria-label="Copia anterior">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className={styles.wrap} ref={wrap}>
          <img className={styles.photo} style={frame} src={photo.preview} alt={`copia ${index + 1}`} />
        </div>
        <button className={styles.nav} onClick={() => onStep(1)} aria-label="Copia siguiente">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      <div className={styles.bar}>
        <button
          className={`${styles.pick} ${on ? styles.mine : ''}`}
          onClick={() => onToggle(photo.id)}
        >
          {on ? 'Ya es tuya' : 'Quiero esta copia'}
        </button>
        <button className={styles.secondary} onClick={() => onGrab(photo, index)}>
          {canShareFiles() ? 'Guardar en el teléfono' : 'Bajar sólo esta'}
        </button>
      </div>
    </div>
  );
}
