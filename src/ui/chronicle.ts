import type { Event, World } from './../sim/types.ts';
import { eraLabel, eraSentence } from './../sim/chronicle.ts';

const DOM_CAP = 700;

/**
 * Append-only. Rebuilding a few thousand lines every tick would cost more than
 * the simulation does, so the pane only ever adds what is new and drops what
 * has scrolled far enough off the top.
 */
export class ChroniclePane {
  private el: HTMLElement;
  private list: HTMLElement;
  private eraBox: HTMLElement;
  private lastEventId = -1;
  private lastEraCount = -1;
  private follow = true;
  private activeId = -1;
  onPick: ((e: Event) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.eraBox = document.createElement('div');
    this.list = document.createElement('div');
    this.list.className = 'chronicle';
    el.append(this.eraBox, this.list);

    el.addEventListener('scroll', () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      this.follow = atBottom;
    });
  }

  reset(): void {
    this.lastEventId = -1;
    this.lastEraCount = -1;
    this.activeId = -1;
    this.follow = true;
    this.list.replaceChildren();
    this.eraBox.replaceChildren();
  }

  update(w: World): void {
    if (w.eras.length !== this.lastEraCount) {
      this.lastEraCount = w.eras.length;
      this.eraBox.replaceChildren(
        ...w.eras.map((era) => {
          const d = document.createElement('div');
          d.className = 'era';
          d.innerHTML = `<b>${eraLabel(era)}</b> — ${eraSentence(era)}`;
          for (const h of era.highlights) {
            const line = document.createElement('div');
            line.className = 'ev sev3';
            line.textContent = h.text;
            line.style.marginTop = '4px';
            d.appendChild(line);
          }
          return d;
        }),
      );
    }

    const fresh: Event[] = [];
    for (let i = w.chronicle.length - 1; i >= 0; i--) {
      if (w.chronicle[i].id <= this.lastEventId) break;
      fresh.push(w.chronicle[i]);
    }
    if (fresh.length === 0) return;
    fresh.reverse();

    // A world loaded from disk arrives with thousands of lines at once.
    const toRender = fresh.length > DOM_CAP ? fresh.slice(-DOM_CAP) : fresh;
    const frag = document.createDocumentFragment();
    for (const e of toRender) frag.appendChild(this.row(e));
    this.list.appendChild(frag);
    this.lastEventId = fresh[fresh.length - 1].id;

    while (this.list.childElementCount > DOM_CAP) this.list.removeChild(this.list.firstChild!);
    if (this.follow) this.el.scrollTop = this.el.scrollHeight;
  }

  private row(e: Event): HTMLElement {
    const d = document.createElement('div');
    d.className = `ev sev${e.severity}`;
    d.textContent = e.text;
    d.dataset.id = String(e.id);
    d.addEventListener('click', () => {
      this.setActive(e.id);
      this.onPick?.(e);
    });
    return d;
  }

  private setActive(id: number): void {
    if (this.activeId >= 0) {
      this.list.querySelector(`[data-id="${this.activeId}"]`)?.classList.remove('active');
    }
    this.activeId = id;
    this.list.querySelector(`[data-id="${id}"]`)?.classList.add('active');
  }
}
