/**
 * SpatialMaterial — Godot 4 spatial shaders on top of THREE.ShaderMaterial.
 *
 * A material is described like a .gdshader: render_mode flags, typed uniforms (with `source`, i.e.
 * Godot's `source_color`: converted sRGB → linear on the CPU exactly like the engine), varyings,
 * helper functions, and the bodies of `vertex()` / `fragment()` written against Godot's built-ins
 * (VERTEX, NORMAL, UV, UV2, COLOR, MODEL_MATRIX, VIEW, TIME, ALBEDO, ROUGHNESS, METALLIC, SPECULAR,
 * EMISSION, BACKLIGHT, ALPHA, RIM…). The template then runs Godot's forward lighting: Burley diffuse,
 * Schlick-GGX specular with Filament's f90, backlight/rim terms, sky radiance with the Lazarov env-BRDF,
 * ambient colour, and Godot's exponential + height fog.
 *
 * Every program writes two targets: [0] the final HDR colour, [1] the part SSAO may darken (ambient +
 * reflections, already fog-weighted) — the compositor applies AO to exactly what Godot applies it to.
 */
import * as THREE from 'three';
import { Color, Vector2, Vector3 } from '../math.js';
import { sharedUniforms, MAX_OMNI } from './lighting.js';

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

const LIGHTING_GLSL = /* glsl */ `
float gd_schlick(float u) { float m = 1.0 - u; float m2 = m * m; return m2 * m2 * m; }
float gd_D_GGX(float cos_theta_m, float alpha) {
	float a = cos_theta_m * alpha;
	float k = alpha / (1.0 - cos_theta_m * cos_theta_m + a * a);
	return k * k * (1.0 / PI);
}
float gd_V_GGX(float NdotL, float NdotV, float alpha) { return 0.5 / mix(2.0 * NdotL * NdotV, NdotL + NdotV, alpha); }

void gd_light(vec3 N, vec3 L, vec3 V, vec3 light_color, float attenuation, vec3 f0, float roughness, float metallic,
		vec3 albedo, vec3 backlight, float rim, float rim_tint, inout vec3 diffuse_light, inout vec3 specular_light) {
	float NdotL = min(dot(N, L), 1.0);
	float cNdotL = max(NdotL, 0.0);
	float NdotV = dot(N, V);
	float cNdotV = max(NdotV, 1e-4);
	vec3 H = normalize(V + L);
	float cNdotH = clamp(dot(N, H), 0.0, 1.0);
	float cLdotH = clamp(dot(L, H), 0.0, 1.0);
	if (metallic < 1.0) {
		float diffuse_brdf_NL;
#ifdef GD_DIFFUSE_LAMBERT
		diffuse_brdf_NL = cNdotL * (1.0 / PI);
#else
		float FD90_minus_1 = 2.0 * cLdotH * cLdotH * roughness - 0.5;
		float FdV = 1.0 + FD90_minus_1 * gd_schlick(cNdotV);
		float FdL = 1.0 + FD90_minus_1 * gd_schlick(cNdotL);
		diffuse_brdf_NL = (1.0 / PI) * FdV * FdL * cNdotL;
#endif
		diffuse_light += light_color * diffuse_brdf_NL * attenuation;
#ifdef GD_BACKLIGHT
		diffuse_light += light_color * (vec3(1.0 / PI) - diffuse_brdf_NL) * backlight * attenuation;
#endif
#ifdef GD_RIM
		float rim_light = pow(max(1e-4, 1.0 - cNdotV), max(0.0, (1.0 - roughness) * 16.0));
		diffuse_light += rim_light * rim * mix(vec3(1.0), albedo, rim_tint) * light_color;
#endif
	}
	if (roughness > 0.0) {
		float alpha_ggx = roughness * roughness;
		float D = gd_D_GGX(cNdotH, alpha_ggx);
		float G = gd_V_GGX(cNdotL, cNdotV, alpha_ggx);
		float f90 = clamp(dot(f0, vec3(50.0 * 0.33)), metallic, 1.0);
		vec3 F = f0 + (f90 - f0) * gd_schlick(cLdotH);
		specular_light += cNdotL * D * F * G * light_color * attenuation;
	}
}

float gd_omni_attenuation(float distance, float inv_range, float decay) {
	float nd = distance * inv_range;
	nd *= nd;
	nd *= nd;
	nd = max(1.0 - nd, 0.0);
	nd *= nd;
	return nd * pow(max(distance, 0.0001), -decay);
}

// Godot 4 fog_process() for exponential depth fog plus height fog; returns (colour, amount).
vec4 gd_fog(vec3 view_pos) {
	if (uFogParams.w < 0.5) return vec4(0.0);
	float fog_amount = 1.0 - exp(min(0.0, -length(view_pos) * uFogParams.x));
	if (abs(uFogParams.z) >= 0.0001) {
		float y = (uInvView * vec4(view_pos, 1.0)).y;
		float y_dist = y - uFogParams.y;
		float vfog_amount = 1.0 - exp(min(0.0, y_dist * uFogParams.z));
		fog_amount = max(vfog_amount, fog_amount);
	}
	return vec4(uFogColor, fog_amount);
}
`;

