import { useApp } from '../hooks';

/** Context buttons. What they are and whether they're enabled is decided by the game's view model. */
export function ActionBar({ onAction }: { onAction?: () => void } = {}) {
  const actions = useApp((s) => s.hud.actions);
  const session = useApp((s) => s.session);
  return (
    <div className="actions">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`act${a.active || a.done ? ' done' : ''}`}
          title={a.title}
          disabled={a.disabled}
          onClick={() => {
            session?.action(a.id);
            onAction?.();
          }}
        >
          {a.label}
          <small>{a.sub}</small>
        </button>
      ))}
    </div>
  );
}
