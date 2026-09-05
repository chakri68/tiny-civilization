import type { BiomeId, ResId, Tile } from './types.ts';
import { NONE } from './types.ts';
import { BIOME, biomeFor } from './biomes.ts';
import { fbm } from './noise.ts';
import { hashUnit } from './rng.ts';
import { neighbors } from './hex.ts';
import {
  COAST_BAND,
  HILL_LEVEL,
  MOUNTAIN_LEVEL,
  RIVER_COUNT,
  SEA_LEVEL,
} from './constants.ts';

export function elevBandOf(e: number): number {
  if (e < SEA_LEVEL) return 0;
  if (e < COAST_BAND) return 1;
  if (e < HILL_LEVEL) return 2;
  if (e < MOUNTAIN_LEVEL) return 3;
  return 4;
}

/**
 * Terrain in one pass over five fields: elevation, temperature, moisture
 * (with a rain shadow), biome, then rivers and resources on top.
 * Deterministic in `seed` alone — no RNG stream is consumed.
 */
export function generateTiles(seed: number, w: number, h: number): Tile[] {
  const n = w * h;
  const tiles: Tile[] = new Array(n);
  const elev = new Float64Array(n);
  const scale = 0.075;

  // --- elevation, with an edge falloff so the world sits in open water -------
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const base = fbm(seed, x * scale, y * scale, 4);
      const nx = (x / (w - 1)) * 2 - 1;
      const ny = (y / (h - 1)) * 2 - 1;
      const d = Math.sqrt(nx * nx * 0.85 + ny * ny * 1.15);
      const falloff = 1 - Math.min(1, Math.max(0, (d - 0.44) / 0.5));
      // Bias upward slightly so the interior is mostly land, not archipelago.
      elev[i] = Math.min(1, Math.max(0, (base * 1.24 - 0.13) * (0.3 + 0.7 * falloff)));
    }
  }

  // --- prevailing wind runs west to east; mountains eat the moisture --------
  const wind = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    let carry = 1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const band = elevBandOf(elev[i]);
      if (band === 0) carry = 1;
      else if (band >= 4) carry *= 0.5;
      else if (band === 3) carry *= 0.88;
      else carry *= 0.985;
      wind[i] = carry;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      const band = elevBandOf(e);
      // Temperature: warm at the equator (mid-map), cold at the poles and up high.
      const lat = Math.abs((y / (h - 1)) * 2 - 1);
      const temp = Math.min(1, Math.max(0, 1.04 - lat * 1.15 - Math.max(0, e - SEA_LEVEL) * 0.7));
      const mNoise = fbm(seed ^ 0x5bf0, x * 0.09, y * 0.09, 3);
      const moisture = Math.min(1, Math.max(0, 0.45 * mNoise + 0.55 * wind[i]));
      let biome: BiomeId;
      if (band === 0) biome = 'ocean';
      else if (band === 1) biome = 'coast';
      else biome = biomeFor(temp, moisture, band);
      tiles[i] = {
        biome,
        elev: e,
        moisture,
        temp,
        fertility: 0,
        resources: [],
        river: false,
        coastal: false,
        owner: NONE,
        settlement: NONE,
      };
    }
  }

  markCoastal(tiles, w, h);
  carveRivers(tiles, elev, seed, w, h);
  scatterResources(tiles, seed, w, h);
  computeFertility(tiles, w, h);
  return tiles;
}

function markCoastal(tiles: Tile[], w: number, h: number): void {
  const buf: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].biome === 'ocean') continue;
    const c = neighbors(w, h, i, buf);
    for (let k = 0; k < c; k++) {
      if (tiles[buf[k]].biome === 'ocean') {
        tiles[i].coastal = true;
        break;
      }
    }
  }
}

/**
 * Pick high tiles, walk downhill by steepest descent. A path that dead-ends in
 * a basin floods it into a lake, which is where a good few settlements end up.
 */
