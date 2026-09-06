import type { CultureAxis, ResId } from './types.ts';
import { TECH_COST_BASE, TECH_COST_GROWTH } from './constants.ts';

export const ERAS = [
  'stone',
  'bronze',
  'iron',
  'classical',
  'medieval',
  'early modern',
  'industrial',
] as const;
export type EraId = (typeof ERAS)[number];

export interface Effects {
  food: number;
  mil: number;
  research: number;
  trade: number;
  health: number;
  growth: number;
  stability: number;
  move: number;
  /**
   * What one tile of open water costs to cross. Infinity until somebody has
   * built a hull that holds — water is not a thing you get gradually better at
   * until then, you either put out or you don't.
   */
  sea: number;
}

export const BASE_EFFECTS: Effects = {
  food: 1,
  mil: 1,
  research: 1,
  trade: 1,
  health: 1,
  growth: 1,
  stability: 1,
  move: 1,
  sea: Infinity,
};

/**
 * Best hull wins, cheapest first. A dugout costs more than a mountain pass and
 * gets you over a strait and no further; a ship that can fix its longitude makes
 * open water ordinary.
 */
const SEA_COST: readonly (readonly [string, number])[] = [
  ['navigation', 2.2],
  ['caravel', 2.8],
  ['compass', 3.4],
  ['cartography', 4.2],
  ['shipwrights', 5],
  ['sailing', 6.5],
  ['boats', 14],
];

function seaCostFor(known: Set<string>): number {
  for (const [id, cost] of SEA_COST) if (known.has(id)) return cost;
  return Infinity;
}

export interface TechDef {
  id: string;
  name: string;
  era: number;
  prereqs: string[];
  needs: ResId[];
  affinity: Partial<Record<CultureAxis, number>>;
  effects: Partial<Effects>;
  /** Past-tense fragment for the chronicle line. */
  deed: string;
}

