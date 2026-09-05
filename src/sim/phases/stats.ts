import type { World } from './../types.ts';
import { STATS_CAP, STATS_INTERVAL } from './../constants.ts';
import { totalPop, totalTechs } from './../world.ts';

/**
 * Phase 11 — the record.
 *
 * Sampled, not continuous: one point every twelve ticks, decimated in half when
 * the series gets long. A world left running for a month still holds its whole
 * shape in a few thousand points.
 */
export function phaseStats(w: World): void {
  const pop = totalPop(w);
  if (pop > w.counters.peakPop) w.counters.peakPop = pop;
  if (w.tick % STATS_INTERVAL !== 0) return;

  const s = w.stats;
  s.tick.push(w.tick);
  s.pop.push(pop);
  s.polities.push(w.polities.size);
  s.settlements.push(w.settlements.size);
  s.techs.push(totalTechs(w));
  s.wars.push(w.wars.size);
  s.religions.push(w.religions.size);

  if (s.tick.length > STATS_CAP) decimate(s);
}

function decimate(s: World['stats']): void {
  for (const key of Object.keys(s) as (keyof World['stats'])[]) {
    const arr = s[key];
    const out: number[] = [];
    for (let i = 0; i < arr.length; i += 2) out.push(arr[i]);
    s[key] = out;
  }
}
