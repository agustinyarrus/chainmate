/**
 * Particles against the original build:
 *
 *   stream     each GPUParticles3D takes two draws of the engine-wide random stream when created
 *              (the server record, then the node) — the oracle measured it (_oracle/probe_draws.gd,
 *              with a renderer) — so the banners, flames and piece idles that draw after it stay in
 *              step with the original
 *   lifecycle  a burst made like vfx.gd's (one_shot, then emitting = true while already emitting)
 *              never announces `finished`; switching it off and on again does, with a new seed
 *              (_oracle/probe_particles.gd)
 *   motion     three systems like the game's, fixed seeds, 120 frames at 60 fps: the box of every
 *              started particle must be the one the engine read back from the GPU after each frame
 *              (_oracle/probe_particles_sim.gd, GPUParticles3D.capture_aabb)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOracle, ofKind } from './oracle.mjs';
import { SceneTree, Node } from '../src/godot/scene.js';
import { Vector3 } from '../src/godot/math.js';
import { globalRng, RandomNumberGenerator } from '../src/godot/rng.js';
import { GPUParticles3D, ParticleProcessMaterial, EMISSION_SHAPE, particleHash, randFromSeed } from '../src/godot/particles.js';

const FRAME = 1 / 60;
/** The GPU simulates in single precision, the port in double: this much drift over a second. */
const POSITION_TOLERANCE = 2e-3;

/** The n-th value of a stream seeded with `seed` (1-based). */
function nth(seed, n) {
  const rng = new RandomNumberGenerator();
  rng.seed = seed;
  let value = 0;
  for (let i = 0; i < n; i++) value = rng.randi();
  return value;
}

function material(fields) {
  const m = new ParticleProcessMaterial();
  Object.assign(m, fields);
  return m;
}

/** The three systems of probe_particles_sim.gd, built the same way. */
function systems() {
  const burst = new GPUParticles3D();
  burst.seed = 12345;
  burst.one_shot = true;
  burst.explosiveness = 0.95;
  burst.amount = 28;
  burst.lifetime = 0.8;
  burst.process_material = material({
    emission_shape: EMISSION_SHAPE.SPHERE, emission_sphere_radius: 0.15, direction: Vector3.UP, spread: 75,
    initial_velocity_min: 1.6, initial_velocity_max: 3.2, gravity: new Vector3(0, -6.5, 0), damping_min: 1.0, damping_max: 2.5, scale_min: 0.5, scale_max: 1.2,
  });
  burst.set_draw_pass(0.09, 2.4);
  const halo = new GPUParticles3D();
  halo.seed = 777;
  halo.amount = 14;
  halo.lifetime = 1.6;
  halo.process_material = material({
    emission_shape: EMISSION_SHAPE.RING, emission_ring_axis: Vector3.UP, emission_ring_radius: 0.38, emission_ring_inner_radius: 0.3, emission_ring_height: 0.05,
    direction: Vector3.UP, spread: 25, initial_velocity_min: 0.08, initial_velocity_max: 0.25, gravity: new Vector3(0, 0.05, 0), scale_min: 0.5, scale_max: 1.0,
  });
  halo.set_draw_pass(0.05, 2.4);
  const flame = new GPUParticles3D();
  flame.seed = 4242;
  flame.amount = 36;
  flame.lifetime = 0.9;
  flame.process_material = material({
    emission_shape: EMISSION_SHAPE.SPHERE, emission_sphere_radius: 0.14, direction: Vector3.UP, spread: 12,
    initial_velocity_min: 0.45, initial_velocity_max: 0.85, gravity: new Vector3(0, 0.7, 0), scale_min: 0.7, scale_max: 1.25,
  });
  flame.set_draw_pass(0.32, 2.2);
  return { burst, halo, flame };
}

/**
 * ParticlesStorage::particles_get_current_aabb: every particle with any flag left (it has started in
 * a cycle past the first, or lives), grown by the quad's size; [x, y, z, w, h, d].
 */
function currentAabb(system) {
  let min = null;
  let max = null;
  for (const p of system._particles) {
    if (p.flags === 0) continue;
    const at = [p.px, p.py, p.pz];
    if (!min) {
      min = [...at];
      max = [...at];
    } else {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], at[i]);
        max[i] = Math.max(max[i], at[i]);
      }
    }
  }
  min ??= [0, 0, 0];
  max ??= [0, 0, 0];
  const grow = system.quadSize;
  return [min[0] - grow, min[1] - grow, min[2] - grow, max[0] - min[0] + 2 * grow, max[1] - min[1] + 2 * grow, max[2] - min[2] + 2 * grow];
}

