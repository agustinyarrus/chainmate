/**
 * GDScript's GLOBAL random functions against the original build (_oracle/probe_global_random.gd).
 *
 * They are Math::…, not RandomNumberGenerator's methods: randf() takes one word of the stream (a
 * generator's randf takes two), randf_range() goes through the three-word randd() in double
 * precision. Each sequence starts from seed(7) and is followed by one randi(): that word proves how
 * many the calls consumed — the count that keeps banners, flames, piece idles, particle seeds and
 * shard flights in step with the original.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOracle, ofKind, hexToDouble } from './oracle.mjs';
import { globalRng, randf, randi, randf_range, randi_range } from '../src/godot/rng.js';

const oracle = ofKind(loadOracle('global_random'), 'global')[0];
const SEED = 7;

/** Runs `draw` from a freshly seeded global stream; returns its results and the next word. */
function fromSeed(draw) {
  globalRng.seed = SEED;
  const values = draw();
  return { values, next: randi() };
}

test('the global stream: seed(7) then randi() gives the engine\'s raw words', () => {
  const { values } = fromSeed(() => oracle.words.map(() => randi()));
  assert.deepEqual(values, oracle.words);
});

test('randf() is Math::randf: one word each, (float)rand() / (float)UINT32_MAX', () => {
  const { values, next } = fromSeed(() => oracle.randf.map(() => randf()));
  values.forEach((value, i) => assert.equal(value, hexToDouble(oracle.randf[i]), `randf #${i}`));
  assert.equal(next, oracle.after_randf, `${oracle.randf.length} calls take ${oracle.randf.length} words`);
  assert.equal(oracle.after_randf, oracle.words[oracle.randf.length]);
});

test('randf_range() is Math::random(double, double): randd() in three words, in double precision', () => {
  const { values, next } = fromSeed(() => oracle.ranges.map(([from, to]) => randf_range(from, to)));
  values.forEach((value, i) => assert.equal(value, hexToDouble(oracle.randf_range[i]), `randf_range(${oracle.ranges[i]})`));
  assert.equal(next, oracle.after_ranges, 'three words per call, equal bounds included');
  assert.equal(oracle.after_ranges, oracle.words[3 * oracle.ranges.length]);
});

test('randi_range() is Math::random(int, int): bounded draws, equal bounds take nothing', () => {
  const { values, next } = fromSeed(() => oracle.int_ranges.map(([from, to]) => randi_range(from, to)));
  assert.deepEqual(values, oracle.randi_range);
  assert.equal(next, oracle.after_ints);
});

test('the shapes the game writes: randf() × 10 (piece idles), randf() × 20 (flame seeds)', () => {
  const { values } = fromSeed(() => [randf() * 10.0, randf() * 20.0]);
  assert.equal(values[0], hexToDouble(oracle.scaled[0]));
  assert.equal(values[1], hexToDouble(oracle.scaled[1]));
});
