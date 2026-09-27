/**
 * Arena — port of scripts/presentation/arena.gd: the plinth the board sits on, its three looks
 * (outpost / crypt / court), lighting, environment and mood.
 *
 * Layout is procedural and seeded with hash("arena-" + variant): every stone, vine and candle comes
 * from `_rng` in the original draw order, and vector math is float32 like Godot's, so each variant is
 * laid out stone for stone as in the original build. Stones are instanced per mesh kind (MultiMesh).
 */
import * as THREE from 'three';
import { Vector2, Vector3, Color, Basis, Transform3D, Rect2, PI, TAU, lerpf, clampf, smoothstep, F } from '../godot/math.js';
import { RandomNumberGenerator, hashString } from '../godot/rng.js';
import { GDict, format } from '../godot/gdscript.js';
import { Node3D, MeshInstance3D, OmniLight3D, DirectionalLight3D, MultiMeshInstance3D, Environment } from '../godot/node3d.js';
import { SpatialMaterial, StandardMaterial3D } from '../godot/render/material.js';
import { fromGodotArrays, boxMesh } from '../godot/render/primitives.js';
import { FastNoiseLite, NOISE_TYPE, FRACTAL_TYPE } from '../godot/noise.js';
import { TRANS, EASE } from '../godot/tween.js';
import { ArenaProps } from './arena_props.js';
import { STONE_SHADER } from './shaders.js';

const V3 = (x, y, z) => new Vector3(x, y, z);

const VARIANTS = ['outpost', 'crypt', 'court'];
const RIM_IN = 3.05;
const WALL_DEPTH = 0.5;
const RIM_OUT = RIM_IN + WALL_DEPTH;
const COURSE = 0.4;
const RIM_BASE = -0.08;
const SKIN_COURSES = 7;
const TILE_SIZE = 0.965;
const TILE_HEIGHT = 0.16;
const SIDES = [V3(0, 0, -1), V3(1, 0, 0), V3(0, 0, 1), V3(-1, 0, 0)];
const RIM_MID = RIM_IN + WALL_DEPTH * 0.5;
const IVY = [new Color(0.17, 0.31, 0.09), new Color(0.27, 0.42, 0.11), new Color(0.13, 0.25, 0.1), new Color(0.33, 0.45, 0.14)];
const AUTUMN = [new Color(0.72, 0.17, 0.06), new Color(0.82, 0.36, 0.08), new Color(0.58, 0.1, 0.05), new Color(0.86, 0.52, 0.12)];
const RELIC_SLOTS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
const RELIC_FOOTPRINT = 0.28;

const kit = new Map();
let tileMesh = null;

const LOOKS = {
  outpost: {
    sun_color: new Color(1.0, 0.9, 0.76), sun_energy: 2.5, sun_dir: V3(0.78, -0.56, 0.3),
    fill_color: new Color(0.6, 0.66, 0.82), fill_energy: 0.3, fill_dir: V3(-0.5, -0.5, -0.7),
    ambient: new Color(0.38, 0.41, 0.48), ambient_energy: 0.46,
    sky_top: new Color(0.05, 0.06, 0.085), sky_horizon: new Color(0.085, 0.095, 0.12), sky_bottom: new Color(0.045, 0.054, 0.075),
    sky_glow: new Color(0.12, 0.1, 0.08), sky_glow_dir: V3(-0.8, 0.0, -0.6),
    fog_color: new Color(0.035, 0.045, 0.07), fog_density: 0.006, fog_height: -0.6, fog_height_density: 0.55,
    vol_density: 0.0, vol_albedo: new Color(0.9, 0.9, 0.9), vol_emission: new Color(0.0, 0.0, 0.0),
    exposure: 1.0, glow: 0.65,
    stone_a: new Color(0.47, 0.425, 0.39), stone_b: new Color(0.36, 0.34, 0.345), stone_edge: new Color(0.66, 0.6, 0.53),
    moss_a: new Color(0.2, 0.27, 0.07), moss_b: new Color(0.44, 0.47, 0.14), moss: 0.75, wet: 0.0, rough: 0.86,
  },
  crypt: {
    sun_color: new Color(0.55, 0.8, 0.86), sun_energy: 1.6, sun_dir: V3(-0.35, -0.8, 0.45),
    fill_color: new Color(0.16, 0.55, 0.6), fill_energy: 0.5, fill_dir: V3(0.6, -0.4, -0.6),
    ambient: new Color(0.17, 0.3, 0.36), ambient_energy: 0.46,
    sky_top: new Color(0.008, 0.028, 0.036), sky_horizon: new Color(0.02, 0.08, 0.09), sky_bottom: new Color(0.004, 0.014, 0.02),
    sky_glow: new Color(0.04, 0.36, 0.4), sky_glow_dir: V3(0.6, 0.1, -0.8),
    fog_color: new Color(0.02, 0.06, 0.07), fog_density: 0.02, fog_height: -0.4, fog_height_density: 0.8,
    vol_density: 0.022, vol_albedo: new Color(0.6, 0.9, 0.92), vol_emission: new Color(0.0, 0.01, 0.012),
    exposure: 1.05, glow: 0.8,
    stone_a: new Color(0.3, 0.33, 0.34), stone_b: new Color(0.22, 0.25, 0.27), stone_edge: new Color(0.45, 0.5, 0.5),
    moss_a: new Color(0.08, 0.18, 0.14), moss_b: new Color(0.15, 0.3, 0.24), moss: 0.35, wet: 0.7, rough: 0.62,
  },
  court: {
    sun_color: new Color(1.0, 0.86, 0.7), sun_energy: 2.3, sun_dir: V3(0.5, -0.7, 0.5),
    fill_color: new Color(0.62, 0.55, 0.6), fill_energy: 0.32, fill_dir: V3(-0.6, -0.4, -0.6),
    ambient: new Color(0.4, 0.37, 0.38), ambient_energy: 0.46,
    sky_top: new Color(0.052, 0.05, 0.062), sky_horizon: new Color(0.09, 0.08, 0.085), sky_bottom: new Color(0.045, 0.042, 0.052),
    sky_glow: new Color(0.14, 0.09, 0.06), sky_glow_dir: V3(-0.5, 0.05, -0.85),
    fog_color: new Color(0.035, 0.035, 0.05), fog_density: 0.006, fog_height: -0.6, fog_height_density: 0.4,
    vol_density: 0.0, vol_albedo: new Color(0.9, 0.9, 0.9), vol_emission: new Color(0.0, 0.0, 0.0),
    exposure: 1.0, glow: 0.7,
    stone_a: new Color(0.55, 0.47, 0.4), stone_b: new Color(0.42, 0.36, 0.33), stone_edge: new Color(0.75, 0.66, 0.55),
    moss_a: new Color(0.2, 0.2, 0.1), moss_b: new Color(0.3, 0.3, 0.15), moss: 0.0, wet: 0.15, rough: 0.7,
  },
};

