#!/usr/bin/env node
/**
 * tour — runs the capture tour of the port in a VISIBLE Chrome and collects its screenshots, the
 * same numbered shots the original build took of itself (tools/capture-original.ps1 → _ref/<tour>).
 *
 *   node e2e/tour.mjs                        the full tour  → _ref/port/tour   (vs _ref/tour)
 *   node e2e/tour.mjs menu|arena|pieces|relics              → _ref/port/<mode> (vs _ref/<mode>)
 *   node e2e/tour.mjs --acts 1 --seed TOUR-7 --timeout 900
 *   node e2e/tour.mjs --rng-seed 0           the global random stream from the clock (default: seeded)
 *   node e2e/tour.mjs pieces --trace         also the state trace (src/dev/trace.js) → trace.txt beside
 *                                            the shots; compare with tools/trace-compare.mjs
 *
 * Repeatable: every frame is 1/60 s and the engine-wide random stream starts from the same seed the
 * original's references were captured with (tools/capture-original.ps1 -GlobalSeed, default 7), so
 * banners, flames and piece idles match the original's frame for frame.
 *
 * The page keeps each frame as a PNG data URL (exact drawing-buffer pixels, no compositor in
 * between); this tool pulls them as they appear, narrates the run in the on-page HUD, then compares
 * every shot with the original's and writes a local report (report.html beside the shots).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../tools/cdp.mjs';
import { card, paint, spinner } from '../tools/term.mjs';
import { ROOT, BASE, bareFlags, openGame, pullShot, compare, pool, report, exitWhenFlushed, webglProblems } from './lib.mjs';

const POLL_MS = 200;
/** The seed of the global random stream the references were captured with (capture-original.ps1). */
const DEFAULT_GLOBAL_SEED = 7;
const MODES = new Set(['tour', 'menu', 'arena', 'pieces', 'relics']);

