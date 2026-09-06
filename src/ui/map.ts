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

interface Toast {
  text: string;
  tile: number;
  born: number;
  severity: number;
  /** Wrapped once on first draw — the text and the font never change after that. */
  lines?: string[];
}

const CLASH_LIFE = 14000;
const MAX_CLASHES = 8;
const TOAST_LIFE = 7000;
const TOAST_FADE = 1600;
const MAX_TOASTS = 4;
/** Text wraps at this width, so a long chronicle line reads as a block, not a ribbon. */
const TOAST_MAX_W = 240;
const TOAST_PAD_X = 9;
const TOAST_PAD_Y = 7;
const TOAST_LINE = 15;

interface Range {
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

function rankOf(tier: string): number {
  return tier === 'city' ? 3 : tier === 'town' ? 2 : tier === 'village' ? 1 : 0;
}

/** Greedy word wrap in the ctx's current font. A word wider than the box overflows it. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  showNames = false;
  showAlerts = false;
  private toasts: Toast[] = [];
  private clashes: { tile: number; born: number }[] = [];

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
    // Frontiers where a war is actually being fought get their own colour, so
    // you can see where the trouble is without reading a word.
    const atWar = new Set<number>();
    for (const war of w.wars.values()) {
      atWar.add(war.a < war.b ? war.a * 1048576 + war.b : war.b * 1048576 + war.a);
    }

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
        const peaceful = `hsla(${hue}, 80%, 66%, 0.95)`;
        for (let k = 0; k < n; k++) {
          const other = w.tiles[buf[k]].owner;
          if (other === owner) continue;
          const contested =
            other !== NONE &&
            atWar.has(owner < other ? owner * 1048576 + other : other * 1048576 + owner);
          ctx.strokeStyle = contested ? 'rgba(255, 106, 43, 0.95)' : peaceful;
          ctx.lineWidth = contested
            ? Math.max(1, 2.6 / Math.max(1, scale * 0.55))
            : Math.max(0.6, 1.6 / Math.max(1, scale * 0.55));
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
    if (this.showNames) this.drawLabels(ctx, dpr);
    this.drawClashes(ctx, dpr);
    this.drawToasts(ctx, dpr);
    this.lastDrawMs = performance.now() - t0;
  }

  /**
   * Settlement names, in screen space, culled by collision rather than by tier.
   *
   * The previous version hid anything below a tier threshold that scaled with
   * zoom, which meant that on a young map — where every settlement is still a
   * camp — turning labels on did nothing at all. Now the biggest places get
   * first refusal on the space and everything that still fits is drawn, so the
   * toggle always does something and never turns into a wall of text.
   */
  private drawLabels(ctx: CanvasRenderingContext2D, dpr: number): void {
    const w = this.world!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    const size = 11;
    ctx.font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;

    // Biggest first, so when space is tight the important places keep their name.
    const candidates = Array.from(w.settlements.values())
      .sort((a, b) => rankOf(b.tier) - rankOf(a.tier) || b.pop - a.pop || a.id - b.id);

    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const s of candidates) {
      const c = hexCenter(w.w, s.tile, BASE_HEX);
      const x = this.panX + (c.px + BASE_HEX) * this.zoom;
      const y = this.panY + (c.py + BASE_HEX) * this.zoom + BASE_HEX * 0.55 * this.zoom + 2;
      if (x < -80 || y < -20 || x > rect.width + 80 || y > rect.height + 20) continue;

      const half = ctx.measureText(s.name).width / 2 + 3;
      const box = { x0: x - half, y0: y - 2, x1: x + half, y1: y + size + 2 };
      let clash = false;
      for (const t of taken) {
        if (box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      taken.push(box);

      // A dark stroke under the glyphs, so names stay legible over any terrain.
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(s.name, x, y);
      ctx.fillStyle = s.tier === 'city' ? '#ffcf5a' : s.tier === 'town' ? '#ece7da' : '#c9c2b2';
      ctx.fillText(s.name, x, y);
    }
  }

  /** Something happened over there. Announced on the map, then forgotten. */
  pushToast(text: string, tile: number, severity: number): void {
    if (!this.showAlerts || tile === NONE) return;
    this.toasts.push({ text, tile, born: performance.now(), severity });
    while (this.toasts.length > MAX_TOASTS) this.toasts.shift();
    this.requestFrame();
  }

  clearToasts(): void {
    this.toasts.length = 0;
    this.clashes.length = 0;
  }

  /** A battle happened here. Marked on the map for a while, then it heals over. */
  pushClash(tile: number): void {
    if (!this.showAlerts || tile === NONE) return;
    this.clashes.push({ tile, born: performance.now() });
    while (this.clashes.length > MAX_CLASHES) this.clashes.shift();
    this.requestFrame();
  }

  /** Crossed blades where the fighting is, pulsing so they read as live. */
  private drawClashes(ctx: CanvasRenderingContext2D, dpr: number): void {
    const w = this.world;
    if (!w || this.clashes.length === 0) return;
    const now = performance.now();
    this.clashes = this.clashes.filter((c) => now - c.born < CLASH_LIFE);
    if (this.clashes.length === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of this.clashes) {
      const age = now - c.born;
      const fade = age > CLASH_LIFE - 3000 ? (CLASH_LIFE - age) / 3000 : 1;
      const pulse = 0.62 + 0.38 * Math.sin(age / 320);
      const p = hexCenter(w.w, c.tile, BASE_HEX);
      const x = this.panX + (p.px + BASE_HEX) * this.zoom;
      const y = this.panY + (p.py + BASE_HEX) * this.zoom;

      // Sits above the settlement dot rather than on top of it, so you can
      // still see which town is being fought over.
      const cy = y - 15;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(x, cy, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,106,43,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Outward pulse, so it reads as happening rather than having happened.
      ctx.globalAlpha = fade * (1 - (pulse - 0.62) / 0.38) * 0.5;
      ctx.beginPath();
      ctx.arc(x, cy, 10 + 8 * ((pulse - 0.62) / 0.38), 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = fade * pulse;
      ctx.strokeStyle = '#ff6a2b';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 5, cy - 5);
      ctx.lineTo(x + 5, cy + 5);
      ctx.moveTo(x + 5, cy - 5);
      ctx.lineTo(x - 5, cy + 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.requestFrame();
  }

  private drawToasts(ctx: CanvasRenderingContext2D, dpr: number): void {
    const w = this.world;
    if (!w || this.toasts.length === 0) return;
    const now = performance.now();
    this.toasts = this.toasts.filter((t) => now - t.born < TOAST_LIFE);
    if (this.toasts.length === 0) return;

    // Screen space, so the boxes are a fixed size no matter the zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '400 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const rect = this.canvas.getBoundingClientRect();
    // Never wider than the viewport can hold, however narrow the panel gets.
    const wrapAt = Math.max(80, Math.min(TOAST_MAX_W, rect.width - 40));
    const placed: { bx: number; by: number; bw: number; bh: number; lines: string[]; t: Toast }[] =
      [];
    for (const t of this.toasts) {
      const lines = t.lines ?? (t.lines = wrapText(ctx, t.text, wrapAt));
      let widest = 0;
      for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
      const bw = Math.ceil(widest) + TOAST_PAD_X * 2;
      const bh = lines.length * TOAST_LINE + TOAST_PAD_Y * 2;
      const c = hexCenter(w.w, t.tile, BASE_HEX);
      const x = this.panX + (c.px + BASE_HEX) * this.zoom;
      const y = this.panY + (c.py + BASE_HEX) * this.zoom;
      placed.push({
        // Anchored beside its tile and centred on it, then kept inside the canvas.
        bx: Math.max(6, Math.min(x + 10, rect.width - bw - 6)),
        by: Math.max(6, Math.min(y - bh / 2, rect.height - bh - 6)),
        bw,
        bh,
        lines,
        t,
      });
    }
    // Nudge apart anything that would overlap, oldest keeps its spot.
    placed.sort((a, b) => a.by - b.by);
    for (let i = 1; i < placed.length; i++) {
      const floor = placed[i - 1].by + placed[i - 1].bh + 5;
      if (placed[i].by < floor) placed[i].by = floor;
    }
    // Boxes are tall enough now that a stack can push itself off the bottom.
    const last = placed[placed.length - 1];
    const overflow = last.by + last.bh + 6 - rect.height;
    if (overflow > 0) for (const p of placed) p.by = Math.max(6, p.by - overflow);

    for (const { bx, by, bw, bh, lines, t } of placed) {
      const age = now - t.born;
      const alpha = age > TOAST_LIFE - TOAST_FADE ? (TOAST_LIFE - age) / TOAST_FADE : 1;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(2,2,2,0.9)';
      roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      ctx.strokeStyle = t.severity >= 3 ? 'rgba(255,176,0,0.85)' : 'rgba(139,133,116,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = t.severity >= 3 ? '#ffcf5a' : '#ece7da';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], bx + TOAST_PAD_X, by + TOAST_PAD_Y + TOAST_LINE / 2 + i * TOAST_LINE);
      }
      ctx.globalAlpha = 1;
    }
    // Keep animating while any are still on screen.
    this.requestFrame();
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
