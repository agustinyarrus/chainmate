/**
 * Tonemapper — port of Godot 4.7's shaders/effects/tonemap.glsl (Forward+ path) with the settings
 * the project ships: no auto exposure, no FXAA, no colour correction texture, no debanding,
 * SDR output (output_max_value = 1), bicubic glow upscale (rendering/environment/glow/upscale_mode).
 *
 *   colour × exposure → glow before the curve (add, screen, replace, mix) → tone curve
 *   → soft-light glow AFTER the curve, on linear values → brightness → sRGB → contrast → saturation
 *
 * Glow levels are separate textures here (the engine samples the mips of one texture); each level is
 * read through the engine's bicubic B-spline filter built from four linear taps.
 */
import * as THREE from 'three';
import { fullscreenMaterial } from './fullscreen.js';
import { MAX_GLOW_LEVELS } from './glow.js';

export const TONE_MAPPER = Object.freeze({ linear: 0, reinhard: 1, filmic: 2, aces: 3, agx: 4 });
export const GLOW_BLEND_MODE = Object.freeze({ additive: 0, screen: 1, softlight: 2, replace: 3, mix: 4 });
/** SDR: the tone curves map their white to 1. */
const OUTPUT_MAX_VALUE = 1.0;
/** A glow level is sampled when its weight is above this (tonemap.glsl gather_glow). */
const GATHER_THRESHOLD = 0.0001;

const levelSamplers = Array.from({ length: MAX_GLOW_LEVELS }, (_, i) => `uniform sampler2D glow${i};`).join('\n');
const levelGather = Array.from({ length: MAX_GLOW_LEVELS }, (_, i) => `	if (glow_levels[${i}] > ${GATHER_THRESHOLD}) glow += bicubic(glow${i}, uv, ${i}).rgb * glow_levels[${i}];`).join('\n');

