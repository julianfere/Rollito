import { useCallback, useEffect, useRef, useState } from 'react';

/** Aviso efímero: visible 2600ms (handoff). */
export default function useToast() {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  const say = useCallback((msg) => {
    clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return [message, say];
}
