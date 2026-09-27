/**
 * Render pipeline — Godot 4 Forward+ post chain rebuilt on three.js WebGL2.
 *
 *   1. scene → HDR target, MSAA ×4, two attachments (colour, SSAO-able indirect light); sky drawn first
 *   2. SSAO (GTAO-style, half resolution) composited onto the indirect light only
 *   3. glow: Godot's gaussian_glow — per level a 7-tap horizontal pass that also halves the resolution
 *      and a 5-tap vertical pass; the first pass applies the HDR threshold/bloom feedback
 *   4. tonemap: exposure → Filmic(white) → sRGB, glow tonemapped the same way and blended with Godot's
 *      soft-light formula, then brightness/contrast/saturation — exactly tonemap.glsl's order
 *
 * The radiance cubemap for reflections is the sky shader rendered into a small mipmapped cube.
 */
import * as THREE from 'three';
import { sharedUniforms } from './lighting.js';

const FULLSCREEN_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function fullscreenMaterial(fragment, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: `precision highp float;\nprecision highp int;\nin vec2 vUv;\n${fragment}`,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Godot copy.glsl MODE_GAUSSIAN_GLOW, one direction per pass (texelFetch, section-clamped). */
const GLOW_FRAGMENT = /* glsl */ `
uniform sampler2D source_color;
uniform ivec2 source_size;
uniform int horizontal;
uniform int first_pass;
uniform float glow_strength;
uniform float glow_bloom;
uniform float glow_hdr_threshold;
uniform float glow_hdr_scale;
uniform float glow_luminance_cap;
layout(location = 0) out vec4 out_color;
vec4 fetch(ivec2 p) {
	if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, source_size))) return vec4(0.0);
	return texelFetch(source_color, p, 0);
}
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	vec4 color = vec4(0.0);
	if (horizontal == 1) {
		ivec2 base = pos * ivec2(2, 2);
		color += fetch(base) * 0.174938;
		color += fetch(base + ivec2(1, 0)) * 0.165569;
		color += fetch(base + ivec2(2, 0)) * 0.140367;
		color += fetch(base + ivec2(3, 0)) * 0.106595;
		color += fetch(base + ivec2(-1, 0)) * 0.165569;
		color += fetch(base + ivec2(-2, 0)) * 0.140367;
		color += fetch(base + ivec2(-3, 0)) * 0.106595;
		color *= glow_strength;
	} else {
		color += fetch(pos) * 0.288713;
		color += fetch(pos + ivec2(0, 1)) * 0.233062;
		color += fetch(pos + ivec2(0, 2)) * 0.122581;
		color += fetch(pos + ivec2(0, -1)) * 0.233062;
		color += fetch(pos + ivec2(0, -2)) * 0.122581;
		color *= glow_strength;
	}
	if (first_pass == 1) {
		float luminance = max(color.r, max(color.g, color.b));
		float feedback = max(smoothstep(glow_hdr_threshold, glow_hdr_threshold + glow_hdr_scale, luminance), glow_bloom);
		color = min(color * feedback, vec4(glow_luminance_cap));
	}
	out_color = color;
}`;

/** Godot tonemap.glsl (Filmic, soft-light glow, BCS). */
const TONEMAP_FRAGMENT = /* glsl */ `
uniform sampler2D source_color;
uniform sampler2D glow0;
uniform sampler2D glow1;
uniform sampler2D glow2;
uniform sampler2D glow3;
uniform sampler2D glow4;
uniform float glow_levels[5];
uniform float glow_intensity;
uniform int use_glow;
uniform float exposure;
uniform float white;
uniform int tonemapper;
uniform vec3 bcs;
uniform int use_bcs;
uniform float dither_strength;
layout(location = 0) out vec4 out_color;

vec3 tonemap_filmic(vec3 color, float p_white) {
	const float exposure_bias = 2.0;
	const float A = 0.22 * exposure_bias * exposure_bias;
	const float B = 0.30 * exposure_bias;
	const float C = 0.10;
	const float D = 0.20;
	const float E = 0.01;
	const float F = 0.30;
	vec3 color_tonemapped = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
	float white_tonemapped = ((p_white * (A * p_white + C * B) + D * E) / (p_white * (A * p_white + B) + D * F)) - E / F;
	return color_tonemapped / white_tonemapped;
}
vec3 apply_tonemapping(vec3 color, float p_white) {
	if (tonemapper == 1) return tonemap_filmic(max(vec3(0.0), color), p_white);
	return color;
}
vec3 linear_to_srgb(vec3 color) {
	color = clamp(color, vec3(0.0), vec3(1.0));
	const vec3 a = vec3(0.055);
	return mix((vec3(1.0) + a) * pow(color.rgb, vec3(1.0 / 2.4)) - a, 12.92 * color.rgb, lessThan(color.rgb, vec3(0.0031308)));
}
float softlight(float c, float g) {
	return (g <= 0.5) ? (c - (1.0 - 2.0 * g) * c * (1.0 - c))
		: (((g > 0.5) && (c <= 0.25)) ? (c + (2.0 * g - 1.0) * (4.0 * c * (4.0 * c + 1.0) * (c - 1.0) + 7.0 * c))
		: (c + (2.0 * g - 1.0) * (sqrt(c) - c)));
}
vec3 apply_glow(vec3 color, vec3 glow) {
	glow = glow * vec3(0.5) + vec3(0.5);
	return vec3(softlight(color.r, glow.r), softlight(color.g, glow.g), softlight(color.b, glow.b));
}
vec3 gather_glow(vec2 uv) {
	vec3 glow = vec3(0.0);
	if (glow_levels[0] > 0.0001) glow += texture(glow0, uv).rgb * glow_levels[0];
	if (glow_levels[1] > 0.0001) glow += texture(glow1, uv).rgb * glow_levels[1];
	if (glow_levels[2] > 0.0001) glow += texture(glow2, uv).rgb * glow_levels[2];
	if (glow_levels[3] > 0.0001) glow += texture(glow3, uv).rgb * glow_levels[3];
	if (glow_levels[4] > 0.0001) glow += texture(glow4, uv).rgb * glow_levels[4];
	return glow;
}
vec3 apply_bcs(vec3 color, vec3 p_bcs) {
	color = mix(vec3(0.0), color, p_bcs.x);
	color = mix(vec3(0.5), color, p_bcs.y);
	color = mix(vec3(dot(vec3(1.0), color) * 0.33333), color, p_bcs.z);
	return color;
}
// Godot's screen_space_dither (debanding), off unless dither_strength > 0.
vec3 screen_space_dither(vec2 frag_coord) {
	vec3 dither = vec3(dot(vec2(171.0, 231.0), frag_coord));
	dither.rgb = fract(dither.rgb / vec3(103.0, 71.0, 97.0));
	return (dither.rgb - 0.5) / 255.0;
}
void main() {
	vec4 color = texture(source_color, vUv);
	color.rgb *= exposure;
	color.rgb = apply_tonemapping(color.rgb, white);
	color.rgb = linear_to_srgb(color.rgb);
	if (use_glow == 1) {
		vec3 glow = gather_glow(vUv) * glow_intensity;
		glow = apply_tonemapping(glow, white);
		glow = linear_to_srgb(glow);
		color.rgb = apply_glow(color.rgb, glow);
	}
	if (use_bcs == 1) color.rgb = apply_bcs(color.rgb, bcs);
	if (dither_strength > 0.0) color.rgb += screen_space_dither(gl_FragCoord.xy) * dither_strength;
	out_color = vec4(color.rgb, 1.0);
}`;

/** color − indirect·(1 − ao): SSAO touches only what Godot lets it touch. */
const AO_COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D color_tex;
uniform sampler2D indirect_tex;
uniform sampler2D ao_tex;
uniform int use_ao;
layout(location = 0) out vec4 out_color;
void main() {
	vec4 color = texture(color_tex, vUv);
	if (use_ao == 1) {
		vec3 indirect = texture(indirect_tex, vUv).rgb;
		float ao = texture(ao_tex, vUv).r;
		color.rgb = max(color.rgb - indirect * (1.0 - ao), vec3(0.0));
	}
	out_color = vec4(color.rgb, 1.0);
}`;

const GLOW_LEVELS = 5;
const GLOW_LUMINANCE_CAP = 12.0;

export class RenderPipeline {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{msaa?: number, maxPixelRatio?: number, shadowMapSize?: number}} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.msaa = options.msaa ?? 4;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.renderScale = 1;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.glowMaterial = fullscreenMaterial(GLOW_FRAGMENT, {
      source_color: { value: null },
      source_size: { value: new THREE.Vector2() },
      horizontal: { value: 1 },
      first_pass: { value: 0 },
      glow_strength: { value: 1 },
      glow_bloom: { value: 0 },
      glow_hdr_threshold: { value: 1 },
      glow_hdr_scale: { value: 2 },
      glow_luminance_cap: { value: GLOW_LUMINANCE_CAP },
    });
    this.tonemapMaterial = fullscreenMaterial(TONEMAP_FRAGMENT, {
      source_color: { value: null },
      glow0: { value: null },
      glow1: { value: null },
      glow2: { value: null },
      glow3: { value: null },
      glow4: { value: null },
      glow_levels: { value: [0, 0, 1, 0, 1] },
      glow_intensity: { value: 0.8 },
      use_glow: { value: 1 },
      exposure: { value: 1 },
      white: { value: 1 },
      tonemapper: { value: 1 },
      bcs: { value: new THREE.Vector3(1, 1, 1) },
      use_bcs: { value: 0 },
      dither_strength: { value: 0 },
    });
    this.aoCompositeMaterial = fullscreenMaterial(AO_COMPOSITE_FRAGMENT, {
      color_tex: { value: null },
      indirect_tex: { value: null },
      ao_tex: { value: null },
      use_ao: { value: 0 },
    });
    this.width = 0;
    this.height = 0;
    this.targets = null;
    this.ssao = null;
    this.stats = { frame: 0, drawCalls: 0, triangles: 0 };
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
    this._disposeTargets();
    const { width, height } = this;
    const scene = new THREE.WebGLRenderTarget(width, height, {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: this.msaa,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const composite = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const glow = [];
    const glowTemp = [];
    let w = width;
    let h = height;
    for (let i = 0; i < GLOW_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      glow.push(new THREE.WebGLRenderTarget(w, h, options));
      glowTemp.push(new THREE.WebGLRenderTarget(w, h, options));
    }
    this.targets = { scene, composite, glow, glowTemp };
    sharedUniforms.uViewport.value.set(width, height);
    this.ssao?.resize(width, height);
  }

  _disposeTargets() {
    if (!this.targets) return;
    this.targets.scene.dispose();
    this.targets.composite.dispose();
    for (const t of this.targets.glow) t.dispose();
    for (const t of this.targets.glowTemp) t.dispose();
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * One frame. `environment` is the Godot Environment; `camera` a THREE.PerspectiveCamera.
   */
  render(camera, environment) {
    const renderer = this.renderer;
    const t = this.targets;
    renderer.setRenderTarget(t.scene);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, camera);
    this.stats.drawCalls = renderer.info.render.calls;
    this.stats.triangles = renderer.info.render.triangles;

    // SSAO on the indirect light, composited into a resolved HDR colour.
    let hdr = t.scene.textures[0];
    const useAo = Boolean(this.ssao && environment.ssao_enabled);
    if (useAo) {
      this.ssao.render(renderer, t.scene, camera, environment);
      const u = this.aoCompositeMaterial.uniforms;
      u.color_tex.value = t.scene.textures[0];
      u.indirect_tex.value = t.scene.textures[1];
      u.ao_tex.value = this.ssao.texture;
      u.use_ao.value = 1;
      this._blit(this.aoCompositeMaterial, t.composite);
      hdr = t.composite.texture;
    }

    // Glow chain.
    const gu = this.glowMaterial.uniforms;
    const useGlow = environment.glow_enabled;
    if (useGlow) {
      gu.glow_strength.value = environment.glow_strength;
      gu.glow_bloom.value = environment.glow_bloom;
      gu.glow_hdr_threshold.value = environment.glow_hdr_threshold;
      gu.glow_hdr_scale.value = environment.glow_hdr_scale;
      let source = hdr;
      let sourceW = this.width;
      let sourceH = this.height;
      for (let i = 0; i < GLOW_LEVELS; i++) {
        gu.source_color.value = source;
        gu.source_size.value.set(sourceW, sourceH);
        gu.horizontal.value = 1;
        gu.first_pass.value = i === 0 ? 1 : 0;
        this._blit(this.glowMaterial, t.glowTemp[i]);
        gu.source_color.value = t.glowTemp[i].texture;
        gu.source_size.value.set(t.glowTemp[i].width, t.glowTemp[i].height);
        gu.horizontal.value = 0;
        gu.first_pass.value = 0;
        this._blit(this.glowMaterial, t.glow[i]);
        source = t.glow[i].texture;
        sourceW = t.glow[i].width;
        sourceH = t.glow[i].height;
      }
    }

    // Tonemap to the canvas.
    const tu = this.tonemapMaterial.uniforms;
    tu.source_color.value = hdr;
    for (let i = 0; i < GLOW_LEVELS; i++) tu[`glow${i}`].value = t.glow[i].texture;
    tu.use_glow.value = useGlow ? 1 : 0;
    tu.glow_intensity.value = environment.glow_intensity;
    tu.exposure.value = environment.tonemap_exposure;
    tu.white.value = environment.tonemap_white;
    tu.tonemapper.value = environment.tonemap_mode === 'filmic' ? 1 : 0;
    tu.use_bcs.value = environment.adjustment_enabled ? 1 : 0;
    tu.bcs.value.set(environment.adjustment_brightness, environment.adjustment_contrast, environment.adjustment_saturation);
    renderer.setRenderTarget(null);
    this._blit(this.tonemapMaterial, null);
    this.stats.frame += 1;
  }

  /** Reads the canvas back as PNG (after a render in the same task). */
  snapshotDataUrl() {
    return this.canvas.toDataURL('image/png');
  }
}
