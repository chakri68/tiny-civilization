import type { World } from './../sim/types.ts';
import { CULTURE_AXES, NONE, RESOURCES } from './../sim/types.ts';
import type { Selection } from './map.ts';
import { BIOME, RESOURCE } from './../sim/biomes.ts';
import { yearOf } from './../sim/chronicle.ts';
import { describeCulture } from './../sim/culture.ts';
import { effectsOf, polityPop, religiousUnity } from './../sim/query.ts';
import { eraOf, ERAS, TECH_BY_ID } from './../sim/tech.ts';

const num = (n: number) => Math.round(n).toLocaleString();

/** Whatever is selected, in as much detail as the sim actually tracks. */
export class Inspector {
  private el: HTMLElement;
  onSelect: ((sel: Selection) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    // add, not assign: this element is the panel body, and overwriting
    // className drops its padding, scrolling and scrollbar gutter with it.
    this.el.classList.add('insp');
  }

  render(w: World | null, sel: Selection): void {
    if (!w || sel.kind === null) {
      this.el.innerHTML = `<div class="empty">Click a settlement, a border, or a line in the chronicle.</div>`;
      return;
    }
    switch (sel.kind) {
      case 'settlement':
        this.settlement(w, sel.id);
        break;
      case 'polity':
        this.polity(w, sel.id);
        break;
      case 'notable':
        this.notable(w, sel.id);
        break;
      case 'religion':
        this.religion(w, sel.id);
        break;
      default:
        this.tile(w, sel.id);
    }
    this.wireLinks();
  }

  private wireLinks(): void {
    for (const a of Array.from(this.el.querySelectorAll<HTMLElement>('.link[data-kind]'))) {
      a.addEventListener('click', () => {
        this.onSelect?.({ kind: a.dataset.kind as Selection['kind'], id: Number(a.dataset.id) });
      });
    }
  }

