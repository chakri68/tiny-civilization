import type { World } from './../types.ts';
import { chance } from './../rng.ts';
import { emit } from './../chronicle.ts';
import { capacityOf, effectsOf, settlementList } from './../query.ts';
import { tierFor } from './../factory.ts';
import {
  FAMINE_DEATH_RATE,
  FAMINE_TICKS,
  FAMINE_UNREST,
  FOOD_NEED,
  FOOD_STORE_MONTHS,
  GROWTH_RATE,
  TICKS_PER_YEAR,
} from './../constants.ts';

/**
 * Phase 1 — food and growth.
 *
 * Land yields a fixed amount per unit of carrying capacity, so a settlement at
 * K eats exactly what it grows plus a little. Everything that hurts a
 * settlement (drought, conquest, a sacked granary) works by pushing pop above K
 * or K below pop, and famine follows on its own.
 */
export function phaseGrowth(w: World): void {
  for (const s of settlementList(w)) {
    const fx = effectsOf(w, s.polity);
    const K = capacityOf(w, s, fx);
    const yieldPerTick = K * FOOD_NEED * 1.12;
    const consumed = s.pop * FOOD_NEED;
    const store = s.pop * FOOD_NEED * FOOD_STORE_MONTHS;

    s.food += yieldPerTick - consumed;
    if (s.food > store) s.food = store;

    if (s.food < 0) {
      s.food = 0;
      s.famine++;
    } else if (s.famine > 0) {
      s.famine--;
    }

    if (s.blight > 0) s.blight--;

    let growth = GROWTH_RATE * fx.growth * (1 - s.unrest * 0.6);
    if (s.famine >= FAMINE_TICKS) {
      const dead = s.pop * FAMINE_DEATH_RATE;
      s.pop -= dead;
      s.unrest = Math.min(1, s.unrest + FAMINE_UNREST);
      growth = 0;
      // One line per famine year, and only where enough people live to notice.
      if (s.famine % TICKS_PER_YEAR === FAMINE_TICKS % TICKS_PER_YEAR && dead >= 40) {
        emit(
          w,
          'famine',
          2,
          [s.id, s.polity],
          s.tile,
          `Famine in ${s.name}. ${Math.round(dead)} did not see the spring.`,
        );
      }
    }

    s.pop += s.pop * growth * (1 - s.pop / K);

    // Crowding and hunger raise unrest; everything else lets it settle.
    const crowd = Math.max(0, s.pop / K - 0.9) * 0.4;
    const target = 0.04 + crowd;
    s.unrest += (target - s.unrest) * 0.02;
    if (s.unrest < 0) s.unrest = 0;

    if (s.pop < 12) {
      // Not a famine, just a place that stopped being worth living in.
      if (chance(w.rng, 0.08)) s.pop = 0;
    }

    const tier = tierFor(s.pop);
    if (tier !== s.tier) {
      // Only a new high-water mark is news. A town that keeps crossing back and
      // forth over the threshold announces itself once, not every wobble.
      const grew = s.pop > 0 && rank(tier) > s.bestTier;
      if (grew) {
        s.bestTier = rank(tier);
        emit(
          w,
          'tier',
          tier === 'city' ? 2 : tier === 'town' ? 1 : 0,
          [s.id, s.polity],
          s.tile,
          tier === 'city'
            ? `${s.name} became a city, the first thing travellers now name when asked where they have been.`
            : `${s.name} grew into a ${tier}.`,
        );
      }
      s.tier = tier;
    }
  }
}

function rank(t: string): number {
  return t === 'city' ? 3 : t === 'town' ? 2 : t === 'village' ? 1 : 0;
}