const SHARED_UNIFORMS_GLSL = /* glsl */ `
uniform float TIME;
uniform vec3 uAmbient;
uniform int uDirCount;
uniform vec3 uDirDir[2];
uniform vec3 uDirColor[2];
uniform float uDirShadow[2];
uniform int uOmniCount;
uniform vec4 uOmniPosRange[${MAX_OMNI}];
uniform vec4 uOmniColorAtt[${MAX_OMNI}];
uniform vec3 uFogColor;
uniform vec4 uFogParams;
uniform mat4 uInvView;
uniform samplerCube uRadiance;
uniform float uRadianceEnergy;
uniform int uUseRadiance;
uniform vec2 uViewport;
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
 * @property {object} [renderMode] unshaded, blend ('mix'|'add'), cull ('back'|'disabled'|'front'),
 *   depthDraw ('opaque'|'never'|'always'), depthTest (bool), shadowsDisabled, fogDisabled,
 *   diffuse ('burley'|'lambert'), backlight, rim, alpha (uses ALPHA → transparent pass), discard
 * @property {Record<string, {type: string, value?: any, source?: boolean}>} [uniforms]
 * @property {string} [varyings] declarations shared by both stages (use `varying`)
 * @property {string} [functions] helpers available to both stages
 * @property {string} [vertex] body of Godot's vertex()
 * @property {string} [fragment] body of Godot's fragment()
 */

const programCache = new Map();

function buildSources(spec, forDepth) {
  const rm = spec.renderMode ?? {};
  const defines = [];
  if (rm.diffuse === 'lambert') defines.push('#define GD_DIFFUSE_LAMBERT');
  if (rm.backlight) defines.push('#define GD_BACKLIGHT');
  if (rm.rim) defines.push('#define GD_RIM');
  if (rm.unshaded) defines.push('#define GD_UNSHADED');
  if (rm.fogDisabled) defines.push('#define GD_FOG_DISABLED');
  if (rm.cull === 'disabled') defines.push('#define GD_DOUBLE_SIDED');
  if (forDepth) defines.push('#define GD_DEPTH_PASS');
  const uniformDecl = Object.entries(spec.uniforms ?? {})
    .map(([name, u]) => `uniform ${u.type} ${name};`)
    .join('\n');
  const common = `${defines.join('\n')}\n${SHARED_UNIFORMS_GLSL}\n${uniformDecl}\n${SMOOTHSTEP_GLSL}\n${spec.varyings ?? ''}\n${portGlsl(spec.functions)}\n`;

  const vertexShader = /* glsl */ `
precision highp float;
precision highp int;
#include <common>
#include <shadowmap_pars_vertex>
${common}
attribute vec4 aColor;
attribute vec2 aUv2;
#ifdef USE_INSTANCING
attribute vec4 aInstanceColor;
#endif
varying vec3 gd_view_pos;
varying vec3 gd_view_normal;
varying vec2 gd_uv;
varying vec2 gd_uv2;
varying vec4 gd_color;
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
	vec4 worldPosition = uInvView * mvPosition;
	vec3 transformedNormal = gd_view_normal;
