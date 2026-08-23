import { useEffect, useRef } from 'react';
import styles from './PhotoGrid.module.css';

const PAGE = 24;

/** Grilla con scroll infinito de 24 en 24 (handoff). */
export default function PhotoGrid({ photos, visible, onMore, selected, onToggle, onOpen, onGrab }) {
  const sentinel = useRef(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || visible >= photos.length) return;
    // IntersectionObserver en vez de listener de scroll: no corre en cada frame
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && onMore(Math.min(visible + PAGE, photos.length)),
      { rootMargin: '700px' } // mismo umbral que el prototipo
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, photos.length, onMore]);

  const shown = photos.slice(0, visible);

  return (
    <>
      <div className={styles.grid}>
        {shown.map((p, i) => {
          const on = selected.has(p.id);
          return (
            <div
              key={p.id}
              className={`${styles.tile} ${on ? styles.on : ''}`}
              onClick={() => onOpen(i)}
            >
              <img src={p.preview} alt={`copia ${i + 1}`} loading="lazy" decoding="async" />
              <button
                className={styles.check}
                aria-pressed={on}
                aria-label={on ? 'Soltar esta copia' : 'Elegir copia'}
                onClick={(e) => { e.stopPropagation(); onToggle(p.id); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                className={styles.grab}
                aria-label="Bajar esta copia"
                onClick={(e) => { e.stopPropagation(); onGrab(p, i); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <div ref={sentinel} className={`mono ${styles.hint}`}>
        {visible >= photos.length
          ? `ese fue todo el rollo · ${photos.length} copias`
          : `seguí bajando · ${photos.length - visible} copias más en el revelador`}
      </div>
    </>
  );
}
