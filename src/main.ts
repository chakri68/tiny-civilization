import './style.css';
import { App } from './ui/app.ts';

const app = new App(document.querySelector<HTMLDivElement>('#app')!);

/**
 * The pixel font must be loaded before the intro runs — its fallback shifts the
 * layout badly enough to be visible. Everything else can start immediately.
 */
const fontReady =
  'fonts' in document
    ? document.fonts.load('12px "Press Start 2P"').catch(() => undefined)
    : Promise.resolve(undefined);

void fontReady.then(() => {
  document.body.classList.remove('booting');
  document.body.classList.add('booted');
});

void app.boot();

// Dev-only: lets the browser harness fast-forward a world without sitting
// through it in real time. Vite strips this branch from production builds.
if (import.meta.env.DEV) {
  (globalThis as unknown as { civ: App }).civ = app;
}
