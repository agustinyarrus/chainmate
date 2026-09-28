/**
 * Volumetric fog — Godot 4.7's froxel fog (servers/rendering/renderer_rd/environment/fog.cpp and
 * shaders/environment/volumetric_fog_process.glsl) with the project's settings: a volume 64 froxels
 * across on average (81 × 50 for a 16:9 frame) and 64 deep, filtered, reprojected in time.
 *
 *   density     every froxel gathers the light that reaches it (directional lights through the
 *               shadow atlas, omni lights, the sky when the environment injects ambient light),
 *               scattered by the fog, and blends it with what it held the frame before. Each frame
 *               looks through one of 16 jittered points of the froxel: the blend averages them
 *   history     a copy of that, what the next frame reprojects
 *   filter      a 7-tap Gaussian across x, then across y
 *   integrate   front to back along every column: the light scattered toward the camera and the
 *               transmittance left, at each depth
 *
 * The scene shader then reads the volume at (screen uv, depth) and lays it over the pixel.
 *
 * The engine runs these as compute shaders over 3D images. Here every volume is drawn as an ATLAS of
 * its slices (8 tiles per row: one full-screen pass per stage instead of one per slice). The two that
 * are read through a filter — the history and the result — are read like a trilinear 3D texture
 * (glsl.js VOLUME_ATLAS_GLSL), so the numbers are the engine's samplers'. The history is simply the
 * other half of a pair of density atlases, swapped every frame: nothing is copied. Froxel indices and
 * texture coordinates are the engine's numerically. O(froxels) per frame; the integration is
 * O(froxels · depth).
 *
 * Not ported: FogVolume nodes, VoxelGI and SDFGI injection, spot and area lights, and the shadows of
 * omni lights (the game has none of them). The sky injection is ported, though the game keeps
 * `volumetric_fog_ambient_inject` at 0 and so never runs it.
 */
import * as THREE from 'three';
import { fullscreenMaterial } from './fullscreen.js';
import { sharedUniforms, MAX_OMNI, MAX_DIRECTIONAL, SHADOW_CASCADES } from './lighting.js';
import { SMOOTHSTEP_GLSL, OCT_GLSL } from './material.js';
import { FINITE_GLSL, SUBTEXEL_STEPS, VOLUME_ATLAS_COLUMNS, VOLUME_ATLAS_GLSL } from './glsl.js';

/** rendering/environment/volumetric_fog/* (the engine's defaults, which the game ships). */
export const FogSettings = Object.freeze({ volumeSize: 64, volumeDepth: 64, useFilter: true });

/** Fog::VolumetricFog::MAX_TEMPORAL_FRAMES: the jitter repeats after this many frames. */
export const TEMPORAL_FRAMES = 16;
const ATLAS_COLUMNS = VOLUME_ATLAS_COLUMNS;

const f = Math.fround;

/**
 * RenderForwardClustered::_update_volumetric_fog — the volume keeps `volumeSize` froxels across on
 * average, shared out by the aspect of the frame. Single precision and truncation, like the engine.
 */
export function fogVolumeSize(width, height, settings = FogSettings) {
  const ratio = f(width / Math.trunc((width + height) / 2));
  return {
    width: Math.trunc(f(f(settings.volumeSize) * ratio)),
    height: Math.trunc(f(f(settings.volumeSize) / ratio)),
    depth: settings.volumeDepth,
  };
}

const ATLAS_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform ivec3 fog_volume_size;
const int ATLAS_COLUMNS = ${ATLAS_COLUMNS};