const TONEMAP = /* glsl */ `
uniform sampler2D source_color;
${levelSamplers}
uniform float glow_levels[${MAX_GLOW_LEVELS}];
uniform ivec2 glow_texture_size;
uniform float glow_intensity;
uniform int glow_mode;
uniform int use_glow;
uniform float exposure;
uniform float white;
uniform int tonemapper;
uniform vec4 tonemapper_params;
uniform vec3 bcs;
uniform int use_bcs;
layout(location = 0) out vec4 frag_color;

const float output_max_value = ${OUTPUT_MAX_VALUE.toFixed(1)};

vec3 tonemap_reinhard(vec3 color) {
	float white_squared = tonemapper_params.x;
	return color * (1.0 + color / white_squared) / (1.0 + color / output_max_value);
}

vec3 tonemap_filmic(vec3 color) {
	const float exposure_bias = 2.0;
	const float A = 0.22 * exposure_bias * exposure_bias;
	const float B = 0.30 * exposure_bias;
	const float C = 0.10;
	const float D = 0.20;
	const float E = 0.01;
	const float F = 0.30;
	vec3 color_tonemapped = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
	return color_tonemapped / tonemapper_params.x;
}

vec3 tonemap_aces(vec3 color) {
	const float exposure_bias = 1.8;
	const float A = 0.0245786;
	const float B = 0.000090537;
	const float C = 0.983729;
	const float D = 0.432951;
	const float E = 0.238081;
	const mat3 rgb_to_rrt = mat3(
			vec3(0.59719 * exposure_bias, 0.35458 * exposure_bias, 0.04823 * exposure_bias),
			vec3(0.07600 * exposure_bias, 0.90834 * exposure_bias, 0.01566 * exposure_bias),
			vec3(0.02840 * exposure_bias, 0.13383 * exposure_bias, 0.83777 * exposure_bias));
	const mat3 odt_to_rgb = mat3(
			vec3(1.60475, -0.53108, -0.07367),
			vec3(-0.10208, 1.10813, -0.00605),
			vec3(-0.00327, -0.07276, 1.07602));
	color *= rgb_to_rrt;
	vec3 color_tonemapped = (color * (color + A) - B) / (color * (C * color + D) + E);
	color_tonemapped *= odt_to_rgb;
	return color_tonemapped / tonemapper_params.x;
}

vec3 allenwp_curve(vec3 x) {
	const float awp_crossover_point = 0.18;
	float awp_shoulder_max = output_max_value - awp_crossover_point;
	float awp_contrast = tonemapper_params.x;
	float awp_toe_a = tonemapper_params.y;
	float awp_slope = tonemapper_params.z;
	float awp_w = tonemapper_params.w;
	vec3 s = x - awp_crossover_point;
	vec3 slope_s = awp_slope * s;
	s = slope_s * (1.0 + s / awp_w) / (1.0 + (slope_s / awp_shoulder_max));
	s += awp_crossover_point;
	vec3 t = pow(x, vec3(awp_contrast));
	t = t / (t + awp_toe_a);
	return mix(s, t, lessThan(x, vec3(awp_crossover_point)));
}

vec3 tonemap_agx(vec3 color) {
	const mat3 rec709_to_rec2020_agx_inset_matrix = mat3(
			0.544814746488245, 0.140416948464053, 0.0888104196149096,
			0.373787398372697, 0.754137554567394, 0.178871756420858,
			0.0813978551390581, 0.105445496968552, 0.732317823964232);
	const mat3 agx_outset_rec2020_to_rec709_matrix = mat3(
			1.96488741169489, -0.299313364904742, -0.164352742528393,
			-0.855988495690215, 1.32639796461980, -0.238183969428088,
			-0.108898916004672, -0.0270845997150571, 1.40253671195648);
	color = rec709_to_rec2020_agx_inset_matrix * color;
	color = allenwp_curve(color);
	color = min(vec3(output_max_value), color);
	color = agx_outset_rec2020_to_rec709_matrix * color;
	return color;
}

vec3 linear_to_srgb(vec3 color) {
	const vec3 a = vec3(0.055);
	return mix((vec3(1.0) + a) * pow(color.rgb, vec3(1.0 / 2.4)) - a, 12.92 * color.rgb, lessThan(color.rgb, vec3(0.0031308)));
}

vec3 apply_tonemapping(vec3 color) {
	if (tonemapper == ${TONE_MAPPER.linear}) return color;
	// Negative lights can leave negative colours: the curves need positive input.
	color = max(vec3(0.0), color);
	if (tonemapper == ${TONE_MAPPER.reinhard}) return tonemap_reinhard(color);
	if (tonemapper == ${TONE_MAPPER.filmic}) return tonemap_filmic(color);
	if (tonemapper == ${TONE_MAPPER.aces}) return tonemap_aces(color);
	return tonemap_agx(color);
}

// w0..w3: the four cubic B-spline basis functions; g: amplitudes; h: offsets.
float w0(float a) { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
float w1(float a) { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
float w2(float a) { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
float w3(float a) { return (1.0 / 6.0) * (a * a * a); }
float g0(float a) { return w0(a) + w1(a); }
float g1(float a) { return w2(a) + w3(a); }
float h0(float a) { return -1.0 + w1(a) / (w0(a) + w1(a)); }
float h1(float a) { return 1.0 + w3(a) / (w2(a) + w3(a)); }

vec4 bicubic(sampler2D tex, vec2 uv, int lod) {
	vec2 tex_size = vec2(glow_texture_size >> lod);
	vec2 pixel_size = vec2(1.0) / tex_size;
	uv = uv * tex_size + vec2(0.5);
	vec2 iuv = floor(uv);
	vec2 fuv = fract(uv);
	float g0x = g0(fuv.x);
	float g1x = g1(fuv.x);
	float h0x = h0(fuv.x);
	float h1x = h1(fuv.x);
	float h0y = h0(fuv.y);
	float h1y = h1(fuv.y);
	vec2 p0 = (vec2(iuv.x + h0x, iuv.y + h0y) - vec2(0.5)) * pixel_size;
	vec2 p1 = (vec2(iuv.x + h1x, iuv.y + h0y) - vec2(0.5)) * pixel_size;
	vec2 p2 = (vec2(iuv.x + h0x, iuv.y + h1y) - vec2(0.5)) * pixel_size;
	vec2 p3 = (vec2(iuv.x + h1x, iuv.y + h1y) - vec2(0.5)) * pixel_size;
	return (g0(fuv.y) * (g0x * textureLod(tex, p0, 0.0) + g1x * textureLod(tex, p1, 0.0))) +
			(g1(fuv.y) * (g0x * textureLod(tex, p2, 0.0) + g1x * textureLod(tex, p3, 0.0)));
}

vec3 gather_glow(vec2 uv) {
	vec3 glow = vec3(0.0);
${levelGather}
	return glow;
}

// Every blend mode but mix.
vec3 apply_glow(vec3 color, vec3 glow) {
	if (glow_mode == ${GLOW_BLEND_MODE.additive}) return color + glow;
	if (glow_mode == ${GLOW_BLEND_MODE.screen}) {
		glow = clamp(glow, 0.0, white);
		return color + glow - (color * glow / white);
	}
	if (glow_mode == ${GLOW_BLEND_MODE.softlight}) {
		glow = clamp(glow, 0.0, 1.0);
		color.r = color.r > 1.0 ? color.r : color.r + glow.r * ((color.r <= 0.25 ? ((16.0 * color.r - 12.0) * color.r + 4.0) * color.r : sqrt(color.r)) - color.r);
		color.g = color.g > 1.0 ? color.g : color.g + glow.g * ((color.g <= 0.25 ? ((16.0 * color.g - 12.0) * color.g + 4.0) * color.g : sqrt(color.g)) - color.g);
		color.b = color.b > 1.0 ? color.b : color.b + glow.b * ((color.b <= 0.25 ? ((16.0 * color.b - 12.0) * color.b + 4.0) * color.b : sqrt(color.b)) - color.b);
		return color;
	}
	return glow;
}

void main() {
	// The scene buffers and the screen buffer both keep the engine's rows (first row at the top).
	vec2 uv = vUv;
	vec4 color = textureLod(source_color, uv, 0.0);
	color.rgb *= exposure;

	if (use_glow == 1 && glow_mode != ${GLOW_BLEND_MODE.softlight}) {
		vec3 glow = gather_glow(uv) * glow_intensity;
		if (glow_mode == ${GLOW_BLEND_MODE.mix}) color.rgb = color.rgb * (1.0 - glow_intensity) + glow;
		else color.rgb = apply_glow(color.rgb, glow);
	}

	color.rgb = apply_tonemapping(color.rgb);

	if (use_glow == 1 && glow_mode == ${GLOW_BLEND_MODE.softlight}) {
		// Soft light after the curve: no discontinuity at 1.0 in SDR.
		vec3 glow = gather_glow(uv) * glow_intensity;
		glow = apply_tonemapping(glow);
		color.rgb = apply_glow(color.rgb, glow);
	}

	if (use_bcs == 1) {
		color.rgb = color.rgb * bcs.x;
		color.rgb = linear_to_srgb(color.rgb);
		color.rgb = mix(vec3(0.5), color.rgb, bcs.y);
		color.rgb = mix(vec3(dot(vec3(1.0), color.rgb) * (1.0 / 3.0)), color.rgb, bcs.z);
	} else {
		color.rgb = linear_to_srgb(color.rgb);
	}
	frag_color = vec4(color.rgb, 1.0);
}`;

