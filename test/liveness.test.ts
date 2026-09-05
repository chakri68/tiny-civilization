import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, totalPop, totalTechs } from '../src/sim/world.ts';
import { runTicks } from '../src/sim/tick.ts';

const SEEDS = Number(process.env.LIVENESS_SEEDS ?? 12);
const TICKS = Number(process.env.LIVENESS_TICKS ?? 5000);

/** No world should end up empty, NaN, or locked in a war it cannot leave. */
test(`${SEEDS} seeds x ${TICKS} ticks stay alive and finite`, () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const w = createWorld(seed * 7919, `Seed ${seed}`);
    runTicks(w, TICKS);

    const pop = totalPop(w);
    assert.ok(pop > 0, `seed ${seed}: world died`);
    assert.ok(Number.isFinite(pop), `seed ${seed}: population is not finite`);
    assert.ok(w.polities.size > 0, `seed ${seed}: no polities left`);

    for (const s of w.settlements.values()) {
      assert.ok(Number.isFinite(s.pop) && s.pop >= 0, `seed ${seed}: ${s.name} pop ${s.pop}`);
      assert.ok(Number.isFinite(s.food), `seed ${seed}: ${s.name} food ${s.food}`);
      for (const v of s.culture) assert.ok(v >= 0 && v <= 1, `seed ${seed}: culture out of range`);
      assert.ok(w.polities.has(s.polity), `seed ${seed}: ${s.name} belongs to a dead polity`);
    }
    for (const p of w.polities.values()) {
      assert.ok(p.settlements.size > 0, `seed ${seed}: ${p.name} holds nothing`);
      assert.ok(Number.isFinite(p.stability), `seed ${seed}: ${p.name} stability NaN`);
    }
    for (const war of w.wars.values()) {
      assert.ok(w.tick - war.since <= 12 * 61, `seed ${seed}: a war has run forever`);
    }
    assert.ok(Number.isFinite(totalTechs(w)));
  }
});
