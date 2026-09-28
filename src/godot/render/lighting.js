/**
 * Scene data and light buffers — what Godot 4.7's Forward+ renderer hands to every scene shader
 * (RenderSceneDataRD::update_ubo, LightStorage::update_light_buffers), as ONE set of uniform objects
 * shared by reference with every material and refreshed once per frame. Lights live in fixed-size
 * arrays, so flashes and candles coming and going never change a shader's defines: zero program
 * recompiles during play.
 *
 * Units follow the engine without physical light units: a light's energy carries ×π (diffuse BRDFs
 * carry 1/π), colours are srgb_to_linear, ambient is colour × energy.
 *
 * The clustered light lists of the engine only SKIP lights that cannot reach a pixel (an omni light's
 * attenuation is exactly zero at its range), so looping over every light gives the same image; the
 * arenas hold 2 to 7 omni lights, flashes add a few more.
 */
import * as THREE from 'three';
import { Color } from '../math.js';

/** Omni lights the shaders loop over; beyond it the ones farthest from the camera are dropped. */
export const MAX_OMNI = 24;
export const MAX_DIRECTIONAL = 2;
export const SHADOW_CASCADES = 4;
/** rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality = Soft Low. */
export const DIRECTIONAL_SOFT_SHADOW_SAMPLES = 4;
export const DIRECTIONAL_SHADOW_QUALITY_RADIUS = 2.0;

/** scene_data_inc.glsl */
export const SceneFlags = Object.freeze({
  USE_AMBIENT_LIGHT: 1 << 0,
  USE_AMBIENT_CUBEMAP: 1 << 1,
  USE_REFLECTION_CUBEMAP: 1 << 2,
  USE_ROUGHNESS_LIMITER: 1 << 3,
  USE_FOG: 1 << 4,
});

/** scene_forward_clustered_inc.glsl */
export const ScreenSpaceEffects = Object.freeze({ USE_SSAO: 1 << 0, USE_SSIL: 1 << 1 });

/** Project settings the renderer reads (the shipped game keeps the engine's defaults). */
export const RenderSettings = Object.freeze({
  roughnessLimiter: Object.freeze({ enabled: true, amount: 0.25, limit: 0.18 }),
  specularOcclusion: true,
});

const vec2s = (n) => Array.from({ length: n }, () => new THREE.Vector2());
const vec3s = (n) => Array.from({ length: n }, () => new THREE.Vector3());
const vec4s = (n) => Array.from({ length: n }, () => new THREE.Vector4());
const mat4s = (n) => Array.from({ length: n }, () => new THREE.Matrix4());

/** get_vogel_disk (renderer_scene_render_rd.cpp): the soft shadow kernel. */
export function vogelDisk(count) {
  const GOLDEN_ANGLE = 2.4;
  const kernel = [];
  for (let i = 0; i < count; i++) {
    const r = Math.fround(Math.sqrt(i + 0.5) / Math.sqrt(count));
    const theta = Math.fround(i * GOLDEN_ANGLE);
    kernel.push(new THREE.Vector2(Math.fround(Math.cos(theta) * r), Math.fround(Math.sin(theta) * r)));
  }
  return kernel;
}

