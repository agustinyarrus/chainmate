/**
 * Render pipeline — Godot 4.7's Forward+ frame (RenderForwardClustered::_render_scene) rebuilt on
 * three.js / WebGL2, pass by pass in the engine's order:
 *
 *   1. sky radiance            the rough layers catch up, one per frame (sky.js)
 *   2. shadow atlas            the key light's four cascades (shadows.js)
 *   3. depth prepass           depth + normal/roughness of the opaque scene, only when a screen-space
 *                              effect needs them
 *   4. screen-space effects    SSAO and SSIL from the prepass (ss_effects.js), froxel fog
 *                              (volumetric_fog.js)
 *   5. colour                  HDR, MSAA ×4: opaque over the sky, then the transparent list
 *   6. post                    glow levels → tone curve, glow blend, adjustments → the screen buffer
 *   7. present                 after the 2D canvas is drawn over it: the screen buffer → the canvas
 *
 * Every buffer keeps the engine's rows (first row at the top): the 3D passes are drawn with the
 * projection mirrored in Y, the 2D canvas is drawn top-down into the screen buffer, and only the
 * last copy, the one that reaches the canvas element, turns the image over. So gl_FragCoord, dFdy,
 * the MSAA sample pattern and even the rasterizer's rule for edges that run exactly through pixel
 * centres (a 1-px line on a whole coordinate: which row it lights) mean what they mean in the engine.
 *
 * The engine's prepass is multisampled and resolved with a rule that keeps sample 0 of each pixel
 * (except on silhouettes against the background); WebGL2 cannot read single samples, so the prepass
 * here is drawn without MSAA, moved by a fraction of a pixel to look through that sample, and
 * shaded where multisampling shades: at the centre of the pixel (material.js).
 *
 * The 2D canvas is drawn over the result by the canvas renderer (ui/renderer.js).
 */
import * as THREE from 'three';
import { lighting, sharedUniforms } from './lighting.js';
import { FullscreenQuad, fullscreenMaterial, hdrTarget } from './fullscreen.js';
import { Glow } from './glow.js';
import { Tonemapper } from './tonemap.js';
import { SpatialMaterial, Pass, PassLayer } from './material.js';
import { DirectionalShadowAtlas } from './shadows.js';
import { integrateDfg } from './dfg.js';
import { computeBestFitNormals } from './best_fit_normal.js';
import { ScreenSpaceEffects } from './ss_effects.js';
import { VolumetricFog } from './volumetric_fog.js';
import { SubsurfaceScattering } from './subsurface.js';
import { RenderingServer, defaultRenderingMethod } from '../os.js';

/** Viewport.DebugDraw — the views a shipped (release) build of the engine honours. */
export const DebugDraw = Object.freeze({
  DISABLED: 'disabled',
  UNSHADED: 'unshaded',
  NORMAL_BUFFER: 'normal',
  SSAO: 'ssao',
  SSIL: 'ssil',
  DIRECTIONAL_SHADOW_ATLAS: 'shadow_atlas',
  INTERNAL_BUFFER: 'internal',
});

/** Standard position of sample 0 of a 4× MSAA pixel (from its top-left corner, rows downwards). */
const MSAA_4X_SAMPLE_0 = Object.freeze({ x: 0.375, y: 0.125 });
const DEFAULT_MSAA_SAMPLES = 4;
const DEFAULT_MAX_PIXEL_RATIO = 2;

/** copy_to_fb.glsl, the flags the debug views use. `source` keeps the engine's rows. */
const DEBUG_COPY = /* glsl */ `
uniform sampler2D source;
uniform int force_luminance;
uniform int decode_normal;
uniform vec4 rect;
uniform vec4 window;
layout(location = 0) out vec4 frag_color;
void main() {
	// rect: the part of the screen the view covers, from the top-left corner (row 0 is the top).
	vec2 uv = (vUv - rect.xy) / rect.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
	// window: the part of the source shown (the whole of it unless a tool zooms in).
	vec4 color = textureLod(source, window.xy + uv * window.zw, 0.0);
	if (force_luminance == 1) {
		color.rgb = vec3(max(max(color.r, color.g), color.b));
	}
	if (decode_normal == 1) {
		color.rgb = normalize(color.rgb * 2.0 - 1.0) * 0.5 + 0.5;
	}
	frag_color = vec4(color.rgb, 1.0);
}`;