export class Arena extends Node3D {
  static VARIANTS = VARIANTS;
  static RIM_IN = RIM_IN;
  static RIM_OUT = RIM_OUT;
  static TILE_SIZE = TILE_SIZE;
  static TILE_HEIGHT = TILE_HEIGHT;

  constructor() {
    super('Arena');
    this.environment = new Environment();
    this.variant = '';
    this.sky = { top_color: new Color(0.03, 0.045, 0.075), horizon_color: new Color(0.1, 0.085, 0.085), bottom_color: new Color(0.018, 0.025, 0.042), glow_color: new Color(0.45, 0.24, 0.1), glow_dir: V3(-0.8, 0, -0.6), version: 0 };
    this._key = new DirectionalLight3D();
    this._key.shadow_enabled = true;
    this.add_child(this._key);
    this._fill = new DirectionalLight3D();
    this._fill.shadow_enabled = false;
    this.add_child(this._fill);
    this._content = null;
    this._look = null;
    this._rng = new RandomNumberGenerator();
    this._materials = {};
    this._blocks = new Map();
    this._flames = [];
    this._tops = [];
    this._leaves = { 0: [], 1: [], 2: [] };
    this._mood = new Vector2(1.0, 0.0);
    this._moodTween = null;
    this._flickerTime = 0.0;
  }

  get key_light() {
    return this._key;
  }

  _ready() {
    if (this.variant === '') this.set_variant('outpost');
  }

  _process(delta) {
    this._flickerTime += delta;
    const moodScale = this._flame_mood();
    for (const flame of this._flames) {
      const t = this._flickerTime * flame.speed + flame.phase;
      const n = Math.sin(t * 7.1) * 0.45 + Math.sin(t * 13.3 + 1.3) * 0.3 + Math.sin(t * 23.7 + 0.4) * 0.25;
      flame.light.light_energy = flame.energy * moodScale * (1.0 + n * flame.flicker);
    }
  }

  set_variant(newVariant) {
    if (!VARIANTS.includes(newVariant)) throw new Error(`Unknown arena variant: ${newVariant}`);
    this.variant = newVariant;
    if (this._content) {
      this.remove_child(this._content);
      this._content.queue_free();
    }
    this._content = new Node3D(`Arena_${this.variant}`);
    this.add_child(this._content);
    this._flames = [];
    this._blocks = new Map();
    this._tops = [];
    this._leaves = { 0: [], 1: [], 2: [] };
    this._materials = {};
    this._look = LOOKS[this.variant];
    this._rng.seed = hashString(`arena-${this.variant}`);
    this._apply_environment();
    this._build_materials();
    this._build_platform();
    if (this.variant === 'outpost') this._dress_outpost();
    else if (this.variant === 'crypt') this._dress_crypt();
    else this._dress_court();
    this._flush_blocks();
    this._flush_leaves();
    this._apply_mood(this._mood);
  }

  /** Mood: light level (1 = normal) and warmth, eased like the original's SINE/IN_OUT tween. */
  set_mood(level, warmth = 0.0, duration = 1.0) {
    if (this._moodTween) this._moodTween.kill();
    const target = new Vector2(level, clampf(warmth, 0.0, 1.0));
    if (duration <= 0.02) {
      this._apply_mood(target);
      return;
    }
    this._moodTween = this.create_tween().set_trans(TRANS.SINE).set_ease(EASE.IN_OUT);
    this._moodTween.tween_method((v) => this._apply_mood(v), this._mood, target, duration);
  }

  static tile_mesh() {
    if (tileMesh === null) {
      const chips = [
        { dir: V3(0.62, 0.7, 0.36), depth: 0.03, at: V3(0.4825, 0.08, 0.4825) },
        { dir: V3(-0.3, 0.72, -0.62), depth: 0.026, at: V3(-0.4825, 0.08, -0.4825) },
        { dir: V3(-0.75, 0.66, 0.05), depth: 0.018, at: V3(-0.4825, 0.08, 0.12) },
        { dir: V3(0.08, 0.7, -0.71), depth: 0.014, at: V3(0.2, 0.08, -0.4825) },
      ];
      tileMesh = Arena._block_mesh(V3(TILE_SIZE, TILE_HEIGHT, TILE_SIZE), 0.024, 0.0, 0, 11, [14, 1, 14], chips);
    }
    return tileMesh;
  }

