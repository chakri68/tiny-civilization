import type { Id, Notable, Polity, Religion, Settlement, Tile, War, World } from './types.ts';
import { BIOMES, NONE, RESOURCES, type BiomeId, type ResId } from './types.ts';
import { cloneRng, randInt, seedRng, type RngState } from './rng.ts';
import { generateTiles, foundingSites } from './worldgen.ts';
import { hexDistance } from './hex.ts';
import { createNotable, createPolity, createSettlement, freshCulture } from './factory.ts';
import { emit } from './chronicle.ts';
import {
  START_BANDS_MAX,
  START_BANDS_MIN,
  START_POP_MAX,
  START_POP_MIN,
  START_SEPARATION,
  WORLD_H,
  WORLD_W,
} from './constants.ts';

// 2: settlements carry their own tech sets.
export const WORLD_VERSION = 2;

function emptyWorld(seed: number, name: string, w: number, h: number, rng: RngState): World {
  return {
    version: WORLD_VERSION,
    id: `w${seed >>> 0}-${w}x${h}`,
    name,
    seed: seed >>> 0,
    tick: 0,
    rng,
    w,
    h,
    tiles: [],
    settlements: new Map(),
    polities: new Map(),
    notables: new Map(),
    religions: new Map(),
    wars: new Map(),
    roads: new Set(),
    roadRoutes: new Set(),
    traffic: new Map(),
    chronicle: [],
    eras: [],
    techs: new Map(),
    stats: { tick: [], pop: [], polities: [], settlements: [], techs: [], wars: [], religions: [] },
    counters: {
      peakPop: 0,
      politiesEver: 0,
      settlementsEver: 0,
      warsEver: 0,
      religionsEver: 0,
      notablesEver: 0,
      techsEver: 0,
      disastersEver: 0,
    },
    nextId: 1,
    nextEventId: 1,
    createdAt: 0,
  };
}

export function createWorld(
  seed: number,
  name = 'Unnamed',
  w = WORLD_W,
  h = WORLD_H,
): World {
  const rng = seedRng(seed);
  const world = emptyWorld(seed, name, w, h, rng);
  world.tiles = generateTiles(world.seed, w, h);

  const bandCount = START_BANDS_MIN + randInt(rng, START_BANDS_MAX - START_BANDS_MIN + 1);
  const sites = foundingSites(world.tiles, w, h, bandCount, START_SEPARATION, (a, b) =>
    hexDistance(w, a, b),
  );

  for (const tile of sites) {
    const phonSeed = randInt(rng, 1 << 30);
    const polity = createPolity(world, tile, freshCulture(rng), NONE, phonSeed);
    const pop = START_POP_MIN + randInt(rng, START_POP_MAX - START_POP_MIN + 1);
    const s = createSettlement(world, tile, polity.id, pop);
    const founder = createNotable(world, 'founder', polity.id, s.id, rng);
    polity.ruler = founder.id;
    emit(
      world,
      'found_polity',
      3,
      [polity.id, s.id, founder.id],
      tile,
      `${founder.name} led a band to the water at ${s.name}. They called themselves ${polity.name}.`,
    );
  }
  return world;
}

// --- persistence format ------------------------------------------------------
// Typed arrays for the grid (exact float round-trip, ~250 KB), plain arrays for
// everything else. Structured-clone-able by construction.

export interface WorldSave {
  version: number;
  id: string;
  name: string;
  seed: number;
  tick: number;
  rng: RngState;
  w: number;
  h: number;
  tiles: {
    biome: Uint8Array;
    flags: Uint8Array;
    res: Uint8Array;
    elev: Float64Array;
    moisture: Float64Array;
    temp: Float64Array;
    fertility: Float64Array;
    owner: Int32Array;
    settlement: Int32Array;
  };
  settlements: unknown[];
  polities: unknown[];
  notables: unknown[];
  religions: unknown[];
  wars: unknown[];
  roads: number[];
  roadRoutes: number[];
  traffic: [number, number][];
  chronicle: unknown[];
  eras: unknown[];
  techs: [Id, string[]][];
  stats: World['stats'];
  counters: World['counters'];
  nextId: number;
  nextEventId: number;
  createdAt: number;
  savedAt: number;
}

const BIOME_INDEX = new Map<BiomeId, number>(BIOMES.map((b, i) => [b, i]));
const RES_INDEX = new Map<ResId, number>(RESOURCES.map((r, i) => [r, i]));

