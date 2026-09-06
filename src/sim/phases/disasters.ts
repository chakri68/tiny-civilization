import type { Settlement, World } from './../types.ts';
import { chance, hashUnit, randInt, range } from './../rng.ts';
import { hexDistance } from './../hex.ts';
import { emit } from './../chronicle.ts';
import { capacityOf, effectsAt, settlementList } from './../query.ts';
import {
  BEAST_CHANCE,
  SICKNESS_CHANCE,
  DROUGHT_CHANCE,
  PLAGUE_IMMUNITY_YEARS_MAX,
  PLAGUE_IMMUNITY_YEARS_MIN,
  FLOOD_CHANCE,
  PLAGUE_CHANCE,
  PLAGUE_DEATH_MAX,
  PLAGUE_DEATH_MIN,
  PLAGUE_SPREAD,
  QUAKE_CHANCE,
  TICKS_PER_YEAR,
} from './../constants.ts';

/**
 * Phase 9 — disasters.
 *
 * Rolled from a hash of (tick, tile), so a given world always suffers the same
 * bad years. Plague is the one that moves: it travels the trade network, and it
 * travels faster on roads, which is the argument against having built them.
 */
export function phaseDisasters(w: World): void {
  const list = settlementList(w);

  for (const s of list) {
    const fx = effectsAt(w, s);
    const health = fx.health;

    if (s.plague > 0) {
      s.plague--;
      s.pop -= s.pop * (s.plagueRate / health);
      s.unrest = Math.min(1, s.unrest + 0.012);
      for (const pid of s.partners) {
        const o = w.settlements.get(pid);
        if (!o || o.plague > 0 || w.tick < o.plagueImmune) continue;
        const roaded = w.roadRoutes.has(edge(s.tile, o.tile));
        if (chance(w.rng, (PLAGUE_SPREAD / 12) * (roaded ? 2 : 1))) {
          infect(w, o, `carried up the road from ${s.name}`);
        }
      }
      if (s.plague === 0) {
        // Whoever is left has seen it, and will not take it again for a while.
        s.plagueImmune =
          w.tick +
          TICKS_PER_YEAR *
            (PLAGUE_IMMUNITY_YEARS_MIN +
              randInt(w.rng, PLAGUE_IMMUNITY_YEARS_MAX - PLAGUE_IMMUNITY_YEARS_MIN));
      }
      continue;
    }

    if (
      w.tick >= s.plagueImmune &&
      hashUnit(w.tick, s.tile, 0x9a1) < (PLAGUE_CHANCE * Math.min(3, s.pop / 800)) / health
    ) {
      infect(w, s, 'It came out of nowhere, as these things do', true);
    }
  }

  if (w.tick % TICKS_PER_YEAR !== 0) return;

  // --- annual, regional afflictions ----------------------------------------
  if (list.length > 0 && chance(w.rng, DROUGHT_CHANCE * TICKS_PER_YEAR * list.length)) {
    const centre = list[randInt(w.rng, list.length)];
    const radius = 4 + randInt(w.rng, 5);
    let hit = 0;
    for (const s of list) {
      if (hexDistance(w.w, s.tile, centre.tile) > radius) continue;
      s.blight = TICKS_PER_YEAR * (1 + randInt(w.rng, 3));
      s.food *= 0.4;
      hit++;
    }
    if (hit > 0) {
      w.counters.disastersEver++;
      emit(
        w,
        'drought',
        hit >= 10 ? 3 : 2,
        [centre.id],
        centre.tile,
        `The rains failed around ${centre.name}. ${hit === 1 ? 'One settlement' : `${hit} settlements`} went into the dry years.`,
      );
    }
  }

  beasts(w, list);
  sickness(w, list);

  for (const s of list) {
    const t = w.tiles[s.tile];
    if (t.river && chance(w.rng, FLOOD_CHANCE * TICKS_PER_YEAR)) {
      const dead = s.pop * range(w.rng, 0.03, 0.1);
      s.pop -= dead;
      s.food *= 0.5;
      w.counters.disastersEver++;
      emit(
        w,
        'flood',
        2,
        [s.id],
        s.tile,
        `The river took the low quarter of ${s.name} and ${Math.round(dead)} people with it.`,
      );
    }
    if (chance(w.rng, QUAKE_CHANCE * TICKS_PER_YEAR)) {
      const dead = s.pop * range(w.rng, 0.05, 0.18);
      s.pop -= dead;
      s.unrest = Math.min(1, s.unrest + 0.15);
      w.counters.disastersEver++;
      emit(
        w,
        'quake',
        2,
        [s.id],
        s.tile,
        `The ground moved under ${s.name}. ${Math.round(dead)} did not get out.`,
      );
    }
  }
}