  _apply_environment() {
    const e = this.environment;
    const look = this._look;
    e.background_mode = 'sky';
    e.ambient_light_color = look.ambient;
    e.ambient_light_energy = look.ambient_energy;
    e.tonemap_mode = 'filmic';
    e.tonemap_exposure = look.exposure;
    e.tonemap_white = 6.0;
    e.glow_enabled = true;
    e.glow_intensity = look.glow;
    e.glow_strength = 1.0;
    e.glow_bloom = 0.02;
    e.glow_hdr_threshold = 1.0;
    e.glow_blend_mode = 'softlight';
    e.ssao_enabled = true;
    e.ssao_radius = 0.7;
    e.ssao_intensity = 2.2;
    e.ssao_power = 1.5;
    e.ssao_detail = 0.6;
    e.ssil_enabled = true;
    e.ssil_radius = 2.0;
    e.ssil_intensity = 0.7;
    e.fog_enabled = true;
    e.fog_light_color = look.fog_color;
    e.fog_light_energy = 1.0;
    e.fog_density = look.fog_density;
    e.fog_height = look.fog_height;
    e.fog_height_density = look.fog_height_density;
    e.fog_sky_affect = 0.0;
    e.volumetric_fog_enabled = look.vol_density > 0.0;
    e.volumetric_fog_density = look.vol_density;
    e.volumetric_fog_albedo = look.vol_albedo;
    e.volumetric_fog_emission = look.vol_emission;
    e.volumetric_fog_anisotropy = 0.55;
    e.volumetric_fog_length = 48.0;
    e.adjustment_enabled = true;
    e.adjustment_contrast = 1.05;
    e.adjustment_saturation = 1.08;
    this.sky.top_color = look.sky_top;
    this.sky.horizon_color = look.sky_horizon;
    this.sky.bottom_color = look.sky_bottom;
    this.sky.glow_color = look.sky_glow;
    this.sky.glow_dir = look.sky_glow_dir;
    this.sky.version += 1;
    this._aim(this._key, look.sun_dir);
    this._aim(this._fill, look.fill_dir);
  }

  _aim(light, direction) {
    const d = direction.normalized();
    light.basis = Basis.looking_at(d, Math.abs(d.y) < 0.99 ? Vector3.UP : Vector3.FORWARD);
  }

  _apply_mood(mood) {
    this._mood = mood;
    const look = this._look;
    if (!look) return;
    const level = mood.x;
    const warmth = mood.y;
    const cold = clampf((1.0 - level) / 0.55, 0.0, 1.0);
    const bright = clampf(level - 1.0, 0.0, 1.0);
    const sun = look.sun_color.lerp(new Color(0.62, 0.7, 0.95), cold * 0.55).lerp(new Color(1.0, 0.64, 0.36), warmth * 0.5);
    this._key.light_color = sun;
    this._key.light_energy = look.sun_energy * level;
    this._fill.light_color = look.fill_color;
    this._fill.light_energy = look.fill_energy * lerpf(1.0, 0.8, cold);
    this.environment.ambient_light_color = look.ambient.lerp(new Color(0.24, 0.3, 0.5), cold * 0.6).lerp(new Color(0.55, 0.42, 0.34), warmth * 0.3);
    this.environment.ambient_light_energy = look.ambient_energy * lerpf(1.0, 0.65, cold) * (1.0 + bright * 0.35);
    this.environment.adjustment_saturation = 1.08 - cold * 0.3 + bright * 0.1;
    this.environment.tonemap_exposure = look.exposure * (1.0 + bright * 0.12);
  }

  _flame_mood() {
    return lerpf(0.55, 1.0, clampf((this._mood.x - 0.45) / 0.55, 0.0, 1.0)) * (1.0 + clampf(this._mood.x - 1.0, 0.0, 1.0) * 0.6 + this._mood.y * 0.2);
  }

  _build_materials() {
    const look = this._look;
    this._materials.stone = new SpatialMaterial(STONE_SHADER, {
      stone_a: look.stone_a, stone_b: look.stone_b, stone_edge: look.stone_edge,
      moss_a: look.moss_a, moss_b: look.moss_b, moss: look.moss, wet: look.wet, rough: look.rough,
    });
    this._materials.bed = new StandardMaterial3D({ albedo_color: new Color(0.07, 0.062, 0.06), roughness: 1.0 });
  }

  _build_platform() {
    const bed = new MeshInstance3D('Bed');
    bed.mesh = boxMesh(V3(RIM_IN * 2.0 + 0.3, 0.5, RIM_IN * 2.0 + 0.3));
    bed.position = V3(0, -0.03 - 0.25, 0);
    bed.material_override = this._materials.bed;
    this._content.add_child(bed);
    for (let side = 0; side < 4; side++) {
      this._lay_rim(side);
      for (let course = 1; course <= SKIN_COURSES; course++) this._lay_skin(side, course);
    }
    for (let corner = 0; corner < 4; corner++) this._lay_corner(corner);
  }