#ifndef GD_DEPTH_PASS
	#include <shadowmap_vertex>
#endif
}
`;

  const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
${common}
${LIGHTING_GLSL}
uniform bool receiveShadow;
varying vec3 gd_view_pos;
varying vec3 gd_view_normal;
varying vec2 gd_uv;
varying vec2 gd_uv2;
varying vec4 gd_color;
layout(location = 0) out vec4 gd_out_color;
layout(location = 1) out vec4 gd_out_indirect;
void main() {
	vec3 VERTEX = gd_view_pos;
	vec3 NORMAL = normalize(gd_view_normal);
#ifdef GD_DOUBLE_SIDED
	if (!gl_FrontFacing) NORMAL = -NORMAL;
#endif
	vec3 VIEW = normalize(-VERTEX);
	vec2 UV = gd_uv;
	vec2 UV2 = gd_uv2;
	vec4 COLOR = gd_color;
	vec2 SCREEN_UV = gl_FragCoord.xy / uViewport;
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
	{
${portGlsl(spec.fragment)}
	}
#ifdef GD_DEPTH_PASS
	gd_out_color = vec4(1.0);
	gd_out_indirect = vec4(0.0);
	return;
#else
	vec3 albedo = ALBEDO;
	vec3 total;
	vec3 indirect = vec3(0.0);
#ifdef GD_UNSHADED
	total = albedo;
#else
	vec3 N = normalize(NORMAL);
	vec3 V = VIEW;
	float roughness = clamp(ROUGHNESS, 0.0, 1.0);
	float metallic = clamp(METALLIC, 0.0, 1.0);
	float dielectric = 0.16 * SPECULAR * SPECULAR;
	vec3 f0 = mix(vec3(dielectric), albedo, vec3(metallic));
	// Reflections of the sky (REFLECTION_SOURCE_BG), weighted by the env BRDF before direct light.
	vec3 specular_light = vec3(0.0);
	if (uUseRadiance == 1) {
		vec3 ref_vec = reflect(-V, N);
		ref_vec = mix(ref_vec, N, roughness * roughness);
		float horizon = min(1.0 + dot(ref_vec, N), 1.0);
		vec3 world_ref = (uInvView * vec4(ref_vec, 0.0)).xyz;
		specular_light = textureLod(uRadiance, world_ref, sqrt(roughness) * 6.0).rgb * uRadianceEnergy;
		specular_light *= horizon * horizon;
	}
	{
		const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
		const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
		vec4 r = roughness * c0 + c1;
		float ndotv = clamp(dot(N, V), 0.0, 1.0);
		float a004 = min(r.x * r.x, exp2(-9.28 * ndotv)) * r.x + r.y;
		vec2 env = vec2(-1.04, 1.04) * a004 + r.zw;
		specular_light *= env.x * f0 + env.y * clamp(50.0 * f0.g, metallic, 1.0);
	}
	vec3 ambient_light = uAmbient * albedo;
	vec3 diffuse_light = vec3(0.0);
	vec3 direct_specular = vec3(0.0);
	for (int i = 0; i < 2; i++) {
		if (i >= uDirCount) break;
		float shadow = 1.0;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		if (i == 0 && uDirShadow[0] > 0.5 && receiveShadow) {
			DirectionalLightShadow s = directionalLightShadows[0];
			shadow = getShadow(directionalShadowMap[0], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[0]);
		}
#endif
		gd_light(N, uDirDir[i], V, uDirColor[i], shadow, f0, roughness, metallic, albedo, BACKLIGHT, RIM, RIM_TINT, diffuse_light, direct_specular);
	}
	for (int i = 0; i < ${MAX_OMNI}; i++) {
		if (i >= uOmniCount) break;
		vec3 to_light = uOmniPosRange[i].xyz - VERTEX;
		float dist = length(to_light);
		float range = uOmniPosRange[i].w;
		if (dist > range) continue;
		float att = gd_omni_attenuation(dist, 1.0 / max(range, 0.0001), uOmniColorAtt[i].w);
		gd_light(N, to_light / max(dist, 1e-5), V, uOmniColorAtt[i].rgb, att, f0, roughness, metallic, albedo, BACKLIGHT, RIM, RIM_TINT, diffuse_light, direct_specular);
	}
	diffuse_light *= albedo * AO;
	direct_specular *= AO;
	diffuse_light *= 1.0 - metallic;
	ambient_light *= 1.0 - metallic;
	indirect = ambient_light + specular_light;
	total = EMISSION + indirect + diffuse_light + direct_specular;
#endif
	float fog_a = 0.0;
#ifndef GD_FOG_DISABLED
	vec4 fog = gd_fog(VERTEX);
	fog_a = fog.a;
	total = mix(total, fog.rgb, fog.a);
#endif
	gd_out_color = vec4(total, ALPHA);
	gd_out_indirect = vec4(indirect * (1.0 - fog_a), ALPHA);
#endif
}
`;
  return { vertexShader, fragmentShader };
}