/** particles.glsl hash() with arbitrary-precision integers, reduced mod 2³² step by step. */
function hashReference(value) {
  const MOD = 1n << 32n;
  let x = BigInt(value >>> 0);
  x = (((x >> 16n) ^ x) * 0x45d9f3bn) % MOD;
  x = (((x >> 16n) ^ x) * 0x45d9f3bn) % MOD;
  return Number((x >> 16n) ^ x);
}

test('the particle hash and rand_from_seed keep 32-bit integer semantics', () => {
  for (const value of [0, 1, 2, 12346, 777 + 14, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]) {
    assert.equal(particleHash(value), hashReference(value), `hash(${value})`);
  }
  const state = { seed: 0 };
  const first = randFromSeed(state);
  assert.equal(state.seed, (16807 * 305420679) % 2147483647, 'a zero seed starts from 305420679 (Park–Miller step)');
  assert.ok(first >= 0 && first <= 1);
  for (const seed of [1, 0x7fffffff, 0x80000000, 0xffffffff, 123456789]) {
    const s = { seed };
    for (let i = 0; i < 100; i++) {
      const value = randFromSeed(s);
      assert.ok(value >= 0 && value <= 1 && Number.isFinite(value), `seed ${seed} step ${i}: ${value}`);
      assert.ok(s.seed >= 0 && s.seed <= 0xffffffff && Number.isInteger(s.seed));
    }
  }
});

test('a GPUParticles3D takes two draws of the global stream: the server record, then its seed', () => {
  const oracle = ofKind(loadOracle('draws'), 'GPUParticles3D')[0];
  assert.equal(oracle.extra.seed, nth(7, 2), 'the oracle: the seed is the second draw after seed(7)');
  assert.equal(oracle.next_after, nth(7, 3), 'the oracle: the next global draw is the third');
  globalRng.seed = 7;
  const particles = new GPUParticles3D();
  assert.equal(particles.seed, oracle.extra.seed);
  assert.equal(globalRng.randi(), oracle.next_after);
});

test("a burst made like vfx.gd's never announces finished; a real restart of the cycle does, reseeded", () => {
  const probe = loadOracle('particles');
  const burstOracle = ofKind(probe, 'burst')[0];
  const laterOracle = ofKind(probe, 'burst_later')[0];
  const restartedOracle = ofKind(probe, 'restarted')[0];
  const tree = new SceneTree();
  const host = new Node('Host');
  tree.root.add_child(host);

  const burst = new GPUParticles3D();
  const seedBefore = burst.seed;
  burst.one_shot = true;
  burst.explosiveness = 0.95;
  burst.amount = 8;
  burst.lifetime = 0.3;
  host.add_child(burst);
  burst.emitting = true;
  let finished = false;
  burst.finished.connect(() => (finished = true));
  assert.equal(burst.seed !== seedBefore, burstOracle.seed_changed);
  assert.equal(burst.emitting, burstOracle.emitting_after_set);
  for (let i = 0; i < 90; i++) {
    tree.iteration(FRAME);
    tree.preRender(FRAME);
  }
  assert.equal(finished, laterOracle.finished, 'finished');
  assert.equal(burst.emitting, laterOracle.emitting, 'emitting after the cycle');

  const again = new GPUParticles3D();
  again.one_shot = true;
  again.lifetime = 0.3;
  host.add_child(again);
  again.emitting = false;
  const before = again.seed;
  again.emitting = true;
  let finishedAgain = false;
  again.finished.connect(() => (finishedAgain = true));
  for (let i = 0; i < 90; i++) {
    tree.iteration(FRAME);
    tree.preRender(FRAME);
  }
  assert.equal(again.seed !== before, restartedOracle.seed_changed);
  assert.equal(finishedAgain, restartedOracle.finished);
});

test('three systems, fixed seeds, 120 frames: the boxes of their particles are the GPU\'s', () => {
  const frames = ofKind(loadOracle('particles_sim'), 'frame');
  assert.equal(frames.length, 120);
  const tree = new SceneTree();
  const made = systems();
  for (const system of Object.values(made)) tree.root.add_child(system);
  made.burst.emitting = true;
  let worst = { error: 0 };
  for (const row of frames) {
    tree.iteration(FRAME);
    tree.preRender(FRAME);
    for (const name of Object.keys(made)) {
      const port = currentAabb(made[name]);
      const engine = row[name];
      for (let i = 0; i < 6; i++) {
        const error = Math.abs(port[i] - engine[i]);
        if (error > worst.error) worst = { error, name, frame: row.frame, i, port: port[i], engine: engine[i] };
      }
    }
  }
  console.log(`    worst difference ${worst.error.toExponential(2)} (${worst.name ?? '-'} frame ${worst.frame ?? '-'})`);
  assert.ok(worst.error <= POSITION_TOLERANCE, `${worst.name} frame ${worst.frame} component ${worst.i}: port ${worst.port} vs engine ${worst.engine}`);
});
