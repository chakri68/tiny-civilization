import type { World } from './../sim/types.ts';
import { NONE, type ResId } from './../sim/types.ts';
import { RESOURCE } from './../sim/biomes.ts';
import { polityResources } from './../sim/factory.ts';
import { ERAS, TECHS, TECH_BY_ID, eraOf, techCost } from './../sim/tech.ts';

type State = 'known' | 'researching' | 'available' | 'blocked' | 'elsewhere' | 'locked';

const COL_W = 178;
const ROW_H = 34;
const NODE_W = 150;
const NODE_H = 24;
const PAD_TOP = 34;
const PAD_X = 10;
const NS = 'http://www.w3.org/2000/svg';

interface Layout {
  pos: Map<string, { x: number; y: number }>;
  edges: { from: string; to: string; sameEra: boolean }[];
  width: number;
  height: number;
  rows: number[]; // per era, how many nodes
}

/**
 * A real dependency graph, not a table: nodes are placed in their era's column
 * and joined to their prerequisites by drawn edges, so you can follow what
 * leads to what by eye.
 *
 * Columns are eras rather than graph depth, because "bronze age" means
 * something to a reader and "layer 6" does not. The cost is that a handful of
 * prerequisites sit inside their own era; those are drawn as short hops down
 * the column's left gutter, and the ordering pass guarantees a prerequisite is
 * always above the thing it unlocks.
 */
function buildLayout(): Layout {
  const byEra: string[][] = ERAS.map(() => []);
  for (const t of TECHS) byEra[t.era].push(t.id);

  const dependents = new Map<string, string[]>();
  for (const t of TECHS) {
    for (const p of t.prereqs) {
      const list = dependents.get(p);
      if (list) list.push(t.id);
      else dependents.set(p, [t.id]);
    }
  }

  const row = new Map<string, number>();
  for (const col of byEra) col.forEach((id, i) => row.set(id, i));

  const meanOf = (ids: string[], fallback: number) => {
    const known = ids.map((i) => row.get(i)).filter((v): v is number => v !== undefined);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : fallback;
  };

  // Sweep down then up a few times, ordering each column by the average row of
  // what it connects to. Standard barycentre heuristic; it will not eliminate
  // crossings but it removes most of them.
  for (let pass = 0; pass < 6; pass++) {
    for (let e = 1; e < byEra.length; e++) {
      const key = new Map<string, number>();
      for (const id of byEra[e]) {
        const prereqs = (TECH_BY_ID.get(id)?.prereqs ?? []).filter((p) => TECH_BY_ID.get(p)!.era < e);
        key.set(id, meanOf(prereqs, row.get(id) ?? 0));
      }
      byEra[e].sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
      byEra[e].forEach((id, i) => row.set(id, i));
    }
    for (let e = byEra.length - 2; e >= 0; e--) {
      const key = new Map<string, number>();
      for (const id of byEra[e]) {
        const kids = (dependents.get(id) ?? []).filter((k) => TECH_BY_ID.get(k)!.era > e);
        key.set(id, meanOf(kids, row.get(id) ?? 0));
      }
      byEra[e].sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
      byEra[e].forEach((id, i) => row.set(id, i));
    }
  }

  // Within a column, a prerequisite must sit above what it unlocks, so the
  // in-column hops all read downward.
  for (let e = 0; e < byEra.length; e++) {
    const col = byEra[e];
    const ordered: string[] = [];
    const placed = new Set<string>();
    const visit = (id: string) => {
      if (placed.has(id)) return;
      placed.add(id);
      for (const p of TECH_BY_ID.get(id)!.prereqs) {
        if (TECH_BY_ID.get(p)!.era === e) visit(p);
      }
      ordered.push(id);
    };
    for (const id of col) visit(id);
    byEra[e] = ordered;
    ordered.forEach((id, i) => row.set(id, i));
  }

  const pos = new Map<string, { x: number; y: number }>();
  byEra.forEach((col, e) => {
    col.forEach((id, i) => pos.set(id, { x: PAD_X + e * COL_W, y: PAD_TOP + i * ROW_H }));
  });

  const edges: Layout['edges'] = [];
  for (const t of TECHS) {
    for (const p of t.prereqs) {
      edges.push({ from: p, to: t.id, sameEra: TECH_BY_ID.get(p)!.era === t.era });
    }
  }

  return {
    pos,
    edges,
    width: PAD_X * 2 + (ERAS.length - 1) * COL_W + NODE_W,
    height: PAD_TOP + Math.max(...byEra.map((c) => c.length)) * ROW_H + 8,
    rows: byEra.map((c) => c.length),
  };
}

