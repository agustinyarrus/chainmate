/**
 * Screen-space effects — Godot 4.7's SSAO and SSIL (servers/rendering/renderer_rd/effects/
 * ss_effects.cpp and its shaders, Intel's ASSAO adapted by the engine), with the project's settings:
 * quality Medium, half size, 2 blur passes for SSAO and 4 for SSIL, fade-out from 50 to 300.
 *
 *   downsample   the prepass depth, de-interleaved: four slices a quarter of the screen wide, each
 *                holding one pixel out of every 4×4 block (R16F, like the engine's)
 *   gather       per slice: 5 taps (10 depth samples) on a rotated disk, haloing reduction, detail
 *                from the four neighbours, depth edges packed beside the result
 *   blur         edge-aware, ping-pong between two slice sets
 *   interleave   back to the full size, each pixel from its own slice and its three neighbours'
 *
 * SSIL gathers the colour of the PREVIOUS frame (mip 5 of a copy kept after every frame) where SSAO
 * gathers occlusion, reprojected through the camera's change of orientation.
 *
 * The engine runs these as compute shaders; here each is a full-screen pass per slice. Every buffer
 * keeps the engine's rows (first row at the top), so pixel indices — and with them the per-pixel
 * rotations and the slice a pixel belongs to — are the engine's. O(pixels) per frame.
 *
 * Not ported: the High and Ultra qualities (depth mips, normal edges, adaptive sampling), which the
 * game does not use.
 */
import * as THREE from 'three';
import { fullscreenMaterial, hdrTarget, withMipChain } from './fullscreen.js';
import { sharedUniforms } from './lighting.js';
import { FINITE_GLSL } from './glsl.js';

/** rendering/environment/ssao/* and ssil/* (the engine's defaults, which the game ships). */
export const SsaoSettings = Object.freeze({ quality: 2, halfSize: true, blurPasses: 2, fadeoutFrom: 50, fadeoutTo: 300 });
export const SsilSettings = Object.freeze({ quality: 2, halfSize: true, blurPasses: 4, fadeoutFrom: 50, fadeoutTo: 300 });

const SLICES = 4;
/** Mips of the last frame's copy; SSIL reads the last one. */
const LAST_FRAME_MIPS = 6;
const SHADOW_CLAMP = 0.98;
/** Rotations per slice (SSEffects' gather constants). */
const SUB_PASSES = 5;

/** SSEffects::SSEffects — the rotation and scale of the sampling disk, per slice and sub-pass. */
function rotationMatrices() {
  const SUB_PASS_MAP = [0, 1, 4, 3, 2];
  const f = Math.fround;
  const out = [];
  for (let pass = 0; pass < SLICES; pass++) {
    for (let sub = 0; sub < SUB_PASSES; sub++) {
      const b = SUB_PASS_MAP[sub];
      const angle = f(f(f(pass + f(b / SUB_PASSES)) * f(Math.PI)) * 0.5);
      const ca = f(Math.cos(angle));
      const sa = f(Math.sin(angle));
      const scale = f(1.0 + f(f(pass - 1.5 + f(f(b - (SUB_PASSES - 1.0) * 0.5) / SUB_PASSES)) * 0.07));
      out.push(new THREE.Vector4(f(scale * ca), f(scale * -sa), f(-scale * sa), f(-scale * ca)));
    }
  }
  return out;
}

const HEADER = /* glsl */ `
precision highp sampler2DArray;
`;

/** The engine's mirror sampler (nearest, mirrored repeat) on texelFetch. */
const SLICE_FETCH = /* glsl */ `
int mirror_coord(int p, int size) {
	if (p < 0) p = -1 - p;
	if (p >= size) p = 2 * size - 1 - p;
	return p;
}
ivec2 mirror_texel(ivec2 p, ivec2 size) {
	return ivec2(mirror_coord(p.x, size.x), mirror_coord(p.y, size.y));
}
`;

const SAMPLE_PATTERN = /* glsl */ `
const vec4 sample_pattern[32] = vec4[32](
	vec4(0.78488064, 0.56661671, 1.500000, -0.126083), vec4(0.26022232, -0.29575172, 1.500000, -1.064030), vec4(0.10459357, 0.08372527, 1.110000, -2.730563), vec4(-0.68286800, 0.04963045, 1.090000, -0.498827),
	vec4(-0.13570161, -0.64190155, 1.250000, -0.532765), vec4(-0.26193795, -0.08205118, 0.670000, -1.783245), vec4(-0.61177456, 0.66664219, 0.710000, -0.044234), vec4(0.43675563, 0.25119025, 0.610000, -1.167283),
	vec4(0.07884444, 0.86618668, 0.640000, -0.459002), vec4(-0.12790935, -0.29869005, 0.600000, -1.729424), vec4(-0.04031125, 0.02413622, 0.600000, -4.792042), vec4(0.16201244, -0.52851415, 0.790000, -1.067055),
	vec4(-0.70991218, 0.47301072, 0.640000, -0.335236), vec4(0.03277707, -0.22349690, 0.600000, -1.982384), vec4(0.68921727, 0.36800742, 0.630000, -0.266718), vec4(0.29251814, 0.37775412, 0.610000, -1.422520),
	vec4(-0.12224089, 0.96582592, 0.600000, -0.426142), vec4(0.11071457, -0.16131058, 0.600000, -2.165947), vec4(0.46562141, -0.59747696, 0.600000, -0.189760), vec4(-0.51548797, 0.11804193, 0.600000, -1.246800),
	vec4(0.89141309, -0.42090443, 0.600000, 0.028192), vec4(-0.32402530, -0.01591529, 0.600000, -1.543018), vec4(0.60771245, 0.41635221, 0.600000, -0.605411), vec4(0.02379565, -0.08239821, 0.600000, -3.809046),
	vec4(0.48951152, -0.23657045, 0.600000, -1.189011), vec4(-0.17611565, -0.81696892, 0.600000, -0.513724), vec4(-0.33930185, -0.20732205, 0.600000, -1.698047), vec4(-0.91974425, 0.05403209, 0.600000, 0.062246),
	vec4(-0.15064627, -0.14949332, 0.600000, -1.896062), vec4(0.53180975, -0.35210401, 0.600000, -0.758838), vec4(0.41487166, 0.81442589, 0.600000, -0.505648), vec4(-0.24106961, -0.32721516, 0.600000, -1.665244));
// Each tap takes two symmetrical depth samples.
const int num_taps[3] = int[3](3, 5, 12);
`;

