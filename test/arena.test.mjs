/**
 * Arena layouts against the original (oracle `_oracle/arena.json`): the RNG must end in the same
 * state, and every stone, leaf, light, prop and relic spot must land where Godot put it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneTree } from '../src/godot/scene.js';
import { MultiMeshInstance3D, OmniLight3D, MeshInstance3D } from '../src/godot/node3d.js';
import { Arena } from '../src/presentation/arena.js';
import { loadOracle, ofKind } from './oracle.mjs';

const oracle = new Map(ofKind(loadOracle('arena'), 'arena').map((e) => [e.variant, e]));
const tree = new SceneTree();
const arena = new Arena();
tree.root.add_child(arena);

const TRIG_TOLERANCE = 2e-6; // basis entries go through cosf/sinf in Godot, Math.cos/sin here

function close(a, b, tolerance, what) {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) assert.fail(`${what}[${i}]: ${a[i]} vs ${b[i]}`);
  }
}

const xf = (t) => {
  const b = t.basis;
  return [b.x.x, b.x.y, b.x.z, b.y.x, b.y.y, b.y.z, b.z.x, b.z.y, b.z.z, t.origin.x, t.origin.y, t.origin.z];
};

for (const variant of Arena.VARIANTS) {
  test(`arena "${variant}": same RNG stream, stones, leaves, lights, props, relic spots`, () => {
    const want = oracle.get(variant);
    arena.set_variant(variant);
    assert.equal(String(arena._rng.state), want.rng_state, 'the layout consumed exactly the same random draws');

    const children = arena._content.children;
    const instances = children.filter((c) => c instanceof MultiMeshInstance3D);
    assert.deepEqual(instances.map((i) => `${i.label}:${i.transforms.length}`), want.instances.map((i) => `${i.label}:${i.count}`), 'instance groups');
    instances.forEach((instance, g) => {
      const wantGroup = want.instances[g];
      instance.transforms.forEach((t, i) => {
        const ours = xf(t);
        close(ours.slice(9), wantGroup.xf[i].slice(9), 0, `${instance.label} #${i} origin`);
        close(ours.slice(0, 9), wantGroup.xf[i].slice(0, 9), TRIG_TOLERANCE, `${instance.label} #${i} basis`);
        const c = instance.colors[i];
        close([c.r, c.g, c.b, c.a], wantGroup.tint[i], 0, `${instance.label} #${i} tint`);
      });
    });

    const tops = arena._tops.map((top) => [top[0].position.x, top[0].position.y, top[0].size.x, top[0].size.y, top[1]]);
    assert.equal(tops.length, want.tops.length, 'stone tops');
    tops.forEach((top, i) => close(top, want.tops[i], 0, `top ${i}`));

    assert.equal(arena._flames.length, want.flames.length, 'flickering lights');
    arena._flames.forEach((flame, i) => {
      const w = want.flames[i];
      const p = flame.light.global_position;
      close([p.x, p.y, p.z], w.pos, 1e-5, `flame ${i} position`);
      close([flame.energy, flame.speed, flame.phase, flame.flicker, flame.light.omni_range, flame.light.omni_attenuation],
        [w.energy, w.speed, w.phase, w.flicker, w.range, w.att], 1e-6, `flame ${i} params`);
    });

    const props = children.filter((c) => !(c instanceof MultiMeshInstance3D));
    assert.equal(props.length, want.props.length, 'prop roots (bed, props, glows)');
    props.forEach((prop, i) => {
      const p = prop.global_position;
      close([p.x, p.y, p.z], want.props[i].pos, 1e-5, `prop ${i} (${want.props[i].class}) position`);
      close([prop.rotation.x, prop.rotation.y, prop.rotation.z], want.props[i].rot, 1e-5, `prop ${i} rotation`);
      const expectedClass = want.props[i].class;
      if (expectedClass === 'OmniLight3D') assert.ok(prop instanceof OmniLight3D);
      if (expectedClass === 'MeshInstance3D') assert.ok(prop instanceof MeshInstance3D);
    });

    for (let i = 0; i < 6; i++) {
      const spot = arena.relic_spot(i);
      close([spot.x, spot.y, spot.z], want.relic_spots[i], 0, `relic spot ${i}`);
    }
  });
}

test('arena edge cases: unknown variant is refused; rebuilding a variant is deterministic', () => {
  assert.throws(() => arena.set_variant('swamp'), /Unknown arena variant/);
  arena.set_variant('crypt');
  const first = String(arena._rng.state);
  arena.set_variant('court');
  arena.set_variant('crypt');
  assert.equal(String(arena._rng.state), first);
  assert.throws(() => arena.relic_spot(6), /No relic slot/);
});
