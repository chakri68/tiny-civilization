import type { Event, EventKind, EraSummary, Id, World } from './types.ts';
import { CHRONICLE_CAP, ERA_BLOCK, ERA_HIGHLIGHTS, TICKS_PER_YEAR } from './constants.ts';

export function yearOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR) + 1;
}
export function monthOf(tick: number): number {
  return (tick % TICKS_PER_YEAR) + 1;
}

// --- name lookups used by the templates -------------------------------------
export function sName(w: World, id: Id): string {
  return w.settlements.get(id)?.name ?? 'a lost place';
}
export function pName(w: World, id: Id): string {
  return w.polities.get(id)?.name ?? 'a forgotten people';
}
export function nName(w: World, id: Id): string {
  return w.notables.get(id)?.name ?? 'someone';
}
export function rName(w: World, id: Id): string {
  return w.religions.get(id)?.name ?? 'the old faith';
}

/**
 * Writes one line of history. Severity 0 is dropped on the floor — routine
 * growth is not news. Anything at severity 2 or above is also filed as a deed
 * against every notable named in it.
 */
export function emit(
  w: World,
  kind: EventKind,
  severity: 0 | 1 | 2 | 3,
  subjects: Id[],
  tile: number,
  text: string,
): number {
  if (severity === 0) return -1;
  const id = w.nextEventId++;
  const ev: Event = {
    id,
    tick: w.tick,
    kind,
    subjects,
    tile,
    text: `Year ${yearOf(w.tick)}. ${text.charAt(0).toUpperCase()}${text.slice(1)}`,
    severity,
  };
  w.chronicle.push(ev);
  if (severity >= 2) {
    for (const s of subjects) {
      const n = w.notables.get(s);
      if (n && n.deeds.length < 24) n.deeds.push(id);
    }
  }
  if (w.chronicle.length > CHRONICLE_CAP + ERA_BLOCK) collapseOldest(w);
  return id;
}

const DISASTER_KINDS = new Set<EventKind>(['plague', 'drought', 'flood', 'quake', 'famine']);
const FOUNDING_KINDS = new Set<EventKind>(['found_settlement', 'found_polity']);
const WAR_KINDS = new Set<EventKind>(['war', 'sack']);

/**
 * When the ring buffer overflows, the oldest block collapses into one permanent
 * era summary: counts, plus the loudest handful kept verbatim. Memory stays
 * bounded; the arc survives.
 */
function collapseOldest(w: World): void {
  const block = w.chronicle.splice(0, ERA_BLOCK);
  if (block.length === 0) return;
  const s: EraSummary = {
    from: block[0].tick,
    to: block[block.length - 1].tick,
    wars: 0,
    foundings: 0,
    techs: 0,
    disasters: 0,
    religions: 0,
    peakPop: w.counters.peakPop,
    polities: w.polities.size,
    highlights: [],
  };
  for (const e of block) {
    if (WAR_KINDS.has(e.kind)) s.wars++;
    else if (FOUNDING_KINDS.has(e.kind)) s.foundings++;
    else if (e.kind === 'tech') s.techs++;
    else if (DISASTER_KINDS.has(e.kind)) s.disasters++;
    else if (e.kind === 'religion' || e.kind === 'schism') s.religions++;
  }
  // Stable sort on (severity desc, tick asc) so the highlights are reproducible.
  const ranked = block.slice().sort((a, b) => b.severity - a.severity || a.tick - b.tick);
  s.highlights = ranked.slice(0, ERA_HIGHLIGHTS);
  w.eras.push(s);
}

export function eraLabel(s: EraSummary): string {
  return `Years ${yearOf(s.from)}–${yearOf(s.to)}`;
}

export function eraSentence(s: EraSummary): string {
  const parts: string[] = [];
  if (s.foundings) parts.push(`${s.foundings} founded`);
  if (s.wars) parts.push(`${s.wars} at war`);
  if (s.techs) parts.push(`${s.techs} discoveries`);
  if (s.religions) parts.push(`${s.religions} faiths stirred`);
  if (s.disasters) parts.push(`${s.disasters} calamities`);
  return parts.length ? parts.join(', ') : 'little worth recording';
}
