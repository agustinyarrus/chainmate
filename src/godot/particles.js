/**
 * GPUParticles3D + ParticleProcessMaterial, simulated on the CPU exactly the way Godot 4's particle
 * compute shader does it (the game never has more than a few dozen sparks alive, so the CPU is the
 * cheaper place — and the look stays identical on GPUs without compute).
 *
 * Reproduced from Godot's sources (particles.glsl, particle_process_material.cpp, particles_storage):
 *   - fixed_fps = 30 with interpolation: the system advances in 1/30 s steps and the drawn position is
 *     lerped between the last two steps, so the motion is the same at 60, 120 or 144 Hz;
 *   - emission: particle i restarts when the system phase crosses `i/amount · (1 − explosiveness)`,
 *     with fractional delta (it only lives the part of the step after its restart moment);
 *   - one_shot: emission stops when the phase wraps; the emitter is spent after lifetime·(2 − explosiveness);
 *   - start(): SPHERE/RING emission shapes, Godot's spread-cone direction, the emission transform applied
 *     to position and velocity (world-space particles, local_coords = false);
 *   - process(): gravity, then linear damping (speed −= damping·dt, clamped at 0), then the position;
 *     scale = random base × scale curve (cubic Bézier, flat tangents), colour = colour ramp (raw values).
 *
 * Like Godot, the simulation runs at render time (after process, timers and tweens), so an emitter made
 * inside a tween callback already shows sparks in that frame. One InstancedMesh per emitter, drawn from
 * the scene root. Cost: O(amount) per step, no allocation per frame.
 */
import * as THREE from 'three';
import { Color } from './math.js';
import { Node3D } from './node3d.js';
import { SceneTree } from './scene.js';
import { Signal } from './signal.js';
import { SpatialMaterial } from './render/material.js';

export const EMISSION_SHAPE = Object.freeze({ POINT: 0, SPHERE: 1, RING: 6 });

/** GPUParticles3D.fixed_fps default. */
const FIXED_FPS = 30;
const FRAME_TIME = 1 / FIXED_FPS;
/** particles_storage: "avoid recursive stalls if fps goes below 10". */
const MAX_FRAME_DELTA = 0.1;
const MIN_FRAME_DELTA = 0.001;
const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const MIN_SCALE = 0.000001;
const CMP_EPSILON = 0.00001;

// ───────────────────────────────────────────────────────────────────── Gradient / Curve ─────────

/** Gradient (GradientTexture1D source): sorted points, linear interpolation of raw values. */
export class Gradient {
  constructor() {
    this.points = [
      { offset: 0, color: new Color(0, 0, 0, 1) },
      { offset: 1, color: new Color(1, 1, 1, 1) },
    ];
  }

  set_color(index, color) {
    this.points[index].color = color;
  }

  add_point(offset, color) {
    this.points.push({ offset, color });
    this.points.sort((a, b) => a.offset - b.offset);
  }

  /** Colour at `t` written into `out` (rgba). O(points). */
  sampleInto(t, out) {
    const p = this.points;
    if (t <= p[0].offset) return writeColor(out, p[0].color);
    for (let i = 0; i < p.length - 1; i++) {
      if (t <= p[i + 1].offset) {
        const a = p[i].color;
        const b = p[i + 1].color;
        const span = p[i + 1].offset - p[i].offset;
        const w = span > 0 ? (t - p[i].offset) / span : 0;
        out[0] = a.r + (b.r - a.r) * w;
        out[1] = a.g + (b.g - a.g) * w;
        out[2] = a.b + (b.b - a.b) * w;
        out[3] = a.a + (b.a - a.a) * w;
        return out;
      }
    }
    return writeColor(out, p[p.length - 1].color);
  }
}

function writeColor(out, color) {
  out[0] = color.r;
  out[1] = color.g;
  out[2] = color.b;
  out[3] = color.a;
  return out;
}

