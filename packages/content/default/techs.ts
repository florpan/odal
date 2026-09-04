import type { TechDefInput } from '@odal/engine';

export const techs: TechDefInput[] = [
  {
    id: 'ironworking',
    name: 'Ironworking',
    desc: 'Unlocks the Barracks.',
    cost: { gold: 30 },
    time: 20,
  },
  {
    id: 'sharp_axes',
    name: 'Sharpened Axes',
    desc: 'Workers cut lumber 50% faster.',
    cost: { gold: 20, iron: 10 },
    time: 15,
    effects: [{ type: 'gatherRate', resource: 'lumber', multiplier: 1.5 }],
  },
  {
    id: 'crop_rotation',
    name: 'Crop Rotation',
    desc: 'Farms grow wheat 50% faster.',
    cost: { gold: 20, lumber: 20 },
    time: 15,
    effects: [{ type: 'produceRate', building: 'farm', multiplier: 1.5 }],
  },
  {
    id: 'steel_weapons',
    name: 'Steel Weapons',
    desc: 'Soldiers deal 50% more damage.',
    cost: { gold: 40, iron: 30 },
    time: 25,
    requires: [{ type: 'tech', id: 'ironworking' }],
    effects: [{ type: 'damage', unit: 'soldier', multiplier: 1.5 }],
  },
];
