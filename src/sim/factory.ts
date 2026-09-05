import type {
  CultureVec,
  Id,
  Notable,
  NotableRole,
  Polity,
  Religion,
  ResId,
  Settlement,
  Stock,
  Tier,
  World,
} from './types.ts';
import { NONE, RESOURCES } from './types.ts';
import { hash32, randInt, range, type RngState } from './rng.ts';
import { cloneCulture, newCulture, perturb } from './culture.ts';
import { makePhonology, makeName, makePersonName, makePolityName, makeReligionName, mutatePhonology } from './names.ts';
import { TIER_CITY, TIER_TOWN, TIER_VILLAGE, FOOD_NEED, FOOD_STORE_MONTHS } from './constants.ts';
import { emit, pName } from './chronicle.ts';

export function newId(w: World): Id {
  return w.nextId++;
}

export function emptyStock(): Stock {
  const s = {} as Stock;
  for (const r of RESOURCES) s[r] = 0; // fixed insertion order keeps iteration deterministic
  return s;
}

export function tierFor(pop: number): Tier {
  if (pop >= TIER_CITY) return 'city';
  if (pop >= TIER_TOWN) return 'town';
  if (pop >= TIER_VILLAGE) return 'village';
  return 'camp';
}

/** Ids in ascending order — never iterate a Set directly where the RNG is involved. */
export function sortedIds(set: Set<Id>): Id[] {
  return Array.from(set).sort((a, b) => a - b);
}

function uniqueName(taken: Set<string>, make: (salt: number) => string, salt: number): string {
  for (let i = 0; i < 64; i++) {
    const n = make(salt + i * 7919);
    if (!taken.has(n)) return n;
  }
  return make(salt) + ' ' + (salt % 97);
}

export function createPolity(
  w: World,
  capitalTile: number,
  culture: CultureVec,
  parent: Id,
  phonologySeed: number,
): Polity {
  const id = newId(w);
  const phon = makePhonology(phonologySeed);
  const taken = new Set<string>();
  for (const p of w.polities.values()) taken.add(p.name);
  const name = uniqueName(taken, (s) => makePolityName(phon, phonologySeed, s), id * 31 + 0xc0005);
  const p: Polity = {
    id,
    name,
    capital: NONE,
    settlements: new Set(),
    culture,
    gov: 'chiefdom',
    treasury: 0,
    stability: 0.7,
    wars: new Set(),
    founded: w.tick,
    ruler: NONE,
    research: 0,
    researching: '',
    // Golden angle: consecutive realms land as far apart on the wheel as possible,
    // so neighbours are never two shades of the same colour.
    hue: (id * 137.508) % 360,
    grievance: new Map(),
    phonology: phonologySeed,
    parent,
  };
  w.polities.set(id, p);
  w.techs.set(id, new Set());
  w.counters.politiesEver++;
  void capitalTile;
  return p;
}

export function createSettlement(
  w: World,
  tile: number,
  polityId: Id,
  pop: number,
): Settlement {
  const id = newId(w);
  const p = w.polities.get(polityId)!;
  const phon = makePhonology(p.phonology);
  const taken = new Set<string>();
  for (const s of w.settlements.values()) taken.add(s.name);
  const name = uniqueName(taken, (salt) => makeName(phon, p.phonology, salt, { suffix: true }), id * 17 + 3);
  const s: Settlement = {
    id,
    name,
    tile,
    polity: polityId,
    pop,
    founded: w.tick,
    food: pop * FOOD_NEED * FOOD_STORE_MONTHS * 0.5,
    stock: emptyStock(),
    tier: tierFor(pop),
    bestTier: 0,
    unrest: 0.05,
    culture: cloneCulture(p.culture),
    religion: NONE,
    religionSince: -99999,
    famine: 0,
    wealth: 0,
    blight: 0,
    plague: 0,
    plagueRate: 0,
    plagueImmune: -99999,
    partners: [],
    partnerComp: [],
    partnerDist: [],
    partnersTick: -9999,
    noRoomUntil: -9999,
  };
  w.settlements.set(id, s);
  p.settlements.add(id);
  if (p.capital === NONE) p.capital = id;
  w.tiles[tile].settlement = id;
  w.tiles[tile].owner = polityId;
  w.counters.settlementsEver++;
  return s;
}

