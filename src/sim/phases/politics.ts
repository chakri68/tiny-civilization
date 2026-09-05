import type { Polity, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance } from './../rng.ts';
import { converge, CULT } from './../culture.ts';
import { hexDistance, neighbors } from './../hex.ts';
import { emit, nName, pName } from './../chronicle.ts';
import { avgUnrest, effectsOf, polityCulture, polityList, polityPop, religiousUnity } from './../query.ts';
import { createNotable, sortedIds, spawnChildPolity, transferSettlement, warKey } from './../factory.ts';
import { eraOf } from './../tech.ts';
import { BIOME } from './../biomes.ts';
import {
  GOV_KINGDOM_POP,
  GOV_LATE_POP,
  POLITY_CULTURE_TRACK,
  STABILITY_DRIFT,
  SUCCESSION_FRACTURE,
  TICKS_PER_YEAR,
} from './../constants.ts';

/**
 * Phase 7 — politics.
 *
 * Territory, stability, succession and the shape of the state. Stability is the
 * hinge: it decides whether a dead king is replaced quietly or the realm comes
 * apart at the seams, and it is itself a function of hunger, faith and how far
 * the borders have been stretched.
 */
export function phasePolitics(w: World): void {
  if (w.tick % 12 === 0) claimTerritory(w);

  for (const p of polityList(w)) {
    const ruler = w.notables.get(p.ruler);
    if (!ruler || ruler.died !== NONE) succeed(w, p);

    const fx = effectsOf(w, p.id);
    const unrest = avgUnrest(w, p);
    const unity = religiousUnity(w, p);
    const skill = w.notables.get(p.ruler)?.skill ?? 0.5;
    let fatigue = 0;
    for (const enemy of p.wars) {
      const war = w.wars.get(warKey(p.id, enemy));
      if (war) fatigue += war.a === p.id ? war.fatigueA : war.fatigueB;
    }
    const overreach = Math.max(0, p.settlements.size - 5) * 0.017;

    const target =
      0.3 +
      0.26 * (1 - unrest * 2) +
      0.16 * unity +
      0.14 * skill +
      0.12 * (fx.stability - 1) +
      0.1 * p.culture[CULT.communal] -
      overreach -
      fatigue * 0.3;

    p.stability += (clamp01(target) - p.stability) * STABILITY_DRIFT;
    p.stability = clamp01(p.stability);

    for (const [other, g] of p.grievance) {
      const decayed = g * 0.998;
      if (decayed < 0.01) p.grievance.delete(other);
      else p.grievance.set(other, decayed);
    }

    // A realm's character is its people's character, arrived at slowly. Left
    // out, p.culture stays frozen at whatever it was founded with and none of
    // the drift, trade convergence or religious pull downstream of it ever
    // reaches the decisions that use it.
    if (w.tick % TICKS_PER_YEAR === 1) converge(p.culture, polityCulture(w, p), POLITY_CULTURE_TRACK);
    if (w.tick % TICKS_PER_YEAR === 3) considerGovernment(w, p);
    if (w.tick % TICKS_PER_YEAR === 9) considerFracture(w, p);
  }
}

function clamp01(v: number): number {
  return v < 0.02 ? 0.02 : v > 0.98 ? 0.98 : v;
}

/**
 * Territory: every settlement pushes a claim out as far as its size warrants,
 * strongest claim wins. This is what draws the borders and what tells the war
 * phase who is standing next to whom.
 */
export function claimTerritory(w: World): void {
  for (const t of w.tiles) if (t.settlement === NONE) t.owner = NONE;
  const strength = new Float64Array(w.tiles.length);
  const frontier: number[] = [];
  const buf: number[] = [];

  for (const s of Array.from(w.settlements.values()).sort((a, b) => a.id - b.id)) {
    const reach = s.tier === 'city' ? 4 : s.tier === 'town' ? 3 : s.tier === 'village' ? 2 : 1;
    // Breadth-first out to `reach`, claim strength falling off with distance.
    frontier.length = 0;
    frontier.push(s.tile);
    const seen = new Set<number>([s.tile]);
    for (let d = 0; d <= reach; d++) {
      const claim = (s.pop + 40) / (1 + d * d * 1.6);
      const next: number[] = [];
      for (const tile of frontier) {
        const t = w.tiles[tile];
        if (!BIOME[t.biome].passable) continue;
        if (claim > strength[tile]) {
          strength[tile] = claim;
          t.owner = s.polity;
        }
        if (d === reach) continue;
        const c = neighbors(w.w, w.h, tile, buf);
        for (let k = 0; k < c; k++) {
          if (!seen.has(buf[k])) {
            seen.add(buf[k]);
            next.push(buf[k]);
          }
        }
      }
      frontier.length = 0;
      for (const n of next) frontier.push(n);
    }
  }
}

