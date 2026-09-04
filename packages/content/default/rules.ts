import type { RulesInput, StartInput } from '@odal/engine';

export const name = 'Default';
export const version = 1 as const;

export const rules = {
  tickRate: 10,
  map: { width: 64, height: 64 },
  startResources: { lumber: 60, iron: 0, gold: 20, wheat: 40 },
  maxQueue: 5,
  separationDist: 0.6,
  startClearRadius: 4,
  // Units pay their `upkeep` this often (seconds).
  upkeepInterval: 60,
  playerColors: ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'],
} satisfies RulesInput;

export const start = {
  building: 'campfire',
  units: [{ type: 'worker', count: 1 }],
} satisfies StartInput;
