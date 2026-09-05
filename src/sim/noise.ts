import { hashUnit } from './rng.ts';

// Value noise. Smoothstep interpolation only — no trig, no pow, so it is
// bit-identical anywhere the sim runs.

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lattice(seed: number, ix: number, iy: number, octave: number): number {
  return hashUnit(ix, iy, seed, octave);
}

export function valueNoise(seed: number, x: number, y: number, octave = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(seed, x0, y0, octave);
  const b = lattice(seed, x0 + 1, y0, octave);
  const c = lattice(seed, x0, y0 + 1, octave);
  const d = lattice(seed, x0 + 1, y0 + 1, octave);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Fractal Brownian motion, normalised to [0,1]. */
export function fbm(
  seed: number,
  x: number,
  y: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed, x * freq, y * freq, o);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
