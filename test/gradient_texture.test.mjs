/**
 * GradientTexture2D against the original build, byte for byte (_oracle/probe_gradient_texture.gd):
 * the menu's side gradient, a three-point gradient through every fill × repeat mode, and the
 * degenerate textures (one texel, fill_from == fill_to). The bake runs in single precision and
 * rounds each channel like Color::get_r8 — a double-precision bake gets 16 bytes of the side gradient
 * one step wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOracle, ofKind } from './oracle.mjs';
import { Color } from '../src/godot/math.js';
import { Gradient } from '../src/godot/particles.js';
import { gradientTexture2D, GRADIENT_FILL, GRADIENT_REPEAT } from '../src/godot/ui/widgets.js';

const FILLS = { linear: GRADIENT_FILL.LINEAR, radial: GRADIENT_FILL.RADIAL, square: GRADIENT_FILL.SQUARE, conic: GRADIENT_FILL.CONIC };
const REPEATS = { none: GRADIENT_REPEAT.NONE, repeat: GRADIENT_REPEAT.REPEAT, mirror: GRADIENT_REPEAT.MIRROR };

/** The probe's gradients, built through the port's API in the same order. */
const GRADIENTS = {
  side() {
    const gradient = new Gradient();
    gradient.set_color(0, new Color(0.03, 0.045, 0.07, 0.94));
    gradient.set_color(1, new Color(0.03, 0.045, 0.07, 0.0));
    return gradient;
  },
  three() {
    const gradient = new Gradient();
    gradient.set_color(0, new Color(1.0, 0.95, 0.7, 1.0));
    gradient.add_point(0.4, new Color(1.0, 0.45, 0.12, 0.7));
    gradient.set_color(2, new Color(0.3, 0.05, 0.02, 0.0));
    return gradient;
  },
};

const hexBytes = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));

/** Byte-wise comparison: how many differ, by how much at most, and where the first one is. O(n). */
function compare(port, engine, width) {
  let differing = 0;
  let worst = 0;
  let first = null;
  for (let i = 0; i < engine.length; i++) {
    const delta = Math.abs(port[i] - engine[i]);
    if (delta === 0) continue;
    differing += 1;
    worst = Math.max(worst, delta);
    const texel = i >> 2;
    first ??= { x: texel % width, y: Math.floor(texel / width), channel: 'rgba'[i & 3], port: port[i], engine: engine[i] };
  }
  return { differing, worst, first };
}

const cases = ofKind(loadOracle('gradient_texture'), 'texture');

test('the probe covers the side gradient, every fill × repeat and the degenerate textures', () => {
  assert.equal(cases.length, 1 + 4 * 3 + 3);
  for (const entry of cases) assert.ok(entry.format, `${entry.name}: the engine baked RGBA8`);
});

for (const entry of cases) {
  test(`GradientTexture2D ${entry.name} (${entry.width}×${entry.height}, ${entry.fill}, ${entry.repeat}) is the engine's, byte for byte`, () => {
    const gradient = entry.name === 'side' ? GRADIENTS.side() : GRADIENTS.three();
    const texture = gradientTexture2D(gradient, {
      width: entry.width,
      height: entry.height,
      fillFrom: { x: entry.from[0], y: entry.from[1] },
      fillTo: { x: entry.to[0], y: entry.to[1] },
      fill: FILLS[entry.fill],
      repeat: REPEATS[entry.repeat],
    });
    const engine = hexBytes(entry.data);
    assert.equal(texture.pixels.length, engine.length);
    const { differing, worst, first } = compare(texture.pixels, engine, entry.width);
    assert.equal(differing, 0, `${differing} bytes differ (worst ${worst}); first at ${JSON.stringify(first)}`);
  });
}

test('gradient sampling: exact hits, the ends, beyond the ends and an empty gradient', () => {
  const gradient = GRADIENTS.three();
  assert.deepEqual(gradient.get_color_at_offset(0.4), new Color(1.0, 0.45, 0.12, 0.7), 'an exact hit is the point itself');
  assert.deepEqual(gradient.get_color_at_offset(-3), new Color(1.0, 0.95, 0.7, 1.0), 'before the first point: its colour');
  assert.deepEqual(gradient.get_color_at_offset(7), new Color(0.3, 0.05, 0.02, 0.0), 'after the last point: its colour');
  const empty = new Gradient();
  empty.points.length = 0;
  assert.deepEqual(empty.get_color_at_offset(0.5), new Color(0, 0, 0, 1), 'no points: opaque black, like the engine');
  const single = new Gradient();
  single.points.length = 1;
  assert.deepEqual(single.get_color_at_offset(0.5), single.points[0].color, 'one point: its colour everywhere');
});
