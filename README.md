# a tiny civilization

A civilization that lives in a browser tab. It is simulated only while that tab is
open — close it and the world stops mid-sentence; open it again and it picks up on
the same tick, having missed nothing, because nothing happened.

You cannot help it. There are no god controls. You can pan, zoom, click on things,
change the speed, and read. That is the whole interaction model.

```
npm install
npm run dev
```

Vanilla TypeScript, Canvas 2D, IndexedDB. Zero runtime dependencies, ~30 KB gzipped.

---

## the one rule

Everything rests on determinism. One seeded PRNG (xoshiro128\*\*), a fixed timestep,
no `Math.random` anywhere in `src/sim`, and no iteration over a `Set` or `Map` in an
order that isn't pinned. Same seed plus same tick count means the same world, down
to the last float.

That is not a nice-to-have. It's what makes `seed + ticks` a complete description of
a world, which is what makes the fossil export a real artifact rather than a
screenshot, and what makes the test suite able to catch a nondeterminism bug as a
diff instead of a vibe.

```
npm test              # determinism, save/load, fossil replay, liveness
npm run test:liveness # 100 seeds x 5,000 ticks
```

The second rule is that time only passes while the tab exists. There is no catch-up
on resume, ever. A background tab gets its timers throttled to about 1/s by the
browser, so the civilization just runs slower while you aren't looking at it, which
is thematically about right.

---

## what a tick is

One tick is one simulated month. Eleven phases, in this order, each in its own file
under `src/sim/phases/`:

1. **growth** — land yields food in proportion to carrying capacity, people eat a
   fixed amount. A settlement at capacity breaks even. Everything bad in the sim
   works by pushing population above capacity or capacity below population, and
   famine follows on its own.
2. **migration** — a settlement pressed against its ceiling sheds a band. Where it
   goes is a real Dijkstra over movement cost, so mountains and water shape how a
   people spreads. Sometimes the band keeps walking and stops answering to anyone.
3. **trade** — pairs within reach trade complementary goods. Trade moves wealth,
   moves actual resources (this is how a landlocked realm ends up with tin, and
   therefore with bronze), converges culture, and lays down traffic.
4. **roads** — nothing places a road. A route that keeps trading accumulates traffic
   and, past a threshold, gets paved along its least-cost path. Roads then make
   trade cheaper, culture flow faster, and plague travel — which is the point.
5. **technology** — research is people times inclination. What a realm reaches for
   next is weighted by how well the tech's affinity matches its culture, so a
   martial people finds iron early and a mercantile one finds coinage early, and
   nobody told either of them to.
6. **religion** — a faith starts where someone spiritual is having a bad decade,
   spreads down the same routes as everything else, and splits when a realm holding
   two of them stops holding together.
7. **politics** — territory, stability, succession, and the shape of the state.
   Stability is the hinge: it decides whether a dead king is replaced quietly or the
   realm comes apart.
8. **war** — rolled once a year between realms that are actually neighbours, fought
   settlement by settlement, ended when both sides are more tired than they are
   stable.
9. **disasters** — plague, drought, flood, earthquake, wolves at the edge of a
   camp, fever off the water. Plague is the one that moves, and it moves on the
   roads; endemic sickness just lives in the damp and the crowding and stays put.
10. **landscape** — the land is not a backdrop. Towns cut the forest back, the
    forest creeps in where nobody is standing, worked fields go thin and rested
    ones recover, and a 600-year wet-dry cycle walks the desert margin back and
    forth. All of it on a yearly sample, so a change takes a lifetime to notice.
11. **notables** — named people age, die, and accumulate deeds. The dead who did
    nothing get forgotten on purpose, which is what keeps the list short.
12. **chronicle & stats** — write the lines, sample the series.

Persistence is the last phase and lives in the UI, not the sim: a debounced write
every ten ticks and on `visibilitychange`.

**Culture** is the abstraction doing most of the qualitative work: six floats —
martial, mercantile, spiritual, scholarly, communal, expansionist — that drift, and
converge along trade routes, and decide almost everything about how a realm behaves.
Six is enough to make realms feel different and few enough to stay legible. Resist
adding a seventh.

**Faith feeds back into all of it.** A religion's tenets are an attractor on the
culture of everyone who keeps it, so a martial creed makes its followers warlike,
and that goes straight into who picks a fight with whom and what they think is
worth inventing. Two realms sharing a faith are markedly less likely to go to war;
two realms with rival ones are more so, in proportion to how far apart the creeds
sit. And a faith is not a fixed point — its tenets drift toward what its followers
have become, slower than they change and faster than never.