// The one hand-authored table in the project.
export const TECHS: TechDef[] = [
  // --- era 0: stone ---------------------------------------------------------
  { id: 'toolmaking', name: 'Toolmaking', era: 0, prereqs: [], needs: [], affinity: {}, effects: { food: 0.08 }, deed: 'knapped a better edge' },
  { id: 'fire', name: 'Hearth-Keeping', era: 0, prereqs: [], needs: [], affinity: { communal: 0.3 }, effects: { health: 0.06, growth: 0.05 }, deed: 'kept fire through a winter' },
  { id: 'agriculture', name: 'Agriculture', era: 0, prereqs: ['toolmaking'], needs: [], affinity: { communal: 0.3 }, effects: { food: 0.35 }, deed: 'sowed the first ordered field' },
  { id: 'pottery', name: 'Pottery', era: 0, prereqs: ['fire'], needs: [], affinity: {}, effects: { food: 0.1, trade: 0.08 }, deed: 'fired the first sealed jar' },
  { id: 'husbandry', name: 'Animal Husbandry', era: 0, prereqs: ['agriculture'], needs: [], affinity: {}, effects: { food: 0.14, mil: 0.05 }, deed: 'penned the wild herds' },
  { id: 'weaving', name: 'Weaving', era: 0, prereqs: ['husbandry'], needs: [], affinity: { mercantile: 0.2 }, effects: { trade: 0.12, health: 0.04 }, deed: 'wove cloth fine enough to trade' },
  { id: 'burial', name: 'Burial Rites', era: 0, prereqs: ['fire'], needs: [], affinity: { spiritual: 0.5 }, effects: { stability: 0.06 }, deed: 'first buried the dead with their things' },
  { id: 'oral_law', name: 'Oral Law', era: 0, prereqs: ['burial'], needs: [], affinity: { communal: 0.4 }, effects: { stability: 0.1 }, deed: 'set the customs to memory' },
  { id: 'archery', name: 'Archery', era: 0, prereqs: ['toolmaking'], needs: [], affinity: { martial: 0.4 }, effects: { mil: 0.15, food: 0.04 }, deed: 'bent the first war-bow' },
  { id: 'boats', name: 'Boat Building', era: 0, prereqs: ['toolmaking'], needs: ['timber'], affinity: { expansionist: 0.3 }, effects: { trade: 0.12, food: 0.05 }, deed: 'hollowed a hull that held' },
  { id: 'mining', name: 'Mining', era: 0, prereqs: ['toolmaking'], needs: ['stone'], affinity: {}, effects: { trade: 0.08 }, deed: 'cut the first shaft into rock' },
  { id: 'irrigation', name: 'Irrigation', era: 0, prereqs: ['agriculture'], needs: [], affinity: { communal: 0.3 }, effects: { food: 0.28 }, deed: 'turned the river onto dry ground' },
  { id: 'wheel', name: 'The Wheel', era: 0, prereqs: ['toolmaking', 'husbandry'], needs: ['timber'], affinity: {}, effects: { trade: 0.15, move: 0.1 }, deed: 'trued the first wheel' },

  // --- era 1: bronze --------------------------------------------------------
  { id: 'copper', name: 'Copper Working', era: 1, prereqs: ['mining', 'fire'], needs: ['copper'], affinity: { martial: 0.2 }, effects: { mil: 0.12, trade: 0.1 }, deed: 'drew metal out of green stone' },
  { id: 'bronze', name: 'Bronze Working', era: 1, prereqs: ['copper'], needs: ['copper', 'tin'], affinity: { martial: 0.4 }, effects: { mil: 0.3, trade: 0.1 }, deed: 'married copper to tin' },
  { id: 'writing', name: 'Writing', era: 1, prereqs: ['pottery', 'oral_law'], needs: [], affinity: { scholarly: 0.6 }, effects: { research: 0.25, stability: 0.08 }, deed: 'pressed the first marks that kept their meaning' },
  { id: 'masonry', name: 'Masonry', era: 1, prereqs: ['mining'], needs: ['stone'], affinity: {}, effects: { stability: 0.08, food: 0.05 }, deed: 'raised a wall that outlived its mason' },
  { id: 'sailing', name: 'Sailing', era: 1, prereqs: ['boats', 'weaving'], needs: [], affinity: { mercantile: 0.4, expansionist: 0.3 }, effects: { trade: 0.25 }, deed: 'put cloth to the wind' },
  { id: 'calendar', name: 'The Calendar', era: 1, prereqs: ['writing'], needs: [], affinity: { scholarly: 0.4, spiritual: 0.2 }, effects: { food: 0.12, research: 0.08 }, deed: 'counted the year into months' },
  { id: 'chariots', name: 'Chariotry', era: 1, prereqs: ['wheel', 'bronze'], needs: ['horses'], affinity: { martial: 0.6 }, effects: { mil: 0.3 }, deed: 'yoked horses to a fighting platform' },
  { id: 'laws', name: 'Code of Laws', era: 1, prereqs: ['writing'], needs: [], affinity: { communal: 0.4 }, effects: { stability: 0.2 }, deed: 'cut the law into stone where all could see it' },
  { id: 'priesthood', name: 'Priesthood', era: 1, prereqs: ['burial', 'writing'], needs: [], affinity: { spiritual: 0.7 }, effects: { stability: 0.14 }, deed: 'set aside a caste to tend the gods' },
  { id: 'plow', name: 'Bronze Plow', era: 1, prereqs: ['bronze', 'agriculture'], needs: [], affinity: {}, effects: { food: 0.3 }, deed: 'cut a furrow no wooden share could' },
  { id: 'curing', name: 'Salt Curing', era: 1, prereqs: ['pottery'], needs: ['salt'], affinity: { mercantile: 0.3 }, effects: { food: 0.15, trade: 0.15 }, deed: 'made meat outlast the season' },

  // --- era 2: iron ----------------------------------------------------------
  { id: 'iron', name: 'Iron Working', era: 2, prereqs: ['bronze'], needs: ['iron'], affinity: { martial: 0.5 }, effects: { mil: 0.35, food: 0.1 }, deed: 'learned to work iron' },
  { id: 'currency', name: 'Currency', era: 2, prereqs: ['writing', 'copper'], needs: [], affinity: { mercantile: 0.7 }, effects: { trade: 0.35 }, deed: 'struck coin that strangers would take' },
  { id: 'roads', name: 'Paved Roads', era: 2, prereqs: ['wheel', 'masonry'], needs: ['stone'], affinity: { expansionist: 0.4 }, effects: { trade: 0.2, move: 0.25, stability: 0.06 }, deed: 'paved the road between the two halves of the realm' },
  { id: 'mathematics', name: 'Mathematics', era: 2, prereqs: ['writing', 'calendar'], needs: [], affinity: { scholarly: 0.7 }, effects: { research: 0.3 }, deed: 'proved a thing that could not be seen' },
  { id: 'cavalry', name: 'Cavalry', era: 2, prereqs: ['iron', 'chariots'], needs: ['horses'], affinity: { martial: 0.6 }, effects: { mil: 0.3, move: 0.1 }, deed: 'set riders on the flank' },
  { id: 'fortification', name: 'Fortification', era: 2, prereqs: ['masonry'], needs: ['stone'], affinity: { martial: 0.3 }, effects: { mil: 0.15, stability: 0.1 }, deed: 'walled the city' },
  { id: 'rotation', name: 'Crop Rotation', era: 2, prereqs: ['plow'], needs: [], affinity: {}, effects: { food: 0.3 }, deed: 'rested the field in thirds' },
  { id: 'shipwrights', name: 'Shipwrights', era: 2, prereqs: ['sailing'], needs: ['timber'], affinity: { mercantile: 0.4 }, effects: { trade: 0.25, mil: 0.08 }, deed: 'laid a keel meant for open water' },
  { id: 'philosophy', name: 'Philosophy', era: 2, prereqs: ['writing', 'priesthood'], needs: [], affinity: { scholarly: 0.6, spiritual: 0.3 }, effects: { research: 0.25, stability: 0.08 }, deed: 'asked what a good life was and wrote the answer down' },
  { id: 'siegecraft', name: 'Siegecraft', era: 2, prereqs: ['fortification', 'mathematics'], needs: [], affinity: { martial: 0.6 }, effects: { mil: 0.25 }, deed: 'built the engine that brings walls down' },

  // --- era 3: classical -----------------------------------------------------
  { id: 'aqueducts', name: 'Aqueducts', era: 3, prereqs: ['masonry', 'mathematics'], needs: ['stone'], affinity: { communal: 0.4 }, effects: { food: 0.15, health: 0.15, growth: 0.1 }, deed: 'carried water uphill on stone legs' },
  { id: 'medicine', name: 'Medicine', era: 3, prereqs: ['philosophy'], needs: [], affinity: { scholarly: 0.5 }, effects: { health: 0.2, growth: 0.08 }, deed: 'set down which herbs did what' },
  { id: 'astronomy', name: 'Astronomy', era: 3, prereqs: ['mathematics', 'calendar'], needs: [], affinity: { scholarly: 0.6, spiritual: 0.2 }, effects: { research: 0.2, trade: 0.08 }, deed: 'mapped the wandering stars' },
  { id: 'civil_service', name: 'Civil Service', era: 3, prereqs: ['laws', 'currency'], needs: [], affinity: { communal: 0.5, scholarly: 0.3 }, effects: { stability: 0.25, trade: 0.1 }, deed: 'made a clerk of every governor' },
  { id: 'glassmaking', name: 'Glassmaking', era: 3, prereqs: ['masonry', 'curing'], needs: [], affinity: { mercantile: 0.3 }, effects: { trade: 0.18 }, deed: 'blew sand into something you could see through' },
  { id: 'cartography', name: 'Cartography', era: 3, prereqs: ['astronomy', 'sailing'], needs: [], affinity: { expansionist: 0.6 }, effects: { trade: 0.15, move: 0.1 }, deed: 'drew the coast as it truly ran' },
  { id: 'standing_army', name: 'Standing Army', era: 3, prereqs: ['civil_service', 'iron'], needs: [], affinity: { martial: 0.7 }, effects: { mil: 0.35, stability: -0.05 }, deed: 'kept soldiers under arms in peacetime' },
  { id: 'scripture', name: 'Scripture', era: 3, prereqs: ['philosophy', 'priesthood'], needs: [], affinity: { spiritual: 0.8 }, effects: { stability: 0.18, research: 0.08 }, deed: 'fixed the revelation in writing' },
  { id: 'banking', name: 'Banking', era: 3, prereqs: ['currency', 'mathematics'], needs: [], affinity: { mercantile: 0.8 }, effects: { trade: 0.35 }, deed: 'lent money against a written promise' },
  { id: 'watermill', name: 'Watermill', era: 3, prereqs: ['wheel', 'masonry'], needs: [], affinity: {}, effects: { food: 0.2, research: 0.05 }, deed: 'set the river to grinding grain' },

  // --- era 4: medieval ------------------------------------------------------
  { id: 'horse_collar', name: 'Horse Collar', era: 4, prereqs: ['rotation', 'husbandry'], needs: ['horses'], affinity: {}, effects: { food: 0.25 }, deed: 'harnessed the horse without choking it' },
  { id: 'windmill', name: 'Windmill', era: 4, prereqs: ['watermill'], needs: ['timber'], affinity: {}, effects: { food: 0.18 }, deed: 'took the wind for a millstone' },
  { id: 'steel', name: 'Steel', era: 4, prereqs: ['iron', 'watermill'], needs: ['iron'], affinity: { martial: 0.4 }, effects: { mil: 0.35, food: 0.08, trade: 0.1 }, deed: 'folded carbon into iron' },
  { id: 'university', name: 'University', era: 4, prereqs: ['philosophy', 'scripture'], needs: [], affinity: { scholarly: 0.9 }, effects: { research: 0.45 }, deed: 'founded a school that outlived its teachers' },
  { id: 'compass', name: 'Compass', era: 4, prereqs: ['astronomy', 'cartography'], needs: ['iron'], affinity: { expansionist: 0.5, mercantile: 0.3 }, effects: { trade: 0.25, move: 0.1 }, deed: 'found north in a bowl of water' },
  { id: 'guilds', name: 'Guilds', era: 4, prereqs: ['banking', 'civil_service'], needs: [], affinity: { mercantile: 0.6, communal: 0.3 }, effects: { trade: 0.25, stability: 0.1, research: 0.1 }, deed: 'bound the crafts into sworn companies' },
  { id: 'crossbow', name: 'Crossbow', era: 4, prereqs: ['steel', 'archery'], needs: [], affinity: { martial: 0.5 }, effects: { mil: 0.25 }, deed: 'made a bow a farmhand could kill a knight with' },
  { id: 'castles', name: 'Castles', era: 4, prereqs: ['fortification', 'steel'], needs: ['stone'], affinity: { martial: 0.4 }, effects: { mil: 0.25, stability: 0.12 }, deed: 'built a keep that held against a season' },
  { id: 'optics', name: 'Optics', era: 4, prereqs: ['glassmaking', 'mathematics'], needs: [], affinity: { scholarly: 0.6 }, effects: { research: 0.2, health: 0.05 }, deed: 'ground a lens that bent the world' },
  { id: 'paper', name: 'Paper', era: 4, prereqs: ['weaving', 'writing'], needs: [], affinity: { scholarly: 0.5 }, effects: { research: 0.2, trade: 0.1 }, deed: 'beat rag into a page' },
  { id: 'printing', name: 'Printing', era: 4, prereqs: ['paper', 'guilds'], needs: [], affinity: { scholarly: 0.8 }, effects: { research: 0.4, stability: -0.05 }, deed: 'set movable type and printed the same book twice' },
  { id: 'alchemy', name: 'Alchemy', era: 4, prereqs: ['medicine', 'philosophy'], needs: [], affinity: { scholarly: 0.4, spiritual: 0.3 }, effects: { research: 0.15, health: 0.08 }, deed: 'kept careful notes on failures to make gold' },

  // --- era 5: early modern --------------------------------------------------
  { id: 'gunpowder', name: 'Gunpowder', era: 5, prereqs: ['alchemy'], needs: ['salt'], affinity: { martial: 0.6 }, effects: { mil: 0.4 }, deed: 'ground the black powder' },
  { id: 'cannon', name: 'Cannon', era: 5, prereqs: ['gunpowder', 'bronze'], needs: [], affinity: { martial: 0.7 }, effects: { mil: 0.45 }, deed: 'cast a barrel that could hold the blast' },
  { id: 'caravel', name: 'Caravel', era: 5, prereqs: ['compass', 'shipwrights'], needs: ['timber'], affinity: { expansionist: 0.7, mercantile: 0.4 }, effects: { trade: 0.35, move: 0.1 }, deed: 'built a ship that could beat back upwind' },
  { id: 'scientific_method', name: 'Scientific Method', era: 5, prereqs: ['university', 'printing'], needs: [], affinity: { scholarly: 1 }, effects: { research: 0.6 }, deed: 'insisted the experiment be repeated' },
  { id: 'joint_stock', name: 'Joint-Stock Company', era: 5, prereqs: ['guilds', 'printing'], needs: [], affinity: { mercantile: 0.9 }, effects: { trade: 0.45 }, deed: 'split a voyage into shares' },
  { id: 'musketry', name: 'Musketry', era: 5, prereqs: ['gunpowder', 'steel'], needs: [], affinity: { martial: 0.7 }, effects: { mil: 0.4 }, deed: 'drilled ranks to fire together' },
  { id: 'sanitation', name: 'Sanitation', era: 5, prereqs: ['aqueducts', 'medicine'], needs: [], affinity: { communal: 0.5 }, effects: { health: 0.3, growth: 0.15 }, deed: 'took the sewage away from the well' },
  { id: 'navigation', name: 'Navigation', era: 5, prereqs: ['caravel', 'astronomy'], needs: [], affinity: { expansionist: 0.6 }, effects: { trade: 0.25, move: 0.15 }, deed: 'fixed longitude at sea' },
  { id: 'metallurgy', name: 'Metallurgy', era: 5, prereqs: ['steel', 'scientific_method'], needs: ['iron'], affinity: { scholarly: 0.4, martial: 0.3 }, effects: { mil: 0.25, trade: 0.15, research: 0.1 }, deed: 'learned why the alloy held' },
  { id: 'bureaucracy', name: 'Bureaucracy', era: 5, prereqs: ['civil_service', 'printing'], needs: [], affinity: { communal: 0.5, scholarly: 0.3 }, effects: { stability: 0.3, trade: 0.1 }, deed: 'filed the realm in triplicate' },

  // --- era 6: industrial ----------------------------------------------------
  { id: 'blast_furnace', name: 'Blast Furnace', era: 6, prereqs: ['metallurgy', 'mining'], needs: ['iron'], affinity: {}, effects: { mil: 0.2, trade: 0.2, food: 0.1 }, deed: 'kept the furnace hot enough to pour iron' },
  { id: 'steam_engine', name: 'Steam Engine', era: 6, prereqs: ['metallurgy', 'scientific_method'], needs: [], affinity: { scholarly: 0.6 }, effects: { research: 0.3, trade: 0.3, food: 0.15 }, deed: 'made fire turn a wheel' },
  { id: 'railways', name: 'Railways', era: 6, prereqs: ['steam_engine', 'roads'], needs: ['iron'], affinity: { mercantile: 0.5, expansionist: 0.5 }, effects: { trade: 0.5, move: 0.4 }, deed: 'laid iron road across the plain' },
  { id: 'factory', name: 'The Factory', era: 6, prereqs: ['steam_engine', 'joint_stock'], needs: [], affinity: { mercantile: 0.7 }, effects: { trade: 0.45, stability: -0.12, growth: 0.1 }, deed: 'put a thousand hands under one roof' },
  { id: 'telegraph', name: 'Telegraph', era: 6, prereqs: ['optics', 'metallurgy'], needs: ['copper'], affinity: { scholarly: 0.5 }, effects: { stability: 0.2, trade: 0.15, research: 0.1 }, deed: 'sent word faster than a horse could carry it' },
  { id: 'germ_theory', name: 'Germ Theory', era: 6, prereqs: ['sanitation', 'optics'], needs: [], affinity: { scholarly: 0.7 }, effects: { health: 0.5, growth: 0.25 }, deed: 'named the thing that had been killing everyone' },
  { id: 'mass_production', name: 'Mass Production', era: 6, prereqs: ['factory', 'blast_furnace'], needs: [], affinity: { mercantile: 0.6 }, effects: { trade: 0.4, mil: 0.2, food: 0.15 }, deed: 'made every part interchangeable' },
  { id: 'rifling', name: 'Rifling', era: 6, prereqs: ['musketry', 'mass_production'], needs: [], affinity: { martial: 0.8 }, effects: { mil: 0.5 }, deed: 'cut a spiral into the barrel' },
];

