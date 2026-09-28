/**
 * 3D nodes: Godot's Node3D family backed by THREE.Object3D.
 *
 * Transforms keep Godot semantics: `rotation` is YXZ Euler (three's 'YXZ' composes Ry·Rx·Rz, the
 * same matrix), `basis` can be assigned directly, `look_at` points −Z at the target. Getters return
 * fresh float32 Vector3 values (GDScript value semantics); assign the whole value to change it.
 */
import * as THREE from 'three';
import { Node } from './scene.js';
import { Vector3, Basis, Color } from './math.js';
import { lighting } from './render/lighting.js';

const tmpMatrix = new THREE.Matrix4();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

export class Node3D extends Node {
  constructor(name = '', object3d = new THREE.Group()) {
    super(name);
    this.object3d = object3d;
    this.object3d.rotation.order = 'YXZ';
    this.object3d.userData.node = this;
  }

  _childAdded(child) {
    if (child.object3d) this.object3d.add(child.object3d);
  }
  _childRemoved(child) {
    if (child.object3d) this.object3d.remove(child.object3d);
  }
  _childMoved() {}

  get position() {
    const p = this.object3d.position;
    return new Vector3(p.x, p.y, p.z);
  }
  set position(v) {
    this.object3d.position.set(v.x, v.y, v.z);
  }
  get rotation() {
    const r = this.object3d.rotation;
    return new Vector3(r.x, r.y, r.z);
  }
  set rotation(v) {
    this.object3d.rotation.set(v.x, v.y, v.z, 'YXZ');
  }
  get rotation_degrees() {
    return this.rotation.mul(180 / Math.PI);
  }
  set rotation_degrees(v) {
    this.rotation = v.mul(Math.PI / 180);
  }
  get scale() {
    const s = this.object3d.scale;
    return new Vector3(s.x, s.y, s.z);
  }
  set scale(v) {
    this.object3d.scale.set(v.x, v.y, v.z);
  }
  get visible() {
    return this.object3d.visible;
  }
  set visible(on) {
    this.object3d.visible = on;
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }

  /** `node.basis = b` — decomposed into rotation + scale. */
  set basis(b) {
    tmpMatrix.fromArray(b.toMatrixArray());
    tmpMatrix.decompose(tmpPosition, tmpQuaternion, tmpScale);
    this.object3d.quaternion.copy(tmpQuaternion);
    this.object3d.scale.copy(tmpScale);
  }
  get basis() {
    this.object3d.updateMatrix();
    const e = this.object3d.matrix.elements;
    return new Basis(new Vector3(e[0], e[4], e[8]), new Vector3(e[1], e[5], e[9]), new Vector3(e[2], e[6], e[10]));
  }

  get global_position() {
    this.object3d.updateWorldMatrix(true, false);
    tmpPosition.setFromMatrixPosition(this.object3d.matrixWorld);
    return new Vector3(tmpPosition.x, tmpPosition.y, tmpPosition.z);
  }
  set global_position(v) {
    const parent = this.object3d.parent;
    tmpPosition.set(v.x, v.y, v.z);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(tmpPosition);
    }
    this.object3d.position.copy(tmpPosition);
  }

  /** `rotate(axis, angle)` — rotation in parent space. */
  rotate(axis, angle) {
    tmpAxis.set(axis.x, axis.y, axis.z).normalize();
    tmpQuaternion.setFromAxisAngle(tmpAxis, angle);
    this.object3d.quaternion.premultiply(tmpQuaternion);
  }

  /** `rotate_object_local(axis, angle)` */
  rotate_object_local(axis, angle) {
    tmpAxis.set(axis.x, axis.y, axis.z).normalize();
    this.object3d.rotateOnAxis(tmpAxis, angle);
  }

  /** `look_at(target, up)` — Godot's −Z forward. */
  look_at(target, up = Vector3.UP) {
    const from = this.global_position;
    const basis = Basis.looking_at(target.sub(from), up);
    this.basis = basis;
  }

  isVisibleInTree() {
    let node = this.object3d;
    while (node) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return this._inside;
  }

  _dispose() {
    this.object3d.removeFromParent();
  }
}

