/**
 * Glow — Godot 4.7's Forward+ glow (CopyEffects::gaussian_glow, shaders/effects/copy.glsl with
 * MODE_GAUSSIAN_BLUR + MODE_GLOW), level by level:
 *
 *   level 0   from the scene colour:   half resolution
 *   level i   from level i − 1:        half of the previous level
 *
 * Each level is a 2× bilinear downsample followed by a separable 9-tap Gaussian at the level's own
 * resolution. The first level also weights its samples against fireflies before blurring (and undoes
 * it after), multiplies by the exposure and keeps only what passes the HDR threshold (or the bloom
 * floor), capped at the luminance cap. Every level is multiplied by the glow strength.
 *
 * The engine blurs inside 8×8 compute groups that cache a 16×16 window of samples fetched in pairs;
 * at the borders a pair that falls outside is replaced by the nearest pair inside — `remap()` below
 * is that rule, so border pixels match too. Three passes per level, O(pixels of the level).
 */
import * as THREE from 'three';
import { fullscreenMaterial, hdrTarget } from './fullscreen.js';

/** RenderingServer's MAX_GLOW_LEVELS. */
export const MAX_GLOW_LEVELS = 7;
/** A level takes part when its weight is above this (renderer_scene_render_rd.cpp). */
const LEVEL_THRESHOLD = 0.01;
/** Smallest level worth allocating: the pair remap needs two texels per axis. */
const MIN_LEVEL_SIZE = 2;

const COMMON = /* glsl */ `
uniform ivec2 level_size;
// The scene buffers keep the engine's rows (pipeline.js): pixel indices here are the engine's.
// The compute shader fetches samples in pairs (2k, 2k + 1); a pair outside the image is replaced by
// the nearest pair inside.
ivec2 remap(ivec2 p) {
	ivec2 base = p & ivec2(-2);
	ivec2 clamped = clamp(base, ivec2(0), level_size - 2);
	return clamped + (p - base);
}
const float kernel[5] = float[5](0.2024, 0.1790, 0.1240, 0.0672, 0.0285);
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
`;

const DOWNSAMPLE = /* glsl */ `
uniform sampler2D source_color;
uniform int first_pass;
uniform float glow_luminance_cap;
layout(location = 0) out vec4 out_color;
${COMMON}
void main() {
	vec4 color = textureLod(source_color, (floor(gl_FragCoord.xy) + 0.5) / vec2(level_size), 0.0);
	if (first_pass == 1) {
		// Tonemap the samples to reduce the weight of fireflies.
		color /= 1.0 + dot(color.rgb, LUMA / max(glow_luminance_cap, 6.0));
	}
	out_color = color;
}`;

const HORIZONTAL = /* glsl */ `
uniform sampler2D source_color;
layout(location = 0) out vec4 out_color;
${COMMON}
vec4 fetch(ivec2 pos) { return texelFetch(source_color, remap(pos), 0); }
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	vec4 color = fetch(pos) * kernel[0];
	for (int i = 1; i <= 4; i++) {
		color += fetch(pos + ivec2(i, 0)) * kernel[i];
		color += fetch(pos - ivec2(i, 0)) * kernel[i];
	}
	out_color = color;
}`;

const VERTICAL = /* glsl */ `
uniform sampler2D source_color;
uniform int first_pass;
uniform float glow_strength;
uniform float glow_exposure;
uniform float glow_bloom;
uniform float glow_hdr_threshold;
uniform float glow_hdr_scale;
uniform float glow_luminance_cap;
layout(location = 0) out vec4 out_color;
${COMMON}
// Rows only: the horizontal pass already resolved the columns.
vec4 fetch(ivec2 pos) { return texelFetch(source_color, ivec2(pos.x, remap(pos).y), 0); }
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	vec4 color = fetch(pos) * kernel[0];
	for (int i = 1; i <= 4; i++) {
		color += fetch(pos + ivec2(0, i)) * kernel[i];
		color += fetch(pos - ivec2(0, i)) * kernel[i];
	}
	if (first_pass == 1) {
		// Undo the firefly weighting to restore the range.
		color /= 1.0 - dot(color.rgb, LUMA / max(glow_luminance_cap, 6.0));
	}
	color *= glow_strength;
	if (first_pass == 1) {
		color *= glow_exposure;
		float luminance = max(color.r, max(color.g, color.b));
		float t = clamp((luminance - glow_hdr_threshold) / glow_hdr_scale, 0.0, 1.0);
		float feedback = max(t * t * (3.0 - 2.0 * t), glow_bloom);
		color = min(color * feedback, vec4(glow_luminance_cap));
	}
	out_color = color;
}`;

