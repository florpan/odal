import { useState } from 'react';
import { refKey, refName } from '@odal/engine';
import type { Ref } from '@odal/engine';
import { appStore } from '../../app/store';
import { useApp } from '../hooks';
import { RefDetails } from '../tree/RefDetails';
import { TechTimeline } from '../tree/TechTimeline';

/**
 * The research screen: a sideways timeline of techs by tier (TechTimeline),
 * each card listing what it unlocks, coloured by how far the player is from it.
 * An available tech has a Research button in the side panel, queued at
 * whichever own building can do it. Locked ones show what they still need, so
 * the whole tree is readable ahead of time.
 * Toggled with Tab, the top bar button, or from a research building's actions.
 */
export function TechTreeOverlay() {
  const view = useApp((s) => s.hud.tree);
  const session = useApp((s) => s.session);
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
          <span className="muted">scroll sideways · chips = what a tech unlocks</span>
        </div>
        <span className="spacer" />
        <button type="button" className="small" onClick={close}>
          Close (Tab)
        </button>
      </div>
      <div className="tree-overlay-body">
        <div className="tree-overlay-graph">
          <TechTimeline
            tree={view.tree}
            status={view.status}
            progress={view.progress}
            selected={key}
            onSelect={setSelected}
          />
        </div>
        <aside className="tree-overlay-side">
          {selected ? (
            <>
              <h3>
                {refName(view.tree, selected)}{' '}
                <span className={`status-tag ${view.status[key!] ?? ''}`}>{labelFor(view.status[key!])}</span>
              </h3>
              <RefDetails tree={view.tree} ref={selected} status={view.status} />
              {selected.kind === 'tech' && view.status[key!] === 'available' && (
                <button
                  type="button"
                  className="research"
                  disabled={!view.affordable[key!]}
                  title={view.affordable[key!] ? 'Queue this research' : 'Not enough resources yet'}
                  onClick={() => session?.action(`research:${selected.id}`)}
                >
                  {view.affordable[key!] ? 'Research' : 'Cannot afford'} {refName(view.tree, selected)}
                </button>
              )}
              {selected.kind === 'tech' && view.status[key!] === 'locked' && (
                <p className="muted">Locked: meet the requirements above, then research it here.</p>
              )}
            </>
          ) : (
            <p className="muted">
              Click a tech for details and to research it. Click a chip to see what that unit or building needs.
            </p>
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
