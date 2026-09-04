import type { UnitDefInput } from '@odal/engine';

export const units: UnitDefInput[] = [
  {
    id: 'worker',
    name: 'Worker',
    desc: 'Harvests resources and constructs buildings.',
    cost: { wheat: 20 },
    time: 8,
    hp: 30,
    speed: 3,
    damage: 2,
    range: 1,
    aggro: 0,
    vision: 6,
    upkeep: {},
    abilities: ['harvest', 'build', 'attack'],
    visual: { width: 0.4, height: 1.0 },
  },
  {
    id: 'soldier',
    name: 'Soldier',
    desc: 'Fights. Attacks enemies that come close.',
    cost: { wheat: 20, iron: 15 },
    time: 12,
    // Barracks trains it, and the barracks already needs Ironworking; listing
    // the tech here as well keeps the unit's own card honest in the tree view.
    requires: [{ type: 'tech', id: 'ironworking' }],
    hp: 60,
    speed: 2.6,
    damage: 8,
    range: 1.2,
    aggro: 6,
    vision: 6,
    // An army eats: 1 wheat per soldier per upkeep interval.
    upkeep: { wheat: 1 },
    abilities: ['attack'],
    visual: { width: 0.5, height: 1.2, helmet: true },
  },
];
