/**
 * The clock. Time passes only while this tab is open and this interval is
 * running — there is no catch-up on resume, by design. A background tab gets
 * throttled to about one fire a second by the browser, which just means the
 * civilization runs slower while you are not looking at it.
 */
export const SPEEDS = [0.5, 1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

export class SimClock {
  speed: Speed = 1;
  paused = true;
  private timer: number | null = null;
  private onTick: () => void;

  constructor(onTick: () => void) {
    this.onTick = onTick;
  }

  /** 1x is one simulated month every two seconds. */
  private intervalMs(): number {
    return 2000 / this.speed;
  }

  private arm(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.paused) return;
    this.timer = setInterval(() => this.onTick(), this.intervalMs()) as unknown as number;
  }

  resume(): void {
    this.paused = false;
    this.arm();
  }

  pause(): void {
    this.paused = true;
    this.arm();
  }

  toggle(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.arm();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
