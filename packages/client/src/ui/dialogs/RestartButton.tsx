import { useEffect, useState } from 'react';
import { useApp } from '../hooks';

/** Two-step restart so a stray click can't wipe the game for everyone. */
export function RestartButton() {
  const session = useApp((s) => s.session);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const click = () => {
    if (armed) {
      session?.restart();
      setArmed(false);
    } else {
      setArmed(true);
    }
  };

  return (
    <button type="button" className="small" onClick={click}>
      {armed ? 'Click again to restart for everyone' : 'Restart'}
    </button>
  );
}
