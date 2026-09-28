/**
 * GPUParticles3D + ParticleProcessMaterial — Godot 4.7's particle systems, simulated on the CPU exactly
 * the way the engine's compute shader runs them (the game never has more than a few dozen sparks
 * alive, so the CPU is the cheaper place — and the look stays identical on GPUs without compute).
 *
 * Reproduced from the engine's sources (gpu_particles_3d.cpp, particles_storage.cpp, particles.glsl,
 * particles_copy.glsl, particle_process_material.cpp):
 *
 *   randomness  every system draws from the ENGINE-WIDE random stream when created (twice: the
 *               server record, then the node) and when a one-shot cycle or a restart begins; each
 *               particle then draws its numbers from `hash(number + 1 + seed)` with the shader's
 *               Park–Miller generator, in the generated shader's order — so the same seed gives the
 *               same sparks, and the rest of the game's randomness stays in step with the original
 *   stepping    fixed 30 Hz steps in single precision, one step at once when a system is (re)started,
 *               only in frames that find the system's visibility AABB inside the camera's frustum;
 *               a system that stopped emitting sleeps 1.2 lifetimes later
 *   emission    particle i restarts when the phase crosses i/amount · (1 − explosiveness), living only
 *               the part of the step after that moment; the cycle it started in numbers it
 *   motion      gravity, damping as speed lost, the move by the new velocity
 *   drawing     the last step's position moved on by velocity × the time no step has covered yet
 *               (no interpolation between steps, as particles_copy.glsl); scale curve and colour
 *               ramp read from the textures the engine bakes them into (CurveTexture: 256 floats of
 *               the curve's 100-point bake; GradientTexture1D: 256 8-bit texels), filtered linearly
 *
 * Only what the game uses is ported: point, sphere and ring shapes, no turbulence, attractors,
 * collisions, sub-emitters or trails. Cost: O(amount) per step, no allocation per frame.
 */
import * as THREE from 'three';
import { AABB, Color, F, Vector3, colorByte } from './math.js';
import { Node3D } from './node3d.js';
import { SceneTree } from './scene.js';
import { Signal } from './signal.js';
import { SpatialMaterial } from './render/material.js';
import { globalRng } from './rng.js';
import { gpuDivide } from './gpu_reciprocal.js';

export const EMISSION_SHAPE = Object.freeze({ POINT: 0, SPHERE: 1, RING: 6 });

/** GPUParticles3D.fixed_fps default. */
const FIXED_FPS = 30;
/** particles_storage: "avoid recursive stalls if fps goes below 10". */
const MAX_FRAME_DELTA = 0.1;
const DEG_TO_RAD = Math.PI / 180;
const CMP_EPSILON = 0.00001;
/** GradientTexture1D.width and CurveTexture.width defaults. */
const RAMP_TEXTURE_WIDTH = 256;
/** Curve.bake_resolution default. */
const CURVE_BAKE_RESOLUTION = 100;
/** The hardware places a filtered sample in 1/256 texel steps (8 fractional bits). */
const SUBTEXEL_STEPS = 256;
const RGBA = 4;

// ───────────────────────────────────────────────────────────────────── Gradient / Curve ─────────

/**
 * Gradient: points kept sorted by offset (single precision, like the engine's `float`), linear
 * interpolation of raw values (interpolation_color_space sRGB). The engine sorts lazily with an
 * unstable introsort; the game's offsets are distinct, so a stable sort on insertion orders them alike.
 */
export class Gradient {
  constructor() {
    this.points = [
      { offset: 0, color: new Color(0, 0, 0, 1) },
      { offset: 1, color: new Color(1, 1, 1, 1) },
    ];
    this._baked = null;
  }

  get_point_count() { return this.points.length; }

  set_color(index, color) {
    this.points[index].color = color;
    this._baked = null;
  }

  add_point(offset, color) {
    this.points.push({ offset: F(offset), color });
    this.points.sort((a, b) => a.offset - b.offset);
    this._baked = null;
  }

  /**
   * Gradient::get_color_at_offset in single precision, with the engine's binary search (so an exact
   * hit among repeated offsets returns the same point): an exact hit returns the point's colour, else
   * the two points around the offset blend linearly. O(log points).
   */
  get_color_at_offset(offset) {
    const p = this.points;
    if (p.length === 0) return new Color(0, 0, 0, 1);
    const at = F(offset);
    let low = 0;
    let high = p.length - 1;
    let middle = 0;
    while (low <= high) {
      middle = (low + high) >> 1;
      if (p[middle].offset > at) high = middle - 1;
      else if (p[middle].offset < at) low = middle + 1;
      else return p[middle].color;
    }
    if (p[middle].offset > at) middle -= 1;
    if (middle + 1 >= p.length) return p[p.length - 1].color;
    if (middle < 0) return p[0].color;
    const a = p[middle];
    const b = p[middle + 1];
    const weight = F(F(at - a.offset) / F(b.offset - a.offset));
    const lerp = (x, y) => F(x + F(F(y - x) * weight));
    return new Color(lerp(a.color.r, b.color.r), lerp(a.color.g, b.color.g), lerp(a.color.b, b.color.b), lerp(a.color.a, b.color.a));
  }

