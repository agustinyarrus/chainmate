/**
 * Sky — Godot's `shader_type sky` for the arena: the background, and the radiance the scene shader
 * reflects (Environment.reflected_light_source = BG), built like Godot 4.7's SkyRD does it with
 * texture-array reflections:
 *
 *   radiance        octahedral maps of 2·size + border (160² for RADIANCE_SIZE_64), one layer per
 *                   roughness step (8), each with its mip chain (5)
 *   layer 0         the sky shader itself, drawn into the octahedral map
 *   layers 1…7      GGX importance sampling (Hammersley, 64 samples; 128 on the last layer) of the
 *                   downsampled layer 0, mip chosen by each sample's solid angle
 *   mips            a Jacobian-weighted 2×2 downsample (Activision's octmap downsampler)
 *
 * The sky's material has parameters, so its update mode resolves to INCREMENTAL: the first build
 * happens in one frame; after a change layer 0 is redrawn at once and the rough layers follow one per
 * frame. Octahedral coordinates are the engine's numerically (uv → direction), so no row is flipped.
 */
import * as THREE from 'three';
import { SKY_FUNCTION } from '../../presentation/shaders.js';
import { SMOOTHSTEP_GLSL, OCT_GLSL, portGlsl } from './material.js';
import { sharedUniforms } from './lighting.js';
import { fullscreenMaterial, withMipChain } from './fullscreen.js';

/** Sky.RADIANCE_SIZE_64 */
const RADIANCE_SIZE = 64;
/** rendering/reflections/sky_reflections/roughness_layers */
const ROUGHNESS_LAYERS = 8;
/** rendering/reflections/sky_reflections/ggx_samples, capped at 64 by the engine. */
const GGX_SAMPLES = 32;
/** The filter's compute groups are 8×8: sample counts come in multiples of 64. */
const SAMPLE_GROUP = 64;

/** Image::get_image_required_mipmaps + 1, minus the two levels the array variant drops. */
const RADIANCE_MIPMAPS = Math.floor(Math.log2(RADIANCE_SIZE)) + 1 - 2;
const PADDING_PIXELS = 1 << (RADIANCE_MIPMAPS - 1);
const OCTMAP_SIZE = RADIANCE_SIZE * 2 + PADDING_PIXELS * 2;
const UV_BORDER = PADDING_PIXELS / OCTMAP_SIZE;

function skyUniforms() {
  return {
    top_color: { value: new THREE.Vector3() },
    horizon_color: { value: new THREE.Vector3() },
    bottom_color: { value: new THREE.Vector3() },
    glow_color: { value: new THREE.Vector3() },
    glow_dir: { value: new THREE.Vector3(-0.8, 0, -0.6) },
    uInvView: sharedUniforms.uInvView,
  };
}

// The view ray is unprojected per vertex (homogeneous, so it interpolates exactly) and divided per pixel.
const BACKGROUND_VERTEX = /* glsl */ `
out vec4 vViewH;
void main() {
	vViewH = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
	gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const BACKGROUND_FRAGMENT = /* glsl */ `