// The froxel a texel of the atlas stands for, and back.
ivec3 froxel_at(ivec2 texel) {
	ivec2 tile = texel / fog_volume_size.xy;
	return ivec3(texel - tile * fog_volume_size.xy, tile.y * ATLAS_COLUMNS + tile.x);
}
ivec2 atlas_texel(ivec3 froxel) {
	return froxel.xy + ivec2(froxel.z % ATLAS_COLUMNS, froxel.z / ATLAS_COLUMNS) * fog_volume_size.xy;
}
`;

const DEPTH_AT_GLSL = /* glsl */ `
uniform float fog_frustum_end;
uniform float detail_spread;
float get_depth_at_pos(float cell_depth_size, int z) {
	float d = float(z) * cell_depth_size + cell_depth_size * 0.5; // centre of voxels
	d = pow(d, detail_spread);
	return fog_frustum_end * d;
}
`;

const DENSITY = /* glsl */ `
${ATLAS_GLSL}
${DEPTH_AT_GLSL}
${SMOOTHSTEP_GLSL}
${OCT_GLSL}
${FINITE_GLSL}
${VOLUME_ATLAS_GLSL}
uniform vec2 fog_frustum_size_begin;
uniform vec2 fog_frustum_size_end;
uniform float ambient_inject;
uniform vec3 ambient_color;
uniform float sky_contribution;
uniform vec3 base_emission;
uniform float base_density;
uniform vec3 base_scattering;
uniform float phase_g;
uniform int use_temporal_reprojection;
uniform int temporal_frame;
uniform float temporal_blend;
uniform mat4 to_prev_view;
uniform mat3 radiance_inverse_xform;
uniform sampler2D prev_density_map;
uniform sampler2D shadow_atlas;

uniform int uDirCount;
uniform vec3 uDirDirection[${MAX_DIRECTIONAL}];
uniform vec4 uDirColor[${MAX_DIRECTIONAL}];
uniform vec4 uDirParams[${MAX_DIRECTIONAL}];
uniform mat4 uDirShadowMatrix[${SHADOW_CASCADES}];
uniform vec4 uDirShadowSplits;
uniform vec4 uDirShadowParams;
uniform vec4 uDirShadowZRange;
uniform int uOmniCount;
uniform vec4 uOmniPosition[${MAX_OMNI}];
uniform vec4 uOmniColor[${MAX_OMNI}];
uniform vec2 uOmniParams[${MAX_OMNI}];
uniform sampler2DArray uRadiance;
uniform vec4 uRadianceParams;
// The last roughness layer of the radiance.
#define MAX_SKY_LOD uRadianceParams.w

layout(location = 0) out vec4 out_density;

float get_omni_attenuation(float dist, float inv_range, float decay) {
	float nd = dist * inv_range;
	nd *= nd;
	nd *= nd; // nd^4
	nd = max(1.0 - nd, 0.0);
	nd *= nd; // nd^2
	return nd * pow(max(dist, 0.0001), -decay);
}

float henyey_greenstein(float cos_theta, float g) {
	const float k = 0.0795774715459; // 1 / (4 * PI)
	return k * (1.0 - g * g) / (pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5));
}

vec3 safe_normalize(vec3 v) {
	float length_squared = dot(v, v);
	return (length_squared > 1e-12) ? v * inversesqrt(length_squared) : vec3(0.0);
}

#define TEMPORAL_FRAMES ${TEMPORAL_FRAMES}
const vec3 halton_map[TEMPORAL_FRAMES] = vec3[TEMPORAL_FRAMES](
		vec3(0.5, 0.33333333, 0.2),
		vec3(0.25, 0.66666667, 0.4),
		vec3(0.75, 0.11111111, 0.6),
		vec3(0.125, 0.44444444, 0.8),
		vec3(0.625, 0.77777778, 0.04),
		vec3(0.375, 0.22222222, 0.24),
		vec3(0.875, 0.55555556, 0.44),
		vec3(0.0625, 0.88888889, 0.64),
		vec3(0.5625, 0.03703704, 0.84),
		vec3(0.3125, 0.37037037, 0.08),
		vec3(0.8125, 0.7037037, 0.28),
		vec3(0.1875, 0.14814815, 0.48),
		vec3(0.6875, 0.48148148, 0.68),
		vec3(0.4375, 0.81481481, 0.88),
		vec3(0.9375, 0.25925926, 0.12),
		vec3(0.03125, 0.59259259, 0.32));

// Higher values will make light in volumetric fog fade out sooner when it's occluded by shadow.
const float INV_FOG_FADE = 10.0;