/** What SSAO and SSIL share: the view-space reconstruction, the radius, the edges, the normals. */
const GATHER_COMMON = /* glsl */ `
uniform sampler2DArray source_depth;
uniform sampler2D source_normal;
uniform vec4 rotation_matrices[${SLICES * SUB_PASSES}];
uniform ivec2 screen_size;
uniform int pass;
uniform int quality;
uniform vec2 half_screen_pixel_size;
uniform vec2 half_screen_pixel_size_x025;
uniform int size_multiplier;
uniform vec2 NDC_to_view_mul;
uniform vec2 NDC_to_view_add;
uniform float radius;
uniform float intensity;
uniform float fade_out_mul;
uniform float fade_out_add;
uniform float inv_radius_near_limit;
uniform float neg_inv_radius;
uniform ivec2 pass_coord_offset;
${SLICE_FETCH}
${SAMPLE_PATTERN}

// The mirror sampler is a nearest one: a tap reads the texel its uv falls in.
float depth_at(vec2 uv) {
	ivec2 size = textureSize(source_depth, 0).xy;
	return texelFetch(source_depth, ivec3(mirror_texel(ivec2(floor(uv * vec2(size))), size), pass), 0).x;
}
float depth_texel(ivec2 p) {
	ivec2 size = textureSize(source_depth, 0).xy;
	return texelFetch(source_depth, ivec3(mirror_texel(p, size), pass), 0).x;
}

// Two bits per edge: four gradient values for smoother transitions.
float pack_edges(vec4 p_edgesLRTB) {
	p_edgesLRTB = round(clamp(p_edgesLRTB, 0.0, 1.0) * 3.05);
	return dot(p_edgesLRTB, vec4(64.0 / 255.0, 16.0 / 255.0, 4.0 / 255.0, 1.0 / 255.0));
}

vec3 NDC_to_view_space(vec2 p_pos, float p_viewspace_depth) {
	return vec3((NDC_to_view_mul * p_pos.xy + NDC_to_view_add) * p_viewspace_depth, p_viewspace_depth);
}

// The effect radius, and the screen sampling pattern fitted inside it.
void calculate_radius_parameters(const float p_pix_center_length, const vec2 p_pixel_size_at_center, out float r_lookup_radius, out float r_radius, out float r_fallof_sq) {
	r_radius = radius;
	// Too close, the sampling disk would grow beyond the screen.
	float too_close_limit = clamp(p_pix_center_length * inv_radius_near_limit, 0.0, 1.0) * 0.8 + 0.2;
	r_radius *= too_close_limit;
	// 0.85 lets more samples on a slope stay within influence.
	r_lookup_radius = (0.85 * r_radius) / p_pixel_size_at_center.x;
	r_fallof_sq = -1.0 / (r_radius * r_radius);
}

// Slope-sensitive depth-based edge detection.
vec4 calculate_edges(const float p_center_z, const float p_left_z, const float p_right_z, const float p_top_z, const float p_bottom_z) {
	vec4 edgesLRTB = vec4(p_left_z, p_right_z, p_top_z, p_bottom_z) - p_center_z;
	vec4 edgesLRTB_slope_adjusted = edgesLRTB + edgesLRTB.yxwz;
	edgesLRTB = min(abs(edgesLRTB), abs(edgesLRTB_slope_adjusted));
	return clamp((1.3 - edgesLRTB / (p_center_z * 0.040)), 0.0, 1.0);
}

// imageLoad: outside the image the engine reads zeros.
vec3 load_normal(ivec2 p_pos) {
	vec3 stored = vec3(0.0);
	if (all(greaterThanEqual(p_pos, ivec2(0))) && all(lessThan(p_pos, screen_size))) stored = texelFetch(source_normal, p_pos, 0).xyz;
	vec3 encoded_normal = normalize(stored * 2.0 - 1.0);
	encoded_normal.z = -encoded_normal.z;
	return encoded_normal;
}
`;

const DOWNSAMPLE = /* glsl */ `
${HEADER}
uniform sampler2D source_depth;
uniform ivec2 slice_offset;
uniform int block;
uniform float z_far;
layout(location = 0) out vec4 out_depth;
void main() {
	// The prepass stores the view depth itself; where nothing was drawn the engine's depth is the far plane.
	float depth = texelFetch(source_depth, block * ivec2(gl_FragCoord.xy) + slice_offset, 0).x;
	out_depth = vec4(depth > 0.0 ? depth : z_far);
}`;

