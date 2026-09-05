import type { World } from './types.ts';
import { BIOME } from './biomes.ts';
import { neighbors, edgeKey } from './hex.ts';

// A tiny binary heap. Ties break on tile index so expansion order is fixed.
class Heap {
  private items: number[] = [];
  private costs: number[] = [];

  push(item: number, cost: number): void {
    this.items.push(item);
    this.costs.push(cost);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] < this.costs[i] || (this.costs[parent] === this.costs[i] && this.items[parent] <= this.items[i])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.items.length && (this.costs[l] < this.costs[best] || (this.costs[l] === this.costs[best] && this.items[l] < this.items[best]))) best = l;
        if (r < this.items.length && (this.costs[r] < this.costs[best] || (this.costs[r] === this.costs[best] && this.items[r] < this.items[best]))) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = ti;
    const tc = this.costs[a];
    this.costs[a] = this.costs[b];
    this.costs[b] = tc;
  }
}

export function moveCost(w: World, tile: number, road: boolean): number {
  const t = w.tiles[tile];
  const base = BIOME[t.biome].moveCost;
  if (!Number.isFinite(base) || base > 100) return Infinity;
  let c = base;
  if (t.river) c *= 0.8;
  if (road) c *= 0.4;
  return c;
}

export interface Field {
  cost: Map<number, number>;
  from: Map<number, number>;
}

/**
 * Dijkstra over move cost out to a budget. Used for settling, for road routes
 * and for "is that even reachable" checks. Deterministic: the heap breaks ties
 * on tile index, so equal-cost frontiers always expand in the same order.
 */
export function costField(w: World, origin: number, budget: number): Field {
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const heap = new Heap();
  const buf: number[] = [];
  cost.set(origin, 0);
  heap.push(origin, 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    const curCost = cost.get(cur)!;
    if (curCost > budget) continue;
    const c = neighbors(w.w, w.h, cur, buf);
    for (let k = 0; k < c; k++) {
      const nb = buf[k];
      const step = moveCost(w, nb, w.roads.has(edgeKey(cur, nb)));
      if (!Number.isFinite(step)) continue;
      const next = curCost + step;
      if (next > budget) continue;
      const prev = cost.get(nb);
      if (prev === undefined || next < prev) {
        cost.set(nb, next);
        from.set(nb, cur);
        heap.push(nb, next);
      }
    }
  }
  return { cost, from };
}

/** Walk the predecessor chain back from `target`. Empty if unreachable. */
export function tracePath(field: Field, origin: number, target: number): number[] {
  if (!field.cost.has(target)) return [];
  const path: number[] = [target];
  let cur = target;
  let guard = 0;
  while (cur !== origin && guard++ < 4096) {
    const prev = field.from.get(cur);
    if (prev === undefined) return [];
    path.push(prev);
    cur = prev;
  }
  path.reverse();
  return path;
}
