import type { Polity, Settlement, War, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance, rand, randInt } from './../rng.ts';
import { CULT, cultureDistance } from './../culture.ts';
import { hexDistance, neighbors } from './../hex.ts';
import { emit, pName } from './../chronicle.ts';
import { dominantFaith, effectsAt } from './../query.ts';
import { createNotable, sortedIds, tierFor, transferSettlement, warKey } from './../factory.ts';
import { BIOME } from './../biomes.ts';
import { TECH_BY_ID } from './../tech.ts';
import {
  BATTLE_CHANCE,
  CONQUEST_TECH_RATE,
  GRIEVANCE_DECAY,
  PEACE_FATIGUE,
  SACK_POP_LOSS,
  TICKS_PER_YEAR,
  WAR_BASE_CHANCE,
  WAR_FATIGUE_PER_BATTLE,
  WAR_REACH,
} from './../constants.ts';

const MAX_WAR_TICKS = TICKS_PER_YEAR * 60;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Phase 8 — war.
 *
 * Wars are rolled once a year between realms that actually share a border, and
 * fought settlement by settlement. Nothing here is decided by fiat: a war ends
 * when both sides are more tired than they are stable.
 */
export function phaseWar(w: World): void {
  if (w.tick % TICKS_PER_YEAR === 0) declareWars(w);
  const generals = livingGenerals(w);

  for (const key of Array.from(w.wars.keys()).sort((a, b) => a - b)) {
    const war = w.wars.get(key);
    if (!war) continue;
    const a = w.polities.get(war.a);
    const b = w.polities.get(war.b);
    if (!a || !b) {
      w.wars.delete(key);
      a?.wars.delete(war.b);
      b?.wars.delete(war.a);
      continue;
    }
    if (chance(w.rng, BATTLE_CHANCE)) fightBattle(w, war, a, b, generals);
    war.fatigueA *= 0.998;
    war.fatigueB *= 0.998;
    considerPeace(w, key, war, a, b);
  }
}

/**
 * Who counts as a neighbour: realms whose territory actually touches, plus
 * realms close enough to walk to. Without the second clause the opening
 * centuries have no wars at all — the founding bands start twelve hexes apart
 * and their borders take three hundred years to meet.
 */
export function borderPairs(w: World): Map<number, [number, number]> {
  const pairs = new Map<number, [number, number]>();
  const buf: number[] = [];
  const add = (a: number, b: number) => {
    if (a === b) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = lo * 1048576 + hi;
    if (!pairs.has(key)) pairs.set(key, [lo, hi]);
  };

  for (let i = 0; i < w.tiles.length; i++) {
    const owner = w.tiles[i].owner;
    if (owner === NONE) continue;
    const c = neighbors(w.w, w.h, i, buf);
    for (let k = 0; k < c; k++) {
      const other = w.tiles[buf[k]].owner;
      if (other !== NONE) add(owner, other);
    }
  }

  // Bucketed by WAR_REACH so this stays linear in settlements rather than
  // quadratic — it runs every year and the map holds a couple of hundred towns.
  const cell = WAR_REACH;
  const buckets = new Map<number, number[]>();
  const list = Array.from(w.settlements.values()).sort((a, b) => a.id - b.id);
  for (const s of list) {
    const cx = (s.tile % w.w / cell) | 0;
    const cy = ((s.tile / w.w) | 0) / cell | 0;
    const key = cy * 4096 + cx;
    const arr = buckets.get(key);
    if (arr) arr.push(s.id);
    else buckets.set(key, [s.id]);
  }
  for (const s of list) {
    const cx = (s.tile % w.w / cell) | 0;
    const cy = ((s.tile / w.w) | 0) / cell | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const near = buckets.get((cy + dy) * 4096 + (cx + dx));
        if (!near) continue;
        for (const oid of near) {
          if (oid <= s.id) continue;
          const o = w.settlements.get(oid)!;
          if (o.polity === s.polity) continue;
          if (hexDistance(w.w, s.tile, o.tile) <= WAR_REACH) add(s.polity, o.polity);
        }
      }
    }
  }
  return pairs;
}