const SSAO_GATHER = /* glsl */ `
${HEADER}
${GATHER_COMMON}
uniform float detail_intensity;
uniform float shadow_power;
uniform float shadow_clamp;
uniform float horizon_angle_threshold;
layout(location = 0) out vec4 out_ssao;

#define SSAO_HALOING_REDUCTION_ENABLE_AT_QUALITY_PRESET 1
#define SSAO_HALOING_REDUCTION_AMOUNT 0.6
#define SSAO_DETAIL_AO_ENABLE_AT_QUALITY_PRESET 1
#define SSAO_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET 1
#define SSAO_REDUCE_RADIUS_NEAR_SCREEN_BORDER_ENABLE_AT_QUALITY_PRESET 1

// All vectors in view space.
float calculate_pixel_obscurance(vec3 p_pixel_normal, vec3 p_hit_delta, float p_fallof_sq) {
	float length_sq = dot(p_hit_delta, p_hit_delta);
	float NdotD = dot(p_pixel_normal, p_hit_delta) / sqrt(length_sq);
	float falloff_mult = max(0.0, length_sq * p_fallof_sq + 1.0);
	return max(0.0, NdotD - horizon_angle_threshold) * falloff_mult;
}

void SSAO_tap_inner(inout float r_obscurance_sum, inout float r_weight_sum, const vec2 p_sampling_uv, const vec3 p_pix_center_pos, vec3 p_pixel_normal, const float p_fallof_sq, const float p_weight_mod) {
	float viewspace_sample_z = depth_at(p_sampling_uv);
	vec3 hit_pos = NDC_to_view_space(p_sampling_uv.xy, viewspace_sample_z).xyz;
	vec3 hit_delta = hit_pos - p_pix_center_pos;
	float obscurance = calculate_pixel_obscurance(p_pixel_normal, hit_delta, p_fallof_sq);
	float weight = 1.0;
	if (quality >= SSAO_HALOING_REDUCTION_ENABLE_AT_QUALITY_PRESET) {
		float reduce = max(0.0, -hit_delta.z);
		reduce = clamp(reduce * neg_inv_radius + 2.0, 0.0, 1.0);
		weight = SSAO_HALOING_REDUCTION_AMOUNT * reduce + (1.0 - SSAO_HALOING_REDUCTION_AMOUNT);
	}
	weight *= p_weight_mod;
	r_obscurance_sum += obscurance * weight;
	r_weight_sum += weight;
}

void SSAOTap(inout float r_obscurance_sum, inout float r_weight_sum, const int p_tap_index, const mat2 p_rot_scale, const vec3 p_pix_center_pos, vec3 p_pixel_normal, const vec2 p_normalized_screen_pos, const float p_fallof_sq) {
	vec4 new_sample = sample_pattern[p_tap_index];
	vec2 sample_offset = new_sample.xy * p_rot_scale;
	float weight_mod = new_sample.z;
	// Snap to pixel centre (more correct obscurance math, avoids artifacts).
	sample_offset = round(sample_offset);
	vec2 sampling_uv = sample_offset * half_screen_pixel_size + p_normalized_screen_pos;
	SSAO_tap_inner(r_obscurance_sum, r_weight_sum, sampling_uv, p_pix_center_pos, p_pixel_normal, p_fallof_sq, weight_mod);
	// The second sample is the mirrored offset.
	vec2 sampling_mirrored_uv = -sample_offset * half_screen_pixel_size + p_normalized_screen_pos;
	SSAO_tap_inner(r_obscurance_sum, r_weight_sum, sampling_mirrored_uv, p_pix_center_pos, p_pixel_normal, p_fallof_sq, weight_mod);
}

void main() {
	vec2 pos_rounded = trunc(gl_FragCoord.xy);
	ivec2 upos = ivec2(pos_rounded);
	int number_of_taps = num_taps[quality];

	// This pixel's view-space depth and its four neighbours' (edge detection).
	float pix_z = depth_texel(upos);
	float pix_left_z = depth_texel(upos + ivec2(-1, 0));
	float pix_top_z = depth_texel(upos + ivec2(0, -1));
	float pix_right_z = depth_texel(upos + ivec2(1, 0));
	float pix_bottom_z = depth_texel(upos + ivec2(0, 1));

	vec2 normalized_screen_pos = pos_rounded * half_screen_pixel_size + half_screen_pixel_size_x025;
	vec3 pix_center_pos = NDC_to_view_space(normalized_screen_pos, pix_z);

	ivec2 full_res_coord = upos * 2 * size_multiplier + pass_coord_offset;
	vec3 pixel_normal = load_normal(full_res_coord);

	vec2 pixel_size_at_center = NDC_to_view_space(normalized_screen_pos.xy + half_screen_pixel_size, pix_center_pos.z).xy - pix_center_pos.xy;

	float pixel_lookup_radius;
	float fallof_sq;
	float viewspace_radius;
	calculate_radius_parameters(length(pix_center_pos), pixel_size_at_center, pixel_lookup_radius, viewspace_radius, fallof_sq);

	// Reduce the radius near the screen edges slightly.
	if (quality >= SSAO_REDUCE_RADIUS_NEAR_SCREEN_BORDER_ENABLE_AT_QUALITY_PRESET) {
		float near_screen_border = min(min(normalized_screen_pos.x, 1.0 - normalized_screen_pos.x), min(normalized_screen_pos.y, 1.0 - normalized_screen_pos.y));
		near_screen_border = clamp(10.0 * near_screen_border + 0.6, 0.0, 1.0);
		pixel_lookup_radius *= near_screen_border;
	}

	// The pseudo-random rotation of this pixel.
	uint pseudo_random_index = uint(pos_rounded.y * 2.0 + pos_rounded.x) % 5u;
	vec4 rotation_scale = rotation_matrices[pass * 5 + int(pseudo_random_index)];
	mat2 rot_scale_matrix = mat2(rotation_scale.x * pixel_lookup_radius, rotation_scale.y * pixel_lookup_radius, rotation_scale.z * pixel_lookup_radius, rotation_scale.w * pixel_lookup_radius);

	float obscurance_sum = 0.0;
	float weight_sum = 0.0;
	// 1 is no edge, 0 is edge.
	vec4 edgesLRTB = vec4(1.0, 1.0, 1.0, 1.0);

	// Move the centre pixel slightly towards the camera: the depth buffer has 16 bits.
	pix_center_pos *= 0.99;

	if (quality >= SSAO_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET) {
		edgesLRTB = calculate_edges(pix_z, pix_left_z, pix_right_z, pix_top_z, pix_bottom_z);
	}

	// A sharper, higher definition effect from the neighbours already read for the edges.
	if (quality >= SSAO_DETAIL_AO_ENABLE_AT_QUALITY_PRESET) {
		vec3 normalized_viewspace_dir = vec3(pix_center_pos.xy / pix_center_pos.zz, 1.0);
		vec3 pixel_left_delta = vec3(-pixel_size_at_center.x, 0.0, 0.0) + normalized_viewspace_dir * (pix_left_z - pix_center_pos.z);
		vec3 pixel_right_delta = vec3(+pixel_size_at_center.x, 0.0, 0.0) + normalized_viewspace_dir * (pix_right_z - pix_center_pos.z);
		vec3 pixel_top_delta = vec3(0.0, -pixel_size_at_center.y, 0.0) + normalized_viewspace_dir * (pix_top_z - pix_center_pos.z);
		vec3 pixel_bottom_delta = vec3(0.0, +pixel_size_at_center.y, 0.0) + normalized_viewspace_dir * (pix_bottom_z - pix_center_pos.z);
		const float range_reduction = 4.0;
		float modified_fallof_sq = range_reduction * fallof_sq;
		vec4 additional_obscurance;
		additional_obscurance.x = calculate_pixel_obscurance(pixel_normal, pixel_left_delta, modified_fallof_sq);
		additional_obscurance.y = calculate_pixel_obscurance(pixel_normal, pixel_right_delta, modified_fallof_sq);
		additional_obscurance.z = calculate_pixel_obscurance(pixel_normal, pixel_top_delta, modified_fallof_sq);
		additional_obscurance.w = calculate_pixel_obscurance(pixel_normal, pixel_bottom_delta, modified_fallof_sq);
		obscurance_sum += detail_intensity * dot(additional_obscurance, edgesLRTB);
	}

	for (int i = 0; i < number_of_taps; i++) {
		SSAOTap(obscurance_sum, weight_sum, i, rot_scale_matrix, pix_center_pos, pixel_normal, normalized_screen_pos, fallof_sq);
	}

	float obscurance = obscurance_sum / weight_sum;
	// Fade-out (1 close, gradient, 0 far).
	float fade_out = clamp(pix_center_pos.z * fade_out_mul + fade_out_add, 0.0, 1.0);
	if (quality >= SSAO_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET) {
		// With more than 2 opposite edges the occlusion fades out: less aliasing.
		float edge_fadeout_factor = clamp((1.0 - edgesLRTB.x - edgesLRTB.y) * 0.35, 0.0, 1.0) + clamp((1.0 - edgesLRTB.z - edgesLRTB.w) * 0.35, 0.0, 1.0);
		fade_out *= clamp(1.0 - edge_fadeout_factor, 0.0, 1.0);
	}
	obscurance = intensity * obscurance;
	obscurance = min(obscurance, shadow_clamp);
	obscurance *= fade_out;
	// Occlusion as visibility: 1 is fully lit.
	float occlusion = 1.0 - obscurance;
	occlusion = pow(clamp(occlusion, 0.0, 1.0), shadow_power);
	if (quality == 0) {
		edgesLRTB = vec4(1.0);
	}
	out_ssao = vec4(occlusion, pack_edges(edgesLRTB), 0.0, 0.0);
}`;