export const TECH_BY_ID = new Map<string, TechDef>(TECHS.map((t) => [t.id, t]));

export function techCost(era: number): number {
  let cost = TECH_COST_BASE;
  for (let i = 0; i < era; i++) cost *= TECH_COST_GROWTH;
  return cost;
}

/** Techs whose prereqs are met and whose required resources are on hand. */
export function availableTechs(known: Set<string>, resources: Set<ResId>): TechDef[] {
  const out: TechDef[] = [];
  for (const t of TECHS) {
    if (known.has(t.id)) continue;
    let ok = true;
    for (const p of t.prereqs) {
      if (!known.has(p)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const n of t.needs) {
      if (!resources.has(n)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(t);
  }
  return out;
}

export function aggregateEffects(known: Set<string>): Effects {
  const e: Effects = { ...BASE_EFFECTS };
  for (const id of known) {
    const t = TECH_BY_ID.get(id);
    if (!t) continue;
    const fx = t.effects;
    if (fx.food) e.food += fx.food;
    if (fx.mil) e.mil += fx.mil;
    if (fx.research) e.research += fx.research;
    if (fx.trade) e.trade += fx.trade;
    if (fx.health) e.health += fx.health;
    if (fx.growth) e.growth += fx.growth;
    if (fx.stability) e.stability += fx.stability;
    if (fx.move) e.move += fx.move;
  }
  if (e.stability < 0.4) e.stability = 0.4;
  e.sea = seaCostFor(known);
  return e;
}

export function eraOf(known: Set<string>): number {
  // The era you're "in" is the highest era where you know at least three techs.
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const id of known) {
    const t = TECH_BY_ID.get(id);
    if (t) counts[t.era]++;
  }
  let era = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] >= 3) era = i;
  return era;
}

// Keyed on the tech Set itself, so two worlds alive in one process (the
// determinism test runs exactly that) can never share a cache line.
const effectsCache = new WeakMap<Set<string>, { size: number; fx: Effects }>();

/** Techs are never unlearned, so the set's size is a sufficient cache key. */
export function effectsFor(known: Set<string>): Effects {
  const hit = effectsCache.get(known);
  if (hit && hit.size === known.size) return hit.fx;
  const fx = aggregateEffects(known);
  effectsCache.set(known, { size: known.size, fx });
  return fx;
}
