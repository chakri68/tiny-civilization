import type { CultureVec, Polity, Religion, Settlement, World } from './types.ts';
import { NONE } from './types.ts';
import { BASE_CAPACITY } from './constants.ts';
import { effectsFor, type Effects } from './tech.ts';

/** Ascending id. Everything in the sim iterates through these, never a raw Map. */
export function settlementList(w: World): Settlement[] {
  return Array.from(w.settlements.values()).sort((a, b) => a.id - b.id);
}

export function polityList(w: World): Polity[] {
  return Array.from(w.polities.values()).sort((a, b) => a.id - b.id);
}

/** A stable identity so the effects cache has something to key an empty set on. */
const NO_TECHS: Set<string> = new Set();

/** What a settlement itself knows how to do, which is not always what its realm knows. */
export function effectsAt(w: World, s: Settlement): Effects {
  void w;
  return effectsFor(s.techs);
}

/**
 * The realm's own reach, meaning its capital's. A court can only act on what sits
 * in front of it: a craft stranded in a cut-off province does not run the state.
 */
export function effectsOf(w: World, polity: number): Effects {
  const p = w.polities.get(polity);
  const seat = p ? w.settlements.get(p.capital) : undefined;
  return effectsFor(seat ? seat.techs : NO_TECHS);
}

/** Carrying capacity: land quality times what the polity knows how to do with it. */
export function capacityOf(w: World, s: Settlement, fx: Effects): number {
  const t = w.tiles[s.tile];
  const blight = s.blight > 0 ? 0.55 : 1;
  return Math.max(30, BASE_CAPACITY * t.fertility * fx.food * blight);
}

export function polityPop(w: World, p: Polity): number {
  let pop = 0;
  for (const id of p.settlements) {
    const s = w.settlements.get(id);
    if (s) pop += s.pop;
  }
  return pop;
}

/** 0..1 — how much of the realm shares one faith. Feeds stability. */
export function religiousUnity(w: World, p: Polity): number {
  const counts = new Map<number, number>();
  let total = 0;
  for (const id of p.settlements) {
    const s = w.settlements.get(id);
    if (!s) continue;
    total += s.pop;
    counts.set(s.religion, (counts.get(s.religion) ?? 0) + s.pop);
  }
  if (total === 0) return 1;
  let best = 0;
  for (const v of counts.values()) if (v > best) best = v;
  return best / total;
}

/** Population-weighted mean of a realm's settlements. */
export function polityCulture(w: World, p: Polity): CultureVec {
  const out = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const id of p.settlements) {
    const s = w.settlements.get(id);
    if (!s) continue;
    total += s.pop;
    for (let i = 0; i < 6; i++) out[i] += s.culture[i] * s.pop;
  }
  if (total <= 0) return p.culture.slice();
  for (let i = 0; i < 6; i++) out[i] /= total;
  return out;
}

/** The faith most of a realm keeps, if any. */
export function dominantFaith(w: World, p: Polity): Religion | null {
  const counts = new Map<number, number>();
  for (const id of p.settlements) {
    const s = w.settlements.get(id);
    if (!s || s.religion === NONE) continue;
    counts.set(s.religion, (counts.get(s.religion) ?? 0) + s.pop);
  }
  let best = NONE;
  let bestPop = 0;
  for (const [rid, pop] of counts) {
    if (pop > bestPop) {
      bestPop = pop;
      best = rid;
    }
  }
  return best === NONE ? null : (w.religions.get(best) ?? null);
}

export function avgUnrest(w: World, p: Polity): number {
  let sum = 0;
  let n = 0;
  for (const id of p.settlements) {
    const s = w.settlements.get(id);
    if (!s) continue;
    sum += s.unrest;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}
