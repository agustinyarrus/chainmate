/**
 * Float32 vector/colour arithmetic and GDScript scalar helpers against the original build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Vector3, Basis, Color, fposmod, posmod, round, idiv, snappedf, lerpf, ease, smoothstep, deg_to_rad,
  linear_to_db, db_to_linear, Rect2, Vector2, Quaternion,
} from '../src/godot/math.js';
import { loadOracle, ofKind, doubleToHex } from './oracle.mjs';

const oracle = loadOracle('primitives');

test('Vector3 / Basis / Color single precision matches Godot bit for bit', () => {
  const [entry] = ofKind(oracle, 'vec32');
  const v = new Vector3(0.1, 0.2, 0.3);
  const w = v.mul(1.55).add(new Vector3(0.7, -0.3, 0.05));
  const n = w.normalized();
  const rotated = Basis.from_axis_angle(Vector3.UP, 0.42).xform(new Vector3(1, 2, 3));
  const look = Basis.looking_at(new Vector3(0.78, -0.56, 0.3).normalized(), Vector3.UP);
  const ours = [
    v.x, w.x, w.y, n.x, n.z, rotated.x, rotated.z, look.x.x, look.z.y,
    new Color('d9c39f').r, new Color('d9c39f').srgb_to_linear().r,
    new Color(0.2, 0.4, 0.6).lightened(0.3).g, new Color(0.2, 0.4, 0.6).darkened(0.35).b,
  ].map(doubleToHex);
  const labels = ['v.x', 'w.x', 'w.y', 'n.x', 'n.z', 'rot.x', 'rot.z', 'look.x.x', 'look.z.y', 'html.r', 'linear.r', 'lightened', 'darkened'];
  ours.forEach((hex, i) => assert.equal(hex, entry.v[i], labels[i]));
});

test('GDScript scalar semantics: rounding, integer division, modulo, easing', () => {
  const [entry] = ofKind(oracle, 'math');
  const v = entry.v;
  assert.equal(doubleToHex(fposmod(-1.25, 1.0)), v[0]);
  assert.equal(doubleToHex(fposmod(Math.sin((3 * 13 + 2 * 7) * 12.9898) * 43758.5453, 1.0)), v[1], 'tile variation hash');
  assert.equal(round(2.5), v[2]);
  assert.equal(round(-2.5), v[3]);
  assert.equal(round(-0.5), v[4]);
  assert.equal(Math.trunc(-3.7), v[5]);
  assert.equal(idiv(-7, 2), v[6]);
  assert.equal(-7 % 3, v[7]);
  assert.equal(posmod(-7, 3), v[8]);
  assert.equal(snappedf(1.26, 0.05), v[9]);
  assert.equal(doubleToHex(lerpf(0.1, 0.9, 0.3)), v[10]);
  assert.equal(doubleToHex(ease(0.3, -2.0)), v[11]);
  assert.equal(doubleToHex(smoothstep(0.2, 0.8, 0.5)), v[12]);
  assert.equal(doubleToHex(deg_to_rad(34)), v[13]);
  assert.equal(doubleToHex(linear_to_db(0.8)), v[14]);
  assert.equal(doubleToHex(db_to_linear(-6.0)), v[15]);
  assert.equal(doubleToHex(Math.exp(-0.1 * 6.0)), v[16]);
  assert.equal(doubleToHex(Math.tan(deg_to_rad(34) * 0.5)), v[17]);
});

test('edge cases: zero-length normalize, Rect2 half-open bounds, shortest arc of opposite vectors', () => {
  assert.deepEqual([Vector3.ZERO.normalized().x, Vector3.ZERO.normalized().y], [0, 0]);
  const rect = Rect2.of(0, 0, 1, 1);
  assert.equal(rect.has_point(new Vector2(0, 0)), true);
  assert.equal(rect.has_point(new Vector2(1, 0.5)), false, 'right edge is exclusive');
  assert.equal(rect.grow(0.1).has_point(new Vector2(1.05, 0.5)), true);
  const flip = Quaternion.from_arc(Vector3.UP, Vector3.DOWN);
  assert.deepEqual([flip.x, flip.y, flip.z, flip.w], [0, 1, 0, 0]);
  assert.equal(new Color('#ff000080').a, Math.fround(128 / 255));
  assert.equal(new Color(new Color(1, 0, 0), 0.5).a, 0.5);
});
