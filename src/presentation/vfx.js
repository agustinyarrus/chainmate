/**
 * Vfx — port of scripts/presentation/vfx.gd: capture shards with bounce physics, spark bursts, board
 * shockwave rings, point-light flashes, floating Label3D text, promotion pillars, dust.
 * Same parameters, tweens and randomness (Godot's global RNG) as the original.
 */
import { AABB, Vector3, Color, Vector2 } from '../godot/math.js';
import { Node3D, MeshInstance3D, OmniLight3D } from '../godot/node3d.js';
import { isInstanceValid } from '../godot/scene.js';
import { randf, randf_range } from '../godot/rng.js';
import { TRANS, EASE } from '../godot/tween.js';
import { SpatialMaterial, StandardMaterial3D } from '../godot/render/material.js';
import { boxMesh, cylinderMesh, planeMesh, prismMesh } from '../godot/render/primitives.js';
import { GPUParticles3D, ParticleProcessMaterial, Gradient, Curve, EMISSION_SHAPE, sparkMaterial } from '../godot/particles.js';
import { Label3D } from '../godot/label3d.js';
import { Fonts } from './ui/fonts.js';
import { GLOW_RING_SHADER } from './shaders.js';

const GRAVITY = 9.5;
const FLOOR_Y = 0.07;

let sharedMeshes = null;
/** BoxMesh / PrismMesh (size 1) shared by every shard; the pillar's CylinderMesh; the unit PlaneMesh. */
function meshes() {
  sharedMeshes ??= {
    box: boxMesh(),
    prism: prismMesh(),
    pillar: cylinderMesh(0.34, 0.44, 4.0, 64, 4, false, false),
  };
  return sharedMeshes;
}

export class Vfx extends Node3D {
  static GRAVITY = GRAVITY;
  static FLOOR_Y = FLOOR_Y;

  constructor() {
    super('Vfx');
    /** @type {Array<{node: MeshInstance3D, velocity: Vector3, axis: Vector3, spin: number, life: number, size: number}>} */
    this._shards = [];
  }

  /** Vfx.spark_material(energy) */
  static spark_material(energy = 1.6) {
    return sparkMaterial(energy);
  }

  /** Vfx.make_flame() — defined by the original (and unused by it); kept for completeness. */
  static make_flame() {
    const flame = new GPUParticles3D();
    flame.amount = 36;
    flame.lifetime = 0.9;
    flame.position = new Vector3(0, 0.22, 0);
    flame.visibility_aabb = new AABB(new Vector3(-1, -0.5, -1), new Vector3(2, 3, 2));
    const process = new ParticleProcessMaterial();
    process.emission_shape = EMISSION_SHAPE.SPHERE;
    process.emission_sphere_radius = 0.14;
    process.direction = Vector3.UP;
    process.spread = 12.0;
    process.initial_velocity_min = 0.45;
    process.initial_velocity_max = 0.85;
    process.gravity = new Vector3(0, 0.7, 0);
    process.scale_min = 0.7;
    process.scale_max = 1.25;
    const curve = new Curve();
    curve.add_point(new Vector2(0, 0.6));
    curve.add_point(new Vector2(0.35, 1.0));
    curve.add_point(new Vector2(1, 0.0));
    process.scale_curve = curve;
    const gradient = new Gradient();
    gradient.set_color(0, new Color(1.0, 0.85, 0.45, 0.9));
    gradient.set_color(1, new Color(0.8, 0.12, 0.04, 0.0));
    gradient.add_point(0.4, new Color(1.0, 0.45, 0.12, 0.7));
    process.color_ramp = gradient;
    flame.process_material = process;
    flame.set_draw_pass(0.32, 2.2);
    return flame;
  }

