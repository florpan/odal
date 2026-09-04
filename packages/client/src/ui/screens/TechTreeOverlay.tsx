import { useState } from 'react';
import { refKey, refName } from '@odal/engine';
import type { Ref } from '@odal/engine';
import { appStore } from '../../app/store';
import { useApp } from '../hooks';
import { RefDetails } from '../tree/RefDetails';
import { TechTreeGraph } from '../tree/TechTreeGraph';

/**
 * The player's tech tree: every unit, building and tech, coloured by how far
 * they are from having it. Read-only; the ActionBar is where things get queued.
 * Toggled with Tab or the top bar button.
 */
export function TechTreeOverlay() {
  const view = useApp((s) => s.hud.tree);
  const [selected, setSelected] = useState<Ref | null>(null);
  if (!view) return null;
  const close = () => appStore.setState({ overlay: null });
  const key = selected ? refKey(selected) : null;
  return (
    <div className="tree-overlay">
      <div className="tree-overlay-head">
        <h2>Tech tree</h2>
        <div className="tree-legend">
          <span>
            <i className="owned" /> have
          </span>
          <span>
            <i className="inProgress" /> in progress
          </span>
          <span>
            <i className="available" /> available now
          </span>
          <span>
            <i className="locked" /> locked
          </span>
          <span className="muted">dashed = requires · solid = trains / researches</span>
        </div>
        <span className="spacer" />
        <button type="button" className="small" onClick={close}>
          Close (Tab)
        </button>
      </div>
      <div className="tree-overlay-body">
        <div className="tree-overlay-graph">
          <TechTreeGraph tree={view.tree} status={view.status} selected={key} onSelect={setSelected} />
        </div>
        <aside className="tree-overlay-side">
          {selected ? (
            <>
              <h3>
                {refName(view.tree, selected)}{' '}
                <span className={`status-tag ${view.status[key!] ?? ''}`}>{labelFor(view.status[key!])}</span>
              </h3>
              <RefDetails tree={view.tree} ref={selected} status={view.status} />
            </>
          ) : (
            <p className="muted">Click something to see what it costs, what it needs and what it leads to.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function labelFor(s: string | undefined): string {
  switch (s) {
    case 'owned':
      return 'have';
    case 'inProgress':
      return 'in progress';
    case 'available':
      return 'available';
    case 'locked':
      return 'locked';
    default:
      return '';
  }
}
