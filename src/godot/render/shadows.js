/**
 * Directional shadows — Godot 4.7's parallel-split shadow maps, cascade by cascade:
 *
 *   RendererSceneCull::_light_instance_setup_directional_shadow   where each cascade looks
 *   RenderForwardClustered::_render_shadow_pass                   where it lands in the atlas
 *   LightStorage::update_light_buffers                            what the scene shader reads
 *
 * Every cascade is the camera frustum between two split distances, wrapped in a sphere (so the map
 * keeps its size while the camera turns) whose centre is snapped to whole texels (so edges do not
 * crawl while it moves). The light looks at it from `pancake` units behind; casters nearer to the
 * light than that are flattened onto the near plane by the shadow programs.
 *
 * Depth here grows away from the light (the engine stores it reversed): the comparison is mirrored
 * (LESS instead of GREATER), the 16-bit quantisation is the same. Atlas coordinates are the
 * engine's. The atlas is read through a comparison sampler with linear filtering, like the scene
 * shader's `shadow_sampler`: each tap is a 2×2 percentage-closer filter done by the hardware.
 * The cascade arithmetic is single precision like the engine's `real_t` — the snapping depends on it.
 */
import * as THREE from 'three';
import { sharedUniforms, SHADOW_CASCADES, DIRECTIONAL_SHADOW_QUALITY_RADIUS } from './lighting.js';
import { PassLayer } from './material.js';
import { DIRECTIONAL_SHADOW_SPLITS } from '../node3d.js';

/** rendering/lights_and_shadows/directional_shadow/size */
export const DIRECTIONAL_SHADOW_SIZE = 4096;

const f = Math.fround;
const DEG_TO_RAD = Math.PI / 180;

/** Math::snapped for floats. */
const snapped = (value, step) => (step !== 0 ? f(f(Math.floor(f(f(value / step) + 0.5))) * step) : value);

/** Atlas rectangle (normalised) of each cascade of a light that owns the whole atlas. */
function cascadeRect(splits, index) {
  if (splits === 4) return { x: (index % 2) * 0.5, y: Math.floor(index / 2) * 0.5, width: 0.5, height: 0.5 };
  if (splits === 2) return { x: 0, y: index * 0.5, width: 1, height: 0.5 };
  return { x: 0, y: 0, width: 1, height: 1 };
}

class Cascade {
  constructor(index) {
    this.index = index;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.layer = PassLayer.SHADOW_CASCADE_0 + index;
    this.camera.layers.set(this.layer);
    /** Split distance (view depth where the cascade ends). */
    this.split = 0;
    this.texelSize = 0;
    this.biasScale = 0;
    this.rangeBegin = 0;
    this.rect = { x: 0, y: 0, width: 1, height: 1 };
    this.uvScale = new THREE.Vector2();
    /** Light-space bounds of the camera slice (culling): casters may sit anywhere toward the light. */
    this.bounds = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0 };
    this.axes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    /** World → atlas uv + depth. */
    this.matrix = new THREE.Matrix4();
  }

  /** Whether a world-space sphere can cast onto the cascade. O(1). */
  intersectsSphere(center, radius) {
    const { x, y, z } = this.axes;
    const b = this.bounds;
    const dx = x.dot(center);
    if (dx + radius < b.xMin || dx - radius > b.xMax) return false;
    const dy = y.dot(center);
    if (dy + radius < b.yMin || dy - radius > b.yMax) return false;
    return z.dot(center) + radius >= b.zMin;
  }
}

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const tmpRect = new THREE.Matrix4();
const tmpPoint = new THREE.Vector3();