export class Glow {
  /** @param {import('./fullscreen.js').FullscreenQuad} quad */
  constructor(quad) {
    this.quad = quad;
    this.levels = [];
    this.width = 0;
    this.height = 0;
    const size = () => ({ value: new THREE.Vector2(1, 1) });
    this.downsample = fullscreenMaterial(DOWNSAMPLE, { source_color: { value: null }, level_size: size(), first_pass: { value: 0 }, glow_luminance_cap: { value: 12 } });
    this.horizontal = fullscreenMaterial(HORIZONTAL, { source_color: { value: null }, level_size: size() });
    this.vertical = fullscreenMaterial(VERTICAL, {
      source_color: { value: null },
      level_size: size(),
      first_pass: { value: 0 },
      glow_strength: { value: 1 },
      glow_exposure: { value: 1 },
      glow_bloom: { value: 0 },
      glow_hdr_threshold: { value: 1 },
      glow_hdr_scale: { value: 2 },
      glow_luminance_cap: { value: 12 },
    });
  }

  /** Size of the first level (the engine's blur texture, half the internal size). */
  get textureSize() {
    return { x: this.width >> 1, y: this.height >> 1 };
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    for (let i = 0; i < MAX_GLOW_LEVELS; i++) {
      const w = (width >> 1) >> i;
      const h = (height >> 1) >> i;
      if (w < MIN_LEVEL_SIZE || h < MIN_LEVEL_SIZE) break;
      this.levels.push({
        width: w,
        height: h,
        down: hdrTarget(w, h, THREE.NearestFilter),
        blurred: hdrTarget(w, h, THREE.NearestFilter),
        result: hdrTarget(w, h, THREE.LinearFilter),
      });
    }
  }

  dispose() {
    for (const level of this.levels) {
      level.down.dispose();
      level.blurred.dispose();
      level.result.dispose();
    }
    this.levels = [];
  }

  /** Index of the last level the environment uses (−1: none), limited to the levels that exist. */
  lastLevel(environment) {
    let last = -1;
    environment.glow_levels.forEach((weight, i) => {
      if (weight > LEVEL_THRESHOLD) last = i;
    });
    return Math.min(last, this.levels.length - 1);
  }

  /**
   * Computes the levels from the scene colour (a linear-filtered HDR texture of the full size).
   * Returns the index of the last level computed.
   */
  render(sceneColor, environment) {
    const last = this.lastLevel(environment);
    let source = sceneColor;
    for (let i = 0; i <= last; i++) {
      const level = this.levels[i];
      const first = i === 0 ? 1 : 0;
      for (const material of [this.downsample, this.horizontal, this.vertical]) material.uniforms.level_size.value.set(level.width, level.height);

      const down = this.downsample.uniforms;
      down.source_color.value = source;
      down.first_pass.value = first;
      down.glow_luminance_cap.value = environment.glow_hdr_luminance_cap;
      this.quad.draw(this.downsample, level.down);

      this.horizontal.uniforms.source_color.value = level.down.texture;
      this.quad.draw(this.horizontal, level.blurred);

      const v = this.vertical.uniforms;
      v.source_color.value = level.blurred.texture;
      v.first_pass.value = first;
      v.glow_strength.value = environment.glow_strength;
      v.glow_exposure.value = environment.tonemap_exposure;
      v.glow_bloom.value = environment.glow_bloom;
      v.glow_hdr_threshold.value = environment.glow_hdr_threshold;
      v.glow_hdr_scale.value = environment.glow_hdr_scale;
      v.glow_luminance_cap.value = environment.glow_hdr_luminance_cap;
      this.quad.draw(this.vertical, level.result);

      source = level.result.texture;
    }
    return last;
  }
}