/**
 * The shadow atlas as the engine's debug view shows it. The atlas can only be read through its
 * comparison sampler, so each texel's depth is found by bisection (16 steps: its 16 bits), at the
 * texel's centre, where the filter weighs a single texel.
 */
const DEBUG_ATLAS = /* glsl */ `
precision highp sampler2DShadow;
uniform sampler2DShadow atlas;
uniform float atlas_size;
uniform vec4 rect;
uniform vec4 window;
layout(location = 0) out vec4 frag_color;
void main() {
	vec2 uv = (vUv - rect.xy) / rect.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
	uv = window.xy + uv * window.zw;
	vec2 texel = (floor(uv * atlas_size) + 0.5) / atlas_size;
	float low = 0.0;
	float high = 1.0;
	for (int i = 0; i < 16; i++) {
		float middle = 0.5 * (low + high);
		// 1 when the reference is nearer to the light than the texel.
		if (texture(atlas, vec3(texel, middle)) > 0.5) low = middle;
		else high = middle;
	}
	// Depth grows away from the light here; the engine shows it reversed, empty texels black.
	float depth = high >= 1.0 ? 0.0 : 1.0 - high;
	frag_color = vec4(vec3(depth), 1.0);
}`;

const tmpSphere = new THREE.Sphere();
const tmpScale = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpFrustum = new THREE.Frustum();
const tmpViewProjection = new THREE.Matrix4();

/** Colour attachments of the HDR target: the lit colour, and the specular light when it is apart. */
const COLOR_ATTACHMENTS = Object.freeze({ COMBINED: 1, SEPARATE_SPECULAR: 2 });

const isTransparentMaterial = (material) => (Array.isArray(material) ? material.some((m) => m?.transparent) : Boolean(material?.transparent));

/**
 * The engine's alpha list (RenderList::sort_by_reverse_depth_and_priority): by material priority,
 * then from far to near by the distance between the camera and the centre of the instance's bounds
 * (`userData.sortDepth`, filled by the pipeline each frame). Draw order settles what is left.
 */
function byPriorityThenFarthest(a, b) {
  const priorityA = a.material.renderPriority ?? a.renderOrder;
  const priorityB = b.material.renderPriority ?? b.renderOrder;
  if (priorityA !== priorityB) return priorityA - priorityB;
  const depthA = a.object.userData.sortDepth ?? a.z;
  const depthB = b.object.userData.sortDepth ?? b.z;
  if (depthA !== depthB) return depthB - depthA;
  return a.id - b.id;
}

