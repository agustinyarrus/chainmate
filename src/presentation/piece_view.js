/**
 * PieceView — port of scripts/presentation/piece_view.gd: one chess piece on the board.
 * Lathe mesh per kind/tier (PieceMeshes), the piece shader with ivory/obsidian looks, a pick cylinder
 * for mouse picking, a pulsing threat ring, the tier-3 gold halo with sparks, and every animation the
 * battle plays (travel, bounce, shatter, promote, evolve, sink, topple, drop-in).
 */
import { Vector2, Vector3, Color, lerpf, fposmod, deg_to_rad, clampi } from '../godot/math.js';
import { Node3D, MeshInstance3D } from '../godot/node3d.js';
import { randf, randf_range } from '../godot/rng.js';
import { TRANS, EASE } from '../godot/tween.js';
import { SpatialMaterial, StandardMaterial3D } from '../godot/render/material.js';
import { planeMesh, torusMesh } from '../godot/render/primitives.js';
import { GPUParticles3D, ParticleProcessMaterial, Gradient, EMISSION_SHAPE, sparkMaterial } from '../godot/particles.js';
import { StaticBody3D, CollisionShape3D, CylinderShape3D } from '../godot/physics.js';
import { PieceMeshes } from './piece_meshes.js';
import { Palette } from './palette.js';
import { PIECE_SHADER, GLOW_RING_SHADER } from './shaders.js';

export const PICK_LAYER = 2;

export const IVORY = Object.freeze({
  albedo: new Color('d9c39f'), roughness: 0.6, metallic: 0.0, specular: 0.4, stone_wear: 1.15,
  foot_shade: 0.28, accent_color: new Color('c9943f'), accent_energy: 0.0, cloth_color: new Color('26437f'),
  gem_color: new Color('4f94ff'), gem_energy: 3.2, rim_color: new Color('e8d6b4'), rim_strength: 0.1,
  temper_color: new Color('d4a24e'), dissolve_edge_color: new Color(1.0, 0.62, 0.3),
});
export const OBSIDIAN = Object.freeze({
  albedo: new Color('1d1c22'), roughness: 0.3, metallic: 0.0, specular: 0.55, stone_wear: 0.6,
  foot_shade: 0.2, accent_color: new Color('8a6b4c'), accent_energy: 0.0, cloth_color: new Color('4a1620'),
  gem_color: new Color('ff4a36'), gem_energy: 2.4, rim_color: new Color('7c8496'), rim_strength: 0.3,
  temper_color: new Color('c0503a'), dissolve_edge_color: new Color(1.0, 0.25, 0.12),
});

let threatPlane = null;
let haloTorus = null;

export class PieceView extends Node3D {
  static PICK_LAYER = PICK_LAYER;
  static IVORY = IVORY;
  static OBSIDIAN = OBSIDIAN;

  constructor() {
    super('PieceView');
    this.piece_id = '';
    this.kind = '';
    this.friendly = true;
    this.level = 0;
    this.body = null;
    this.material = null;
    this.pick_body = null;
    this._pick_shape = null;
    this._threat_ring = null;
    this._threat_material = null;
    this._halo = null;
    this._glow = 0.0;
    this._glow_target = 0.0;
    this._glow_color = Palette.SELECT;
    this._lift = 0.0;
    this._lift_target = 0.0;
    this._time = 0.0;
    this._selected = false;
    this._hovered = false;
    this._targeted = false;
    this._hinted = false;
    this._threatened = false;
  }