const UNPACK_EDGES = /* glsl */ `
vec4 unpack_edges(float p_packed_val, float p_sharpness) {
	uint packed_val = uint(p_packed_val * 255.5);
	vec4 edgesLRTB;
	edgesLRTB.x = float((packed_val >> 6) & 0x03u) / 3.0;
	edgesLRTB.y = float((packed_val >> 4) & 0x03u) / 3.0;
	edgesLRTB.z = float((packed_val >> 2) & 0x03u) / 3.0;
	edgesLRTB.w = float((packed_val >> 0) & 0x03u) / 3.0;
	return clamp(edgesLRTB + p_sharpness, 0.0, 1.0);
}
`;

const SSAO_BLUR = /* glsl */ `
${HEADER}
uniform sampler2DArray source_ssao;
uniform int slice;
uniform float edge_sharpness;
uniform int wide;
layout(location = 0) out vec4 out_ssao;
${SLICE_FETCH}
${UNPACK_EDGES}
vec2 fetch(ivec2 p) {
	ivec2 size = textureSize(source_ssao, 0).xy;
	return texelFetch(source_ssao, ivec3(mirror_texel(p, size), slice), 0).xy;
}
void add_sample(float p_ssao_value, float p_edge_value, inout float r_sum, inout float r_sum_weight) {
	r_sum += p_edge_value * p_ssao_value;
	r_sum_weight += p_edge_value;
}
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	int reach = wide == 1 ? 2 : 1;
	vec2 vC = fetch(pos);
	vec2 vL = fetch(pos + ivec2(-reach, 0));
	vec2 vT = fetch(pos + ivec2(0, -reach));
	vec2 vR = fetch(pos + ivec2(reach, 0));
	vec2 vB = fetch(pos + ivec2(0, reach));
	float packed_edges = vC.y;
	vec4 edgesLRTB = unpack_edges(packed_edges, edge_sharpness);
	float sum_weight = 0.5;
	if (wide == 1) {
		edgesLRTB.x *= unpack_edges(vL.y, edge_sharpness).y;
		edgesLRTB.z *= unpack_edges(vT.y, edge_sharpness).w;
		edgesLRTB.y *= unpack_edges(vR.y, edge_sharpness).x;
		edgesLRTB.w *= unpack_edges(vB.y, edge_sharpness).z;
		sum_weight = 0.8;
	}
	float sum = vC.x * sum_weight;
	add_sample(vL.x, edgesLRTB.x, sum, sum_weight);
	add_sample(vR.x, edgesLRTB.y, sum, sum_weight);
	add_sample(vT.x, edgesLRTB.z, sum, sum_weight);
	add_sample(vB.x, edgesLRTB.w, sum, sum_weight);
	out_ssao = vec4(sum / sum_weight, packed_edges, 0.0, 0.0);
}`;

/** The smart interleave, shared: `VALUE` is the type gathered, `EDGES` reads the packed edges. */
const interleave = (type, swizzle, edges, declarations) => /* glsl */ `
${HEADER}
uniform sampler2DArray source_texture;
${declarations}
uniform float inv_sharpness;
uniform int size_modifier;
uniform vec2 pixel_size;
layout(location = 0) out vec4 out_value;
${UNPACK_EDGES}
void main() {
	ivec2 pix_pos = ivec2(gl_FragCoord.xy);
	// The engine's guard, as written: the size comes back from its reciprocal, and where the GPU's
	// division falls short of it (900 rows on Intel graphics) the last row or column is never
	// written. It keeps the zero it was created with: full occlusion along that edge of the frame.
	if (any(greaterThanEqual(pix_pos, ivec2(1.0 / pixel_size)))) {
		out_value = vec4(0.0);
		return;
	}
	vec2 at = vec2(pix_pos) + vec2(0.5);
	// The slice this pixel belongs to, and its three neighbours'.
	int mx = pix_pos.x % 2;
	int my = pix_pos.y % 2;
	int index_center = mx + my * 2;
	int index_horizontal = (1 - mx) + my * 2;
	int index_vertical = mx + (1 - my) * 2;
	int index_diagonal = (1 - mx) + (1 - my) * 2;
	ivec3 center = ivec3(pix_pos / size_modifier, index_center);
	vec4 center_texel = texelFetch(source_texture, center, 0);
	${type} value = center_texel.${swizzle};
	vec4 edgesLRTB = unpack_edges(${edges}, inv_sharpness);
	float fmx = float(mx);
	float fmy = float(my);
	// At an edge the sampling offsets are pushed away from it (towards the pixel centre).
	float fmxe = (edgesLRTB.y - edgesLRTB.x);
	float fmye = (edgesLRTB.w - edgesLRTB.z);
	vec2 uv_horizontal = (at + vec2(fmx + fmxe - 0.5, 0.5 - fmy)) * pixel_size;
	${type} value_horizontal = textureLod(source_texture, vec3(uv_horizontal, index_horizontal), 0.0).${swizzle};
	vec2 uv_vertical = (at + vec2(0.5 - fmx, fmy - 0.5 + fmye)) * pixel_size;
	${type} value_vertical = textureLod(source_texture, vec3(uv_vertical, index_vertical), 0.0).${swizzle};
	vec2 uv_diagonal = (at + vec2(fmx - 0.5 + fmxe, fmy - 0.5 + fmye)) * pixel_size;
	${type} value_diagonal = textureLod(source_texture, vec3(uv_diagonal, index_diagonal), 0.0).${swizzle};
	// Samples near an edge weigh less; with an edge on both sides, nothing.
	vec4 blendWeights;
	blendWeights.x = 1.0;
	blendWeights.y = (edgesLRTB.x + edgesLRTB.y) * 0.5;
	blendWeights.z = (edgesLRTB.z + edgesLRTB.w) * 0.5;
	blendWeights.w = (blendWeights.y + blendWeights.z) * 0.5;
	float blendWeightsSum = dot(blendWeights, vec4(1.0, 1.0, 1.0, 1.0));
	value = (value * blendWeights.x + value_horizontal * blendWeights.y + value_vertical * blendWeights.z + value_diagonal * blendWeights.w) / blendWeightsSum;
	out_value = vec4(value);
}`;

const SSAO_INTERLEAVE = interleave('float', 'x', 'center_texel.y', '');
const SSIL_INTERLEAVE = interleave('vec4', 'xyzw', 'texelFetch(source_edges, center, 0).r', 'uniform sampler2DArray source_edges;');

