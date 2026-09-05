// xoshiro128** — seeded, deterministic, 32-bit. No Math.random anywhere in the sim.
// State is a plain object so it serializes to JSON and survives structured clone.

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** splitmix32 to spread a single 32-bit seed across the four words of state. */
export function seedRng(seed: number): RngState {
  let x = seed >>> 0;
  const mix = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  const s: RngState = { a: mix(), b: mix(), c: mix(), d: mix() };
  if ((s.a | s.b | s.c | s.d) === 0) s.a = 1; // all-zero state is a fixed point
  return s;
}

export function cloneRng(r: RngState): RngState {
  return { a: r.a, b: r.b, c: r.c, d: r.d };
}

export function nextU32(r: RngState): number {
  const result = Math.imul(rotl(Math.imul(r.b, 5) >>> 0, 7), 9) >>> 0;
  const t = (r.b << 9) >>> 0;
  r.c = (r.c ^ r.a) >>> 0;
  r.d = (r.d ^ r.b) >>> 0;
  r.b = (r.b ^ r.c) >>> 0;
  r.a = (r.a ^ r.d) >>> 0;
  r.c = (r.c ^ t) >>> 0;
  r.d = rotl(r.d, 11);
  return result;
}

/** [0,1) */
export function rand(r: RngState): number {
  return nextU32(r) / 4294967296;
}

/** [0,n) integer. Modulo bias is irrelevant here and costs nothing to keep. */
export function randInt(r: RngState, n: number): number {
  return n <= 1 ? 0 : nextU32(r) % n;
}

export function range(r: RngState, lo: number, hi: number): number {
  return lo + rand(r) * (hi - lo);
}

export function chance(r: RngState, p: number): boolean {
  return rand(r) < p;
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  return arr[randInt(r, arr.length)];
}

/** Fisher-Yates, in place. */
export function shuffle<T>(r: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(r, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Roulette selection. Returns -1 if every weight is <= 0. */
export function weightedIndex(r: RngState, weights: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) if (weights[i] > 0) total += weights[i];
  if (total <= 0) return -1;
  let roll = rand(r) * total;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    roll -= weights[i];
    if (roll < 0) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return -1;
}

/**
 * Irwin-Hall(4), centred and scaled to unit variance. Normal enough for drift,
 * and unlike Box-Muller it never touches Math.log/Math.cos, whose last-bit
 * results are not pinned down across engines.
 */
export function gauss(r: RngState): number {
  const s = rand(r) + rand(r) + rand(r) + rand(r) - 2;
  return s * 1.7320508075688772;
}

/**
 * Stateless hash — for decisions that must not perturb the main stream
 * (resource scatter, per-tile disaster rolls). Deterministic in its inputs.
 */
export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = (0x811c9dc5 ^ (a | 0)) >>> 0;
  h = Math.imul(h ^ (b | 0), 0x27220a95) >>> 0;
  h = Math.imul(h ^ (c | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (d | 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** hash32 mapped to [0,1). */
export function hashUnit(a: number, b = 0, c = 0, d = 0): number {
  return hash32(a, b, c, d) / 4294967296;
}