  /** GradientTexture1D (LDR): texel i is the gradient at i / (width − 1), each channel Color::get_r8 (rounded). */
  bake() {
    if (this._baked) return this._baked;
    const texels = new Float32Array(RAMP_TEXTURE_WIDTH * RGBA);
    for (let i = 0; i < RAMP_TEXTURE_WIDTH; i++) {
      const c = this.get_color_at_offset(F(i / (RAMP_TEXTURE_WIDTH - 1)));
      texels[i * RGBA] = colorByte(c.r) / 255;
      texels[i * RGBA + 1] = colorByte(c.g) / 255;
      texels[i * RGBA + 2] = colorByte(c.b) / 255;
      texels[i * RGBA + 3] = colorByte(c.a) / 255;
    }
    this._baked = texels;
    return texels;
  }
}

/**
 * Curve: `add_point(Vector2)` gives flat tangents and Godot evaluates each segment as a cubic Bézier
 * with control points a third of the span in (Curve::sample_local_nocheck) — with zero tangents that is
 * `a + (b − a)·(3u² − 2u³)`, not a straight line. Textures read its 100-point bake instead.
 */
export class Curve {
  constructor() {
    this.points = [];
    this._bakedCache = null;
    this._texture = null;
  }

  add_point(position, leftTangent = 0, rightTangent = 0) {
    this.points.push({ x: position.x, y: position.y, left: leftTangent, right: rightTangent });
    this.points.sort((a, b) => a.x - b.x);
    this._bakedCache = null;
    this._texture = null;
  }

  sample(t) {
    const p = this.points;
    if (p.length === 0) return 0;
    if (t <= p[0].x) return p[0].y;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (t > b.x) continue;
      const d = b.x - a.x;
      if (Math.abs(d) < CMP_EPSILON) return b.y;
      const u = (t - a.x) / d;
      const yac = a.y + (d / 3) * a.right;
      const ybc = b.y - (d / 3) * b.left;
      const omt = 1 - u; // Math::bezier_interpolate(start, control_1, control_2, end, u)
      return a.y * omt * omt * omt + yac * 3 * omt * omt * u + ybc * 3 * omt * u * u + b.y * u * u * u;
    }
    return p[p.length - 1].y;
  }

  /** Curve::_bake: the ends are the end points, the rest sampled evenly over the domain [0, 1]. */
  _bake() {
    const cache = new Float32Array(CURVE_BAKE_RESOLUTION);
    for (let i = 1; i < CURVE_BAKE_RESOLUTION - 1; i++) cache[i] = this.sample(F(i / (CURVE_BAKE_RESOLUTION - 1)));
    if (this.points.length) {
      cache[0] = this.points[0].y;
      cache[CURVE_BAKE_RESOLUTION - 1] = this.points[this.points.length - 1].y;
    }
    this._bakedCache = cache;
  }

  /** Curve::sample_baked: linear between the two baked samples around the offset. O(1). */
  sample_baked(offset) {
    if (!this._bakedCache) this._bake();
    const cache = this._bakedCache;
    let fi = F(F(offset) * (cache.length - 1));
    let i = Math.floor(fi);
    if (i < 0) {
      i = 0;
      fi = 0;
    } else if (i >= cache.length) {
      i = cache.length - 1;
      fi = 0;
    }
    if (i + 1 >= cache.length) return cache[cache.length - 1];
    const t = F(fi - i);
    return F(cache[i] + F(F(cache[i + 1] - cache[i]) * t));
  }

  /** CurveTexture (width 256): texel i is sample_baked(i / width). */
  bake() {
    if (this._texture) return this._texture;
    const texels = new Float32Array(RAMP_TEXTURE_WIDTH);
    for (let i = 0; i < RAMP_TEXTURE_WIDTH; i++) texels[i] = this.sample_baked(F(i / RAMP_TEXTURE_WIDTH));
    this._texture = texels;
    return texels;
  }
}

/**
 * A texture one texel tall read with linear filtering and clamp-to-edge, as the shader's
 * `texture(ramp, vec2(u))` is: the sample lands on a 1/256 texel grid, then the two texels around it
 * blend. `out` receives `channels` values. O(channels).
 */
function sampleRow(texels, channels, u, out) {
  const x = F(u * RAMP_TEXTURE_WIDTH - 0.5);
  const snapped = Math.floor(x * SUBTEXEL_STEPS + 0.5) / SUBTEXEL_STEPS;
  const first = Math.floor(snapped);
  const weight = snapped - first;
  const a = Math.min(Math.max(first, 0), RAMP_TEXTURE_WIDTH - 1) * channels;
  const b = Math.min(Math.max(first + 1, 0), RAMP_TEXTURE_WIDTH - 1) * channels;
  for (let c = 0; c < channels; c++) out[c] = texels[a + c] + (texels[b + c] - texels[a + c]) * weight;
  return out;
}