precision highp float;
uniform mat4 uInvView;
in vec4 vViewH;
layout(location = 0) out vec4 out_color;
// With the specular light apart (subsurface scattering), the sky leaves that buffer as cleared: no
// light, and the depth of the far plane. Without it, nothing is attached there and the value is dropped.
layout(location = 1) out vec4 out_specular;
${SMOOTHSTEP_GLSL}
${portGlsl(SKY_FUNCTION)}
void main() {
	vec3 eyedir = normalize((uInvView * vec4(vViewH.xyz / vViewH.w, 0.0)).xyz);
	// Alpha is cleared for the sky (the engine keeps it for subsurface scattering).
	out_color = vec4(gd_sky(eyedir), 0.0);
	out_specular = vec4(0.0);
}`;

const SKY_TO_OCTMAP = /* glsl */ `
uniform vec2 border_size;
layout(location = 0) out vec4 out_color;
${SMOOTHSTEP_GLSL}
${OCT_GLSL}
${portGlsl(SKY_FUNCTION)}
void main() {
	vec3 cube_normal = oct_to_vec3_with_border(vUv, border_size.y);
	out_color = vec4(gd_sky(cube_normal), 1.0);
}`;

const OCTMAP_DOWNSAMPLE = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D source_octmap;
uniform sampler2DArray source_array;
uniform int from_array;
uniform float source_layer;
uniform float source_lod;
uniform float border_size;
uniform float size;
layout(location = 0) out vec4 out_color;
${OCT_GLSL}
// An approximation of the Jacobian.
float calcWeight(float u, float v) {
	vec3 d = oct_to_vec3_with_border(vec2(u, v) * 0.5 + 0.5, border_size);
	return 1.0 / pow(abs(d.z) + 1.0, 3.0);
}
vec4 fetch(vec2 uv) {
	// One exit: Direct3D's compiler reads a return inside a branch as a path without a value.
	vec4 color;
	if (from_array == 1) color = textureLod(source_array, vec3(uv, source_layer), source_lod);
	else color = textureLod(source_octmap, uv, source_lod);
	return color;
}
void main() {
	vec2 id = floor(gl_FragCoord.xy);
	float inv_size = 1.0 / size;
	float u0 = (id.x * 2.0 + 1.0 - 0.75) * inv_size - 1.0;
	float u1 = (id.x * 2.0 + 1.0 + 0.75) * inv_size - 1.0;
	float v0 = (id.y * 2.0 + 1.0 - 0.75) * inv_size - 1.0;
	float v1 = (id.y * 2.0 + 1.0 + 0.75) * inv_size - 1.0;
	float weights[4];
	weights[0] = calcWeight(u0, v0);
	weights[1] = calcWeight(u1, v0);
	weights[2] = calcWeight(u0, v1);
	weights[3] = calcWeight(u1, v1);
	float wsum = 0.5 / (weights[0] + weights[1] + weights[2] + weights[3]);
	for (int i = 0; i < 4; i++) {
		weights[i] = weights[i] * wsum + 0.125;
	}
	vec4 color = fetch(vec2(u0, v0) * 0.5 + 0.5) * weights[0];
	color += fetch(vec2(u1, v0) * 0.5 + 0.5) * weights[1];
	color += fetch(vec2(u0, v1) * 0.5 + 0.5) * weights[2];
	color += fetch(vec2(u1, v1) * 0.5 + 0.5) * weights[3];
	out_color = color;
}`;

const OCTMAP_ROUGHNESS = /* glsl */ `
#define M_PI 3.14159265359
uniform sampler2D source_oct;
uniform float roughness;
uniform int total_samples;
uniform float dest_size;
uniform vec2 border_size;
layout(location = 0) out vec4 out_color;
${OCT_GLSL}
vec3 ImportanceSampleGGX(vec2 xi, float roughness4) {
	float Phi = 2.0 * M_PI * xi.x;
	float CosTheta = sqrt((1.0 - xi.y) / (1.0 + (roughness4 - 1.0) * xi.y));
	float SinTheta = sqrt(1.0 - CosTheta * CosTheta);
	return vec3(SinTheta * cos(Phi), SinTheta * sin(Phi), CosTheta);
}
float DistributionGGX(float NdotH, float roughness4) {
	float NdotH2 = NdotH * NdotH;
	float denom = (NdotH2 * (roughness4 - 1.0) + 1.0);
	denom = M_PI * denom * denom;
	return roughness4 / denom;
}
float radicalInverse_VdC(uint bits) {
	bits = (bits << 16u) | (bits >> 16u);
	bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
	bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
	bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
	bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
	return float(bits) * 2.3283064365386963e-10;
}
vec2 Hammersley(uint i, uint N) {
	return vec2(float(i) / float(N), radicalInverse_VdC(i));
}
void main() {
	float solid_angle_texel = 4.0 * M_PI / (dest_size * dest_size);
	float roughness2 = roughness * roughness;
	float roughness4 = roughness2 * roughness2;
	vec3 N = oct_to_vec3_with_border(vUv, border_size.y);
	vec3 UpVector = abs(N.y) < 0.99999 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
	mat3 T;
	T[0] = normalize(cross(UpVector, N));
	T[1] = cross(N, T[0]);
	T[2] = N;
	vec4 sum = vec4(0.0);
	for (int i = 0; i < total_samples; i++) {
		vec2 xi = Hammersley(uint(i), uint(total_samples));
		vec3 H_local = ImportanceSampleGGX(xi, roughness4);
		float NdotH = H_local.z;
		vec3 L_local = 2.0 * NdotH * H_local - vec3(0.0, 0.0, 1.0);
		float ndotl = L_local.z;
		if (ndotl > 0.0) {
			float D = DistributionGGX(NdotH, roughness4);
			float pdf = D * NdotH / (4.0 * NdotH) + 0.0001;
			float solid_angle_sample = 1.0 / (float(total_samples) * pdf + 0.0001);
			float mipLevel = 0.5 * log2(solid_angle_sample / solid_angle_texel);
			vec3 L_world = T * L_local;
			vec2 sample_uv = vec3_to_oct_with_border(L_world, border_size);
			sum.rgb += textureLod(source_oct, sample_uv, mipLevel).rgb * ndotl;
			sum.a += ndotl;
		}
	}
	out_color = vec4(sum.rgb / sum.a, 1.0);
}`;

