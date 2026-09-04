import type { NodeDefInput } from '@odal/engine';

export const nodes: NodeDefInput[] = [
  {
    id: 'tree',
    name: 'Tree',
    resource: 'lumber',
    amount: 40,
    gatherTime: 4,
    gatherAmount: 10,
    spawn: { kind: 'forest', clustersPer1000Tiles: 5.5, radius: [3, 8] },
    visual: { shape: 'cone', color: '#2e7d32' },
  },
  {
    id: 'iron',
    name: 'Iron rock',
    resource: 'iron',
    amount: 100,
    gatherTime: 6,
    gatherAmount: 10,
    spawn: { kind: 'deposit', depositsPer1000Tiles: 2.5, size: [4, 7] },
    visual: { shape: 'rock', color: '#8a8f98' },
  },
  {
    id: 'gold',
    name: 'Gold rock',
    resource: 'gold',
    amount: 100,
    gatherTime: 6,
    gatherAmount: 10,
    spawn: { kind: 'deposit', depositsPer1000Tiles: 1.65, size: [3, 6] },
    visual: { shape: 'rock', color: '#f5c518' },
  },
];