export function createNotable(
  w: World,
  role: NotableRole,
  polityId: Id,
  settlementId: Id,
  r: RngState,
): Notable {
  const id = newId(w);
  const p = w.polities.get(polityId);
  const phonSeed = p ? p.phonology : hash32(id, 7);
  const phon = makePhonology(phonSeed);
  const n: Notable = {
    id,
    name: makePersonName(phon, phonSeed, id * 13 + 0x40011, (id & 3) === 0),
    role,
    polity: polityId,
    settlement: settlementId,
    born: w.tick,
    died: NONE,
    deeds: [],
    skill: range(r, 0.3, 1),
  };
  w.notables.set(id, n);
  w.counters.notablesEver++;
  return n;
}

export function createReligion(
  w: World,
  founder: Notable,
  origin: Settlement,
  tenets: CultureVec,
  parent: Id,
  r: RngState,
): Religion {
  const id = newId(w);
  const p = w.polities.get(origin.polity);
  const phonSeed = p ? p.phonology : hash32(id, 3);
  const phon = makePhonology(phonSeed);
  const taken = new Set<string>();
  for (const rel of w.religions.values()) taken.add(rel.name);
  const religion: Religion = {
    id,
    name: uniqueName(taken, (salt) => makeReligionName(phon, phonSeed, salt), id * 23 + 0x80007),
    founder: founder.id,
    origin: origin.id,
    tenets: perturb(tenets, r, 0.08),
    adherents: origin.pop,
    founded: w.tick,
    parent,
  };
  w.religions.set(id, religion);
  w.counters.religionsEver++;
  return religion;
}

/** Resources a polity can actually reach: its own tiles, plus anything in a granary. */
export function polityResources(w: World, p: Polity): Set<ResId> {
  const out = new Set<ResId>();
  for (const sid of p.settlements) {
    const s = w.settlements.get(sid);
    if (!s) continue;
    for (const r of w.tiles[s.tile].resources) out.add(r);
    for (const r of RESOURCES) if (s.stock[r] > 1) out.add(r);
  }
  return out;
}

export function abandonSettlement(w: World, s: Settlement, reason: string): void {
  const p = w.polities.get(s.polity);
  w.tiles[s.tile].settlement = NONE;
  w.tiles[s.tile].owner = NONE;
  w.settlements.delete(s.id);
  if (p) {
    p.settlements.delete(s.id);
    if (p.capital === s.id) {
      const rest = sortedIds(p.settlements);
      p.capital = rest.length ? rest[0] : NONE;
    }
  }
  emit(w, 'abandoned', 2, [s.id], s.tile, `${s.name} was abandoned. ${reason}`);
  if (p && p.settlements.size === 0) dissolvePolity(w, p, 'Its last hearth went cold.');
}

export function transferSettlement(w: World, s: Settlement, toPolity: Polity): void {
  const from = w.polities.get(s.polity);
  if (from) {
    from.settlements.delete(s.id);
    if (from.capital === s.id) {
      const rest = sortedIds(from.settlements);
      from.capital = rest.length ? rest[0] : NONE;
    }
  }
  s.polity = toPolity.id;
  toPolity.settlements.add(s.id);
  if (toPolity.capital === NONE) toPolity.capital = s.id;
  w.tiles[s.tile].owner = toPolity.id;
  s.unrest = Math.min(1, s.unrest + 0.3);
  if (from && from.settlements.size === 0) {
    dissolvePolity(w, from, `${pName(w, toPolity.id)} took the last of it.`);
  }
}

export function dissolvePolity(w: World, p: Polity, reason: string): void {
  for (const other of p.wars) {
    const o = w.polities.get(other);
    if (o) o.wars.delete(p.id);
    w.wars.delete(warKey(p.id, other));
  }
  for (const sid of sortedIds(p.settlements)) {
    const s = w.settlements.get(sid);
    if (s) {
      w.tiles[s.tile].settlement = NONE;
      w.tiles[s.tile].owner = NONE;
      w.settlements.delete(sid);
    }
  }
  const ruler = w.notables.get(p.ruler);
  if (ruler && ruler.died === NONE) ruler.died = w.tick;
  w.polities.delete(p.id);
  w.techs.delete(p.id);
  emit(w, 'collapse', 3, [p.id], NONE, `${p.name} came to an end. ${reason}`);
}

export function warKey(a: Id, b: Id): number {
  return a < b ? a * 1048576 + b : b * 1048576 + a;
}

/** A daughter realm: same phonology lineage, perturbed culture. */
export function spawnChildPolity(w: World, parent: Polity, seedCulture: CultureVec, r: RngState): Polity {
  const generation = randInt(r, 1 << 20);
  const phon = mutatePhonology(parent.phonology, generation);
  const child = createPolity(w, NONE, perturb(seedCulture, r, 0.12), parent.id, phon);
  child.stability = 0.55;
  return child;
}

export function freshCulture(r: RngState): CultureVec {
  return newCulture(r);
}
