/**
 * SpatialMaterial — Godot 4.7 spatial shaders on top of THREE.ShaderMaterial.
 *
 * A material is described like a .gdshader: render_mode flags, typed uniforms (with `source`, i.e.
 * Godot's `source_color`: converted sRGB → linear on the CPU exactly like the engine), varyings,
 * helper functions, and the bodies of `vertex()` / `fragment()` written against Godot's built-ins
 * (VERTEX, NORMAL, UV, UV2, COLOR, MODEL_MATRIX, VIEW, TIME, ALBEDO, ROUGHNESS, METALLIC, SPECULAR,
 * EMISSION, BACKLIGHT, ALPHA, RIM…).
 *
 * The template is the Forward+ scene shader (shaders/forward_clustered/scene_forward_clustered.glsl
 * and scene_forward_lights_inc.glsl), in the engine's order:
 *
 *   fog (premultiplied, with the volumetric fog in front) → roughness limiter → sky radiance and
 *   ambient → SSAO → specular occlusion → SSIL → split-sum DFG with multiscattering compensation →
 *   directional lights (4 PSSM splits, rotated-disk PCF) → omni lights → composition → fog
 *
 * Each material compiles up to three programs, one per pass:
 *
 *   COLOR    the lit colour (opaque materials also read the screen-space buffers)
 *   COLOR_SEPARATE   the same, for the opaque pass of a frame with subsurface scattering: diffuse
 *            light (strength in alpha) and specular light (depth in alpha) apart (subsurface.js)
 *   PREPASS  depth + normal/roughness, what SSAO and SSIL are computed from (opaque materials);
 *            it stands for the engine's resolved MSAA prepass (see varyingsAtPixelCentre)
 *   SHADOW   depth from the light, with pancaking (shadow casters)
 *
 * The screen passes (COLOR, PREPASS) are drawn with the projection mirrored in Y, so the frame
 * buffer's rows are the engine's (first row at the top): gl_FragCoord, dFdy, the MSAA sample
 * pattern and every screen-space buffer then mean what they mean in the engine, and the ported
 * shaders read as written. Mirroring reverses the winding, hence the swapped sides below.
 */
import * as THREE from 'three';
import { Color, Vector2, Vector3 } from '../math.js';
import { sharedUniforms, MAX_OMNI, MAX_DIRECTIONAL, SHADOW_CASCADES, DIRECTIONAL_SOFT_SHADOW_SAMPLES, SceneFlags, ScreenSpaceEffects, RenderSettings } from './lighting.js';
import { VOLUME_ATLAS_GLSL } from './glsl.js';

export const Pass = Object.freeze({ COLOR: 'color', COLOR_SEPARATE: 'color_separate', PREPASS: 'prepass', SHADOW: 'shadow' });

/**
 * Layers (THREE.Layers bits) a mesh is drawn in: the opaque colour pass, the prepass, one per shadow
 * cascade, the transparent colour pass.
 */
export const PassLayer = Object.freeze({ COLOR: 0, PREPASS: 1, SHADOW_CASCADE_0: 2, TRANSPARENT: 2 + SHADOW_CASCADES });

const GLSL_COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * Whether a fragment() body assigns a built-in, the way the engine's shader compiler raises its usage
 * flags (SSS_STRENGTH → uses_sss). Comments do not count; a comparison is not an assignment.
 */
export function writesBuiltin(code, name) {
  return new RegExp(`\\b${name}\\s*(?:\\.\\w+\\s*)?[-+*/]?=(?!=)`).test((code ?? '').replace(GLSL_COMMENTS, ' '));
}

/**
 * `smoothstep` with reversed edges (e0 > e1) is undefined in GLSL ES; Godot's shaders use it everywhere
 * and desktop drivers evaluate the formula literally. `gd_smoothstep` IS that formula, so ported code
 * behaves the same on every GPU (Mali included). Ported bodies get `smoothstep(` rewritten to it.
 */
export const SMOOTHSTEP_GLSL = /* glsl */ `
float gd_smoothstep(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec2 gd_smoothstep(vec2 e0, vec2 e1, vec2 x) { vec2 t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 gd_smoothstep(vec3 e0, vec3 e1, vec3 x) { vec3 t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 gd_smoothstep(vec4 e0, vec4 e1, vec4 x) { vec4 t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec2 gd_smoothstep(float e0, float e1, vec2 x) { return gd_smoothstep(vec2(e0), vec2(e1), x); }
vec3 gd_smoothstep(float e0, float e1, vec3 x) { return gd_smoothstep(vec3(e0), vec3(e1), x); }
vec4 gd_smoothstep(float e0, float e1, vec4 x) { return gd_smoothstep(vec4(e0), vec4(e1), x); }
`;

