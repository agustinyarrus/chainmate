#!/usr/bin/env node
/**
 * Opens a page in the visible test Chrome, waits for `readyExpr`, settles, screenshots, and prints
 * the page's exceptions and console errors in a card.
 *
 *   node tools/shot.mjs "smoke.html?variant=court" _ref/port/smoke-court.png [--width 1600 --height 900 --wait 2500]
 */
import { launchChrome, sleep } from './cdp.mjs';
import { card, paint } from './term.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [path = 'smoke.html', out = '_ref/port/smoke.png'] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const width = Number(option('width', 1600));
const height = Number(option('height', 900));
const wait = Number(option('wait', 2500));
const readyExpr = option('ready', 'window.smoke && window.smoke.ready');
const base = option('base', 'http://127.0.0.1:5190/');

const chrome = await launchChrome({ port: 9340, width, height });
const page = await chrome.page();
await page.viewport(width, height);
const started = Date.now();
await page.goto(new URL(path, base).href);
await page.waitFor(readyExpr, { timeout: 60000 });
await sleep(wait);
await page.shot(out);
const statsText = await page.eval(`document.getElementById('stats')?.textContent ?? ''`).catch(() => '');
const errors = page.console.filter((c) => c.type === 'error' || c.type === 'warning').map((c) => `${c.type}: ${c.text}`);
card('shot', [
  [paint.green('✓'), paint.blue(path), paint.dim(`→ ${out}`)],
  [paint.dim('stats'), statsText],
  [paint.dim('time'), `${((Date.now() - started) / 1000).toFixed(1)} s`],
  ...page.exceptions.map((e) => [paint.red('exception'), e.split('\n').slice(0, 3).join(' | ')]),
  ...errors.slice(0, 12).map((e) => [paint.amber('console'), e.slice(0, 220)]),
]);
page.close();