  setup(piece) {
    this.piece_id = piece.id;
    this.friendly = piece.friendly;
    this._time = randf() * 10.0;
    this.body = new MeshInstance3D('Body');
    this.add_child(this.body);
    const values = this.friendly ? IVORY : OBSIDIAN;
    this.material = new SpatialMaterial(PIECE_SHADER, { ...values, glow_strength: 0.0 });
    this.body.material_override = this.material;

    this.pick_body = new StaticBody3D();
    this.pick_body.collision_layer = PICK_LAYER;
    this.pick_body.collision_mask = 0;
    this.pick_body.set_meta('piece_id', this.piece_id);
    this._pick_shape = new CollisionShape3D(new CylinderShape3D());
    this.pick_body.add_child(this._pick_shape);
    this.add_child(this.pick_body);

    this._threat_ring = new MeshInstance3D('ThreatRing');
    threatPlane ??= planeMesh(new Vector2(1.05, 1.05));
    this._threat_ring.mesh = threatPlane;
    this._threat_ring.position = new Vector3(0, 0.012, 0);
    this._threat_ring.cast_shadow = false;
    this._threat_material = new SpatialMaterial(GLOW_RING_SHADER, { color: Palette.THREAT, thickness: 0.07 });
    this._threat_ring.material_override = this._threat_material;
    this._threat_ring.visible = false;
    this.add_child(this._threat_ring);

    this.kind = String(piece.kind);
    this.set_level(Math.trunc(piece.level));
  }

  _apply_mesh() {
    this.body.mesh = PieceMeshes.get_mesh(this.kind, clampi(this.level, 0, PieceMeshes.MAX_TIER));
    const height = PieceMeshes.height(this.kind);
    const shape = this._pick_shape.shape;
    shape.radius = 0.38;
    shape.height = height + 0.1;
    this._pick_shape.position = new Vector3(0, shape.height * 0.5, 0);
    const rotation = this.body.rotation;
    rotation.y = this.kind === 'knight' ? (this.friendly ? deg_to_rad(-35.0) : deg_to_rad(160.0)) : 0.0;
    this.body.rotation = rotation;
    this.material.set_shader_parameter('temper_level', clampi(this.level, 0, 3));
    this._refresh_halo();
  }

  set_kind(newKind) {
    this.kind = newKind;
    this._apply_mesh();
  }

  set_level(newLevel) {
    this.level = newLevel;
    this._apply_mesh();
  }

  top_height() {
    return PieceMeshes.height(this.kind);
  }

  set_selected(on) {
    this._selected = on;
    this._refresh();
  }
  set_hovered(on) {
    this._hovered = on;
    this._refresh();
  }
  set_targeted(on) {
    this._targeted = on;
    this._refresh();
  }
  set_hinted(on) {
    this._hinted = on;
    this._refresh();
  }
  set_threatened(on) {
    this._threatened = on;
    this._threat_ring.visible = on;
  }

  clear_marks() {
    this._selected = false;
    this._hovered = false;
    this._targeted = false;
    this._hinted = false;
    this._refresh();
  }

  _refresh() {
    this._lift_target = this._selected ? 0.14 : this._hovered && this.friendly ? 0.04 : 0.0;
    if (this._selected) {
      this._glow_target = 0.9;
      this._glow_color = Palette.SELECT;
    } else if (this._hinted) {
      this._glow_target = 1.1;
      this._glow_color = Palette.HINT;
    } else if (this._targeted) {
      this._glow_target = 0.8;
      this._glow_color = Palette.CAPTURE;
    } else if (this._hovered) {
      this._glow_target = 0.4;
      this._glow_color = Palette.INK;
    } else {
      this._glow_target = 0.0;
    }
  }

  _process(delta) {
    this._time += delta;
    const blend = 1.0 - Math.exp(-delta * 10.0);
    this._glow = lerpf(this._glow, this._glow_target, blend);
    this._lift = lerpf(this._lift, this._lift_target, blend);
    let pulse = 1.0;
    if (this._targeted) pulse = 0.75 + 0.25 * Math.sin(this._time * 4.5);
    this.material.set_shader_parameter('glow_strength', this._glow * pulse);
    this.material.set_shader_parameter('glow_color', this._glow_color);
    const bob = this._selected ? Math.sin(this._time * 2.6) * 0.022 : 0.0;
    const bodyPosition = this.body.position;
    bodyPosition.y = this._lift + bob;
    this.body.position = bodyPosition;
    if (this._threatened) {
      const beat = fposmod(this._time * 0.9, 1.0);
      this._threat_material.set_shader_parameter('progress', 0.35 + beat * 0.5);
    }
    if (this._halo) {
      const rotation = this._halo.rotation;
      rotation.y += delta * 0.9;
      this._halo.rotation = rotation;
      const position = this._halo.position;
      position.y = this.top_height() * 0.62 + this._lift + Math.sin(this._time * 1.7) * 0.03;
      this._halo.position = position;
    }
  }