export class ParticleProcessMaterial {
  constructor() {
    // The engine's defaults for everything the port reads.
    this.emission_shape = EMISSION_SHAPE.POINT;
    this.emission_sphere_radius = 1.0;
    this.emission_ring_axis = { x: 0, y: 0, z: 1 };
    this.emission_ring_radius = 1.0;
    this.emission_ring_inner_radius = 0.0;
    this.emission_ring_height = 1.0;
    this.emission_ring_cone_angle = 90.0;
    this.direction = { x: 1, y: 0, z: 0 };
    this.spread = 45.0;
    this.initial_velocity_min = 0;
    this.initial_velocity_max = 0;
    this.angle_min = 0;
    this.angle_max = 0;
    this.angular_velocity_min = 0;
    this.angular_velocity_max = 0;
    this.linear_accel_min = 0;
    this.linear_accel_max = 0;
    this.radial_accel_min = 0;
    this.radial_accel_max = 0;
    this.tangential_accel_min = 0;
    this.tangential_accel_max = 0;
    this.gravity = { x: 0, y: -9.8, z: 0 };
    this.damping_min = 0;
    this.damping_max = 0;
    this.scale_min = 1;
    this.scale_max = 1;
    this.lifetime_randomness = 0;
    /** @type {Curve|null} the scale curve (a CurveTexture in the engine) */
    this.scale_curve = null;
    /** @type {Gradient|null} the colour ramp (a GradientTexture1D in the engine) */
    this.color_ramp = null;
  }

  /** texture(scale_curve, vec2(lifetime)).r, or 1 without a curve. */
  scaleCurve(lifetime, out) {
    if (!this.scale_curve) {
      out[0] = 1;
      return out;
    }
    return sampleRow(this.scale_curve.bake(), 1, lifetime, out);
  }

  /** color_value (white) × texture(color_ramp, vec2(lifetime)). */
  rampColor(lifetime, out) {
    if (!this.color_ramp) return out.fill(1);
    return sampleRow(this.color_ramp.bake(), RGBA, lifetime, out);
  }
}

// ───────────────────────────────────────────────────────────────────── spark material ───────────

/**
 * Vfx.spark_material(energy): StandardMaterial3D, unshaded, alpha + additive, BILLBOARD_PARTICLES,
 * vertex colour as albedo, albedo texture = Vfx.dot_texture() (32×32, alpha (1 − d)^1.8, bilinear — here
 * analytic: at UV u the texel distance is |2u − 1|·32/31), albedo Color(energy, energy, energy) which
 * Godot linearises as a source colour (2.4 → ≈ 7.6).
 */
const SPARK_SHADER = {
  name: 'spark',
  renderMode: { unshaded: true, blend: 'add', depthDraw: 'never', cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    albedo_color: { type: 'vec4', value: new Color(1, 1, 1, 1), source: true },
  },
  vertex: /* glsl */ `
	// BILLBOARD_PARTICLES: the quad faces the camera and keeps the particle's scale.
	float s = length(MODEL_MATRIX[0].xyz);
	vec4 view_centre = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	MODELVIEW_MATRIX = mat4(vec4(s, 0.0, 0.0, 0.0), vec4(0.0, s, 0.0, 0.0), vec4(0.0, 0.0, s, 0.0), view_centre);`,
  fragment: /* glsl */ `
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p) * (32.0 / 31.0);
	float dot_alpha = pow(clamp(1.0 - d, 0.0, 1.0), 1.8);
	ALBEDO = albedo_color.rgb * COLOR.rgb;
	ALPHA = albedo_color.a * COLOR.a * dot_alpha;`,
};

const sparkMaterials = new Map();
/** Shared per energy, like vfx.gd's static cache. */
export function sparkMaterial(energy = 1.6) {
  let material = sparkMaterials.get(energy);
  if (!material) {
    material = new SpatialMaterial(SPARK_SHADER, { albedo_color: new Color(energy, energy, energy, 1.0) });
    sparkMaterials.set(energy, material);
  }
  return material;
}

let unitQuad = null;
/** One unit quad for every emitter (the QuadMesh size is folded into each instance's scale). */
function sharedQuad() {
  unitQuad ??= new THREE.PlaneGeometry(1, 1);
  return unitQuad;
}

// ───────────────────────────────────────────────────────────────────── the emitter ──────────────

const tmpMatrix = new THREE.Matrix4();
const tmpBox = new THREE.Box3();
const tmpColor = [0, 0, 0, 0];
const tmpScale = [0];

/** particles.glsl PARTICLE_FLAG_* and the bits the cycle of a restart is kept in. */
const PARTICLE_FLAG_ACTIVE = 1;
const PARTICLE_FLAG_STARTED = 2;
const PARTICLE_FRAME_SHIFT = 16;
const PARTICLE_FRAME_MASK = 0xffff;
/** calculate_initial_display_params / process(): a scale never goes below this. */
const SCALE_MINIMUM = 0.001;
/** ParticlesStorage: a system that stopped emitting sleeps after this many lifetimes. */
const INACTIVE_AFTER_LIFETIMES = 1.2;

/** particles.glsl hash(): integer mixing of a 32-bit value. O(1). */
export function particleHash(value) {
  let x = value >>> 0;
  x = Math.imul(((x >>> 16) ^ x) >>> 0, 0x45d9f3b) >>> 0;
  x = Math.imul(((x >>> 16) ^ x) >>> 0, 0x45d9f3b) >>> 0;
  return ((x >>> 16) ^ x) >>> 0;
}

