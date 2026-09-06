import type { Settlement, World } from './../types.ts';
import { RESOURCES } from './../types.ts';
import { edgeKey, hexDistance } from './../hex.ts';
import { landmassOf } from './../path.ts';
import { RESOURCE } from './../biomes.ts';
import { converge, drift, CULT } from './../culture.ts';
import { effectsAt, settlementList } from './../query.ts';
import {
  CULTURE_FOREIGN,
  CULTURE_OVERSEAS,
  STOCK_DECAY,
  WEALTH_DECAY,
  CULTURE_CONVERGE,
  CULTURE_DRIFT,
  MAX_PARTNERS,
  PARTNER_REFRESH,
  TECH_DIFFUSION,
  TRADE_RADIUS,
  TRADE_WEALTH,
} from './../constants.ts';

/**
 * Phase 3 — production, trade and cultural drift.
 *
 * Trade is the main channel through which places stop being strangers: it moves
 * goods, wealth, and — slowly — culture. It also lays down the traffic that
 * later becomes roads.
 */
export function phaseTrade(w: World): void {
  const list = settlementList(w);
  const mass = landmassOf(w);

  for (const s of list) {
    const fx = effectsAt(w, s);
    const tile = w.tiles[s.tile];
    // Extraction scales with people, gently — a big town works the same tile harder.
    const output = Math.sqrt(s.pop) * 0.05 * fx.trade;
    // Everything in the granary is also being eaten, burnt or worn out.
    for (const r of RESOURCES) s.stock[r] *= STOCK_DECAY;
    s.wealth *= WEALTH_DECAY;
    for (const r of tile.resources) s.stock[r] += output;
    if (s.partnersTick + PARTNER_REFRESH <= w.tick) refreshPartners(w, s, list);
    // Every settlement wanders a little on its own. This has to stay within
    // an order of magnitude of the convergence above, or trade flattens the
    // whole map onto one culture within a few centuries.
    drift(s.culture, w.rng, CULTURE_DRIFT);
  }

  for (const s of list) {
    const fxA = effectsAt(w, s);
    for (let k = 0; k < s.partners.length; k++) {
      const pid = s.partners[k];
      if (pid <= s.id) continue; // each pair handled once, by the lower id
      const o = w.settlements.get(pid);
      if (!o) continue;

      const dist = s.partnerDist[k];
      const road = pathHasRoad(w, s, o);
      const complement = s.partnerComp[k];
      const fxB = effectsAt(w, o);
      const hostile = isHostile(w, s, o);

      const volume =
        Math.sqrt(s.pop * o.pop) *
        TRADE_WEALTH *
        (0.35 + complement) *
        ((fxA.trade + fxB.trade) / 2) *
        (1 + s.culture[CULT.mercantile] + o.culture[CULT.mercantile]) *
        (road ? 1.8 : 1) /
        (1 + dist * 0.22) *
        (hostile ? 0.1 : 1);

      if (volume <= 0) continue;
      s.wealth += volume;
      o.wealth += volume;

      const pa = w.polities.get(s.polity);
      const pb = w.polities.get(o.polity);
      if (pa) pa.treasury += volume * 0.15;
      if (pb && pb !== pa) pb.treasury += volume * 0.15;

      // Goods actually change hands, which is how a landlocked realm ends up
      // with tin and therefore with bronze.
      exchange(s, o, volume);

      // Convergence is strong inside a realm and weak across a border, and
      // mountains blunt it either way — which is what keeps neighbouring
      // peoples distinguishable a thousand years in.
      // Geography, twice over: a climb keeps two valleys strange, and open water
      // keeps two peoples stranger still.
      const relief = 1 / (1 + Math.abs(w.tiles[s.tile].elev - w.tiles[o.tile].elev) * 4);
      const overseas = mass[s.tile] !== mass[o.tile];
      const rate =
        CULTURE_CONVERGE *
        (road ? 1.6 : 1) *
        (s.polity === o.polity ? 1 : CULTURE_FOREIGN) *
        (overseas ? CULTURE_OVERSEAS : 1) *
        relief *
        Math.min(2, volume * 3);
      converge(s.culture, o.culture, rate);
      converge(o.culture, s.culture, rate);

      const key = edgeKey(s.tile, o.tile);
      w.traffic.set(key, (w.traffic.get(key) ?? 0) + volume * (hostile ? 0 : 1));
    }
  }

  diffuseTech(w, list);
}

