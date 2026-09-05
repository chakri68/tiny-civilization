import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, deserializeWorld, serializeWorld, totalPop, totalTechs } from '../src/sim/world.ts';
import { runTicks } from '../src/sim/tick.ts';

/**
 * The whole project rests on this one. Any accidental Math.random, any
 * dependence on Map iteration order that isn't insertion order, any float that
 * came out of a non-deterministic path, shows up here as a diff.
 */
test('same seed, same ticks, same world', () => {
  const a = createWorld(4242, 'A');
  const b = createWorld(4242, 'B');
  runTicks(a, 10000);
  runTicks(b, 10000);
  assert.equal(a.tick, b.tick);
  assert.deepEqual(serializeWorld(a).settlements, serializeWorld(b).settlements);
  assert.deepEqual(serializeWorld(a).polities, serializeWorld(b).polities);
  assert.deepEqual(serializeWorld(a).chronicle, serializeWorld(b).chronicle);
  assert.deepEqual(a.rng, b.rng);
  assert.equal(totalPop(a), totalPop(b));
});

test('different seeds diverge', () => {
  const a = createWorld(1, 'A');
  const b = createWorld(2, 'B');
  runTicks(a, 500);
  runTicks(b, 500);
  assert.notDeepEqual(serializeWorld(a).chronicle, serializeWorld(b).chronicle);
});

test('a saved world resumes exactly where it stopped', () => {
  const straight = createWorld(99, 'Straight');
  runTicks(straight, 3000);

  const saved = createWorld(99, 'Saved');
  runTicks(saved, 1500);
  const restored = deserializeWorld(structuredClone(serializeWorld(saved)));
  runTicks(restored, 1500);

  assert.equal(restored.tick, straight.tick);
  assert.equal(totalPop(restored), totalPop(straight));
  assert.equal(totalTechs(restored), totalTechs(straight));
  assert.deepEqual(serializeWorld(restored).chronicle, serializeWorld(straight).chronicle);
  assert.deepEqual(serializeWorld(restored).settlements, serializeWorld(straight).settlements);
});

test('replaying a fossil from seed and tick count reproduces its summary', () => {
  const original = createWorld(31337, 'Original');
  runTicks(original, 4000);
  const replay = createWorld(original.seed, 'Replay');
  runTicks(replay, original.tick);
  assert.deepEqual(replay.counters, original.counters);
});
