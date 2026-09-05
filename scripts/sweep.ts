// Interestingness sweep: node scripts/sweep.ts [seeds] [ticks]
// Milestone 6's instrument. A boring seed is a reason to move a constant, not
// to special-case the seed.
import { createWorld, totalPop, totalTechs } from '../src/sim/world.ts';
import { runTicks } from '../src/sim/tick.ts';
import { eraOf } from '../src/sim/tech.ts';

const seeds = Number(process.argv[2] ?? 100);
const ticks = Number(process.argv[3] ?? 5000);

const rows: Record<string, number[]> = {
  pop: [], polities: [], settlements: [], techs: [], wars: [], religions: [], era: [], events: [], ms: [],
};

for (let i = 0; i < seeds; i++) {
  const w = createWorld(1000 + i * 7919, `Sweep ${i}`);
  const t0 = performance.now();
  runTicks(w, ticks);
  rows.ms.push(performance.now() - t0);
  let era = 0;
  for (const set of w.techs.values()) era = Math.max(era, eraOf(set));
  rows.pop.push(totalPop(w));
  rows.polities.push(w.counters.politiesEver);
  rows.settlements.push(w.settlements.size);
  rows.techs.push(totalTechs(w));
  rows.wars.push(w.counters.warsEver);
  rows.religions.push(w.counters.religionsEver);
  rows.era.push(era);
  rows.events.push(w.nextEventId);
}

const q = (a: number[], p: number) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
console.log(`${seeds} seeds x ${ticks} ticks`);
for (const [k, v] of Object.entries(rows)) {
  console.log(`  ${k.padEnd(12)} min ${q(v, 0).toFixed(1).padStart(9)}  median ${q(v, 0.5).toFixed(1).padStart(9)}  p95 ${q(v, 0.95).toFixed(1).padStart(9)}`);
}
// The spec's soft targets for a 5,000-tick run.
const fails: string[] = [];
if (q(rows.polities, 0.5) < 3) fails.push('median polities founded < 3');
if (q(rows.wars, 0.5) < 1) fails.push('median wars < 1');
if (q(rows.religions, 0.5) < 1) fails.push('median religions < 1');
if (q(rows.techs, 0.5) < 15) fails.push('median techs < 15');
console.log(fails.length ? `INTERESTINGNESS: ${fails.join('; ')}` : 'INTERESTINGNESS: all soft targets met');
