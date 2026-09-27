/**
 * Relic miniatures vs the original (oracle probe `relics`): same parts in the same order, same
 * transforms relative to the model root, same meshes (primitive parameters; vertex count and bounds
 * for extruded/swept meshes) and the same material values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadOracle, ofKind } from './oracle.mjs';
import { SceneTree } from '../src/godot/scene.js';
import { MeshInstance3D } from '../src/godot/node3d.js';
import { StandardMaterial3D } from '../src/godot/render/material.js';
import { RelicModels } from '../src/presentation/relic_models.js';

const TRANSFORM_TOLERANCE = 2e-5;
const BOUNDS_TOLERANCE = 1e-4;
const oracle = loadOracle('relics');
new SceneTree();

const rel = new THREE.Matrix4();

function parts(root) {
  root.object3d.updateMatrixWorld(true);
  const inverse = root.object3d.matrixWorld.clone().invert();
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child instanceof MeshInstance3D) {
        rel.multiplyMatrices(inverse, child.object3d.matrixWorld);
        const e = rel.elements;
        out.push({ t: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]], mesh: describeMesh(child.mesh), material: describeMaterial(child.material_override) });
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}

function describeMesh(geometry) {
  const p = geometry.parameters;
  if (geometry.type === 'BoxGeometry') return { type: 'box', size: [p.width, p.height, p.depth] };
  if (geometry.type === 'CylinderGeometry') return { type: 'cylinder', top: p.radiusTop, bottom: p.radiusBottom, height: p.height, segments: p.radialSegments, rings: p.heightSegments - 1, caps: [!p.openEnded, !p.openEnded] };
  if (geometry.type === 'SphereGeometry') return { type: 'sphere', radius: p.radius, height: p.radius * 2, segments: p.widthSegments, rings: p.heightSegments - 1 };
  if (geometry.type === 'TorusGeometry') return { type: 'torus', inner: p.radius - p.tube, outer: p.radius + p.tube, rings: p.tubularSegments, ring_segments: p.radialSegments };
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return { type: 'array', vertices: geometry.getAttribute('position').count, aabb: [b.min.x, b.min.y, b.min.z, b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] };
}

function describeMaterial(material) {
  if (material instanceof StandardMaterial3D) {
    const o = material.options;
    return {
      type: 'standard',
      albedo: material.albedo_color.to_html(),
      roughness: material.roughness,
      metallic: material.metallic,
      specular: material.metallic_specular,
      transparency: o.transparency === 'alpha' ? 1 : 0,
      cull: o.cull_mode === 'disabled' ? 2 : 0,
      emission: o.emission_enabled ? (o.emission ?? { to_html: () => '000000ff' }).to_html() : '',
      unshaded: o.shading_mode === 'unshaded',
    };
  }
  return { type: 'shader', shader: `${material?.spec?.name ?? 'none'}.gdshader` };
}

const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

function comparePart(label, mine, theirs) {
  mine.t.forEach((v, i) => assert.ok(close(v, theirs.t[i], TRANSFORM_TOLERANCE), `${label} transform[${i}] ${v} vs ${theirs.t[i]}`));
  assert.equal(mine.mesh.type, theirs.mesh.type, `${label} mesh type`);
  for (const [key, value] of Object.entries(theirs.mesh)) {
    if (key === 'type') continue;
    const tolerance = key === 'aabb' ? BOUNDS_TOLERANCE : 1e-6;
    if (Array.isArray(value)) value.forEach((v, i) => assert.ok(typeof v === 'boolean' ? v === mine.mesh[key][i] : close(mine.mesh[key][i], v, tolerance), `${label} mesh.${key}[${i}] ${mine.mesh[key][i]} vs ${v}`));
    else assert.ok(close(mine.mesh[key], value, tolerance), `${label} mesh.${key} ${mine.mesh[key]} vs ${value}`);
  }
  assert.equal(mine.material.type, theirs.material.type, `${label} material type`);
  if (theirs.material.type === 'standard') {
    for (const key of ['albedo', 'emission', 'transparency', 'cull', 'unshaded']) assert.equal(mine.material[key], theirs.material[key], `${label} material.${key}`);
    for (const key of ['roughness', 'metallic', 'specular']) assert.ok(close(mine.material[key], theirs.material[key], 1e-6), `${label} material.${key}`);
  } else {
    assert.equal(mine.material.shader, theirs.material.shader, `${label} shader`);
  }
}

for (const entry of ofKind(oracle, 'relic')) {
  test(`relic ${entry.id}: ${entry.parts.length} parts match the original`, () => {
    const mine = parts(RelicModels.build(entry.id));
    assert.equal(mine.length, entry.parts.length, 'part count');
    mine.forEach((part, i) => comparePart(`${entry.id}#${i}`, part, entry.parts[i]));
  });
}

test('daises of every rarity match the original', () => {
  for (const entry of ofKind(oracle, 'dais')) {
    const mine = parts(RelicModels.dais(entry.id));
    assert.equal(mine.length, entry.parts.length);
    mine.forEach((part, i) => comparePart(`dais ${entry.id}#${i}`, part, entry.parts[i]));
  }
});