/** The uniform objects are shared by reference with every SpatialMaterial. */
export const sharedUniforms = {
  TIME: { value: 0 },
  uViewport: { value: new THREE.Vector2(1, 1) },
  uScreenPixelSize: { value: new THREE.Vector2(1, 1) },
  /** Camera → world of the camera the pass draws with (the shadow camera in shadow passes). */
  uInvView: { value: new THREE.Matrix4() },
  /** rgb: ambient colour × energy, a: background energy multiplier. */
  uAmbient: { value: new THREE.Vector4(0, 0, 0, 1) },
  /** Environment.ambient_light_sky_contribution */
  uAmbientSkyMix: { value: 1 },
  uSceneFlags: { value: 0 },
  uRoughnessLimiter: { value: new THREE.Vector2(RenderSettings.roughnessLimiter.amount, RenderSettings.roughnessLimiter.limit) },
  uZRange: { value: new THREE.Vector2(0.05, 4000) },
  uFogColor: { value: new THREE.Vector3() },
  /** density, height, height density, sun scatter */
  uFogParams: { value: new THREE.Vector4() },

  uDirCount: { value: 0 },
  /** Toward the light, view space. */
  uDirDirection: { value: vec3s(MAX_DIRECTIONAL) },
  /** rgb: linear colour, a: energy × π. */
  uDirColor: { value: vec4s(MAX_DIRECTIONAL) },
  /** specular amount, shadow opacity, 1 − cos(angular size), volumetric fog energy */
  uDirParams: { value: vec4s(MAX_DIRECTIONAL) },

  /** The atlas of the directional light that casts shadows (one light: the arena's key light). */
  uDirShadowAtlas: { value: null },
  uDirShadowMatrix: { value: mat4s(SHADOW_CASCADES) },
  uDirShadowBias: { value: new THREE.Vector4() },
  uDirShadowNormalBias: { value: new THREE.Vector4() },
  uDirShadowSplits: { value: new THREE.Vector4() },
  /** soft shadow scale, fade from, fade to, blend splits */
  uDirShadowParams: { value: new THREE.Vector4() },
  uDirShadowPixelSize: { value: new THREE.Vector2(1 / 4096, 1 / 4096) },
  /** Depth range of each cascade's shadow camera (what a unit of atlas depth measures). */
  uDirShadowZRange: { value: new THREE.Vector4() },
  uDirShadowKernel: { value: vogelDisk(DIRECTIONAL_SOFT_SHADOW_SAMPLES) },

  uOmniCount: { value: 0 },
  /** xyz: view-space position, w: 1 / range */
  uOmniPosition: { value: vec4s(MAX_OMNI) },
  /** rgb: linear colour × energy × π, a: attenuation exponent */
  uOmniColor: { value: vec4s(MAX_OMNI) },
  /** specular amount, volumetric fog energy */
  uOmniParams: { value: vec2s(MAX_OMNI) },

  uRadiance: { value: null },
  /** 1 / radiance size, border in uv, 1 − 2 · border, last roughness layer */
  uRadianceParams: { value: new THREE.Vector4(1 / 64, 0.1, 0.8, 7) },
  uDfg: { value: null },
  uAoBuffer: { value: null },
  uSsilBuffer: { value: null },
  /** flags (ScreenSpaceEffects), SSAO ao-channel affect, SSAO direct light affect */
  uSsEffects: { value: new THREE.Vector3() },
  /** The fog volume as an atlas of its slices (volumetric_fog.js), and its size in froxels. */
  uVolumetricFog: { value: null },
  uVolumetricFogSize: { value: new THREE.Vector3(1, 1, 1) },
  /** enabled, 1 / length, 1 / detail spread */
  uVolumetricFogParams: { value: new THREE.Vector3(0, 1, 1) },
};

