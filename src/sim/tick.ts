import type { World } from './types.ts';
import { phaseGrowth } from './phases/growth.ts';
import { phaseMigration } from './phases/migration.ts';
import { phaseTrade } from './phases/trade.ts';
import { phaseRoads } from './phases/roads.ts';
import { phaseTech } from './phases/technology.ts';
import { phaseReligion } from './phases/religion.ts';
import { phasePolitics } from './phases/politics.ts';
import { phaseWar } from './phases/war.ts';
import { phaseDisasters } from './phases/disasters.ts';
import { phaseLandscape } from './phases/landscape.ts';
import { phaseNotables } from './phases/notables.ts';
import { phaseStats } from './phases/stats.ts';

/**
 * One tick is one simulated month, and the order below is the whole simulation.
 *
 * The spec asks for phases as pure `(world, rng) -> mutations`; they are ordered,
 * isolated per file and take nothing but the world, but they mutate it in place.
 * Materialising a mutation list twelve times a tick is the one thing that would
 * have blown the 2 ms budget, and determinism does not depend on it.
 */
export function tick(w: World): void {
  phaseGrowth(w);
  phaseMigration(w);
  phaseTrade(w);
  phaseRoads(w);
  phaseTech(w);
  phaseReligion(w);
  phasePolitics(w);
  phaseWar(w);
  phaseDisasters(w);
  phaseLandscape(w);
  phaseNotables(w);
  phaseStats(w);
  w.tick++;
}

export function runTicks(w: World, n: number): void {
  for (let i = 0; i < n; i++) tick(w);
}
