#!/usr/bin/env node
/**
 * trace-compare — lines up the state traces of the two builds' capture tours and says where they
 * part: the original's (_oracle/probe_tour.gd --trace, in the capture's stdout log) against the
 * port's (src/dev/trace.js, trace.txt beside the port's shots).
 *
 *   pwsh -File tools/capture-original.ps1 -Modes pieces -Trace -RefRoot _ref/trace
 *   node e2e/tour.mjs pieces --trace
 *   node tools/trace-compare.mjs pieces [--seed 7]
 *   node tools/trace-compare.mjs --original <stdout log> --port <trace.txt>
 *
 * What it checks, in the order a divergence propagates:
 *
 *   stream   every fingerprint of the global random stream — cloth phases and flame seeds
 *            (randf() × 10 / × 20), particle seeds (randi()), piece idle phases (randf() × 10) —
 *            placed at the WORD of the seeded stream it was drawn from; the two schedules must be the
 *            same, and the first fingerprint that differs is where the streams part (the words
 *            between two fingerprints are the draws nobody shows, like a particle system's first)
 *   gui      every change of the hovered control and of the focus owner, and its frame
 *   clock    the frame of every spawn and every shot, relative to the first spawn
 *   halos    at every shot, each halo's phase, turn, height and spark seed
 *
 * O(W) to index W words of the stream (a Map per fingerprint kind), O(lines) to parse,
 * O(events) to align.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint } from './term.mjs';
import { RandomNumberGenerator } from '../src/godot/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Printed with 12 decimals (phases, doubles) and 9 (float32 turns and heights): half a unit of the last digit. */
const TOLERANCE = Object.freeze({ time: 5e-12, turn: 5e-9, height: 5e-9 });
/** How many individual differences the card lists before summarising. */
const MAX_LISTED = 12;
/** Fingerprints before the first difference shown for context. */
const CONTEXT = 3;
/** Words of the stream indexed: far more than a tour draws. */
const STREAM_WORDS = 400_000;
const DEFAULT_SEED = 7;
const LINE = /^TRACE (draw|spawn|shot|halo|gui) (.*)$/;
const F = Math.fround;
/** Math::randf: (float)rand() / (float)UINT32_MAX (src/godot/rng.js). */
const UINT32_MAX_F = F(4294967295);

function parseArgs(argv) {
  const options = { mode: null, original: null, port: null, seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--original') options.original = argv[++i];
    else if (arg === '--port') options.port = argv[++i];
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (!arg.startsWith('--')) options.mode = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.mode) {
    options.original ??= join(ROOT, '_ref', 'trace', 'logs', `${options.mode}.out.txt`);
    options.port ??= join(ROOT, '_ref', 'port', options.mode, 'trace.txt');
  }
  if (!options.original || !options.port) throw new Error('usage: trace-compare <mode> | --original <log> --port <trace.txt>');
  return options;
}

