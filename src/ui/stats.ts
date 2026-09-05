import type { World } from './../sim/types.ts';
import { yearOf } from './../sim/chronicle.ts';

interface Series {
  key: keyof World['stats'];
  label: string;
}

const SERIES: Series[] = [
  { key: 'pop', label: 'population' },
  { key: 'polities', label: 'realms' },
  { key: 'settlements', label: 'settlements' },
  { key: 'techs', label: 'techs known, all realms' },
  { key: 'wars', label: 'wars under way' },
  { key: 'religions', label: 'living faiths' },
];

/**
 * Where the "I left it running for three weeks" feeling lives. Plain line
 * charts on canvas, one per series, redrawn only while the page is open.
 */
export class StatsPage {
  private el: HTMLElement;
  private canvases = new Map<string, HTMLCanvasElement>();

  constructor(el: HTMLElement) {
    this.el = el;
    for (const s of SERIES) {
      const box = document.createElement('div');
      box.className = 'chartbox';
      const h = document.createElement('h4');
      h.textContent = s.label;
      const c = document.createElement('canvas');
      box.append(h, c);
      el.appendChild(box);
      this.canvases.set(s.key, c);
    }
  }

  get visible(): boolean {
    return this.el.classList.contains('show');
  }

  toggle(w: World | null): boolean {
    this.el.classList.toggle('show');
    if (this.visible && w) this.render(w);
    return this.visible;
  }

  render(w: World): void {
    if (!this.visible) return;
    for (const s of SERIES) this.chart(this.canvases.get(s.key)!, w.stats.tick, w.stats[s.key]);
  }

  private chart(canvas: HTMLCanvasElement, ticks: number[], values: number[]): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    if (values.length < 2) {
      ctx.fillStyle = '#8b8574';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('not enough history yet', 8, H / 2);
      return;
    }

    let max = 0;
    for (const v of values) if (v > max) max = v;
    if (max <= 0) max = 1;

    const pad = 18;
    const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad - 6);
    const y = (v: number) => H - 14 - (v / max) * (H - 24);

    ctx.strokeStyle = 'rgba(43, 41, 37, 0.9)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const gy = y((max / 2) * g);
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(W - 6, gy);
      ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const px = x(i);
      const py = y(values[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.lineTo(x(values.length - 1), H - 14);
    ctx.lineTo(x(0), H - 14);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 176, 0, 0.08)';
    ctx.fill();

    ctx.fillStyle = '#8b8574';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(max.toLocaleString(), 2, 12);
    ctx.fillText(`yr ${yearOf(ticks[0])}`, pad, H - 3);
    const last = `yr ${yearOf(ticks[ticks.length - 1])}`;
    ctx.fillText(last, W - 6 - ctx.measureText(last).width, H - 3);
  }
}