  /** The top course around the board: blocks of random length, some gaps, some stacked. */
  _lay_rim(side) {
    const rng = this._rng;
    const n = SIDES[side];
    const t = V3(-n.z, 0.0, n.x);
    let along = -RIM_IN;
    const farSide = side === 0 || side === 3;
    while (along < RIM_IN - 0.05) {
      let length = rng.randf_range(0.38, 0.6);
      if (rng.randf() < 0.12) length = rng.randf_range(0.8, 0.95);
      length = Math.min(length, RIM_IN - along);
      if (length < 0.2) break;
      const mid = along + length * 0.5;
      const gap = rng.randf() < 0.07;
      let height = rng.randf_range(0.36, 0.44);
      const depth = rng.randf_range(0.44, 0.52);
      if (gap) height *= rng.randf_range(0.35, 0.55);
      const inset = RIM_IN + depth * 0.5 + rng.randf_range(0.0, 0.03);
      const center = n.mul(inset).add(t.mul(mid)).add(Vector3.UP.mul(RIM_BASE + height * 0.5));
      this._add_block(center, V3(length - 0.03, height, depth), n, 0.25, 1.0);
      const stackChance = farSide ? 0.28 : 0.08;
      if (!gap && rng.randf() < stackChance) {
        const h2 = rng.randf_range(0.32, 0.4);
        const l2 = Math.min(length, rng.randf_range(0.36, 0.5));
        const offIn = inset + rng.randf_range(-0.03, 0.03);
        const offMid = mid + rng.randf_range(-0.06, 0.06);
        const c2 = n.mul(offIn).add(t.mul(offMid)).add(Vector3.UP.mul(RIM_BASE + height + h2 * 0.5 + 0.005));
        this._add_block(c2, V3(l2 - 0.03, h2, depth * rng.randf_range(0.8, 0.95)), n, 0.35, 1.0);
      }
      along += length;
    }
  }

  /** The courses below the rim, staggered, ragged near the bottom. */
  _lay_skin(side, course) {
    const rng = this._rng;
    const n = SIDES[side];
    const t = V3(-n.z, 0.0, n.x);
    let along = -RIM_IN - (course % 2 === 1 ? 0.22 : 0.0);
    const top = RIM_BASE - (course - 1) * COURSE;
    const ragged = course >= SKIN_COURSES - 2;
    while (along < RIM_IN - 0.05) {
      let length = rng.randf_range(0.4, 0.62);
      if (rng.randf() < 0.18) length = rng.randf_range(0.8, 1.0);
      const start = Math.max(along, -RIM_IN);
      const end = Math.min(along + length, RIM_IN);
      along += length;
      if (end - start < 0.16) continue;
      if (ragged && rng.randf() < 0.3 + 0.2 * (course - SKIN_COURSES + 2)) continue;
      const height = COURSE - rng.randf_range(0.01, 0.035);
      const depth = rng.randf_range(0.46, 0.54);
      const out = RIM_OUT - depth * 0.5 + rng.randf_range(-0.035, 0.03);
      const center = n.mul(out).add(t.mul(start + end).mul(0.5)).add(Vector3.UP.mul(top - COURSE * 0.5 - 0.01));
      this._add_block(center, V3(end - start - 0.025, height, depth), n, 0.06, 1.0);
    }
  }

  _lay_corner(corner) {
    const rng = this._rng;
    const sx = corner === 1 || corner === 2 ? 1.0 : -1.0;
    const sz = corner >= 2 ? 1.0 : -1.0;
    const c = V3(sx, 0.0, sz).mul(RIM_IN + WALL_DEPTH * 0.5);
    const h = rng.randf_range(0.38, 0.44);
    this._add_block(c.add(Vector3.UP.mul(RIM_BASE + h * 0.5)), V3(0.5, h, 0.5), V3(sx, 0, 0), 0.3, 1.0);
    for (let course = 1; course < SKIN_COURSES; course++) {
      const top = RIM_BASE - (course - 1) * COURSE;
      this._add_block(c.add(Vector3.UP.mul(top - COURSE * 0.5 - 0.01)), V3(0.52, COURSE - 0.02, 0.52), V3(sx, 0, 0), 0.05, 1.0);
    }
  }

  /** Highest stone top under (x, z) — props sit on the wall where it actually is. */
  _surface(x, z, radius = 0.06) {
    let best = -Infinity;
    const point = new Vector2(x, z);
    for (const top of this._tops) {
      if (top[0].grow(radius).has_point(point)) best = Math.max(best, top[1]);
    }
    if (best === -Infinity) throw new Error(`no stone under (${x.toFixed(2)}, ${z.toFixed(2)})`);
    return V3(x, best, z);
  }

  _place(node, at, yaw = 0.0) {
    node.position = at;
    node.rotation = V3(node.rotation.x, yaw, node.rotation.z);
    this._content.add_child(node);
    return node;
  }

  _place_lit(prop, at, yaw = 0.0) {
    this._place(prop.node, at, yaw);
    for (const light of prop.lights) {
      this._flames.push({ light, speed: this._rng.randf_range(0.8, 1.25), phase: this._rng.randf() * 10.0, energy: light.light_energy, flicker: 0.14 });
    }
  }

  _glow(at, color, energy, reach) {
    const light = new OmniLight3D();
    light.position = at;
    light.light_color = color;
    light.light_energy = energy;
    light.omni_range = reach;
    light.shadow_enabled = false;
    light.light_volumetric_fog_energy = 2.0;
    this._content.add_child(light);
    this._flames.push({ light, speed: 0.3, phase: this._rng.randf() * 10.0, energy, flicker: 0.05 });
  }