A realm's own culture is the population-weighted mean of its settlements, arrived
at over about a generation. That link matters more than it sounds: without it
`Polity.culture` sits frozen at whatever it was founded with, and none of the
drift, trade convergence or religious pull downstream of it ever reaches a single
decision that uses it.

---

## population is aggregate, people are sampled

Settlements hold integer populations and rates. Nobody simulates villagers. Named
individuals exist only as *notables* — a few hundred at a time, capped — spawned when
something narratively interesting happens and pruned when they die having done
nothing. You simulate the village and occasionally name someone.

---

## the map

Two paths, picked by zoom. Zoomed out the whole world is on screen and drawing six
thousand hexes live costs ~20 ms a frame — fine for one redraw, ruinous for a pan —
so the frame is a blit of a cached world layer, rebuilt only when the world changes.
Past 2x that cache would be upscaled into mush, so the map is drawn live instead,
culled to the viewport, which by then is a few hundred hexes. Crisp at any zoom,
and sub-millisecond on both paths.

Terrain gets real colour; the interface gets amber and nothing else. Realm colours
are spread by golden angle, so neighbours are never two shades of the same thing.

Measured on a mid laptop, in Chrome, at 186 settlements: **1.4 ms per tick**, frames
at **0 ms zoomed out** and **0.3–0.9 ms zoomed in**, **~0.3% idle CPU at 1x**.
Budget was 2 ms and 3%.

---

## fossils

`export` writes `{realm}-{year}.fossil.json`: the seed, the tick count, the era
summaries, the last 500 chronicle lines, the fifty most consequential people, and a
one-pixel-per-hex PNG of the map.

Because the sim is deterministic the seed and tick count alone would regenerate the
whole world; everything else in the file is so it can be read without running it.

---

## tuning

The interesting part of the project, and the part that is never finished:

```
npm run run -- 12345 40000   # one world, headless, with a chronicle sample
npm run sweep -- 100 5000    # 100 seeds, distributions, soft-target check
```

Every constant lives in `src/sim/constants.ts`. If a seed comes out boring, move a
constant. Never special-case the seed.

Things found this way, in case they're instructive: religions flip-flopping monthly
between two neighbouring faiths until a conversion cooldown was added; a plague model
with no immunity, which ping-ponged between neighbours until it had killed 96% of the
world; and trade convergence running about fifty times stronger than cultural drift,
which quietly flattened every realm on the map onto the same six numbers within a few
centuries.

---

## where this departs from the spec

- **Phases mutate in place** rather than returning mutation lists. Ordered, isolated,
  one per file — but materialising a diff eleven times a tick was the one thing that
  would have blown the 2 ms budget. Determinism does not depend on it.
- **Biome lookup takes temperature** (from latitude and elevation) as a third axis
  alongside moisture. The spec keys biome on elevation and moisture, but its own
  biome list contains taiga and tundra, and those need cold.
- **A territory phase** — settlements pushing claims outward, strongest wins — is
  folded into politics. It's what draws the borders and what tells the war phase who
  is standing next to whom.
- **War neighbours include realms within nine hexes**, not only realms whose borders
  touch. Founding bands start twelve hexes apart and their borders take three
  centuries to meet; without this the opening of every world has no wars at all.
- **Multiple worlds per browser**, listed on a start screen. The spec said ship one
  and add multiple only if one hurts. IndexedDB made multiple nearly free and it is
  the friendlier answer, but it does dilute "the civilization in *this* tab" — worth
  a second opinion.
- **74 techs**, not ~60.
- **The interface follows `ui_theme.md`** — amber phosphor terminal — rather than the
  parchment-and-serif direction in the spec.

## still open

- The map saturates at around 185 settlements and then stays there for two thousand
  years. That is what a finite continent should do, and the late game gets its
  interest from politics instead of expansion, but there is no churn: settlements
  almost never die out and get refounded.
- Realms still homogenise culturally over long runs — between-realm spread on most
  axes decays from about 0.10 to 0.04 by year 1700. Damping convergence across
  borders and across relief helped the first few centuries a lot and the endgame
  only somewhat. The residue is partly real (everyone alive descends from two or
  three surviving lineages) and partly that trade chains partner-to-partner across
  the whole continent. `spiritual` is the axis that holds its spread, because faith
  keeps pushing it apart, which suggests the fix is more independent attractors
  rather than weaker mixing.