function parseArgs(argv) {
  const options = { mode: 'tour', acts: null, seed: null, rngSeed: DEFAULT_GLOBAL_SEED, timeout: 1500, compare: true, trace: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--acts') options.acts = Number(argv[++i]);
    else if (arg === '--trace') options.trace = true;
    else if (arg === '--seed') options.seed = argv[++i];
    else if (arg === '--rng-seed') options.rngSeed = Number(argv[++i]);
    else if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else if (arg === '--no-compare') options.compare = false;
    else if (MODES.has(arg)) options.mode = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function tourUrl(options) {
  const url = new URL('index.html', BASE);
  url.searchParams.set('capture', '');
  if (options.mode !== 'tour') url.searchParams.set(options.mode, '');
  if (options.acts !== null) url.searchParams.set('acts', String(options.acts));
  if (options.seed !== null) url.searchParams.set('seed', options.seed);
  if (options.rngSeed > 0) url.searchParams.set('rngseed', String(options.rngSeed));
  if (options.trace) url.searchParams.set('trace', '');
  return bareFlags(url);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const out = join(ROOT, '_ref', 'port', options.mode);
  const originals = join(ROOT, '_ref', options.mode);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const { page, hud } = await openGame(tourUrl(options), { title: `Chainmate · recorrido de capturas (${options.mode})` });
  hud?.grupo('recorrido', options.mode);

  const spin = spinner(`tour ${options.mode}`);
  const log = [];
  const shots = [];
  let seenLog = 0;
  let seenShots = 0;
  const deadline = started + options.timeout * 1000;
  for (;;) {
    const state = JSON.parse(await page.eval(`JSON.stringify({ done: window.chainmate.tour.done, failures: window.chainmate.tour.failures, log: window.chainmate.tour.log.length, shots: window.chainmate.tour.shots.length, errors: window.chainmate.errors })`));
    if (state.log > seenLog) {
      // Lines can arrive between the two evals: count what was read, not what the first eval saw.
      const lines = JSON.parse(await page.eval(`JSON.stringify(window.chainmate.tour.log.slice(${seenLog}))`));
      seenLog += lines.length;
      for (const line of lines) {
        log.push(line);
        if (line.startsWith('TOUR PASS ')) await hud?.check(true, line.slice(10));
        else if (line.startsWith('TOUR FAIL ')) await hud?.check(false, line.slice(10));
      }
    }
    while (seenShots < state.shots) {
      const shot = await pullShot(page, 'tour', seenShots, out);
      seenShots += 1;
      shots.push(shot);
      spin.tick(`${shots.length} shots · ${shot.name}`);
      await hud?.paso(`captura ${shot.name}`);
    }
    if (state.errors.length) {
      for (const error of state.errors) log.push(`ERROR ${error.where}: ${error.message}`);
      await hud?.check(false, `error en ${state.errors[0].where}`, state.errors[0].message);
      break;
    }
    if (state.done) break;
    if (Date.now() > deadline) {
      log.push(`TOUR FAIL timed out after ${options.timeout} s`);
      break;
    }
    await sleep(POLL_MS);
  }
  spin.stop();
  // A draw the GPU refused leaves something out of the picture: the tour fails with it.
  const gl = webglProblems(page);
  for (const text of gl.errors.slice(0, 6)) log.push(`ERROR webgl: ${text.slice(0, 300)}`);
  for (const text of gl.warnings.slice(0, 6)) log.push(`WARN webgl: ${text.slice(0, 300)}`);

  const trace = log.filter((line) => line.startsWith('TRACE '));
  if (trace.length) writeFileSync(join(out, 'trace.txt'), `${trace.join('\n')}\n`);
  const failures = log.filter((line) => line.startsWith('TOUR FAIL') || line.startsWith('ERROR')).length;
  let rows = [];
  if (options.compare) {
    const reference = existsSync(originals) ? new Set(readdirSync(originals)) : new Set();
    mkdirSync(join(out, 'diff'), { recursive: true });
    rows = await pool(shots, async (shot) => {
      const name = `${shot.name}.png`;
      if (!reference.has(name)) return { name: shot.name, verdict: 'missing', note: 'the original has no shot with this name', port: name };
      const original = join('..', '..', options.mode, name).replaceAll('\\', '/');
      const stats = await compare(join(originals, name), shot.file, join(out, 'diff', name));
      if (stats.error) return { name: shot.name, verdict: 'different', note: stats.error, port: name, original };
      return { name: shot.name, verdict: stats.verdict, stats, port: name, original, diff: `diff/${name}` };
    });
  }
  const reportFile = rows.length ? report(out, `Chainmate · ${options.mode} · original vs port`, rows, log) : null;
  await hud?.fin({ subtitulo: `${shots.length} capturas`, pie: reportFile ?? out });

  card(`tour ${options.mode}`, [
    [failures === 0 ? paint.green('✓') : paint.red('✗'), `${shots.length} shots`, paint.dim(`→ ${out}`)],
    [paint.dim('checks'), `${log.filter((l) => l.startsWith('TOUR PASS')).length} passed`, failures ? paint.red(`${failures} failed`) : ''],
    ...rows.map((row) => [paint.dim(row.name.padEnd(28)), row.stats ? `mean ${row.stats.mean.toFixed(2).padStart(6)}  off ${row.stats.share.toFixed(2).padStart(6)} %` : row.note ?? '', row.verdict === 'match' || row.verdict === 'identical' ? paint.green(row.verdict) : row.verdict === 'close' ? paint.amber(row.verdict) : paint.red(row.verdict)]),
    ...log.filter((l) => l.startsWith('TOUR FAIL') || l.startsWith('ERROR')).slice(0, 8).map((l) => [paint.red(l.slice(0, 150))]),
    ...log.filter((l) => l.startsWith('WARN')).slice(0, 4).map((l) => [paint.amber(l.slice(0, 150))]),
    [paint.dim('time'), `${((Date.now() - started) / 1000).toFixed(0)} s`],
    ...(reportFile ? [[paint.dim('report'), reportFile]] : []),
  ]);
  page.close();
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
    process.exitCode = 1;
  })
  .finally(() => exitWhenFlushed());