// The engine reads the atlas through a linear sampler WITHOUT comparison, which WebGL does not give
// to depth textures: the four texels, and the weights the hardware would use (it places the sample
// in fixed point).
float atlas_depth(vec2 uv) {
	ivec2 size = textureSize(shadow_atlas, 0);
	vec2 at = floor((uv * vec2(size) - 0.5) * ${SUBTEXEL_STEPS}.0 + 0.5) / ${SUBTEXEL_STEPS}.0;
	vec2 corner = floor(at);
	vec2 weight = at - corner;
	ivec2 first = ivec2(corner);
	ivec2 last = size - 1;
	float d00 = texelFetch(shadow_atlas, clamp(first, ivec2(0), last), 0).r;
	float d10 = texelFetch(shadow_atlas, clamp(first + ivec2(1, 0), ivec2(0), last), 0).r;
	float d01 = texelFetch(shadow_atlas, clamp(first + ivec2(0, 1), ivec2(0), last), 0).r;
	float d11 = texelFetch(shadow_atlas, clamp(first + ivec2(1, 1), ivec2(0), last), 0).r;
	return mix(mix(d00, d10, weight.x), mix(d01, d11, weight.x), weight.y);
}

vec3 view_position(vec3 fog_unit_pos) {
	fog_unit_pos.z = pow(fog_unit_pos.z, detail_spread);
	vec3 view_pos;
	view_pos.xy = (fog_unit_pos.xy * 2.0 - 1.0) * mix(fog_frustum_size_begin, fog_frustum_size_end, vec2(fog_unit_pos.z));
	view_pos.z = -fog_frustum_end * fog_unit_pos.z;
	view_pos.y = -view_pos.y;
	return view_pos;
}

