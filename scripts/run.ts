// Headless driver: node scripts/run.ts [seed] [ticks]
import { createWorld, totalPop, totalTechs } from '../src/sim/world.ts';
import { runTicks } from '../src/sim/tick.ts';
import { yearOf } from '../src/sim/chronicle.ts';
import { eraOf, ERAS } from '../src/sim/tech.ts';

const seed = Number(process.argv[2] ?? 12345);
const ticks = Number(process.argv[3] ?? 5000);

const t0 = performance.now();
const w = createWorld(seed, 'Testbed');
const genMs = performance.now() - t0;

const t1 = performance.now();
runTicks(w, ticks);
const runMs = performance.now() - t1;

let bestEra = 0;
for (const set of w.techs.values()) bestEra = Math.max(bestEra, eraOf(set));

console.log(`seed ${seed}  worldgen ${genMs.toFixed(1)}ms  ${ticks} ticks in ${runMs.toFixed(0)}ms (${((runMs / ticks) * 1000).toFixed(0)}us/tick)`);
console.log(
  `year ${yearOf(w.tick)}  pop ${totalPop(w)}  peak ${w.counters.peakPop}  polities ${w.polities.size}/${w.counters.politiesEver}  settlements ${w.settlements.size}  techs ${totalTechs(w)}  era ${ERAS[bestEra]}  wars ${w.wars.size}/${w.counters.warsEver}  religions ${w.religions.size}/${w.counters.religionsEver}  roads ${w.roads.size}  notables ${w.notables.size}  events ${w.nextEventId}`,
);
console.log('--- highest severity, latest ---');
for (const e of w.chronicle.filter((e) => e.severity === 3).slice(-14)) console.log('  ' + e.text);

const hist = new Map<string, number>();
for (const e of w.chronicle) hist.set(e.kind, (hist.get(e.kind) ?? 0) + 1);
console.log('--- kinds in the live buffer ---');
console.log(
  '  ' +
    Array.from(hist.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join('  '),
);
console.log(`--- eras summarized: ${w.eras.length} ---`);
console.log('--- a slice of the middle ---');
const mid = Math.floor(w.chronicle.length * 0.5);
for (const e of w.chronicle.slice(mid, mid + 16)) console.log(`  [${e.severity}] ${e.text}`);
