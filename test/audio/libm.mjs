/**
 * libm — src/audio/libm.js against the original's C library (_oracle/probe_audio.gd, "libm" entries:
 * 4 000 seeded arguments per function, plus the multiples of π and the decay exponents), and its fast
 * path against its own exact evaluation.
 *
 * sin, cos, exp, log and pow must agree with the original in every bit. tan and tanh are the
 * runtime's: their agreement is measured and reported, and must stay within two units in the last
 * place — the synthesis tests prove that this never reaches a sample.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { audioOracle, asFloat64, ulpsApart, listCard, count } from './support.mjs';
import * as libm from '../../src/audio/libm.js';
import { RandomNumberGenerator } from '../../src/godot/rng.js';
import { paint } from '../../tools/term.mjs';

const { blob, one, all } = audioOracle();

/** How the probe calls each function. */
const CALLS = {
  sin: libm.sin,
  cos: libm.cos,
  tan: libm.tan,
  exp: libm.exp,
  log: (x) => libm.log(x + 0.0001),
  tanh: libm.tanh,
};
const BY_THE_RULE = new Set(['sin', 'cos', 'exp', 'log', 'pow']);
const RUNTIME_TOLERANCE_ULPS = 2;
/** Arguments of the fast-path test: enough to meet every quadrant, zero crossing and size. */
const FAST_PATH_ARGUMENTS = 60000;
const FAST_PATH_SEED = 77;

const report = [];
after(() => listCard('audio · C library vs the original', report, 'sin cos exp log pow follow the x87 rule · tan tanh are the runtime\'s'));

/** Counts the results that are not the original's; O(n). */
function compare(name, args, values, call) {
  let same = 0;
  let worst = 0;
  let firstMiss = null;
  for (let i = 0; i < args.length; i++) {
    const value = call(args[i], i);
    if (Object.is(value, values[i])) {
      same += 1;
      continue;
    }
    worst = Math.max(worst, ulpsApart(value, values[i]));
    firstMiss ??= `f(${args[i]}) = ${value}, original ${values[i]}`;
  }
  return { name, same, total: args.length, worst, firstMiss };
}

function record(result, exact) {
  report.push({
    name: result.name,
    ok: exact ? result.same === result.total : result.worst <= RUNTIME_TOLERANCE_ULPS,
    cells: [
      `${count(result.same).padStart(5)}/${count(result.total)} identical`,
      result.same === result.total ? '' : paint.amber(`worst ${result.worst} ulp`),
      exact ? '' : paint.dim("the runtime's Math"),
    ],
  });
}

for (const entry of all('libm')) {
  const name = entry.set ? `${entry.fn} (${entry.set})` : entry.fn;
  const exact = BY_THE_RULE.has(entry.fn);
  test(`${name}: ${exact ? 'every result is the original\'s' : 'within two units in the last place'}`, () => {
    const result = compare(name, asFloat64(blob(entry.args)), asFloat64(blob(entry.values)), CALLS[entry.fn]);
    record(result, exact);
    assert.equal(result.total, entry.samples);
    if (exact) assert.equal(result.same, result.total, result.firstMiss);
    else assert.ok(result.worst <= RUNTIME_TOLERANCE_ULPS, `${result.worst} ulp: ${result.firstMiss}`);
  });
}

test('sin and cos at the multiples of π: where the original\'s 66-bit π shows', () => {
  const entry = one('libm_pi');
  const args = asFloat64(blob(entry.args));
  const sine = compare('sin(k·π)', args, asFloat64(blob(entry.sin)), libm.sin);
  const cosine = compare('cos(k·π/2)', args, asFloat64(blob(entry.cos_half)), (x) => libm.cos(x * 0.5));
  record(sine, true);
  record(cosine, true);
  assert.equal(sine.same, sine.total, sine.firstMiss);
  assert.equal(cosine.same, cosine.total, cosine.firstMiss);
  // The runtime's own sine reduces with the true π: it cannot be used here.
  assert.notEqual(Math.sin(args[0]), libm.sin(args[0]));
});