export class TechTree {
  private el: HTMLElement;
  private realms: HTMLElement;
  private caption: HTMLElement;
  private where: HTMLElement;
  /** Set by the app so picking a realm here also selects it on the map. */
  onPick: ((polityId: number) => void) | null = null;
  private svg: SVGSVGElement;
  private nodes = new Map<string, SVGGElement>();
  private edgeEls: { el: SVGPathElement; from: string; to: string }[] = [];
  private layout: Layout;
  private signature = '';

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.className = 'techtree-box';
    this.realms = document.createElement('div');
    this.realms.className = 'tech-realms';
    this.caption = document.createElement('div');
    this.caption.className = 'tech-caption';
    this.where = document.createElement('div');
    this.where.className = 'tech-where';

    const scroller = document.createElement('div');
    scroller.className = 'techtree-scroll';
    this.layout = buildLayout();
    this.svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'techtree');
    this.svg.setAttribute('viewBox', `0 0 ${this.layout.width} ${this.layout.height}`);
    this.svg.setAttribute('width', String(this.layout.width));
    this.svg.setAttribute('height', String(this.layout.height));
    scroller.appendChild(this.svg);
    this.el.append(this.realms, this.caption, this.where, scroller, this.buildLegend());

    this.buildSvg();
    this.bindHover();
  }

  /**
   * Each swatch is a real node, rendered by the same CSS rules as the nodes in
   * the graph. Anything else drifts: the first version drew coloured underlines
   * that resembled nothing on screen, and drew them on empty inline elements,
   * so they had no width and never appeared at all.
   */
  private buildLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'tech-legend';
    const states: [State, string][] = [
      ['known', 'known'],
      ['researching', 'researching now'],
      ['available', 'available now'],
      ['blocked', 'no resource for it'],
      ['elsewhere', 'known elsewhere'],
      ['locked', 'not yet reachable'],
    ];
    for (const [state, label] of states) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'techtree legend-swatch');
      svg.setAttribute('width', '26');
      svg.setAttribute('height', '16');
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `tnode ${state}`);
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', '1');
      rect.setAttribute('y', '2');
      rect.setAttribute('width', '24');
      rect.setAttribute('height', '12');
      rect.setAttribute('rx', '4');
      g.appendChild(rect);
      if (state === 'blocked') {
        const flag = document.createElementNS(NS, 'circle');
        flag.setAttribute('class', 'flag');
        flag.setAttribute('cx', '19');
        flag.setAttribute('cy', '8');
        flag.setAttribute('r', '2.5');
        g.appendChild(flag);
      }
      svg.appendChild(g);
      item.append(svg, document.createTextNode(label));
      legend.appendChild(item);
    }
    return legend;
  }

  private buildSvg(): void {
    const { pos, edges } = this.layout;

    // Era headings across the top.
    ERAS.forEach((era, i) => {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'era-label');
      label.setAttribute('x', String(PAD_X + i * COL_W));
      label.setAttribute('y', '12');
      label.textContent = era;
      this.svg.appendChild(label);
      const rule = document.createElementNS(NS, 'line');
      rule.setAttribute('class', 'era-rule');
      rule.setAttribute('x1', String(PAD_X + i * COL_W));
      rule.setAttribute('x2', String(PAD_X + i * COL_W + NODE_W));
      rule.setAttribute('y1', '18');
      rule.setAttribute('y2', '18');
      this.svg.appendChild(rule);
      const count = document.createElementNS(NS, 'text');
      count.setAttribute('class', 'era-count');
      count.setAttribute('x', String(PAD_X + i * COL_W + NODE_W));
      count.setAttribute('y', '12');
      count.setAttribute('text-anchor', 'end');
      count.dataset.era = String(i);
      this.svg.appendChild(count);
    });

    const edgeLayer = document.createElementNS(NS, 'g');
    edgeLayer.setAttribute('class', 'edges');
    this.svg.appendChild(edgeLayer);

    for (const e of edges) {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'edge');
      path.setAttribute('d', edgePath(a, b, e.sameEra));
      edgeLayer.appendChild(path);
      this.edgeEls.push({ el: path, from: e.from, to: e.to });
    }

    for (const t of TECHS) {
      const p = pos.get(t.id)!;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'tnode');
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      g.dataset.tech = t.id;

      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('width', String(NODE_W));
      rect.setAttribute('height', String(NODE_H));
      rect.setAttribute('rx', '5');
      g.appendChild(rect);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', '8');
      text.setAttribute('y', String(NODE_H / 2 + 3.5));
      text.textContent = t.name;
      g.appendChild(text);

      // Marker for "the prerequisites are done but the ground has none of it".
      const flag = document.createElementNS(NS, 'circle');
      flag.setAttribute('class', 'flag');
      flag.setAttribute('cx', String(NODE_W - 8));
      flag.setAttribute('cy', String(NODE_H / 2));
      flag.setAttribute('r', '2.5');
      g.appendChild(flag);

      const title = document.createElementNS(NS, 'title');
      g.appendChild(title);

      this.svg.appendChild(g);
      this.nodes.set(t.id, g);
    }
  }

  render(w: World, focus: number): void {
    const p = w.polities.get(focus);
    if (!p) {
      this.signature = '';
      this.caption.textContent = 'No realm selected.';
      return;
    }
    const known = w.techs.get(p.id) ?? new Set<string>();
    const signature = `${p.id}:${known.size}:${p.researching}:${w.polities.size}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const elsewhere = new Set<string>();
    for (const [pid, set] of w.techs) {
      if (pid === p.id) continue;
      for (const t of set) elsewhere.add(t);
    }
    const reachable = polityResources(w, p);

    const missingAll = new Set<ResId>();
    for (const t of TECHS) {
      const state = stateOf(t.id, known, elsewhere, reachable, p.researching);
      const g = this.nodes.get(t.id)!;
      g.setAttribute('class', `tnode ${state}`);
      if (state === 'blocked') for (const n of t.needs) if (!reachable.has(n)) missingAll.add(n);
      const q = g.querySelector('title');
      if (q) q.textContent = tooltip(t.id, known, reachable);
    }

    ERAS.forEach((_, i) => {
      const inEra = TECHS.filter((t) => t.era === i);
      const got = inEra.filter((t) => known.has(t.id)).length;
      const el = this.svg.querySelector<SVGTextElement>(`.era-count[data-era="${i}"]`);
      if (el) el.textContent = `${got}/${inEra.length}`;
    });

    const blockedNote = missingAll.size
      ? ` · <span class="tech-blocked-note">held up for want of ${Array.from(missingAll)
          .map((r) => RESOURCE[r].label.toLowerCase())
          .join(', ')}</span>`
      : '';
    this.caption.innerHTML =
      `<span class="tech-for" style="color:hsl(${p.hue},70%,64%)">${p.name}</span>` +
      ` — ${known.size} of ${TECHS.length} known · ${ERAS[eraOf(known)]} era` +
      (p.researching
        ? ` · working on <b>${TECH_BY_ID.get(p.researching)?.name ?? p.researching}</b>`
        : '') +
      blockedNote;

    // Name the actual towns. A tech tree belongs to a realm, not a city, and
    // without this there is nothing tying the panel to anything on the map.
    const towns = Array.from(p.settlements)
      .map((id) => w.settlements.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.pop - a.pop);
    const capital = w.settlements.get(p.capital);
    const rest = towns.filter((t) => t.id !== p.capital).slice(0, 7);
    this.where.innerHTML =
      (capital ? `seat at <b>${capital.name}</b>` : 'no seat') +
      (rest.length
        ? ` · also ${rest.map((t) => `<b>${t.name}</b>`).join(', ')}${towns.length - 1 > rest.length ? ` and ${towns.length - 1 - rest.length} more` : ''}`
        : '') +
      ` <span class="tech-hint">— hover a tech to trace what it needs</span>`;

    this.renderRealms(w, p.id);
  }

  /** Every realm on the map, biggest first. Clicking one selects it everywhere. */
  private renderRealms(w: World, current: number): void {
    const list = Array.from(w.polities.values())
      .map((p) => {
        let pop = 0;
        for (const id of p.settlements) pop += w.settlements.get(id)?.pop ?? 0;
        return { p, pop, techs: (w.techs.get(p.id) ?? new Set()).size };
      })
      .sort((a, b) => b.pop - a.pop || a.p.id - b.p.id);

    this.realms.replaceChildren(
      ...list.map(({ p, techs }) => {
        const b = document.createElement('button');
        b.className = `realm-chip${p.id === current ? ' on' : ''}`;
        b.innerHTML =
          `<span class="swatch" style="background:hsl(${p.hue},70%,60%)"></span>` +
          `${p.name} <span style="opacity:.7">${techs}</span>`;
        b.addEventListener('click', () => this.onPick?.(p.id));
        return b;
      }),
    );
  }

  /** Hovering a node lights its whole prerequisite chain, edges included. */
  private bindHover(): void {
    this.svg.addEventListener('mouseover', (e) => {
      const g = (e.target as Element).closest<SVGGElement>('.tnode');
      if (!g) return;
      const id = g.dataset.tech!;
      const chain = new Set<string>([id]);
      const walk = (t: string) => {
        for (const r of TECH_BY_ID.get(t)?.prereqs ?? []) {
          if (chain.has(r)) continue;
          chain.add(r);
          walk(r);
        }
      };
      walk(id);
      const unlocks = new Set(TECHS.filter((t) => t.prereqs.includes(id)).map((t) => t.id));

      this.svg.classList.add('focusing');
      for (const [tid, node] of this.nodes) {
        node.classList.toggle('is-focus', tid === id);
        node.classList.toggle('is-chain', chain.has(tid) && tid !== id);
        node.classList.toggle('is-unlock', unlocks.has(tid));
      }
      for (const edge of this.edgeEls) {
        const lit = (chain.has(edge.from) && chain.has(edge.to)) || edge.from === id;
        edge.el.classList.toggle('is-lit', lit);
      }
    });
    this.svg.addEventListener('mouseleave', () => {
      this.svg.classList.remove('focusing');
      for (const node of this.nodes.values()) {
        node.classList.remove('is-focus', 'is-chain', 'is-unlock');
      }
      for (const edge of this.edgeEls) edge.el.classList.remove('is-lit');
    });
  }
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, sameEra: boolean): string {
  if (sameEra) {
    // A hop down the left gutter of the column.
    const x = a.x - 6;
    const y1 = a.y + NODE_H;
    const y2 = b.y + NODE_H / 2;
    return `M ${a.x + 10} ${y1} C ${x - 6} ${y1 + 6}, ${x - 6} ${y2 - 6}, ${b.x} ${y2}`;
  }
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const dx = Math.max(24, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function stateOf(
  id: string,
  known: Set<string>,
  elsewhere: Set<string>,
  reachable: Set<ResId>,
  researching: string,
): State {
  if (known.has(id)) return 'known';
  if (id === researching) return 'researching';
  const def = TECH_BY_ID.get(id)!;
  if (def.prereqs.every((r) => known.has(r))) {
    return def.needs.every((n) => reachable.has(n)) ? 'available' : 'blocked';
  }
  return elsewhere.has(id) ? 'elsewhere' : 'locked';
}

function tooltip(id: string, known: Set<string>, reachable: Set<ResId>): string {
  const def = TECH_BY_ID.get(id)!;
  const effects = Object.entries(def.effects)
    .map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${Math.round((v as number) * 100)}% ${k}`)
    .join(', ');
  const missingRes = def.needs.filter((n) => !reachable.has(n));
  const missingPre = def.prereqs.filter((r) => !known.has(r));
  return [
    def.name,
    effects || 'no direct effect',
    def.needs.length ? `needs ${def.needs.join(', ')}` : '',
    missingRes.length ? `NO ${missingRes.join(', ').toUpperCase()} IN REACH` : '',
    missingPre.length ? `after ${missingPre.map((r) => TECH_BY_ID.get(r)?.name ?? r).join(', ')}` : '',
    `${Math.round(techCost(def.era))} research`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The realm the tech panel should describe: whatever is selected, else the biggest. */
export function focusPolity(w: World, selKind: string | null, selId: number): number {
  if (selKind === 'polity' && w.polities.has(selId)) return selId;
  if (selKind === 'settlement') {
    const s = w.settlements.get(selId);
    if (s && w.polities.has(s.polity)) return s.polity;
  }
  if (selKind === 'notable') {
    const n = w.notables.get(selId);
    if (n && w.polities.has(n.polity)) return n.polity;
  }
  let best = NONE;
  let bestPop = -1;
  for (const p of w.polities.values()) {
    let pop = 0;
    for (const id of p.settlements) pop += w.settlements.get(id)?.pop ?? 0;
    if (pop > bestPop) {
      bestPop = pop;
      best = p.id;
    }
  }
  return best;
}
