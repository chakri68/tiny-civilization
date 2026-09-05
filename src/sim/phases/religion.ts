import type { Settlement, World } from './../types.ts';
import { NONE } from './../types.ts';
import { chance } from './../rng.ts';
import { converge, CULT, cultureDistance, perturb } from './../culture.ts';
import { emit, nName, rName } from './../chronicle.ts';
import { polityList, settlementList } from './../query.ts';
import { createNotable, createReligion, sortedIds } from './../factory.ts';
import {
  CONVERSION_COOLDOWN,
  CONVERSION_MARGIN,
  CONVERSION_RATE,
  PROPHET_CHANCE,
  PROPHET_MIN_POP,
  FAITH_PULL,
  SCHISM_CHANCE,
  TICKS_PER_YEAR,
} from './../constants.ts';

/**
 * Phase 6 — religion and schism.
 *
 * A faith starts where someone spiritual is having a bad decade, spreads down
 * the same trade routes as everything else, and splits when a realm holding two
 * of them stops holding together.
 */
export function phaseReligion(w: World): void {
  const list = settlementList(w);

  for (const s of list) {
    if (s.pop < PROPHET_MIN_POP) continue;
    const spiritual = s.culture[CULT.spiritual];
    // A new faith is far likelier where there isn't one yet, which keeps the
    // opening centuries from being godless and the late game from drowning in cults.
    const vacancy = s.religion === NONE ? 4 : 1;
    const p =
      PROPHET_CHANCE * spiritual * spiritual * 4 * vacancy * (1 + s.unrest * 3) * Math.min(2, s.pop / 400);
    if (!chance(w.rng, p)) continue;

    const prophet = createNotable(w, 'prophet', s.polity, s.id, w.rng);
    const religion = createReligion(w, prophet, s, s.culture, NONE, w.rng);
    const previous = s.religion;
    s.religion = religion.id;
    s.religionSince = w.tick;
    s.unrest = Math.max(0, s.unrest - 0.1);
    emit(
      w,
      'religion',
      3,
      [religion.id, prophet.id, s.id, s.polity],
      s.tile,
      previous === NONE
        ? `${prophet.name} of ${s.name} began preaching. The teaching came to be called ${religion.name}.`
        : `${prophet.name} of ${s.name} turned the town away from ${rName(w, previous)}. They now keep ${religion.name}.`,
    );
  }

  // --- what a faith does to the people who keep it --------------------------
  // The tenets are an attractor on local culture, so a warlike faith makes its
  // followers warlike, and that feeds straight into who picks a fight with whom
  // and what they think is worth inventing. This is the loop that makes
  // religion matter to anything other than religion.
  for (const s of list) {
    if (s.religion === NONE) continue;
    const faith = w.religions.get(s.religion);
    if (faith) converge(s.culture, faith.tenets, FAITH_PULL);
  }

  // --- spread along the trade network --------------------------------------
  // Rolled once a year, with a cooldown. Without both, two neighbouring faiths
  // will trade a town back and forth every month and fill the chronicle with it.
  if (w.tick % TICKS_PER_YEAR === 3) {
    for (const s of list) {
      if (s.religion === NONE) continue;
      const faith = w.religions.get(s.religion);
      if (!faith) {
        s.religion = NONE;
        continue;
      }
      for (const pid of s.partners) {
        const o = w.settlements.get(pid);
        if (!o || o.religion === s.religion) continue;
        if (w.tick - o.religionSince < CONVERSION_COOLDOWN) continue;

        const affinity = 1 - cultureDistance(o.culture, faith.tenets);
        const incumbent =
          o.religion === NONE
            ? 0.45
            : 1 - cultureDistance(o.culture, w.religions.get(o.religion)?.tenets ?? o.culture);
        // A faith has to fit the place better than the one already there.
        if (affinity - incumbent < CONVERSION_MARGIN) continue;

        const weight = Math.min(2.5, Math.sqrt(s.pop / Math.max(60, o.pop)));
        const pressure =
          CONVERSION_RATE * weight * (affinity - incumbent) * (1 + o.culture[CULT.spiritual]);
        if (!chance(w.rng, pressure)) continue;

        const from = o.religion;
        o.religion = s.religion;
        o.religionSince = w.tick;
        // Only places anyone has heard of make the chronicle.
        const severity = o.tier === 'city' ? 3 : o.tier === 'town' ? 2 : o.tier === 'village' ? 1 : 0;
        emit(
          w,
          'conversion',
          severity,
          [o.id, faith.id],
          o.tile,
          from === NONE
            ? `${o.name} took up ${faith.name}, carried in with the ${s.name} traders.`
            : `${o.name} left ${rName(w, from)} for ${faith.name}.`,
        );
      }
    }
  }

  if (w.tick % TICKS_PER_YEAR === 0) recountAdherents(w, list);
  if (w.tick % TICKS_PER_YEAR === 6) trySchism(w);
}

