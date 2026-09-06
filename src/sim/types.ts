import type { RngState } from './rng.ts';

export type Id = number;
export const NONE = -1;

// --- culture -----------------------------------------------------------------
// The one abstraction driving everything qualitative. Six axes, each in [0,1].
export const CULTURE_AXES = [
  'martial',
  'mercantile',
  'spiritual',
  'scholarly',
  'communal',
  'expansionist',
] as const;
export type CultureAxis = (typeof CULTURE_AXES)[number];
export type CultureVec = number[]; // length 6, indexed by CULT

export const CULT = {
  martial: 0,
  mercantile: 1,
  spiritual: 2,
  scholarly: 3,
  communal: 4,
  expansionist: 5,
} as const;

// --- terrain -----------------------------------------------------------------
export const BIOMES = [
  'ocean',
  'lake',
  'coast',
  'desert',
  'steppe',
  'grassland',
  'forest',
  'taiga',
  'tundra',
  'wetland',
  'alpine',
] as const;
export type BiomeId = (typeof BIOMES)[number];

export const RESOURCES = [
  'stone',
  'copper',
  'tin',
  'iron',
  'salt',
  'horses',
  'fish',
  'timber',
] as const;
export type ResId = (typeof RESOURCES)[number];
export type Stock = Record<ResId, number>;

export interface Tile {
  biome: BiomeId;
  elev: number;
  moisture: number;
  temp: number;
  fertility: number;
  resources: ResId[];
  river: boolean;
  coastal: boolean;
  owner: Id; // NONE if unclaimed
  settlement: Id; // NONE if empty
}

// --- polities and people -----------------------------------------------------
export type Tier = 'camp' | 'village' | 'town' | 'city';
export type GovType = 'chiefdom' | 'kingdom' | 'republic' | 'empire' | 'theocracy';
export type NotableRole =
  | 'founder'
  | 'ruler'
  | 'prophet'
  | 'inventor'
  | 'general'
  | 'explorer';

export interface Settlement {
  id: Id;
  name: string;
  tile: number;
  polity: Id;
  pop: number;
  founded: number;
  food: number;
  stock: Stock;
  tier: Tier;
  /** Highest rank ever held, so growth is announced once and not every wobble. */
  bestTier: number;
  unrest: number;
  culture: CultureVec;
  religion: Id;
  /** Tick the current faith took hold — faiths need time to stick. */
  religionSince: number;
  famine: number;
  wealth: number;
  /** Ticks of reduced yield left from a drought. */
  blight: number;
  /** Ticks of active plague left. */
  plague: number;
  /** Share of the population this outbreak takes, per tick. */
  plagueRate: number;
  /** Tick until which the survivors cannot catch it again. */
  plagueImmune: number;
  /** Cached trade partners, refreshed on a slow cadence. */
  partners: Id[];
  /** Per-partner complementarity and distance. Neither changes between
   *  refreshes, and recomputing them every tick was most of the trade phase. */
  partnerComp: number[];
  partnerDist: number[];
  partnersTick: number;
  /** Set when a band found nowhere to go, so a full map stops re-searching. */
  noRoomUntil: number;
  /**
   * What this place actually knows how to do. A realm's discoveries land in the
   * city that made them and travel outward along trade, so a settlement nobody
   * trades with keeps only what its founders walked in with.
   */
  techs: Set<string>;
}

export interface Polity {
  id: Id;
  name: string;
  capital: Id;
  settlements: Set<Id>;
  culture: CultureVec;
  gov: GovType;
  treasury: number;
  stability: number;
  wars: Set<Id>;
  founded: number;
  ruler: Id;
  research: number;
  /** Tech currently being worked toward; '' when idle. */
  researching: string;
  hue: number;
  /** Grudges by polity id, decays over time; feeds the war roll. */
  grievance: Map<Id, number>;
  phonology: number; // seed for the naming inventory
  parent: Id;
}

export interface Notable {
  id: Id;
  name: string;
  role: NotableRole;
  polity: Id;
  settlement: Id;
  born: number;
  died: number; // NONE while alive
  deeds: number[]; // event ids
  skill: number;
}

export interface Religion {
  id: Id;
  name: string;
  founder: Id;
  origin: Id;
  tenets: CultureVec;
  adherents: number;
  founded: number;
  parent: Id;
}

export type EventKind =
  | 'world'
  | 'found_polity'
  | 'found_settlement'
  | 'abandoned'
  | 'famine'
  | 'plague'
  | 'drought'
  | 'flood'
  | 'quake'
  | 'tech'
  | 'religion'
  | 'schism'
  | 'conversion'
  | 'war'
  | 'battle'
  | 'sack'
  | 'peace'
  | 'succession'
  | 'gov'
  | 'secession'
  | 'collapse'
  | 'road'
  | 'tier'
  | 'beasts'
  | 'sickness'
  | 'landscape';

export interface Event {
  id: number;
  tick: number;
  kind: EventKind;
  subjects: Id[];
  tile: number;
  text: string;
  severity: 0 | 1 | 2 | 3;
}

/** What a block of 1,000 events collapses into once the ring buffer overflows. */
export interface EraSummary {
  from: number;
  to: number;
  wars: number;
  foundings: number;
  techs: number;
  disasters: number;
  religions: number;
  peakPop: number;
  polities: number;
  highlights: Event[];
}

export interface Timeseries {
  tick: number[];
  pop: number[];
  polities: number[];
  settlements: number[];
  techs: number[];
  wars: number[];
  religions: number[];
}

export interface War {
  a: Id;
  b: Id;
  since: number;
  fatigueA: number;
  fatigueB: number;
  battles: number;
}

export interface Counters {
  peakPop: number;
  politiesEver: number;
  settlementsEver: number;
  warsEver: number;
  religionsEver: number;
  notablesEver: number;
  techsEver: number;
  disastersEver: number;
}

export interface World {
  version: number;
  id: string;
  name: string;
  seed: number;
  tick: number;
  rng: RngState;
  w: number;
  h: number;
  tiles: Tile[];
  settlements: Map<Id, Settlement>;
  polities: Map<Id, Polity>;
  notables: Map<Id, Notable>;
  religions: Map<Id, Religion>;
  wars: Map<number, War>;
  roads: Set<number>; // tile-to-tile edge keys carrying a road
  roadRoutes: Set<number>; // settlement-pair keys already joined by road
  traffic: Map<number, number>; // edge key -> cumulative traffic
  chronicle: Event[];
  eras: EraSummary[];
  techs: Map<Id, Set<string>>;
  stats: Timeseries;
  counters: Counters;
  nextId: Id;
  nextEventId: number;
  createdAt: number;
}