const COPY = /* glsl */ `
uniform sampler2D source;
layout(location = 0) out vec4 out_color;
void main() {
	out_color = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
}`;

/** How many samples the filter takes for a layer: multiples of the engine's 8×8 compute group. */
function samplesForLayer(layer) {
  const perceptual = layer / (ROUGHNESS_LAYERS - 1);
  const roughness = perceptual * perceptual;
  const scaled = Math.max(Math.trunc(Math.min(GGX_SAMPLES, 64) * 4 * roughness), 4);
  return { roughness, total: Math.max(1, Math.trunc(scaled / SAMPLE_GROUP)) * SAMPLE_GROUP };
}

/** The radiance array and the passes that fill it. */
class RadianceOctmap {
  /** @param {FullscreenQuad} quad */
  constructor(quad, skyUniformValues) {
    this.quad = quad;
    this.layers = ROUGHNESS_LAYERS;
    this.mipmaps = RADIANCE_MIPMAPS;
    this.size = OCTMAP_SIZE;
    this.target = new THREE.WebGLArrayRenderTarget(OCTMAP_SIZE, OCTMAP_SIZE, ROUGHNESS_LAYERS, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
    });
    withMipChain(quad.renderer, this.target, RADIANCE_MIPMAPS);
    // The source of the filter: layer 0 downsampled, half the size, one level less.
    this.downsampled = new THREE.WebGLRenderTarget(OCTMAP_SIZE >> 1, OCTMAP_SIZE >> 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
    });
    withMipChain(quad.renderer, this.downsampled, RADIANCE_MIPMAPS - 1);
    // A level is never drawn while its own texture is being read (WebGL forbids the feedback):
    // each mip is computed into a scratch target of its size and copied into place.
    this.scratch = new Map();
    for (let level = 1; level < RADIANCE_MIPMAPS; level++) {
      const size = OCTMAP_SIZE >> level;
      this.scratch.set(size, new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }));
    }
    this.copyMaterial = fullscreenMaterial(COPY, { source: { value: null } });
    const border = new THREE.Vector2(UV_BORDER, 1 - UV_BORDER * 2);
    this.skyMaterial = fullscreenMaterial(SKY_TO_OCTMAP, { ...skyUniformValues, border_size: { value: border } });
    this.downsampleMaterial = fullscreenMaterial(OCTMAP_DOWNSAMPLE, {
      source_octmap: { value: null },
      source_array: { value: null },
      from_array: { value: 0 },
      source_layer: { value: 0 },
      source_lod: { value: 0 },
      border_size: { value: border.y },
      size: { value: 1 },
    });
    this.roughnessMaterial = fullscreenMaterial(OCTMAP_ROUGHNESS, {
      source_oct: { value: this.downsampled.texture },
      roughness: { value: 0 },
      total_samples: { value: SAMPLE_GROUP },
      dest_size: { value: OCTMAP_SIZE },
      border_size: { value: border },
    });
    /** Next rough layer to filter (SkyRD's processing_layer); 0: nothing built yet. */
    this.processingLayer = 0;
    this.dirty = true;
  }

  _draw(material, target, layer, level, size) {
    target.viewport.set(0, 0, size, size);
    target.scissor.set(0, 0, size, size);
    const renderer = this.quad.renderer;
    this.quad.mesh.material = material;
    renderer.setRenderTarget(target, layer, level);
    renderer.render(this.quad.scene, this.quad.camera);
  }

  _renderSky() {
    this._draw(this.skyMaterial, this.target, 0, 0, this.size);
  }

  /** Computes one mip with `material` and stores it at (layer, level) of `target`. */
  _drawMip(material, target, layer, level, size) {
    const scratch = this.scratch.get(size);
    this._draw(material, scratch, 0, 0, size);
    this.copyMaterial.uniforms.source.value = scratch.texture;
    this._draw(this.copyMaterial, target, layer, level, size);
  }

  /** Layer 0 → the filter's source and its mips. */
  _downsampleBase() {
    const u = this.downsampleMaterial.uniforms;
    for (let level = 0; level < this.mipmaps - 1; level++) {
      const size = (this.size >> 1) >> level;
      u.size.value = size;
      if (level === 0) {
        u.from_array.value = 1;
        u.source_array.value = this.target.texture;
        u.source_octmap.value = null;
        u.source_layer.value = 0;
        u.source_lod.value = 0;
        this._draw(this.downsampleMaterial, this.downsampled, 0, 0, size);
      } else {
        u.from_array.value = 0;
        u.source_array.value = null;
        u.source_octmap.value = this.downsampled.texture;
        u.source_lod.value = level - 1;
        this._drawMip(this.downsampleMaterial, this.downsampled, 0, level, size);
      }
    }
  }

  _filterLayer(layer) {
    if (layer === 1) this._downsampleBase();
    const { roughness, total } = samplesForLayer(layer);
    const u = this.roughnessMaterial.uniforms;
    u.roughness.value = roughness;
    u.total_samples.value = total;
    this._draw(this.roughnessMaterial, this.target, layer, 0, this.size);
  }

  /** The mip chains of layers [from, to). */
  _updateMipmaps(from, to) {
    const u = this.downsampleMaterial.uniforms;
    u.from_array.value = 1;
    u.source_array.value = this.target.texture;
    u.source_octmap.value = null;
    for (let layer = from; layer < to; layer++) {
      for (let level = 1; level < this.mipmaps; level++) {
        const size = this.size >> level;
        u.source_layer.value = layer;
        u.source_lod.value = level - 1;
        u.size.value = size;
        this._drawMip(this.downsampleMaterial, this.target, layer, level, size);
      }
    }
  }

  /**
   * SkyRD::update_radiance_buffers for SKY_MODE_INCREMENTAL, once per frame. O(layers) on the frame
   * that builds everything, O(1) on the others.
   */
  update() {
    const firstBuild = this.processingLayer === 0;
    if (this.dirty && (this.processingLayer >= this.layers || firstBuild)) {
      this._renderSky();
      if (firstBuild) {
        for (let layer = 1; layer < this.layers; layer++) this._filterLayer(layer);
        this._updateMipmaps(0, this.layers);
      } else {
        this._updateMipmaps(0, 1);
      }
      // The counter restarts at 1 after the single-frame build too: the engine filters the rough
      // layers once more, one per frame, from the same sky.
      this.processingLayer = 1;
      this.dirty = false;
    } else if (this.processingLayer < this.layers) {
      this._filterLayer(this.processingLayer);
      this._updateMipmaps(this.processingLayer, this.processingLayer + 1);
      this.processingLayer += 1;
    }
  }

  dispose() {
    this.target.dispose();
    this.downsampled.dispose();
    for (const scratch of this.scratch.values()) scratch.dispose();
    this.copyMaterial.dispose();
    this.skyMaterial.dispose();
    this.downsampleMaterial.dispose();
    this.roughnessMaterial.dispose();
  }
}