const tmpVec = new THREE.Vector3();
const tmpVec4 = new THREE.Vector4();
const DEG_TO_RAD = Math.PI / 180;

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
    /** What the last update packed, in shader order (the volumetric fog and the tools read it). */
    this.packed = { directionals: [], omnis: [], shadowLight: null, shadowIndex: -1 };
    this._sorted = [];
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

  /**
   * Once per frame, after transforms settle. O(lights · log lights).
   * @param {THREE.Camera} camera the main camera (matrixWorld and matrixWorldInverse current)
   * @param {{unshaded?: boolean, ssao?: boolean, ssil?: boolean}} [frame] `unshaded`: the debug view
   *   that drops every light and shades with a white ambient; `ssao` / `ssil`: the screen-space
   *   buffers this frame provides
   */
  update(camera, frame = {}) {
    const view = camera.matrixWorldInverse;
    sharedUniforms.uInvView.value.copy(camera.matrixWorld);
    sharedUniforms.uZRange.value.set(camera.near, camera.far);
    const packed = this.packed;
    packed.directionals.length = 0;
    packed.omnis.length = 0;
    packed.shadowLight = null;
    packed.shadowIndex = -1;

    let d = 0;
    for (const light of frame.unshaded ? [] : this.directionals) {
      if (d >= MAX_DIRECTIONAL || !light.isVisibleInTree()) continue;
      light.object3d.updateWorldMatrix(true, false);
      // Lights shine along their local −Z; the vector toward the light is +Z.
      tmpVec.set(0, 0, 1).transformDirection(light.object3d.matrixWorld).transformDirection(view);
      sharedUniforms.uDirDirection.value[d].copy(tmpVec);
      const lin = light.light_color.srgb_to_linear();
      const sign = light.light_negative ? -1 : 1;
      sharedUniforms.uDirColor.value[d].set(lin.r, lin.g, lin.b, sign * light.light_energy * Math.PI);
      const castsShadow = light.shadow_enabled && packed.shadowLight === null;
      if (castsShadow) {
        packed.shadowLight = light;
        packed.shadowIndex = d;
      }
      sharedUniforms.uDirParams.value[d].set(light.light_specular, castsShadow ? light.shadow_opacity : 0, 1 - Math.cos(light.light_angular_distance * DEG_TO_RAD), light.light_volumetric_fog_energy);
      packed.directionals.push(light);
      d += 1;
    }
    sharedUniforms.uDirCount.value = d;

    // LightStorage sorts positional lights by distance to the camera (the order they are shaded in).
    const eye = tmpVec.setFromMatrixPosition(camera.matrixWorld);
    const sorted = this._sorted;
    sorted.length = 0;
    for (const light of frame.unshaded ? [] : this.omnis) {
      if (!light.isVisibleInTree()) continue;
      light.object3d.updateWorldMatrix(true, false);
      const e = light.object3d.matrixWorld.elements;
      sorted.push({ light, depth: Math.hypot(e[12] - eye.x, e[13] - eye.y, e[14] - eye.z) });
    }
    sorted.sort((a, b) => a.depth - b.depth);
    let n = 0;
    for (const { light } of sorted) {
      if (n >= MAX_OMNI) break;
      tmpVec4.set(0, 0, 0, 1).applyMatrix4(light.object3d.matrixWorld).applyMatrix4(view);
      sharedUniforms.uOmniPosition.value[n].set(tmpVec4.x, tmpVec4.y, tmpVec4.z, 1 / Math.max(0.001, light.omni_range));
      const lin = light.light_color.srgb_to_linear();
      const energy = (light.light_negative ? -1 : 1) * light.light_energy * Math.PI;
      sharedUniforms.uOmniColor.value[n].set(lin.r * energy, lin.g * energy, lin.b * energy, light.omni_attenuation);
      sharedUniforms.uOmniParams.value[n].set(light.light_specular * 2.0, light.light_volumetric_fog_energy);
      packed.omnis.push(light);
      n += 1;
    }
    sharedUniforms.uOmniCount.value = n;
    this._updateEnvironment(frame);
  }

  /** RenderSceneDataRD::update_ubo — the environment part. */
  _updateEnvironment(frame) {
    const env = this.environment;
    let flags = 0;
    if (frame.unshaded) {
      flags |= SceneFlags.USE_AMBIENT_LIGHT;
      sharedUniforms.uAmbient.value.set(1, 1, 1, 1);
      sharedUniforms.uSsEffects.value.set(0, 0, 0);
    } else if (env) {
      const bgEnergy = env.background_energy_multiplier;
      const lin = env.ambient_light_color.srgb_to_linear();
      const energy = env.ambient_light_energy;
      sharedUniforms.uAmbient.value.set(lin.r * energy, lin.g * energy, lin.b * energy, bgEnergy);
      const sky = env.background_mode === 'sky';
      const ambientCubemap = (env.ambient_light_source === 'bg' && sky) || env.ambient_light_source === 'sky';
      if (ambientCubemap) flags |= SceneFlags.USE_AMBIENT_CUBEMAP;
      if (ambientCubemap || env.ambient_light_source === 'color') flags |= SceneFlags.USE_AMBIENT_LIGHT;
      if ((env.reflected_light_source === 'bg' && sky) || env.reflected_light_source === 'sky') flags |= SceneFlags.USE_REFLECTION_CUBEMAP;
      if (env.fog_enabled) flags |= SceneFlags.USE_FOG;
      linearColor(env.fog_light_color, env.fog_light_energy, sharedUniforms.uFogColor.value);
      sharedUniforms.uFogParams.value.set(env.fog_density, env.fog_height, env.fog_height_density, env.fog_sun_scatter);
      sharedUniforms.uAmbientSkyMix.value = env.ambient_light_sky_contribution;
      sharedUniforms.uSsEffects.value.set((frame.ssao ? ScreenSpaceEffects.USE_SSAO : 0) | (frame.ssil ? ScreenSpaceEffects.USE_SSIL : 0), env.ssao_ao_channel_affect, env.ssao_light_affect);
    } else {
      sharedUniforms.uAmbient.value.set(0, 0, 0, 1);
      sharedUniforms.uSsEffects.value.set(0, 0, 0);
    }
    if (RenderSettings.roughnessLimiter.enabled) flags |= SceneFlags.USE_ROUGHNESS_LIMITER;
    sharedUniforms.uSceneFlags.value = flags;
  }
}

export const lighting = new LightingSystem();
export { Color };