/**
 * MeshInstance3D: `mesh` is a THREE.BufferGeometry, `material_override` a THREE material.
 * `object3d.userData.castShadow` is GeometryInstance3D.cast_shadow: the render pipeline draws the
 * mesh into the shadow atlas when it is on and the material is a caster.
 */
export class MeshInstance3D extends Node3D {
  constructor(name = '') {
    super(name, new THREE.Mesh(new THREE.BufferGeometry(), undefined));
    this.object3d.userData.castShadow = true;
    this._ownsGeometry = false;
  }
  get mesh() {
    return this.object3d.geometry;
  }
  set mesh(geometry) {
    if (this._ownsGeometry && this.object3d.geometry) this.object3d.geometry.dispose();
    this.object3d.geometry = geometry ?? new THREE.BufferGeometry();
    this._ownsGeometry = false;
  }
  /** Assign a geometry this node alone uses (disposed when replaced or freed). */
  setOwnedMesh(geometry) {
    this.mesh = geometry;
    this._ownsGeometry = true;
  }
  get material_override() {
    return this.object3d.material;
  }
  set material_override(material) {
    this.object3d.material = material;
  }
  /** GeometryInstance3D.cast_shadow: true / false (SHADOW_CASTING_SETTING_ON / OFF). */
  set cast_shadow(on) {
    this.object3d.userData.castShadow = Boolean(on);
  }
  get cast_shadow() {
    return this.object3d.userData.castShadow;
  }
  _dispose() {
    super._dispose();
    if (this._ownsGeometry) this.object3d.geometry.dispose();
  }
}

/**
 * MultiMeshInstance3D: one InstancedMesh; per-instance Transform3D and RGBA colour (the stone tint's
 * alpha carries the moss amount, the leaf's alpha the sway amount — hence a vec4 attribute).
 */
export class MultiMeshInstance3D extends Node3D {
  constructor(geometry, material, transforms, colors) {
    const count = transforms.length;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    super('MultiMesh', mesh);
    /** Kept for inspection (tests compare them with the original's MultiMesh data). */
    this.transforms = transforms;
    this.colors = colors;
    this.label = '';
    const colorArray = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      tmpMatrix.fromArray(transforms[i].toMatrixArray());
      mesh.setMatrixAt(i, tmpMatrix);
      const c = colors ? colors[i] : Color.WHITE;
      colorArray.set([c.r, c.g, c.b, c.a], i * 4);
    }
    // Instance colours live on a per-mesh copy of the geometry attribute table.
    const instanced = geometry.clone();
    instanced.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(colorArray, 4));
    mesh.geometry = instanced;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.castShadow = true;
    this._instancedGeometry = instanced;
  }
  _dispose() {
    super._dispose();
    this._instancedGeometry.dispose();
  }
}

/**
 * Light3D — scene/3d/light_3d.cpp: the parameters the renderer reads, with the engine's defaults.
 * A light takes part in the frame while it is inside the tree and visible.
 */
export class Light3D extends Node3D {
  constructor(name) {
    super(name);
    this.light_color = Color.WHITE;
    this.light_energy = 1.0;
    this.light_indirect_energy = 1.0;
    this.light_volumetric_fog_energy = 1.0;
    this.light_specular = 0.5;
    this.light_negative = false;
    /** PARAM_SIZE: the angular size of a directional light in degrees, the radius of an omni light. */
    this.light_angular_distance = 0.0;
    this.shadow_enabled = false;
    this.shadow_bias = 0.1;
    this.shadow_normal_bias = 1.0;
    this.shadow_opacity = 1.0;
    this.shadow_blur = 1.0;
  }
}

