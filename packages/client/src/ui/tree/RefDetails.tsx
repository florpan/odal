import { chainCost, describeEffect, describeRequirement, formatCost, idx, refDef, refName } from '@odal/engine';
import type { Ref, TechTree } from '@odal/engine';
import type { RefStatus } from './TechTreeGraph';

// Facts about one unit, building or tech, read straight from the tree. Used by
// the in-game overlay and the editor's inspector; both add their own controls.

export interface RefDetailsProps {
  tree: TechTree;
  ref: Ref;
  /** When present, requirements are marked met / unmet by the player's status. */
  status?: Record<string, RefStatus>;
}

export function RefDetails({ tree, ref, status }: RefDetailsProps) {
  const def = refDef(tree, ref);
  if (!def) return null;
  const i = idx(tree);
  const chain = chainCost(tree, ref);
  const producers = tree.buildings.filter((b) =>
    ref.kind === 'unit' ? b.trains.includes(ref.id) : ref.kind === 'tech' ? b.researches.includes(ref.id) : false,
  );
  const unlocks: { ref: Ref; how: string }[] = [];
  for (const u of tree.units) {
    if (u.requires.some((r) => r.type !== 'population' && r.type === ref.kind && r.id === ref.id))
      unlocks.push({ ref: { kind: 'unit', id: u.id }, how: 'requires' });
  }
  for (const b of tree.buildings) {
    if (b.requires.some((r) => r.type !== 'population' && r.type === ref.kind && r.id === ref.id))
      unlocks.push({ ref: { kind: 'building', id: b.id }, how: 'requires' });
    if (ref.kind === 'building' && ref.id === b.id) {
      for (const t of b.trains) unlocks.push({ ref: { kind: 'unit', id: t }, how: 'trains' });
      for (const t of b.researches) unlocks.push({ ref: { kind: 'tech', id: t }, how: 'researches' });
    }
  }
  for (const t of tree.techs) {
    if (t.requires.some((r) => r.type !== 'population' && r.type === ref.kind && r.id === ref.id))
      unlocks.push({ ref: { kind: 'tech', id: t.id }, how: 'requires' });
  }
  const met = (r: (typeof def.requires)[number]) => {
    if (!status) return undefined;
    if (r.type === 'population') return undefined;
    return status[`${r.type}:${r.id}`] === 'owned';
  };
  const unit = ref.kind === 'unit' ? i.units[ref.id] : undefined;
  const building = ref.kind === 'building' ? i.buildings[ref.id] : undefined;
  const tech = ref.kind === 'tech' ? i.techs[ref.id] : undefined;

  return (
    <div className="ref-details">
      {def.desc && <p className="desc">{def.desc}</p>}
      <dl>
        <dt>Cost</dt>
        <dd>{formatCost(tree, def.cost)}</dd>
        <dt>Time</dt>
        <dd>{def.time} s</dd>
        {unit && (
          <>
            <dt>Stats</dt>
            <dd>
              {unit.hp} HP · speed {unit.speed}
              {unit.damage ? ` · ${unit.damage} dmg / ${unit.attackTime}s, range ${unit.range}` : ''}
              {unit.pop !== 1 ? ` · pop ${unit.pop}` : ''}
              {Object.keys(unit.upkeep).length ? ` · upkeep ${formatCost(tree, unit.upkeep)}` : ''}
            </dd>
          </>
        )}
        {building && (
          <>
            <dt>Stats</dt>
            <dd>
              {building.hp} HP · {building.size.w}×{building.size.h}
              {building.pop ? ` · +${building.pop} pop` : ''}
              {building.produces
                ? ` · +${building.produces.amount} ${i.resources[building.produces.resource]?.name.toLowerCase()} / ${building.produces.interval}s`
                : ''}
              {building.attack
                ? ` · shoots ${building.attack.damage} / ${building.attack.attackTime}s, range ${building.attack.range}`
                : ''}
              {building.passable ? ' · own units pass through' : ''}
              {building.dropOff ? ' · drop-off' : ''}
            </dd>
          </>
        )}
        {tech && tech.effects.length > 0 && (
          <>
            <dt>Effects</dt>
            <dd>
              {tech.effects.map((e, k) => (
                <div key={k}>{describeEffect(tree, e)}</div>
              ))}
            </dd>
          </>
        )}
        {producers.length > 0 && (
          <>
            <dt>{ref.kind === 'unit' ? 'Trained at' : 'Researched at'}</dt>
            <dd>{producers.map((b) => b.name).join(', ')}</dd>
          </>
        )}
        {def.requires.length > 0 && (
          <>
            <dt>Requires</dt>
            <dd>
              {def.requires.map((r, k) => {
                const ok = met(r);
                return (
                  <div key={k} className={ok === undefined ? '' : ok ? 'met' : 'unmet'}>
                    {ok === undefined ? '' : ok ? '✓ ' : '✗ '}
                    {describeRequirement(tree, r)}
                  </div>
                );
              })}
            </dd>
          </>
        )}
        {unlocks.length > 0 && (
          <>
            <dt>Leads to</dt>
            <dd>
              {unlocks.map((u, k) => (
                <div key={k}>
                  {refName(tree, u.ref)} <span className="muted">({u.how})</span>
                </div>
              ))}
            </dd>
          </>
        )}
        <dt>From scratch</dt>
        <dd>
          {formatCost(tree, chain.cost)} · {chain.time} s · {chain.steps} step{chain.steps === 1 ? '' : 's'}
        </dd>
      </dl>
    </div>
  );
}
