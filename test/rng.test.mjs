/**
 * PCG32 + hash() against the original build. If any of these drift, seeded runs stop replaying.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RandomNumberGenerator, hashString } from '../src/godot/rng.js';
import { loadOracle, ofKind, doubleToHex } from './oracle.mjs';

const oracle = loadOracle('primitives');

test('hash(String) is djb2 over code points (incl. Ñ, €, astral 𝄞)', () => {
  for (const entry of [...ofKind(oracle, 'hash_string'), ...ofKind(oracle, 'hash_stringname')]) {
    assert.equal(hashString(entry.s), entry.v, `hash("${entry.s}")`);
  }
});

test('seeding and the first 16 randi()/randf() of three seed texts', () => {
  for (const entry of ofKind(oracle, 'pcg')) {
    const rng = new RandomNumberGenerator();
    rng.seed = hashString(entry.seed_text);
    assert.equal(String(rng.seed), entry.seed, 'seed round-trip');
    assert.equal(String(rng.state), entry.state0, `state after seeding ${entry.seed_text}`);
    assert.deepEqual(Array.from({ length: 16 }, () => rng.randi()), entry.randi, 'randi');
    assert.equal(String(rng.state), entry.state16);
    assert.deepEqual(Array.from({ length: 16 }, () => doubleToHex(rng.randf())), entry.randf, 'randf (float32 bits)');
    assert.equal(String(rng.state), entry.state32);
  }
});

test('small integer seeds (autopilot 7, synth 24301, block meshes)', () => {
  for (const entry of ofKind(oracle, 'pcg_small')) {
    const rng = new RandomNumberGenerator();
    rng.seed = entry.seed;
    assert.deepEqual(Array.from({ length: 6 }, () => rng.randi()), entry.randi, `randi for seed ${entry.seed}`);
    // The probe reads `state` after the six draws.
    assert.equal(String(rng.state), entry.state0, `state for seed ${entry.seed}`);
  }
});

test('restoring seed then state continues the same stream', () => {
  const [entry] = ofKind(oracle, 'pcg_restore');
  const rng = new RandomNumberGenerator();
  rng.seed = hashString('TOUR-7');
  rng.state = BigInt(entry.saved);
  assert.equal(rng.randi(), entry.b);
});

test('randi_range / randf_range / randi()%n match op by op', () => {
  const [entry] = ofKind(oracle, 'ranges');
  const rng = new RandomNumberGenerator();
  rng.seed = hashString('ranges');
  for (const op of entry.ops) {
    const m = /^(\w+)\((.*)\)(.*)$/.exec(op.op);
    if (op.op === 'randi_range(5,5)') {
      const before = rng.state;
      assert.equal(rng.randi_range(5, 5), 5);
      assert.equal(rng.state, before, 'equal bounds must not consume');
    } else if (op.op === 'final_state') {
      assert.equal(String(rng.state), op.v);
    } else if (op.op === 'randi()%6') {
      assert.deepEqual(Array.from({ length: 8 }, () => rng.randi() % 6), op.v);
    } else if (m && m[1] === 'randi_range') {
      const [a, b] = m[2].split(',').map(Number);
      assert.deepEqual(Array.from({ length: 8 }, () => rng.randi_range(a, b)), op.v, op.op);
    } else if (m && m[1] === 'randf_range') {
      const [a, b] = m[2].split(',').map(Number);
      assert.deepEqual(Array.from({ length: 6 }, () => doubleToHex(rng.randf_range(a, b))), op.v, op.op);
    } else {
      assert.fail(`unhandled op ${op.op}`);
    }
  }
});

test('edge cases: empty text hash, bounds reversed, huge stream stays in uint32', () => {
  assert.equal(hashString(''), 5381);
  const rng = new RandomNumberGenerator();
  rng.seed = 1;
  for (let i = 0; i < 100000; i++) {
    const v = rng.randi();
    assert.ok(v >= 0 && v <= 0xffffffff && Number.isInteger(v));
  }
  for (let i = 0; i < 1000; i++) {
    const v = rng.randi_range(3, -3);
    assert.ok(v >= -3 && v <= 3);
    const f = rng.randf();
    assert.ok(f >= 0 && f <= 1 && Math.fround(f) === f, 'randf is a float32');
  }
});