function blendingOf(rm) {
  if (rm.blend === 'add') return THREE.AdditiveBlending;
  if (rm.alpha) return THREE.NormalBlending;
  return THREE.NoBlending;
}

export class SpatialMaterial extends THREE.ShaderMaterial {
  /** @param {ShaderSpec} spec */
  constructor(spec, values = {}) {
    const rm = spec.renderMode ?? {};
    const key = `${spec.name}|${JSON.stringify(rm)}`;
    let sources = programCache.get(key);
    if (!sources) {
      sources = buildSources(spec, false);
      programCache.set(key, sources);
    }
    const uniforms = { ...THREE.UniformsLib.lights, ...sharedUniforms };
    for (const [name, u] of Object.entries(spec.uniforms ?? {})) {
      const initial = name in values ? values[name] : u.value !== undefined ? u.value : TYPE_DEFAULTS[u.type];
      uniforms[name] = { value: toUniformValue(u.type, initial, u.source) };
    }
    const transparent = rm.blend === 'add' || Boolean(rm.alpha);
    super({
      name: spec.name,
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: sources.vertexShader,
      fragmentShader: sources.fragmentShader,
      lights: true,
      fog: false,
      transparent,
      blending: blendingOf(rm),
      depthWrite: rm.depthDraw === 'always' || (rm.depthDraw !== 'never' && !transparent),
      depthTest: rm.depthTest !== false,
      side: rm.cull === 'disabled' ? THREE.DoubleSide : rm.cull === 'front' ? THREE.BackSide : THREE.FrontSide,
    });
    this.toneMapped = false;
    // Godot's defaults for missing arrays: COLOR = white, UV/UV2 = 0, instance colour = white.
    this.defaultAttributeValues = { aColor: [1, 1, 1, 1], aUv2: [0, 0], uv: [0, 0], aInstanceColor: [1, 1, 1, 1] };
    this.receivesShadow = !rm.shadowsDisabled;
    this.spec = spec;
    this.specUniforms = spec.uniforms ?? {};
    this.castsShadow = !rm.shadowsDisabled && !rm.unshaded && rm.blend !== 'add';
    this.needsCustomDepth = Boolean(rm.discard || spec.vertex);
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

  /** Depth-only twin for the shadow pass (keeps vertex motion and discards). */
  depthMaterial() {
    if (this._depth) return this._depth;
    const key = `${this.spec.name}|depth`;
    let sources = programCache.get(key);
    if (!sources) {
      sources = buildSources(this.spec, true);
      programCache.set(key, sources);
    }
    this._depth = new THREE.ShaderMaterial({
      name: `${this.spec.name}-depth`,
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: sources.vertexShader,
      fragmentShader: sources.fragmentShader,
      lights: true,
      side: this.side,
    });
    this._depth.defaultAttributeValues = this.defaultAttributeValues;
    return this._depth;
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

export class StandardMaterial3D extends SpatialMaterial {
  /**
   * @param {object} options albedo_color, roughness, metallic, metallic_specular, emission,
   *   emission_energy_multiplier, transparency ('alpha'), blend_mode ('add'), cull_mode ('disabled'),
   *   shading_mode ('unshaded'), vertex_color_use_as_albedo, albedo_texture, disable_fog, rim
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
    super({ name: 'standard', renderMode, ...STANDARD_SPEC_BASE }, {});
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
