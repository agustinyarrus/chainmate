/**
 * GLSL helpers shared by the render passes.
 */

/** Tiles per row of the 2D atlas a volume is kept as (volumetric_fog.js draws and reads them). */
export const VOLUME_ATLAS_COLUMNS = 8;
/** Fractional bits the hardware places a filtered sample with (D3D and Vulkan: 8). */
export const SUBTEXEL_STEPS = 256;

/**
 * A volume kept as a 2D atlas of its slices, read the way a 3D texture with trilinear filtering and
 * clamp-to-edge is read: a bilinear tap in each of the two slices around the point (the hardware
 * filters inside the tile; clamping to the tile's outer texel centres is its clamp-to-edge), then the
 * blend between them, placed in fixed point as the hardware places it. Why not a 3D texture: WebGL
 * can only fill one by copying slices, and Direct3D's WebGL (ANGLE) copies a float framebuffer into
 * a volume slice by slice through the CPU (≈1.3 ms a slice, 165 ms a frame); drawn as an atlas, a
 * stage is one draw. O(1): two texture reads.
 */
export const VOLUME_ATLAS_GLSL = /* glsl */ `
vec2 volume_atlas_tile(float slice, vec2 size) {
	return vec2(mod(slice, ${VOLUME_ATLAS_COLUMNS}.0), floor(slice / ${VOLUME_ATLAS_COLUMNS}.0)) * size;
}
vec4 volume_atlas_sample(sampler2D atlas, vec3 size, vec3 uvw) {
	float z = floor((uvw.z * size.z - 0.5) * ${SUBTEXEL_STEPS}.0 + 0.5) / ${SUBTEXEL_STEPS}.0;
	float below = floor(z);
	float weight = z - below;
	float first = clamp(below, 0.0, size.z - 1.0);
	float second = clamp(below + 1.0, 0.0, size.z - 1.0);
	vec2 xy = clamp(uvw.xy * size.xy, vec2(0.5), size.xy - 0.5);
	vec2 texel = 1.0 / vec2(textureSize(atlas, 0));
	vec4 near_slice = textureLod(atlas, (volume_atlas_tile(first, size.xy) + xy) * texel, 0.0);
	vec4 far_slice = textureLod(atlas, (volume_atlas_tile(second, size.xy) + xy) * texel, 0.0);
	return mix(near_slice, far_slice, weight);
}`;

/**
 * isnan() / isinf() that every shader compiler keeps. Direct3D's (ANGLE, the default WebGL backend on
 * Windows) assumes floats are finite and may fold the built-ins to false (warning X3577), which would
 * let a NaN through exactly where the engine filters it out; a test on the bits cannot be folded.
 * IEEE 754: exponent all ones = infinity (mantissa 0) or NaN (mantissa ≠ 0). O(1) per component.
 */
export const FINITE_GLSL = /* glsl */ `
const uint GD_ABS_BITS = 0x7fffffffu;
const uint GD_INF_BITS = 0x7f800000u;
bvec4 gd_isnan(vec4 v) { return greaterThan(floatBitsToUint(v) & GD_ABS_BITS, uvec4(GD_INF_BITS)); }
bvec4 gd_isinf(vec4 v) { return equal(floatBitsToUint(v) & GD_ABS_BITS, uvec4(GD_INF_BITS)); }
// any(isnan(v)) || any(isinf(v)) in one test.
bool gd_not_finite(vec4 v) { return any(greaterThanEqual(floatBitsToUint(v) & GD_ABS_BITS, uvec4(GD_INF_BITS))); }`;