void main() {
	vec3 fog_cell_size = 1.0 / vec3(fog_volume_size);
	ivec3 pos = froxel_at(ivec2(gl_FragCoord.xy));
	if (pos.z >= fog_volume_size.z) {
		out_density = vec4(0.0);
		return;
	}
	vec3 posf = vec3(pos);
	vec3 view_pos = view_position(posf * fog_cell_size + fog_cell_size * 0.5); // centre of voxels

	vec4 reprojected_density = vec4(0.0);
	float reproject_amount = 0.0;

	if (use_temporal_reprojection == 1) {
		vec3 prev_view = (to_prev_view * vec4(view_pos, 1.0)).xyz;
		// undo transform into prev view
		prev_view.y = -prev_view.y;
		// z back to unit size
		prev_view.z /= -fog_frustum_end;
		// xy back to unit size
		prev_view.xy /= mix(fog_frustum_size_begin, fog_frustum_size_end, vec2(prev_view.z));
		prev_view.xy = prev_view.xy * 0.5 + 0.5;
		// z back to unspread value
		prev_view.z = pow(prev_view.z, 1.0 / detail_spread);

		if (all(greaterThan(prev_view, vec3(0.0))) && all(lessThan(prev_view, vec3(1.0)))) {
			// reprojection fits
			reprojected_density = volume_atlas_sample(prev_density_map, vec3(fog_volume_size), prev_view);
			reproject_amount = temporal_blend;
			// Cells that cannot reproject do not jitter.
			view_pos = view_position(posf * fog_cell_size + fog_cell_size * halton_map[temporal_frame]);
		}
	}

	vec3 total_light = vec3(0.0);
	float total_density = max(0.0, base_density);
	vec3 scattering = base_scattering * base_density;
	vec3 emission = base_emission * base_density;

	if (total_density > 0.00005) {
		for (int i = 0; i < ${MAX_DIRECTIONAL}; i++) {
			if (i >= uDirCount) break;
			float volumetric_fog_energy = uDirParams[i].w;
			if (volumetric_fog_energy > 0.001) {
				vec3 shadow_attenuation = vec3(1.0);
				float shadow_opacity = uDirParams[i].y;
				if (shadow_opacity > 0.001) {
					float depth_z = -view_pos.z;
					int cascade = depth_z < uDirShadowSplits.x ? 0 : (depth_z < uDirShadowSplits.y ? 1 : (depth_z < uDirShadowSplits.z ? 2 : 3));
					vec4 pssm_coord = uDirShadowMatrix[cascade] * vec4(view_pos, 1.0);
					pssm_coord /= pssm_coord.w;
					float z_range = uDirShadowZRange[cascade];
					float depth = atlas_depth(pssm_coord.xy);
					// Depth grows away from the light here (the engine's is reversed): the difference changes sign.
					float shadow = exp(min(0.0, (depth - pssm_coord.z)) * z_range * INV_FOG_FADE);
					shadow = mix(shadow, 1.0, gd_smoothstep(uDirShadowParams.y, uDirShadowParams.z, view_pos.z)); // done with negative values for performance
					shadow_attenuation = mix(vec3(1.0 - shadow_opacity), vec3(1.0), shadow);
				}
				total_light += shadow_attenuation * uDirColor[i].rgb * uDirColor[i].a * henyey_greenstein(dot(safe_normalize(view_pos), safe_normalize(uDirDirection[i])), phase_g) * volumetric_fog_energy;
			}
		}

		// Compute light from sky
		if (ambient_inject > 0.0) {
			vec3 isotropic = vec3(0.0);
			vec3 anisotropic = vec3(0.0);
			if (sky_contribution > 0.0) {
				float mip_bias = 2.0 + total_density * (MAX_SKY_LOD - 2.0); // Not physically based, but looks nice
				vec3 scatter_direction = (radiance_inverse_xform * safe_normalize(view_pos)) * sign(phase_g);
				// A compute shader has no derivatives: the base level of the layer nearest to mip_bias.
				isotropic = textureLod(uRadiance, vec3(vec3_to_oct_with_border(vec3(0.0, 1.0, 0.0), uRadianceParams.yz), mip_bias), 0.0).rgb;
				anisotropic = textureLod(uRadiance, vec3(vec3_to_oct_with_border(scatter_direction, uRadianceParams.yz), mip_bias), 0.0).rgb;
			}
			total_light += mix(ambient_color, mix(isotropic, anisotropic, abs(phase_g)), sky_contribution) * ambient_inject;
		}

		// Omni lights: the engine walks each cluster from its last light to its first.
		for (int k = 0; k < ${MAX_OMNI}; k++) {
			int i = uOmniCount - 1 - k;
			if (i < 0) break;
			vec3 light_pos = uOmniPosition[i].xyz;
			float inv_radius = uOmniPosition[i].w;
			float volumetric_fog_energy = uOmniParams[i].y;
			float d = distance(light_pos, view_pos);
			if (volumetric_fog_energy > 0.001 && d * inv_radius < 1.0) {
				float attenuation = get_omni_attenuation(d, inv_radius, uOmniColor[i].a);
				total_light += uOmniColor[i].rgb * attenuation * henyey_greenstein(dot(safe_normalize(light_pos - view_pos), safe_normalize(view_pos)), phase_g) * volumetric_fog_energy;
			}
		}
	}

	vec4 final_density = vec4(total_light * scattering + emission, total_density);
	bool is_reprojected_density_invalid = gd_not_finite(reprojected_density);
	bool is_final_density_invalid = gd_not_finite(final_density);

	if (is_final_density_invalid) {
		final_density = is_reprojected_density_invalid ? vec4(0.0) : reprojected_density;
	} else if (!is_reprojected_density_invalid) {
		final_density = mix(final_density, reprojected_density, reproject_amount);
	}
	out_density = clamp(final_density, vec4(0.0), vec4(65504.0));
}`;

const FILTER = /* glsl */ `
${ATLAS_GLSL}
uniform sampler2D source_map;
uniform int filter_axis;
layout(location = 0) out vec4 out_value;
void main() {
	ivec3 pos = froxel_at(ivec2(gl_FragCoord.xy));
	if (pos.z >= fog_volume_size.z) {
		out_value = vec4(0.0);
		return;
	}
	const float gauss[7] = float[7](0.071303, 0.131514, 0.189879, 0.214607, 0.189879, 0.131514, 0.071303);
	const ivec3 filter_dir[3] = ivec3[3](ivec3(1, 0, 0), ivec3(0, 1, 0), ivec3(0, 0, 1));
	ivec3 offset = filter_dir[filter_axis];
	vec4 accum = vec4(0.0);
	for (int i = -3; i <= 3; i++) {
		accum += texelFetch(source_map, atlas_texel(clamp(pos + offset * i, ivec3(0), fog_volume_size - ivec3(1))), 0) * gauss[i + 3];
	}
	out_value = accum;
}`;

/** MODE_FOG. The engine walks a column once and stores every step; a texel walks up to its own depth. */
const INTEGRATE = /* glsl */ `
${ATLAS_GLSL}
${DEPTH_AT_GLSL}
${FINITE_GLSL}
uniform sampler2D density_map;
layout(location = 0) out vec4 out_fog;
void main() {
	ivec3 pos = froxel_at(ivec2(gl_FragCoord.xy));
	if (pos.z >= fog_volume_size.z) {
		out_fog = vec4(0.0);
		return;
	}
	float cell_depth_size = 1.0 / float(fog_volume_size.z);
	vec4 fog_accum = vec4(0.0, 0.0, 0.0, 1.0);
	float prev_z = 0.0;
	for (int i = 0; i <= pos.z; i++) {
		vec4 fog = texelFetch(density_map, atlas_texel(ivec3(pos.xy, i)), 0);
		// get depth at cell pos
		float z = get_depth_at_pos(cell_depth_size, i);
		// get distance from previous pos
		float d = abs(prev_z - z);
		// compute transmittance using beer's law
		float transmittance = exp(-d * fog.a);
		fog_accum.rgb += ((fog.rgb - fog.rgb * transmittance) / max(fog.a, 0.00001)) * fog_accum.a;
		fog_accum.a *= transmittance;
		prev_z = z;
	}
	bool is_final_fog_invalid = gd_not_finite(fog_accum);
	vec4 final_fog = is_final_fog_invalid ? vec4(0.0) : fog_accum;
	out_fog = clamp(final_fog, vec4(0.0), vec4(65504.0));
}`;

/**
 * An RGBA16F atlas of a volume's slices. `filtered`: it is also read between texels (the history and
 * the result, through VOLUME_ATLAS_GLSL); the other stages read texels one by one.
 */
const atlasTarget = (width, height, filtered) =>
  new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: filtered ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: filtered ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });

/**
 * Fog::volumetric_fog_update — half the size of the volume's near and far faces. The volume starts
 * at the camera with the size of the near plane and ends `length` away.
 * @param {THREE.Matrix4} projection the camera's projection
 * @param {number} length Environment.volumetric_fog_length
 */
export function fogFrustum(projection, length) {
  const extents = frustumExtents(projection);
  const along = f(f(f(length) - extents.zNear) / f(extents.zFar - extents.zNear));
  const lerp = (from, to) => f(from + f(f(to - from) * along));
  return {
    begin: { x: Math.max(extents.near.x, 0.001), y: Math.max(extents.near.y, 0.001) },
    end: { x: lerp(extents.near.x, extents.far.x), y: lerp(extents.near.y, extents.far.y) },
  };
}

const tmpInverse = new THREE.Matrix4();

/**
 * Projection::get_z_near / get_z_far / get_viewport_half_extents / get_far_plane_half_extents, in
 * single precision like the engine's.
 * @param {THREE.Matrix4} projection a symmetrical projection across the z axis
 */
export function frustumExtents(projection) {
  const e = projection.elements;
  const column = (c, r) => f(e[c * 4 + r]);
  const zNear = f(f(column(3, 3) + column(3, 2)) / f(column(2, 3) + column(2, 2)));
  const zFar = f(f(column(3, 3) - column(3, 2)) / f(column(2, 3) - column(2, 2)));
  const halfExtents = (z) => {
    const w = f(f(-z * column(2, 3)) + column(3, 3));
    return { x: f(w / column(0, 0)), y: f(w / column(1, 1)) };
  };
  return { zNear, zFar, near: halfExtents(zNear), far: halfExtents(zFar) };
}

export class VolumetricFog {
  /** @param {import('./pipeline.js').RenderPipeline} pipeline */
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.renderer = pipeline.renderer;
    this.quad = pipeline.quad;
    this.settings = FogSettings;
    this.size = null;
    this.targets = null;
    /** Which of the two density atlases this frame gathers into; the other holds the history. */
    this.current = 0;
    /** Whether the volume exists: the engine frees it when the environment turns the fog off. */
    this.alive = false;
    /** The camera of the frame before (world transform), whatever the fog was doing then. */
    this.previousCamera = new THREE.Matrix4();
    this.hasPreviousCamera = false;

    const volume = { fog_volume_size: { value: new THREE.Vector3() } };
    const depthAt = { fog_frustum_end: { value: 1 }, detail_spread: { value: 1 } };
    const shared = sharedUniforms;
    this.density = fullscreenMaterial(DENSITY, {
        ...volume,
        ...depthAt,
        fog_frustum_size_begin: { value: new THREE.Vector2() },
        fog_frustum_size_end: { value: new THREE.Vector2() },
        ambient_inject: { value: 0 },
        ambient_color: { value: new THREE.Vector3() },
        sky_contribution: { value: 0 },
        base_emission: { value: new THREE.Vector3() },
        base_density: { value: 0 },
        base_scattering: { value: new THREE.Vector3() },
        phase_g: { value: 0 },
        use_temporal_reprojection: { value: 0 },
        temporal_frame: { value: 0 },
        temporal_blend: { value: 0 },
        to_prev_view: { value: new THREE.Matrix4() },
        radiance_inverse_xform: { value: new THREE.Matrix3() },
        prev_density_map: { value: null },
        shadow_atlas: { value: null },
        uDirCount: shared.uDirCount,
        uDirDirection: shared.uDirDirection,
        uDirColor: shared.uDirColor,
        uDirParams: shared.uDirParams,
        uDirShadowMatrix: shared.uDirShadowMatrix,
        uDirShadowSplits: shared.uDirShadowSplits,
        uDirShadowParams: shared.uDirShadowParams,
        uDirShadowZRange: shared.uDirShadowZRange,
        uOmniCount: shared.uOmniCount,
        uOmniPosition: shared.uOmniPosition,
        uOmniColor: shared.uOmniColor,
        uOmniParams: shared.uOmniParams,
        uRadiance: shared.uRadiance,
        uRadianceParams: shared.uRadianceParams,
    });
    this.filter = fullscreenMaterial(FILTER, { ...volume, source_map: { value: null }, filter_axis: { value: 0 } });
    this.integrate = fullscreenMaterial(INTEGRATE, { ...volume, ...depthAt, density_map: { value: null } });
    pipeline.volumetricFog = this;
    if (pipeline.width > 0) this.resize(pipeline.width, pipeline.height);
  }

  resize(width, height) {
    const size = fogVolumeSize(width, height, this.settings);
    if (this.size && size.width === this.size.width && size.height === this.size.height && size.depth === this.size.depth) return;
    this._free();
    this.size = size;
    const rows = Math.ceil(size.depth / ATLAS_COLUMNS);
    const atlas = (filtered) => atlasTarget(size.width * ATLAS_COLUMNS, size.height * rows, filtered);
    // density: this frame's gather and the last one's (the history), swapped every frame.
    this.targets = { density: [atlas(true), atlas(true)], scratch: atlas(false), filtered: atlas(false), fog: atlas(true) };
    for (const material of [this.density, this.filter, this.integrate]) material.uniforms.fog_volume_size.value.set(size.width, size.height, size.depth);
    this.alive = false;
  }

  _free() {
    if (!this.targets) return;
    for (const target of Object.values(this.targets).flat()) target.dispose();
    this.targets = null;
  }

  dispose() {
    this._free();
    this.density.dispose();
    this.filter.dispose();
    this.integrate.dispose();
  }

  /**
   * Once per frame, after the shadows are drawn and before the scene is.
   * @param {THREE.PerspectiveCamera} camera the scene camera (matrixWorld current)
   * @param {object} environment the Godot Environment
   * @param {import('./shadows.js').DirectionalShadowAtlas} shadows
   * @param {number} frameNumber the renderer's frame number (the jitter follows it)
   */
  update(camera, environment, shadows, frameNumber) {
    const enabled = Boolean(environment?.volumetric_fog_enabled) && this.targets !== null;
    if (!enabled) {
      this.alive = false;
      sharedUniforms.uVolumetricFogParams.value.x = 0;
    } else {
      if (!this.alive) this._create();
      this._fill(camera, environment, frameNumber);
      this._render(environment, shadows);
      const length = environment.volumetric_fog_length;
      const spread = environment.volumetric_fog_detail_spread;
      sharedUniforms.uVolumetricFog.value = this.targets.fog.texture;
      sharedUniforms.uVolumetricFogSize.value.set(this.size.width, this.size.height, this.size.depth);
      sharedUniforms.uVolumetricFogParams.value.set(1, length > 0 ? 1 / length : 1, spread > 0 ? 1 / spread : 1);
    }
    this.previousCamera.copy(camera.matrixWorld);
    this.hasPreviousCamera = true;
  }

  /** Fog::VolumetricFog::init — a new volume remembers nothing. */
  _create() {
    const renderer = this.renderer;
    renderer.setClearColor(0x000000, 0);
    for (const target of this.targets.density) {
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
    }
    this.alive = true;
  }

  /** Fog::volumetric_fog_update — the parameters of the frame. */
  _fill(camera, environment, frameNumber) {
    const u = this.density.uniforms;
    const fogEnd = f(environment.volumetric_fog_length);
    const frustum = fogFrustum(camera.projectionMatrix, fogEnd);
    u.fog_frustum_size_begin.value.set(frustum.begin.x, frustum.begin.y);
    u.fog_frustum_size_end.value.set(frustum.end.x, frustum.end.y);
    u.fog_frustum_end.value = fogEnd;
    u.detail_spread.value = environment.volumetric_fog_detail_spread;
    u.ambient_inject.value = environment.volumetric_fog_ambient_inject * environment.ambient_light_energy;
    const ambient = environment.ambient_light_color.srgb_to_linear();
    u.ambient_color.value.set(ambient.r, ambient.g, ambient.b);
    u.sky_contribution.value = environment.ambient_light_sky_contribution;
    const emission = environment.volumetric_fog_emission.srgb_to_linear();
    const energy = environment.volumetric_fog_emission_energy;
    u.base_emission.value.set(emission.r * energy, emission.g * energy, emission.b * energy);
    u.base_density.value = environment.volumetric_fog_density;
    const scattering = environment.volumetric_fog_albedo.srgb_to_linear();
    u.base_scattering.value.set(scattering.r, scattering.g, scattering.b);
    u.phase_g.value = environment.volumetric_fog_anisotropy;
    u.use_temporal_reprojection.value = environment.volumetric_fog_temporal_reprojection_enabled ? 1 : 0;
    u.temporal_frame.value = ((frameNumber % TEMPORAL_FRAMES) + TEMPORAL_FRAMES) % TEMPORAL_FRAMES;
    u.temporal_blend.value = environment.volumetric_fog_temporal_reprojection_amount;
    // The sky is not rotated: view space → world space is the camera's basis.
    u.radiance_inverse_xform.value.setFromMatrix4(camera.matrixWorld);
    const previous = this.hasPreviousCamera ? this.previousCamera : camera.matrixWorld;
    u.to_prev_view.value.copy(tmpInverse.copy(previous).invert()).multiply(camera.matrixWorld);

    const integrate = this.integrate.uniforms;
    integrate.fog_frustum_end.value = fogEnd;
    integrate.detail_spread.value = environment.volumetric_fog_detail_spread;
  }

  /**
   * The four stages, one draw each. The gather writes this frame's density atlas and reads the other
   * one as its history (the blend as it was gathered, before the filter — which is why the filter
   * writes elsewhere); then the two atlases swap roles for the next frame.
   */
  _render(environment, shadows) {
    const t = this.targets;
    const quad = this.quad;
    const profiler = this.pipeline.profiler;
    const gathered = t.density[this.current];
    const density = this.density.uniforms;
    density.prev_density_map.value = t.density[1 - this.current].texture;
    density.shadow_atlas.value = shadows.texture;
    profiler?.section('fog density');
    shadows.withDepthValues(this.renderer, () => quad.draw(this.density, gathered));
    density.shadow_atlas.value = null;
    density.prev_density_map.value = null;

    let source = gathered;
    if (this.settings.useFilter) {
      profiler?.section('fog filter');
      const filter = this.filter.uniforms;
      filter.filter_axis.value = 0;
      filter.source_map.value = gathered.texture;
      quad.draw(this.filter, t.scratch);
      filter.filter_axis.value = 1;
      filter.source_map.value = t.scratch.texture;
      quad.draw(this.filter, t.filtered);
      filter.source_map.value = null;
      source = t.filtered;
    }

    profiler?.section('fog integrate');
    this.integrate.uniforms.density_map.value = source.texture;
    quad.draw(this.integrate, t.fog);
    this.integrate.uniforms.density_map.value = null;
    this.current = 1 - this.current;
  }
}