function declareWars(w: World): void {
  const pairs = Array.from(borderPairs(w).entries()).sort((x, y) => x[0] - y[0]);
  for (const [, [aid, bid]] of pairs) {
    const a = w.polities.get(aid);
    const b = w.polities.get(bid);
    if (!a || !b || a.wars.has(bid)) continue;

    const grievance = (a.grievance.get(bid) ?? 0) + (b.grievance.get(aid) ?? 0);
    const cultureGap = cultureDistance(a.culture, b.culture);

    // Faith, three ways: a martial creed makes a realm readier to march, a
    // shared one gives two realms a reason not to, and a rival one is its own
    // grievance.
    const creed = dominantFaith(w, a);
    const theirs = dominantFaith(w, b);
    const zeal = creed ? 0.7 + creed.tenets[CULT.martial] * 0.9 : 1;
    let faith = 1;
    if (creed && theirs) faith = creed.id === theirs.id ? 0.55 : 1 + cultureDistance(creed.tenets, theirs.tenets);

    const appetite =
      (0.25 + a.culture[CULT.martial]) *
      (0.25 + a.culture[CULT.expansionist]) *
      (1.2 - a.culture[CULT.mercantile] * 0.6);
    const odds =
      WAR_BASE_CHANCE *
      appetite *
      zeal *
      faith *
      (1 + grievance * 1.5) *
      (0.7 + cultureGap) *
      (1.25 - a.stability * 0.5);

    if (!chance(w.rng, odds)) continue;

    a.wars.add(bid);
    b.wars.add(aid);
    const war: War = { a: aid, b: bid, since: w.tick, fatigueA: 0, fatigueB: 0, battles: 0 };
    w.wars.set(warKey(aid, bid), war);
    w.counters.warsEver++;
    emit(
      w,
      'war',
      3,
      [aid, bid],
      w.settlements.get(a.capital)?.tile ?? NONE,
      grievance > 0.4
        ? `${a.name} went to war on ${b.name}. The grievance was old and well kept.`
        : creed && theirs && creed.id !== theirs.id
          ? `${a.name} declared war on ${b.name}. ${cap(creed.name)} and ${theirs.name} had not sat easily on one border.`
          : `${a.name} declared war on ${b.name} over the border country.`,
    );
  }
}

interface Side {
  polity: Polity;
  settlement: Settlement;
  strength: number;
  general: number;
}

function fightBattle(w: World, war: War, a: Polity, b: Polity, generals: Map<number, number>): void {
  const front = findFront(w, a, b);
  if (!front) return;
  const [sa, sb] = front;

  const attacker = makeSide(w, a, sa, generals);
  const defender = makeSide(w, b, sb, generals);
  // Defending on your own hills, behind your own walls, is worth something.
  const terrain = terrainBonus(w, sb.tile);
  defender.strength *= terrain;

  const roll = rand(w.rng);
  const total = attacker.strength + defender.strength;
  if (total <= 0) return;
  const attackerWins = roll < attacker.strength / total;
  const winner = attackerWins ? attacker : defender;
  const loser = attackerWins ? defender : attacker;

  war.battles++;
  const lossW = 0.02 + rand(w.rng) * 0.03;
  const lossL = 0.06 + rand(w.rng) * 0.09;
  winner.settlement.pop *= 1 - lossW;
  loser.settlement.pop *= 1 - lossL;
  loser.settlement.unrest = Math.min(1, loser.settlement.unrest + 0.08);

  const winnerIsA = winner.polity.id === war.a;
  if (winnerIsA) {
    war.fatigueB += WAR_FATIGUE_PER_BATTLE;
    war.fatigueA += WAR_FATIGUE_PER_BATTLE * 0.45;
  } else {
    war.fatigueA += WAR_FATIGUE_PER_BATTLE;
    war.fatigueB += WAR_FATIGUE_PER_BATTLE * 0.45;
  }

  // A decisive win against a weakened place takes it.
  const ratio = winner.strength / Math.max(1, loser.strength);
  if (ratio > 1.6 && chance(w.rng, 0.3)) {
    sackAndTake(w, winner, loser);
    return;
  }

  if (chance(w.rng, 0.05)) {
    const general = createNotable(w, 'general', winner.polity.id, winner.settlement.id, w.rng);
    emit(
      w,
      'battle',
      2,
      [general.id, winner.polity.id, loser.polity.id],
      loser.settlement.tile,
      `${general.name} broke the ${loser.polity.name} line outside ${loser.settlement.name}.`,
    );
  } else if (chance(w.rng, 0.25)) {
    emit(
      w,
      'battle',
      1,
      [winner.polity.id, loser.polity.id],
      loser.settlement.tile,
      `Fighting near ${loser.settlement.name}. ${winner.polity.name} held the field.`,
    );
  }
}

function sackAndTake(w: World, winner: Side, loser: Side): void {
  const s = loser.settlement;
  const before = Math.round(s.pop);
  const wasTier = s.tier;
  s.pop *= 1 - SACK_POP_LOSS;
  s.food *= 0.3;
  s.wealth *= 0.4;
  const nowTier = tierFor(s.pop);
  const loserPolity = loser.polity;
  transferSettlement(w, s, winner.polity);
  loserPolity.grievance.set(winner.polity.id, (loserPolity.grievance.get(winner.polity.id) ?? 0) + 1);
  absorbTech(w, winner.polity, loserPolity, s);
  // A sacked camp is a footnote; a sacked city is the end of an age.
  const severity = wasTier === 'city' ? 3 : wasTier === 'town' ? 3 : wasTier === 'village' ? 2 : 1;
  const demoted = nowTier !== wasTier ? ` It was a ${wasTier} no longer.` : '';
  emit(
    w,
    'sack',
    severity,
    [winner.polity.id, loserPolity.id, s.id],
    s.tile,
    `${winner.polity.name} took ${s.name}. Of ${before} people, ${Math.round(s.pop)} remained.${demoted}`,
  );
}