  /** Tier-3 friendly pieces wear a slowly turning gold ring that sheds sparks. */
  _refresh_halo() {
    if (this.level < 3 || !this.friendly) {
      if (this._halo) {
        this._halo.queue_free();
        this._halo = null;
      }
      return;
    }
    if (this._halo) return;
    this._halo = new Node3D('Halo');
    this.add_child(this._halo);
    const ring = new MeshInstance3D('HaloRing');
    haloTorus ??= torusMesh(0.36, 0.385, 48, 6);
    ring.mesh = haloTorus;
    ring.rotation_degrees = new Vector3(18, 0, 8);
    ring.cast_shadow = false;
    ring.material_override = new StandardMaterial3D({
      shading_mode: 'unshaded',
      albedo_color: new Color(1.0, 0.8, 0.42),
      emission_enabled: true,
      emission: new Color(1.0, 0.72, 0.3),
      emission_energy_multiplier: 2.2,
    });
    this._halo.add_child(ring);
    const sparks = new GPUParticles3D();
    sparks.amount = 14;
    sparks.lifetime = 1.6;
    const process = new ParticleProcessMaterial();
    process.emission_shape = EMISSION_SHAPE.RING;
    process.emission_ring_axis = Vector3.UP;
    process.emission_ring_radius = 0.38;
    process.emission_ring_inner_radius = 0.3;
    process.emission_ring_height = 0.05;
    process.direction = Vector3.UP;
    process.spread = 25.0;
    process.initial_velocity_min = 0.08;
    process.initial_velocity_max = 0.25;
    process.gravity = new Vector3(0, 0.05, 0);
    process.scale_min = 0.5;
    process.scale_max = 1.0;
    const fade = new Gradient();
    fade.set_color(0, new Color(1.0, 0.9, 0.6, 0.0));
    fade.set_color(1, new Color(1.0, 0.75, 0.35, 0.0));
    fade.add_point(0.3, new Color(1.0, 0.88, 0.55, 1.0));
    process.color_ramp = fade;
    sparks.process_material = process;
    sparks.set_draw_pass(0.05, 2.4);
    this._halo.add_child(sparks);
  }

  /** Moves to `to` along a smoothstep path with an arc ("jump" high, "hop" low, "slide" flat-ish). */
  travel(to, style, duration) {
    const from = this.position;
    const distance = new Vector2(to.x - from.x, to.z - from.z).length();
    let arc = 0.12;
    if (style === 'jump') arc = 0.75 + distance * 0.12;
    else if (style === 'hop') arc = 0.3;
    const step = (t) => {
      const eased = t * t * (3.0 - 2.0 * t);
      const point = from.lerp(to, eased);
      point.y += Math.sin(Math.PI * t) * arc;
      this.position = point;
    };
    const tween = this.create_tween();
    tween.tween_method(step, 0.0, 1.0, duration);
    tween.tween_callback(() => {
      this.body.scale = new Vector3(1.08, 0.9, 1.08);
    });
    tween.tween_property(this.body, 'scale', Vector3.ONE, 0.16).set_trans(TRANS.BACK).set_ease(EASE.OUT);
    return tween;
  }