/**
 * ParticleProcessMaterial rand_from_seed(): Park–Miller's minimal standard by Schrage's method on a
 * signed 32-bit state, as the GPU runs it (wrapping multiplies, division toward zero). `state.seed`
 * advances; the result is (seed mod 65536) / 65535 in single precision. O(1).
 */
export function randFromSeed(state) {
  let s = state.seed | 0;
  if (s === 0) s = 305420679;
  const k = (s / 127773) | 0;
  s = (Math.imul(16807, (s - Math.imul(k, 127773)) | 0) - Math.imul(2836, k)) | 0;
  if (s < 0) s = (s + 2147483647) | 0;
  state.seed = s >>> 0;
  return F(state.seed % 65536 / 65535);
}

/** GLSL mix(a, b, t). */
const mix = (a, b, t) => a + (b - a) * t;

/**
 * The per-particle numbers ParticleProcessMaterial draws in start() and again in process(): the same
 * hash seeds both, so they agree; kept from the start. The order of the draws is the generated
 * shader's (DO NOT REORDER, says the engine): display, dynamics, physical, then the amount check.
 */
class ParticleParams {
  constructor() {
    this.scale = 1;
    this.lifetime = 1;
    this.angle = 0;
    this.angularVelocity = 0;
    this.velocityMultiplier = 0;
    this.linearAccel = 0;
    this.radialAccel = 0;
    this.tangentAccel = 0;
    this.damping = 0;
  }

  /** calculate_initial_display_params, _dynamics_params and _physical_params. */
  draw(m, rng) {
    // Display.
    const scale = mix(m.scale_min, m.scale_max, randFromSeed(rng));
    this.scale = Math.sign(scale) * Math.max(Math.abs(scale), SCALE_MINIMUM);
    randFromSeed(rng); // hue_rotation (hue_variation 0‥0)
    randFromSeed(rng); // animation_speed
    randFromSeed(rng); // animation_offset
    this.lifetime = 1.0 - m.lifetime_randomness * randFromSeed(rng);
    // Dynamics.
    this.angle = mix(m.angle_min, m.angle_max, randFromSeed(rng));
    this.angularVelocity = mix(m.angular_velocity_min, m.angular_velocity_max, randFromSeed(rng));
    this.velocityMultiplier = mix(m.initial_velocity_min, m.initial_velocity_max, randFromSeed(rng));
    randFromSeed(rng); // directional_velocity
    randFromSeed(rng); // radial_velocity
    randFromSeed(rng); // orbit_velocity
    // Physical.
    this.linearAccel = mix(m.linear_accel_min, m.linear_accel_max, randFromSeed(rng));
    this.radialAccel = mix(m.radial_accel_min, m.radial_accel_max, randFromSeed(rng));
    this.tangentAccel = mix(m.tangential_accel_min, m.tangential_accel_max, randFromSeed(rng));
    this.damping = mix(m.damping_min, m.damping_max, randFromSeed(rng));
  }
}

/** One particle of the buffer: particles.glsl ParticleData, flat numbers (no allocation per step). */
class Particle {
  constructor() {
    this.flags = 0;
    /** CUSTOM.y: elapsed fraction of the emitter's lifetime; CUSTOM.w: where it ends. */
    this.age = 0;
    this.end = 1;
    this.px = 0; this.py = 0; this.pz = 0;
    /** USERDATA1.xyz: the accumulated velocity; VELOCITY: what this step moved it by. */
    this.ux = 0; this.uy = 0; this.uz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.scale = 1;
    this.r = 1; this.g = 1; this.b = 1; this.a = 1;
    this.params = new ParticleParams();
  }

  get active() {
    return (this.flags & PARTICLE_FLAG_ACTIVE) !== 0;
  }

  /** params.clear: the buffer starts empty. */
  clear() {
    this.flags = 0;
    this.age = 0;
    this.end = 1;
    this.px = 0; this.py = 0; this.pz = 0;
    this.ux = 0; this.uy = 0; this.uz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.r = 1; this.g = 1; this.b = 1; this.a = 1;
  }
}

/**
 * GPUParticles3D — the node (scene/3d/gpu_particles_3d.cpp) and the rendering server's record of it
 * (ParticlesStorage::Particles), kept apart as the engine keeps them:
 *
 *   node     emitting, one_shot, and a one-shot's clock (time, emission/active time, whether its end
 *            is announced); `finished` only fires for a cycle that really started (a one-shot switched
 *            on while already emitting cancels it — the game's bursts never announce theirs)
 *   server   emitting, phase, cycle count, the fixed-step remainder, clear/inactive, the seed
 *
 * Both take a draw of the ENGINE-WIDE random stream when created (the server record seeds itself,
 * then the node re-seeds it) and the node takes another whenever a one-shot cycle starts or restart()
 * is called: the stream the banners, flames and piece idles draw from moves exactly as it does in the
 * original.
 */