/**
 * What the winners carry home from a taken city.
 *
 * Craft does not travel with the army by itself — it travels with the workshops
 * and the people who ran them, so the size of the place decides how much of it
 * survives being sacked. Only the frontier of what the loser knew is reachable:
 * you cannot take navigation off a people whose sailing you never learned, but
 * taking their sailing this same day puts navigation within reach.
 */
function absorbTech(w: World, winner: Polity, loser: Polity, s: Settlement): void {
  const theirs = w.techs.get(loser.id);
  const ours = w.techs.get(winner.id);
  if (!theirs || !ours) return;

  let budget = Math.sqrt(s.pop) * CONQUEST_TECH_RATE;
  const whole = Math.floor(budget);
  budget = whole + (chance(w.rng, budget - whole) ? 1 : 0);
  if (budget < 1) return;

  const gained: string[] = [];
  for (let i = 0; i < budget; i++) {
    // Recomputed each time, so one sack can walk a step or two up their tree.
    const frontier = Array.from(theirs)
      .filter((id) => !ours.has(id))
      .filter((id) => (TECH_BY_ID.get(id)?.prereqs ?? []).every((pre) => ours.has(pre)))
      .sort();
    if (frontier.length === 0) break;
    const pick = frontier[randInt(w.rng, frontier.length)];
    ours.add(pick);
    gained.push(TECH_BY_ID.get(pick)?.name ?? pick);
  }
  if (gained.length === 0) return;

  emit(
    w,
    'tech',
    2,
    [winner.id, loser.id, s.id],
    s.tile,
    `The craft of ${s.name} passed to ${pName(w, winner.id)} with the city — ${gained.join(', ')}.`,
  );
}

function makeSide(w: World, p: Polity, s: Settlement, generals: Map<number, number>): Side {
  const fx = effectsAt(w, s);
  const general = generals.get(p.id) ?? NONE;
  const bonus = general === NONE ? 1 : 1 + (w.notables.get(general)?.skill ?? 0) * 0.35;
  const strength =
    Math.pow(Math.max(1, s.pop), 0.62) *
    (0.35 + p.culture[CULT.martial]) *
    fx.mil *
    bonus *
    (0.6 + p.stability * 0.6);
  return { polity: p, settlement: s, strength, general };
}

function terrainBonus(w: World, tile: number): number {
  const t = w.tiles[tile];
  let bonus = 1.15; // simply being the one behind the wall
  if (t.biome === 'alpine') bonus += 0.35;
  else if (BIOME[t.biome].moveCost > 1.4) bonus += 0.15;
  if (t.river) bonus += 0.1;
  return bonus;
}

/** Best living general per polity. Rebuilt per battle; notables are a short list by design. */
function livingGenerals(w: World): Map<number, number> {
  const out = new Map<number, number>();
  for (const n of w.notables.values()) {
    if (n.died !== NONE || n.role !== 'general') continue;
    const held = out.get(n.polity);
    if (held === undefined || (w.notables.get(held)?.skill ?? 0) < n.skill) out.set(n.polity, n.id);
  }
  return out;
}

/** A settlement of A and the nearest settlement of B that is plausibly in reach. */
function findFront(w: World, a: Polity, b: Polity): [Settlement, Settlement] | null {
  const aList = sortedIds(a.settlements);
  const bList = sortedIds(b.settlements);
  if (aList.length === 0 || bList.length === 0) return null;
  const sa = w.settlements.get(aList[randInt(w.rng, aList.length)]);
  if (!sa) return null;
  let best: Settlement | null = null;
  let bestD = Infinity;
  for (const id of bList) {
    const s = w.settlements.get(id);
    if (!s) continue;
    const d = hexDistance(w.w, sa.tile, s.tile);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best || bestD > 14) return null;
  return [sa, best];
}

function considerPeace(w: World, key: number, war: War, a: Polity, b: Polity): void {
  const exhausted = w.tick - war.since > MAX_WAR_TICKS;
  const aDone = war.fatigueA > PEACE_FATIGUE * (0.4 + a.stability);
  const bDone = war.fatigueB > PEACE_FATIGUE * (0.4 + b.stability);
  if (!exhausted && !(aDone || bDone)) return;
  if (!exhausted && !chance(w.rng, 0.08)) return;

  a.wars.delete(b.id);
  b.wars.delete(a.id);
  w.wars.delete(key);

  const loser = war.fatigueA > war.fatigueB ? a : b;
  const other = loser === a ? b : a;
  loser.grievance.set(other.id, (loser.grievance.get(other.id) ?? 0) * GRIEVANCE_DECAY + 0.5);
  const years = Math.round((w.tick - war.since) / TICKS_PER_YEAR);
  emit(
    w,
    'peace',
    2,
    [a.id, b.id],
    w.settlements.get(loser.capital)?.tile ?? NONE,
    exhausted
      ? `After ${years} years, nobody could remember what ${pName(w, a.id)} and ${pName(w, b.id)} were fighting about. The war simply stopped.`
      : `${pName(w, loser.id)} made peace with ${pName(w, other.id)} after ${years} years and ${war.battles} engagements.`,
  );
}
