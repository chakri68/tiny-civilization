import type { Settlement, Tile, World } from './../sim/types.ts';
import { NONE } from './../sim/types.ts';
import { tileShade } from './../sim/biomes.ts';
import { edgeA, edgeB, hexCenter, neighbors, tileAtPixel } from './../sim/hex.ts';

const BASE_HEX = 9; // circumradius in px at zoom 1
/**
 * Zoom at which the cached world layer stops being good enough and live
 * drawing takes over. The cache is rendered at this scale, so blitting it
 * anywhere at or below this zoom is at worst 1:1, never upscaled.
 */
const CACHE_SCALE = 2;
const SQRT3 = 1.7320508075688772;

interface Range {
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

export interface Selection {
  kind: 'settlement' | 'polity' | 'tile' | 'notable' | 'religion' | null;
  id: number;
}

/**
 * Terrain is drawn once into an offscreen canvas and never again — it does not
 * change. Everything that does change (borders, roads, towns) goes on a second
 * offscreen layer rebuilt at most a few times a second. The visible frame is
 * then two blits and a highlight, which is what keeps a background tab cheap.
 */
export class MapView {
  private ctx: CanvasRenderingContext2D;
  private world: World | null = null;
  private frameQueued = false;
  private worldPx = { w: 1, h: 1 };
  private cache: HTMLCanvasElement;
  private cacheDirty = true;
  private lastCacheMs = -1e9;
  lastDrawMs = 0;

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private dragging = false;
  private dragMoved = 0;
  private lastPointer = { x: 0, y: 0 };

  selection: Selection = { kind: null, id: NONE };
  hoverTile = NONE;
  showTrade = false;

  onSelect: ((sel: Selection) => void) | null = null;
  onHover: ((tile: number, clientX: number, clientY: number) => void) | null = null;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.cache = document.createElement('canvas');
    this.bindEvents();
  }

  setWorld(w: World): void {
    this.world = w;
    this.worldPx = {
      w: Math.ceil(BASE_HEX * SQRT3 * (w.w + 1)),
      h: Math.ceil(BASE_HEX * 1.5 * w.h + BASE_HEX),
    };
    this.cache.width = this.worldPx.w * CACHE_SCALE;
    this.cache.height = this.worldPx.h * CACHE_SCALE;
    this.cacheDirty = true;
    this.lastCacheMs = -1e9;
    this.fit();
  }

  invalidate(): void {
    this.cacheDirty = true;
    this.requestFrame();
  }

  fit(): void {
    if (!this.world) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / this.worldPx.w;
    const sy = rect.height / this.worldPx.h;
    this.zoom = Math.min(sx, sy) * 0.98;
    this.panX = (rect.width - this.worldPx.w * this.zoom) / 2;
    this.panY = (rect.height - this.worldPx.h * this.zoom) / 2;
    this.requestFrame();
  }

