import type { Tile, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance, randInt } from './../rng.ts';
import { BIOME, biomeFor } from './../biomes.ts';
import { elevBandOf, naturalFertility } from './../worldgen.ts';
import { hexDistance, neighborList, tilesWithin } from './../hex.ts';
import { emit } from './../chronicle.ts';
import { settlementList } from './../query.ts';
import {
  CLEARING_CHANCE,
  CLIMATE_AMPLITUDE,
  CLIMATE_PERIOD,
  LANDSCAPE_SAMPLE,
  REGROWTH_CHANCE,
  SOIL_DRIFT,
  SOIL_EXHAUSTION_MAX,
  TICKS_PER_YEAR,
} from './../constants.ts';

/**
 * The land is not a backdrop. Over decades: towns cut the forest back, the
 * forest creeps in where nobody is standing, worked fields go thin and rested
 * ones recover, and a slow wet-dry cycle walks the desert margin back and forth.
 *
 * All of it runs once a year on a sample of tiles, so a change takes a human
 * lifetime to be obvious — which is the point.
 */

/**
 * Triangle wave, not a sine: Math.sin is not required to be correctly rounded,
 * and this number feeds terrain that has to be identical on every machine.
 */
export function climateShift(tick: number): number {
  const phase = (tick % CLIMATE_PERIOD) / CLIMATE_PERIOD;
  const triangle = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
  return triangle * CLIMATE_AMPLITUDE;
}

export function phaseLandscape(w: World): void {
  if (w.tick % TICKS_PER_YEAR !== 7) return;
  const climate = climateShift(w.tick);

  workedLand(w, climate);
  sampleWild(w, climate);
}

/** What living on a piece of ground does to it. */
function workedLand(w: World, climate: number): void {
  for (const s of settlementList(w)) {
    const t = w.tiles[s.tile];
    const exhaustion = Math.min(SOIL_EXHAUSTION_MAX, s.pop / 4200);
    const target = naturalFertility(t, climate) * (1 - exhaustion);
    const before = t.fertility;
    t.fertility += (target - t.fertility) * SOIL_DRIFT;

    // Cross the line from "good land" to "tired land" and someone notices.
    if (before >= 0.45 && t.fertility < 0.45 && s.tier !== 'camp') {
      emit(
        w,
        'landscape',
        1,
        [s.id],
        s.tile,
        `The fields around ${s.name} had gone thin from too many harvests.`,
      );
    }

    if (s.tier === 'camp') continue;
    clearForest(w, s.id, s.tile, s.pop, s.name, climate);
  }
}

/** A town eats its woodland from the inside out. */
function clearForest(
  w: World,
  sid: number,
  tile: number,
  pop: number,
  name: string,
  climate: number,
): void {
  const appetite = Math.min(0.5, pop / 3000) * CLEARING_CHANCE;
  if (!chance(w.rng, appetite)) return;

  const nearby: number[] = [];
  for (const i of tilesWithin(w.w, w.h, tile, 3)) {
    const t = w.tiles[i];
    if (t.settlement !== NONE) continue;
    if (t.biome === 'forest' || t.biome === 'taiga') nearby.push(i);
  }
  if (nearby.length === 0) return;

  const target = nearby[randInt(w.rng, nearby.length)];
  const t = w.tiles[target];
  const was = t.biome;
  const moisture = Math.min(1, Math.max(0, t.moisture + climate));
  t.biome = moisture > 0.4 ? 'grassland' : 'steppe';
  t.fertility = naturalFertility(t, climate);

  // Only worth a line when it was the last of it.
  if (nearby.length === 1) {
    emit(
      w,
      'landscape',
      2,
      [sid],
      target,
      `The last of the ${was === 'taiga' ? 'pinewood' : 'forest'} above ${name} came down for timber and fields.`,
    );
  }
}

/** Land nobody is standing on: it grows back, and the climate moves under it. */
function sampleWild(w: World, climate: number): void {
  const occupied = new Set<number>();
  for (const s of w.settlements.values()) {
    for (const i of tilesWithin(w.w, w.h, s.tile, 2)) occupied.add(i);
  }

  for (let n = 0; n < LANDSCAPE_SAMPLE; n++) {
    const i = randInt(w.rng, w.tiles.length);
    const t = w.tiles[i];
    if (!BIOME[t.biome].passable || t.biome === 'lake') continue;

    // Rested ground creeps back toward what it would be on its own.
    if (t.settlement === NONE) {
      t.fertility += (naturalFertility(t, climate) - t.fertility) * SOIL_DRIFT * 2;
    }
    if (occupied.has(i)) continue;

    if (regrow(w, i, t, climate)) continue;
    climateCreep(w, i, t, climate);
  }
}

function regrow(w: World, i: number, t: Tile, climate: number): boolean {
  if (t.biome !== 'grassland' && t.biome !== 'steppe') return false;
  let wooded = 0;
  for (const nb of neighborList(w.w, w.h, i)) {
    const b = w.tiles[nb].biome;
    if (b === 'forest' || b === 'taiga') wooded++;
  }
  if (wooded < 2) return false;
  const moisture = Math.min(1, Math.max(0, t.moisture + climate));
  if (moisture < 0.45) return false;
  if (!chance(w.rng, REGROWTH_CHANCE)) return false;
  t.biome = t.temp > 0.34 ? 'forest' : 'taiga';
  t.fertility = naturalFertility(t, climate);
  return true;
}

/** The desert margin, walking. */
function climateCreep(w: World, i: number, t: Tile, climate: number): void {
  const band = elevBandOf(t.elev);
  if (band === 0 || band >= 4) return;
  const moisture = Math.min(1, Math.max(0, t.moisture + climate));
  const want = band === 1 ? 'coast' : biomeFor(t.temp, moisture, band);
  if (want === t.biome) return;
  // Only the margins move, and only sometimes, so it reads as creep not churn.
  if (!chance(w.rng, 0.3)) return;
  const was = t.biome;
  t.biome = want;
  t.fertility = naturalFertility(t, climate);

  if (want === 'desert' && was !== 'desert') {
    let near = NONE;
    for (const s of w.settlements.values()) {
      if (hexDistance(w.w, s.tile, i) <= 3) {
        near = s.id;
        break;
      }
    }
    if (near !== NONE) {
      const s = w.settlements.get(near)!;
      emit(w, 'landscape', 2, [s.id], i, `The grass did not come back to the flats outside ${s.name}.`);
    }
  }
}