export class RenderPipeline {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{msaa?: number, maxPixelRatio?: number, shadowSize?: number, renderingMethod?: string}} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    // Which renderer this is decides what the game turns on (arena.js, arena_props.js).
    RenderingServer.set_rendering_method(options.renderingMethod ?? defaultRenderingMethod());
    this.renderer.setTransparentSort(byPriorityThenFarthest);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.msaa = options.msaa ?? DEFAULT_MSAA_SAMPLES;
    this.maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
    this.renderScale = 1;
    this.scene = new THREE.Scene();
    // World matrices are refreshed once per frame, not once per pass.
    this.scene.matrixWorldAutoUpdate = false;
    this.quad = new FullscreenQuad(this.renderer);
    this.glow = new Glow(this.quad);
    this.tonemapper = new Tonemapper(this.quad);
    this.shadows = new DirectionalShadowAtlas(options.shadowSize);
    // The atlas exists from the start: the fog reads it even before a light has drawn into it.
    this.renderer.initRenderTarget(this.shadows.target);
    this.dfg = integrateDfg(this.quad);
    this.bestFitNormals = computeBestFitNormals(this.quad);
    sharedUniforms.uDfg.value = this.dfg.texture;
    sharedUniforms.uBestFitNormal.value = this.bestFitNormals.texture;
    this.debugCopy = fullscreenMaterial(DEBUG_COPY, {
      source: { value: null },
      force_luminance: { value: 0 },
      decode_normal: { value: 0 },
      rect: { value: new THREE.Vector4(0, 0, 1, 1) },
      window: { value: new THREE.Vector4(0, 0, 1, 1) },
    });
    this.debugAtlas = fullscreenMaterial(DEBUG_ATLAS, {
      atlas: { value: this.shadows.texture },
      atlas_size: { value: this.shadows.size },
      rect: { value: new THREE.Vector4(0, 0, 1, 1) },
      window: { value: new THREE.Vector4(0, 0, 1, 1) },
    });
    /** Tools: `{x, y, width, height}` (in atlas uv) shows that part of the shadow atlas over the whole screen. */
    this.debugAtlasWindow = null;
    /** The camera every screen pass draws with: the scene camera, mirrored in Y. */
    this.renderCamera = new THREE.PerspectiveCamera();
    this.renderCamera.matrixAutoUpdate = false;
    this.renderCamera.matrixWorldAutoUpdate = false;
    this.width = 0;
    this.height = 0;
    this.targets = null;
    /** Attached by their modules (sky.js, ss_effects.js, volumetric_fog.js, subsurface.js). */
    this.sky = null;
    this.ssEffects = null;
    this.volumetricFog = null;
    this.subsurface = null;
    /** The HDR colour target (MSAA), with one attachment or two: see _colorTarget. */
    this.colorTarget = null;
    /** dev/gpu_profiler.js, when a tool attaches one: every pass is timed. */
    this.profiler = null;
    this.debugDraw = DebugDraw.DISABLED;
    this.setPrepassSample(MSAA_4X_SAMPLE_0);
    new ScreenSpaceEffects(this);
    new VolumetricFog(this);
    new SubsurfaceScattering(this, PassLayer.TRANSPARENT);
    /** RendererCompositorRD::frame: it starts at 1 and every frame begins by advancing it. */
    this.frameNumber = 1;
    this.stats = { frame: 0, drawCalls: 0, triangles: 0, subsurface: false };
    this._prepassList = [];
    this._casterList = [];
    this._opaqueList = [];
    /** Whether a surface that scatters light under its skin is in view (scene_state.used_sss). */
    this._scattersInView = false;
  }

  /** CSS size × device pixel ratio (capped) × dynamic render scale. */
  resize(cssWidth, cssHeight, devicePixelRatio = 1) {
    const ratio = Math.min(devicePixelRatio, this.maxPixelRatio) * this.renderScale;
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this._allocate();
  }

  _allocate() {
    const attachments = this.colorTarget?.textures.length ?? COLOR_ATTACHMENTS.COMBINED;
    this._disposeTargets();
    const { width, height } = this;
    this.colorTarget = this._createColorTarget(attachments);
    // Two attachments: normal and roughness in 8 bits (the engine's format), and the view depth.
    const prepass = new THREE.WebGLRenderTarget(width, height, {
      count: 2,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    prepass.textures[1].type = THREE.FloatType;
    prepass.textures[1].format = THREE.RedFormat;
    // The screen buffer: the final 8-bit image in the engine's rows, the 2D canvas is drawn on it.
    const screen = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.targets = { prepass, screen };
    this.renderer.initRenderTarget(screen);
    this.glow.resize(width, height);
    sharedUniforms.uViewport.value.set(width, height);
    sharedUniforms.uScreenPixelSize.value.set(1 / width, 1 / height);
    this.ssEffects?.resize(width, height);
    this.volumetricFog?.resize(width, height);
    this.subsurface?.resize(width, height);
  }

  /** The HDR colour target: RGBA16F, MSAA, depth; `attachments` colour buffers. */
  _createColorTarget(attachments) {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      count: attachments,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: this.msaa,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // The merge of the specular light reads the resolved textures while it draws into the samples:
    // they must stay apart from the samples (no implicit resolve into the texture, where offered).
    this.renderer.properties.get(target).__useRenderToTexture = false;
    return target;
  }

  /** Changes the samples of the colour target (0: no multisampling). Tools compare costs with it. */
  setMsaa(samples) {
    if (samples === this.msaa) return;
    this.msaa = samples;
    if (!this.colorTarget) return;
    const attachments = this.colorTarget.textures.length;
    this.colorTarget.dispose();
    this.colorTarget = this._createColorTarget(attachments);
  }

  /**
   * The HDR colour target for a frame that keeps the specular light apart or not. The first frame
   * that needs the second attachment gets a target with it, and later frames keep that target (the
   * second attachment then simply goes unused) rather than allocate again. O(1).
   */
  _colorTarget(separateSpecular) {
    if (separateSpecular && this.colorTarget.textures.length < COLOR_ATTACHMENTS.SEPARATE_SPECULAR) {
      this.colorTarget.dispose();
      this.colorTarget = this._createColorTarget(COLOR_ATTACHMENTS.SEPARATE_SPECULAR);
    }
    return this.colorTarget;
  }

  /**
   * The point of each pixel the prepass looks through: `sample` is measured from the pixel's top-left
   * corner (rows downwards), (0.5, 0.5) being its centre. The image moves the opposite way.
   */
  setPrepassSample(sample) {
    this.prepassSample = sample;
    sharedUniforms.uPrepassShift.value.set(0.5 - sample.x, 0.5 - sample.y);
  }

  _disposeTargets() {
    this.colorTarget?.dispose();
    this.colorTarget = null;
    this.targets?.prepass.dispose();
    this.targets?.screen.dispose();
    this.targets = null;
  }

  /** The scene camera, mirrored in Y (clip space): rows run from the top, like the engine's. */
  _mirrorCamera(camera) {
    const mirror = this.renderCamera;
    mirror.matrixWorld.copy(camera.matrixWorld);
    mirror.matrixWorldInverse.copy(camera.matrixWorldInverse);
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    const e = mirror.projectionMatrix.elements;
    e[1] = -e[1];
    e[5] = -e[5];
    e[9] = -e[9];
    e[13] = -e[13];
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;
    return mirror;
  }

  /**
   * Sorts the visible meshes into the passes they take part in (and into the cascades a caster can
   * reach), and notes whether a surface that scatters light is in view. O(meshes · cascades).
   */
  _collect(camera) {
    const prepass = this._prepassList;
    const casters = this._casterList;
    const opaque = this._opaqueList;
    prepass.length = 0;
    casters.length = 0;
    opaque.length = 0;
    this._scattersInView = false;
    const cascades = this.shadows.cascades;
    const cascadeCount = this.shadows.count;
    const eye = tmpEye.setFromMatrixPosition(camera.matrixWorld);
    const frustum = tmpFrustum.setFromProjectionMatrix(tmpViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.scene.traverseVisible((object) => {
      if (!object.isMesh) return;
      // Pipeline meshes (the specular merge) say themselves which passes they are in.
      if (object.userData.passLayers !== undefined) {
        object.layers.mask = object.userData.passLayers;
        return;
      }
      const material = object.material;
      const transparent = isTransparentMaterial(material);
      let mask = 1 << (transparent ? PassLayer.TRANSPARENT : PassLayer.COLOR);
      if (transparent) object.userData.sortDepth = this._sortDepth(object, eye);
      if (material instanceof SpatialMaterial) {
        if (!transparent) opaque.push(object);
        // The render list is what survives the frustum: a surface out of view scatters nothing.
        if (material.usesSss && !this._scattersInView && this._inFrustum(object, frustum)) this._scattersInView = true;
        if (material.inPrepass) {
          mask |= 1 << PassLayer.PREPASS;
          prepass.push(object);
        }
        if (cascadeCount > 0 && object.userData.castShadow !== false && material.castsShadow) {
          const sphere = this._worldSphere(object);
          let reached = false;
          for (let i = 0; i < cascadeCount; i++) {
            if (sphere && !cascades[i].intersectsSphere(sphere.center, sphere.radius)) continue;
            mask |= 1 << cascades[i].layer;
            reached = true;
          }
          if (reached) casters.push(object);
        }
      }
      object.layers.mask = mask;
    });
  }

  /**
   * Distance from the camera to the centre of the mesh's world bounds (the engine's instance depth
   * with use_aabb_center). `userData.sortBox` replaces the geometry's box, in the space of
   * `userData.sortSpace` when given (particles: the visibility AABB, in the emitter's space).
   */
  _sortDepth(object, eye) {
    let box = object.userData.sortBox ?? object.boundingBox ?? null;
    if (!box) {
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      box = geometry.boundingBox;
    }
    const space = object.userData.sortSpace ?? object;
    if (!box || box.isEmpty()) return tmpCenter.setFromMatrixPosition(space.matrixWorld).distanceTo(eye);
    return tmpBox.copy(box).applyMatrix4(space.matrixWorld).getCenter(tmpCenter).distanceTo(eye);
  }

  /**
   * Whether the world bounds of a mesh reach into the frustum (the engine culls instances by their
   * AABB against the frustum planes). Unknown bounds count as inside. O(1).
   */
  _inFrustum(object, frustum) {
    if (object.frustumCulled === false) return true;
    let box = object.boundingBox ?? null;
    if (!box && object.isInstancedMesh) {
      object.computeBoundingBox();
      box = object.boundingBox;
    }
    if (!box) {
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      box = geometry.boundingBox;
    }
    if (!box || box.isEmpty()) return true;
    return frustum.intersectsBox(tmpBox.copy(box).applyMatrix4(object.matrixWorld));
  }

  /** World-space bounding sphere of a mesh (null: unknown, never culled). */
  _worldSphere(object) {
    let local = object.boundingSphere ?? null;
    if (!local) {
      const geometry = object.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      local = geometry.boundingSphere;
    }
    if (!local || !Number.isFinite(local.radius)) return null;
    tmpSphere.copy(local);
    tmpSphere.center.applyMatrix4(object.matrixWorld);
    tmpScale.setFromMatrixScale(object.matrixWorld);
    tmpSphere.radius *= Math.max(tmpScale.x, tmpScale.y, tmpScale.z);
    return tmpSphere;
  }

  /** Draws `objects` with their `pass` programs through `camera`, then puts their materials back. */
  _drawPass(objects, pass, camera, uncullable) {
    const originals = objects.map((object) => object.material);
    for (const object of objects) {
      object.material = object.material.forPass(pass);
      // Casters may sit between the light and the shadow frustum (they are flattened onto its near plane).
      if (uncullable) object.frustumCulled = false;
    }
    this.renderer.render(this.scene, camera);
    objects.forEach((object, i) => {
      object.material = originals[i];
      if (uncullable) object.frustumCulled = true;
    });
  }

  _renderShadows(camera) {
    const light = lighting.packed.shadowLight;
    if (!light) {
      if (this.shadows.count > 0) this.shadows.clear(this.renderer);
      return;
    }
    this.shadows.setup(light, camera);
    this._collect(camera);
    const mainInvView = sharedUniforms.uInvView.value;
    const saved = mainInvView.clone();
    this.shadows.render(this.renderer, (cascade) => {
      mainInvView.copy(cascade.camera.matrixWorld);
      this._drawPass(this._casterList, Pass.SHADOW, cascade.camera, true);
    });
    mainInvView.copy(saved);
  }

  _renderPrepass(camera) {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.targets.prepass);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    camera.layers.set(PassLayer.PREPASS);
    this._drawPass(this._prepassList, Pass.PREPASS, camera, false);
  }

  /**
   * The colour of the scene into the HDR target. With a surface that scatters light in view, the
   * engine's order: the opaque pass with the specular light apart, the blur of the diffuse light,
   * then the merge and the transparent pass in one draw (subsurface.js). Returns the target.
   * @param {THREE.PerspectiveCamera} mirror the camera the screen passes draw with
   * @param {THREE.PerspectiveCamera} camera the scene camera
   */
  _renderColor(mirror, camera) {
    const renderer = this.renderer;
    const separate = this._scattersInView && Boolean(this.subsurface?.enabled);
    const target = this._colorTarget(separate);
    const profiler = this.profiler;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    if (!separate) {
      profiler?.section('color');
      mirror.layers.mask = (1 << PassLayer.COLOR) | (1 << PassLayer.TRANSPARENT);
      renderer.render(this.scene, mirror);
    } else {
      profiler?.section('opaque');
      mirror.layers.set(PassLayer.COLOR);
      this._drawPass(this._opaqueList, Pass.COLOR_SEPARATE, mirror, false);
      profiler?.section('subsurface');
      this.subsurface.scatter(target, camera);
      profiler?.section('transparent');
      mirror.layers.set(PassLayer.TRANSPARENT);
      renderer.setRenderTarget(target);
      renderer.render(this.scene, mirror);
      this.subsurface.disarm();
    }
    this.stats.subsurface = separate;
    return target;
  }

  /** One frame. `environment` is the Godot Environment; `camera` a THREE.PerspectiveCamera. */
  render(camera, environment) {
    const renderer = this.renderer;
    const t = this.targets;
    const debug = this.debugDraw;
    const profiler = this.profiler;
    this.frameNumber += 1;
    renderer.info.reset();
    profiler?.section('setup');
    this.scene.updateMatrixWorld();

    const wantsSsao = Boolean(this.ssEffects) && environment.ssao_enabled;
    const wantsSsil = Boolean(this.ssEffects) && environment.ssil_enabled;
    lighting.update(camera, { unshaded: debug === DebugDraw.UNSHADED, ssao: wantsSsao, ssil: wantsSsil });
    profiler?.section('sky');
    this.sky?.update(environment.sky);

    profiler?.section('shadows');
    this._renderShadows(camera);
    if (lighting.packed.shadowLight === null) this._collect(camera);

    const mirror = this._mirrorCamera(camera);
    if (wantsSsao || wantsSsil) {
      profiler?.section('prepass');
      this._renderPrepass(mirror);
      profiler?.section('ssao + ssil');
      this.ssEffects.render(t.prepass, camera, environment, { ssao: wantsSsao, ssil: wantsSsil });
    }
    profiler?.section('volumetric fog');
    this.volumetricFog?.update(camera, environment, this.shadows, this.frameNumber);

    const color = this._renderColor(mirror, camera);
    this.stats.drawCalls = renderer.info.render.calls;
    this.stats.triangles = renderer.info.render.triangles;

    const hdr = color.texture;
    if (wantsSsil) {
      profiler?.section('last frame');
      this.ssEffects.keepLastFrame(hdr);
    }
    profiler?.section('post');
    this._post(hdr, environment);
    profiler?.endFrame();
    this.stats.frame += 1;
  }

  /** Glow, tone curve and adjustments, or the debug view that replaces them. */
  _post(hdr, environment) {
    const debug = this.debugDraw;
    if (debug === DebugDraw.INTERNAL_BUFFER) {
      this._debugView(hdr, {});
      return;
    }
    // Views that replace the whole frame keep the tone curve and lose the effects.
    const effects = debug !== DebugDraw.UNSHADED;
    const post = effects ? environment : Object.create(environment, { glow_enabled: { value: false }, adjustment_enabled: { value: false } });
    const lastLevel = post.glow_enabled ? this.glow.render(hdr, post) : -1;
    this.tonemapper.render(hdr, post.glow_enabled ? this.glow : null, lastLevel, post, this.targets.screen);

    if (debug === DebugDraw.NORMAL_BUFFER && this.ssEffects) this._debugView(this.targets.prepass.textures[0], { decode_normal: 1 });
    else if (debug === DebugDraw.SSAO && this.ssEffects?.ssaoTexture) this._debugView(this.ssEffects.ssaoTexture, { force_luminance: 1 });
    else if (debug === DebugDraw.SSIL && this.ssEffects?.ssilTexture) this._debugView(this.ssEffects.ssilTexture, {});
    else if (debug === DebugDraw.DIRECTIONAL_SHADOW_ATLAS) {
      // A square of two thirds of the smallest side, in the top-left corner.
      const side = Math.min(Math.trunc((2 * this.width) / 3), Math.trunc((2 * this.height) / 3));
      const u = this.debugAtlas.uniforms;
      const w = this.debugAtlasWindow;
      if (w) {
        u.rect.value.set(0, 0, 1, 1);
        u.window.value.set(w.x, w.y, w.width, w.height);
      } else {
        u.rect.value.set(0, 0, side / this.width, side / this.height);
        u.window.value.set(0, 0, 1, 1);
      }
      this.quad.draw(this.debugAtlas, this.targets.screen);
    }
  }

  _debugView(texture, flags, rect = { x: 0, y: 0, width: 1, height: 1 }, window = { x: 0, y: 0, width: 1, height: 1 }) {
    const u = this.debugCopy.uniforms;
    u.window.value.set(window.x, window.y, window.width, window.height);
    u.source.value = texture;
    u.force_luminance.value = flags.force_luminance ?? 0;
    u.decode_normal.value = flags.decode_normal ?? 0;
    u.rect.value.set(rect.x, rect.y, rect.width, rect.height);
    this.quad.draw(this.debugCopy, this.targets.screen);
  }

  /** The screen buffer the 2D canvas is drawn into (the engine's rows). */
  get screenTarget() {
    return this.targets.screen;
  }

  /**
   * The frame reaches the canvas element: the screen buffer copied over, turned right side up (the
   * default framebuffer counts rows from the bottom). One blit, texel for texel. O(pixels).
   */
  present() {
    const renderer = this.renderer;
    const gl = renderer.getContext();
    const { width, height } = this;
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.properties.get(this.targets.screen).__webglFramebuffer);
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, width, height, 0, height, width, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    renderer.resetState();
  }

  /** Reads the canvas back as PNG (after a presented frame, in the same task). */
  snapshotDataUrl() {
    return this.canvas.toDataURL('image/png');
  }
}
