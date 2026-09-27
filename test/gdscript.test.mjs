/**
 * GDScript semantics (unstable introsort, printing, formatting, string ops) against the original build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortCustom, sort, str, format, floatToString, toUpper, toLower, capitalize, stripEdges, has, erase, count, find, GDict, variantEquals, duplicate } from '../src/godot/gdscript.js';
import { RandomNumberGenerator } from '../src/godot/rng.js';
import { Vector2i } from '../src/godot/math.js';
import { loadOracle, ofKind } from './oracle.mjs';

const oracle = loadOracle('primitives');

test('sort_custom reproduces Godot introsort tie order (5, 16, 17, 40, 129 items)', () => {
  const rng = new RandomNumberGenerator();
  rng.seed = 12345;
  for (const entry of ofKind(oracle, 'sort_custom')) {
    const items = Array.from({ length: entry.n }, (_, i) => ({ id: i, key: rng.randi_range(0, 4) }));
    sortCustom(items, (a, b) => a.key < b.key);
    assert.deepEqual(items.map((d) => d.id), entry.ids, `n = ${entry.n}`);
  }
});

test('Array.sort(): numbers mixed int/float, strings by code point', () => {
  const [numbers] = ofKind(oracle, 'sort_numbers');
  assert.deepEqual(sort([3, 1.5, -2, 10, 0, 7.25, 3, -2.5, 99, 4, 4, 1, 12, 8, 6, 5, 2, 11, 13]), numbers.v);
  const [words] = ofKind(oracle, 'sort_strings');
  assert.deepEqual(sort(['pawn', 'Queen', 'knight', 'bishop', 'Ñ', 'rook', 'king', 'a', 'B', 'zeta', 'éclair']), words.v);
});

test('str(float) and "%" formatting print exactly like Godot', () => {
  const [floats] = ofKind(oracle, 'float_text');
  const inputs = [0.1, 1.0, 2.0 / 3.0, 1e20, -0.0, 123456.789, 0.25, 1.5e-7, 100.0];
  floats.v.forEach((expected, i) => {
    const x = inputs[i];
    assert.equal(floatToString(x), expected.str, `str(${x})`);
    assert.equal(format('%.2f', x), expected.fmt_2f, `%.2f ${x}`);
    if (Math.abs(x) < 1e15) assert.equal(format('%d', x), expected.fmt_d, `%d ${x}`);
  });
  const [ints] = ofKind(oracle, 'int_text');
  const ours = [format('%02d', 5), format('%+d', 5), format('%+d', -5), format('%5d|', 42), format('%-5d|', 42), format('%x', 255),
    format('%.1f', 2.25), format('%.1f', 2.35), format('%.0f', 2.5), format('%.0f', 3.5), format('%c', 65), format('%s|%s', ['a', 1])];
  assert.deepEqual(ours, ints.v);
});

test('string operations: to_upper keeps ß, capitalize splits camel/snake/digits', () => {
  const [ops] = ofKind(oracle, 'string_ops');
  const ours = [toUpper(stripEdges(' tour-7 ')), toUpper('straße'), capitalize('hello_world'), capitalize('HTTPRequest'),
    capitalize('piece2go'), toLower('ABC'), 'a,b,,c'.split(','), 'x'.repeat(3)];
  assert.deepEqual(ours, ops.v);
});

test('Variant equality in has/find/erase/count; dictionary order with non-string keys', () => {
  const cells = [new Vector2i(1, 2), new Vector2i(3, 4), new Vector2i(1, 2)];
  assert.equal(has(cells, new Vector2i(3, 4)), true);
  assert.equal(find(cells, new Vector2i(1, 2)), 0);
  assert.equal(count(cells, new Vector2i(1, 2)), 2);
  erase(cells, new Vector2i(1, 2));
  assert.deepEqual(cells.map(String), ['(3, 4)', '(1, 2)'], 'erase removes the first match only');
  assert.equal(variantEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(variantEquals({ a: 1 }, { a: 1, b: 2 }), false);
  const dict = new GDict();
  dict.set(10, 'ten');
  dict.set(2, 'two');
  dict.set(new Vector2i(0, 1), 'cell');
  assert.deepEqual(dict.values(), ['ten', 'two', 'cell'], 'insertion order, not numeric order');
  assert.equal(dict.get(new Vector2i(0, 1)), 'cell', 'value-keyed lookup');
  const deep = duplicate({ list: [1, [2]] }, true);
  assert.notEqual(deep.list[1], [2]);
  assert.equal(str([1, 'a', 2.5]), '[1, "a", 2.5]');
});

test('edge cases: empty and single-item sorts, 1000 random items stay sorted', () => {
  assert.deepEqual(sortCustom([], (a, b) => a < b), []);
  assert.deepEqual(sortCustom([7], (a, b) => a < b), [7]);
  const rng = new RandomNumberGenerator();
  rng.seed = 99;
  const big = Array.from({ length: 1000 }, () => rng.randi_range(-500, 500));
  const sorted = sortCustom(big.slice(), (a, b) => a < b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1] <= sorted[i]);
  // Degenerate comparator input: all equal keys must not throw or lose items.
  assert.equal(sortCustom(Array(300).fill(1), (a, b) => a < b).length, 300);
});
