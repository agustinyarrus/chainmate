/**
 * Shared lighting state — one set of uniform objects referenced by EVERY material, updated once per
 * frame. Point lights live in fixed-size uniform arrays (not THREE lights), so flashes and candles
 * coming and going never change a shader's defines: zero program recompiles during play.
 *
 * Units follow Godot 4 without physical light units: a light's shader colour is
 * srgb_to_linear(color) × energy × π (diffuse BRDFs carry 1/π), ambient is colour × energy (no π).
 */
import * as THREE from 'three';
import { Color } from '../math.js';

export const MAX_OMNI = 16;

const vec3s = (n) => Array.from({ length: n }, () => new THREE.Vector3());
const vec4s = (n) => Array.from({ length: n }, () => new THREE.Vector4());

/** The uniform objects are shared by reference with every SpatialMaterial. */
export const sharedUniforms = {
  TIME: { value: 0 },
  uAmbient: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
  uDirCount: { value: 0 },
  uDirDir: { value: vec3s(2) },
  uDirColor: { value: vec3s(2) },
  uDirShadow: { value: [1, 0] },
  uOmniCount: { value: 0 },
  uOmniPosRange: { value: vec4s(MAX_OMNI) },
  uOmniColorAtt: { value: vec4s(MAX_OMNI) },
  uFogColor: { value: new THREE.Vector3() },
  uFogParams: { value: new THREE.Vector4(0, 0, 0, 0) }, // density, height, height density, enabled
  uInvView: { value: new THREE.Matrix4() },
  uRadiance: { value: null },
  uRadianceEnergy: { value: 1 },
  uUseRadiance: { value: 0 },
  uViewport: { value: new THREE.Vector2(1, 1) },
};

const tmpVec = new THREE.Vector3();
const tmpVec4 = new THREE.Vector4();

/** Godot colour → linear THREE.Vector3 scaled by `scale`. */
export function linearColor(color, scale = 1, out = new THREE.Vector3()) {
  const lin = color.srgb_to_linear();
  return out.set(lin.r * scale, lin.g * scale, lin.b * scale);
}

/** Registry of Godot-style lights; `update(camera)` bakes them into the shared uniforms. */
export class LightingSystem {
  constructor() {
    /** @type {Set<import('../node3d.js').OmniLight3D>} */
    this.omnis = new Set();
    /** @type {import('../node3d.js').DirectionalLight3D[]} */
    this.directionals = [];
    this.environment = null;
  }

  addOmni(light) {
    this.omnis.add(light);
  }
  removeOmni(light) {
    this.omnis.delete(light);
  }
  addDirectional(light) {
    if (!this.directionals.includes(light)) this.directionals.push(light);
  }
  removeDirectional(light) {
    this.directionals = this.directionals.filter((l) => l !== light);
  }

  /** Once per frame, after transforms settle. O(lights). */
  update(camera) {
    const view = camera.matrixWorldInverse;
    sharedUniforms.uInvView.value.copy(camera.matrixWorld);
    // Directional lights: direction TOWARD the light, in view space.
    let d = 0;
    for (const light of this.directionals) {
      if (d >= 2 || !light.isVisibleInTree()) continue;
      light.object3d.updateWorldMatrix(true, false);
      // Godot lights shine along their local −Z; the vector toward the light is +Z.
      tmpVec.set(0, 0, 1).transformDirection(light.object3d.matrixWorld).transformDirection(view);
      sharedUniforms.uDirDir.value[d].copy(tmpVec);
      linearColor(light.light_color, light.light_energy * Math.PI, sharedUniforms.uDirColor.value[d]);
      sharedUniforms.uDirShadow.value[d] = light.shadow_enabled ? 1 : 0;
      d += 1;
    }
    sharedUniforms.uDirCount.value = d;
    // Omni lights, nearest-first beyond the cap (the arena never gets close to it).
    let n = 0;
    for (const light of this.omnis) {
      if (n >= MAX_OMNI) break;
      if (!light.isVisibleInTree() || light.light_energy <= 0) continue;
      light.object3d.updateWorldMatrix(true, false);
      tmpVec4.set(0, 0, 0, 1).applyMatrix4(light.object3d.matrixWorld).applyMatrix4(view);
      sharedUniforms.uOmniPosRange.value[n].set(tmpVec4.x, tmpVec4.y, tmpVec4.z, light.omni_range);
      const lin = light.light_color.srgb_to_linear();
      const k = light.light_energy * Math.PI;
      sharedUniforms.uOmniColorAtt.value[n].set(lin.r * k, lin.g * k, lin.b * k, light.omni_attenuation);
      n += 1;
    }
    sharedUniforms.uOmniCount.value = n;
    const env = this.environment;
    if (env) {
      linearColor(env.ambient_light_color, env.ambient_light_energy, sharedUniforms.uAmbient.value);
      linearColor(env.fog_light_color, env.fog_light_energy, sharedUniforms.uFogColor.value);
      sharedUniforms.uFogParams.value.set(env.fog_density, env.fog_height, env.fog_height_density, env.fog_enabled ? 1 : 0);
    }
  }
}

export const lighting = new LightingSystem();
export { Color };
