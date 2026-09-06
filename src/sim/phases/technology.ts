import type { Settlement, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance, weightedIndex } from './../rng.ts';
import { CULT } from './../culture.ts';
import { emit, pName } from './../chronicle.ts';
import { effectsOf, polityList, polityPop } from './../query.ts';
import { createNotable, polityResources, sortedIds } from './../factory.ts';
import { CULTURE_AXES } from './../types.ts';
import { availableTechs, TECH_BY_ID, techCost } from './../tech.ts';
import { INVENTOR_CHANCE, RESEARCH_PER_POP } from './../constants.ts';

/**
 * Phase 5 — technology.
 *
 * Research is just people plus inclination. What a polity reaches for next is
 * weighted by how well the tech's affinity matches its culture, so a martial
 * people gets to iron early and a mercantile one gets to coinage early, and
 * neither of them was told to.
 */
export function phaseTech(w: World): void {
  for (const p of polityList(w)) {
    const known = w.techs.get(p.id);
    if (!known) continue;
    const fx = effectsOf(w, p.id);
    const pop = polityPop(w, p);
    p.research += pop * RESEARCH_PER_POP * (0.4 + 1.2 * p.culture[CULT.scholarly]) * fx.research;

    if (p.researching) {
      const def = TECH_BY_ID.get(p.researching);
      if (!def) {
        p.researching = '';
      } else if (p.research >= techCost(def.era)) {
        p.research -= techCost(def.era);
        p.researching = '';
        // The realm's ledger, which is what research builds on next.
        known.add(def.id);
        // The craft itself starts in one place — the biggest, where the
        // workshops are — and has to travel from there like anything else.
        const host = workshopOf(w, p.id);
        if (host) host.techs.add(def.id);
        w.counters.techsEver++;
        announce(w, p.id, def.id, host);
      }
      continue;
    }

    const available = availableTechs(known, polityResources(w, p));
    if (available.length === 0) continue;
    const weights = available.map((t) => {
      let affinity = 0.35;
      for (const axis of CULTURE_AXES) {
        const a = t.affinity[axis];
        if (a) affinity += a * p.culture[CULT[axis]] * 2.2;
      }
      // Cheap things get picked more often, but not overwhelmingly so.
      return affinity / Math.sqrt(techCost(t.era));
    });
    const i = weightedIndex(w.rng, weights);
    if (i >= 0) p.researching = available[i].id;
  }
}

/** The biggest place in the realm; that's where the workshops are. */
function workshopOf(w: World, polityId: number): Settlement | undefined {
  const p = w.polities.get(polityId);
  if (!p) return undefined;
  let host: Settlement | undefined;
  let bestPop = -1;
  for (const sid of sortedIds(p.settlements)) {
    const s = w.settlements.get(sid);
    if (s && s.pop > bestPop) {
      bestPop = s.pop;
      host = s;
    }
  }
  return host;
}

function announce(w: World, polityId: number, techId: string, s: Settlement | undefined): void {
  const def = TECH_BY_ID.get(techId)!;
  const p = w.polities.get(polityId);
  if (!p) return;
  const host = s ? s.id : NONE;
  if (s && chance(w.rng, INVENTOR_CHANCE)) {
    const inv = createNotable(w, 'inventor', p.id, s.id, w.rng);
    emit(
      w,
      'tech',
      2,
      [inv.id, p.id, s.id],
      s.tile,
      `${inv.name}, of ${s.name}, ${def.deed} — ${def.name}.`,
    );
    return;
  }
  emit(
    w,
    'tech',
    1,
    [p.id, host],
    s ? s.tile : NONE,
    s
      ? `In ${s.name} they ${def.deed} — ${def.name}.`
      : `${pName(w, p.id)} ${def.deed} — ${def.name}.`,
  );
}