  /** Shard physics: gravity, floor bounce with friction, spin, shrink over the last 0.35 s. O(shards). */
  _process(delta) {
    for (let i = this._shards.length - 1; i >= 0; i--) {
      const shard = this._shards[i];
      const node = shard.node;
      shard.life -= delta;
      if (shard.life <= 0.0 || !isInstanceValid(node)) {
        if (isInstanceValid(node)) node.queue_free();
        this._shards.splice(i, 1);
        continue;
      }
      const velocity = shard.velocity.clone();
      velocity.y -= GRAVITY * delta;
      const next = node.position.add(velocity.mul(delta));
      if (next.y < FLOOR_Y) {
        next.y = FLOOR_Y;
        velocity.y = Math.abs(velocity.y) * 0.35;
        velocity.x *= 0.6;
        velocity.z *= 0.6;
      }
      shard.velocity = velocity;
      node.position = next;
      node.rotate(shard.axis, shard.spin * delta);
      const fade = Math.min(Math.max(shard.life / 0.35, 0.0), 1.0);
      node.scale = Vector3.ONE.mul(shard.size * fade);
    }
  }

  shards(origin, color, count = 16, power = 1.0) {
    const material = Vfx._shard_material(color);
    const kinds = [meshes().box, meshes().prism];
    for (let i = 0; i < count; i++) {
      const node = new MeshInstance3D('Shard');
      node.mesh = kinds[i % 2];
      node.material_override = material;
      node.cast_shadow = false;
      const size = randf_range(0.06, 0.15);
      node.scale = Vector3.ONE.mul(size);
      node.position = origin.add(new Vector3(randf_range(-0.15, 0.15), randf_range(0.2, 0.8), randf_range(-0.15, 0.15)));
      this.add_child(node);
      const direction = new Vector3(randf_range(-1, 1), randf_range(0.6, 1.6), randf_range(-1, 1)).normalized();
      this._shards.push({
        node,
        velocity: direction.mul(randf_range(2.2, 4.2)).mul(power),
        axis: new Vector3(randf(), randf(), randf()).normalized(),
        spin: randf_range(4.0, 14.0),
        life: randf_range(0.9, 1.5),
        size,
      });
    }
  }

  burst(origin, color, amount = 28, speed = 3.2, size = 0.09) {
    const particles = new GPUParticles3D();
    particles.one_shot = true;
    particles.explosiveness = 0.95;
    particles.amount = amount;
    particles.lifetime = 0.8;
    particles.position = origin;
    particles.visibility_aabb = new AABB(new Vector3(-4, -2, -4), new Vector3(8, 6, 8));
    const process = new ParticleProcessMaterial();
    process.emission_shape = EMISSION_SHAPE.SPHERE;
    process.emission_sphere_radius = 0.15;
    process.direction = Vector3.UP;
    process.spread = 75.0;
    process.initial_velocity_min = speed * 0.5;
    process.initial_velocity_max = speed;
    process.gravity = new Vector3(0, -6.5, 0);
    process.damping_min = 1.0;
    process.damping_max = 2.5;
    process.scale_min = 0.5;
    process.scale_max = 1.2;
    const gradient = new Gradient();
    gradient.set_color(0, new Color(color.lightened(0.4), 1.0));
    gradient.set_color(1, new Color(color, 0.0));
    process.color_ramp = gradient;
    particles.process_material = process;
    particles.set_draw_pass(size, 2.4);
    this.add_child(particles);
    particles.emitting = true;
    particles.finished.connect(() => particles.queue_free());
    return particles;
  }

  ring(origin, color, radius = 1.3, duration = 0.55) {
    const node = new MeshInstance3D('Ring');
    node.setOwnedMesh(planeMesh(new Vector2(radius * 2.0, radius * 2.0)));
    node.position = new Vector3(origin.x, 0.09, origin.z);
    node.cast_shadow = false;
    const material = new SpatialMaterial(GLOW_RING_SHADER, { color });
    node.material_override = material;
    this.add_child(node);
    const tween = node.create_tween();
    tween.tween_method((value) => material.set_shader_parameter('progress', value), 0.0, 1.0, duration).set_ease(EASE.OUT).set_trans(TRANS.CUBIC);
    tween.tween_callback(() => node.queue_free());
  }

  flash(origin, color, energy = 5.0, duration = 0.3, reach = 4.0) {
    const light = new OmniLight3D();
    light.position = origin.add(new Vector3(0, 0.8, 0));
    light.light_color = color;
    light.omni_range = reach;
    light.light_energy = energy;
    light.shadow_enabled = false;
    this.add_child(light);
    const tween = light.create_tween();
    tween.tween_property(light, 'light_energy', 0.0, duration).set_ease(EASE.OUT);
    tween.tween_callback(() => light.queue_free());
  }

