#!/usr/bin/env node
/**
 * stages — the render-stage comparison: the port renders, from the same state, the stages the
 * original captured of itself (_oracle/probe_stages.gd → _ref/stages and _oracle/stages.json), and
 * every image is compared with its twin.
 *
 *   node e2e/stages.mjs                                   every camera stop, every stage
 *   node e2e/stages.mjs --shots outpost,crypt             some camera stops
 *   node e2e/stages.mjs --stages bare,key,key_shadow      some stages
 *   node e2e/stages.mjs --no-sync                         keep the port's own clocks (no oracle state)
 *   node e2e/stages.mjs --lead 3                          another phase for the fog's jitter (an experiment)
 *
 *   views       final · unshaded · normal · ssao · ssil · shadow_atlas · internal (lighting and pssm
 *               are the final frame again in a release build: they measure the original's own jitter)
 *   ablations   bare, then bare plus ONE of shadow / ssao / ssil / fog / volfog / glow / grade, and the
 *               lights alone: ambient · reflection · key · key_shadow · fill · omni
 *
 * Output: _ref/port/stages/*.png, diff/*.png, summary.json and report.html (local files).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sleep } from '../tools/cdp.mjs';
import { card, paint, spinner } from '../tools/term.mjs';
import { ROOT, BASE, openGame, pullShot, compare, pool, report, exitWhenFlushed, webglProblems } from './lib.mjs';

const POLL_MS = 250;
const DEFAULT_OUT = join(ROOT, '_ref', 'port', 'stages');
const ORIGINALS = join(ROOT, '_ref', 'stages');
const ORACLE = join(ROOT, '_oracle', 'stages.json');
/** The shadow atlas view covers a 600×600 square; the frusta drawn over it are not compared. */
const STAGE_COMPARE = Object.freeze({ shadow_atlas: ['--region', '0,0,600,600', '--mask-colored'] });
/** Light positions closer than this are the same light. */
const SAME_PLACE = 1e-3;

