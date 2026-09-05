// Odd-r offset hex grid: row-major storage, pointy-top rendering.
// Odd rows are shifted half a hex to the right, so neighbour deltas are parity-dependent.

const NEIGHBOR_EVEN: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const NEIGHBOR_ODD: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

export function idx(w: number, x: number, y: number): number {
  return y * w + x;
}
export function xOf(w: number, i: number): number {
  return i % w;
}
export function yOf(w: number, i: number): number {
  return (i / w) | 0;
}

/** Fills `out` with in-bounds neighbour indices, returns how many. */
export function neighbors(w: number, h: number, i: number, out: number[]): number {
  const x = i % w;
  const y = (i / w) | 0;
  const deltas = (y & 1) === 0 ? NEIGHBOR_EVEN : NEIGHBOR_ODD;
  let n = 0;
  for (let k = 0; k < 6; k++) {
    const nx = x + deltas[k][0];
    const ny = y + deltas[k][1];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    out[n++] = ny * w + nx;
  }
  return n;
}

/** Convenience wrapper. Allocates; do not call in hot loops. */
export function neighborList(w: number, h: number, i: number): number[] {
  const out: number[] = [];
  const n = neighbors(w, h, i, out);
  out.length = n;
  return out;
}

function cubeQ(w: number, i: number): number {
  const y = (i / w) | 0;
  const x = i % w;
  return x - ((y - (y & 1)) >> 1);
}

export function hexDistance(w: number, a: number, b: number): number {
  const aq = cubeQ(w, a);
  const ar = (a / w) | 0;
  const bq = cubeQ(w, b);
  const br = (b / w) | 0;
  const dq = aq - bq;
  const dr = ar - br;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** All in-bounds tiles within `radius`, ordered by index (deterministic). */
export function tilesWithin(w: number, h: number, center: number, radius: number): number[] {
  const cx = center % w;
  const cy = (center / w) | 0;
  const out: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius - 1); x <= Math.min(w - 1, cx + radius + 1); x++) {
      const i = y * w + x;
      if (hexDistance(w, center, i) <= radius) out.push(i);
    }
  }
  return out;
}

/** Pointy-top pixel centre of a tile, in units of hex size (circumradius). */
export function hexCenter(w: number, i: number, size: number): { px: number; py: number } {
  const y = (i / w) | 0;
  const x = i % w;
  const SQRT3 = 1.7320508075688772;
  const px = size * SQRT3 * (x + ((y & 1) === 1 ? 0.5 : 0));
  const py = size * 1.5 * y;
  return { px, py };
}

/** Inverse of hexCenter, with a cube-round to land on a real tile. Returns -1 if outside. */
export function tileAtPixel(w: number, h: number, px: number, py: number, size: number): number {
  const SQRT3 = 1.7320508075688772;
  const r = py / (size * 1.5);
  const ry = Math.round(r);
  const rowOffset = (ry & 1) === 1 ? 0.5 : 0;
  const q = px / (size * SQRT3) - rowOffset;
  const rx = Math.round(q);
  // Refine: check the rounded candidate and its neighbours for the true nearest centre.
  let best = -1;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = rx + dx;
      const y = ry + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      const c = hexCenter(w, i, size);
      const d = (c.px - px) * (c.px - px) + (c.py - py) * (c.py - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

export function edgeKey(a: number, b: number): number {
  // Symmetric, packs two tile indices (< 2^16) into one number.
  return a < b ? a * 65536 + b : b * 65536 + a;
}
export function edgeA(key: number): number {
  return (key / 65536) | 0;
}
export function edgeB(key: number): number {
  return key % 65536;
}