function succeed(w: World, p: Polity): void {
  const capital = w.settlements.get(p.capital) ?? w.settlements.get(sortedIds(p.settlements)[0] ?? NONE);
  if (!capital) return;
  const heir = createNotable(w, 'ruler', p.id, capital.id, w.rng);
  const old = p.ruler;
  p.ruler = heir.id;

  if (old === NONE) return; // founding, already announced

  if (p.stability < 0.35 && p.settlements.size >= 2) {
    p.stability = Math.max(0.05, p.stability - 0.14);
    for (const sid of sortedIds(p.settlements)) {
      const s = w.settlements.get(sid);
      if (s) s.unrest = Math.min(1, s.unrest + 0.12);
    }
    emit(
      w,
      'succession',
      2,
      [heir.id, p.id, old],
      capital.tile,
      `${nName(w, old)} died and ${pName(w, p.id)} could not agree on an heir. ${heir.name} holds ${capital.name}, for now.`,
    );
  } else {
    emit(
      w,
      'succession',
      p.gov === 'republic' ? 1 : 2,
      [heir.id, p.id, old],
      capital.tile,
      p.gov === 'republic'
        ? `${pName(w, p.id)} chose ${heir.name} to lead after ${nName(w, old)}.`
        : `${nName(w, old)} died. ${heir.name} took the seat at ${capital.name}.`,
    );
  }
}

function considerGovernment(w: World, p: Polity): void {
  const pop = polityPop(w, p);
  const known = w.techs.get(p.id) ?? new Set<string>();
  const era = eraOf(known);
  const c = p.culture;
  let next = p.gov;

  if (p.gov === 'chiefdom' && pop > GOV_KINGDOM_POP && (known.has('laws') || known.has('priesthood'))) {
    next = c[CULT.spiritual] > 0.65 && known.has('priesthood') ? 'theocracy' : 'kingdom';
  } else if ((p.gov === 'kingdom' || p.gov === 'theocracy') && era >= 3) {
    if (pop > GOV_LATE_POP && c[CULT.expansionist] > 0.6 && known.has('civil_service')) next = 'empire';
    else if (c[CULT.mercantile] > 0.6 && c[CULT.communal] > 0.5 && known.has('currency')) next = 'republic';
  }
  if (next === p.gov) return;
  p.gov = next;
  p.stability = Math.min(0.95, p.stability + 0.06);
  emit(
    w,
    'gov',
    2,
    [p.id],
    w.settlements.get(p.capital)?.tile ?? NONE,
    describeGov(w, p),
  );
}

function describeGov(w: World, p: Polity): string {
  const cap = w.settlements.get(p.capital)?.name ?? 'the capital';
  switch (p.gov) {
    case 'kingdom':
      return `${p.name} became a kingdom, and ${cap} began keeping a court.`;
    case 'theocracy':
      return `The priests took the government of ${p.name} into their own hands.`;
    case 'republic':
      return `${p.name} put its affairs to a council of its merchants.`;
    case 'empire':
      return `${p.name} declared itself an empire and began styling its ruler accordingly.`;
    default:
      return `${p.name} changed how it governed itself.`;
  }
}

/** A realm held together badly enough, for long enough, simply stops being one realm. */
function considerFracture(w: World, p: Polity): void {
  if (p.settlements.size < 4 || p.stability > SUCCESSION_FRACTURE) return;
  const odds = (SUCCESSION_FRACTURE - p.stability) * 0.5 * (1 + avgUnrest(w, p) * 2);
  if (!chance(w.rng, odds)) return;

  const capital = w.settlements.get(p.capital);
  if (!capital) return;
  const ranked = sortedIds(p.settlements)
    .filter((id) => id !== p.capital)
    .map((id) => ({ id, d: hexDistance(w.w, capital.tile, w.settlements.get(id)!.tile) }))
    .sort((a, b) => b.d - a.d || a.id - b.id);
  const takeCount = Math.max(1, Math.floor(ranked.length * 0.45));
  const leaving = ranked.slice(0, takeCount).map((x) => x.id);
  if (leaving.length === 0) return;

  const seed = w.settlements.get(leaving[0])!;
  const child = spawnChildPolity(w, p, seed.culture, w.rng);
  const known = w.techs.get(p.id);
  if (known) w.techs.set(child.id, new Set(known));
  for (const id of leaving) {
    const s = w.settlements.get(id);
    if (s) transferSettlement(w, s, child);
  }
  const leader = createNotable(w, 'ruler', child.id, child.capital, w.rng);
  child.ruler = leader.id;
  p.stability = Math.min(0.9, p.stability + 0.2); // a smaller realm is an easier one
  p.grievance.set(child.id, (p.grievance.get(child.id) ?? 0) + 0.8);
  emit(
    w,
    'secession',
    3,
    [child.id, p.id, leader.id],
    seed.tile,
    `${leaving.length} ${leaving.length === 1 ? 'town' : 'towns'} of ${p.name} stopped sending taxes. ${leader.name} rules them now as ${child.name}.`,
  );
}