const SSIL_GATHER = /* glsl */ `
${HEADER}
${GATHER_COMMON}
uniform sampler2D last_frame;
uniform mat4 reprojection;
uniform float z_near;
uniform float z_far;
uniform float normal_rejection_amount;
layout(location = 0) out vec4 out_ssil;

#define SSIL_HALOING_REDUCTION_ENABLE_AT_QUALITY_PRESET 1
#define SSIL_HALOING_REDUCTION_AMOUNT 0.8
#define SSIL_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET 1
#define SSIL_REDUCE_RADIUS_NEAR_SCREEN_BORDER_ENABLE_AT_QUALITY_PRESET 1

float calculate_pixel_obscurance(vec3 p_pixel_normal, vec3 p_hit_delta, float p_fallof_sq) {
	float length_sq = dot(p_hit_delta, p_hit_delta);
	float NdotD = dot(p_pixel_normal, p_hit_delta) / sqrt(length_sq);
	float falloff_mult = max(0.0, length_sq * p_fallof_sq + 1.0);
	return max(0.0, NdotD - 0.05) * falloff_mult;
}

float gd_smoothstep(float e0, float e1, float x) {
	float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
	return t * t * (3.0 - 2.0 * t);
}

void SSIL_tap_inner(inout vec3 r_color_sum, inout float r_obscurance_sum, inout float r_weight_sum, const vec2 p_sampling_uv, const vec3 p_pix_center_pos, vec3 p_pixel_normal, const float p_fallof_sq, const float p_weight_mod) {
	float viewspace_sample_z = depth_at(p_sampling_uv);
	vec3 sample_normal = load_normal(ivec2(p_sampling_uv * vec2(screen_size)));
	vec3 hit_pos = NDC_to_view_space(p_sampling_uv.xy, viewspace_sample_z);
	vec3 hit_delta = hit_pos - p_pix_center_pos;
	float obscurance = calculate_pixel_obscurance(p_pixel_normal, hit_delta, p_fallof_sq);
	float weight = 1.0;
	if (quality >= SSIL_HALOING_REDUCTION_ENABLE_AT_QUALITY_PRESET) {
		float reduce = max(0.0, -hit_delta.z);
		reduce = clamp(reduce * neg_inv_radius + 2.0, 0.0, 1.0);
		weight = SSIL_HALOING_REDUCTION_AMOUNT * reduce + (1.0 - SSIL_HALOING_REDUCTION_AMOUNT);
	}
	// The sample in the last frame's screen.
	vec4 sample_pos = reprojection * vec4(p_sampling_uv * 2.0 - 1.0, (viewspace_sample_z - z_near) / (z_far - z_near) * 2.0 - 1.0, 1.0);
	vec2 reprojected_sampling_uv = (sample_pos.xy / sample_pos.w) * 0.5 + 0.5;
	weight *= p_weight_mod;
	r_obscurance_sum += obscurance * weight;
	vec3 sample_color = textureLod(last_frame, reprojected_sampling_uv, 5.0).rgb;
	// Tonemap before averaging: fireflies weigh less.
	sample_color /= (1.0 + dot(sample_color, vec3(0.299, 0.587, 0.114)));
	r_color_sum += sample_color * obscurance * weight * mix(1.0, gd_smoothstep(0.0, 0.1, -dot(sample_normal, normalize(hit_delta))), normal_rejection_amount);
	r_weight_sum += weight;
}

void SSILTap(inout vec3 r_color_sum, inout float r_obscurance_sum, inout float r_weight_sum, const int p_tap_index, const mat2 p_rot_scale, const vec3 p_pix_center_pos, vec3 p_pixel_normal, const vec2 p_normalized_screen_pos, const float p_fallof_sq) {
	vec4 new_sample = sample_pattern[p_tap_index];
	vec2 sample_offset = new_sample.xy * p_rot_scale;
	float weight_mod = new_sample.z;
	sample_offset = round(sample_offset);
	vec2 sampling_uv = sample_offset * half_screen_pixel_size + p_normalized_screen_pos;
	SSIL_tap_inner(r_color_sum, r_obscurance_sum, r_weight_sum, sampling_uv, p_pix_center_pos, p_pixel_normal, p_fallof_sq, weight_mod);
	vec2 sampling_mirrored_uv = -sample_offset * half_screen_pixel_size + p_normalized_screen_pos;
	SSIL_tap_inner(r_color_sum, r_obscurance_sum, r_weight_sum, sampling_mirrored_uv, p_pix_center_pos, p_pixel_normal, p_fallof_sq, weight_mod);
}

void main() {
	vec2 pos_rounded = trunc(gl_FragCoord.xy);
	ivec2 upos = ivec2(pos_rounded);
	int number_of_taps = num_taps[quality];

	float pix_z = depth_texel(upos);
	float pix_left_z = depth_texel(upos + ivec2(-1, 0));
	float pix_top_z = depth_texel(upos + ivec2(0, -1));
	float pix_right_z = depth_texel(upos + ivec2(1, 0));
	float pix_bottom_z = depth_texel(upos + ivec2(0, 1));

	vec2 normalized_screen_pos = pos_rounded * half_screen_pixel_size + half_screen_pixel_size_x025;
	vec3 pix_center_pos = NDC_to_view_space(normalized_screen_pos, pix_z);

	ivec2 full_res_coord = upos * 2 * size_multiplier + pass_coord_offset;
	vec3 pixel_normal = load_normal(full_res_coord);

	vec2 pixel_size_at_center = NDC_to_view_space(normalized_screen_pos.xy + half_screen_pixel_size, pix_center_pos.z).xy - pix_center_pos.xy;

	float pixel_lookup_radius;
	float fallof_sq;
	float viewspace_radius;
	calculate_radius_parameters(length(pix_center_pos), pixel_size_at_center, pixel_lookup_radius, viewspace_radius, fallof_sq);

	if (quality >= SSIL_REDUCE_RADIUS_NEAR_SCREEN_BORDER_ENABLE_AT_QUALITY_PRESET) {
		float near_screen_border = min(min(normalized_screen_pos.x, 1.0 - normalized_screen_pos.x), min(normalized_screen_pos.y, 1.0 - normalized_screen_pos.y));
		near_screen_border = clamp(10.0 * near_screen_border + 0.6, 0.0, 1.0);
		pixel_lookup_radius *= near_screen_border;
	}

	uint pseudo_random_index = uint(pos_rounded.y * 2.0 + pos_rounded.x) % 5u;
	vec4 rotation_scale = rotation_matrices[pass * 5 + int(pseudo_random_index)];
	mat2 rot_scale_matrix = mat2(rotation_scale.x * pixel_lookup_radius, rotation_scale.y * pixel_lookup_radius, rotation_scale.z * pixel_lookup_radius, rotation_scale.w * pixel_lookup_radius);

	vec3 color_sum = vec3(0.0);
	float obscurance_sum = 0.0;
	float weight_sum = 0.0;
	vec4 edgesLRTB = vec4(1.0, 1.0, 1.0, 1.0);

	pix_center_pos *= 0.99;

	if (quality >= SSIL_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET) {
		edgesLRTB = calculate_edges(pix_z, pix_left_z, pix_right_z, pix_top_z, pix_bottom_z);
	}

	for (int i = 0; i < number_of_taps; i++) {
		SSILTap(color_sum, obscurance_sum, weight_sum, i, rot_scale_matrix, pix_center_pos, pixel_normal, normalized_screen_pos, fallof_sq);
	}

	vec3 color = color_sum / weight_sum;
	color /= 1.0 - dot(color, vec3(0.299, 0.587, 0.114));

	float fade_out = clamp(pix_center_pos.z * fade_out_mul + fade_out_add, 0.0, 1.0);
	if (quality >= SSIL_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET) {
		float edge_fadeout_factor = clamp((1.0 - edgesLRTB.x - edgesLRTB.y) * 0.35, 0.0, 1.0) + clamp((1.0 - edgesLRTB.z - edgesLRTB.w) * 0.35, 0.0, 1.0);
		fade_out *= clamp(1.0 - edge_fadeout_factor, 0.0, 1.0);
	}
	color = intensity * color;
	color *= fade_out;
	float obscurance = clamp((obscurance_sum / weight_sum) * intensity, 0.0, 1.0);
	out_ssil = vec4(color, obscurance);
}`;