  float_text(origin, text, color, size = 72, rise = 0.9, duration = 1.1) {
    const label = new Label3D();
    label.text = text;
    label.font = Fonts.display;
    label.font_size = size;
    label.pixel_size = 0.004;
    label.outline_size = 14;
    label.outline_modulate = new Color(0.02, 0.02, 0.03, 0.85);
    label.modulate = color;
    label.billboard = true;
    label.no_depth_test = true;
    label.render_priority = 10;
    label.outline_render_priority = 9;
    label.position = origin;
    label.scale = Vector3.ONE.mul(0.6);
    this.add_child(label);
    const tween = label.create_tween().set_parallel(true);
    tween.tween_property(label, 'scale', Vector3.ONE, 0.18).set_trans(TRANS.BACK).set_ease(EASE.OUT);
    tween.tween_property(label, 'position:y', origin.y + rise, duration).set_ease(EASE.OUT).set_trans(TRANS.QUART);
    tween.tween_property(label, 'modulate:a', 0.0, duration * 0.45).set_delay(duration * 0.55);
    tween.chain().tween_callback(() => label.queue_free());
    return label;
  }

  pillar(origin, color, duration = 0.9) {
    const node = new MeshInstance3D('Pillar');
    node.mesh = meshes().pillar;
    node.position = new Vector3(origin.x, 2.0, origin.z);
    node.cast_shadow = false;
    const material = Vfx._pillar_material(color);
    node.material_override = material;
    node.scale = new Vector3(0.2, 1.0, 0.2);
    this.add_child(node);
    const tween = node.create_tween();
    tween.tween_property(node, 'scale', new Vector3(1.0, 1.0, 1.0), duration * 0.25).set_trans(TRANS.BACK).set_ease(EASE.OUT);
    tween.tween_property(material, 'albedo_color:a', 0.0, duration * 0.75);
    tween.tween_callback(() => node.queue_free());
  }

  static _shard_material(color) {
    return new StandardMaterial3D({
      albedo_color: color,
      roughness: 0.35,
      emission_enabled: true,
      emission: color.lightened(0.3),
      emission_energy_multiplier: 0.25,
    });
  }

  static _pillar_material(color) {
    return new StandardMaterial3D({
      shading_mode: 'unshaded',
      transparency: 'alpha',
      blend_mode: 'add',
      cull_mode: 'disabled',
      albedo_color: new Color(color.r * 2.0, color.g * 2.0, color.b * 2.0, 0.55),
      disable_fog: true,
    });
  }

  /**
   * Shader warm-up (the original does this on the web build): one of each effect at `at`, so every
   * program exists before the first capture. The caller frees the returned holder after a few frames.
   */
  warm_up(at) {
    const hold = new Node3D('WarmUp');
    hold.position = at;
    this.add_child(hold);
    const shard = new MeshInstance3D();
    shard.mesh = meshes().box;
    shard.material_override = Vfx._shard_material(Color.WHITE);
    hold.add_child(shard);
    const pillarNode = new MeshInstance3D();
    pillarNode.mesh = meshes().pillar;
    pillarNode.material_override = Vfx._pillar_material(Color.WHITE);
    hold.add_child(pillarNode);
    const ringNode = new MeshInstance3D();
    ringNode.setOwnedMesh(planeMesh());
    ringNode.material_override = new SpatialMaterial(GLOW_RING_SHADER);
    hold.add_child(ringNode);
    const label = this.float_text(at, '+1', new Color(1, 1, 1, 0), 60, 0.0, 0.3);
    label.modulate = new Color(label.modulate, 0.0);
    // Named so the state trace (dev/trace.js) can tell the warm-up's draws from the game's.
    this.burst(at, Color.WHITE, 1, 0.01, 0.05).name = 'WarmUpBurst';
    return hold;
  }

  dust(origin) {
    this.burst(new Vector3(origin.x, 0.12, origin.z), new Color(0.75, 0.7, 0.62), 12, 1.1, 0.12);
  }
}
