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

/** MeshInstance3D: `mesh` is a THREE.BufferGeometry, `material_override` a THREE material. */
export class MeshInstance3D extends Node3D {
  constructor(name = '') {
    super(name, new THREE.Mesh(new THREE.BufferGeometry(), undefined));
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    this._castShadow = true;
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
    this._syncShadowFlags();
  }
  /** GeometryInstance3D.cast_shadow: true / false (SHADOW_CASTING_SETTING_ON / OFF). */
  set cast_shadow(on) {
    this._castShadow = on;
    this._syncShadowFlags();
  }
  get cast_shadow() {
    return this._castShadow;
  }
  _syncShadowFlags() {
    const material = this.object3d.material;
    this.object3d.castShadow = this._castShadow && material?.castsShadow !== false;
    this.object3d.receiveShadow = material?.receivesShadow !== false;
    this.object3d.customDepthMaterial = material?.needsCustomDepth ? material.depthMaterial() : undefined;
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
    mesh.castShadow = material.castsShadow !== false;
    mesh.receiveShadow = material.receivesShadow !== false;
    if (material.needsCustomDepth) mesh.customDepthMaterial = material.depthMaterial();
    this._instancedGeometry = instanced;
  }
  _dispose() {
    super._dispose();
    this._instancedGeometry.dispose();
  }
}

/** OmniLight3D — registered with the lighting system while inside the tree. */
export class OmniLight3D extends Node3D {
  constructor() {
    super('OmniLight3D');
    this.light_color = Color.WHITE;
    this.light_energy = 1.0;
    this.omni_range = 5.0;
    this.omni_attenuation = 1.0;
    this.shadow_enabled = false;
    this.light_volumetric_fog_energy = 1.0;
  }
  _enter_tree() {
    lighting.addOmni(this);
  }
  _exit_tree() {
    lighting.removeOmni(this);
  }
}

/**
 * DirectionalLight3D — shines along its local −Z. The key light also owns a THREE.DirectionalLight
 * used ONLY for three's shadow map (its colour/intensity never reach our shaders).
 */
export class DirectionalLight3D extends Node3D {
  constructor() {
    super('DirectionalLight3D');
    this.light_color = Color.WHITE;
    this.light_energy = 1.0;
    this.shadow_enabled = false;
    this.light_volumetric_fog_energy = 1.0;
    this.shadowCaster = null;
  }
  enableShadowCaster(mapSize, extent) {
    const caster = new THREE.DirectionalLight(0xffffff, 0);
    caster.castShadow = true;
    caster.shadow.mapSize.set(mapSize, mapSize);
    const cam = caster.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 0.5;
    cam.far = 40;
    this.shadowCaster = caster;
    return caster;
  }
  _enter_tree() {
    lighting.addDirectional(this);
  }
  _exit_tree() {
    lighting.removeDirectional(this);
  }
  /** Keeps the shadow caster aimed like this light (centred on `focus`). */
  syncShadowCaster(focus = new THREE.Vector3()) {
    if (!this.shadowCaster) return;
    this.object3d.updateWorldMatrix(true, false);
    tmpAxis.set(0, 0, 1).transformDirection(this.object3d.matrixWorld);
    this.shadowCaster.position.copy(focus).addScaledVector(tmpAxis, 15);
    this.shadowCaster.target.position.copy(focus);
    this.shadowCaster.updateMatrixWorld();
    this.shadowCaster.target.updateMatrixWorld();
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
}

/** Godot's Environment resource (the fields the arena drives). */
export class Environment {
  constructor() {
    this.background_mode = 'sky';
    this.ambient_light_color = new Color(0, 0, 0);
    this.ambient_light_energy = 1.0;
    this.tonemap_mode = 'filmic';
    this.tonemap_exposure = 1.0;
    this.tonemap_white = 1.0;
    this.glow_enabled = false;
    this.glow_intensity = 0.8;
    this.glow_strength = 1.0;
    this.glow_bloom = 0.0;
    this.glow_hdr_threshold = 1.0;
    this.glow_hdr_scale = 2.0;
    this.glow_blend_mode = 'softlight';
    this.ssao_enabled = false;
    this.ssao_radius = 1.0;
    this.ssao_intensity = 2.0;
    this.ssao_power = 1.5;
    this.ssao_detail = 0.5;
    this.ssil_enabled = false;
    this.ssil_radius = 5.0;
    this.ssil_intensity = 1.0;
    this.fog_enabled = false;
    this.fog_light_color = new Color(0.518, 0.553, 0.608);
    this.fog_light_energy = 1.0;
    this.fog_density = 0.01;
    this.fog_height = 0.0;
    this.fog_height_density = 0.0;
    this.fog_sky_affect = 1.0;
    this.volumetric_fog_enabled = false;
    this.volumetric_fog_density = 0.05;
    this.volumetric_fog_albedo = new Color(1, 1, 1);
    this.volumetric_fog_emission = new Color(0, 0, 0);
    this.volumetric_fog_anisotropy = 0.2;
    this.volumetric_fog_length = 64.0;
    this.adjustment_enabled = false;
    this.adjustment_contrast = 1.0;
    this.adjustment_saturation = 1.0;
    this.adjustment_brightness = 1.0;
    this.sky = null;
  }
}
