import type { BiomeId, ResId } from './types.ts';

export interface BiomeDef {
  id: BiomeId;
  label: string;
  fertility: number;
  moveCost: number;
  /** Candidate resources, each with a per-tile probability. */
  resources: readonly (readonly [ResId, number])[];
  /** Map colour, HSL. Dark and a little desaturated so the amber UI still leads. */
  h: number;
  s: number;
  l: number;
  passable: boolean;
}

export const BIOME: Record<BiomeId, BiomeDef> = {
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    fertility: 0,
    moveCost: 999,
    resources: [['fish', 0.08]],
    h: 212,
    s: 48,
    l: 11,
    passable: false,
  },
  lake: {
    id: 'lake',
    label: 'Lake',
    fertility: 0,
    moveCost: 999,
    resources: [['fish', 0.3]],
    h: 198,
    s: 45,
    l: 24,
    passable: false,
  },
  coast: {
    id: 'coast',
    label: 'Shore',
    fertility: 0.42,
    moveCost: 1,
    resources: [
      ['fish', 0.35],
      ['salt', 0.12],
    ],
    h: 44,
    s: 42,
    l: 46,
    passable: true,
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    fertility: 0.06,
    moveCost: 1.6,
    resources: [
      ['salt', 0.14],
      ['copper', 0.05],
      ['stone', 0.1],
    ],
    h: 41,
    s: 52,
    l: 54,
    passable: true,
  },
  steppe: {
    id: 'steppe',
    label: 'Steppe',
    fertility: 0.32,
    moveCost: 0.9,
    resources: [
      ['horses', 0.16],
      ['copper', 0.05],
      ['stone', 0.06],
    ],
    h: 58,
    s: 26,
    l: 42,
    passable: true,
  },
  grassland: {
    id: 'grassland',
    label: 'Grassland',
    fertility: 0.86,
    moveCost: 1,
    resources: [
      ['horses', 0.07],
      ['stone', 0.05],
    ],
    h: 92,
    s: 34,
    l: 36,
    passable: true,
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    fertility: 0.6,
    moveCost: 1.5,
    resources: [
      ['timber', 0.45],
      ['iron', 0.05],
      ['copper', 0.04],
    ],
    h: 133,
    s: 30,
    l: 24,
    passable: true,
  },
  taiga: {
    id: 'taiga',
    label: 'Taiga',
    fertility: 0.24,
    moveCost: 1.7,
    resources: [
      ['timber', 0.4],
      ['iron', 0.06],
    ],
    h: 163,
    s: 22,
    l: 21,
    passable: true,
  },
  tundra: {
    id: 'tundra',
    label: 'Tundra',
    fertility: 0.08,
    moveCost: 1.5,
    resources: [['stone', 0.06]],
    h: 205,
    s: 7,
    l: 44,
    passable: true,
  },
  wetland: {
    id: 'wetland',
    label: 'Wetland',
    fertility: 0.7,
    moveCost: 2.2,
    resources: [
      ['fish', 0.2],
      ['timber', 0.15],
    ],
    h: 152,
    s: 26,
    l: 29,
    passable: true,
  },
  alpine: {
    id: 'alpine',
    label: 'Mountain',
    fertility: 0.02,
    moveCost: 4.5,
    resources: [
      ['stone', 0.4],
      ['copper', 0.12],
      ['tin', 0.09],
      ['iron', 0.12],
    ],
    h: 28,
    s: 9,
    l: 63,
    passable: true,
  },
};

export interface ResourceDef {
  id: ResId;
  label: string;
  /** Value per unit in trade. */
  value: number;
}

export const RESOURCE: Record<ResId, ResourceDef> = {
  stone: { id: 'stone', label: 'Stone', value: 1 },
  copper: { id: 'copper', label: 'Copper', value: 2.2 },
  tin: { id: 'tin', label: 'Tin', value: 3 },
  iron: { id: 'iron', label: 'Iron', value: 2.6 },
  salt: { id: 'salt', label: 'Salt', value: 2.4 },
  horses: { id: 'horses', label: 'Horses', value: 2.8 },
  fish: { id: 'fish', label: 'Fish', value: 1.2 },
  timber: { id: 'timber', label: 'Timber', value: 1.4 },
};

/** The single source of truth for what a tile looks like, map and fossil alike. */
export function tileShade(
  biome: BiomeId,
  river: boolean,
  elev: number,
): { h: number; s: number; l: number } {
  const def = BIOME[biome];
  // Height shades the tile and a river brightens and cools it, so relief and
  // water read without needing a separate layer.
  let l = def.l + (elev - 0.5) * 9;
  let h = def.h;
  let sat = def.s;
  if (river) {
    // A hint of water, not a stripe of it: whole-tile rivers get gaudy fast,
    // especially where a dozen of them braid through the same highland.
    l += 4;
    h = h > 100 && h < 250 ? h : 190;
    sat = Math.min(38, sat + 9);
  }
  return { h, s: sat, l: Math.max(4, Math.min(72, l)) };
}

/**
 * Whittaker-ish lookup. The spec keys biome on (elevation, moisture); taiga and
 * tundra need cold, so temperature (latitude, minus elevation) is the third input.
 */
export function biomeFor(temp: number, moisture: number, elevBand: number): BiomeId {
  if (elevBand >= 4) return 'alpine';
  if (temp < 0.2) return 'tundra';
  if (temp < 0.36) return moisture > 0.42 ? 'taiga' : 'tundra';
  if (moisture < 0.22) return temp > 0.62 ? 'desert' : 'steppe';
  if (moisture < 0.42) return 'steppe';
  if (moisture < 0.62) return 'grassland';
  if (moisture < 0.86) return temp > 0.34 ? 'forest' : 'taiga';
  return elevBand <= 2 ? 'wetland' : 'forest';
}