/**
 * Knowledge travels with the goods.
 *
 * Once a year a settlement picks up whatever its trading partners in the same
 * realm know and it does not — one hop per pass, so a craft crosses a wide realm
 * in a decade, arrives late in the provinces, and never arrives at all in a place
 * that trades with nobody. Foreign partners are excluded: goods cross a border
 * far more easily than a trade does.
 */
function diffuseTech(w: World, list: Settlement[]): void {
  if (w.tick % TECH_DIFFUSION !== 0) return;
  // Gathered first and applied after, so a craft cannot cross the whole realm in
  // a single pass just because the settlement ids happen to run the right way.
  const incoming: string[][] = [];
  for (const s of list) {
    const add: string[] = [];
    for (const pid of s.partners) {
      const o = w.settlements.get(pid);
      if (!o || o.polity !== s.polity || o.techs.size === 0) continue;
      for (const t of o.techs) if (!s.techs.has(t)) add.push(t);
    }
    incoming.push(add);
  }
  for (let i = 0; i < list.length; i++) {
    const own = list[i].techs;
    for (const t of incoming[i]) own.add(t);
  }
}

function refreshPartners(w: World, s: Settlement, all: Settlement[]): void {
  const scored: { id: number; score: number; complement: number; dist: number }[] = [];
  const mass = landmassOf(w);
  const home = mass[s.tile];
  const afloat = Number.isFinite(effectsAt(w, s).sea);
  for (const o of all) {
    if (o.id === s.id) continue;
    const d = hexDistance(w.w, s.tile, o.tile);
    if (d > TRADE_RADIUS) continue;
    // Across water, somebody in the pair has to own a hull. Before that, an
    // island trades with itself and nobody else, however close the mainland is.
    if (mass[o.tile] !== home && !afloat && !Number.isFinite(effectsAt(w, o).sea)) continue;
    const complement = complementarity(w, s, o);
    const score = ((0.3 + complement) * Math.sqrt(o.pop)) / (1 + d * 0.3);
    scored.push({ id: o.id, score, complement, dist: d });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const chosen = scored.slice(0, MAX_PARTNERS);
  s.partners = chosen.map((x) => x.id);
  s.partnerComp = chosen.map((x) => x.complement);
  s.partnerDist = chosen.map((x) => x.dist);
  s.partnersTick = w.tick;
}

/** How much each has that the other lacks, in trade value. */
function complementarity(w: World, a: Settlement, b: Settlement): number {
  const ra = w.tiles[a.tile].resources;
  const rb = w.tiles[b.tile].resources;
  let score = 0;
  for (const r of ra) if (!rb.includes(r)) score += RESOURCE[r].value;
  for (const r of rb) if (!ra.includes(r)) score += RESOURCE[r].value;
  return Math.min(1.5, score * 0.12);
}

function exchange(a: Settlement, b: Settlement, volume: number): void {
  const move = volume * 6;
  for (const r of RESOURCES) {
    const diff = a.stock[r] - b.stock[r];
    if (diff > 1) {
      const amt = Math.min(move, diff * 0.25);
      a.stock[r] -= amt;
      b.stock[r] += amt;
    } else if (diff < -1) {
      const amt = Math.min(move, -diff * 0.25);
      b.stock[r] -= amt;
      a.stock[r] += amt;
    }
  }
}

function isHostile(w: World, a: Settlement, b: Settlement): boolean {
  if (a.polity === b.polity) return false;
  const p = w.polities.get(a.polity);
  return p ? p.wars.has(b.polity) : false;
}

function pathHasRoad(w: World, a: Settlement, b: Settlement): boolean {
  return w.roadRoutes.has(edgeKey(a.tile, b.tile));
}
