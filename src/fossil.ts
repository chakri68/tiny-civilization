import type { World } from './sim/types.ts';
import { tileShade } from './sim/biomes.ts';
import { NONE } from './sim/types.ts';
import { totalPop, totalTechs } from './sim/world.ts';
import { yearOf } from './sim/chronicle.ts';

export interface Fossil {
  format: 'civ-fossil/1';
  name: string;
  seed: number;
  ticks: number;
  world: { w: number; h: number };
  summary: {
    year: number;
    pop: number;
    peak_pop: number;
    polities_now: number;
    polities_ever: number;
    settlements: number;
    techs: number;
    wars: number;
    religions: number;
    roads: number;
  };
  eras: World['eras'];
  chronicle_tail: World['chronicle'];
  notables_top: {
    name: string;
    role: string;
    polity: string;
    born: number;
    died: number | null;
    deeds: number;
  }[];
  map_png_b64: string;
}

/**
 * Because the sim is deterministic, `seed` plus `ticks` is already the whole
 * world. Everything else in here is so the file can be read without running it.
 */
export function buildFossil(w: World, mapPng: string): Fossil {
  const notables = Array.from(w.notables.values())
    .sort((a, b) => b.deeds.length - a.deeds.length || a.id - b.id)
    .slice(0, 50)
    .map((n) => ({
      name: n.name,
      role: n.role,
      polity: w.polities.get(n.polity)?.name ?? 'a forgotten people',
      born: yearOf(n.born),
      died: n.died === NONE ? null : yearOf(n.died),
      deeds: n.deeds.length,
    }));

  return {
    format: 'civ-fossil/1',
    name: w.name,
    seed: w.seed,
    ticks: w.tick,
    world: { w: w.w, h: w.h },
    summary: {
      year: yearOf(w.tick),
      pop: totalPop(w),
      peak_pop: w.counters.peakPop,
      polities_now: w.polities.size,
      polities_ever: w.counters.politiesEver,
      settlements: w.settlements.size,
      techs: totalTechs(w),
      wars: w.counters.warsEver,
      religions: w.counters.religionsEver,
      roads: w.roads.size,
    },
    eras: w.eras,
    chronicle_tail: w.chronicle.slice(-500),
    notables_top: notables,
    map_png_b64: mapPng,
  };
}

/** One pixel per hex: biome brightness, with the owner's colour written over it. */
export function renderFossilMap(w: World): string {
  const canvas = document.createElement('canvas');
  canvas.width = w.w;
  canvas.height = w.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w.w, w.h);
  const hues = new Map<number, number>();
  for (const p of w.polities.values()) hues.set(p.id, p.hue);

  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i];
    const shade = tileShade(t.biome, t.river, t.elev);
    let [r, g, b] = hsl(shade.h, shade.s / 100, shade.l / 100);
    const hue = t.owner === NONE ? undefined : hues.get(t.owner);
    if (hue !== undefined) {
      const [pr, pg, pb] = hsl(hue, 0.6, 0.55);
      r = Math.round(r * 0.55 + pr * 0.45);
      g = Math.round(g * 0.55 + pg * 0.45);
      b = Math.round(b * 0.55 + pb * 0.45);
    }
    if (t.settlement !== NONE) {
      r = 255;
      g = 176;
      b = 0;
    }
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function downloadFossil(w: World): void {
  const fossil = buildFossil(w, renderFossilMap(w));
  const leading = leadingPolity(w);
  const filename = `${slug(leading)}-${yearOf(w.tick)}.fossil.json`;
  const blob = new Blob([JSON.stringify(fossil, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function leadingPolity(w: World): string {
  let best = w.name || 'world';
  let bestPop = -1;
  for (const p of w.polities.values()) {
    let pop = 0;
    for (const id of p.settlements) pop += w.settlements.get(id)?.pop ?? 0;
    if (pop > bestPop) {
      bestPop = pop;
      best = p.name;
    }
  }
  return best;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}
