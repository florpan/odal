import { useMemo } from 'react';
import { describeEffect, idx, refKey } from '@odal/engine';
import type { Ref, TechDef, TechTree } from '@odal/engine';
import type { RefStatus } from './TechTreeGraph';
import './tree.css';

// ---------------------------------------------------------------------------
// The tech tree as a Civilization-style timeline: one column per tier, a card
// per tech, dashed connectors from prerequisite to dependent, and on every
// card a row of chips for what it unlocks. Scrolls sideways. This is the
// in-game research screen; the editor keeps the free graph (TechTreeGraph).
// Everything shown is derived from the TechTree.
// ---------------------------------------------------------------------------

export interface TechTimelineProps {
  tree: TechTree;
  /** refKey → status; omit for a neutral view. */
  status?: Record<string, RefStatus>;
  /** refKey → 0..1, research progress of techs in progress. */
  progress?: Record<string, number>;
  /** refKey of the selected item (a tech card or an unlock chip). */
  selected?: string | null;
  onSelect?: (ref: Ref) => void;
}

const COL_W = 320;
const CARD_W = 262;
const CARD_H = 100;
const ROW_H = 122;
const PAD_X = 28;
const HEAD_H = 44;
const PAD_Y = 14;

interface Card {
  tech: TechDef;
  col: number;
  row: number;
  x: number;
  y: number;
  /** Tech ids this one follows: listed in `requires`, or required by the building that researches it. */
  from: string[];
  unlocks: Ref[];
  at: string[];
}