  _pillar(base, height, moss) {
    const rng = this._rng;
    let y = base.y;
    this._add_block(V3(base.x, y + 0.11, base.z), V3(0.76, 0.22, 0.76), Vector3.FORWARD, moss, 0.5);
    y += 0.22;
    const shaft = height - 0.44;
    const drums = Math.max(1, Math.trunc(Math.round(shaft / 0.36)));
    for (let i = 0; i < drums; i++) {
      const h = shaft / drums;
      const nx = rng.randf_range(-0.015, 0.015);
      const nz = rng.randf_range(-0.015, 0.015);
      const nudge = V3(nx, 0, nz);
      this._add_block(V3(base.x, y + h * 0.5, base.z).add(nudge), V3(0.56, h - 0.015, 0.56), Vector3.FORWARD, moss, 1.2);
      y += h;
    }
    this._add_block(V3(base.x, y + 0.11, base.z), V3(0.7, 0.22, 0.7), Vector3.FORWARD, moss, 0.5);
    return V3(base.x, y + 0.22, base.z);
  }

  _rubble(center, n, spread, moss) {
    const rng = this._rng;
    for (let i = 0; i < n; i++) {
      const s = rng.randf_range(0.08, 0.17);
      const ax = rng.randf_range(-spread, spread);
      const az = rng.randf_range(-spread, spread);
      const at = center.add(V3(ax, 0, az));
      const fx = rng.randf_range(-1, 1);
      const fz = rng.randf_range(-1, 1);
      const facing = V3(fx, 0, fz).normalized();
      this._add_block(at.add(Vector3.UP.mul(s).mul(0.45)), V3(s * rng.randf_range(0.9, 1.4), s * 0.8, s), facing, moss, 3.0);
    }
  }

  /** Ivy hanging from a wall top: two strands of leaves plus a tuft on top. */
  _vine(top, n, length, autumn = 0.15) {
    const rng = this._rng;
    const t = V3(-n.z, 0, n.x);
    const drift = rng.randf_range(-1.0, 1.0);
    const steps = Math.trunc(length / 0.05);
    for (let strand = 0; strand < 2; strand++) {
      let p = top.add(n.mul(0.03)).add(t.mul(strand - 0.5).mul(0.14));
      const wander = drift + rng.randf_range(-0.5, 0.5);
      const strandSteps = strand === 0 ? steps : Math.trunc(steps * rng.randf_range(0.5, 0.85));
      for (let i = 0; i < strandSteps; i++) {
        p = p.add(Vector3.DOWN.mul(0.05)).add(t.mul(Math.sin(i * 0.45 + wander * 4.0) * 0.016 + wander * 0.006));
        const taper = lerpf(1.0, 0.6, i / steps);
        for (let k = 0; k < 3; k++) {
          const across = rng.randf_range(-0.08, 0.08);
          const outward = rng.randf_range(0.0, 0.06);
          const at = p.add(t.mul(across).mul(taper)).add(n.mul(outward));
          const twist = rng.randf_range(-0.6, 0.6);
          const lift = rng.randf_range(-0.2, 0.5);
          const facing = n.add(t.mul(twist)).add(Vector3.UP.mul(lift)).normalized();
          this._leaves[0].push(ArenaProps.leaf(rng, at, facing, rng.randf_range(0.11, 0.17) * taper, this._leaf_color(autumn), 1.0));
        }
      }
    }
    for (let k = 0; k < 18; k++) {
      const a = rng.randf_range(-0.24, 0.24);
      const b = rng.randf_range(0.0, 0.3);
      const at = top.add(t.mul(a)).sub(n.mul(b)).add(Vector3.UP.mul(0.01));
      const fa = rng.randf_range(0.0, 0.8);
      const fb = rng.randf_range(-0.5, 0.5);
      const facing = Vector3.UP.mul(1.4).add(n.mul(fa)).add(t.mul(fb)).normalized();
      this._leaves[0].push(ArenaProps.leaf(rng, at, facing, rng.randf_range(0.12, 0.17), this._leaf_color(autumn), 0.6));
    }
  }

  _bush(center, radius, autumn = 0.1) {
    const rng = this._rng;
    const count = Math.trunc(radius * 260.0);
    for (let k = 0; k < count; k++) {
      const dx = rng.randf_range(-1, 1);
      const dy = rng.randf_range(0.1, 1.0);
      const dz = rng.randf_range(-1, 1);
      const direction = V3(dx, dy, dz).normalized();
      const at = center.add(direction.mul(radius).mul(rng.randf_range(0.5, 1.0)));
      this._leaves[0].push(ArenaProps.leaf(rng, at, direction, rng.randf_range(0.12, 0.18), this._leaf_color(autumn), 0.8));
    }
  }

  _fallen(a, b, count) {
    const rng = this._rng;
    for (let k = 0; k < count; k++) {
      const along = rng.randf();
      const ox = rng.randf_range(-0.12, 0.12);
      const oz = rng.randf_range(-0.12, 0.12);
      const point = a.lerp(b, along).add(new Vector2(ox, oz));
      const at = this._surface(point.x, point.y);
      const pick = AUTUMN[rng.randi() % AUTUMN.length];
      const color = pick.mul(rng.randf_range(0.75, 1.1));
      this._leaves[1].push(ArenaProps.fallen_leaf(rng, at, rng.randf_range(0.13, 0.2), color));
    }
  }

  _leaf_color(autumn) {
    const rng = this._rng;
    const palette = rng.randf() < autumn ? AUTUMN : IVY;
    const pick = palette[rng.randi() % palette.length];
    return pick.mul(rng.randf_range(0.8, 1.15));
  }

  _flush_leaves() {
    for (const shape of [0, 1, 2]) {
      if (this._leaves[shape].length > 0) {
        const leaves = ArenaProps.foliage(this._leaves[shape], shape);
        leaves.label = `leaf:${shape}`;
        this._content.add_child(leaves);
      }
    }
    this._leaves = { 0: [], 1: [], 2: [] };
  }

