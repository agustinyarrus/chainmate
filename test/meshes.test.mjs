/**
 * Procedural geometry against the original generators (oracle `_oracle/meshes.json`).
 * Positions and UVs must match bit for bit (float32), colours after Godot's 8-bit storage; normals
 * within the precision of Godot's octahedral normal compression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PieceMeshes } from '../src/presentation/piece_meshes.js';
import { MeshKit } from '../src/presentation/mesh_kit.js';
import { Vector3 } from '../src/godot/math.js';
import { loadOracle, ofKind } from './oracle.mjs';

const oracle = new Map(ofKind(loadOracle('meshes'), 'mesh').map((e) => [e.label, e]));

const floatsOf = (b64) => {
  const bytes = Buffer.from(b64, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

/** Geometry → Godot vertex order (our builder flipped each triangle's 2nd and 3rd vertex). */
function godotOrder(geometry, name) {
  const attribute = geometry.getAttribute(name);
  if (!attribute) return null;
  const size = attribute.itemSize;
  const src = attribute.array;
  if (geometry.index) return Float32Array.from(src);
  const out = new Float32Array(src.length);
  for (let t = 0; t < attribute.count; t += 3) {
    for (let k = 0; k < size; k++) {
      out[t * size + k] = src[t * size + k];
      out[(t + 1) * size + k] = src[(t + 2) * size + k];
      out[(t + 2) * size + k] = src[(t + 1) * size + k];
    }
  }
  return out;
}

/**
 * Bit-exact, except values that are zero in all but name: trig of exact right angles (cos(π/2) ≈ 6e-17)
 * comes out of V8 and of Godot's libm with different sub-1e-12 residue. Those are counted, not failed.
 */
const residue = { count: 0, worst: 0 };
function assertExact(ours, theirs, what) {
  assert.equal(ours.length, theirs.length, `${what}: length`);
  for (let i = 0; i < ours.length; i++) {
    if (ours[i] === theirs[i]) continue;
    const gap = Math.abs(ours[i] - theirs[i]);
    if (gap < 1e-12) {
      residue.count += 1;
      residue.worst = Math.max(residue.worst, gap);
      continue;
    }
    assert.fail(`${what}: first difference at float ${i} (vertex ${Math.floor(i / 3)}): ${ours[i]} vs ${theirs[i]}`);
  }
}

const ulpFlips = { count: 0 };
function assertUlp(ours, theirs, what) {
  assert.equal(ours.length, theirs.length, `${what}: length`);
  for (let i = 0; i < ours.length; i++) {
    if (ours[i] === theirs[i]) continue;
    const ulp = Math.abs(Math.fround(theirs[i] * (1 + 2 ** -23)) - theirs[i]) || 2 ** -149;
    const gap = Math.abs(ours[i] - theirs[i]);
    if (gap <= ulp * 1.01 || gap < 1e-12) {
      ulpFlips.count += 1;
      continue;
    }
    assert.fail(`${what}: first difference at float ${i}: ${ours[i]} vs ${theirs[i]}`);
  }
}

test.after(() => {
  if (ulpFlips.count) console.log(`  (uv values 1 ulp apart: ${ulpFlips.count})`);
  if (residue.count) console.log(`  (near-zero trig residue: ${residue.count} floats, worst ${residue.worst.toExponential(2)})`);
});

function assertClose(ours, theirs, tolerance, what) {
  assert.equal(ours.length, theirs.length, `${what}: length`);
  let worst = 0;
  for (let i = 0; i < ours.length; i++) worst = Math.max(worst, Math.abs(ours[i] - theirs[i]));
  assert.ok(worst <= tolerance, `${what}: worst difference ${worst}`);
}

function compare(label, geometry) {
  const want = oracle.get(label);
  assert.ok(want, `oracle has ${label}`);
  const positions = godotOrder(geometry, 'position');
  assert.equal(positions.length / 3, want.count, `${label}: vertex count`);
  assertExact(positions, floatsOf(want.positions), `${label} positions`);
  // UV.x = atan2(x, −z)/τ: the trig residue above can tip a value sitting on a float32 midpoint by 1 ulp.
  if (want.uvs) assertUlp(godotOrder(geometry, 'uv'), floatsOf(want.uvs), `${label} uvs`);
  if (want.colors) assertExact(godotOrder(geometry, 'aColor'), floatsOf(want.colors), `${label} colors`);
  if (want.normals) assertClose(godotOrder(geometry, 'normal'), floatsOf(want.normals), 2e-4, `${label} normals`);
}

for (const kind of PieceMeshes.KINDS) {
  test(`piece meshes: ${kind} tiers 0–3 identical to Godot`, () => {
    for (let tier = 0; tier <= PieceMeshes.MAX_TIER; tier++) compare(`piece:${kind}:${tier}`, PieceMeshes.get_mesh(kind, tier));
  });
}

/** Indexed geometry → Godot's index order (triangles un-flipped). */
function godotIndices(geometry) {
  const idx = geometry.index.array;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) {
    out[i] = idx[i];
    out[i + 1] = idx[i + 2];
    out[i + 2] = idx[i + 1];
  }
  return out;
}

test('arena stone kit and board tile: topology exact, noise-lumped positions within float32 noise', async () => {
  const { Arena } = await import('../src/presentation/arena.js');
  const cases = [['arena:tile', Arena.tile_mesh()]];
  for (let i = 0; i < 3; i++) cases.push([`arena:brick${i}`, Arena._kit_mesh(`brick${i}`)]);
  for (let i = 0; i < 6; i++) cases.push([`arena:cube${i}`, Arena._kit_mesh(`cube${i}`)]);
  for (const [label, geometry] of cases) {
    const want = oracle.get(label);
    const bytes = Buffer.from(want.indices, 'base64');
    assert.deepEqual(Array.from(godotIndices(geometry)), Array.from(new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)), `${label} indices`);
    // FastNoiseLite runs in float32 in Godot and double here: lumps agree to ~1e-6 m.
    assertClose(Float32Array.from(geometry.getAttribute('position').array), floatsOf(want.positions), label === 'arena:tile' ? 0 : 5e-6, `${label} positions`);
    assertExact(Float32Array.from(geometry.getAttribute('uv').array), floatsOf(want.uvs), `${label} uvs`);
    assertExact(Float32Array.from(geometry.getAttribute('aUv2').array), floatsOf(want.uv2s), `${label} uv2 (wear, chips)`);
    assertClose(Float32Array.from(geometry.getAttribute('normal').array), floatsOf(want.normals), 5e-4, `${label} normals`);
  }
});

test('MeshKit: beveled box, frame ring, move-arc ribbon', () => {
  compare('kit:beveled_box', MeshKit.beveled_box(new Vector3(0.9, 0.2, 0.7), 0.05));
  compare('kit:frame_ring', MeshKit.frame_ring(0.4, 0.5, 0.02));
  const points = [];
  for (let s = 0; s < 19; s++) {
    const t = s / 18;
    let point = new Vector3(-1.5, 0.09, 1.0).lerp(new Vector3(0.5, 0.09, -1.0), t);
    point = new Vector3(point.x, point.y + Math.sin(Math.PI * t) * 0.7, point.z);
    points.push(point);
  }
  compare('kit:ribbon', MeshKit.ribbon(points, 0.12));
});