/** `key=value key=value` → object; values stay strings until compared (ids may look numeric). */
function fields(text) {
  const out = {};
  for (const pair of text.trim().split(/\s+/)) {
    const at = pair.indexOf('=');
    out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/**
 * One pass over a trace: the fingerprints in order of appearance (draws and spawns), spawns apart,
 * shots by index (each with its halos by piece id). O(lines).
 */
function parseTrace(file) {
  if (!existsSync(file)) throw new Error(`no trace at ${file}`);
  const fingerprints = [];
  const gui = [];
  const spawns = [];
  const shots = new Map();
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = LINE.exec(raw.trim());
    if (!match) continue;
    const [, type, rest] = match;
    const f = fields(rest);
    if (type === 'gui') gui.push({ frame: Number(f.frame), what: f.what, control: f.control });
    else if (type === 'draw') fingerprints.push({ frame: Number(f.frame), kind: f.kind, value: f.value, where: f.path });
    else if (type === 'spawn') {
      spawns.push({ frame: Number(f.frame), id: f.id, time: Number(f.time) });
      fingerprints.push({ frame: Number(f.frame), kind: 'time', value: f.time, where: f.id });
    } else if (type === 'shot') {
      current = { index: Number(f.index), frame: Number(f.frame), halos: new Map() };
      shots.set(current.index, current);
    } else if (current) {
      current.halos.set(f.id, { time: Number(f.time), turn: Number(f.turn), height: Number(f.height), seed: Number(f.seed) });
    }
  }
  return { fingerprints, gui, spawns, shots };
}

/**
 * The printed form of every fingerprint each word of the seeded stream would give, per kind:
 * kind → (text → ascending word indices). O(W).
 */
function indexStream(seed) {
  const rng = new RandomNumberGenerator();
  rng.seed = seed;
  const byKind = { phase: new Map(), seed: new Map(), time: new Map(), particles: new Map() };
  const add = (map, text, index) => {
    const list = map.get(text);
    if (list) list.push(index);
    else map.set(text, [index]);
  };
  for (let index = 0; index < STREAM_WORDS; index++) {
    const word = rng.randi();
    const unit = F(F(word) / UINT32_MAX_F);
    const tenfold = (unit * 10).toFixed(12);
    add(byKind.phase, tenfold, index);
    add(byKind.time, tenfold, index);
    add(byKind.seed, (unit * 20).toFixed(12), index);
    add(byKind.particles, String(word), index);
  }
  return byKind;
}

/** Places every fingerprint at the first word that prints it and no earlier fingerprint took. O(events). */
function placeInStream(fingerprints, stream) {
  const taken = new Set();
  for (const fingerprint of fingerprints) {
    const candidates = stream[fingerprint.kind]?.get(fingerprint.value) ?? [];
    fingerprint.word = candidates.find((index) => !taken.has(index)) ?? null;
    if (fingerprint.word !== null) taken.add(fingerprint.word);
  }
  return fingerprints;
}

const describe = (f) => `${f.kind.padEnd(9)} word ${f.word === null ? '   ?' : String(f.word).padStart(4)}  ${f.where}`;

/** The two schedules side by side: the first fingerprint whose kind, value or word differs. O(events). */
function compareStream(original, port) {
  const count = Math.min(original.length, port.length);
  for (let i = 0; i < count; i++) {
    const a = original[i];
    const b = port[i];
    if (a.kind !== b.kind || a.value !== b.value || a.word !== b.word) return { at: i, count };
  }
  return { at: -1, count };
}

/** Hover and focus changes side by side: the first that differs, and those only on another frame. O(changes). */
function compareGui(original, port) {
  const late = [];
  const count = Math.min(original.length, port.length);
  for (let i = 0; i < count; i++) {
    const a = original[i];
    const b = port[i];
    if (a.what !== b.what || a.control !== b.control) return { at: i, late };
    if (a.frame !== b.frame) late.push({ index: i, what: a.what, control: a.control, delta: b.frame - a.frame });
  }
  return { at: original.length === port.length ? -1 : count, late };
}

/** Frames relative to the first spawn: spawns and shots whose timing differs. O(spawns + shots). */
function compareClock(a, b) {
  const originBase = a.spawns[0]?.frame ?? 0;
  const portBase = b.spawns[0]?.frame ?? 0;
  const drift = [];
  const count = Math.min(a.spawns.length, b.spawns.length);
  for (let i = 0; i < count; i++) {
    const delta = (b.spawns[i].frame - portBase) - (a.spawns[i].frame - originBase);
    if (delta !== 0) drift.push({ what: `spawn #${i} ${a.spawns[i].id}`, delta });
  }
  for (const [index, shot] of a.shots) {
    const other = b.shots.get(index);
    if (!other) continue;
    const delta = (other.frame - portBase) - (shot.frame - originBase);
    if (delta !== 0) drift.push({ what: `shot ${index}`, delta });
  }
  return drift;
}

/** Every halo field that differs at every shot both traces have. O(shots × halos). */
function compareHalos(a, b) {
  const differences = [];
  let compared = 0;
  for (const [index, shot] of a.shots) {
    const other = b.shots.get(index);
    if (!other) continue;
    for (const [id, halo] of shot.halos) {
      const mine = other.halos.get(id);
      if (!mine) {
        differences.push({ shot: index, id, field: 'missing', original: '-', port: 'no halo' });
        continue;
      }
      compared += 1;
      for (const field of ['time', 'turn', 'height']) {
        if (Math.abs(halo[field] - mine[field]) > TOLERANCE[field]) differences.push({ shot: index, id, field, original: halo[field], port: mine[field] });
      }
      if (halo.seed !== mine.seed) differences.push({ shot: index, id, field: 'seed', original: halo.seed, port: mine.seed });
    }
    for (const id of other.halos.keys()) if (!shot.halos.has(id)) differences.push({ shot: index, id, field: 'extra', original: 'no halo', port: '-' });
  }
  return { differences, compared };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const a = parseTrace(options.original);
  const b = parseTrace(options.port);
  const stream = indexStream(options.seed);
  placeInStream(a.fingerprints, stream);
  placeInStream(b.fingerprints, stream);
  const parting = compareStream(a.fingerprints, b.fingerprints);
  const clock = compareClock(a, b);
  const halos = compareHalos(a, b);
  const gui = compareGui(a.gui, b.gui);
  const unplaced = (list) => list.filter((f) => f.word === null).length;

  const rows = [
    [paint.dim('original'), `${a.fingerprints.length} fingerprints (${unplaced(a.fingerprints)} off the stream) · ${a.shots.size} shots`, paint.dim(options.original.replace(ROOT, '.'))],
    [paint.dim('port    '), `${b.fingerprints.length} fingerprints (${unplaced(b.fingerprints)} off the stream) · ${b.shots.size} shots`, paint.dim(options.port.replace(ROOT, '.'))],
  ];
  if (parting.at < 0) {
    const same = a.fingerprints.length === b.fingerprints.length;
    rows.push([same ? paint.green('✓') : paint.amber('~'), `stream  ${parting.count} fingerprints on the same words`, same ? '' : paint.amber(`(${a.fingerprints.length} vs ${b.fingerprints.length})`)]);
  } else {
    rows.push([paint.red('✗'), `stream  parts at fingerprint #${parting.at} (seed ${options.seed})`]);
    const from = Math.max(0, parting.at - CONTEXT);
    for (let i = from; i <= Math.min(parting.at + CONTEXT, Math.max(a.fingerprints.length, b.fingerprints.length) - 1); i++) {
      const mark = i === parting.at ? paint.red('▸') : paint.dim(' ');
      rows.push([mark, paint.dim(`#${String(i).padStart(3)}`), `${a.fingerprints[i] ? describe(a.fingerprints[i]) : '-'}`.padEnd(58), paint.dim('│'), b.fingerprints[i] ? describe(b.fingerprints[i]) : '-']);
    }
  }
  if (gui.at < 0 && gui.late.length === 0) rows.push([paint.green('✓'), `gui     ${a.gui.length} hover and focus changes, same controls on the same frames`]);
  else if (gui.at >= 0) {
    rows.push([paint.red('✗'), `gui     parts at change #${gui.at}`]);
    for (let i = Math.max(0, gui.at - CONTEXT); i <= Math.min(gui.at + CONTEXT, Math.max(a.gui.length, b.gui.length) - 1); i++) {
      const mark = i === gui.at ? paint.red('▸') : paint.dim(' ');
      const side = (event) => (event ? `f${String(event.frame).padStart(5)} ${event.what.padEnd(5)} ${event.control}` : '-');
      rows.push([mark, paint.dim(`#${String(i).padStart(3)}`), side(a.gui[i]).padEnd(58), paint.dim('│'), side(b.gui[i])]);
    }
  } else {
    rows.push([paint.amber('~'), `gui     same changes, ${gui.late.length} on other frames`]);
    for (const entry of gui.late.slice(0, MAX_LISTED)) rows.push([paint.dim('   '), `#${entry.index} ${entry.what} ${entry.control}`, `${entry.delta > 0 ? '+' : ''}${entry.delta} frame(s) in the port`]);
  }
  if (clock.length === 0) rows.push([paint.green('✓'), 'clock   every spawn and shot on the same frame']);
  else {
    rows.push([paint.red('✗'), `clock   ${clock.length} events on other frames`]);
    for (const entry of clock.slice(0, MAX_LISTED)) rows.push([paint.dim('   '), entry.what.padEnd(28), `${entry.delta > 0 ? '+' : ''}${entry.delta} frame(s) in the port`]);
  }
  if (halos.differences.length === 0) rows.push([paint.green('✓'), `halos   ${halos.compared} halo states identical`]);
  else {
    rows.push([paint.red('✗'), `halos   ${halos.differences.length} differences over ${halos.compared} halo states`]);
    for (const d of halos.differences.slice(0, MAX_LISTED)) rows.push([paint.dim('   '), `shot ${String(d.shot).padStart(2)} ${d.id.padEnd(14)} ${d.field.padEnd(7)}`, `${d.original} vs ${d.port}`]);
  }
  card('trace compare', rows);
  process.exitCode = parting.at < 0 && clock.length === 0 && halos.differences.length === 0 && gui.at < 0 && gui.late.length === 0 ? 0 : 1;
}

main();