  _rim(side, along, depth = RIM_MID) {
    const n = SIDES[side];
    const t = V3(-n.z, 0.0, n.x);
    const point = n.mul(depth).add(t.mul(along));
    return this._surface(point.x, point.z);
  }

  _corner(sx, sz) {
    return this._surface(sx * RIM_MID, sz * RIM_MID);
  }

  /** Where the i-th relic sits on the near wall. */
  relic_spot(index) {
    if (index < 0 || index >= RELIC_SLOTS.length) throw new Error(`No relic slot ${index}`);
    return this._surface(RELIC_SLOTS[index], RIM_MID, RELIC_FOOTPRINT);
  }

  _dress_outpost() {
    const rng = this._rng;
    const foot = this._corner(-1, -1);
    const pillarTop = this._pillar(foot, 1.5, 0.8);
    this._bush(this._rim(3, -2.3).add(V3(0.0, 0.16, 0.0)), 0.26, 0.25);
    this._rubble(this._rim(0, -2.2), 3, 0.08, 0.6);
    this._place(ArenaProps.banner(1.9, new Color(0.46, 0.07, 0.07), new Color(0.86, 0.63, 0.27)), this._rim(0, 1.5), 0.0);
    this._place_lit(ArenaProps.lantern(), this._corner(1, -1), 0.3);
    this._place(ArenaProps.books(rng), this._corner(-1, 1), 0.4);
    const cloth = ArenaProps.hanging_cloth(0.62, 1.45, new Color(0.46, 0.07, 0.07), new Color(0.86, 0.63, 0.27), true);
    const hang = this._rim(2, -1.9);
    this._place(cloth, V3(hang.x, hang.y - 0.02, RIM_OUT + 0.06));
    this._place(ArenaProps.crate(0.42), this._rim(3, -1.6), 0.35);
    for (const spot of [[2, 0.0, 1.0], [2, 1.0, 0.7], [2, 2.0, 1.2], [1, 2.2, 0.9], [1, 0.3, 1.1], [1, -1.9, 0.6]]) {
      const side = spot[0];
      this._vine(this._rim(side, spot[1], RIM_OUT - 0.02), SIDES[side], spot[2], 0.18);
    }
    for (const spot of [[0, -1.2, 0.5], [3, 0.8, 0.55], [3, -0.4, 0.35]]) {
      const side = spot[0];
      this._vine(this._rim(side, spot[1], RIM_IN + 0.02), SIDES[side].neg(), spot[2], 0.1);
    }
    this._fallen(new Vector2(-2.6, -RIM_MID), new Vector2(-0.8, -RIM_MID), 9);
    this._fallen(new Vector2(-RIM_MID, 0.4), new Vector2(-RIM_MID, 2.4), 8);
    this._fallen(new Vector2(1.2, RIM_MID), new Vector2(2.8, RIM_MID), 6);
    this._fallen(new Vector2(RIM_MID, -0.6), new Vector2(RIM_MID, 1.8), 6);
    this._place_lit(ArenaProps.candles(rng), pillarTop);
  }

  _dress_crypt() {
    const rng = this._rng;
    const tallLeft = this._pillar(this._corner(-1, -1), 1.6, 0.3);
    const tallRight = this._pillar(this._corner(1, -1), 1.3, 0.3);
    this._rubble(this._rim(3, 1.9), 3, 0.08, 0.3);
    this._pillar(this._corner(-1, 1), 0.6, 0.3);
    this._pillar(this._rim(0, -0.2), 0.75, 0.3);
    this._rubble(this._rim(1, 1.6), 4, 0.12, 0.3);
    this._place_lit(ArenaProps.candles(rng), tallLeft);
    this._place_lit(ArenaProps.candles(rng), tallRight);
    this._place_lit(ArenaProps.candles(rng), this._rim(3, 1.2));
    this._place_lit(ArenaProps.candles(rng), this._rim(2, 2.0));
    this._place_lit(ArenaProps.candles(rng), this._rim(0, 1.6));
    this._glow(V3(-4.3, 1.2, -4.3), new Color(0.2, 0.85, 0.8), 3.2, 6.0);
    this._glow(V3(4.2, 0.9, -4.4), new Color(0.15, 0.7, 0.75), 2.4, 5.0);
    this._place(ArenaProps.books(rng), this._rim(3, -1.4), -0.3);
    for (const spot of [[2, -1.0, 0.8], [1, -0.8, 0.6], [2, 1.0, 0.5]]) {
      const side = spot[0];
      this._vine(this._rim(side, spot[1], RIM_OUT - 0.02), SIDES[side], spot[2], 0.0);
    }
  }