test('pow: every result is the original\'s', () => {
  const entry = one('libm_pow');
  const exponents = asFloat64(blob(entry.exponents));
  const result = compare('pow', asFloat64(blob(entry.bases)), asFloat64(blob(entry.values)), (base, i) => libm.pow(base, exponents[i]));
  record(result, true);
  assert.equal(result.same, result.total, result.firstMiss);
});

test('sin and cos: the double-double path gives what exact integers give', () => {
  const rng = new RandomNumberGenerator();
  rng.seed = FAST_PATH_SEED;
  const draw = (scale) => (rng.randf() + rng.randf() / 16777216) * scale * (rng.randi() & 1 ? 1 : -1);
  const shapes = [
    () => draw(0.8),
    () => draw(7),
    () => draw(300),
    // Next to the zeros and the peaks, where the reduced argument is all rounding.
    () => (Math.round(draw(200)) || 1) * (Math.PI / 2) * (1 + (rng.randf() - 0.5) * 1e-12),
    () => draw(1e-3),
    () => draw(1e-7),
  ];
  let misses = 0;
  let firstMiss = null;
  for (let i = 0; i < FAST_PATH_ARGUMENTS; i++) {
    const x = shapes[i % shapes.length]();
    const pairs = [[libm.sin(x), libm.exact.sin(x), 'sin'], [libm.cos(x), libm.exact.cos(x), 'cos']];
    for (const [fast, exact, name] of pairs) {
      if (fast === exact) continue;
      misses += 1;
      firstMiss ??= `${name}(${x}) = ${fast}, exact ${exact}`;
    }
  }
  report.push({ name: 'fast path', ok: misses === 0, cells: [`${count(FAST_PATH_ARGUMENTS * 2 - misses)}/${count(FAST_PATH_ARGUMENTS * 2)} equal to the exact evaluation`] });
  assert.equal(misses, 0, firstMiss);
});

test('edges: zeros, signs, tiny and huge arguments, values that are not numbers', () => {
  assert.ok(Object.is(libm.sin(0), 0));
  assert.ok(Object.is(libm.sin(-0), -0));
  assert.equal(libm.cos(0), 1);
  assert.equal(libm.sin(1e-300), 1e-300);
  assert.equal(libm.sin(-3e-9), -3e-9);
  assert.equal(libm.cos(3e-9), 1);
  for (const x of [NaN, Infinity, -Infinity]) {
    assert.ok(Number.isNaN(libm.sin(x)), `sin(${x})`);
    assert.ok(Number.isNaN(libm.cos(x)), `cos(${x})`);
  }
  // Odd and even: exact symmetry.
  for (const x of [0.3, 1.7, 2.9, 44.1, 1234.5]) {
    assert.equal(libm.sin(-x), -libm.sin(x));
    assert.equal(libm.cos(-x), libm.cos(x));
  }
  // Past the fast path the exact evaluation answers (and stays a sine).
  const far = libm.sin(1e9);
  assert.ok(Math.abs(far - Math.sin(1e9)) < 1e-6 && Math.abs(far) <= 1);

  assert.equal(libm.exp(0), 1);
  assert.equal(libm.exp(-Infinity), 0);
  assert.equal(libm.exp(Infinity), Infinity);
  assert.ok(Number.isNaN(libm.exp(NaN)));
  assert.equal(libm.exp(1e-40), 1);
  assert.equal(libm.log(1), 0);
  assert.equal(libm.log(0), -Infinity);
  assert.ok(Number.isNaN(libm.log(-1)));
  assert.equal(libm.log(Infinity), Infinity);
  // Exact powers stay exact: the step pitches an octave and two octaves up rely on it.
  assert.equal(libm.pow(2, 1), 2);
  assert.equal(libm.pow(2, 2), 4);
  assert.equal(libm.pow(2, -3), 0.125);
  assert.equal(libm.pow(4, 0.5), 2);
  assert.equal(libm.pow(7.3, 0), 1);
  assert.equal(libm.pow(1, 123.4), 1);
  assert.equal(libm.pow(0, 2), 0);
  assert.ok(Number.isNaN(libm.pow(-2, 0.5)));
});