function carveRivers(tiles: Tile[], elev: Float64Array, seed: number, w: number, h: number): void {
  const candidates: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (elev[i] > HILL_LEVEL && tiles[i].biome !== 'ocean') candidates.push(i);
  }
  if (candidates.length === 0) return;
  const buf: number[] = [];
  for (let r = 0; r < RIVER_COUNT; r++) {
    let cur = candidates[Math.floor(hashUnit(seed, r, 0x1234) * candidates.length)];
    const seen = new Set<number>();
    for (let step = 0; step < 400; step++) {
      const t = tiles[cur];
      if (t.biome === 'ocean' || t.biome === 'lake') break;
      if (seen.has(cur)) break;
      seen.add(cur);
      t.river = true;
      const c = neighbors(w, h, cur, buf);
      let best = -1;
      let bestE = elev[cur];
      for (let k = 0; k < c; k++) {
        const j = buf[k];
        if (elev[j] < bestE) {
          bestE = elev[j];
          best = j;
        }
      }
      if (best < 0) {
        // Local minimum: pool it, unless the source was barely a trickle.
        if (step > 3 && t.biome !== 'coast') t.biome = 'lake';
        break;
      }
      cur = best;
    }
  }
}

function scatterResources(tiles: Tile[], seed: number, w: number, h: number): void {
  const buf: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const def = BIOME[t.biome];
    const out: ResId[] = [];
    for (let k = 0; k < def.resources.length; k++) {
      const [res, prob] = def.resources[k];
      if (hashUnit(seed ^ 0x7f2a, i, k) < prob) out.push(res);
    }
    // Ore weathers downhill: tiles beside mountains get a second look.
    if (t.biome !== 'ocean' && t.biome !== 'alpine') {
      const c = neighbors(w, h, i, buf);
      for (let k = 0; k < c; k++) {
        if (tiles[buf[k]].biome !== 'alpine') continue;
        if (hashUnit(seed ^ 0x3311, i, 90) < 0.16 && !out.includes('copper')) out.push('copper');
        if (hashUnit(seed ^ 0x3312, i, 91) < 0.1 && !out.includes('iron')) out.push('iron');
        if (hashUnit(seed ^ 0x3313, i, 92) < 0.07 && !out.includes('tin')) out.push('tin');
        break;
      }
    }
    t.resources = out;
  }
}

/**
 * What a tile would support if nobody had been farming it for a century.
 * `moistureShift` lets the landscape phase ask the same question under a
 * wetter or drier climate than the one the world was generated in.
 */
export function naturalFertility(t: Tile, moistureShift = 0): number {
  let f = BIOME[t.biome].fertility;
  if (t.river) f += 0.3;
  if (t.coastal) f += 0.08;
  if (t.resources.includes('fish')) f += 0.06;
  const moisture = Math.min(1, Math.max(0, t.moisture + moistureShift));
  // A dry tile with water running through it is still worth farming.
  f *= 0.75 + 0.35 * moisture;
  return Math.min(1, Math.max(0, f));
}

function computeFertility(tiles: Tile[], w: number, h: number): void {
  void w;
  void h;
  for (const t of tiles) t.fertility = naturalFertility(t);
}

export interface FoundingSite {
  tile: number;
  score: number;
}

/** Best distinct river/coast tiles, greedily spread apart. */
export function foundingSites(
  tiles: Tile[],
  w: number,
  h: number,
  count: number,
  separation: number,
  hexDist: (a: number, b: number) => number,
): number[] {
  void h;
  void w;
  const scored: FoundingSite[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!BIOME[t.biome].passable || t.biome === 'lake') continue;
    if (t.fertility < 0.35) continue;
    let score = t.fertility * 2;
    if (t.river) score += 0.6;
    if (t.coastal) score += 0.35;
    score += t.resources.length * 0.1;
    scored.push({ tile: i, score });
  }
  // Ties break on tile index, so the order is fully determined by the seed.
  scored.sort((a, b) => b.score - a.score || a.tile - b.tile);
  const chosen: number[] = [];
  for (const c of scored) {
    if (chosen.length >= count) break;
    let ok = true;
    for (const p of chosen) {
      if (hexDist(c.tile, p) < separation) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(c.tile);
  }
  return chosen;
}