/**
 * The packed depth edges of SSIL, which the engine writes from the gather pass into a second image.
 * Here they come from a pass of their own (the same arithmetic on the same depth slices): an array
 * target holds one attachment.
 */
const SSIL_EDGES = /* glsl */ `
${HEADER}
${GATHER_COMMON}
layout(location = 0) out vec4 out_edges;
#define SSIL_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET 1
void main() {
	ivec2 upos = ivec2(gl_FragCoord.xy);
	vec4 edgesLRTB = vec4(1.0);
	if (quality >= SSIL_DEPTH_BASED_EDGES_ENABLE_AT_QUALITY_PRESET) {
		edgesLRTB = calculate_edges(depth_texel(upos), depth_texel(upos + ivec2(-1, 0)), depth_texel(upos + ivec2(1, 0)), depth_texel(upos + ivec2(0, -1)), depth_texel(upos + ivec2(0, 1)));
	}
	out_edges = vec4(pack_edges(edgesLRTB));
}`;

const SSIL_BLUR = /* glsl */ `
${HEADER}
uniform sampler2DArray source_ssil;
uniform sampler2DArray source_edges;
uniform int slice;
uniform float edge_sharpness;
uniform int wide;
layout(location = 0) out vec4 out_ssil;
${SLICE_FETCH}
${UNPACK_EDGES}
vec4 fetch(ivec2 p) {
	ivec2 size = textureSize(source_ssil, 0).xy;
	return texelFetch(source_ssil, ivec3(mirror_texel(p, size), slice), 0);
}
// imageLoad: outside the image the engine reads zeros.
float edges_at(ivec2 p) {
	ivec2 size = textureSize(source_edges, 0).xy;
	if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return 0.0;
	return texelFetch(source_edges, ivec3(p, slice), 0).r;
}
void add_sample(vec4 p_ssil_value, float p_edge_value, inout vec4 r_sum, inout float r_sum_weight) {
	r_sum += p_edge_value * p_ssil_value;
	r_sum_weight += p_edge_value;
}
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	int reach = wide == 1 ? 2 : 1;
	vec4 vC = fetch(pos);
	vec4 vL = fetch(pos + ivec2(-reach, 0));
	vec4 vT = fetch(pos + ivec2(0, -reach));
	vec4 vR = fetch(pos + ivec2(reach, 0));
	vec4 vB = fetch(pos + ivec2(0, reach));
	vec4 edgesLRTB = unpack_edges(edges_at(pos), edge_sharpness);
	float sum_weight = 0.5;
	if (wide == 1) {
		edgesLRTB.x *= unpack_edges(edges_at(pos + ivec2(-2, 0)), edge_sharpness).y;
		edgesLRTB.z *= unpack_edges(edges_at(pos + ivec2(0, -2)), edge_sharpness).w;
		edgesLRTB.y *= unpack_edges(edges_at(pos + ivec2(2, 0)), edge_sharpness).x;
		edgesLRTB.w *= unpack_edges(edges_at(pos + ivec2(0, 2)), edge_sharpness).z;
		sum_weight = 0.8;
	}
	vec4 sum = vC * sum_weight;
	add_sample(vL, edgesLRTB.x, sum, sum_weight);
	add_sample(vR, edgesLRTB.y, sum, sum_weight);
	add_sample(vT, edgesLRTB.z, sum, sum_weight);
	add_sample(vB, edgesLRTB.w, sum, sum_weight);
	out_ssil = sum / sum_weight;
}`;

/** copy.glsl MODE_MIPMAP: a 2×2 average that replaces what is not a number. */
const MIPMAP = /* glsl */ `
uniform sampler2D source_color;
uniform int source_lod;
uniform int copy;
layout(location = 0) out vec4 out_color;
${FINITE_GLSL}
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	if (copy == 1) {
		out_color = texelFetch(source_color, pos, 0);
		return;
	}
	ivec2 base_pos = pos << 1;
	vec4 color = texelFetch(source_color, base_pos, source_lod);
	color += texelFetch(source_color, base_pos + ivec2(0, 1), source_lod);
	color += texelFetch(source_color, base_pos + ivec2(1, 0), source_lod);
	color += texelFetch(source_color, base_pos + ivec2(1, 1), source_lod);
	color /= 4.0;
	color = mix(color, vec4(100.0, 100.0, 100.0, 1.0), gd_isinf(color));
	color = mix(color, vec4(100.0, 100.0, 100.0, 1.0), gd_isnan(color));
	out_color = color;
}`;

/** An array target of `SLICES` layers. */
function sliceTarget(width, height, { type, format, filter }) {
  const target = new THREE.WebGLArrayRenderTarget(width, height, SLICES, {
    type,
    format,
    depthBuffer: false,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });
  return target;
}

const flatTarget = (width, height, type, format, filter) =>
  new THREE.WebGLRenderTarget(width, height, { type, format, depthBuffer: false, minFilter: filter, magFilter: filter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false });

/** Uniforms every gather pass shares; the values are filled per frame. */
function gatherUniforms(extra) {
  return {
    source_depth: { value: null },
    source_normal: { value: null },
    rotation_matrices: { value: rotationMatrices() },
    screen_size: { value: new THREE.Vector2() },
    pass: { value: 0 },
    quality: { value: 1 },
    half_screen_pixel_size: { value: new THREE.Vector2() },
    half_screen_pixel_size_x025: { value: new THREE.Vector2() },
    size_multiplier: { value: 2 },
    NDC_to_view_mul: { value: new THREE.Vector2() },
    NDC_to_view_add: { value: new THREE.Vector2() },
    radius: { value: 1 },
    intensity: { value: 1 },
    fade_out_mul: { value: 0 },
    fade_out_add: { value: 0 },
    inv_radius_near_limit: { value: 0 },
    neg_inv_radius: { value: 0 },
    pass_coord_offset: { value: new THREE.Vector2() },
    ...extra,
  };
}

const tmpProjection = new THREE.Matrix4();
const tmpRotation = new THREE.Matrix4();
/** Projection::set_depth_correction(flip y, reversed z, remapped to 0…1), as the engine applies it. */
const DEPTH_CORRECTION = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -0.5, 0.5, 0, 0, 0, 1);