export function serializeWorld(w: World): WorldSave {
  const n = w.tiles.length;
  const biome = new Uint8Array(n);
  const flags = new Uint8Array(n);
  const res = new Uint8Array(n);
  const elev = new Float64Array(n);
  const moisture = new Float64Array(n);
  const temp = new Float64Array(n);
  const fertility = new Float64Array(n);
  const owner = new Int32Array(n);
  const settlement = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = w.tiles[i];
    biome[i] = BIOME_INDEX.get(t.biome)!;
    flags[i] = (t.river ? 1 : 0) | (t.coastal ? 2 : 0);
    let mask = 0;
    for (const r of t.resources) mask |= 1 << RES_INDEX.get(r)!;
    res[i] = mask;
    elev[i] = t.elev;
    moisture[i] = t.moisture;
    temp[i] = t.temp;
    fertility[i] = t.fertility;
    owner[i] = t.owner;
    settlement[i] = t.settlement;
  }
  return {
    version: w.version,
    id: w.id,
    name: w.name,
    seed: w.seed,
    tick: w.tick,
    rng: cloneRng(w.rng),
    w: w.w,
    h: w.h,
    tiles: { biome, flags, res, elev, moisture, temp, fertility, owner, settlement },
    settlements: Array.from(w.settlements.values()).map((s) => ({
      ...s,
      stock: { ...s.stock },
      culture: s.culture.slice(),
      partners: s.partners.slice(),
      partnerComp: s.partnerComp.slice(),
      partnerDist: s.partnerDist.slice(),
      techs: Array.from(s.techs),
    })),
    polities: Array.from(w.polities.values()).map((p) => ({
      ...p,
      settlements: Array.from(p.settlements),
      wars: Array.from(p.wars),
      grievance: Array.from(p.grievance.entries()),
      culture: p.culture.slice(),
    })),
    notables: Array.from(w.notables.values()).map((nn) => ({ ...nn, deeds: nn.deeds.slice() })),
    religions: Array.from(w.religions.values()).map((r) => ({ ...r, tenets: r.tenets.slice() })),
    wars: Array.from(w.wars.entries()).map(([k, v]) => [k, { ...v }]),
    roads: Array.from(w.roads),
    roadRoutes: Array.from(w.roadRoutes),
    traffic: Array.from(w.traffic.entries()),
    chronicle: w.chronicle.map((e) => ({ ...e, subjects: e.subjects.slice() })),
    eras: w.eras.map((e) => ({ ...e, highlights: e.highlights.map((h) => ({ ...h })) })),
    techs: Array.from(w.techs.entries()).map(([k, v]) => [k, Array.from(v)]),
    stats: {
      tick: w.stats.tick.slice(),
      pop: w.stats.pop.slice(),
      polities: w.stats.polities.slice(),
      settlements: w.stats.settlements.slice(),
      techs: w.stats.techs.slice(),
      wars: w.stats.wars.slice(),
      religions: w.stats.religions.slice(),
    },
    counters: { ...w.counters },
    nextId: w.nextId,
    nextEventId: w.nextEventId,
    createdAt: w.createdAt,
    savedAt: Date.now(),
  };
}

export function deserializeWorld(save: WorldSave): World {
  const world = emptyWorld(save.seed, save.name, save.w, save.h, cloneRng(save.rng));
  world.version = save.version;
  world.id = save.id;
  world.tick = save.tick;
  world.createdAt = save.createdAt;
  world.nextId = save.nextId;
  world.nextEventId = save.nextEventId;
  world.counters = { ...save.counters };
  world.stats = save.stats;

  const n = save.w * save.h;
  const t = save.tiles;
  const tiles: Tile[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const resources: ResId[] = [];
    for (let k = 0; k < RESOURCES.length; k++) if (t.res[i] & (1 << k)) resources.push(RESOURCES[k]);
    tiles[i] = {
      biome: BIOMES[t.biome[i]],
      elev: t.elev[i],
      moisture: t.moisture[i],
      temp: t.temp[i],
      fertility: t.fertility[i],
      resources,
      river: (t.flags[i] & 1) !== 0,
      coastal: (t.flags[i] & 2) !== 0,
      owner: t.owner[i],
      settlement: t.settlement[i],
    };
  }
  world.tiles = tiles;

  // Insertion order is ascending id in a live world; restore it that way so
  // Map iteration order survives a save/load round trip.
  type SettlementSave = Omit<Settlement, 'techs'> & { techs?: string[] };
  const settlements = (save.settlements as SettlementSave[]).slice().sort((a, b) => a.id - b.id);
  for (const s of settlements) {
    // A version-1 save has no per-settlement techs; those worlds knew everything
    // everywhere, so seeding from the realm keeps them behaving as they did.
    const own = s.techs ?? Array.from(world.techs.get(s.polity) ?? []);
    world.settlements.set(s.id, { ...s, stock: { ...s.stock }, techs: new Set(own) });
  }

  type PolitySave = Omit<Polity, 'settlements' | 'wars' | 'grievance'> & {
    settlements: Id[];
    wars: Id[];
    grievance: [Id, number][];
  };
  const polities = (save.polities as PolitySave[]).slice().sort((a, b) => a.id - b.id);
  for (const p of polities) {
    world.polities.set(p.id, {
      ...p,
      settlements: new Set(p.settlements),
      wars: new Set(p.wars),
      grievance: new Map(p.grievance),
    });
  }
  for (const nn of (save.notables as Notable[]).slice().sort((a, b) => a.id - b.id)) {
    world.notables.set(nn.id, nn);
  }
  for (const r of (save.religions as Religion[]).slice().sort((a, b) => a.id - b.id)) {
    world.religions.set(r.id, r);
  }
  for (const [k, v] of save.wars as [number, War][]) world.wars.set(k, v);
  world.roads = new Set(save.roads);
  world.roadRoutes = new Set(save.roadRoutes ?? []);
  world.traffic = new Map(save.traffic);
  world.chronicle = save.chronicle as World['chronicle'];
  world.eras = save.eras as World['eras'];
  for (const [k, v] of save.techs) world.techs.set(k, new Set(v));
  return world;
}

export function totalPop(w: World): number {
  let p = 0;
  for (const s of w.settlements.values()) p += s.pop;
  return Math.round(p);
}

export function totalTechs(w: World): number {
  let t = 0;
  for (const set of w.techs.values()) t += set.size;
  return t;
}