  centerOn(tile: number): void {
    if (!this.world || tile === NONE) return;
    const rect = this.canvas.getBoundingClientRect();
    const { px, py } = hexCenter(this.world.w, tile, BASE_HEX);
    this.zoom = Math.max(this.zoom, 1.6);
    this.panX = rect.width / 2 - px * this.zoom;
    this.panY = rect.height / 2 - py * this.zoom;
    this.requestFrame();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.draw();
    });
  }

  // --- painting -------------------------------------------------------------

  private hexPath(ctx: CanvasRenderingContext2D, px: number, py: number, r: number): void {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (-90 + 60 * k) * (Math.PI / 180);
      const x = px + r * Math.cos(a);
      const y = py + r * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** Terrain reads as phosphor brightness. Hue is reserved for who owns what. */
  private terrainColor(t: Tile): string {
    const c = tileShade(t.biome, t.river, t.elev);
    return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
  }

  /** Tile index bounds covering the visible rect, with a one-hex margin. */
  private visibleRange(): Range {
    const w = this.world!;
    const rect = this.canvas.getBoundingClientRect();
    const off = BASE_HEX;
    const x0 = -this.panX / this.zoom;
    const y0 = -this.panY / this.zoom;
    const x1 = x0 + rect.width / this.zoom;
    const y1 = y0 + rect.height / this.zoom;
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    return {
      colMin: clamp(Math.floor((x0 - off) / (SQRT3 * BASE_HEX)) - 1, 0, w.w - 1),
      colMax: clamp(Math.ceil((x1 - off) / (SQRT3 * BASE_HEX)) + 1, 0, w.w - 1),
      rowMin: clamp(Math.floor((y0 - off - BASE_HEX) / (1.5 * BASE_HEX)), 0, w.h - 1),
      rowMax: clamp(Math.ceil((y1 - off + BASE_HEX) / (1.5 * BASE_HEX)), 0, w.h - 1),
    };
  }

  /**
   * Everything is drawn straight to the visible canvas each frame, culled to
   * the viewport. The previous version blitted two pre-rendered world-sized
   * layers, which was cheaper but resolved to a fixed hex size — so zooming in
   * upscaled a bitmap and went to mush. Drawing live keeps it sharp at any
   * zoom, and the cull means close-up frames touch far fewer tiles than
   * whole-world ones.
   */
  private paintWorld(ctx: CanvasRenderingContext2D, range: Range, scale: number): void {
    const w = this.world!;
    const off = BASE_HEX;
    const { colMin, colMax, rowMin, rowMax } = range;
    // Constant sub-pixel overlap in device space, so hexes never show seams
    // and never visibly overlap when zoomed right in.
    const r = BASE_HEX + 0.35 / scale;

    const hues = new Map<number, number>();
    for (const p of w.polities.values()) hues.set(p.id, p.hue);

    // Pass 1: terrain, and the owner's wash over it.
    for (let y = rowMin; y <= rowMax; y++) {
      for (let x = colMin; x <= colMax; x++) {
        const i = y * w.w + x;
        const t = w.tiles[i];
        const c = hexCenter(w.w, i, BASE_HEX);
        this.hexPath(ctx, c.px + off, c.py + off, r);
        ctx.fillStyle = this.terrainColor(t);
        ctx.fill();
        if (t.owner !== NONE) {
          const hue = hues.get(t.owner);
          if (hue !== undefined) {
            ctx.fillStyle = `hsla(${hue}, 70%, 58%, 0.13)`;
            ctx.fill();
          }
        }
      }
    }

    // Pass 2: borders. The shared edge of two hexes is the perpendicular
    // bisector of their centres, one side-length long, so this is exact.
    const buf: number[] = [];
    ctx.lineWidth = Math.max(0.6, 1.6 / Math.max(1, scale * 0.55));
    ctx.lineCap = 'round';
    for (let y = rowMin; y <= rowMax; y++) {
      for (let x = colMin; x <= colMax; x++) {
        const i = y * w.w + x;
        const owner = w.tiles[i].owner;
        if (owner === NONE) continue;
        const hue = hues.get(owner);
        if (hue === undefined) continue;
        const a = hexCenter(w.w, i, BASE_HEX);
        const n = neighbors(w.w, w.h, i, buf);
        ctx.strokeStyle = `hsla(${hue}, 80%, 66%, 0.95)`;
        for (let k = 0; k < n; k++) {
          if (w.tiles[buf[k]].owner === owner) continue;
          const b = hexCenter(w.w, buf[k], BASE_HEX);
          const dx = b.px - a.px;
          const dy = b.py - a.py;
          const len = Math.hypot(dx, dy) || 1;
          const mx = a.px + dx / 2 + off;
          const my = a.py + dy / 2 + off;
          const ex = (-dy / len) * (BASE_HEX / 2);
          const ey = (dx / len) * (BASE_HEX / 2);
          ctx.beginPath();
          ctx.moveTo(mx - ex, my - ey);
          ctx.lineTo(mx + ex, my + ey);
          ctx.stroke();
        }
      }
    }

    const inView = (tile: number) => {
      const ty = (tile / w.w) | 0;
      const tx = tile % w.w;
      return tx >= colMin - 2 && tx <= colMax + 2 && ty >= rowMin - 2 && ty <= rowMax + 2;
    };

    // Roads.
    ctx.strokeStyle = 'rgba(255, 200, 130, 0.42)';
    ctx.lineWidth = Math.max(0.5, 1.1 / Math.max(1, scale * 0.6));
    ctx.beginPath();
    for (const key of w.roads) {
      const ea = edgeA(key);
      const eb = edgeB(key);
      if (!inView(ea) && !inView(eb)) continue;
      const a = hexCenter(w.w, ea, BASE_HEX);
      const b = hexCenter(w.w, eb, BASE_HEX);
      ctx.moveTo(a.px + off, a.py + off);
      ctx.lineTo(b.px + off, b.py + off);
    }
    ctx.stroke();

    // Trade, optional: a faint thread between partners.
    if (this.showTrade) {
      ctx.strokeStyle = 'rgba(236, 231, 218, 0.12)';
      ctx.lineWidth = 0.7 / Math.max(1, scale * 0.6);
      ctx.beginPath();
      for (const s of w.settlements.values()) {
        const a = hexCenter(w.w, s.tile, BASE_HEX);
        for (const pid of s.partners) {
          if (pid <= s.id) continue;
          const o = w.settlements.get(pid);
          if (!o) continue;
          if (!inView(s.tile) && !inView(o.tile)) continue;
          const b = hexCenter(w.w, o.tile, BASE_HEX);
          ctx.moveTo(a.px + off, a.py + off);
          ctx.lineTo(b.px + off, b.py + off);
        }
      }
      ctx.stroke();
    }

    // Settlements, sized by tier. Their on-screen size is held roughly steady
    // so a city stays legible zoomed out and does not become a blot zoomed in.
    const dotScale = Math.min(1.6, Math.max(0.5, 1 / Math.sqrt(Math.max(0.35, scale))));
    for (const s of w.settlements.values()) {
      if (!inView(s.tile)) continue;
      const c = hexCenter(w.w, s.tile, BASE_HEX);
      const base = s.tier === 'city' ? 4.4 : s.tier === 'town' ? 3.2 : s.tier === 'village' ? 2.3 : 1.6;
      const rad = base * dotScale;
      if (s.tier === 'city') {
        ctx.fillStyle = 'rgba(255, 176, 0, 0.18)';
        ctx.beginPath();
        ctx.arc(c.px + off, c.py + off, rad * 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(c.px + off, c.py + off, rad + 0.9 * dotScale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fill();
      ctx.fillStyle = s.plague > 0 ? '#ff6a2b' : '#ffcf5a';
      ctx.beginPath();
      ctx.arc(c.px + off, c.py + off, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Rebuilds the world layer, throttled — it only changes when the world does. */
  private ensureCache(): void {
    const w = this.world;
    if (!w || !this.cacheDirty) return;
    const now = performance.now();
    if (now - this.lastCacheMs < 200) return;
    const ctx = this.cache.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cache.width, this.cache.height);
    ctx.scale(CACHE_SCALE, CACHE_SCALE);
    this.paintWorld(ctx, { colMin: 0, colMax: w.w - 1, rowMin: 0, rowMax: w.h - 1 }, CACHE_SCALE);
    this.cacheDirty = false;
    this.lastCacheMs = now;
  }

  private draw(): void {
    const w = this.world;
    const ctx = this.ctx;
    const t0 = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!w) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    if (this.zoom <= CACHE_SCALE) {
      // Zoomed out the whole world is on screen, and drawing six thousand
      // hexes live costs ~20 ms a frame — fine for a redraw, ruinous for a
      // pan. Blit a pre-rendered layer instead; at this zoom it is never
      // upscaled, so nothing is lost.
      this.ensureCache();
      ctx.drawImage(this.cache, 0, 0, this.worldPx.w, this.worldPx.h);
    } else {
      this.paintWorld(ctx, this.visibleRange(), this.zoom);
    }

    const off = BASE_HEX;
    if (this.hoverTile !== NONE) {
      const { px, py } = hexCenter(w.w, this.hoverTile, BASE_HEX);
      ctx.strokeStyle = 'rgba(236, 231, 218, 0.5)';
      ctx.lineWidth = 1.2 / this.zoom;
      this.hexPath(ctx, px + off, py + off, BASE_HEX);
      ctx.stroke();
    }

    const selTile = this.selectionTile();
    if (selTile !== NONE) {
      const { px, py } = hexCenter(w.w, selTile, BASE_HEX);
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 2 / this.zoom;
      this.hexPath(ctx, px + off, py + off, BASE_HEX + 1.5 / this.zoom);
      ctx.stroke();
    }
    this.lastDrawMs = performance.now() - t0;
  }

  private selectionTile(): number {
    const w = this.world;
    if (!w || this.selection.kind === null) return NONE;
    if (this.selection.kind === 'tile') return this.selection.id;
    if (this.selection.kind === 'settlement') {
      return w.settlements.get(this.selection.id)?.tile ?? NONE;
    }
    const p = w.polities.get(this.selection.id);
    return p ? (w.settlements.get(p.capital)?.tile ?? NONE) : NONE;
  }

  // --- input ----------------------------------------------------------------

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom - BASE_HEX,
      y: (clientY - rect.top - this.panY) / this.zoom - BASE_HEX,
    };
  }

  private tileAt(clientX: number, clientY: number): number {
    if (!this.world) return NONE;
    const p = this.toWorld(clientX, clientY);
    return tileAtPixel(this.world.w, this.world.h, p.x, p.y, BASE_HEX);
  }

  private bindEvents(): void {
    const c = this.canvas;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const next = Math.max(0.25, Math.min(9, this.zoom * factor));
      // Keep the point under the cursor fixed.
      this.panX = mx - ((mx - this.panX) / this.zoom) * next;
      this.panY = my - ((my - this.panY) / this.zoom) * next;
      this.zoom = next;
      this.requestFrame();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragMoved = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);
        this.panX += dx;
        this.panY += dy;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.requestFrame();
        return;
      }
      const tile = this.tileAt(e.clientX, e.clientY);
      if (tile !== this.hoverTile) {
        this.hoverTile = tile;
        this.requestFrame();
      }
      this.onHover?.(tile, e.clientX, e.clientY);
    });

    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      c.releasePointerCapture?.(e.pointerId);
      if (this.dragMoved < 4) this.click(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      this.hoverTile = NONE;
      this.onHover?.(NONE, 0, 0);
      this.requestFrame();
    });
  }

  private click(clientX: number, clientY: number): void {
    const w = this.world;
    if (!w) return;
    const tile = this.tileAt(clientX, clientY);
    if (tile === NONE) return;
    const t = w.tiles[tile];
    if (t.settlement !== NONE) this.select({ kind: 'settlement', id: t.settlement });
    else if (t.owner !== NONE) this.select({ kind: 'polity', id: t.owner });
    else this.select({ kind: 'tile', id: tile });
  }

  select(sel: Selection): void {
    this.selection = sel;
    this.onSelect?.(sel);
    this.requestFrame();
  }

  settlementAtTile(tile: number): Settlement | undefined {
    return this.world?.settlements.get(this.world.tiles[tile]?.settlement ?? NONE);
  }
}
