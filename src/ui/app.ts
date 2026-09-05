import type { World } from './../sim/types.ts';
import { NONE } from './../sim/types.ts';
import { createWorld, deserializeWorld, serializeWorld, totalPop } from './../sim/world.ts';
import { tick } from './../sim/tick.ts';
import { monthOf, yearOf } from './../sim/chronicle.ts';
import { PERSIST_INTERVAL } from './../sim/constants.ts';
import { SimClock, SPEEDS, type Speed } from './../loop.ts';
import { listWorlds, loadWorld, saveWorld, type WorldMeta } from './../persist/db.ts';
import { downloadFossil } from './../fossil.ts';
import { MapView, type Selection } from './map.ts';
import { focusPolity } from './techtree.ts';
import { ChroniclePane } from './chronicle.ts';
import { Inspector } from './inspector.ts';
import { StatsPage } from './stats.ts';
import { BIOME } from './../sim/biomes.ts';

const SHELL = `
<div class="shell">
  <header class="top">
    <h1>a tiny civilization</h1>
    <div class="clock"></div>
    <div class="counts"></div>
    <div class="spacer"></div>
    <div class="controls">
      <button class="chip" data-act="trade">trade</button>
      <button class="chip" data-act="names">names</button>
      <button class="chip" data-act="alerts">alerts</button>
      <span class="speeds"></span>
      <button class="btn" data-act="pause">resume</button>
      <button class="btn" data-act="stats">stats</button>
      <button class="btn" data-act="export">export</button>
      <button class="btn danger" data-act="new">new world</button>
    </div>
  </header>
  <div class="body">
    <div class="stage">
      <canvas id="map"></canvas>
      <div class="tip"></div>
      <div class="stats"></div>
    </div>
    <div class="resizer"></div>
    <aside class="sidebar">
      <section class="panel grow" data-panel="chronicle">
        <div class="panel-head">chronicle</div>
        <div class="panel-body"></div>
      </section>
      <section class="panel grow" data-panel="inspector">
        <div class="panel-head">inspector</div>
        <div class="panel-body"></div>
      </section>
    </aside>
  </div>
</div>
<div class="modal-back"><div class="modal"></div></div>
`;

export class App {
  private root: HTMLElement;
  private world: World | null = null;
  private map: MapView;
  private chronicle: ChroniclePane;
  private inspector: Inspector;
  private stats: StatsPage;
  private clock: SimClock;
  private lastSaveTick = 0;
  private lastToastId = 0;
  private tip: HTMLElement;
  private modalBack: HTMLElement;
  private modal: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = SHELL;

    this.map = new MapView(root.querySelector<HTMLCanvasElement>('#map')!);
    this.chronicle = new ChroniclePane(
      root.querySelector<HTMLElement>('[data-panel="chronicle"] .panel-body')!,
    );
    this.inspector = new Inspector(
      root.querySelector<HTMLElement>('[data-panel="inspector"] .panel-body')!,
    );
    this.stats = new StatsPage(root.querySelector<HTMLElement>('.stats')!);
    this.stats.onPickRealm = (id) => {
      this.map.select({ kind: 'polity', id });
      if (this.world) this.stats.render(this.world, id);
    };
    this.tip = root.querySelector<HTMLElement>('.tip')!;
    this.modalBack = root.querySelector<HTMLElement>('.modal-back')!;
    this.modal = root.querySelector<HTMLElement>('.modal')!;
    this.clock = new SimClock(() => this.step());