// What is out there, by the country you settled in.
const PREDATORS: Partial<Record<string, [string, string]>> = {
  forest: ['wolves', 'came down out of the trees'],
  taiga: ['a wolf pack', 'followed the herds down in a hard winter'],
  wetland: ['something in the reeds', 'took what strayed from the path'],
  alpine: ['a bear', 'came down from the high rocks'],
  steppe: ['lions', 'worked the edge of the herds'],
  tundra: ['wolves', 'followed the smoke in'],
};

/**
 * Small, frequent, survivable — the tax a young settlement pays for being small
 * and a long way from anyone. Fades once a place is big enough to organise a
 * hunt and armed well enough to win it.
 */
function beasts(w: World, list: Settlement[]): void {
  for (const s of list) {
    if (s.tier !== 'camp' && s.tier !== 'village') continue;
    const flavour = PREDATORS[w.tiles[s.tile].biome];
    if (!flavour) continue;
    const fx = effectsAt(w, s);
    const isolation = 1 / (1 + s.partners.length * 0.6);
    if (!chance(w.rng, (BEAST_CHANCE * isolation) / fx.mil)) continue;
    const dead = Math.max(1, s.pop * range(w.rng, 0.008, 0.03));
    s.pop -= dead;
    s.unrest = Math.min(1, s.unrest + 0.03);
    emit(
      w,
      'beasts',
      s.tier === 'village' ? 1 : 0,
      [s.id],
      s.tile,
      `${cap(flavour[0])} ${flavour[1]} at ${s.name}. ${Math.round(dead)} of the ${s.tier} did not come back.`,
    );
  }
}

/**
 * Endemic disease rather than plague: it does not travel, it just lives in the
 * damp and in the crowding, and good water carries it away.
 */
function sickness(w: World, list: Settlement[]): void {
  for (const s of list) {
    if (s.plague > 0) continue;
    const fx = effectsAt(w, s);
    const t = w.tiles[s.tile];
    const crowding = Math.max(0, s.pop / capacityOf(w, s, fx) - 0.55);
    const damp = t.biome === 'wetland' ? 1.8 : t.river ? 1.3 : 1;
    const odds = (SICKNESS_CHANCE * (0.35 + crowding * 2.4) * damp) / fx.health;
    if (!chance(w.rng, odds)) continue;
    const dead = s.pop * range(w.rng, 0.015, 0.055);
    s.pop -= dead;
    s.unrest = Math.min(1, s.unrest + 0.02);
    emit(
      w,
      'sickness',
      s.tier === 'city' ? 2 : s.tier === 'town' ? 1 : 0,
      [s.id],
      s.tile,
      t.biome === 'wetland' || t.river
        ? `A fever went through ${s.name} off the water. ${Math.round(dead)} died of it.`
        : `Sickness in the close quarters of ${s.name}. ${Math.round(dead)} died of it.`,
    );
  }
}

function cap(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function infect(w: World, s: Settlement, how: string, origin = false): void {
  // Duration is the outbreak; the rate is drawn so the whole outbreak costs
  // roughly PLAGUE_DEATH_MIN..MAX of the town, not that much every month.
  s.plague = 9 + randInt(w.rng, 12);
  s.plagueRate = range(w.rng, PLAGUE_DEATH_MIN, PLAGUE_DEATH_MAX) / s.plague;
  w.counters.disastersEver++;
  // The outbreak is the story; each town it then reaches is a line, not a headline.
  const severity = origin ? 3 : s.tier === 'city' || s.tier === 'town' ? 2 : s.tier === 'village' ? 1 : 0;
  emit(w, 'plague', severity, [s.id, s.polity], s.tile, `Plague in ${s.name}. ${how}.`);
}

function edge(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}