interface Layout {
  cols: number;
  rows: number;
  cards: Card[];
  start: Ref[];
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function shortCost(tree: TechTree, cost: Record<string, number>): string {
  const i = idx(tree);
  return i.resourceIds
    .filter((r) => (cost[r] ?? 0) > 0)
    .map((r) => `${i.resources[r].icon || r} ${cost[r]}`)
    .join(' ');
}

/** Tier = length of the longest chain of techs that has to come first. Buildings pass their tier on. */
function tierFn(tree: TechTree): (ref: Ref) => number {
  const i = idx(tree);
  const memo = new Map<string, number>();
  const tierOf = (ref: Ref): number => {
    const k = refKey(ref);
    const known = memo.get(k);
    if (known !== undefined) return known;
    memo.set(k, 0); // cycle guard; the validator rejects real cycles
    const def = ref.kind === 'tech' ? i.techs[ref.id] : ref.kind === 'building' ? i.buildings[ref.id] : i.units[ref.id];
    let t = 0;
    for (const r of def?.requires ?? []) {
      if (r.type === 'tech') t = Math.max(t, tierOf({ kind: 'tech', id: r.id }) + 1);
      else if (r.type === 'building') t = Math.max(t, tierOf({ kind: 'building', id: r.id }));
    }
    if (ref.kind === 'tech')
      for (const b of tree.buildings)
        if (b.researches.includes(ref.id)) t = Math.max(t, tierOf({ kind: 'building', id: b.id }));
    if (ref.kind === 'unit')
      for (const b of tree.buildings)
        if (b.trains.includes(ref.id)) t = Math.max(t, tierOf({ kind: 'building', id: b.id }));
    memo.set(k, t);
    return t;
  };
  return tierOf;
}

function layout(tree: TechTree): Layout {
  const tierOf = tierFn(tree);
  const byId = new Map<string, Card>();
  const cards: Card[] = tree.techs.map((tech) => {
    const from = new Set<string>();
    const at: string[] = [];
    for (const r of tech.requires) if (r.type === 'tech') from.add(r.id);
    for (const b of tree.buildings) {
      if (!b.researches.includes(tech.id)) continue;
      at.push(b.name);
      for (const r of b.requires) if (r.type === 'tech') from.add(r.id);
    }
    const needs = (reqs: { type: string; id?: string }[]) => reqs.some((r) => r.type === 'tech' && r.id === tech.id);
    const unlocks: Ref[] = [
      ...tree.units.filter((u) => needs(u.requires)).map((u): Ref => ({ kind: 'unit', id: u.id })),
      ...tree.buildings.filter((b) => needs(b.requires)).map((b): Ref => ({ kind: 'building', id: b.id })),
      ...tree.techs.filter((t) => needs(t.requires)).map((t): Ref => ({ kind: 'tech', id: t.id })),
    ];
    const card: Card = {
      tech,
      col: tierOf({ kind: 'tech', id: tech.id }) + 1,
      row: 0,
      x: 0,
      y: 0,
      from: [...from],
      unlocks,
      at,
    };
    byId.set(tech.id, card);
    return card;
  });

  // Rows: keep a tech near the techs it follows, then alphabetical. Column 0 is the "from the start" card.
  const cols = Math.max(2, ...cards.map((c) => c.col + 1));
  let rows = 1;
  for (let col = 1; col < cols; col++) {
    const inCol = cards.filter((c) => c.col === col);
    const anchor = (c: Card) => {
      const prev = c.from.map((id) => byId.get(id)).filter((p): p is Card => !!p && p.col < col);
      return prev.length ? prev.reduce((s, p) => s + p.row, 0) / prev.length : Number.MAX_SAFE_INTEGER;
    };
    inCol.sort((a, b) => anchor(a) - anchor(b) || a.tech.name.localeCompare(b.tech.name));
    inCol.forEach((c, row) => {
      c.row = row;
      c.x = col * COL_W + PAD_X;
      c.y = HEAD_H + PAD_Y + row * ROW_H;
    });
    rows = Math.max(rows, inCol.length);
  }

  // Obtainable without any research: shown once, in the first column.
  const start: Ref[] = [
    ...tree.units
      .filter((u) => tierOf({ kind: 'unit', id: u.id }) === 0 && tree.buildings.some((b) => b.trains.includes(u.id)))
      .map((u): Ref => ({ kind: 'unit', id: u.id })),
    ...tree.buildings
      .filter((b) => tierOf({ kind: 'building', id: b.id }) === 0 && (b.buildable || b.id === tree.start.building))
      .map((b): Ref => ({ kind: 'building', id: b.id })),
  ];
  return { cols, rows, cards, start };
}

export function TechTimeline({ tree, status, progress, selected, onSelect }: TechTimelineProps) {
  const lay = useMemo(() => layout(tree), [tree]);
  const i = idx(tree);
  const width = lay.cols * COL_W + PAD_X;
  const height = HEAD_H + PAD_Y * 2 + Math.max(lay.rows, 1) * ROW_H;
  const byId = new Map(lay.cards.map((c) => [c.tech.id, c]));
  const st = (ref: Ref) => status?.[refKey(ref)];
  const nameOf = (ref: Ref) =>
    (ref.kind === 'unit' ? i.units[ref.id] : ref.kind === 'building' ? i.buildings[ref.id] : i.techs[ref.id])?.name ??
    ref.id;

  const chip = (ref: Ref) => {
    const k = refKey(ref);
    return (
      <button
        key={k}
        type="button"
        className={`tl-chip kind-${ref.kind} ${st(ref) ?? ''}${selected === k ? ' is-selected' : ''}`}
        title={`${ref.kind}: ${nameOf(ref)}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(ref);
        }}
      >
        {nameOf(ref)}
      </button>
    );
  };

  return (
    <div
      className="timeline"
      onWheel={(e) => {
        // Sideways is the main axis; a plain wheel scrolls the timeline, Shift keeps the browser default.
        if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
      }}
    >
      <div className="timeline-canvas" style={{ width, height }}>
        <div className="tl-heads">
          {Array.from({ length: lay.cols }, (_, c) => (
            <div key={c} className="tl-head" style={{ width: COL_W }}>
              {c === 0 ? 'From the start' : `Tier ${ROMAN[c] ?? c}`}
            </div>
          ))}
        </div>

        <svg className="tl-edges" width={width} height={height}>
          {lay.cards.flatMap((card) =>
            card.from.map((id) => {
              const src = byId.get(id);
              if (!src) return null;
              const x1 = src.x + CARD_W;
              const y1 = src.y + CARD_H / 2;
              const x2 = card.x;
              const y2 = card.y + CARD_H / 2;
              const xm = x1 + (x2 - x1) / 2;
              const touching =
                selected === refKey({ kind: 'tech', id: card.tech.id }) ||
                selected === refKey({ kind: 'tech', id: id });
              const done = st({ kind: 'tech', id }) === 'owned';
              return (
                <path
                  key={`${id}->${card.tech.id}`}
                  className={`tl-edge${touching ? ' is-touching' : ''}${done ? ' is-done' : ''}`}
                  d={`M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`}
                />
              );
            }),
          )}
        </svg>

        <div className="tl-card tl-start" style={{ left: PAD_X, top: HEAD_H + PAD_Y, width: CARD_W }}>
          <div className="tl-medal">✦</div>
          <div className="tl-body">
            <div className="tl-title">
              <span className="tl-name">No research needed</span>
            </div>
            <div className="tl-unlocks">{lay.start.map(chip)}</div>
          </div>
        </div>

        {lay.cards.map((card) => {
          const ref: Ref = { kind: 'tech', id: card.tech.id };
          const k = refKey(ref);
          const s = st(ref);
          const pct = progress?.[k];
          return (
            <div
              key={k}
              className={`tl-card ${s ?? ''}${selected === k ? ' is-selected' : ''}`}
              style={{ left: card.x, top: card.y, width: CARD_W }}
              onClick={() => onSelect?.(ref)}
              title={card.tech.desc}
            >
              <div className="tl-medal">{card.tech.name.slice(0, 1)}</div>
              <div className="tl-body">
                <div className="tl-title">
                  <span className="tl-name">{card.tech.name}</span>
                  <span className="tl-cost">
                    {shortCost(tree, card.tech.cost)} · {card.tech.time}s
                  </span>
                </div>
                <div className="tl-at">{card.at.length ? `at ${card.at.join(', ')}` : 'not researched anywhere'}</div>
                <div className="tl-unlocks">
                  {card.unlocks.length ? (
                    card.unlocks.map(chip)
                  ) : (
                    <span className="tl-none">
                      {card.tech.effects.length
                        ? card.tech.effects.map((e) => describeEffect(tree, e)).join(' · ')
                        : 'no unlocks'}
                    </span>
                  )}
                </div>
                {s === 'inProgress' && (
                  <div className="tl-progress">
                    <div style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