export class GPUParticles3D extends Node3D {
  constructor() {
    super('GPUParticles3D');
    // RS::particles_create() → ParticlesStorage::Particles(): random_seed = Math::rand().
    globalRng.randi();
    this.amount = 8;
    this.lifetime = 1.0;
    this.explosiveness = 0.0;
    this.process_material = new ParticleProcessMaterial();
    /** draw_pass_1 = QuadMesh(size) with spark_material(energy). */
    this.quadSize = 1.0;
    this.sparkEnergy = 1.6;
    /** GPUParticles3D.visibility_aabb: the instance's bounds (culling, and the transparent sort). */
    this._visibilityAabb = new AABB(new Vector3(-4, -4, -4), new Vector3(8, 8, 8));
    this.finished = new Signal();
    // Node state (GPUParticles3D members, their declared defaults).
    this._oneShot = false;
    this._emitting = false;
    this._active = false;
    this._signalCanceled = false;
    this._time = 0;
    this._emissionTime = 0;
    this._activeTime = 0;
    // Server state (ParticlesStorage::Particles).
    this._server = { emitting: false, phase: 0, cycle: 0, remainder: 0, clear: true, inactive: true, inactiveTime: 0, restartRequest: false, fresh: true };
    // The constructor: `one_shot = false; set_emitting(true); set_one_shot(false); set_seed(Math::rand())`.
    this.emitting = true;
    this.seed = globalRng.randi();
    this._particles = null;
    this._mesh = null;
    this._colors = null;
    this._renderHook = (delta, view) => this._render(delta, view);
  }

  get one_shot() {
    return this._oneShot;
  }

  /** set_one_shot: switching a running system back to looping restarts it on the server. */
  set one_shot(on) {
    this._oneShot = Boolean(on);
    if (this._emitting && !this._oneShot) this._server.restartRequest = true;
  }

  get emitting() {
    return this._emitting;
  }

  /** GPUParticles3D::set_emitting, line for line. */
  set emitting(on) {
    on = Boolean(on);
    // A one-shot cycle that really starts draws a new seed (use_fixed_seed is false).
    if (on && on !== this._emitting && this._oneShot) this.seed = globalRng.randi();
    if (on && this._oneShot) {
      if (!this._active && !this._emitting) {
        // The last cycle ended: a new one.
        this._active = true;
        this._time = 0;
        this._signalCanceled = false;
        this._emissionTime = this.lifetime;
        this._activeTime = this.lifetime * (2 - this.explosiveness);
      } else {
        this._signalCanceled = true;
      }
    }
    this._emitting = on;
    this._server.emitting = on;
  }

  /** GPUParticles3D::restart(keep_seed = false). */
  restart(keepSeed = false) {
    if (!keepSeed) this.seed = globalRng.randi();
    this._server.restartRequest = true;
    this._server.emitting = true;
    this._emitting = true;
    this._active = true;
    this._signalCanceled = false;
    this._time = 0;
    this._emissionTime = this.lifetime * (1 - this.explosiveness);
    this._activeTime = this.lifetime * (2 - this.explosiveness);
  }

  get visibility_aabb() {
    return this._visibilityAabb;
  }

  set visibility_aabb(aabb) {
    this._visibilityAabb = aabb;
    this._applySortBounds();
  }

  /**
   * The engine sorts a particle system by the centre of its visibility AABB in the node's space (the
   * particles themselves may live in world space): the batch carries that box and that space.
   */
  _applySortBounds() {
    if (!this._mesh) return;
    const { position, size } = this._visibilityAabb;
    this._mesh.userData.sortBox = new THREE.Box3(new THREE.Vector3(position.x, position.y, position.z), new THREE.Vector3(position.x + size.x, position.y + size.y, position.z + size.z));
    this._mesh.userData.sortSpace = this.object3d;
  }

  set_draw_pass(quadSize, energy) {
    this.quadSize = quadSize;
    this.sparkEnergy = energy;
    if (this._mesh) this._mesh.material = sparkMaterial(energy);
  }