/** Rewrites Godot-shader text for this template (reversed-edge-safe smoothstep). */
export const portGlsl = (code) => (code ?? '').replace(/\bsmoothstep\s*\(/g, 'gd_smoothstep(');

/** shaders/oct_inc.glsl — octahedral mapping of directions (the radiance maps). */
export const OCT_GLSL = /* glsl */ `
vec3 oct_to_vec3(vec2 e) {
	vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
	float t = max(-v.z, 0.0);
	v.xy += t * -sign(v.xy);
	return normalize(v);
}
// border_size: 1.0 - padding_in_uv_space * 2.0.
vec3 oct_to_vec3_with_border(vec2 uv, float border_size) {
	uv = (uv - 0.5) * (2.0 / border_size);
	vec2 mask = step(vec2(1.0), abs(uv));
	uv = 2.0 * clamp(uv, -1.0, 1.0) - uv;
	uv = mix(uv, -uv, mask.yx);
	return oct_to_vec3(uv);
}
vec2 oct_wrap(vec2 v) {
	vec2 signVal;
	signVal.x = v.x >= 0.0 ? 1.0 : -1.0;
	signVal.y = v.y >= 0.0 ? 1.0 : -1.0;
	return (1.0 - abs(v.yx)) * signVal;
}
vec2 vec3_to_oct(vec3 n) {
	n /= (abs(n.x) + abs(n.y) + abs(n.z));
	n.xy = (n.z >= 0.0) ? n.xy : oct_wrap(n.xy);
	n.xy = n.xy * 0.5 + 0.5;
	return n.xy;
}
// border_size.x: padding in uv space, border_size.y: 1.0 - padding * 2.0
vec2 vec3_to_oct_with_border(vec3 n, vec2 border_size) {
	vec2 uv = vec3_to_oct(n);
	return uv * border_size.y + border_size.x;
}
float vec3_to_oct_lod(vec3 n_ddx, vec3 n_ddy, float pixel_size) {
	float pixel_size_sqr = 4.0 * pixel_size * pixel_size;
	float ddx = dot(n_ddx, n_ddx) / pixel_size_sqr;
	float ddy = dot(n_ddy, n_ddy) / pixel_size_sqr;
	float dd_sqr = max(ddx, ddy);
	return 0.25 * log2(dd_sqr + 1e-6);
}
`;

const SHARED_UNIFORMS_GLSL = /* glsl */ `
uniform float TIME;
uniform vec2 uViewport;
uniform vec2 uScreenPixelSize;
uniform mat4 uInvView;
uniform vec4 uAmbient;
uniform float uAmbientSkyMix;
uniform int uSceneFlags;
uniform vec2 uRoughnessLimiter;
uniform vec2 uZRange;
uniform vec3 uFogColor;
uniform vec4 uFogParams;
uniform int uDirCount;
uniform vec3 uDirDirection[${MAX_DIRECTIONAL}];
uniform vec4 uDirColor[${MAX_DIRECTIONAL}];
uniform vec4 uDirParams[${MAX_DIRECTIONAL}];
uniform highp sampler2DShadow uDirShadowAtlas;
uniform mat4 uDirShadowMatrix[${SHADOW_CASCADES}];
uniform vec4 uDirShadowBias;
uniform vec4 uDirShadowNormalBias;
uniform vec4 uDirShadowSplits;
uniform vec4 uDirShadowParams;
uniform vec2 uDirShadowPixelSize;
uniform vec2 uDirShadowKernel[${DIRECTIONAL_SOFT_SHADOW_SAMPLES}];
uniform int uOmniCount;
uniform vec4 uOmniPosition[${MAX_OMNI}];
uniform vec4 uOmniColor[${MAX_OMNI}];
uniform vec2 uOmniParams[${MAX_OMNI}];
uniform highp sampler2DArray uRadiance;
uniform vec4 uRadianceParams;
uniform sampler2D uDfg;
uniform sampler2D uAoBuffer;
uniform sampler2D uSsilBuffer;
uniform vec3 uSsEffects;
uniform highp sampler2D uVolumetricFog;
uniform vec3 uVolumetricFogSize;
uniform vec3 uVolumetricFogParams;
uniform sampler2D uBestFitNormal;
uniform vec2 uPrepassShift;
`;

/** Names of the shared uniforms each program links against (kept in one place for the variants). */
const LOCAL_SHARED = {
  /** Best-fit normal scale (CryEngine 3), for the 8-bit normal buffer. */
  uBestFitNormal: { value: null },
  /** How far the prepass image is moved, in pixels, to look through one MSAA sample (see below). */
  uPrepassShift: { value: new THREE.Vector2() },
};
Object.assign(sharedUniforms, LOCAL_SHARED);

const LIGHTING_GLSL = /* glsl */ `
#define M_PI 3.14159265359
#define SCENE_USE_AMBIENT_LIGHT ${SceneFlags.USE_AMBIENT_LIGHT}
#define SCENE_USE_AMBIENT_CUBEMAP ${SceneFlags.USE_AMBIENT_CUBEMAP}
#define SCENE_USE_REFLECTION_CUBEMAP ${SceneFlags.USE_REFLECTION_CUBEMAP}
#define SCENE_USE_ROUGHNESS_LIMITER ${SceneFlags.USE_ROUGHNESS_LIMITER}
#define SCENE_USE_FOG ${SceneFlags.USE_FOG}
#define SS_EFFECTS_USE_SSAO ${ScreenSpaceEffects.USE_SSAO}
#define SS_EFFECTS_USE_SSIL ${ScreenSpaceEffects.USE_SSIL}
#define HALF_FLT_MIN 1.175494351e-38

float D_GGX(float NoH, float roughness) {
	float a = NoH * roughness;
	float k = roughness / (1.0 - NoH * NoH + a * a);
	return k * k * (1.0 / M_PI);
}
// Earl Hammon, Jr. "PBR Diffuse Lighting for GGX+Smith Microsurfaces"
float V_GGX(float NdotL, float NdotV, float alpha) {
	return 0.5 / mix(2.0 * NdotL * NdotV, NdotL + NdotV, alpha);
}
float SchlickFresnel(float u) {
	float m = 1.0 - u;
	float m2 = m * m;
	return m2 * m2 * m;
}
vec3 F0(float metallic, float specular, vec3 albedo) {
	float dielectric = 0.16 * specular * specular;
	return mix(vec3(dielectric), albedo, vec3(metallic));
}
vec3 prefiltered_dfg(float lod, float NoV) {
	return textureLod(uDfg, vec2(NoV, lod), 0.0).rgb;
}
vec3 get_energy_compensation(vec3 f0, float env) {
	return 1.0 + f0 * (1.0 / env - 1.0);
}

// light_compute() of scene_forward_lights_inc.glsl (Burley or Lambert diffuse, Schlick-GGX specular).
void light_compute(vec3 N, vec3 L, vec3 V, float A, vec3 light_color, bool is_directional, float attenuation, vec3 f0,
		float roughness, float metallic, float specular_amount, vec3 albedo, vec3 energy_compensation,
		vec3 backlight, float rim, float rim_tint, inout vec3 diffuse_light, inout vec3 specular_light) {
	float NdotL = min(A + dot(N, L), 1.0);
	float cNdotV = max(dot(N, V), 1e-4);
#ifdef GD_RIM
	float rim_light = pow(max(1e-4, 1.0 - cNdotV), max(0.0, (1.0 - roughness) * 16.0));
	diffuse_light += rim_light * rim * mix(vec3(1.0), albedo, rim_tint) * light_color;
#endif
	if (is_directional || attenuation > HALF_FLT_MIN) {
		float cNdotL = max(NdotL, 0.0);
		vec3 H = normalize(V + L);
		float cLdotH = clamp(A + dot(L, H), 0.0, 1.0);
		if (metallic < 1.0) {
			float diffuse_brdf_NL;
#ifdef GD_DIFFUSE_LAMBERT
			diffuse_brdf_NL = cNdotL * (1.0 / M_PI);
#else
			{
				float FD90_minus_1 = 2.0 * cLdotH * cLdotH * roughness - 0.5;
				float FdV = 1.0 + FD90_minus_1 * SchlickFresnel(cNdotV);
				float FdL = 1.0 + FD90_minus_1 * SchlickFresnel(cNdotL);
				diffuse_brdf_NL = (1.0 / M_PI) * FdV * FdL * cNdotL;
			}
#endif
			diffuse_light += light_color * diffuse_brdf_NL * attenuation;
#ifdef GD_BACKLIGHT
			diffuse_light += light_color * (vec3(1.0 / M_PI) - diffuse_brdf_NL) * backlight * attenuation;
#endif
		}
		if (roughness > 0.0) {
			float cNdotH = clamp(A + dot(N, H), 0.0, 1.0);
			float alpha_ggx = roughness * roughness;
			float D = D_GGX(cNdotH, alpha_ggx);
			float G = V_GGX(cNdotL, cNdotV, alpha_ggx);
			float cLdotH5 = SchlickFresnel(cLdotH);
			// Fresnel with Filament's specular occlusion term.
			float f90 = clamp(dot(f0, vec3(50.0 * 0.33)), metallic, 1.0);
			vec3 F = f0 + (f90 - f0) * cLdotH5;
			vec3 specular_brdf_NL = energy_compensation * cNdotL * D * F * G;
			specular_light += specular_brdf_NL * light_color * attenuation * specular_amount;
		}
	}
}

float get_omni_attenuation(float distance, float inv_range, float decay) {
	float nd = distance * inv_range;
	nd *= nd;
	nd *= nd;
	nd = max(1.0 - nd, 0.0);
	nd *= nd;
	return nd * pow(max(distance, 0.0001), -decay);
}

// Interleaved gradient noise: the rotation of the shadow kernel, one angle per pixel.
float quick_hash(vec2 pos) {
	const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
	return fract(magic.z * fract(dot(pos, magic.xy)));
}

// sample_directional_pcf_shadow(): every tap is a hardware comparison filtered over the four nearest
// texels. The engine stores depth reversed and compares GREATER; here depth grows away from the
// light and the sampler compares LESS — the same test, mirrored.
float sample_directional_pcf_shadow(vec2 shadow_pixel_size, vec4 coord) {
	vec2 pos = coord.xy;
	float depth = coord.z;
	float r = quick_hash(gl_FragCoord.xy) * 2.0 * M_PI;
	float sr = sin(r);
	float cr = cos(r);
	mat2 disk_rotation = mat2(vec2(cr, -sr), vec2(sr, cr));
	float avg = 0.0;
	for (int i = 0; i < ${DIRECTIONAL_SOFT_SHADOW_SAMPLES}; i++) {
		vec2 at = pos + shadow_pixel_size * (disk_rotation * uDirShadowKernel[i]);
		avg += texture(uDirShadowAtlas, vec3(at, depth));
	}
	return avg * (1.0 / float(${DIRECTIONAL_SOFT_SHADOW_SAMPLES}));
}

vec4 directional_shadow_coord(vec3 vertex, vec3 light_dir, vec3 base_normal_bias, int split) {
	vec4 v = vec4(vertex, 1.0);
	v.xyz += light_dir * uDirShadowBias[split];
	vec3 normal_bias = base_normal_bias * uDirShadowNormalBias[split];
	normal_bias -= light_dir * dot(light_dir, normal_bias);
	v.xyz += normal_bias;
	return uDirShadowMatrix[split] * v;
}

// The directional shadow of the fragment: the split by depth, its blur scaled to the first split's.
float directional_shadow(vec3 vertex, vec3 geo_normal, vec3 light_dir) {
	float depth_z = -vertex.z;
	vec3 base_normal_bias = geo_normal * (1.0 - max(0.0, dot(light_dir, -geo_normal)));
	vec4 splits = uDirShadowSplits;
	float blend_splits = uDirShadowParams.w;
	int split;
	float blur_factor;
	if (depth_z < splits.x) {
		split = 0;
		blur_factor = 1.0;
	} else if (depth_z < splits.y) {
		split = 1;
		blur_factor = splits.x / splits.y;
	} else if (depth_z < splits.z) {
		split = 2;
		blur_factor = splits.x / splits.z;
	} else {
		split = 3;
		blur_factor = splits.x / splits.w;
	}
	vec4 pssm_coord = directional_shadow_coord(vertex, light_dir, base_normal_bias, split);
	pssm_coord /= pssm_coord.w;
	float shadow = sample_directional_pcf_shadow(uDirShadowPixelSize * uDirShadowParams.x * (blur_factor + (1.0 - blur_factor) * blend_splits), pssm_coord);
	if (blend_splits > 0.5) {
		float pssm_blend;
		float blur_factor2;
		int next;
		if (depth_z < splits.x) {
			next = 1;
			pssm_blend = gd_smoothstep(splits.x - splits.x * 0.1, splits.x, depth_z);
			blur_factor2 = splits.x / splits.y;
		} else if (depth_z < splits.y) {
			next = 2;
			pssm_blend = gd_smoothstep(splits.y - splits.y * 0.1, splits.y, depth_z);
			blur_factor2 = splits.x / splits.z;
		} else if (depth_z < splits.z) {
			next = 3;
			pssm_blend = gd_smoothstep(splits.z - splits.z * 0.1, splits.z, depth_z);
			blur_factor2 = splits.x / splits.w;
		} else {
			next = split;
			pssm_blend = 0.0;
			blur_factor2 = 1.0;
		}
		vec4 coord2 = directional_shadow_coord(vertex, light_dir, base_normal_bias, next);
		coord2 /= coord2.w;
		float shadow2 = sample_directional_pcf_shadow(uDirShadowPixelSize * uDirShadowParams.x * (blur_factor2 + (1.0 - blur_factor2) * blend_splits), coord2);
		shadow = mix(shadow, shadow2, pssm_blend);
	}
	// Done with negative values, like the engine (vertex.z is negative in front of the camera).
	shadow = mix(shadow, 1.0, gd_smoothstep(uDirShadowParams.y, uDirShadowParams.z, vertex.z));
	// The engine packs the shadow of each light into 8 bits between its two lighting passes.
	return float(uint(clamp(shadow * 255.0, 0.0, 255.0))) / 255.0;
}

// fog_process(): exponential depth fog plus height fog; returns (colour, amount).
vec4 fog_process(vec3 vertex) {
	vec3 fog_color = uFogColor;
	if (uFogParams.w > 0.001) {
		vec3 view = normalize(vertex);
		for (int i = 0; i < ${MAX_DIRECTIONAL}; i++) {
			if (i >= uDirCount) break;
			vec3 light_color = uDirColor[i].rgb * uDirColor[i].a;
			float light_amount = pow(max(dot(view, uDirDirection[i]), 0.0), 8.0);
			fog_color += light_color * light_amount * uFogParams.w;
		}
	}
	float fog_amount = 1.0 - exp(min(0.0, -length(vertex) * uFogParams.x));
	if (abs(uFogParams.z) >= 0.0001) {
		float y = (uInvView * vec4(vertex, 1.0)).y;
		float y_dist = y - uFogParams.y;
		float vfog_amount = 1.0 - exp(min(0.0, y_dist * uFogParams.z));
		fog_amount = max(vfog_amount, fog_amount);
	}
	return vec4(fog_color, fog_amount);
}

${VOLUME_ATLAS_GLSL}
vec4 volumetric_fog_process(vec2 screen_uv, float z) {
	vec3 fog_pos = vec3(screen_uv, z * uVolumetricFogParams.y);
	if (fog_pos.z < 0.0) {
		return vec4(0.0, 0.0, 0.0, 1.0);
	} else if (fog_pos.z < 1.0) {
		fog_pos.z = pow(fog_pos.z, uVolumetricFogParams.z);
	}
	return volume_atlas_sample(uVolumetricFog, uVolumetricFogSize, fog_pos);
}

// encode24(): the normal scaled to the length that survives 8 bits best (CryEngine 3's best fit).
vec3 encode24(vec3 v) {
	vec3 vNormalUns = abs(v);
	float maxNAbs = max(vNormalUns.z, max(vNormalUns.x, vNormalUns.y));
	vec2 vTexCoord = vNormalUns.z < maxNAbs ? (vNormalUns.y < maxNAbs ? vNormalUns.yz : vNormalUns.xz) : vNormalUns.xy;
	vTexCoord /= maxNAbs;
	vTexCoord = vTexCoord.x < vTexCoord.y ? vTexCoord.yx : vTexCoord.xy;
	vTexCoord.y /= vTexCoord.x;
	float fFittingScale = texture(uBestFitNormal, vTexCoord).r;
	vec3 result = v / maxNAbs;
	result *= fFittingScale;
	return result;
}
`;

const TYPE_DEFAULTS = { float: 0, int: 0, bool: false, vec2: new THREE.Vector2(), vec3: new THREE.Vector3(), vec4: new THREE.Vector4(), sampler2D: null, mat4: new THREE.Matrix4() };

/** Godot value → THREE uniform value (colours linearised when the uniform is a source colour). */
function toUniformValue(type, value, source) {
  if (value instanceof Color) {
    const c = source ? value.srgb_to_linear() : value;
    if (type === 'vec3') return new THREE.Vector3(c.r, c.g, c.b);
    return new THREE.Vector4(c.r, c.g, c.b, c.a);
  }
  if (value instanceof Vector3) return new THREE.Vector3(value.x, value.y, value.z);
  if (value instanceof Vector2) return new THREE.Vector2(value.x, value.y);
  if (Array.isArray(value)) {
    if (value.length === 3) return new THREE.Vector3(...value);
    if (value.length === 4) return new THREE.Vector4(...value);
    if (value.length === 2) return new THREE.Vector2(...value);
  }
  if (type === 'bool') return Boolean(value);
  if (type === 'int') return Math.trunc(value);
  return value;
}

/**
 * @typedef {object} ShaderSpec
 * @property {string} name
 * @property {object} [renderMode] unshaded, blend ('mix'|'add'|'premul'), cull ('back'|'disabled'|'front'),
 *   depthDraw ('opaque'|'never'|'always'), depthTest (bool), shadowsDisabled, fogDisabled,
 *   diffuse ('burley'|'lambert'), backlight, rim, alpha (uses ALPHA → transparent pass), discard
 * @property {Record<string, {type: string, value?: any, source?: boolean}>} [uniforms]
 * @property {string} [varyings] declarations shared by both stages (use `varying`)
 * @property {string} [functions] helpers available to the fragment stage
 * @property {string} [vertexFunctions] helpers available to both stages
 * @property {string} [vertex] body of Godot's vertex()
 * @property {string} [fragment] body of Godot's fragment()
 */

const programCache = new Map();

/** Front faces arrive with reversed winding in the mirrored screen passes. */
const MIRRORED_FRONT = '#define GD_FRONT_FACING (!gl_FrontFacing)';
const PLAIN_FRONT = '#define GD_FRONT_FACING gl_FrontFacing';
const PASS_DEFINES = {
  [Pass.COLOR]: [MIRRORED_FRONT],
  [Pass.COLOR_SEPARATE]: [MIRRORED_FRONT, '#define GD_SEPARATE_SPECULAR'],
  [Pass.PREPASS]: [MIRRORED_FRONT, '#define GD_DEPTH_PASS', '#define GD_PASS_PREPASS'],
  [Pass.SHADOW]: [PLAIN_FRONT, '#define GD_DEPTH_PASS', '#define GD_PASS_SHADOW'],
};

/** A material is drawn in the transparent pass when it blends (the engine's alpha render list). */
const isTransparent = (rm) => rm.blend === 'add' || rm.blend === 'premul' || Boolean(rm.alpha);

/** The varyings of the template itself; a material adds its own. */
const TEMPLATE_VARYINGS = /* glsl */ `
varying vec3 gd_view_pos;
varying vec3 gd_view_normal;
varying vec2 gd_uv;
varying vec2 gd_uv2;
varying vec4 gd_color;`;

const VARYING_DECLARATION = /\bvarying\s+((?:(?:flat|smooth|centroid|highp|mediump|lowp)\s+)*)(\w+)\s+(\w+)\s*;/g;
const VARYING_KEYWORD = /\bvarying\b/g;
const GLSL_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The varyings a block of GLSL declares. A declaration this cannot read (an array, a struct) is an
 * error, never a varying left behind at the sample. O(length of the text).
 * @returns {{type: string, name: string, flat: boolean}[]}
 */
function parseVaryings(declarations) {
  const code = declarations.replace(GLSL_COMMENT, ' ');
  const varyings = [...code.matchAll(VARYING_DECLARATION)].map(([, qualifiers, type, name]) => ({ type, name, flat: /\bflat\b/.test(qualifiers) }));
  const declared = (code.match(VARYING_KEYWORD) ?? []).length;
  if (declared !== varyings.length) throw new Error(`SpatialMaterial: ${declared - varyings.length} varying declaration(s) not understood in:\n${declarations}`);
  return varyings;
}

/**
 * The varyings of the prepass' fragment stage, read at the centre of the pixel.
 *
 * The engine's prepass is multisampled and its resolve keeps sample 0 of each pixel (resolve.glsl
 * picks the least frequent depth, and the depths of a pixel are all different). Multisampling
 * shades once per pixel, at its centre; only coverage and depth belong to the sample. Hence: the
 * image is drawn moved by `uPrepassShift`, which puts sample 0 on the pixel centre (coverage and
 * depth are then that sample's), and every varying is taken back to the centre of the engine's
 * pixel before the material reads it.
 *
 * A perspective-correct varying is (v/w) / (1/w), two quantities that are affine on the screen:
 * extrapolating both with their screen derivatives reaches the centre exactly, outside the
 * primitive too (what multisampling does when the centre is not covered). A flat varying is the
 * same all over its primitive. O(varyings).
 */
function varyingsAtPixelCentre(declarations) {
  const varyings = parseVaryings(declarations);
  return /* glsl */ `
${declarations}
${varyings.map(({ type, name }) => `${type} ${name}_at_centre;`).join('\n')}
float gd_sample_view_depth;
#define GD_TO_CENTRE(v) (((v) * gl_FragCoord.w + dFdx((v) * gl_FragCoord.w) * uPrepassShift.x + dFdy((v) * gl_FragCoord.w) * uPrepassShift.y) / inv_w_centre)
void gd_shade_at_pixel_centre() {
	float inv_w_centre = gl_FragCoord.w + dFdx(gl_FragCoord.w) * uPrepassShift.x + dFdy(gl_FragCoord.w) * uPrepassShift.y;
	gd_sample_view_depth = -gd_view_pos.z;
${varyings.map(({ name, flat }) => `\t${name}_at_centre = ${flat ? name : `GD_TO_CENTRE(${name})`};`).join('\n')}
}
#undef GD_TO_CENTRE
${varyings.map(({ name }) => `#define ${name} ${name}_at_centre`).join('\n')}
`;
}

function buildSources(spec, pass) {
  const rm = spec.renderMode ?? {};
  const defines = [...PASS_DEFINES[pass]];
  if (rm.diffuse === 'lambert') defines.push('#define GD_DIFFUSE_LAMBERT');
  if (rm.backlight) defines.push('#define GD_BACKLIGHT');
  if (rm.rim) defines.push('#define GD_RIM');
  if (rm.unshaded) defines.push('#define GD_UNSHADED');
  if (rm.fogDisabled) defines.push('#define GD_FOG_DISABLED');
  if (rm.cull === 'disabled') defines.push('#define GD_DOUBLE_SIDED');
  if (rm.shadowsDisabled) defines.push('#define GD_SHADOWS_DISABLED');
  // The alpha pass never sees the roughness limiter nor the screen-space buffers (they describe the
  // opaque scene); the engine sets them up for the opaque pass only.
  if (isTransparent(rm)) defines.push('#define GD_ALPHA_PASS');
  if (!RenderSettings.specularOcclusion) defines.push('#define GD_SPECULAR_OCCLUSION_DISABLED');
  const uniformDecl = Object.entries(spec.uniforms ?? {})
    .map(([name, u]) => `uniform ${u.type} ${name};`)
    .join('\n');
  // Helper functions may use fragment-only built-ins (dFdx, fwidth): like Godot's compiler, which only
  // keeps what each stage uses, they go to the fragment stage (vertex() bodies never call them).
  const common = `${defines.join('\n')}\n${SHARED_UNIFORMS_GLSL}\n${uniformDecl}\n${SMOOTHSTEP_GLSL}\n`;
  const varyings = `${TEMPLATE_VARYINGS}\n${spec.varyings ?? ''}\n`;
  const fragmentVaryings = pass === Pass.PREPASS ? varyingsAtPixelCentre(varyings) : varyings;
  const sharedFunctions = portGlsl(spec.vertexFunctions);
  const fragmentFunctions = portGlsl(spec.functions);

  const vertexShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler3D;
precision highp sampler2DShadow;
${common}
${varyings}
${sharedFunctions}
attribute vec4 aColor;
attribute vec2 aUv2;
#ifdef USE_INSTANCING
attribute vec4 aInstanceColor;
#endif
void main() {
	vec3 VERTEX = position;
	vec3 NORMAL = normal;
	vec2 UV = uv;
	vec2 UV2 = aUv2;
	vec4 COLOR = aColor;
	mat4 MODEL_MATRIX = modelMatrix;
	mat3 gd_normal_matrix = normalMatrix;
#ifdef USE_INSTANCING
	MODEL_MATRIX = modelMatrix * instanceMatrix;
	// Godot's multimesh normals use mat3(instance) (not the inverse transpose) — kept on purpose.
	gd_normal_matrix = normalMatrix * mat3(instanceMatrix);
	COLOR *= aInstanceColor;
#endif
	mat4 VIEW_MATRIX = viewMatrix;
	mat4 INV_VIEW_MATRIX = uInvView;
	mat4 MODELVIEW_MATRIX = VIEW_MATRIX * MODEL_MATRIX;
	{
${portGlsl(spec.vertex)}
	}
	vec4 mvPosition = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	gd_view_pos = mvPosition.xyz;
	gd_view_normal = normalize(gd_normal_matrix * NORMAL);
	gd_uv = UV;
	gd_uv2 = UV2;
	gd_color = COLOR;
	gl_Position = projectionMatrix * mvPosition;
#ifdef GD_PASS_SHADOW
	// Pancake: casters between the light and the shadow frustum are flattened onto its near plane
	// (the engine's 0.9999 of reversed depth).
	if (gl_Position.z <= -0.9998 * gl_Position.w) {
		gl_Position.z = -0.9998 * gl_Position.w;
	}
#endif
#ifdef GD_PASS_PREPASS
	// A pixel measures two clip units over the size of the viewport.
	gl_Position.xy += uPrepassShift * 2.0 * uScreenPixelSize * gl_Position.w;
#endif
}
`;

  const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler3D;
precision highp sampler2DShadow;
${common}
${fragmentVaryings}
${sharedFunctions}
${OCT_GLSL}
${fragmentFunctions}
${LIGHTING_GLSL}
layout(location = 0) out vec4 gd_out_color;
#ifdef GD_PASS_PREPASS
// The view depth itself: what the engine gets by linearising its depth buffer.
layout(location = 1) out vec4 gd_out_depth;
#endif
#if !defined(GD_PASS_PREPASS) && !defined(GD_PASS_SHADOW)
// The colour target may hold a second buffer, the specular light kept apart (subsurface.js). Every
// colour program writes it: WebGL refuses a draw that leaves an active buffer without an output.
layout(location = 1) out vec4 gd_out_specular;
#endif
#ifdef GD_SEPARATE_SPECULAR
// In alpha, the depth buffer's value here (reversed: 1 near, 0 far): the resolve averages it over the
// samples like the engine's depth resolve, and the subsurface blur reads it.
float gd_reversed_depth(float view_depth) {
	return uZRange.x * (uZRange.y - view_depth) / ((uZRange.y - uZRange.x) * view_depth);
}
#endif
void main() {
#ifdef GD_PASS_PREPASS
	gd_shade_at_pixel_centre();
#endif
	vec3 VERTEX = gd_view_pos;
	vec3 NORMAL = gd_view_normal;
#ifdef GD_DOUBLE_SIDED
	if (!GD_FRONT_FACING) NORMAL = -NORMAL;
#endif
	vec3 VIEW = -normalize(gd_view_pos);
	vec2 UV = gd_uv;
	vec2 UV2 = gd_uv2;
	vec4 COLOR = gd_color;
	vec2 SCREEN_UV = gl_FragCoord.xy * uScreenPixelSize;
	mat4 VIEW_MATRIX = viewMatrix;
	mat4 INV_VIEW_MATRIX = uInvView;
	vec3 ALBEDO = vec3(1.0);
	float ALPHA = 1.0;
	float METALLIC = 0.0;
	float ROUGHNESS = 1.0;
	float SPECULAR = 0.5;
	vec3 EMISSION = vec3(0.0);
	vec3 BACKLIGHT = vec3(0.0);
	float RIM = 0.0;
	float RIM_TINT = 0.0;
	float AO = 1.0;
	float AO_LIGHT_AFFECT = 0.0;
	float SSS_STRENGTH = 0.0;
	{
${portGlsl(spec.fragment)}
	}
	float sss_strength = SSS_STRENGTH;
	float roughness = ROUGHNESS;
	float metallic = METALLIC;
	vec3 albedo = ALBEDO;
	float alpha = ALPHA;
	vec3 vertex = VERTEX;
	vec3 view = VIEW;
	vec3 geo_normal = normalize(NORMAL);
	vec3 normal = geo_normal;

#if defined(GD_PASS_SHADOW)
	gd_out_color = vec4(0.0);
#elif defined(GD_PASS_PREPASS)
	// normal_roughness_output_buffer: roughness in the lower half of the range (static geometry).
	gd_out_color = vec4(encode24(normal) * 0.5 + 0.5, roughness * (127.0 / 255.0));
	gd_out_depth = vec4(gd_sample_view_depth, 0.0, 0.0, 1.0);
#else
	/////////////////////// FOG //////////////////////
	vec4 fog = vec4(0.0, 0.0, 0.0, 1.0);
#ifndef GD_FOG_DISABLED
	if ((uSceneFlags & SCENE_USE_FOG) != 0) {
		fog = fog_process(vertex);
		// Premultiply by opacity and convert opacity to transmittance to match volumetric fog.
		fog.rgb *= fog.a;
		fog.a = 1.0 - fog.a;
	}
	if (uVolumetricFogParams.x > 0.5) {
		vec4 volumetric_fog = volumetric_fog_process(SCREEN_UV, -vertex.z);
		vec4 res = vec4(0.0);
		if ((uSceneFlags & SCENE_USE_FOG) != 0) {
			res.a = fog.a * volumetric_fog.a;
			res.rgb = fog.rgb * volumetric_fog.a + volumetric_fog.rgb;
		} else {
			res = volumetric_fog;
		}
		fog = res;
	}
#endif

#ifdef GD_UNSHADED
#ifdef GD_SEPARATE_SPECULAR
	gd_out_color = vec4(albedo, 0.0);
	gd_out_specular = vec4(0.0);
#else
	gd_out_color = vec4(albedo, alpha);
#endif
#else
	/////////////////////// LIGHTING //////////////////////////////
#ifndef GD_ALPHA_PASS
	if ((uSceneFlags & SCENE_USE_ROUGHNESS_LIMITER) != 0) {
		// Improved geometric specular antialiasing (Tokuyoshi & Kaplanyan).
		float roughness2 = roughness * roughness;
		vec3 dndu = dFdx(normal), dndv = dFdy(normal);
		float variance = uRoughnessLimiter.x * (dot(dndu, dndu) + dot(dndv, dndv));
		float kernelRoughness2 = min(2.0 * variance, uRoughnessLimiter.y);
		float filteredRoughness2 = min(1.0, roughness2 + kernelRoughness2);
		roughness = sqrt(filteredRoughness2);
		if (roughness < 0.00000001) {
			roughness = 0.0;
		}
	}
#endif
	vec3 energy_compensation = vec3(1.0);
	vec3 direct_specular_light = vec3(0.0);
	vec3 indirect_specular_light = vec3(0.0);
	vec3 diffuse_light = vec3(0.0);
	vec3 ambient_light = vec3(0.0);
	vec3 emission = EMISSION;
	float ao = AO;
	float ao_light_affect = AO_LIGHT_AFFECT;

	if ((uSceneFlags & SCENE_USE_REFLECTION_CUBEMAP) != 0) {
		vec3 ref_vec = reflect(-view, normal);
		ref_vec = mix(ref_vec, normal, roughness * roughness);
		float horizon = min(1.0 + dot(ref_vec, normal), 1.0);
		// The sky is not rotated: world space is the radiance map's space.
		ref_vec = mat3(uInvView) * ref_vec;
		float roughness_lod, blend;
		blend = modf(sqrt(roughness) * uRadianceParams.w, roughness_lod);
		float ref_lod = vec3_to_oct_lod(dFdx(ref_vec), dFdy(ref_vec), uRadianceParams.x);
		vec2 ref_uv = vec3_to_oct_with_border(ref_vec, uRadianceParams.yz);
		vec3 indirect_sample_a = textureLod(uRadiance, vec3(ref_uv, roughness_lod), ref_lod).rgb;
		vec3 indirect_sample_b = textureLod(uRadiance, vec3(ref_uv, roughness_lod + 1.0), ref_lod).rgb;
		indirect_specular_light = mix(indirect_sample_a, indirect_sample_b, blend);
		indirect_specular_light *= horizon * horizon;
		indirect_specular_light *= uAmbient.a;
	}

	if ((uSceneFlags & SCENE_USE_AMBIENT_LIGHT) != 0) {
		ambient_light = uAmbient.rgb;
		if ((uSceneFlags & SCENE_USE_AMBIENT_CUBEMAP) != 0) {
			vec3 ambient_dir = mat3(uInvView) * normal;
			float ambient_lod = vec3_to_oct_lod(dFdx(ambient_dir), dFdy(ambient_dir), uRadianceParams.x);
			vec2 ambient_uv = vec3_to_oct_with_border(ambient_dir, uRadianceParams.yz);
			vec3 cubemap_ambient = textureLod(uRadiance, vec3(ambient_uv, uRadianceParams.w), ambient_lod).rgb;
			ambient_light = mix(ambient_light, cubemap_ambient * uAmbient.a, uAmbientSkyMix);
		}
	}

#ifndef GD_ALPHA_PASS
	int ss_effects = int(uSsEffects.x);
	if ((ss_effects & SS_EFFECTS_USE_SSAO) != 0) {
		float ssao = texture(uAoBuffer, SCREEN_UV).r;
		ao = min(ao, ssao);
		ao_light_affect = mix(ao_light_affect, max(ao_light_affect, uSsEffects.z), uSsEffects.y);
	}
#endif

	// Finalize ambient light here.
	{
		ambient_light *= ao;
#ifndef GD_SPECULAR_OCCLUSION_DISABLED
		float specular_occlusion = (ambient_light.r * 0.3 + ambient_light.g * 0.59 + ambient_light.b * 0.11) * 2.0;
		specular_occlusion = min(specular_occlusion * 4.0, 1.0);
		float reflective_f = (1.0 - roughness) * metallic;
		// 10.0 is a magic number: low enough for occlusion, high enough for reaction to lights and shadows.
		specular_occlusion = max(min(reflective_f * specular_occlusion * 10.0, 1.0), specular_occlusion);
		indirect_specular_light *= specular_occlusion;
#endif
		ambient_light *= albedo.rgb;
#ifndef GD_ALPHA_PASS
		if ((ss_effects & SS_EFFECTS_USE_SSIL) != 0) {
			vec4 ssil = textureLod(uSsilBuffer, SCREEN_UV, 0.0);
			ambient_light *= 1.0 - ssil.a;
			ambient_light += ssil.rgb * albedo.rgb;
		}
#endif
	}

	// Convert ao to direct light ao.
	ao = mix(1.0, ao, ao_light_affect);

	vec3 f0 = F0(metallic, SPECULAR, albedo);
	{
		float NdotV = clamp(dot(normal, view), 0.0001, 1.0);
		vec2 envBRDF = prefiltered_dfg(roughness, NdotV).xy;
		// Multiscattering.
		energy_compensation = get_energy_compensation(f0, envBRDF.y);
		// Cheap luminance approximation.
		float f90 = clamp(50.0 * f0.g, metallic, 1.0);
		indirect_specular_light *= energy_compensation * ((f90 - f0) * envBRDF.x + f0 * envBRDF.y);
	}

	// Directional lights.
	for (int i = 0; i < ${MAX_DIRECTIONAL}; i++) {
		if (i >= uDirCount) break;
		float shadow = 1.0;
#ifndef GD_SHADOWS_DISABLED
		if (uDirParams[i].y > 0.001) {
			shadow = directional_shadow(vertex, geo_normal, uDirDirection[i]);
		}
		shadow = mix(1.0, shadow, uDirParams[i].y);
#endif
		light_compute(normal, uDirDirection[i], normalize(view), 0.0, uDirColor[i].rgb * uDirColor[i].a, true, shadow, f0, roughness, metallic,
				uDirParams[i].x, albedo, energy_compensation, BACKLIGHT, RIM, RIM_TINT, diffuse_light, direct_specular_light);
	}

	// Omni lights.
	for (int i = 0; i < ${MAX_OMNI}; i++) {
		if (i >= uOmniCount) break;
		vec3 light_rel_vec = uOmniPosition[i].xyz - vertex;
		float light_length = length(light_rel_vec);
		float omni_attenuation = get_omni_attenuation(light_length, uOmniPosition[i].w, uOmniColor[i].a);
		light_compute(normal, normalize(light_rel_vec), view, 0.0, uOmniColor[i].rgb, false, omni_attenuation, f0, roughness, metallic,
				uOmniParams[i].x, albedo, energy_compensation, BACKLIGHT, RIM, RIM_TINT, diffuse_light, direct_specular_light);
	}

	// Multiply by albedo: ambient must be multiplied by albedo at the end.
	diffuse_light *= albedo;
	// Apply direct light AO.
	diffuse_light *= ao;
	direct_specular_light *= ao;
	// Apply metallic.
	diffuse_light *= 1.0 - metallic;
	ambient_light *= 1.0 - metallic;

#ifdef GD_SEPARATE_SPECULAR
	gd_out_color = vec4(emission + diffuse_light + ambient_light, sss_strength);
	gd_out_specular = vec4(direct_specular_light + indirect_specular_light, 0.0);
#else
	gd_out_color = vec4(emission + ambient_light + diffuse_light + direct_specular_light + indirect_specular_light, alpha);
#endif
#endif // GD_UNSHADED

#ifndef GD_FOG_DISABLED
	gd_out_color.rgb = gd_out_color.rgb * fog.a + fog.rgb;
#ifdef GD_SEPARATE_SPECULAR
	gd_out_specular.rgb = gd_out_specular.rgb * fog.a;
#endif
#endif
#ifdef GD_SEPARATE_SPECULAR
	gd_out_specular.a = gd_reversed_depth(-vertex.z);
#else
	// Drawn where the specular light is not kept apart (or after it has been merged): nothing reads it.
	gd_out_specular = vec4(0.0);
#endif
#endif // colour pass
}
`;
  return { vertexShader, fragmentShader };
}

function sourcesFor(spec, pass) {
  const key = `${spec.name}|${JSON.stringify(spec.renderMode ?? {})}|${pass}`;
  let sources = programCache.get(key);
  if (!sources) {
    sources = buildSources(spec, pass);
    programCache.set(key, sources);
  }
  return sources;
}

function blendingOf(rm) {
  if (rm.blend === 'add') return THREE.AdditiveBlending;
  // blend_premul_alpha: ONE, ONE_MINUS_SRC_ALPHA (colour already multiplied by alpha in the shader).
  if (rm.blend === 'premul') return THREE.CustomBlending;
  if (rm.alpha) return THREE.NormalBlending;
  return THREE.NoBlending;
}

const sideOf = (rm) => (rm.cull === 'disabled' ? THREE.DoubleSide : rm.cull === 'front' ? THREE.BackSide : THREE.FrontSide);
/** The side to ask three.js for when the projection is mirrored in Y (the winding is reversed). */
const mirrored = (side) => (side === THREE.FrontSide ? THREE.BackSide : side === THREE.BackSide ? THREE.FrontSide : side);

export class SpatialMaterial extends THREE.ShaderMaterial {
  /** @param {ShaderSpec} spec */
  constructor(spec, values = {}) {
    const rm = spec.renderMode ?? {};
    const sources = sourcesFor(spec, Pass.COLOR);
    const uniforms = { ...sharedUniforms };
    for (const [name, u] of Object.entries(spec.uniforms ?? {})) {
      const initial = name in values ? values[name] : u.value !== undefined ? u.value : TYPE_DEFAULTS[u.type];
      uniforms[name] = { value: toUniformValue(u.type, initial, u.source) };
    }
    const transparent = isTransparent(rm);
    super({
      name: spec.name,
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: sources.vertexShader,
      fragmentShader: sources.fragmentShader,
      lights: false,
      fog: false,
      transparent,
      blending: blendingOf(rm),
      depthWrite: rm.depthDraw === 'always' || (rm.depthDraw !== 'never' && !transparent),
      depthTest: rm.depthTest !== false,
      side: mirrored(sideOf(rm)),
    });
    this.toneMapped = false;
    if (rm.blend === 'premul') {
      this.blendSrc = THREE.OneFactor;
      this.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.blendSrcAlpha = THREE.OneFactor;
      this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    // Godot's defaults for missing arrays: COLOR = white, UV/UV2 = 0, instance colour = white.
    this.defaultAttributeValues = { aColor: [1, 1, 1, 1], aUv2: [0, 0], uv: [0, 0], aInstanceColor: [1, 1, 1, 1] };
    this.spec = spec;
    this.specUniforms = spec.uniforms ?? {};
    /** Shadow caster: shaded, not additive, shadows not disabled (GeometryInstance3D decides per node). */
    this.castsShadow = !rm.shadowsDisabled && !rm.unshaded && rm.blend !== 'add' && !transparent;
    /** Drawn in the depth prepass: the opaque render list. */
    this.inPrepass = !transparent && rm.depthDraw !== 'never' && rm.depthTest !== false;
    /** Writes SSS_STRENGTH: once in view, it turns the frame's subsurface scattering on. */
    this.usesSss = writesBuiltin(spec.fragment, 'SSS_STRENGTH');
    /** @type {Map<string, THREE.ShaderMaterial>} */
    this._variants = new Map();
  }

  /** `material.set_shader_parameter(name, value)` */
  set_shader_parameter(name, value) {
    const u = this.specUniforms[name];
    if (!u) throw new Error(`${this.spec.name}: no shader parameter "${name}"`);
    this.uniforms[name].value = toUniformValue(u.type, value, u.source);
  }

  get_shader_parameter(name) {
    return this.uniforms[name]?.value;
  }

  /**
   * The material of `pass` for this material: itself for the colour pass; for the others a twin that
   * shares the uniform values and keeps the vertex motion and the discards — the colour with the
   * specular light apart (with this material's blending and depth state), or depth only.
   */
  forPass(pass) {
    if (pass === Pass.COLOR) return this;
    let variant = this._variants.get(pass);
    if (!variant) {
      const sources = sourcesFor(this.spec, pass);
      const colour = pass === Pass.COLOR_SEPARATE;
      variant = new THREE.ShaderMaterial({
        name: `${this.spec.name}-${pass}`,
        glslVersion: THREE.GLSL3,
        uniforms: this.uniforms,
        vertexShader: sources.vertexShader,
        fragmentShader: sources.fragmentShader,
        lights: false,
        fog: false,
        side: pass === Pass.SHADOW ? sideOf(this.spec.renderMode ?? {}) : this.side,
        blending: colour ? this.blending : THREE.NoBlending,
        depthTest: colour ? this.depthTest : true,
        depthWrite: colour ? this.depthWrite : true,
        colorWrite: pass !== Pass.SHADOW,
      });
      variant.toneMapped = false;
      variant.defaultAttributeValues = this.defaultAttributeValues;
      this._variants.set(pass, variant);
    }
    return variant;
  }

  dispose() {
    for (const variant of this._variants.values()) variant.dispose();
    this._variants.clear();
    super.dispose();
  }
}

/**
 * StandardMaterial3D subset used by the game (albedo/roughness/metallic/specular, emission, alpha,
 * additive, unshaded, vertex-colour albedo, a texture, rim). One shader, flags as uniforms, so all
 * standard materials share a single program per render mode.
 */
const STANDARD_SPEC_BASE = {
  uniforms: {
    albedo_color: { type: 'vec4', value: Color.WHITE, source: true },
    roughness: { type: 'float', value: 1.0 },
    metallic: { type: 'float', value: 0.0 },
    metallic_specular: { type: 'float', value: 0.5 },
    emission: { type: 'vec3', value: new Color(0, 0, 0), source: true },
    emission_energy: { type: 'float', value: 1.0 },
    use_vertex_color: { type: 'float', value: 0 },
    use_texture: { type: 'float', value: 0 },
    albedo_texture: { type: 'sampler2D', value: null },
    rim_amount: { type: 'float', value: 0 },
    rim_tint_amount: { type: 'float', value: 0.5 },
    subsurface_scattering_strength: { type: 'float', value: 0 },
  },
  fragment: /* glsl */ `
	vec4 base = albedo_color;
	if (use_vertex_color > 0.5) base *= COLOR;
	if (use_texture > 0.5) base *= texture(albedo_texture, UV);
	ALBEDO = base.rgb;
	ALPHA = base.a;
	ROUGHNESS = roughness;
	METALLIC = metallic;
	SPECULAR = metallic_specular;
	EMISSION = emission * emission_energy;
	RIM = rim_amount;
	RIM_TINT = rim_tint_amount;
`,
};

/** BaseMaterial3D::_update_shader, FEATURE_SUBSURFACE_SCATTERING (its default white texture: × 1). */
const STANDARD_SSS_FRAGMENT = `${STANDARD_SPEC_BASE.fragment}	SSS_STRENGTH = subsurface_scattering_strength;
`;

export class StandardMaterial3D extends SpatialMaterial {
  /**
   * @param {object} options albedo_color, roughness, metallic, metallic_specular, emission,
   *   emission_energy_multiplier, transparency ('alpha'), blend_mode ('add'), cull_mode ('disabled'),
   *   shading_mode ('unshaded'), vertex_color_use_as_albedo, albedo_texture, disable_fog, rim,
   *   subsurf_scatter_enabled, subsurf_scatter_strength
   */
  constructor(options = {}) {
    const renderMode = {
      unshaded: options.shading_mode === 'unshaded',
      blend: options.blend_mode === 'add' ? 'add' : 'mix',
      alpha: options.transparency === 'alpha',
      cull: options.cull_mode === 'disabled' ? 'disabled' : 'back',
      fogDisabled: Boolean(options.disable_fog),
      shadowsDisabled: Boolean(options.disable_receive_shadows),
      rim: Boolean(options.rim_enabled),
    };
    const sss = Boolean(options.subsurf_scatter_enabled);
    super({ name: sss ? 'standard_sss' : 'standard', renderMode, ...STANDARD_SPEC_BASE, fragment: sss ? STANDARD_SSS_FRAGMENT : STANDARD_SPEC_BASE.fragment }, {});
    /** The construction options, kept for inspection (tests compare them with the original's). */
    this.options = Object.freeze({ ...options });
    this.albedo_color = options.albedo_color ?? Color.WHITE;
    this.roughness = options.roughness ?? 1.0;
    this.metallic = options.metallic ?? 0.0;
    this.metallic_specular = options.metallic_specular ?? 0.5;
    this.set_emission(options.emission_enabled ? options.emission ?? new Color(0, 0, 0) : new Color(0, 0, 0), options.emission_energy_multiplier ?? 1.0);
    this.uniforms.use_vertex_color.value = options.vertex_color_use_as_albedo ? 1 : 0;
    if (options.albedo_texture) {
      this.uniforms.albedo_texture.value = options.albedo_texture;
      this.uniforms.use_texture.value = 1;
    }
    this.uniforms.rim_amount.value = options.rim_enabled ? options.rim ?? 1.0 : 0.0;
    this.uniforms.subsurface_scattering_strength.value = options.subsurf_scatter_strength ?? 0.0;
  }

  get albedo_color() {
    return this._albedo;
  }
  set albedo_color(color) {
    this._albedo = color;
    this.set_shader_parameter('albedo_color', color);
  }
  get roughness() {
    return this.uniforms.roughness.value;
  }
  set roughness(v) {
    this.uniforms.roughness.value = v;
  }
  get metallic() {
    return this.uniforms.metallic.value;
  }
  set metallic(v) {
    this.uniforms.metallic.value = v;
  }
  get metallic_specular() {
    return this.uniforms.metallic_specular.value;
  }
  set metallic_specular(v) {
    this.uniforms.metallic_specular.value = v;
  }
  set_emission(color, energy) {
    this.set_shader_parameter('emission', color);
    this.uniforms.emission_energy.value = energy;
  }
}
