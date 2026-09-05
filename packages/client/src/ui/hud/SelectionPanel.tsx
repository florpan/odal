import { useApp } from '../hooks';

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return (
    <div className={`bar ${className ?? ''}`}>
      <div style={{ width: `${pct.toFixed(1)}%` }} />
    </div>
  );
}

export function SelectionPanel() {
  const sel = useApp((s) => s.hud.selection);
  const session = useApp((s) => s.session);

  switch (sel.kind) {
    case 'none':
      return (
        <div className="selection">
          <h3>Nothing selected</h3>
          <div className="muted">Left-click a unit or building. Drag to box-select. Ctrl+1–9 saves a group.</div>
        </div>
      );
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
          <h3 style={{ color: sel.color }}>{sel.name}</h3>
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
        </div>
      );
  }
}
