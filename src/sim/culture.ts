import { CULT, type CultureVec } from './types.ts';
import { gauss, type RngState } from './rng.ts';

export function newCulture(r: RngState): CultureVec {
  const c: CultureVec = [];
  for (let i = 0; i < 6; i++) c.push(0.25 + Math.abs(gauss(r)) * 0.2);
  return clampCulture(c);
}

export function cloneCulture(c: CultureVec): CultureVec {
  return c.slice();
}

export function clampCulture(c: CultureVec): CultureVec {
  for (let i = 0; i < c.length; i++) {
    c[i] = c[i] < 0.02 ? 0.02 : c[i] > 0.98 ? 0.98 : c[i];
  }
  return c;
}

/** Move `a` toward `b` by rate. */
export function converge(a: CultureVec, b: CultureVec, rate: number): void {
  for (let i = 0; i < 6; i++) a[i] += (b[i] - a[i]) * rate;
  clampCulture(a);
}

export function drift(c: CultureVec, r: RngState, amount: number): void {
  for (let i = 0; i < 6; i++) c[i] += gauss(r) * amount;
  clampCulture(c);
}

export function perturb(c: CultureVec, r: RngState, amount: number): CultureVec {
  const out = c.slice();
  for (let i = 0; i < 6; i++) out[i] += gauss(r) * amount;
  return clampCulture(out);
}

/** Mean of a set of vectors. Empty input yields a neutral vector. */
export function meanCulture(vecs: CultureVec[]): CultureVec {
  const out = [0, 0, 0, 0, 0, 0];
  if (vecs.length === 0) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  for (const v of vecs) for (let i = 0; i < 6; i++) out[i] += v[i];
  for (let i = 0; i < 6; i++) out[i] /= vecs.length;
  return out;
}

/** 0 = identical, 1 = maximally different. */
export function cultureDistance(a: CultureVec, b: CultureVec): number {
  let s = 0;
  for (let i = 0; i < 6; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / 6);
}

/** The axis a culture leans on hardest — used for flavour text and gov choice. */
export function dominantAxis(c: CultureVec): number {
  let best = 0;
  for (let i = 1; i < 6; i++) if (c[i] > c[best]) best = i;
  return best;
}

export const CULTURE_ADJECTIVES: readonly (readonly [string, string])[] = [
  ['warlike', 'peaceable'],
  ['mercantile', 'insular'],
  ['devout', 'worldly'],
  ['learned', 'incurious'],
  ['communal', 'fractious'],
  ['restless', 'rooted'],
];

export function describeCulture(c: CultureVec): string {
  const i = dominantAxis(c);
  return CULTURE_ADJECTIVES[i][c[i] >= 0.5 ? 0 : 1];
}

export { CULT };
