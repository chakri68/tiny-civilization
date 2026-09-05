import type { World } from './../types.ts';
import { NONE } from './../types.ts';
import { hash32 } from './../rng.ts';
import { emit } from './../chronicle.ts';
import { RULER_LIFESPAN_MAX, RULER_LIFESPAN_MIN } from './../constants.ts';

const NOTABLE_CAP = 400;

/**
 * Phase 10 — the lifecycle of named people.
 *
 * Notables are the sampling layer: you simulate the village and occasionally
 * name someone. They age, they die, and the deeds attached to them are what the
 * inspector shows a hundred years later. The dead who did nothing get forgotten
 * on purpose, so this list stays short.
 */
export function phaseNotables(w: World): void {
  const ids = Array.from(w.notables.keys()).sort((a, b) => a - b);

  for (const id of ids) {
    const n = w.notables.get(id)!;
    if (n.died !== NONE) continue;
    const age = w.tick - n.born;
    const span = RULER_LIFESPAN_MIN + (hash32(id, 0x11f) % (RULER_LIFESPAN_MAX - RULER_LIFESPAN_MIN));
    if (age < span) continue;
    n.died = w.tick;
    // Only the ones who did something get an obituary; the rest just stop.
    if (n.deeds.length >= 3) {
      const s = w.settlements.get(n.settlement);
      emit(
        w,
        'succession',
        1,
        [n.id],
        s ? s.tile : NONE,
        `${n.name} died at ${Math.floor(age / 12)}, having been ${roleWord(n.role)} for a long time.`,
      );
    }
  }

  if (w.notables.size <= NOTABLE_CAP) return;
  // Forget the least consequential dead first.
  const forgettable = ids
    .map((id) => w.notables.get(id)!)
    .filter((n) => n.died !== NONE)
    .sort((a, b) => a.deeds.length - b.deeds.length || a.died - b.died || a.id - b.id);
  let toDrop = w.notables.size - NOTABLE_CAP;
  for (const n of forgettable) {
    if (toDrop-- <= 0) break;
    const p = w.polities.get(n.polity);
    if (p && p.ruler === n.id) continue;
    w.notables.delete(n.id);
  }
}

function roleWord(role: string): string {
  switch (role) {
    case 'ruler':
      return 'the one in charge';
    case 'prophet':
      return 'listened to';
    case 'inventor':
      return 'the cleverest in the room';
    case 'general':
      return 'the one they sent to the border';
    case 'explorer':
      return 'away more often than not';
    default:
      return 'known';
  }
}
