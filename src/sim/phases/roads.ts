import type { World } from './../types.ts';
import { edgeA, edgeB, edgeKey } from './../hex.ts';
import { costField, tracePath } from './../path.ts';
import { emit } from './../chronicle.ts';
import { ROAD_THRESHOLD, ROAD_TRAFFIC_DECAY } from './../constants.ts';

/**
 * Phase 4 — roads.
 *
 * Nothing places a road. A trade pair that keeps trading accumulates traffic,
 * and when the traffic on that route crosses the threshold the route is paved
 * along its actual least-cost path. Roads then make trade cheaper, culture flow
 * faster, and plague travel — which is the whole point of having them.
 */
export function phaseRoads(w: World): void {
  const built: number[] = [];
  for (const [key, amount] of w.traffic) {
    const decayed = amount * ROAD_TRAFFIC_DECAY;
    if (decayed < 0.01) {
      w.traffic.delete(key);
      continue;
    }
    w.traffic.set(key, decayed);
    if (decayed >= ROAD_THRESHOLD && !w.roadRoutes.has(key)) built.push(key);
  }
  if (built.length === 0) return;
  built.sort((a, b) => a - b);

  for (const key of built) {
    const from = edgeA(key);
    const to = edgeB(key);
    const field = costField(w, from, 60);
    const path = tracePath(field, from, to);
    if (path.length < 2) {
      // Unreachable overland; the goods were going by water. No road.
      w.roadRoutes.add(key);
      continue;
    }
    w.roadRoutes.add(key);
    for (let i = 1; i < path.length; i++) w.roads.add(edgeKey(path[i - 1], path[i]));

    const a = w.tiles[from].settlement;
    const b = w.tiles[to].settlement;
    const sa = w.settlements.get(a);
    const sb = w.settlements.get(b);
    if (sa && sb) {
      emit(
        w,
        'road',
        1,
        [sa.id, sb.id],
        from,
        `The track between ${sa.name} and ${sb.name} had been walked into a road.`,
      );
    }
  }
}
