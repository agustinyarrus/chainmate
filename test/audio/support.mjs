/**
 * Shared by the audio tests: the oracle's binary blobs, the streams of the original, comparisons of
 * sample buffers, and the report cards.
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { loadOracle, ofKind } from '../oracle.mjs';
import { card, paint } from '../../tools/term.mjs';

/**
 * Blobs travel as DEFLATE + base64 split in parts. Returns `read(id) → Buffer`, indexed once: O(parts)
 * to build, O(size) per read, each blob inflated at most once.
 */
export function blobReader(entries) {
  const parts = new Map();
  for (const entry of ofKind(entries, 'blob')) {
    if (!parts.has(entry.id)) parts.set(entry.id, []);
    parts.get(entry.id)[entry.part] = entry;
  }
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const list = parts.get(id);
    assert.ok(list, `oracle has no blob "${id}"`);
    assert.equal(list.filter(Boolean).length, list[0].of, `blob "${id}" is incomplete`);
    const bytes = inflateSync(Buffer.from(list.map((part) => part.data).join(''), 'base64'));
    assert.equal(bytes.length, list[0].bytes, `blob "${id}" length`);
    cache.set(id, bytes);
    return bytes;
  };
}

/** Copies (Buffers are not aligned) little-endian bytes into a typed array. */
const copyOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
export const asFloat32 = (bytes) => new Float32Array(copyOf(bytes));
export const asFloat64 = (bytes) => new Float64Array(copyOf(bytes));
export const asInt16 = (bytes) => new Int16Array(copyOf(bytes));

/** The synthesis oracle (_oracle/probe_audio.gd), loaded once per process. */
export const audioOracle = (() => {
  let loaded = null;
  return () => {
    if (loaded === null) {
      const entries = loadOracle('audio');
      loaded = { entries, blob: blobReader(entries), one: (kind) => ofKind(entries, kind)[0], all: (kind) => ofKind(entries, kind) };
    }
    return loaded;
  };
})();

/**
 * The streams the original plays, as plain records ({ name, pcm, rate, stereo, loop }): its 24 effects
 * and its music, straight from the oracle. Each call returns fresh copies of the samples.
 */
export function originalStreams() {
  const { all, one, blob } = audioOracle();
  const streams = all('sound').map((entry) => ({ name: entry.name, pcm: asInt16(blob(entry.wav.blob)), rate: entry.wav.mix_rate, stereo: false, loop: null }));
  const music = one('music');
  streams.push({
    name: 'music',
    pcm: asInt16(blob(music.wav.blob)),
    rate: music.wav.mix_rate,
    stereo: true,
    loop: { begin: music.wav.loop_begin, end: music.wav.loop_end },
  });
  return streams;
}

/**
 * Bitwise comparison of float32 buffers. O(n).
 * @returns {{length:number, differing:number, largest:number, first:number}} `largest` is the biggest
 *   absolute difference, `first` the index of the first differing sample (−1 if none)
 */
export function compareFloat32(actual, expected) {
  const result = { length: expected.length, differing: 0, largest: 0, first: -1 };
  if (actual.length !== expected.length) {
    return { ...result, differing: Math.max(actual.length, expected.length), largest: Infinity, first: 0, lengths: [actual.length, expected.length] };
  }
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
  const b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    result.differing += 1;
    if (result.first < 0) result.first = i;
    const delta = Math.abs(actual[i] - expected[i]);
    if (delta > result.largest || Number.isNaN(delta)) result.largest = delta;
  }
  return result;
}

/** Comparison of 16-bit buffers; `largest` is in steps of the 16-bit scale. O(n). */
export function comparePcm16(actual, expected) {
  const result = { length: expected.length, differing: 0, largest: 0, first: -1 };
  if (actual.length !== expected.length) {
    return { ...result, differing: Math.max(actual.length, expected.length), largest: Infinity, first: 0, lengths: [actual.length, expected.length] };
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === expected[i]) continue;
    result.differing += 1;
    if (result.first < 0) result.first = i;
    result.largest = Math.max(result.largest, Math.abs(actual[i] - expected[i]));
  }
  return result;
}

/** Distance between two doubles in units of the last place. */
export function ulpsApart(a, b) {
  const view = new DataView(new ArrayBuffer(16));
  view.setFloat64(0, a);
  view.setFloat64(8, b);
  const distance = view.getBigInt64(0) - view.getBigInt64(8);
  return Number(distance < 0n ? -distance : distance);
}

export const count = (n) => n.toLocaleString('en-US');
const verdict = (differing) => (differing === 0 ? paint.green('identical') : paint.red(`${count(differing)} differ`));
const size = (value) => (value === 0 ? '' : paint.amber(`largest ${value < 1e-3 ? value.toExponential(2) : value}`));

/**
 * The summary card of buffer comparisons: one row per buffer — samples, float32 verdict, 16-bit verdict.
 * @param {Array<{name:string,length:number,differing:number,largest:number,pcm?:object,floatless?:boolean,note?:string}>} rows
 */
export function reportCard(title, rows, footer = '') {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((row) => row.name.length));
  const lines = rows.map((row) => [
    row.differing === 0 && (row.pcm?.differing ?? 0) === 0 ? paint.green('✓') : paint.red('✗'),
    paint.blue(row.name.padEnd(width)),
    paint.dim(`${count(row.length).padStart(9)} samples`),
    row.floatless ? '' : `float32 ${verdict(row.differing)}`,
    row.floatless ? '' : size(row.largest),
    row.pcm ? `pcm16 ${verdict(row.pcm.differing)}` : '',
    row.pcm ? size(row.pcm.largest) : '',
    row.note ? paint.dim(row.note) : '',
  ]);
  const samples = rows.reduce((sum, row) => sum + row.length, 0);
  const differing = rows.reduce((sum, row) => sum + row.differing + (row.pcm?.differing ?? 0), 0);
  const summary = `${rows.length} buffers · ${count(samples)} samples · ${differing === 0 ? paint.green('all identical') : paint.red(`${count(differing)} differing`)}`;
  card(title, lines, footer ? `${summary} · ${footer}` : summary);
}

/** A card of free rows: [mark, name, …cells]; `ok` decides the mark. */
export function listCard(title, rows, footer = '') {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((row) => row.name.length));
  card(
    title,
    rows.map((row) => [row.ok ? paint.green('✓') : paint.red('✗'), paint.blue(row.name.padEnd(width)), ...row.cells]),
    footer,
  );
}

/** Collects what is written to the console while `run` executes (the engine reports through it). */
export async function captureConsole(run) {
  const levels = ['info', 'warn', 'error'];
  const original = Object.fromEntries(levels.map((level) => [level, console[level]]));
  const lines = [];
  for (const level of levels) console[level] = (...parts) => lines.push({ level, text: parts.map(String).join(' ') });
  try {
    await run();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}