  /** A blocked attack: lunge 45 % of the way (and up), then bounce home. */
  bounce_towards(target, duration) {
    const home = this.position;
    const strike = home.lerp(target, 0.45).add(Vector3.UP.mul(0.2));
    const tween = this.create_tween();
    tween.tween_property(this, 'position', strike, duration * 0.45).set_trans(TRANS.QUAD).set_ease(EASE.OUT);
    tween.tween_property(this, 'position', home, duration * 0.55).set_trans(TRANS.BOUNCE).set_ease(EASE.OUT);
    return tween;
  }

  shatter(vfx, power = 1.0) {
    this.pick_body.collision_layer = 0;
    this.set_threatened(false);
    this.clear_marks();
    this._glow = 0.0;
    const color = this.friendly ? IVORY.albedo : new Color('2a2830');
    vfx.shards(this.global_position, color, 12 + Math.trunc(power * 6.0), power);
    const tween = this.create_tween();
    tween.tween_method((v) => this.material.set_shader_parameter('dissolve', v), 0.0, 1.0, 0.42);
    tween.tween_callback(() => this.queue_free());
  }

  promote(vfx) {
    vfx.pillar(this.global_position, Palette.GOLD_BRIGHT);
    vfx.burst(this.global_position.add(Vector3.UP.mul(0.6)), Palette.GOLD_BRIGHT, 30, 2.6);
    const becomeQueen = () => {
      this.set_kind('queen');
      this.material.set_shader_parameter('promoted', 1.0);
    };
    const tween = this.create_tween();
    tween.tween_property(this, 'scale', new Vector3(1.25, 0.6, 1.25), 0.12);
    tween.tween_callback(becomeQueen);
    tween.tween_property(this, 'scale', Vector3.ONE, 0.35).set_trans(TRANS.ELASTIC).set_ease(EASE.OUT);
  }

  evolve(vfx, newLevel) {
    vfx.pillar(this.global_position, Palette.MOVE);
    vfx.burst(this.global_position.add(Vector3.UP.mul(0.4)), Palette.MOVE.lightened(0.3), 26, 2.2, 0.07);
    this._glow = 2.4;
    this._glow_color = Palette.MOVE;
    const tween = this.create_tween();
    tween.tween_interval(0.18);
    tween.tween_callback(() => this.set_level(newLevel));
    tween.tween_property(this.body, 'scale', new Vector3(1.12, 1.12, 1.12), 0.1);
    tween.tween_property(this.body, 'scale', Vector3.ONE, 0.3).set_trans(TRANS.BACK).set_ease(EASE.OUT);
  }

  sink(delay) {
    this.pick_body.collision_layer = 0;
    this.set_threatened(false);
    const tween = this.create_tween();
    tween.tween_interval(delay);
    tween.tween_method((v) => this.material.set_shader_parameter('dissolve', v), 0.0, 1.0, 0.5);
    tween.parallel().tween_property(this, 'position:y', this.position.y - 0.25, 0.5);
    tween.tween_callback(() => this.queue_free());
    return tween;
  }

  topple(delay) {
    this.set_threatened(false);
    const tween = this.create_tween();
    tween.tween_interval(delay);
    const axis = new Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)).normalized();
    tween.tween_property(this, 'rotation', axis.mul(deg_to_rad(80.0)), 0.55).set_trans(TRANS.BOUNCE).set_ease(EASE.OUT);
  }

  drop_in(delay) {
    const rest = this.position;
    this.position = rest.add(Vector3.UP.mul(2.4));
    this.scale = Vector3.ONE.mul(0.85);
    const tween = this.create_tween();
    tween.tween_interval(delay);
    tween.tween_property(this, 'position', rest, 0.42).set_trans(TRANS.QUAD).set_ease(EASE.IN);
    tween.parallel().tween_property(this, 'scale', Vector3.ONE, 0.42);
    tween.tween_callback(() => {
      this.body.scale = new Vector3(1.1, 0.86, 1.1);
    });
    tween.tween_property(this.body, 'scale', Vector3.ONE, 0.2).set_trans(TRANS.BACK).set_ease(EASE.OUT);
  }
}