  _dress_court() {
    const rng = this._rng;
    const red = new Color(0.5, 0.06, 0.06);
    const trim = new Color(0.9, 0.66, 0.28);
    this._place(ArenaProps.banner(2.0, red, trim), this._corner(-1, -1), PI * 0.25);
    this._place(ArenaProps.banner(2.0, red, trim), this._corner(1, -1), -PI * 0.25);
    this._place_lit(ArenaProps.candelabra(), this._corner(-1, 1), 0.4);
    this._place_lit(ArenaProps.candelabra(), this._corner(1, 1), -0.4);
    this._place_lit(ArenaProps.candles(rng), this._rim(0, -1.0));
    this._place_lit(ArenaProps.candles(rng), this._rim(3, 0.9));
    for (const spot of [[2, -1.6], [2, 1.6], [1, -1.6], [1, 1.6]]) {
      const side = spot[0];
      const n = SIDES[side];
      const t = V3(-n.z, 0.0, n.x);
      let top = this._rim(side, spot[1]);
      top = V3(top.x, Math.max(top.y, Math.max(this._rim(side, spot[1] - 0.26).y, this._rim(side, spot[1] + 0.26).y)), top.z);
      const edge = top.add(n.mul(RIM_OUT - RIM_MID + 0.06));
      const path = [top.sub(n.mul(0.22)).add(Vector3.UP.mul(0.01)), edge.add(Vector3.UP.mul(0.01)), edge.add(Vector3.DOWN.mul(0.95))];
      this._place(ArenaProps.runner(path, t, 0.56, red, trim), Vector3.ZERO);
    }
    this._place(ArenaProps.books(rng), this._rim(3, -1.5), 0.2);
  }

  /** Queues one stone: picks a kit mesh, jitters its rotation, records its top for prop placement. */
  _add_block(center, size, facing, moss, jitter) {
    const rng = this._rng;
    const kind = size.x > size.z * 1.55 || size.x > size.y * 1.8 ? 'brick' : 'cube';
    const variants = kind === 'brick' ? 3 : 6;
    const meshSize = kind === 'brick' ? V3(2.0, 1.0, 1.0) : Vector3.ONE;
    const key = format('%s%d', [kind, rng.randi() % variants]);
    let yaw = Math.atan2(facing.x, facing.z);
    if (rng.randf() < 0.5) yaw += PI;
    let basis = Basis.from_axis_angle(Vector3.UP, yaw + rng.randf_range(-0.035, 0.035) * jitter);
    const tiltX = Basis.from_axis_angle(Vector3.RIGHT, rng.randf_range(-0.02, 0.02) * jitter);
    basis = basis.mul(tiltX);
    const tiltZ = Basis.from_axis_angle(Vector3.FORWARD, rng.randf_range(-0.02, 0.02) * jitter);
    basis = basis.mul(tiltZ);
    basis = basis.mul(Basis.from_scale(size.div(meshSize)));
    const reach = Math.abs(facing.z) >= Math.abs(facing.x) ? new Vector2(size.x, size.z).mul(0.5) : new Vector2(size.z, size.x).mul(0.5);
    this._tops.push([new Rect2(new Vector2(center.x, center.z).sub(reach), reach.mul(2.0)), center.y + size.y * 0.5]);
    const shade = rng.randf_range(0.84, 1.1);
    const warm = rng.randf_range(-0.04, 0.04);
    const tint = new Color(shade * (1.0 + warm), shade, shade * (1.0 - warm), clampf(moss * rng.randf_range(0.5, 1.5), 0.0, 1.0));
    if (!this._blocks.has(key)) this._blocks.set(key, []);
    this._blocks.get(key).push([new Transform3D(basis, center), tint]);
  }

  _flush_blocks() {
    for (const [key, entries] of this._blocks) {
      const instance = new MultiMeshInstance3D(Arena._kit_mesh(key), this._materials.stone, entries.map((e) => e[0]), entries.map((e) => e[1]));
      instance.label = key;
      this._content.add_child(instance);
    }
    this._blocks = new Map();
  }

  static _kit_mesh(key) {
    if (!kit.has(key)) {
      const index = Number(key.slice(-1));
      const seed = 100 + index * 17 + (key.startsWith('cube') ? 0 : 1000);
      if (key.startsWith('brick')) kit.set(key, Arena._block_mesh(V3(2.0, 1.0, 1.0), 0.1, 0.035, 2 + (index % 2), seed, [5, 2, 2]));
      else kit.set(key, Arena._block_mesh(Vector3.ONE, 0.1, 0.035, 1 + (index % 3), seed, [2, 2, 2]));
    }
    return kit.get(key);
  }

  static _axis_steps(half, radius, inner) {
    const steps = [F(-half), F(-half + radius * 0.42)];
    for (let i = 0; i < inner + 1; i++) steps.push(F(lerpf(-half + radius, half - radius, i / inner)));
    steps.push(F(half - radius * 0.42));
    steps.push(F(half));
    return steps;
  }

