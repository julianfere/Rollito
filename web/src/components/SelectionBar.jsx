import styles from './SelectionBar.module.css';

const mb = (n, per) => (n * per).toFixed(1).replace('.', ',') + ' MB';

export default function SelectionBar({ count, onClear, onTake }) {
  if (count === 0) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <span className={styles.count}>{String(count).padStart(2, '0')}</span>
        <span>{count === 1 ? 'copia elegida' : 'copias elegidas'}</span>
        <span className={`mono ${styles.weight}`}>{mb(count, 6.4)} en un zip</span>
        <div className={styles.actions}>
          <button className={styles.ghost} onClick={onClear}>Soltar todas</button>
          <button className={styles.primary} onClick={onTake}>Llevármelas</button>
        </div>
      </div>
    </div>
  );
}