/** OmniLight3D — registered with the lighting system while inside the tree. */
export class OmniLight3D extends Light3D {
  constructor() {
    super('OmniLight3D');
    this.omni_range = 5.0;
    this.omni_attenuation = 1.0;
  }
  _enter_tree() {
    lighting.addOmni(this);
  }
  _exit_tree() {
    lighting.removeOmni(this);
  }
}

/** DirectionalLight3D::ShadowMode → number of PSSM splits. */
export const DIRECTIONAL_SHADOW_SPLITS = Object.freeze({ orthogonal: 1, parallel_2_splits: 2, parallel_4_splits: 4 });

/** DirectionalLight3D — shines along its local −Z; its shadow is drawn in cascades (shadows.js). */
export class DirectionalLight3D extends Light3D {
  constructor() {
    super('DirectionalLight3D');
    this.light_specular = 1.0;
    // Increased by the engine "to better suit most scenes".
    this.shadow_normal_bias = 2.0;
    this.directional_shadow_mode = 'parallel_4_splits';
    this.directional_shadow_split_1 = 0.1;
    this.directional_shadow_split_2 = 0.2;
    this.directional_shadow_split_3 = 0.5;
    this.directional_shadow_blend_splits = false;
    this.directional_shadow_fade_start = 0.8;
    this.directional_shadow_max_distance = 100.0;
    this.directional_shadow_pancake_size = 20.0;
  }
  _enter_tree() {
    lighting.addDirectional(this);
  }
  _exit_tree() {
    lighting.removeDirectional(this);
  }
}

/** Camera3D — vertical FOV like Godot's default KEEP_HEIGHT. */
export class Camera3D extends Node3D {
  constructor() {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 4000);
    super('Camera3D', camera);
    this.camera = camera;
  }
  get fov() {
    return this.camera.fov;
  }
  set fov(v) {
    this.camera.fov = v;
    this.camera.updateProjectionMatrix();
  }
  get near() {
    return this.camera.near;
  }
  set near(v) {
    this.camera.near = v;
    this.camera.updateProjectionMatrix();
  }
  get far() {
    return this.camera.far;
  }
  set far(v) {
    this.camera.far = v;
    this.camera.updateProjectionMatrix();
  }
  /** Godot look_at for cameras: −Z toward the target (same as three's camera lookAt). */
  look_at(target, up = Vector3.UP) {
    this.object3d.up.set(up.x, up.y, up.z);
    this.object3d.updateWorldMatrix(true, false);
    this.object3d.lookAt(target.x, target.y, target.z);
  }
  make_current() {}

  /**
   * Viewport size (in the same units as the screen points given to the projection helpers); set by
   * the app. Only the aspect ratio and the unit matter, as in Godot's get_camera_rect_size().
   */
  static viewportSize = () => ({ x: 1600, y: 900 });

  /** Perspective camera: rays start at the camera. */
  project_ray_origin(_point) {
    return this.global_position;
  }

  /** Camera3D::project_ray_normal — through the near-plane half extents, into world space. */
  project_ray_normal(point) {
    const size = Camera3D.viewportSize();
    const camera = this.camera;
    camera.aspect = size.x / Math.max(size.y, 1);
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.near;
    const halfW = halfH * camera.aspect;
    const local = new THREE.Vector3(((point.x / size.x) * 2 - 1) * halfW, ((1 - point.y / size.y) * 2 - 1) * halfH, -camera.near).normalize();
    this.object3d.updateWorldMatrix(true, false);
    local.transformDirection(this.object3d.matrixWorld);
    return new Vector3(local.x, local.y, local.z);
  }

  /** Camera3D::unproject_position — world point → screen point in viewport units. */
  unproject_position(world) {
    const size = Camera3D.viewportSize();
    const camera = this.camera;
    camera.aspect = size.x / Math.max(size.y, 1);
    camera.updateProjectionMatrix();
    this.object3d.updateWorldMatrix(true, false);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const p = new THREE.Vector3(world.x, world.y, world.z).project(camera);
    return { x: (p.x * 0.5 + 0.5) * size.x, y: (1 - (p.y * 0.5 + 0.5)) * size.y };
  }

  /** Camera3D::is_position_behind */
  is_position_behind(world) {
    this.object3d.updateWorldMatrix(true, false);
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(this.object3d.matrixWorld);
    const eye = new THREE.Vector3().setFromMatrixPosition(this.object3d.matrixWorld);
    return forward.dot(new THREE.Vector3(world.x - eye.x, world.y - eye.y, world.z - eye.z)) < this.camera.near;
  }
}