/** The filmic curve at `white` (RendererEnvironmentStorage::environment_get_tonemap_parameters). */
function filmicWhite(white) {
  const exposureBias = 2.0;
  const A = 0.22 * exposureBias * exposureBias;
  const B = 0.3 * exposureBias;
  const C = 0.1;
  const D = 0.2;
  const E = 0.01;
  const F = 0.3;
  return (white * (A * white + C * B) + D * E) / (white * (A * white + B) + D * F) - E / F;
}

function acesWhite(white) {
  const exposureBias = 1.8;
  const A = 0.0245786;
  const B = 0.000090537;
  const C = 0.983729;
  const D = 0.432951;
  const E = 0.238081;
  const w = white * exposureBias;
  return (w * (w + A) - B) / (w * (C * w + D) + E);
}

/** White of each curve (environment_get_white) and its shader parameters, for SDR output. */
export function tonemapParameters(environment) {
  const mode = TONE_MAPPER[environment.tonemap_mode];
  if (mode === undefined) throw new Error(`unknown tone mapper "${environment.tonemap_mode}"`);
  if (mode === TONE_MAPPER.linear) return { mode, white: OUTPUT_MAX_VALUE, params: [0, 0, 0, 0] };
  if (mode === TONE_MAPPER.reinhard) {
    const white = Math.max(OUTPUT_MAX_VALUE, environment.tonemap_white);
    return { mode, white, params: [(white * white) / OUTPUT_MAX_VALUE, 0, 0, 0] };
  }
  if (mode === TONE_MAPPER.filmic || mode === TONE_MAPPER.aces) {
    const white = Math.max(1.0, environment.tonemap_white);
    return { mode, white, params: [mode === TONE_MAPPER.filmic ? filmicWhite(white) : acesWhite(white), 0, 0, 0] };
  }
  throw new Error('the AgX tone mapper is not used by the game and its parameters are not ported');
}