export class DirectionalShadowAtlas {
  /** @param {number} size atlas side in texels (a power of two) */
  constructor(size = DIRECTIONAL_SHADOW_SIZE) {
    this.size = size;
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedShortType);
    depth.minFilter = THREE.LinearFilter;
    depth.magFilter = THREE.LinearFilter;
    depth.compareFunction = THREE.LessCompare;
    // A colour attachment is mandatory here; one byte per texel is the least it can cost.
    this.target = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: depth,
      generateMipmaps: false,
    });
    this.target.scissorTest = true;
    this.cascades = Array.from({ length: SHADOW_CASCADES }, (_, i) => new Cascade(i));
    this.count = 0;
    sharedUniforms.uDirShadowAtlas.value = depth;
    sharedUniforms.uDirShadowPixelSize.value.set(1 / size, 1 / size);
  }

  get texture() {
    return this.target.depthTexture;
  }

  /**
   * Places the cascades of `light` for `camera` and fills the uniforms the scene shader reads.
   * O(cascades).
   * @param {import('../node3d.js').DirectionalLight3D} light
   * @param {THREE.PerspectiveCamera} camera matrixWorld current
   */
  setup(light, camera) {
    const splits = DIRECTIONAL_SHADOW_SPLITS[light.directional_shadow_mode];
    this.count = splits;
    const textureSize = f(splits === 1 ? this.size : this.size / 2);
    const overlap = light.directional_shadow_blend_splits;

    // Projection::get_fov() is the horizontal field of view; set_perspective(…, flip_fov) turns it back.
    const aspect = f(camera.aspect);
    const cotangent = f(1 / Math.tan((camera.fov * DEG_TO_RAD) / 2));
    const tanHalfX = f(aspect / cotangent);
    const tanHalfY = f(1 / cotangent);

    let maxDistance = f(camera.far);
    const shadowMax = f(light.directional_shadow_max_distance);
    if (shadowMax > 0) maxDistance = Math.min(shadowMax, maxDistance);
    maxDistance = Math.max(maxDistance, f(camera.near + 0.001));
    const minDistance = Math.min(f(camera.near), maxDistance);
    const pancake = f(light.directional_shadow_pancake_size);
    const range = f(maxDistance - minDistance);
    const offsets = [light.directional_shadow_split_1, light.directional_shadow_split_2, light.directional_shadow_split_3, 1];
    const distances = [minDistance];
    for (let i = 0; i < splits; i++) distances.push(f(minDistance + f(f(offsets[i]) * range)));
    distances[splits] = maxDistance;

    light.object3d.updateWorldMatrix(true, false);
    const e = light.object3d.matrixWorld.elements;
    // Scale does not count on lights.
    const x = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const y = new THREE.Vector3(e[4], e[5], e[6]).normalize();
    const z = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const softAngle = light.light_angular_distance;
    const eye = tmpPoint.setFromMatrixPosition(camera.matrixWorld).clone();

    for (let i = 0; i < splits; i++) {
      const cascade = this.cascades[i];
      const near = distances[i === 0 || !overlap ? i : i - 1];
      const far = distances[i + 1];
      const endpoints = [];
      for (const d of [far, near]) {
        for (const sx of [-1, 1]) {
          for (const sy of [1, -1]) endpoints.push(new THREE.Vector3(sx * d * tanHalfX, sy * d * tanHalfY, -d).applyMatrix4(camera.matrixWorld));
        }
      }
      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      let zMin = Infinity;
      const center = new THREE.Vector3();
      for (const p of endpoints) {
        const dx = f(x.dot(p));
        const dy = f(y.dot(p));
        const dz = f(z.dot(p));
        xMin = Math.min(xMin, dx);
        xMax = Math.max(xMax, dx);
        yMin = Math.min(yMin, dy);
        yMax = Math.max(yMax, dy);
        zMin = Math.min(zMin, dz);
        center.add(p);
      }
      center.multiplyScalar(1 / 8);
      let radius = 0;
      for (const p of endpoints) radius = Math.max(radius, f(center.distanceTo(p)));
      // Add a texel by each side.
      radius = f(radius * f(textureSize / f(textureSize - 2.0)));
      const zCenter = f(z.dot(center));
      const zMinCam = f(zCenter - radius);
      let softExpand = 0;
      if (softAngle > 0) {
        const zRange = f(f(zCenter + radius + pancake) - zMinCam);
        softExpand = f(Math.tan(softAngle * DEG_TO_RAD) * zRange);
        xMax += softExpand;
        yMax += softExpand;
        xMin -= softExpand;
        yMin -= softExpand;
      }
      // What stabilizes the shadow: the map moves by whole texels.
      const unit = f(f(f(radius + softExpand) * 4.0) / textureSize);
      const xCenter = f(x.dot(center));
      const yCenter = f(y.dot(center));
      const xMaxCam = snapped(f(xCenter + radius + softExpand), unit);
      const xMinCam = snapped(f(xCenter - radius - softExpand), unit);
      const yMaxCam = snapped(f(yCenter + radius + softExpand), unit);
      const yMinCam = snapped(f(yCenter - radius - softExpand), unit);
      const zMax = f(zCenter + radius + pancake);
      const halfX = f(f(xMaxCam - xMinCam) * 0.5);
      const halfY = f(f(yMaxCam - yMinCam) * 0.5);
      const zFar = f(zMax - zMinCam);

      const shadowCamera = cascade.camera;
      shadowCamera.left = -halfX;
      shadowCamera.right = halfX;
      shadowCamera.top = halfY;
      shadowCamera.bottom = -halfY;
      shadowCamera.near = 0;
      shadowCamera.far = zFar;
      shadowCamera.updateProjectionMatrix();
      const ox = f(xMinCam + halfX);
      const oy = f(yMinCam + halfY);
      shadowCamera.matrixWorld.set(
        x.x, y.x, z.x, x.x * ox + y.x * oy + z.x * zMax,
        x.y, y.y, z.y, x.y * ox + y.y * oy + z.y * zMax,
        x.z, y.z, z.z, x.z * ox + y.z * oy + z.z * zMax,
        0, 0, 0, 1,
      );
      shadowCamera.matrixWorldInverse.copy(shadowCamera.matrixWorld).invert();

      cascade.split = far;
      cascade.texelSize = f(f(radius * 2.0) / textureSize);
      cascade.biasScale = zFar;
      cascade.rangeBegin = f(zMax - f(z.dot(eye)));
      cascade.uvScale.set(f(1 / f(xMaxCam - xMinCam)), f(1 / f(yMaxCam - yMinCam)));
      cascade.rect = cascadeRect(splits, i);
      cascade.bounds = { xMin, xMax, yMin, yMax, zMin };
      cascade.axes.x.copy(x);
      cascade.axes.y.copy(y);
      cascade.axes.z.copy(z);
      const r = cascade.rect;
      tmpRect.set(r.width, 0, 0, r.x, 0, r.height, 0, r.y, 0, 0, 1, 0, 0, 0, 0, 1);
      cascade.matrix.copy(tmpRect).multiply(BIAS).multiply(shadowCamera.projectionMatrix).multiply(shadowCamera.matrixWorldInverse);
    }
    this._fillUniforms(light, camera, splits);
  }

  /** LightStorage::update_light_buffers, the shadow part of the directional light. */
  _fillUniforms(light, camera, splits) {
    const softShadowScale = f(f(light.shadow_blur) * (light.light_angular_distance > 0 ? 1 : DIRECTIONAL_SHADOW_QUALITY_RADIUS));
    const limit = splits - 1;
    const bias = sharedUniforms.uDirShadowBias.value;
    const normalBias = sharedUniforms.uDirShadowNormalBias.value;
    const offsets = sharedUniforms.uDirShadowSplits.value;
    const zRange = sharedUniforms.uDirShadowZRange.value;
    for (let j = 0; j < SHADOW_CASCADES; j++) {
      const cascade = this.cascades[Math.min(limit, j)];
      offsets.setComponent(j, cascade.split);
      zRange.setComponent(j, cascade.biasScale);
      const biasScale = f(cascade.biasScale * softShadowScale);
      bias.setComponent(j, f(f(f(light.shadow_bias) / 100.0) * biasScale));
      normalBias.setComponent(j, f(f(light.shadow_normal_bias) * cascade.texelSize));
      // View space of the main camera → atlas.
      sharedUniforms.uDirShadowMatrix.value[j].copy(cascade.matrix).multiply(camera.matrixWorld);
    }
    const fadeStart = Math.min(f(light.directional_shadow_fade_start), 0.999);
    sharedUniforms.uDirShadowParams.value.set(softShadowScale, f(-offsets.w * f(fadeStart)), -offsets.w, light.directional_shadow_blend_splits && splits > 1 ? 1 : 0);
  }

  /**
   * Draws the cascades. `drawCascade(cascade)` renders the casters of one cascade with its camera;
   * the viewport and scissor are already set to the cascade's rectangle. O(cascades).
   */
  render(renderer, drawCascade) {
    const target = this.target;
    target.viewport.set(0, 0, this.size, this.size);
    target.scissor.set(0, 0, this.size, this.size);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    for (let i = 0; i < this.count; i++) {
      const cascade = this.cascades[i];
      const r = cascade.rect;
      target.viewport.set(r.x * this.size, r.y * this.size, r.width * this.size, r.height * this.size);
      target.scissor.copy(target.viewport);
      renderer.setRenderTarget(target);
      drawCascade(cascade);
    }
    target.viewport.set(0, 0, this.size, this.size);
    target.scissor.set(0, 0, this.size, this.size);
  }

  /**
   * Runs `read` with the atlas giving depth VALUES (a plain sampler2D; the volumetric fog measures
   * how far behind an occluder a point is). WebGL offers a depth texture for comparisons or for
   * values, never both, and values only unfiltered: the comparison comes back afterwards.
   */
  withDepthValues(renderer, read) {
    const gl = renderer.getContext();
    const texture = renderer.properties.get(this.target.depthTexture).__webglTexture;
    if (!texture) throw new Error('DirectionalShadowAtlas: the atlas has not been set up (initRenderTarget)');
    const sample = (compareMode, filter) => {
      renderer.state.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, compareMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      renderer.state.unbindTexture();
    };
    sample(gl.NONE, gl.NEAREST);
    try {
      read();
    } finally {
      sample(gl.COMPARE_REF_TO_TEXTURE, gl.LINEAR);
    }
  }

  /** Clears the atlas (a frame without a shadow-casting light). */
  clear(renderer) {
    this.count = 0;
    this.target.viewport.set(0, 0, this.size, this.size);
    this.target.scissor.set(0, 0, this.size, this.size);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
  }

  dispose() {
    this.target.dispose();
  }
}