    this.wire();
  }

  // --- lifecycle ------------------------------------------------------------

  async boot(): Promise<void> {
    const saved = await listWorlds();
    if (saved.length === 0) {
      this.showNewWorld(false);
      return;
    }
    this.showStartScreen(saved);
  }

  private async open(id: string): Promise<void> {
    const save = await loadWorld(id);
    if (!save) {
      this.showNewWorld(false);
      return;
    }
    this.adopt(deserializeWorld(save));
    this.closeModal();
    // No catch-up, ever. The world resumes at the tick it stopped on, and only
    // once someone says so.
    this.showResumeBanner();
  }

  private begin(name: string, seed: number): void {
    const w = createWorld(seed, name);
    // Identity is metadata, not simulation state — createWorld stays a pure
    // function of the seed, and two worlds off the same seed still get their
    // own slot on disk.
    w.createdAt = Date.now();
    w.id = `${seed >>> 0}-${w.createdAt.toString(36)}`;
    this.adopt(w);
    this.closeModal();
    this.clock.resume();
    this.paint();
    void this.persist(true);
  }

  private adopt(w: World): void {
    this.world = w;
    this.clock.pause();
    this.lastSaveTick = w.tick;
    // Start from the present: opening a saved world should not replay a
    // thousand years of headlines at you.
    this.lastToastId = w.nextEventId;
    this.map.clearToasts();
    this.chronicle.reset();
    this.map.setWorld(w);
    this.map.resize();
    this.map.select({ kind: null, id: NONE });
    this.paint();
  }

  /** Dev harness hook: run N ticks as fast as the machine will do them. */
  fastForward(n: number): void {
    const w = this.world;
    if (!w) return;
    for (let i = 0; i < n; i++) tick(w);
    this.map.invalidate();
    this.paint();
  }

  // --- the tick -------------------------------------------------------------

  private step(): void {
    const w = this.world;
    if (!w) return;
    tick(w);
    this.pumpToasts();
    this.map.invalidate();
    this.paint();
    if (w.tick - this.lastSaveTick >= PERSIST_INTERVAL) void this.persist();
  }

  /** Feed anything newsworthy since the last tick to the map as a popup. */
  private pumpToasts(): void {
    const w = this.world;
    if (!w) return;
    const fresh = [];
    for (let i = w.chronicle.length - 1; i >= 0; i--) {
      const e = w.chronicle[i];
      if (e.id <= this.lastToastId) break;
      // Battles are usually severity 1 — routine by the chronicle's standards,
      // but they are the thing you want to see happening on the map.
      if (e.tile !== NONE && (e.severity >= 2 || e.kind === 'battle')) fresh.push(e);
    }
    this.lastToastId = w.nextEventId - 1;
    if (!this.map.showAlerts) return;
    for (const e of fresh.reverse()) {
      // Fighting is marked on the map every time; only the loud events also get
      // a popup, or a busy war would bury everything else under skirmishes.
      if (e.kind === 'battle' || e.kind === 'sack' || e.kind === 'war') this.map.pushClash(e.tile);
      if (e.severity < 2) continue;
      const text = e.text.length > 74 ? `${e.text.slice(0, 72)}…` : e.text;
      this.map.pushToast(text, e.tile, e.severity);
    }
  }

  private focus(): number {
    const w = this.world;
    if (!w) return -1;
    return focusPolity(w, this.map.selection.kind, this.map.selection.id);
  }

  private paint(): void {
    const w = this.world;
    if (!w) return;
    const pop = totalPop(w);
    this.root.querySelector('.clock')!.innerHTML =
      `<span class="yr">Year ${yearOf(w.tick).toLocaleString()}</span> · Month ${monthOf(w.tick)}`;
    this.root.querySelector('.counts')!.innerHTML =
      `<span><b>${w.polities.size}</b> realms</span>` +
      `<span><b>${pop.toLocaleString()}</b> people</span>` +
      `<span><b>${w.settlements.size}</b> settlements</span>` +
      `<span><b>${w.religions.size}</b> faiths</span>` +
      (w.wars.size ? `<span><b>${w.wars.size}</b> at war</span>` : '');
    document.title = `Year ${yearOf(w.tick).toLocaleString()} · ${pop.toLocaleString()} · ${w.name}`;
    this.chronicle.update(w);
    this.inspector.render(w, this.map.selection);
    this.stats.render(w, this.focus());
  }

  private async persist(force = false): Promise<void> {
    const w = this.world;
    if (!w) return;
    if (!force && w.tick === this.lastSaveTick) return;
    this.lastSaveTick = w.tick;
    const meta: WorldMeta = {
      id: w.id,
      name: w.name,
      seed: w.seed,
      tick: w.tick,
      savedAt: Date.now(),
      pop: totalPop(w),
      polities: w.polities.size,
      settlements: w.settlements.size,
    };
    await saveWorld(serializeWorld(w), meta);
  }

  // --- wiring ---------------------------------------------------------------

  private wire(): void {
    const speeds = this.root.querySelector('.speeds')!;
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.className = 'chip' + (s === this.clock.speed ? ' on' : '');
      b.textContent = `${s}x`;
      b.dataset.speed = String(s);
      b.addEventListener('click', () => {
        this.clock.setSpeed(s as Speed);
        for (const el of Array.from(speeds.children)) {
          el.classList.toggle('on', (el as HTMLElement).dataset.speed === String(s));
        }
      });
      speeds.appendChild(b);
    }

    this.root.querySelector('.controls')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'pause') this.togglePause();
      if (act === 'trade') {
        this.map.showTrade = !this.map.showTrade;
        (e.target as HTMLElement).classList.toggle('on', this.map.showTrade);
        this.map.invalidate();
      }
      if (act === 'names') {
        this.map.showNames = !this.map.showNames;
        (e.target as HTMLElement).classList.toggle('on', this.map.showNames);
        this.map.requestFrame();
      }
      if (act === 'alerts') {
        this.map.showAlerts = !this.map.showAlerts;
        (e.target as HTMLElement).classList.toggle('on', this.map.showAlerts);
        if (!this.map.showAlerts) this.map.clearToasts();
        this.map.requestFrame();
      }
      if (act === 'stats') {
        const on = this.stats.toggle(this.world, this.focus());
        (e.target as HTMLElement).classList.toggle('on', on);
      }
      if (act === 'export' && this.world) downloadFossil(this.world);
      if (act === 'new') this.showNewWorld(true);
    });

    for (const head of Array.from(this.root.querySelectorAll('.panel-head'))) {
      head.addEventListener('click', () => head.parentElement!.classList.toggle('collapsed'));
    }

    this.map.onSelect = (sel) => {
      this.inspector.render(this.world, sel);
      // The tech panel follows whatever you are looking at.
      if (this.world) this.stats.render(this.world, this.focus());
      void sel;
    };
    this.map.onHover = (tile, x, y) => this.showTip(tile, x, y);
    this.inspector.onSelect = (sel: Selection) => {
      this.map.select(sel);
      if (sel.kind === 'settlement') {
        const t = this.world?.settlements.get(sel.id)?.tile;
        if (t !== undefined) this.map.centerOn(t);
      }
    };
    this.chronicle.onPick = (ev) => {
      if (ev.tile !== NONE) this.map.centerOn(ev.tile);
      const w = this.world;
      if (!w) return;
      // Prefer the most specific subject the event names.
      for (const id of ev.subjects) {
        if (w.settlements.has(id)) return this.map.select({ kind: 'settlement', id });
      }
      for (const id of ev.subjects) {
        if (w.notables.has(id)) return this.map.select({ kind: 'notable', id });
      }
      for (const id of ev.subjects) {
        if (w.religions.has(id)) return this.map.select({ kind: 'religion', id });
      }
      for (const id of ev.subjects) {
        if (w.polities.has(id)) return this.map.select({ kind: 'polity', id });
      }
      if (ev.tile !== NONE) this.map.select({ kind: 'tile', id: ev.tile });
    };

    window.addEventListener('resize', () => {
      this.map.resize();
      if (this.world) this.stats.render(this.world, this.focus());
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.togglePause();
      }
    });

    // The world freezes when the tab does; make sure what is on screen is saved.
    const flush = () => void this.persist(true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);

    this.setupResizer();
  }

  private togglePause(): void {
    this.clock.toggle();
    const btn = this.root.querySelector<HTMLElement>('[data-act="pause"]')!;
    btn.textContent = this.clock.paused ? 'resume' : 'pause';
    btn.classList.toggle('on', !this.clock.paused);
  }

  private setupResizer(): void {
    const resizer = this.root.querySelector<HTMLElement>('.resizer')!;
    const sidebar = this.root.querySelector<HTMLElement>('.sidebar')!;
    let startX = 0;
    let startW = 0;
    const move = (e: PointerEvent) => {
      const next = Math.max(260, Math.min(720, startW - (e.clientX - startX)));
      sidebar.style.width = `${next}px`;
      this.map.resize();
    };
    const up = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    resizer.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  private showTip(tile: number, x: number, y: number): void {
    const w = this.world;
    if (!w || tile === NONE) {
      this.tip.classList.remove('show');
      return;
    }
    const t = w.tiles[tile];
    const s = t.settlement === NONE ? null : w.settlements.get(t.settlement);
    const owner = t.owner === NONE ? null : w.polities.get(t.owner);
    const rect = this.root.querySelector<HTMLElement>('.stage')!.getBoundingClientRect();
    this.tip.innerHTML = s
      ? `${s.name} <span class="dim">· ${s.tier} · ${Math.round(s.pop).toLocaleString()} people</span>` +
        (owner ? `<br><span class="dim">${owner.name}</span>` : '')
      : `${BIOME[t.biome].label}<span class="dim"> · fertility ${(t.fertility * 100).toFixed(0)}%${
          t.river ? ' · river' : ''
        }</span>` + (owner ? `<br><span class="dim">${owner.name}</span>` : '');
    this.tip.style.left = `${Math.min(x - rect.left + 14, rect.width - 220)}px`;
    this.tip.style.top = `${y - rect.top + 16}px`;
    this.tip.classList.add('show');
  }

  // --- modals ---------------------------------------------------------------

  private openModal(html: string): void {
    this.modal.innerHTML = html;
    this.modalBack.classList.add('show');
  }
  private closeModal(): void {
    this.modalBack.classList.remove('show');
  }

  private showStartScreen(saved: WorldMeta[]): void {
    this.openModal(`
      <h2>a tiny civilization</h2>
      <p>Worlds already on this machine. They have not moved since you closed the tab.</p>
      <div class="worlds">
        ${saved
          .map(
            (m) => `<div class="world-row" data-id="${m.id}">
              <span>${m.name}</span>
              <span class="meta">yr ${yearOf(m.tick).toLocaleString()} · ${m.pop.toLocaleString()} people · ${m.polities} realms</span>
            </div>`,
          )
          .join('')}
      </div>
      <div class="actions">
        <button class="btn" data-modal="fresh">new world</button>
      </div>`);
    for (const row of Array.from(this.modal.querySelectorAll<HTMLElement>('.world-row'))) {
      row.addEventListener('click', () => void this.open(row.dataset.id!));
    }
    this.modal.querySelector('[data-modal="fresh"]')!.addEventListener('click', () => {
      this.showNewWorld(false);
    });
  }

  private showResumeBanner(): void {
    const w = this.world!;
    this.openModal(`
      <h2>you were away</h2>
      <p>${yearOf(w.tick).toLocaleString()} years passed while you watched. Nothing happened while you were gone.</p>
      <div class="actions">
        <button class="btn primary" data-modal="resume">resume</button>
      </div>`);
    this.modal.querySelector('[data-modal="resume"]')!.addEventListener('click', () => {
      this.closeModal();
      this.clock.resume();
      const btn = this.root.querySelector<HTMLElement>('[data-act="pause"]')!;
      btn.textContent = 'pause';
      btn.classList.add('on');
    });
  }

  /** The one destructive control in the app, so it asks twice. */
  private showNewWorld(confirmFirst: boolean): void {
    if (confirmFirst && this.world) {
      this.openModal(`
        <h2>abandon this world?</h2>
        <p>${this.world.name} has ${yearOf(this.world.tick).toLocaleString()} years of history. Starting a new one leaves it where it is; you can open it again from the start screen.</p>
        <div class="actions">
          <button class="btn" data-modal="cancel">keep watching</button>
          <button class="btn danger" data-modal="go">start a new world</button>
        </div>`);
      this.modal.querySelector('[data-modal="cancel"]')!.addEventListener('click', () => this.closeModal());
      this.modal.querySelector('[data-modal="go"]')!.addEventListener('click', () => this.showNewWorld(false));
      return;
    }

    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.openModal(`
      <h2>a new world</h2>
      <p>Naming it is the only thing you will ever get to decide. After this you can only watch.</p>
      <div class="row">
        <label class="field-label" for="nw-name">name</label>
        <input type="text" id="nw-name" placeholder="name of the world" value="" maxlength="40" />
      </div>
      <div class="row">
        <label class="field-label" for="nw-seed">seed</label>
        <input type="number" id="nw-seed" value="${seed}" />
      </div>
      <div class="actions">
        ${this.world ? '<button class="btn" data-modal="cancel">cancel</button>' : ''}
        <button class="btn primary" data-modal="create">begin</button>
      </div>`);
    const nameEl = this.modal.querySelector<HTMLInputElement>('#nw-name')!;
    const seedEl = this.modal.querySelector<HTMLInputElement>('#nw-seed')!;
    nameEl.focus();
    this.modal.querySelector('[data-modal="cancel"]')?.addEventListener('click', () => this.closeModal());
    const go = () => {
      const s = Number(seedEl.value) >>> 0;
      this.begin(nameEl.value.trim() || 'Unnamed', s || 1);
    };
    this.modal.querySelector('[data-modal="create"]')!.addEventListener('click', go);
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  }
}