export class Tonemapper {
  /** @param {import('./fullscreen.js').FullscreenQuad} quad */
  constructor(quad) {
    this.quad = quad;
    const uniforms = {
      source_color: { value: null },
      glow_levels: { value: new Array(MAX_GLOW_LEVELS).fill(0) },
      glow_texture_size: { value: new THREE.Vector2(1, 1) },
      glow_intensity: { value: 0.3 },
      glow_mode: { value: GLOW_BLEND_MODE.screen },
      use_glow: { value: 0 },
      exposure: { value: 1 },
      white: { value: 1 },
      tonemapper: { value: TONE_MAPPER.linear },
      tonemapper_params: { value: new THREE.Vector4() },
      bcs: { value: new THREE.Vector3(1, 1, 1) },
      use_bcs: { value: 0 },
    };
    for (let i = 0; i < MAX_GLOW_LEVELS; i++) uniforms[`glow${i}`] = { value: null };
    this.material = fullscreenMaterial(TONEMAP, uniforms);
  }

  /**
   * @param {THREE.Texture} color the scene's HDR colour
   * @param {import('./glow.js').Glow|null} glow computed levels, or null when glow is off
   * @param {number} lastLevel index of the last computed glow level
   */
  render(color, glow, lastLevel, environment, target = null) {
    const u = this.material.uniforms;
    const { mode, white, params } = tonemapParameters(environment);
    u.source_color.value = color;
    u.tonemapper.value = mode;
    u.white.value = white;
    u.tonemapper_params.value.set(...params);
    u.exposure.value = environment.tonemap_exposure;
    const useGlow = glow !== null && lastLevel >= 0;
    u.use_glow.value = useGlow ? 1 : 0;
    if (useGlow) {
      const blend = GLOW_BLEND_MODE[environment.glow_blend_mode];
      if (blend === undefined) throw new Error(`unknown glow blend mode "${environment.glow_blend_mode}"`);
      u.glow_mode.value = blend;
      u.glow_intensity.value = blend === GLOW_BLEND_MODE.mix ? environment.glow_mix : environment.glow_intensity;
      const size = glow.textureSize;
      u.glow_texture_size.value.set(size.x, size.y);
      for (let i = 0; i < MAX_GLOW_LEVELS; i++) {
        const available = i <= lastLevel;
        u.glow_levels.value[i] = available ? environment.glow_levels[i] : 0;
        u[`glow${i}`].value = available ? glow.levels[i].result.texture : null;
      }
    }
    u.use_bcs.value = environment.adjustment_enabled ? 1 : 0;
    u.bcs.value.set(environment.adjustment_brightness, environment.adjustment_contrast, environment.adjustment_saturation);
    this.quad.draw(this.material, target);
  }
}