/**
 * Curve: `add_point(Vector2)` gives flat tangents and Godot evaluates each segment as a cubic Bézier
 * with control points a third of the span in (Curve::sample_local_nocheck) — with zero tangents that is
 * `a + (b − a)·(3u² − 2u³)`, not a straight line.
 */
export class Curve {
  constructor() {
    this.points = [];
  }

  add_point(position, leftTangent = 0, rightTangent = 0) {
    this.points.push({ x: position.x, y: position.y, left: leftTangent, right: rightTangent });
    this.points.sort((a, b) => a.x - b.x);
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
}

export class ParticleProcessMaterial {
  constructor() {
    this.emission_shape = EMISSION_SHAPE.POINT;
    this.emission_sphere_radius = 1.0;
    this.emission_ring_axis = { x: 0, y: 0, z: 1 };
    this.emission_ring_radius = 1.0;
    this.emission_ring_inner_radius = 0.0;
    this.emission_ring_height = 1.0;
    this.direction = { x: 1, y: 0, z: 0 };
    this.spread = 45.0;
    this.initial_velocity_min = 0;
    this.initial_velocity_max = 0;
    this.gravity = { x: 0, y: -9.8, z: 0 };
    this.damping_min = 0;
    this.damping_max = 0;
    this.scale_min = 1;
    this.scale_max = 1;
    /** @type {Curve|null} */
    this.scale_curve = null;
    /** @type {Gradient|null} */
    this.color_ramp = null;
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
const tmpColor = [0, 0, 0, 0];

/** Per-particle state (flat numbers: the step loop stays allocation-free). */
class Particle {
  constructor() {
    this.active = false;
    /** CUSTOM.y — elapsed fraction of the lifetime. */
    this.age = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    /** Position at the previous step (for interpolation). */
    this.ox = 0; this.oy = 0; this.oz = 0;
    this.baseScale = 1;
    this.damping = 0;
  }
}

/** Lifecycle of a one-shot emitter (GPUParticles3D's `active` / `emitting` pair, made explicit). */
const Cycle = Object.freeze({ IDLE: 0, EMITTING: 1, DRAINING: 2, SPENT: 3 });

export class GPUParticles3D extends Node3D {
  constructor() {
    super('GPUParticles3D');
    this.amount = 8;
    this.lifetime = 1.0;
    this.one_shot = false;
    this.explosiveness = 0.0;
    this.process_material = new ParticleProcessMaterial();
    /** draw_pass_1 = QuadMesh(size) with spark_material(energy). */
    this.quadSize = 1.0;
    this.sparkEnergy = 1.6;
    this.finished = new Signal();
    /** Godot creates emitters already emitting. */
    this._emitting = true;
    this._cycle = Cycle.IDLE;
    this._cycleTime = 0;
    this._phase = 0;
    this._remainder = 0;
    this._restartPending = true;
    this._particles = null;
    this._mesh = null;
    this._colors = null;
    this._renderHook = (delta) => this._simulate(delta);
  }

  set_draw_pass(quadSize, energy) {
    this.quadSize = quadSize;
    this.sparkEnergy = energy;
    if (this._mesh) this._mesh.material = sparkMaterial(energy);
  }

  get emitting() {
    return this._emitting;
  }

  /** `emitting = true` on a one-shot emitter (re)starts its single cycle. */
  set emitting(on) {
    if (on && this.one_shot && this._cycle !== Cycle.EMITTING) {
      this._cycle = Cycle.EMITTING;
      this._cycleTime = 0;
      this._restartPending = true;
    } else if (on && !this._emitting) {
      this._restartPending = true;
    }
    this._emitting = on;
  }

  restart() {
    this._restartPending = true;
    this.emitting = true;
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

  /** NOTIFICATION_INTERNAL_PROCESS of a one-shot emitter: emission window, then the spent signal. */
  _process(delta) {
    if (!this.one_shot || this._cycle === Cycle.IDLE || this._cycle === Cycle.SPENT) return;
    this._cycleTime += delta;
    if (this._cycle === Cycle.EMITTING && this._cycleTime > this.lifetime) {
      this._emitting = false;
      this._cycle = Cycle.DRAINING;
    }
    if (this._cycleTime > this.lifetime * (2 - this.explosiveness)) {
      this._cycle = Cycle.SPENT;
      this.finished.emit();
    }
  }

  /** Render-time update: fixed 30 Hz steps, remainder kept for interpolation. */
  _simulate(delta) {
    if (!this._particles || this._freed) return;
    this.object3d.updateWorldMatrix(true, false);
    let todo = this._remainder + Math.min(Math.max(delta, MIN_FRAME_DELTA), MAX_FRAME_DELTA);
    while (todo >= FRAME_TIME) {
      this._step(FRAME_TIME);
      todo -= FRAME_TIME;
    }
    this._remainder = todo;
    this._draw(todo / FRAME_TIME);
  }

  /** One fixed step (particles_storage::_particles_process + particles.glsl). O(amount). */
  _step(dt) {
    let previous = this._phase;
    if (this._restartPending) {
      this._restartPending = false;
      for (const p of this._particles) p.active = false;
      previous = 0;
      this._phase = 0;
      this._remainder = 0;
    }
    const phase = (previous + dt / this.lifetime) % 1;
    // One-shot emitters stop emitting once the phase wraps (RS side of `emitting`).
    const emittingNow = this._emitting;
    for (let i = 0; i < this.amount; i++) {
      const p = this._particles[i];
      p.ox = p.px;
      p.oy = p.py;
      p.oz = p.pz;
      const restartPhase = (i / this.amount) * (1 - this.explosiveness);
      let restart = false;
      let localDelta = dt;
      if (phase > previous) {
        if (restartPhase >= previous && restartPhase < phase) {
          restart = true;
          localDelta = (phase - restartPhase) * this.lifetime;
        }
      } else if (restartPhase >= previous) {
        restart = true;
        localDelta = (1 - restartPhase + phase) * this.lifetime;
      } else if (restartPhase < phase) {
        restart = true;
        localDelta = (phase - restartPhase) * this.lifetime;
      }
      if (restart) {
        if (!emittingNow) {
          p.active = false;
          continue;
        }
        this._start(p);
      }
      if (p.active) this._integrate(p, localDelta);
    }
    if (phase < previous && this.one_shot) this._emitting = false;
    this._phase = phase;
  }

  /** ParticleProcessMaterial start(): shape, spread direction, speed, scale, damping. */
  _start(p) {
    const m = this.process_material;
    const rnd = Math.random;
    let x = 0;
    let y = 0;
    let z = 0;
    if (m.emission_shape === EMISSION_SHAPE.SPHERE) {
      const s = rnd() * 2 - 1;
      const t = rnd() * TAU;
      const k = rnd();
      const radius = m.emission_sphere_radius * Math.sqrt(1 - s * s);
      x = radius * Math.cos(t) * k;
      y = radius * Math.sin(t) * k;
      z = m.emission_sphere_radius * s * k;
    } else if (m.emission_shape === EMISSION_SHAPE.RING) {
      [x, y, z] = ringPoint(m, rnd);
    }
    const [dx, dy, dz] = spreadDirection(m.direction, m.spread * DEG_TO_RAD, rnd);
    const speed = m.initial_velocity_min + (m.initial_velocity_max - m.initial_velocity_min) * rnd();
    // EMISSION_TRANSFORM: full transform for the position, basis (scale included) for the velocity.
    const e = this.object3d.matrixWorld.elements;
    p.px = e[0] * x + e[4] * y + e[8] * z + e[12];
    p.py = e[1] * x + e[5] * y + e[9] * z + e[13];
    p.pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    p.vx = (e[0] * dx + e[4] * dy + e[8] * dz) * speed;
    p.vy = (e[1] * dx + e[5] * dy + e[9] * dz) * speed;
    p.vz = (e[2] * dx + e[6] * dy + e[10] * dz) * speed;
    p.ox = p.px;
    p.oy = p.py;
    p.oz = p.pz;
    p.baseScale = Math.max(m.scale_min + (m.scale_max - m.scale_min) * rnd(), MIN_SCALE);
    p.damping = m.damping_min + (m.damping_max - m.damping_min) * rnd();
    p.age = 0;
    p.active = true;
  }

  /** process(): age, gravity, damping — then particles.glsl moves the particle by its new velocity. */
  _integrate(p, dt) {
    const m = this.process_material;
    p.age += dt / this.lifetime;
    if (p.age > 1) {
      p.active = false;
      return;
    }
    p.vx += m.gravity.x * dt;
    p.vy += m.gravity.y * dt;
    p.vz += m.gravity.z * dt;
    if (p.damping > 0) {
      const v = Math.hypot(p.vx, p.vy, p.vz);
      const slowed = v - p.damping * dt;
      if (slowed < 0 || v === 0) {
        p.vx = 0; p.vy = 0; p.vz = 0;
      } else {
        const k = slowed / v;
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
    }
    p.px += p.vx * dt;
    p.py += p.vy * dt;
    p.pz += p.vz * dt;
  }

  /** Instances for the live particles, interpolated between the last two steps. O(amount). */
  _draw(blend) {
    const m = this.process_material;
    let visible = 0;
    for (let i = 0; i < this.amount; i++) {
      const p = this._particles[i];
      if (!p.active) continue;
      const t = Math.min(p.age, 1);
      const curve = m.scale_curve ? m.scale_curve.sample(t) : 1;
      const size = this.quadSize * p.baseScale * Math.sign(curve || 1) * Math.max(Math.abs(curve), CMP_EPSILON);
      tmpMatrix.makeScale(size, size, size).setPosition(
        p.ox + (p.px - p.ox) * blend,
        p.oy + (p.py - p.oy) * blend,
        p.oz + (p.pz - p.oz) * blend,
      );
      this._mesh.setMatrixAt(visible, tmpMatrix);
      if (m.color_ramp) m.color_ramp.sampleInto(t, tmpColor);
      else tmpColor.fill(1);
      this._colors.set(tmpColor, visible * 4);
      visible += 1;
    }
    this._mesh.count = visible;
    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.geometry.getAttribute('aInstanceColor').needsUpdate = true;
    this._mesh.visible = visible > 0 && this.isVisibleInTree();
  }

  /** Live particle count (tests, stats). */
  get aliveCount() {
    return this._particles ? this._particles.reduce((n, p) => n + (p.active ? 1 : 0), 0) : 0;
  }
}

/**
 * EMISSION_SHAPE_RING: radius uniform in area between the inner and outer radius, an orthogonal vector
 * rotated about the axis by a random angle (Rodrigues, written out as in the shader), plus a random
 * offset along the axis within the ring height.
 */
function ringPoint(m, rnd) {
  const angle = rnd() * TAU;
  const outer2 = m.emission_ring_radius * m.emission_ring_radius;
  const inner2 = m.emission_ring_inner_radius * m.emission_ring_inner_radius;
  const radius = Math.sqrt(rnd() * (outer2 - inner2) + inner2);
  let ax = m.emission_ring_axis.x;
  let ay = m.emission_ring_axis.y;
  let az = m.emission_ring_axis.z;
  const al = Math.hypot(ax, ay, az);
  if (al === 0) {
    ax = 0; ay = 0; az = 1;
  } else {
    ax /= al; ay /= al; az /= al;
  }
  // ortho = cross(axis, UP) when the axis is ±X, else cross(axis, RIGHT).
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
  const h = rnd() * m.emission_ring_height - m.emission_ring_height / 2;
  return [rx * radius + h * ax, ry * radius + h * ay, rz * radius + h * az];
}

/** get_random_direction_from_spread(): a cone of `spread` radians around `direction`. */
function spreadDirection(direction, spreadRad, rnd) {
  const angle1 = (rnd() * 2 - 1) * spreadRad;
  const angle2 = (rnd() * 2 - 1) * spreadRad;
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