function parseArgs(argv) {
  const options = { shots: null, stages: null, sync: true, timeout: 1800, sample: null, lead: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--shots') options.shots = argv[++i];
    else if (arg === '--stages') options.stages = argv[++i];
    else if (arg === '--no-sync') options.sync = false;
    else if (arg === '--sample') options.sample = argv[++i];
    else if (arg === '--lead') options.lead = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function probeUrl(options) {
  const url = new URL('index.html', BASE);
  url.searchParams.set('probe', 'stages');
  if (options.shots) url.searchParams.set('shots', options.shots);
  if (options.stages) url.searchParams.set('stages', options.stages);
  if (!options.sync) url.searchParams.set('sync', '0');
  if (options.sample) url.searchParams.set('sample', options.sample);
  if (options.lead) url.searchParams.set('lead', options.lead);
  return url.href;
}

const maxAbs = (a, b) => a.reduce((worst, value, i) => Math.max(worst, Math.abs(value - b[i])), 0);
const countBy = (items, key) => items.reduce((counts, item) => counts.set(key(item), (counts.get(key(item)) ?? 0) + 1), new Map());

/**
 * What the simulation of the port did differently from the original's at one camera stop.
 * O(lights² + geometry).
 */
function compareState(oracle, port) {
  const rows = [];
  const number = (name, a, b) => rows.push({ name, oracle: a, port: b, delta: Math.abs(a - b) });
  number('frames', oracle.frames, port.frames);
  number('time', oracle.time, port.time);
  number('flicker time', oracle.arena.flicker_time, port.arena.flicker_time);
  number('rig yaw', oracle.rig.yaw, port.rig.yaw);
  number('rig pitch', oracle.rig.pitch, port.rig.pitch);
  number('rig zoom', oracle.rig.zoom, port.rig.zoom);
  number('camera fov', oracle.camera.fov, port.camera.fov);
  rows.push({ name: 'camera transform', delta: maxAbs(oracle.camera.xf, port.camera.xf) });
  // Column-major in both: x and y scale of the projection.
  rows.push({ name: 'projection scale', delta: Math.max(Math.abs(oracle.camera.projection[0] - port.camera.projection[0]), Math.abs(oracle.camera.projection[5] - port.camera.projection[5])) });
  number('flames', oracle.arena.flames.length, port.arena.flames.length);
  if (oracle.arena.flames.length === port.arena.flames.length) {
    rows.push({ name: 'flame energy', delta: maxAbs(oracle.arena.flames.map((f) => f.now), port.arena.flames.map((f) => f.now)) });
  }

  const visible = (list) => list.filter((item) => item.visible);
  const oracleLights = visible(oracle.lights);
  const portLights = visible(port.lights);
  number('lights', oracleLights.length, portLights.length);
  let worstLight = 0;
  let unmatched = 0;
  for (const light of oracleLights) {
    const directional = light.class === 'DirectionalLight3D';
    const twin = portLights.find((other) => other.class === light.class && (directional ? maxAbs(light.xf.slice(6, 9), other.xf.slice(6, 9)) < SAME_PLACE : maxAbs(light.xf.slice(9), other.xf.slice(9)) < SAME_PLACE));
    if (!twin) {
      unmatched += 1;
      continue;
    }
    const keys = ['energy', 'specular', 'volumetric_fog_energy', 'shadow_bias', 'shadow_normal_bias', 'shadow_blur', 'shadow_opacity', ...(directional ? ['shadow_max_distance', 'split_1', 'split_2', 'split_3', 'shadow_fade_start', 'shadow_pancake_size'] : ['range', 'attenuation'])];
    for (const key of keys) worstLight = Math.max(worstLight, Math.abs(light.params[key] - twin.params[key]));
    worstLight = Math.max(worstLight, maxAbs(light.color, twin.color));
    if (light.shadow !== twin.shadow) worstLight = Math.max(worstLight, 1);
  }
  rows.push({ name: 'lights without a twin', oracle: 0, port: unmatched, delta: unmatched });
  rows.push({ name: 'light parameters', delta: worstLight });

  const classes = new Set([...oracle.geometry.map((g) => g.class), ...port.geometry.map((g) => g.class)]);
  const oracleCounts = countBy(visible(oracle.geometry), (g) => g.class);
  const portCounts = countBy(visible(port.geometry), (g) => g.class);
  for (const name of [...classes].sort()) number(`${name} visible`, oracleCounts.get(name) ?? 0, portCounts.get(name) ?? 0);
  const instances = (list) => visible(list).reduce((sum, g) => sum + (g.instances ?? 0), 0);
  number('multimesh instances', instances(oracle.geometry), instances(port.geometry));

  const pieces = new Map(port.pieces.map((piece) => [piece.id, piece]));
  let worstPiece = 0;
  let missing = 0;
  for (const piece of oracle.pieces) {
    const twin = pieces.get(piece.id);
    if (!twin) missing += 1;
    else worstPiece = Math.max(worstPiece, maxAbs(piece.body, twin.body));
  }
  number('pieces', oracle.pieces.length, port.pieces.length);
  rows.push({ name: 'pieces without a twin', oracle: 0, port: missing, delta: missing });
  rows.push({ name: 'piece transforms', delta: worstPiece });
  return rows;
}

const fixed = (value, digits = 6) => (value === undefined ? '' : Number.isInteger(value) ? String(value) : value.toFixed(digits));

function stateTables(states) {
  return states
    .map(({ shot, rows }) => `<h2>state · ${shot}</h2><table><tr><th>quantity</th><th>original</th><th>port</th><th>difference</th></tr>${rows
      .map((row) => `<tr><td>${row.name}</td><td>${fixed(row.oracle)}</td><td>${fixed(row.port)}</td><td style="color:${row.delta > 1e-4 ? '#f7768e' : '#9ece6a'}">${row.delta.toExponential(2)}</td></tr>`)
      .join('')}</table>`)
    .join('\n');
}

function matrixTable(rows) {
  const shots = [...new Set(rows.map((row) => row.shot))];
  const stages = [...new Set(rows.map((row) => row.stage))];
  const cell = new Map(rows.map((row) => [`${row.shot}.${row.stage}`, row]));
  const color = (row) => (!row?.stats ? '#565f89' : row.stats.mean < 0.25 ? '#9ece6a' : row.stats.mean < 1 ? '#e0af68' : '#f7768e');
  return `<h2>mean difference per stage (of 255)</h2><table><tr><th>stage</th>${shots.map((shot) => `<th>${shot}</th>`).join('')}</tr>${stages
    .map((stage) => `<tr><td>${stage}</td>${shots.map((shot) => {
      const row = cell.get(`${shot}.${stage}`);
      return `<td style="color:${color(row)}">${row?.stats ? row.stats.mean.toFixed(3) : '·'}</td>`;
    }).join('')}</tr>`)
    .join('')}</table>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  if (!existsSync(ORACLE)) throw new Error(`no oracle: run  node tools/oracle.mjs stages --windowed --fixed-fps 60 --timeout 1200`);
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8'));
  const oracleStates = new Map(oracle.entries.filter((e) => e.k === 'state').map((e) => [e.shot, e]));
  // `--out` keeps an experiment apart from the reference run (a folder under the project).
  const OUT = options.out ? join(ROOT, options.out) : DEFAULT_OUT;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'diff'), { recursive: true });

  const { page, hud } = await openGame(probeUrl(options), { title: 'Chainmate · etapas del render' });
  hud?.grupo('etapas', options.stages ?? 'todas');

  const spin = spinner('stages');
  const log = [];
  const shots = [];
  let seenShots = 0;
  let failed = false;
  const deadline = started + options.timeout * 1000;
  for (;;) {
    const state = JSON.parse(await page.eval(`JSON.stringify(window.chainmate?.probe ? { done: window.chainmate.probe.done, shots: window.chainmate.probe.shots.length, errors: window.chainmate.errors } : { reloaded: true })`));
    if (state.reloaded || state.shots < seenShots) {
      // The dev server reloads the page when a source file changes: the frames seen so far are void.
      log.push('ERROR the page reloaded during the run (a source file changed?): run it again');
      failed = true;
      break;
    }
    while (seenShots < state.shots) {
      const shot = await pullShot(page, 'probe', seenShots, OUT);
      seenShots += 1;
      shots.push(shot);
      spin.tick(`${shots.length} images · ${shot.name}`);
      await hud?.paso(`etapa ${shot.name}`);
    }
    if (state.errors.length) {
      for (const error of state.errors) log.push(`ERROR ${error.where}: ${error.message}`);
      await hud?.check(false, `error en ${state.errors[0].where}`, state.errors[0].message);
      failed = true;
      break;
    }
    if (state.done) break;
    if (Date.now() > deadline) {
      log.push(`ERROR timed out after ${options.timeout} s`);
      failed = true;
      break;
    }
    await sleep(POLL_MS);
  }
  spin.stop();
  const entries = JSON.parse(await page.eval('JSON.stringify(window.chainmate?.probe?.entries ?? [])'));
  for (const text of new Set(entries.filter((e) => e.k === 'warning').map((e) => e.text))) log.push(`warning: ${text}`);
  const consoleErrors = page.console.filter((c) => c.type === 'error').map((c) => c.text);
  for (const text of [...new Set(consoleErrors)].slice(0, 12)) log.push(`console: ${text.slice(0, 300)}`);
  const gl = webglProblems(page);
  for (const text of gl.errors.slice(0, 6)) log.push(`ERROR webgl: ${text.slice(0, 300)}`);
  for (const text of gl.warnings.slice(0, 6)) log.push(`WARN webgl: ${text.slice(0, 300)}`);
  if (gl.errors.length > 0) failed = true;
  for (const text of page.exceptions.slice(0, 6)) log.push(`exception: ${text.split('\n')[0]}`);

  const states = entries.filter((e) => e.k === 'state' && oracleStates.has(e.shot)).map((e) => ({ shot: e.shot, rows: compareState(oracleStates.get(e.shot), e) }));
  const reference = existsSync(ORIGINALS) ? new Set(readdirSync(ORIGINALS)) : new Set();
  const compareSpin = spinner('comparing');
  let compared = 0;
  const rows = await pool(shots, async (shot) => {
    const name = `${shot.name}.png`;
    const original = relative(OUT, join(ORIGINALS, name)).replaceAll('\\', '/');
    let row;
    if (!reference.has(name)) row = { name: shot.name, shot: shot.shot, stage: shot.stage, verdict: 'missing', note: 'the original has no image with this name', port: name };
    else {
      const stats = await compare(join(ORIGINALS, name), shot.file, join(OUT, 'diff', name), STAGE_COMPARE[shot.stage] ?? []);
      row = stats.error
        ? { name: shot.name, shot: shot.shot, stage: shot.stage, verdict: 'different', note: stats.error, port: name, original }
        : { name: shot.name, shot: shot.shot, stage: shot.stage, verdict: stats.verdict, stats, port: name, original, diff: `diff/${name}` };
    }
    compareSpin.tick(`${++compared} / ${shots.length}`);
    return row;
  });
  compareSpin.stop();

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), options, images: rows.map(({ name, shot, stage, verdict, stats, note }) => ({ name, shot, stage, verdict, ...stats, note })), states }, null, 1));
  const reportFile = report(OUT, 'Chainmate · render stages · original vs port', rows, log, matrixTable(rows) + stateTables(states));
  await hud?.fin({ subtitulo: `${shots.length} imágenes`, pie: reportFile });

  const verdictPaint = (verdict) => (verdict === 'match' || verdict === 'identical' ? paint.green(verdict) : verdict === 'close' ? paint.amber(verdict) : paint.red(verdict));
  const drift = states.map(({ shot, rows: stateRows }) => {
    const worst = stateRows.reduce((a, b) => (b.delta > a.delta ? b : a));
    return [paint.dim(`state ${shot}`.padEnd(30)), worst.delta > 1e-4 ? paint.amber(`${worst.name}: ${worst.delta.toExponential(2)}`) : paint.green('same state'), ''];
  });
  card('stages', [
    [failed ? paint.red('✗') : paint.green('✓'), `${shots.length} images`, paint.dim(`→ ${OUT}`)],
    ...drift,
    ...rows.map((row) => [paint.dim(row.name.padEnd(30)), row.stats ? `mean ${row.stats.mean.toFixed(3).padStart(7)}  off ${row.stats.share.toFixed(2).padStart(6)} %  max ${String(row.stats.max).padStart(3)}` : row.note ?? '', verdictPaint(row.verdict)]),
    ...log.slice(0, 10).map((line) => [(line.startsWith('WARN') ? paint.amber : paint.red)(line.slice(0, 160))]),
    [paint.dim('time'), `${((Date.now() - started) / 1000).toFixed(0)} s`],
    [paint.dim('report'), reportFile],
  ]);
  page.close();
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
    process.exitCode = 1;
  })
  .finally(() => exitWhenFlushed());
