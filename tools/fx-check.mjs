#!/usr/bin/env node
/**
 * Visual check of the battle effects in a VISIBLE Chrome: loads the smoke scene, fires each effect
 * and screenshots it mid-flight, then prints a card with the shots and any page errors.
 *
 *   node tools/fx-check.mjs [--out _ref/port/fx] [--variant court] [--safe board]
 */
import { launchChrome, sleep } from './cdp.mjs';
import { card, paint, spinner } from './term.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = option('out', '_ref/port/fx');
const variant = option('variant', 'court');
const safe = option('safe', 'board');
const base = option('base', 'http://127.0.0.1:5190/');

/** effect → [delay before the shot in ms, …] */
const PLAN = [
  ['select', [900]],
  ['capture', [120, 420]],
  ['ring', [180]],
  ['promote', [250, 700]],
  ['evolve', [300]],
  ['relic', [200]],
  ['drop', [700, 1400]],
  ['topple', [900]],
];

const chrome = await launchChrome({ port: 9340, width: 1600, height: 900 });
const page = await chrome.page();
await page.viewport(1600, 900);
await page.goto(new URL(`smoke.html?variant=${variant}&safe=${safe}`, base).href);
await page.waitFor('window.smoke && window.smoke.ready', { timeout: 90000 });
await sleep(2500);
const rows = [];
const spin = spinner('effects');
await page.shot(`${out}/00_idle.png`);
rows.push([paint.green('✓'), 'idle'.padEnd(10), paint.dim(`${out}/00_idle.png`)]);
let index = 1;
for (const [name, delays] of PLAN) {
  spin.tick(name);
  await page.eval(`window.smoke.fx(${JSON.stringify(name)})`);
  let elapsed = 0;
  for (const delay of delays) {
    await sleep(delay - elapsed);
    elapsed = delay;
    const file = `${out}/${String(index).padStart(2, '0')}_${name}_${delay}ms.png`;
    await page.shot(file);
    rows.push([paint.green('✓'), name.padEnd(10), `${String(delay).padStart(5)} ms`, paint.dim(file)]);
    index += 1;
  }
  await sleep(600);
}
spin.stop();
const stats = await page.eval(`document.getElementById('stats')?.textContent ?? ''`);
const problems = [
  ...page.exceptions.map((e) => [paint.red('exception'), e.split('\n').slice(0, 2).join(' | ')]),
  ...page.console.filter((c) => c.type === 'error' || c.type === 'warning').slice(0, 10).map((c) => [paint.amber(c.type), c.text.slice(0, 200)]),
];
card('fx check', [...rows, [paint.dim('stats'), stats], ...problems], problems.length ? paint.red(`${problems.length} problems`) : paint.green('no page errors'));
page.close();
