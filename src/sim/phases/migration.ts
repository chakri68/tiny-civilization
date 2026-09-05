import type { Settlement, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance, rand, range } from './../rng.ts';
import { BIOME } from './../biomes.ts';
import { hexDistance, tilesWithin } from './../hex.ts';
import { costField } from './../path.ts';
import { emit, pName } from './../chronicle.ts';
import { capacityOf, effectsOf, settlementList } from './../query.ts';
import { abandonSettlement, createNotable, createSettlement, spawnChildPolity } from './../factory.ts';
import { CULT } from './../culture.ts';
import {
  TICKS_PER_YEAR,
  MIGRATION_MIN_POP,
  MIGRATION_PRESSURE,
  MIGRATION_SHARE_MAX,
  MIGRATION_SHARE_MIN,
  SECESSION_BASE,
  SETTLE_RADIUS,
  SETTLE_SPACING,
} from './../constants.ts';

/**
 * Phase 2 — migration and founding.
 *
 * A settlement pressed against its ceiling sheds a band. Where the band goes is
 * a real pathfind, so mountains and water shape the spread of a people the way
 * you'd hope. Occasionally the band keeps walking and stops answering to anyone.
 */
export function phaseMigration(w: World): void {
  for (const s of settlementList(w)) {
    if (s.pop <= 0) {
      abandonSettlement(w, s, 'The last of them walked out and did not look back.');
      continue;
    }
    if (s.pop < MIGRATION_MIN_POP) continue;

    const fx = effectsOf(w, s.polity);
    const K = capacityOf(w, s, fx);
    const pressure = s.pop / K;
    if (pressure < MIGRATION_PRESSURE) continue;

    const urge =
      0.016 * (1 + s.culture[CULT.expansionist] * 2) * (1 + s.unrest * 3) * (pressure - MIGRATION_PRESSURE + 0.1);
    if (!chance(w.rng, urge)) continue;

    if (w.tick < s.noRoomUntil) continue;
    const target = bestSite(w, s);
    if (target < 0) {
      // The map fills up and then stays full. Without this, every crowded town
      // reruns a Dijkstra and a radius scan every few ticks, for ever, to be
      // told again that there is nowhere to go.
      s.noRoomUntil = w.tick + TICKS_PER_YEAR * 20;
      continue;
    }

    const share = range(w.rng, MIGRATION_SHARE_MIN, MIGRATION_SHARE_MAX);
    const band = Math.floor(s.pop * share);
    if (band < 25) continue;
    s.pop -= band;

    const parent = w.polities.get(s.polity);
    if (!parent) continue;

    // Distance, unrest and a fractious culture all argue for going it alone.
    const dist = hexDistance(w.w, s.tile, target);
    const secedeChance =
      SECESSION_BASE *
      (1 - parent.stability) *
      (1 + dist / SETTLE_RADIUS) *
      (1 + s.unrest * 2) *
      (1.4 - s.culture[CULT.communal]);

    if (parent.settlements.size >= 2 && chance(w.rng, secedeChance)) {
      const child = spawnChildPolity(w, parent, s.culture, w.rng);
      const nu = createSettlement(w, target, child.id, band);
      nu.religion = s.religion;
      nu.religionSince = w.tick;
      const leader = createNotable(w, 'founder', child.id, nu.id, w.rng);
      child.ruler = leader.id;
      // A new people inherits what its parent knew how to do.
      const known = w.techs.get(parent.id);
      if (known) w.techs.set(child.id, new Set(known));
      emit(
        w,
        'secession',
        3,
        [child.id, nu.id, leader.id, parent.id],
        target,
        `${leader.name} led ${band} people out of ${s.name} and would not answer to ${pName(w, parent.id)} again. They named the place ${nu.name}.`,
      );
      continue;
    }

    const nu = createSettlement(w, target, parent.id, band);
    nu.religion = s.religion;
    nu.religionSince = w.tick;
    let subjects = [nu.id, parent.id];
    let who = `A band out of ${s.name}`;
    if (chance(w.rng, 0.2)) {
      const leader = createNotable(w, 'explorer', parent.id, nu.id, w.rng);
      subjects = [nu.id, parent.id, leader.id];
      who = `${leader.name}, out of ${s.name},`;
    }
    emit(w, 'found_settlement', 2, subjects, target, `${who} settled ${nu.name}.`);
  }
}

/**
 * Score every reachable unclaimed tile within the settling radius:
 * good land, close by, not right on top of the neighbours, not next to someone
 * we are at war with.
 */
function bestSite(w: World, s: Settlement): number {
  const budget = SETTLE_RADIUS * 2.2;
  const field = costField(w, s.tile, budget);
  const parent = w.polities.get(s.polity);
  let best = -1;
  let bestScore = 0.35; // a floor, so a band never settles somewhere hopeless

  // Tiles already spoken for, so the elbow-room check is a lookup not a scan.
  const occupied = new Set<number>();
  for (const other of w.settlements.values()) {
    if (hexDistance(w.w, other.tile, s.tile) > SETTLE_RADIUS + SETTLE_SPACING) continue;
    for (const near of tilesWithin(w.w, w.h, other.tile, SETTLE_SPACING - 1)) occupied.add(near);
  }

  for (const tile of tilesWithin(w.w, w.h, s.tile, SETTLE_RADIUS)) {
    const t = w.tiles[tile];
    if (!BIOME[t.biome].passable || t.biome === 'lake' || t.biome === 'alpine') continue;
    if (t.settlement !== NONE) continue;
    if (t.fertility < 0.2) continue;
    const cost = field.cost.get(tile);
    if (cost === undefined || cost <= 0) continue;

    if (occupied.has(tile)) continue;

    let score = t.fertility * 2;
    if (t.river) score += 0.5;
    if (t.coastal) score += 0.3;
    score += t.resources.length * 0.12;
    score -= cost * 0.055;
    if (t.owner !== NONE && t.owner !== s.polity) {
      score -= parent && parent.wars.has(t.owner) ? 2.5 : 0.9;
    }
    // A tiebreaker with no bias, so identical land is not always taken west-first.
    score += rand(w.rng) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}