export class ScreenSpaceEffects {
  /** @param {import('./pipeline.js').RenderPipeline} pipeline */
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.quad = pipeline.quad;
    this.width = 0;
    this.height = 0;
    this.targets = null;
    this.downsample = fullscreenMaterial(DOWNSAMPLE, { source_depth: { value: null }, slice_offset: { value: new THREE.Vector2() }, block: { value: 4 }, z_far: { value: 1 } });
    this.ssaoGather = fullscreenMaterial(
      SSAO_GATHER,
      gatherUniforms({ detail_intensity: { value: 0 }, shadow_power: { value: 1 }, shadow_clamp: { value: SHADOW_CLAMP }, horizon_angle_threshold: { value: 0 } }),
    );
    this.ssaoBlur = fullscreenMaterial(SSAO_BLUR, { source_ssao: { value: null }, slice: { value: 0 }, edge_sharpness: { value: 0 }, wide: { value: 0 } });
    this.ssaoInterleave = fullscreenMaterial(SSAO_INTERLEAVE, { source_texture: { value: null }, inv_sharpness: { value: 0 }, size_modifier: { value: 4 }, pixel_size: { value: new THREE.Vector2() } });
    this.ssilGather = fullscreenMaterial(
      SSIL_GATHER,
      gatherUniforms({ last_frame: { value: null }, reprojection: { value: new THREE.Matrix4() }, z_near: { value: 0 }, z_far: { value: 1 }, normal_rejection_amount: { value: 1 } }),
    );
    this.ssilEdges = fullscreenMaterial(SSIL_EDGES, gatherUniforms({}));
    this.ssilBlur = fullscreenMaterial(SSIL_BLUR, { source_ssil: { value: null }, source_edges: { value: null }, slice: { value: 0 }, edge_sharpness: { value: 0 }, wide: { value: 0 } });
    this.ssilInterleave = fullscreenMaterial(SSIL_INTERLEAVE, {
      source_texture: { value: null },
      source_edges: { value: null },
      inv_sharpness: { value: 0 },
      size_modifier: { value: 4 },
      pixel_size: { value: new THREE.Vector2() },
    });
    this.mipmap = fullscreenMaterial(MIPMAP, { source_color: { value: null }, source_lod: { value: 0 }, copy: { value: 0 } });
    /** The engine starts from an identity projection and transform: the first frame reprojects to nowhere. */
    this.lastProjection = new THREE.Matrix4();
    this.lastRotation = new THREE.Matrix4();
    pipeline.ssEffects = this;
    if (pipeline.width > 0) this.resize(pipeline.width, pipeline.height);
  }

  get ssaoTexture() {
    return this.targets?.ssaoFinal.texture ?? null;
  }
  get ssilTexture() {
    return this.targets?.ssilFinal.texture ?? null;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    // Half size: slices a quarter of the screen wide.
    const w = Math.trunc((width + 3) / 4);
    const h = Math.trunc((height + 3) / 4);
    const half = THREE.HalfFloatType;
    const byte = THREE.UnsignedByteType;
    const ssil = () => sliceTarget(w, h, { type: half, format: THREE.RGBAFormat, filter: THREE.LinearFilter });
    const lastFrame = hdrTarget(width, height, THREE.LinearFilter);
    lastFrame.texture.minFilter = THREE.LinearMipmapLinearFilter;
    withMipChain(this.quad.renderer, lastFrame, LAST_FRAME_MIPS);
    const scratch = [];
    for (let level = 1; level < LAST_FRAME_MIPS; level++) scratch.push(hdrTarget(Math.max(1, width >> level), Math.max(1, height >> level), THREE.NearestFilter));
    this.targets = {
      depth: sliceTarget(w, h, { type: half, format: THREE.RedFormat, filter: THREE.NearestFilter }),
      ssao: sliceTarget(w, h, { type: byte, format: THREE.RGFormat, filter: THREE.LinearFilter }),
      ssaoPong: sliceTarget(w, h, { type: byte, format: THREE.RGFormat, filter: THREE.LinearFilter }),
      ssaoFinal: flatTarget(width, height, byte, THREE.RedFormat, THREE.LinearFilter),
      ssil: ssil(),
      ssilPong: ssil(),
      ssilEdges: sliceTarget(w, h, { type: byte, format: THREE.RedFormat, filter: THREE.NearestFilter }),
      ssilFinal: hdrTarget(width, height, THREE.LinearFilter),
      lastFrame,
      scratch,
    };
    this.sliceWidth = w;
    this.sliceHeight = h;
    sharedUniforms.uAoBuffer.value = this.targets.ssaoFinal.texture;
    sharedUniforms.uSsilBuffer.value = this.targets.ssilFinal.texture;
    this._clear(this.targets.lastFrame, LAST_FRAME_MIPS);
    this._clear(this.targets.ssilFinal, 1);
  }

  _clear(target, levels) {
    const renderer = this.quad.renderer;
    renderer.setClearColor(0x000000, 0);
    for (let level = 0; level < levels; level++) {
      this._viewport(target, Math.max(1, target.width >> level), Math.max(1, target.height >> level));
      renderer.setRenderTarget(target, 0, level);
      renderer.clear(true, false, false);
    }
    this._viewport(target, target.width, target.height);
  }

  _viewport(target, width, height) {
    target.viewport.set(0, 0, width, height);
    target.scissor.set(0, 0, width, height);
  }

  dispose() {
    if (!this.targets) return;
    for (const target of Object.values(this.targets)) {
      if (Array.isArray(target)) for (const t of target) t.dispose();
      else target.dispose();
    }
    this.targets = null;
  }

  _draw(material, target, layer = 0, level = 0) {
    const renderer = this.quad.renderer;
    this.quad.mesh.material = material;
    renderer.setRenderTarget(target, layer, level);
    renderer.render(this.quad.scene, this.quad.camera);
  }

  /**
   * SSAO and SSIL of the frame, from the prepass (attachment 0: normal and roughness, attachment 1:
   * view depth). O(pixels).
   * @param {THREE.WebGLRenderTarget} prepass
   * @param {THREE.PerspectiveCamera} camera the scene camera (not the mirrored one)
   */
  render(prepass, camera, environment, { ssao, ssil }) {
    const t = this.targets;
    const normal = prepass.textures[0];
    const depth = prepass.textures[1];

    const down = this.downsample.uniforms;
    down.source_depth.value = depth;
    down.z_far.value = camera.far;
    for (let slice = 0; slice < SLICES; slice++) {
      // The half-size downsample reads pixels (0,0), (2,0), (0,2) and (2,2) of every 4×4 block.
      down.slice_offset.value.set((slice % 2) * 2, Math.trunc(slice / 2) * 2);
      this._draw(this.downsample, t.depth, slice);
    }

    if (ssao) this._ssao(normal, camera, environment);
    if (ssil) this._ssil(normal, camera, environment);
  }

  _fillGather(uniforms, normal, camera, settings, radius, intensity) {
    const e = camera.projectionMatrix.elements;
    const tanHalfFovX = 1 / e[0];
    const tanHalfFovY = 1 / e[5];
    uniforms.source_depth.value = this.targets.depth.texture;
    uniforms.source_normal.value = normal;
    uniforms.screen_size.value.set(this.width, this.height);
    const pixel = settings.halfSize ? 4 : 2;
    uniforms.half_screen_pixel_size.value.set(pixel / this.width, pixel / this.height);
    uniforms.half_screen_pixel_size_x025.value.copy(uniforms.half_screen_pixel_size.value).multiplyScalar(0.75);
    uniforms.NDC_to_view_mul.value.set(tanHalfFovX * 2, tanHalfFovY * -2);
    uniforms.NDC_to_view_add.value.set(tanHalfFovX * -1, tanHalfFovY);
    // Quality Low and below widen the near limit; Very Low also shrinks the radius.
    let nearLimit = radius * 1.2;
    let effectRadius = radius;
    if (settings.quality <= 1) {
      nearLimit *= 1.5;
      if (settings.quality === 0) effectRadius *= 0.8;
    }
    nearLimit /= tanHalfFovY;
    uniforms.radius.value = effectRadius;
    uniforms.intensity.value = intensity;
    uniforms.fade_out_mul.value = -1 / (settings.fadeoutTo - settings.fadeoutFrom);
    uniforms.fade_out_add.value = settings.fadeoutFrom / (settings.fadeoutTo - settings.fadeoutFrom) + 1;
    uniforms.inv_radius_near_limit.value = 1 / nearLimit;
    uniforms.neg_inv_radius.value = -1 / effectRadius;
    uniforms.quality.value = Math.max(0, settings.quality - 1);
    uniforms.size_multiplier.value = settings.halfSize ? 2 : 1;
  }

  _gather(material, target) {
    const u = material.uniforms;
    for (let slice = 0; slice < SLICES; slice++) {
      u.pass.value = slice;
      u.pass_coord_offset.value.set(slice % 2, Math.trunc(slice / 2));
      this._draw(material, target, slice);
    }
  }

  /**
   * The edge-aware blur, ping-pong between `first` (the gather's result) and `second`; returns the
   * target holding the result. The last two passes are the smart ones, the earlier ones the wide.
   */
  _blur(material, passes, first, second, sharpness, edges) {
    const u = material.uniforms;
    u.edge_sharpness.value = 1 - sharpness;
    if (edges) u.source_edges.value = edges;
    let source = first;
    let target = second;
    for (let pass = 0; pass < passes; pass++) {
      u.wide.value = pass < passes - 2 ? 1 : 0;
      (u.source_ssao ?? u.source_ssil).value = source.texture;
      for (let slice = 0; slice < SLICES; slice++) {
        u.slice.value = slice;
        this._draw(material, target, slice);
      }
      [source, target] = [target, source];
    }
    return source;
  }

  _ssao(normal, camera, environment) {
    const t = this.targets;
    const u = this.ssaoGather.uniforms;
    this._fillGather(u, normal, camera, SsaoSettings, environment.ssao_radius, environment.ssao_intensity);
    u.shadow_power.value = environment.ssao_power;
    u.horizon_angle_threshold.value = environment.ssao_horizon;
    u.detail_intensity.value = environment.ssao_detail;
    this._gather(this.ssaoGather, t.ssao);
    const blurred = this._blur(this.ssaoBlur, SsaoSettings.blurPasses, t.ssao, t.ssaoPong, environment.ssao_sharpness, null);
    const i = this.ssaoInterleave.uniforms;
    i.source_texture.value = blurred.texture;
    i.inv_sharpness.value = 1 - environment.ssao_sharpness;
    i.size_modifier.value = SsaoSettings.halfSize ? 4 : 2;
    i.pixel_size.value.set(1 / this.width, 1 / this.height);
    this._draw(this.ssaoInterleave, t.ssaoFinal);
  }

  _ssil(normal, camera, environment) {
    const t = this.targets;
    const u = this.ssilGather.uniforms;
    this._fillGather(u, normal, camera, SsilSettings, environment.ssil_radius, environment.ssil_intensity * Math.PI);
    u.z_near.value = camera.near;
    u.z_far.value = camera.far;
    u.normal_rejection_amount.value = environment.ssil_normal_rejection;
    u.last_frame.value = t.lastFrame.texture;

    // Only the camera's orientation is reprojected (the engine drops its position).
    const rotation = tmpRotation.extractRotation(camera.matrixWorld);
    const projection = tmpProjection.multiplyMatrices(DEPTH_CORRECTION, camera.projectionMatrix);
    u.reprojection.value.copy(this.lastProjection).multiply(this.lastRotation.clone().invert()).multiply(rotation).multiply(projection.clone().invert());
    this.lastProjection.copy(projection);
    this.lastRotation.copy(rotation);

    this._gather(this.ssilGather, t.ssil);
    this._fillGather(this.ssilEdges.uniforms, normal, camera, SsilSettings, environment.ssil_radius, environment.ssil_intensity * Math.PI);
    this._gather(this.ssilEdges, t.ssilEdges);
    const edges = t.ssilEdges.texture;
    const blurred = this._blur(this.ssilBlur, SsilSettings.blurPasses, t.ssil, t.ssilPong, environment.ssil_sharpness, edges);
    const i = this.ssilInterleave.uniforms;
    i.source_texture.value = blurred.texture;
    i.source_edges.value = edges;
    i.inv_sharpness.value = 1 - environment.ssil_sharpness;
    i.size_modifier.value = SsilSettings.halfSize ? 4 : 2;
    i.pixel_size.value.set(1 / this.width, 1 / this.height);
    this._draw(this.ssilInterleave, t.ssilFinal);
  }

  /**
   * SSEffects::copy_internal_texture_to_last_frame: the frame just drawn and its mips, for the next
   * frame's SSIL. Every mip is computed apart and copied into place (a level cannot be drawn while
   * its own texture is read).
   */
  keepLastFrame(color) {
    const t = this.targets;
    const u = this.mipmap.uniforms;
    u.copy.value = 1;
    u.source_color.value = color;
    this._viewport(t.lastFrame, this.width, this.height);
    this._draw(this.mipmap, t.lastFrame, 0, 0);
    for (let level = 1; level < LAST_FRAME_MIPS; level++) {
      const scratch = t.scratch[level - 1];
      u.copy.value = 0;
      u.source_color.value = t.lastFrame.texture;
      u.source_lod.value = level - 1;
      this._draw(this.mipmap, scratch);
      u.copy.value = 1;
      u.source_color.value = scratch.texture;
      this._viewport(t.lastFrame, scratch.width, scratch.height);
      this._draw(this.mipmap, t.lastFrame, 0, level);
    }
    this._viewport(t.lastFrame, this.width, this.height);
  }
}