  private cultureBars(culture: number[]): string {
    return `<div class="bars">${CULTURE_AXES.map(
      (axis, i) =>
        `<div class="bar"><span>${axis}</span><span class="track"><span class="fill" style="width:${(
          culture[i] * 100
        ).toFixed(0)}%"></span></span></div>`,
    ).join('')}</div>`;
  }

  private settlement(w: World, id: number): void {
    const s = w.settlements.get(id);
    if (!s) {
      this.el.innerHTML = `<div class="empty">That place is gone. It happens.</div>`;
      return;
    }
    const t = w.tiles[s.tile];
    const p = w.polities.get(s.polity);
    const faith = w.religions.get(s.religion);
    const stock = RESOURCES.filter((r) => s.stock[r] > 1);
    const troubles: string[] = [];
    if (s.plague > 0) troubles.push('plague');
    if (s.famine > 0) troubles.push('hunger');
    if (s.blight > 0) troubles.push('drought');
    if (s.unrest > 0.3) troubles.push('unrest');

    this.el.innerHTML = `
      <h2>${s.name}</h2>
      <div class="kv">
        <span>people</span><span>${num(s.pop)}</span>
        <span>rank</span><span>${s.tier}</span>
        <span>founded</span><span>year ${yearOf(s.founded)}</span>
        <span>realm</span><span>${
          p ? `<span class="link" data-kind="polity" data-id="${p.id}">${p.name}</span>` : '—'
        }</span>
        <span>faith</span><span>${
          faith
            ? `<span class="link" data-kind="religion" data-id="${faith.id}">${faith.name}</span>`
            : 'none'
        }</span>
        <span>land</span><span>${BIOME[t.biome].label}${t.river ? ', river' : ''}${
          t.coastal ? ', coast' : ''
        }</span>
        <span>granary</span><span>${(s.food / Math.max(1, s.pop * 0.085)).toFixed(1)} months</span>
        <span>unrest</span><span>${(s.unrest * 100).toFixed(0)}%</span>
        <span>wealth</span><span>${num(s.wealth)}</span>
      </div>
      ${troubles.length ? `<div class="notice">${troubles.join(' · ')}</div>` : ''}
      <div class="sub">culture</div>
      ${this.cultureBars(s.culture)}
      <div class="sub">on the ground</div>
      <div class="tags">${
        t.resources.length
          ? t.resources.map((r) => `<span class="tag">${RESOURCE[r].label}</span>`).join('')
          : '<span class="tag">nothing worth digging</span>'
      }</div>
      ${
        stock.length
          ? `<div class="sub">in store</div><div class="tags">${stock
              .map((r) => `<span class="tag">${RESOURCE[r].label} ${num(s.stock[r])}</span>`)
              .join('')}</div>`
          : ''
      }
      <div class="sub">trades with</div>
      <div class="tags">${
        s.partners.length
          ? s.partners
              .map((pid) => {
                const o = w.settlements.get(pid);
                return o
                  ? `<span class="tag link" data-kind="settlement" data-id="${o.id}">${o.name}</span>`
                  : '';
              })
              .join('')
          : '<span class="tag">nobody</span>'
      }</div>`;
  }

  private polity(w: World, id: number): void {
    const p = w.polities.get(id);
    if (!p) {
      this.el.innerHTML = `<div class="empty">That realm is over.</div>`;
      return;
    }
    const known = w.techs.get(p.id) ?? new Set<string>();
    const era = eraOf(known);
    const ruler = w.notables.get(p.ruler);
    const capital = w.settlements.get(p.capital);
    const fx = effectsOf(w, p.id);
    const recent = Array.from(known)
      .slice(-6)
      .map((tid) => TECH_BY_ID.get(tid)?.name ?? tid);
    const towns = Array.from(p.settlements)
      .map((sid) => w.settlements.get(sid))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 12);

    this.el.innerHTML = `
      <h2 style="color:hsl(${p.hue},65%,62%);text-shadow:0 0 10px hsla(${p.hue},65%,62%,0.4)">${p.name}</h2>
      <div class="kv">
        <span>government</span><span>${p.gov}</span>
        <span>people</span><span>${num(polityPop(w, p))}</span>
        <span>settlements</span><span>${p.settlements.size}</span>
        <span>founded</span><span>year ${yearOf(p.founded)}</span>
        <span>capital</span><span>${
          capital
            ? `<span class="link" data-kind="settlement" data-id="${capital.id}">${capital.name}</span>`
            : '—'
        }</span>
        <span>ruler</span><span>${
          ruler
            ? `<span class="link" data-kind="notable" data-id="${ruler.id}">${ruler.name}</span>`
            : 'nobody in particular'
        }</span>
        <span>stability</span><span>${(p.stability * 100).toFixed(0)}%</span>
        <span>one faith</span><span>${(religiousUnity(w, p) * 100).toFixed(0)}%</span>
        <span>treasury</span><span>${num(p.treasury)}</span>
        <span>era</span><span>${ERAS[era]}</span>
        <span>techs</span><span>${known.size} of ${TECH_BY_ID.size}</span>
        <span>military</span><span>${fx.mil.toFixed(2)}x</span>
      </div>
      <div class="sub">character — ${describeCulture(p.culture)}</div>
      ${this.cultureBars(p.culture)}
      ${
        p.wars.size
          ? `<div class="sub">at war with</div><div class="tags">${Array.from(p.wars)
              .map((e) => {
                const o = w.polities.get(e);
                return o
                  ? `<span class="tag link" data-kind="polity" data-id="${o.id}">${o.name}</span>`
                  : '';
              })
              .join('')}</div>`
          : ''
      }
      ${
        p.researching
          ? `<div class="sub">working on</div><div class="tags"><span class="tag">${
              TECH_BY_ID.get(p.researching)?.name ?? p.researching
            }</span></div>`
          : ''
      }
      ${
        recent.length
          ? `<div class="sub">lately learned</div><div class="tags">${recent
              .map((n) => `<span class="tag">${n}</span>`)
              .join('')}</div>`
          : ''
      }
      <div class="sub">holdings</div>
      <div class="tags">${towns
        .map(
          (s) =>
            `<span class="tag link" data-kind="settlement" data-id="${s.id}">${s.name} ${num(s.pop)}</span>`,
        )
        .join('')}</div>`;
  }

  private notable(w: World, id: number): void {
    const n = w.notables.get(id);
    if (!n) {
      this.el.innerHTML = `<div class="empty">Nobody remembers them.</div>`;
      return;
    }
    const deeds = n.deeds
      .map((eid) => w.chronicle.find((e) => e.id === eid))
      .filter((e): e is NonNullable<typeof e> => !!e);
    this.el.innerHTML = `
      <h2>${n.name}</h2>
      <div class="kv">
        <span>known as</span><span>${n.role}</span>
        <span>realm</span><span>${
          w.polities.has(n.polity)
            ? `<span class="link" data-kind="polity" data-id="${n.polity}">${w.polities.get(n.polity)!.name}</span>`
            : 'a forgotten people'
        }</span>
        <span>born</span><span>year ${yearOf(n.born)}</span>
        <span>died</span><span>${n.died === NONE ? 'still living' : `year ${yearOf(n.died)}`}</span>
        <span>deeds recorded</span><span>${n.deeds.length}</span>
      </div>
      <div class="sub">what they are remembered for</div>
      ${
        deeds.length
          ? deeds.map((e) => `<div class="deed">${e.text}</div>`).join('')
          : `<div class="empty">Nothing that survived into the current chronicle.</div>`
      }`;
  }

  private religion(w: World, id: number): void {
    const r = w.religions.get(id);
    if (!r) {
      this.el.innerHTML = `<div class="empty">That faith has no one left to keep it.</div>`;
      return;
    }
    const origin = w.settlements.get(r.origin);
    const founder = w.notables.get(r.founder);
    const parent = w.religions.get(r.parent);
    const followers = Array.from(w.settlements.values()).filter((s) => s.religion === r.id);
    this.el.innerHTML = `
      <h2>${r.name}</h2>
      <div class="kv">
        <span>founded</span><span>year ${yearOf(r.founded)}</span>
        <span>first preached</span><span>${
          origin
            ? `<span class="link" data-kind="settlement" data-id="${origin.id}">${origin.name}</span>`
            : 'somewhere lost'
        }</span>
        <span>by</span><span>${
          founder
            ? `<span class="link" data-kind="notable" data-id="${founder.id}">${founder.name}</span>`
            : 'someone forgotten'
        }</span>
        <span>adherents</span><span>${num(r.adherents)}</span>
        <span>congregations</span><span>${followers.length}</span>
        ${
          parent
            ? `<span>split from</span><span><span class="link" data-kind="religion" data-id="${parent.id}">${parent.name}</span></span>`
            : ''
        }
      </div>
      <div class="sub">tenets</div>
      ${this.cultureBars(r.tenets)}
      <div class="sub">kept in</div>
      <div class="tags">${
        followers.length
          ? followers
              .slice(0, 16)
              .map(
                (s) =>
                  `<span class="tag link" data-kind="settlement" data-id="${s.id}">${s.name}</span>`,
              )
              .join('')
          : '<span class="tag">nowhere any more</span>'
      }</div>`;
  }

  private tile(w: World, id: number): void {
    const t = w.tiles[id];
    if (!t) return;
    this.el.innerHTML = `
      <h2>${BIOME[t.biome].label}</h2>
      <div class="kv">
        <span>fertility</span><span>${(t.fertility * 100).toFixed(0)}%</span>
        <span>moisture</span><span>${(t.moisture * 100).toFixed(0)}%</span>
        <span>elevation</span><span>${(t.elev * 100).toFixed(0)}%</span>
        <span>river</span><span>${t.river ? 'yes' : 'no'}</span>
        <span>coast</span><span>${t.coastal ? 'yes' : 'no'}</span>
        <span>claimed by</span><span>${
          t.owner === NONE
            ? 'nobody'
            : `<span class="link" data-kind="polity" data-id="${t.owner}">${
                w.polities.get(t.owner)?.name ?? 'a dead realm'
              }</span>`
        }</span>
      </div>
      <div class="sub">resources</div>
      <div class="tags">${
        t.resources.length
          ? t.resources.map((r) => `<span class="tag">${RESOURCE[r].label}</span>`).join('')
          : '<span class="tag">none</span>'
      }</div>`;
  }
}