  _ensureMesh() {
    if (this._mesh) return;
    this._particles = Array.from({ length: this.amount }, () => new Particle());
    const quad = sharedQuad();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, quad.getAttribute(name));
    this._colors = new Float32Array(this.amount * 4);
    geometry.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(this._colors, 4));
    this._mesh = new THREE.InstancedMesh(geometry, sparkMaterial(this.sparkEnergy), this.amount);
    this._mesh.name = 'particles';
    this._mesh.frustumCulled = false;
    this._mesh.castShadow = false;
    this._mesh.receiveShadow = false;
    this._mesh.count = 0;
    this._applySortBounds();
  }

  _enter_tree() {
    this._ensureMesh();
    // World-space particles: the batch hangs from the scene root, not from this node.
    let root = this.object3d;
    while (root.parent) root = root.parent;
    if (root !== this.object3d) root.add(this._mesh);
    SceneTree.current?.renderHooks.add(this._renderHook);
  }

  _exit_tree() {
    this._mesh?.removeFromParent();
    SceneTree.current?.renderHooks.delete(this._renderHook);
  }

  _dispose() {
    super._dispose();
    SceneTree.current?.renderHooks.delete(this._renderHook);
    if (this._mesh) {
      this._mesh.removeFromParent();
      this._mesh.geometry.dispose();
    }
  }

  /** NOTIFICATION_INTERNAL_PROCESS of a one-shot: its emission window, then `finished` (if announced). */
  _process(delta) {
    if (!this._oneShot) return;
    this._time += delta;
    if (this._time > this._emissionTime) this._emitting = false;
    if (this._time > this._activeTime) {
      if (this._active && !this._signalCanceled) this.finished.emit();
      this._active = false;
    }
  }

  /**
   * The rendering step (RendererSceneCull + ParticlesStorage::update_particles): a system is only
   * processed in a frame that finds its visibility AABB inside the camera's frustum; then it runs its
   * fixed 1/30 s steps, one at once when freshly cleared, and draws what it holds.
   * @param {number} delta the frame's (time-scaled) step
   * @param {{frustum?: THREE.Frustum}} [view] the frame's camera; without one, the system counts as in view
   */
  _render(delta, view) {
    if (!this._particles || this._freed) return;
    const server = this._server;
    this.object3d.updateWorldMatrix(true, false);
    const inView = this.isVisibleInTree() && this._inFrustum(view?.frustum);
    // particles_is_inactive(): not emitting and asleep — culled away, nothing to process or draw.
    if (!inView || (!server.emitting && server.inactive)) {
      this._mesh.visible = false;
      return;
    }
    if (server.restartRequest) {
      server.phase = 0;
      server.clear = true;
      server.restartRequest = false;
      server.remainder = 0;
    }
    if (server.emitting) {
      if (server.inactive) {
        // Restart the system from scratch.
        server.phase = 0;
        server.clear = true;
      }
      server.inactive = false;
      server.inactiveTime = 0;
    } else {
      server.inactiveTime += delta;
      if (server.inactiveTime > this.lifetime * INACTIVE_AFTER_LIFETIMES) {
        server.inactive = true;
        this._mesh.visible = false;
        return;
      }
    }
    // update_particles, fixed_fps 30: single-precision remainder, a step at once when cleared. A new
    // system's first processed frame adds no time to it: the engine's second step comes a frame later
    // than the remainder alone would say (measured on the GPU: _oracle/probe_particles_sim.gd — the
    // render thread's one-frame latency between culling a system and processing it).
    const frameTime = F(1 / FIXED_FPS);
    const frameDelta = server.fresh ? 0 : F(Math.min(Math.max(delta, 0), MAX_FRAME_DELTA));
    server.fresh = false;
    let todo = F(server.remainder + frameDelta);
    while (todo >= frameTime || server.clear) {
      this._step(frameTime);
      todo = F(todo - frameTime);
    }
    server.remainder = todo;
    this._draw(server.remainder);
  }

  /** Whether the visibility AABB, placed by the node, reaches into the frustum (the engine's cull). */
  _inFrustum(frustum) {
    if (!frustum) return true;
    const { position, size } = this._visibilityAabb;
    tmpBox.min.set(position.x, position.y, position.z);
    tmpBox.max.set(position.x + size.x, position.y + size.y, position.z + size.z);
    return frustum.intersectsBox(tmpBox.applyMatrix4(this.object3d.matrixWorld));
  }

  /**
   * ParticlesStorage::_particles_process + particles.glsl, one fixed step for every particle.
   * O(amount).
   */
  _step(dt) {
    const server = this._server;
    const lifetime = this.lifetime;
    const newPhase = (server.phase + dt / lifetime) % 1.0;
    const clearing = server.clear;
    if (clearing) {
      server.cycle = 0;
    } else if (newPhase < server.phase) {
      if (this._oneShot) server.emitting = false;
      server.cycle += 1;
    }
    // FrameParams are single precision.
    const system = F(newPhase);
    const previous = F(server.phase);
    const frameDelta = F(dt);
    const explosiveness = F(this.explosiveness);
    const emitting = server.emitting;
    const cycle = server.cycle;
    server.phase = newPhase;
    const total = this.amount;
    const m = this.process_material;
    const emission = this.object3d.matrixWorld.elements;
    for (let index = 0; index < total; index++) {
      const p = this._particles[index];
      if (clearing) p.clear();
      // STARTED only marks the step a particle (re)starts in.
      p.flags = (p.flags & ~PARTICLE_FLAG_STARTED) >>> 0;
      let restart = false;
      let localDelta = frameDelta;
      if (emitting) {
        // float(index) / float(amount) as the GPU divides (a × its reciprocal): a particle due exactly
        // on a step boundary starts in the step the engine starts it in.
        const restartPhase = F(gpuDivide(index, total) * F(1 - explosiveness));
        if (system > previous) {
          if (restartPhase >= previous && restartPhase < system) {
            restart = true;
            localDelta = F(F(system - restartPhase) * F(lifetime));
          }
        } else if (frameDelta > 0) {
          if (restartPhase >= previous) {
            restart = true;
            localDelta = F(F(F(1 - restartPhase) + system) * F(lifetime));
          } else if (restartPhase < system) {
            restart = true;
            localDelta = F(F(system - restartPhase) * F(lifetime));
          }
        }
        if (restart) p.flags = (PARTICLE_FLAG_ACTIVE | PARTICLE_FLAG_STARTED | ((cycle & PARTICLE_FRAME_MASK) << PARTICLE_FRAME_SHIFT)) >>> 0;
      }
      if (!p.active) continue;
      if (restart) this._start(p, index, m, emission);
      this._processParticle(p, localDelta, m);
    }
    server.clear = false;
  }

  /** particle_number: the cycle the particle started in, times the amount, plus its index. */
  _number(p, index) {
    return (Math.imul(p.flags >>> PARTICLE_FRAME_SHIFT, this.amount) + index) >>> 0;
  }

  /** ParticleProcessMaterial start(). O(1). */
  _start(p, index, m, e) {
    const rng = { seed: particleHash(this._number(p, index) + 1 + this.seed) };
    p.params.draw(m, rng);
    randFromSeed(rng); // `if (rand_from_seed(alt_seed) > AMOUNT_RATIO)`: amount_ratio is 1
    // RESTART_CUSTOM, RESTART_COLOR (the ramp at 0 over the base colour).
    p.age = 0;
    p.end = F(p.params.lifetime);
    m.rampColor(0, tmpColor);
    p.r = tmpColor[0]; p.g = tmpColor[1]; p.b = tmpColor[2]; p.a = tmpColor[3];
    // RESTART_POSITION: the shape, through EMISSION_TRANSFORM.
    const [x, y, z] = emissionPoint(m, rng);
    p.px = e[0] * x + e[4] * y + e[8] * z + e[12];
    p.py = e[1] * x + e[5] * y + e[9] * z + e[13];
    p.pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    // RESTART_VELOCITY: a direction in the spread cone, turned by the emission basis.
    const [dx, dy, dz] = spreadDirection(m.direction, m.spread, rng);
    const speed = p.params.velocityMultiplier;
    p.ux = (e[0] * dx + e[4] * dy + e[8] * dz) * speed;
    p.uy = (e[1] * dx + e[5] * dy + e[9] * dz) * speed;
    p.uz = (e[2] * dx + e[6] * dy + e[10] * dz) * speed;
  }

  /** ParticleProcessMaterial process() + the move particles.glsl leaves to it. O(1). */
  _processParticle(p, dt, m) {
    const firstFrame = p.age === 0;
    // CUSTOM.y += DELTA / LIFETIME in single precision with the GPU's divider: when a particle dies
    // is decided by exactly this sum.
    p.age = F(p.age + gpuDivide(dt, F(this.lifetime)));
    const lifetimePercent = gpuDivide(p.age, p.params.lifetime);
    if (p.age > p.end) p.flags = (p.flags & ~PARTICLE_FLAG_ACTIVE) >>> 0;
    // Forces: gravity (the accelerations the game leaves at zero), then damping as speed lost.
    p.ux += m.gravity.x * dt;
    p.uy += m.gravity.y * dt;
    p.uz += m.gravity.z * dt;
    const damping = p.params.damping;
    if (damping > 0) {
      const v = Math.hypot(p.ux, p.uy, p.uz);
      const slowed = v - damping * dt;
      if (slowed < 0) {
        p.ux = 0; p.uy = 0; p.uz = 0;
      } else if (v > 0) {
        const k = slowed / v;
        p.ux *= k; p.uy *= k; p.uz *= k;
      }
    }
    p.vx = p.ux; p.vy = p.uy; p.vz = p.uz;
    p.px += p.vx * dt;
    p.py += p.vy * dt;
    p.pz += p.vz * dt;
    // process_display_param: the scale curve and the colour ramp at this age.
    m.scaleCurve(lifetimePercent, tmpScale);
    const scale = p.params.scale * tmpScale[0];
    p.scale = firstFrame ? Math.sign(scale || 1) * Math.max(Math.abs(scale), SCALE_MINIMUM) : Math.max(Math.abs(scale), SCALE_MINIMUM);
    m.rampColor(lifetimePercent, tmpColor);
    p.r = tmpColor[0]; p.g = tmpColor[1]; p.b = tmpColor[2]; p.a = tmpColor[3];
  }

  /**
   * particles_copy.glsl: every active particle, in index order, at its last step's position moved on
   * by its velocity for the time the fixed steps have not covered yet (which is negative right after
   * a clear, when the step ran ahead). O(amount).
   */
  _draw(remainder) {
    let visible = 0;
    for (let i = 0; i < this.amount; i++) {
      const p = this._particles[i];
      if (!p.active) continue;
      const size = this.quadSize * p.scale;
      tmpMatrix.makeScale(size, size, size).setPosition(p.px + p.vx * remainder, p.py + p.vy * remainder, p.pz + p.vz * remainder);
      this._mesh.setMatrixAt(visible, tmpMatrix);
      this._colors[visible * 4] = p.r;
      this._colors[visible * 4 + 1] = p.g;
      this._colors[visible * 4 + 2] = p.b;
      this._colors[visible * 4 + 3] = p.a;
      visible += 1;
    }
    this._mesh.count = visible;
    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.geometry.getAttribute('aInstanceColor').needsUpdate = true;
    this._mesh.visible = visible > 0;
  }

  /** Live particle count (tests, stats). */
  get aliveCount() {
    return this._particles ? this._particles.reduce((n, p) => n + (p.active ? 1 : 0), 0) : 0;
  }
}

