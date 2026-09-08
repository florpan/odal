import { useApp } from '../hooks';
import { ActionBar } from './ActionBar';

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return (
    <div className={`bar ${className ?? ''}`}>
      <div style={{ width: `${pct.toFixed(1)}%` }} />
    </div>
  );
}

/**
 * The selection card: what is selected, its state, and the actions it offers, in one floating panel.
 * Hidden when nothing is selected. The close button clears the selection.
 */
export function SelectionCard() {
  const sel = useApp((s) => s.hud.selection);
  const session = useApp((s) => s.session);
  if (sel.kind === 'none') return null;
  return (
    <div className="selection-card">
      <button
        type="button"
        className="card-close"
        title="Clear selection (Esc)"
        onClick={() => session?.clearSelection()}
      >
        ×
      </button>
      <SelectionPanel />
      <ActionBar />
    </div>
  );
}

export function SelectionPanel() {
  const sel = useApp((s) => s.hud.selection);
  const session = useApp((s) => s.session);

  switch (sel.kind) {
    case 'none':
      return null;
    case 'units':
      return (
        <div className="selection">
          <h3>{sel.count} units</h3>
          <div className="muted">{sel.summary}</div>
        </div>
      );
    case 'node':
      return (
        <div className="selection">
          <h3>
            {sel.icon} {sel.name}
          </h3>
          <div className="muted">{sel.resource}</div>
          <div>
            {sel.amount} / {sel.total} left
          </div>
          <Bar value={sel.amount} max={sel.total} />
          <div className="muted">{sel.gather}</div>
          {sel.desc && <div className="muted desc">{sel.desc}</div>}
        </div>
      );
    case 'unit':
      return (
        <div className="selection">
          <h3 style={{ color: sel.color }}>{sel.name}</h3>
          <div className="muted">{sel.owner}</div>
          <div>
            HP {sel.hp} / {sel.maxHp}
          </div>
          <Bar value={sel.hp} max={sel.maxHp} className="hp" />
          <div>{sel.task}</div>
          {sel.carry && <div>{sel.carry}</div>}
          <div className="muted desc">{sel.desc}</div>
        </div>
      );
    case 'building':
      return (
        <div className="selection">
          <h3 style={{ color: sel.color }}>
            {sel.name}
            {sel.rotatable && (
              <span className="turn" title="Turn the building a sixth of a turn (Q, Shift+Q). Looks only.">
                <button type="button" onClick={() => session?.action('rotate:back')} aria-label="Turn left">
                  ↺
                </button>
                <button type="button" onClick={() => session?.action('rotate')} aria-label="Turn right">
                  ↻
                </button>
              </span>
            )}
          </h3>
          <div className="muted">
            {sel.owner}
            {sel.remembered ? ' · last seen' : ''}
          </div>
          {!sel.remembered && (
            <>
              <div>
                HP {sel.hp} / {sel.maxHp}
              </div>
              <Bar value={sel.hp} max={sel.maxHp} className="hp" />
            </>
          )}
          {sel.progress < 1 ? (
            <>
              <div>Under construction {Math.floor(sel.progress * 100)}%</div>
              <Bar value={sel.progress} max={1} />
            </>
          ) : (
            <div className="muted">{sel.desc}</div>
          )}
          {sel.rally && <div className="muted">{sel.rally}</div>}
          {sel.queue.length > 0 && (
            <div className="queue">
              {sel.queue.map((q) => (
                <div key={q.index} title="Click to cancel" onClick={() => session?.action(`cancelQueue:${q.index}`)}>
                  <span>
                    {q.index + 1}. {q.name}
                  </span>
                  <span>{q.pct}%</span>
                </div>
              ))}
            </div>
          )}
          {sel.advances.length > 0 && (
            <div className="advances muted" title="Research this building makes possible">
              {sel.advances.map((a) => (
                <span key={a.name} className={a.done ? 'done' : ''}>
                  {a.done ? '✓ ' : '· '}
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      );
  }
}