export class SkyRenderer {
  /** @param {import('./pipeline.js').RenderPipeline} pipeline */
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.uniforms = skyUniforms();
    const background = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BACKGROUND_VERTEX,
      fragmentShader: BACKGROUND_FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.background = new THREE.Mesh(triangle, background);
    this.background.frustumCulled = false;
    this.background.renderOrder = -1e9;
    pipeline.scene.add(this.background);

    const { top_color, horizon_color, bottom_color, glow_color, glow_dir } = this.uniforms;
    this.radiance = new RadianceOctmap(pipeline.quad, { top_color, horizon_color, bottom_color, glow_color, glow_dir });
    this._version = -1;
    pipeline.sky = this;
    sharedUniforms.uRadiance.value = this.radiance.target.texture;
    sharedUniforms.uRadianceParams.value.set(1 / RADIANCE_SIZE, UV_BORDER, 1 - UV_BORDER * 2, ROUGHNESS_LAYERS - 1);
  }

  /**
   * Once per frame, before the scene is drawn (the pipeline calls it).
   * @param {object|null} sky the environment's sky parameters (Godot colours, sRGB)
   */
  update(sky) {
    if (sky && sky.version !== this._version) {
      this._version = sky.version;
      const lin = (color, out) => {
        const c = color.srgb_to_linear();
        out.set(c.r, c.g, c.b);
      };
      lin(sky.top_color, this.uniforms.top_color.value);
      lin(sky.horizon_color, this.uniforms.horizon_color.value);
      lin(sky.bottom_color, this.uniforms.bottom_color.value);
      lin(sky.glow_color, this.uniforms.glow_color.value);
      this.uniforms.glow_dir.value.set(sky.glow_dir.x, sky.glow_dir.y, sky.glow_dir.z);
      this.radiance.dirty = true;
    }
    this.radiance.update();
  }
}