function recountAdherents(w: World, list: Settlement[]): void {
  const followerCulture = new Map<number, { vec: number[]; pop: number }>();
  for (const r of w.religions.values()) r.adherents = 0;
  for (const s of list) {
    const r = w.religions.get(s.religion);
    if (!r) continue;
    r.adherents += s.pop;
    const acc = followerCulture.get(r.id) ?? { vec: [0, 0, 0, 0, 0, 0], pop: 0 };
    for (let i = 0; i < 6; i++) acc.vec[i] += s.culture[i] * s.pop;
    acc.pop += s.pop;
    followerCulture.set(r.id, acc);
  }
  // A faith is not a fixed point. It drifts toward what the people who keep it
  // have become, which is slower than they change and faster than never.
  for (const [rid, acc] of Array.from(followerCulture.entries()).sort((a, b) => a[0] - b[0])) {
    const r = w.religions.get(rid);
    if (!r || acc.pop <= 0) continue;
    const mean = acc.vec.map((v) => v / acc.pop);
    converge(r.tenets, mean, 0.02);
  }
  // A faith nobody keeps is not a faith; leave the name in the chronicle only.
  for (const [id, r] of Array.from(w.religions.entries()).sort((a, b) => a[0] - b[0])) {
    if (r.adherents === 0 && w.tick - r.founded > TICKS_PER_YEAR * 50) w.religions.delete(id);
  }
}

/** Two faiths under one crown, and the crown slipping: the realm's church splits. */
function trySchism(w: World): void {
  for (const p of polityList(w)) {
    if (p.stability > 0.55 || p.settlements.size < 3) continue;
    const byFaith = new Map<number, number[]>();
    for (const sid of sortedIds(p.settlements)) {
      const s = w.settlements.get(sid);
      if (!s || s.religion === NONE) continue;
      const arr = byFaith.get(s.religion);
      if (arr) arr.push(sid);
      else byFaith.set(s.religion, [sid]);
    }
    if (byFaith.size < 2) continue;

    const odds = SCHISM_CHANCE * (1 - p.stability) * (1 + p.culture[CULT.spiritual] * 2);
    if (!chance(w.rng, odds)) continue;

    let biggest = NONE;
    let count = 0;
    for (const [rid, members] of byFaith) {
      if (members.length > count) {
        count = members.length;
        biggest = rid;
      }
    }
    const parentFaith = w.religions.get(biggest);
    const members = byFaith.get(biggest);
    if (!parentFaith || !members || members.length < 2) continue;

    const seedSettlement = w.settlements.get(members[members.length - 1]);
    if (!seedSettlement) continue;
    const heresiarch = createNotable(w, 'prophet', p.id, seedSettlement.id, w.rng);
    const splinter = createReligion(
      w,
      heresiarch,
      seedSettlement,
      perturb(parentFaith.tenets, w.rng, 0.16),
      parentFaith.id,
      w.rng,
    );
    let taken = 0;
    for (const sid of members) {
      const s = w.settlements.get(sid);
      if (!s) continue;
      if (chance(w.rng, 0.45)) {
        s.religion = splinter.id;
        s.religionSince = w.tick;
        s.unrest = Math.min(1, s.unrest + 0.12);
        taken++;
      }
    }
    if (taken === 0) {
      seedSettlement.religion = splinter.id;
      seedSettlement.religionSince = w.tick;
      taken = 1;
    }
    p.stability = Math.max(0.1, p.stability - 0.12);
    emit(
      w,
      'schism',
      3,
      [splinter.id, parentFaith.id, heresiarch.id, p.id],
      seedSettlement.tile,
      `${parentFaith.name} split. ${taken === 1 ? 'One town' : `${taken} towns`} now follow ${nName(w, heresiarch.id)} and call it ${splinter.name}.`,
    );
  }
}