/**
 * calculate_initial_position() for the shapes the game uses (point, sphere, ring), with the shader's
 * draws in its order. The ring is the engine's general form (cone angle 90°, so the top radius is the
 * radius): height position, spawn angle, radius uniform in area, an orthogonal vector rotated about
 * the axis (Rodrigues, written out as in the shader).
 */
function emissionPoint(m, rng) {
  const pi = 3.14159;
  if (m.emission_shape === EMISSION_SHAPE.SPHERE) {
    const s = randFromSeed(rng) * 2.0 - 1.0;
    const t = randFromSeed(rng) * 2.0 * pi;
    const k = randFromSeed(rng);
    const radius = m.emission_sphere_radius * Math.sqrt(1.0 - s * s);
    return [radius * Math.cos(t) * k, radius * Math.sin(t) * k, m.emission_sphere_radius * s * k];
  }
  if (m.emission_shape !== EMISSION_SHAPE.RING) return [0, 0, 0];
  const radiusClamped = Math.max(0.001, m.emission_ring_radius);
  const topRadius = Math.max(radiusClamped - Math.tan(DEG_TO_RAD * (90.0 - m.emission_ring_cone_angle)) * m.emission_ring_height, 0.0);
  let yPos = randFromSeed(rng);
  const skew = Math.max(Math.min(radiusClamped, topRadius) / Math.max(radiusClamped, topRadius), 0.5);
  yPos = radiusClamped < topRadius ? Math.pow(yPos, skew) : 1.0 - Math.pow(yPos, skew);
  const angle = randFromSeed(rng) * 2.0 * pi;
  const inner2 = m.emission_ring_inner_radius * m.emission_ring_inner_radius;
  let radius = Math.sqrt(randFromSeed(rng) * (radiusClamped * radiusClamped - inner2) + inner2);
  radius = mix(radius, radius * (topRadius / radiusClamped), yPos);
  let ax = m.emission_ring_axis.x;
  let ay = m.emission_ring_axis.y;
  let az = m.emission_ring_axis.z;
  if (ax === 0 && ay === 0 && az === 0) {
    az = 1;
  } else {
    const al = Math.hypot(ax, ay, az);
    ax /= al; ay /= al; az /= al;
  }
  // ortho = cross(axis, UP) when |axis| is X, else cross(axis, RIGHT).
  let ox;
  let oy;
  let oz;
  if (Math.abs(ax) === 1 && ay === 0 && az === 0) {
    ox = -az; oy = 0; oz = ax;
  } else {
    ox = 0; oy = az; oz = -ay;
  }
  const ol = Math.hypot(ox, oy, oz) || 1;
  ox /= ol; oy /= ol; oz /= ol;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const oc = 1 - c;
  // GLSL mat3(...) takes columns: result = col0·ox + col1·oy + col2·oz.
  let rx = (c + ax * ax * oc) * ox + (ax * ay * oc + s * az) * oy + (az * ax * oc - ay * s) * oz;
  let ry = (ax * ay * oc - az * s) * ox + (c + ay * ay * oc) * oy + (az * ay * oc + ax * s) * oz;
  let rz = (ax * az * oc + ay * s) * ox + (ay * az * oc - ax * s) * oy + (c + az * az * oc) * oz;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const h = yPos * m.emission_ring_height - m.emission_ring_height / 2.0;
  return [rx * radius + h * ax, ry * radius + h * ay, rz * radius + h * az];
}