/**
 * Environment — scene/resources/environment.h: the properties the game sets and the renderer reads,
 * with the engine's defaults (glow levels 2–4 on: 0.8, 0.4, 0.1).
 */
export class Environment {
  constructor() {
    this.background_mode = 'clear_color';
    this.background_energy_multiplier = 1.0;
    this.ambient_light_source = 'bg';
    this.ambient_light_color = new Color(0, 0, 0);
    this.ambient_light_energy = 1.0;
    this.ambient_light_sky_contribution = 1.0;
    this.reflected_light_source = 'bg';
    this.tonemap_mode = 'linear';
    this.tonemap_exposure = 1.0;
    this.tonemap_white = 1.0;
    this.glow_enabled = false;
    this.glow_levels = [0.0, 0.8, 0.4, 0.1, 0.0, 0.0, 0.0];
    this.glow_normalized = false;
    this.glow_intensity = 0.3;
    this.glow_strength = 1.0;
    this.glow_mix = 0.05;
    this.glow_bloom = 0.0;
    this.glow_blend_mode = 'screen';
    this.glow_hdr_threshold = 1.0;
    this.glow_hdr_scale = 2.0;
    this.glow_hdr_luminance_cap = 12.0;
    this.ssao_enabled = false;
    this.ssao_radius = 1.0;
    this.ssao_intensity = 2.0;
    this.ssao_power = 1.5;
    this.ssao_detail = 0.5;
    this.ssao_horizon = 0.06;
    this.ssao_sharpness = 0.98;
    this.ssao_light_affect = 0.0;
    this.ssao_ao_channel_affect = 0.0;
    this.ssil_enabled = false;
    this.ssil_radius = 5.0;
    this.ssil_intensity = 1.0;
    this.ssil_sharpness = 0.98;
    this.ssil_normal_rejection = 1.0;
    this.fog_enabled = false;
    this.fog_mode = 'exponential';
    this.fog_light_color = new Color(0.518, 0.553, 0.608);
    this.fog_light_energy = 1.0;
    this.fog_sun_scatter = 0.0;
    this.fog_density = 0.01;
    this.fog_height = 0.0;
    this.fog_height_density = 0.0;
    this.fog_aerial_perspective = 0.0;
    this.fog_sky_affect = 1.0;
    this.volumetric_fog_enabled = false;
    this.volumetric_fog_density = 0.05;
    this.volumetric_fog_albedo = new Color(1, 1, 1);
    this.volumetric_fog_emission = new Color(0, 0, 0);
    this.volumetric_fog_emission_energy = 1.0;
    this.volumetric_fog_anisotropy = 0.2;
    this.volumetric_fog_length = 64.0;
    this.volumetric_fog_detail_spread = 2.0;
    this.volumetric_fog_gi_inject = 1.0;
    this.volumetric_fog_ambient_inject = 0.0;
    this.volumetric_fog_sky_affect = 1.0;
    this.volumetric_fog_temporal_reprojection_enabled = true;
    this.volumetric_fog_temporal_reprojection_amount = 0.9;
    this.adjustment_enabled = false;
    this.adjustment_brightness = 1.0;
    this.adjustment_contrast = 1.0;
    this.adjustment_saturation = 1.0;
    this.sky = null;
  }
}