  /**
   * A rounded, lumpy, chipped stone: a subdivided box whose vertices are pushed onto a rounded box,
   * displaced by 3D noise, sheared/tapered, then cut by chip planes. UV2.x = bevel wear, UV2.y = chip.
   * Returns indexed geometry (arrays flipped once for three.js). O(vertices · chips).
   */
  static _block_mesh(size, radius, lump, chips, seed, inner, fixedChips = []) {
    const rng = new RandomNumberGenerator();
    rng.seed = seed;
    const noise = new FastNoiseLite();
    noise.seed = seed;
    noise.noise_type = NOISE_TYPE.SIMPLEX_SMOOTH;
    noise.fractal_type = FRACTAL_TYPE.NONE;
    noise.frequency = 1.4;
    const h = size.mul(0.5);
    const r = Math.min(radius, Math.min(h.x, Math.min(h.y, h.z)) * 0.9);
    const steps = [Arena._axis_steps(h.x, r, inner[0]), Arena._axis_steps(h.y, r, inner[1]), Arena._axis_steps(h.z, r, inner[2])];
    const lookup = new GDict();
    const box = [];
    const indices = [];
    for (let axis = 0; axis < 3; axis++) {
      const uAxis = (axis + 1) % 3;
      const vAxis = (axis + 2) % 3;
      const us = steps[uAxis];
      const vs = steps[vAxis];
      for (const side of [-1.0, 1.0]) {
        const faceNormal = Vector3.ZERO;
        faceNormal.set_index(axis, side);
        const grid = [];
        for (let j = 0; j < vs.length; j++) {
          for (let i = 0; i < us.length; i++) {
            const p = Vector3.ZERO;
            p.set_index(axis, h.get_index(axis) * side);
            p.set_index(uAxis, us[i]);
            p.set_index(vAxis, vs[j]);
            let id = lookup.get(p, -1);
            if (id < 0) {
              id = box.length;
              box.push(p);
              lookup.set(p, id);
            }
            grid.push(id);
          }
        }
        const nu = us.length;
        for (let j = 0; j < vs.length - 1; j++) {
          for (let i = 0; i < nu - 1; i++) {
            const a = grid[j * nu + i];
            const b = grid[j * nu + i + 1];
            const c = grid[(j + 1) * nu + i + 1];
            const d = grid[(j + 1) * nu + i];
            if (box[b].sub(box[a]).cross(box[c].sub(box[a])).dot(faceNormal) > 0.0) indices.push(a, c, b, a, d, c);
            else indices.push(a, b, c, a, c, d);
          }
        }
      }
    }
    const count = box.length;
    const verts = new Array(count);
    const uv = new Array(count);
    const uv2 = new Array(count);
    const innerH = h.sub(V3(r, r, r));
    const on = lump > 0.0 ? 1.0 : 0.0;
    const shearX = rng.randf_range(-0.03, 0.03);
    const shearY = rng.randf_range(-0.03, 0.03);
    const shear = new Vector2(shearX, shearY).mul(on);
    const taper = rng.randf_range(0.0, 0.05) * on;
    const ox = rng.randf_range(-50, 50);
    const oy = rng.randf_range(-50, 50);
    const oz = rng.randf_range(-50, 50);
    const noiseOffset = V3(ox, oy, oz);
    for (let k = 0; k < count; k++) {
      const p = box[k];
      const q = p.clamp(innerH.neg(), innerH);
      const n = p.sub(q).normalized();
      let v = q.add(n.mul(r));
      if (lump > 0.0) {
        v = v.add(n.mul(noise.get_noise_3dv(v.add(noiseOffset))).mul(lump));
        const rise = (v.y / h.y) * 0.5 + 0.5;
        v.x = v.x + (v.y * shear.x - v.x * taper * rise);
        v.z = v.z + (v.y * shear.y - v.z * taper * rise);
      }
      verts[k] = v;
      const d = [h.x - Math.abs(p.x), h.y - Math.abs(p.y), h.z - Math.abs(p.z)].sort((x, y) => x - y);
      uv2[k] = new Vector2(1.0 - smoothstep(0.0, r * 2.6, d[1]), 0.0);
      uv[k] = new Vector2(p.y / h.y, (p.x + p.z) / (h.x + h.z));
    }
    const chipList = fixedChips.slice();
    for (let c = 0; c < chips; c++) {
      const cx = rng.randf() < 0.5 ? 1.0 : -1.0;
      const cy = rng.randf() < 0.72 ? 1.0 : -1.0;
      const cz = rng.randf() < 0.5 ? 1.0 : -1.0;
      const corner = V3(cx, cy, cz);
      const dx = corner.x * rng.randf_range(0.45, 1.0);
      const dy = corner.y * rng.randf_range(0.45, 1.0);
      const dz = corner.z * rng.randf_range(0.45, 1.0);
      const dir = V3(dx, dy, dz);
      const at = V3(corner.x * h.x, corner.y * h.y, corner.z * h.z);
      if (rng.randf() < 0.45) {
        const flat = rng.randi() % 3;
        dir.set_index(flat, dir.get_index(flat) * 0.12);
        at.set_index(flat, at.get_index(flat) * rng.randf_range(-0.6, 0.6));
      }
      chipList.push({ dir, depth: rng.randf_range(0.14, 0.34) * Math.min(h.x, Math.min(h.y, h.z)), at });
    }
    for (const chip of chipList) {
      const dir = chip.dir.normalized();
      const plane = chip.at.dot(dir) - chip.depth;
      for (let k = 0; k < count; k++) {
        const excess = verts[k].dot(dir) - plane;
        if (excess > 0.0) {
          verts[k] = verts[k].sub(dir.mul(excess));
          uv2[k] = new Vector2(uv2[k].x, 1.0);
        }
      }
    }
    const normals = new Array(count).fill(null).map(() => Vector3.ZERO);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const face = verts[c].sub(verts[a]).cross(verts[b].sub(verts[a]));
      normals[a] = normals[a].add(face);
      normals[b] = normals[b].add(face);
      normals[c] = normals[c].add(face);
    }
    const positions = new Float32Array(count * 3);
    const normalArray = new Float32Array(count * 3);
    const uvArray = new Float32Array(count * 2);
    const uv2Array = new Float32Array(count * 2);
    const colors = new Float32Array(count * 4).fill(1);
    for (let k = 0; k < count; k++) {
      const n = normals[k].normalized();
      positions.set([verts[k].x, verts[k].y, verts[k].z], k * 3);
      normalArray.set([n.x, n.y, n.z], k * 3);
      uvArray.set([uv[k].x, uv[k].y], k * 2);
      uv2Array.set([uv2[k].x, uv2[k].y], k * 2);
    }
    return fromGodotArrays({ positions, normals: normalArray, uvs: uvArray, uv2s: uv2Array, colors, indices: Uint32Array.from(indices) });
  }
}

export { THREE };