/** get_random_direction_from_spread() (3D): a cone of `spread` degrees around `direction`. */
function spreadDirection(direction, spreadDegrees, rng) {
  const pi = 3.14159;
  const spreadRad = spreadDegrees * (pi / 180.0);
  const angle1 = (randFromSeed(rng) * 2.0 - 1.0) * spreadRad;
  const angle2 = (randFromSeed(rng) * 2.0 - 1.0) * spreadRad; // × (1 − flatness), flatness 0
  const xzX = Math.sin(angle1);
  const xzZ = Math.cos(angle1);
  const yzY = Math.sin(angle2);
  let yzZ = Math.cos(angle2);
  yzZ /= Math.max(0.0001, Math.sqrt(Math.abs(yzZ))); // "better uniform distribution"
  const sx = xzX * yzZ;
  const sy = yzY;
  const sz = xzZ * yzZ;
  let nx = direction.x;
  let ny = direction.y;
  let nz = direction.z;
  const nl = Math.hypot(nx, ny, nz);
  if (nl > 0) {
    nx /= nl; ny /= nl; nz /= nl;
  } else {
    nx = 0; ny = 0; nz = 1;
  }
  // binormal = cross(UP, n); Z when n is parallel to Y.
  let bx = nz;
  let by = 0;
  let bz = -nx;
  let bl = Math.hypot(bx, by, bz);
  if (bl < 0.0001) {
    bx = 0; by = 0; bz = 1; bl = 1;
  }
  bx /= bl; by /= bl; bz /= bl;
  // normal = cross(binormal, n)
  const qx = by * nz - bz * ny;
  const qy = bz * nx - bx * nz;
  const qz = bx * ny - by * nx;
  const vx = bx * sx + qx * sy + nx * sz;
  const vy = by * sx + qy * sy + ny * sz;
  const vz = bz * sx + qz * sy + nz * sz;
  const vl = Math.hypot(vx, vy, vz) || 1;
  return [vx / vl, vy / vl, vz / vl];
}
