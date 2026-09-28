/**
 * DFG — the split-sum lookup the scene shader reads as `prefiltered_dfg(roughness, NoV)`: Godot 4.7's
 * shaders/forward_clustered/integrate_dfg.glsl, integrated once on the GPU like the engine does.
 *
 *   x → N·V        (x + 0.5) / 128
 *   y → roughness  (y + 0.5) / 128
 *   r, g → the two terms of the multiscattering split sum (Filament's LDFG), b → the cloth term
 *
 * The engine stores the rows mirrored and samples at (NoV, 1 − roughness); here the rows are stored
 * in order and sampled at (NoV, roughness) — the same texel centres, the same bilinear weights.
 * One 128×128 pass of 1024 Hammersley samples per texel: O(size² · samples), run once at start-up.
 */
import * as THREE from 'three';
import { fullscreenMaterial } from './fullscreen.js';

export const DFG_SIZE = 128;
const DFG_SAMPLES = 1024;

const INTEGRATE_DFG = /* glsl */ `
#define M_PI 3.14159265359
#define SAMPLE_COUNT ${DFG_SAMPLES}u
#define SIZE ${DFG_SIZE}.0
layout(location = 0) out vec4 out_dfg;

// Van der Corput radical inverse (Hammersley's second coordinate).
float radical_inverse_vdc(uint bits) {
	bits = (bits << 16u) | (bits >> 16u);
	bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
	bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
	bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
	bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
	return float(bits) * 2.3283064365386963e-10;
}

vec2 hammersley(uint i, float n) {
	return vec2(float(i) / n, radical_inverse_vdc(i));
}

vec3 importance_sample_ggx(vec2 Xi, vec3 N, float roughness) {
	float a = roughness * roughness;
	float phi = 2.0 * M_PI * Xi.x;
	float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
	float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
	vec3 H = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
	vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
	vec3 tangent = normalize(cross(up, N));
	vec3 bitangent = cross(N, tangent);
	return normalize(tangent * H.x + bitangent * H.y + N * H.z);
}

float geometry_schlick_ggx(float NdotV, float roughness) {
	// A different k for image based lighting.
	float k = (roughness * roughness) / 2.0;
	return NdotV / (NdotV * (1.0 - k) + k);
}

float geometry_smith(vec3 N, vec3 V, vec3 L, float roughness) {
	float NdotV = clamp(dot(N, V), 0.0, 1.0);
	float NdotL = clamp(dot(N, L), 0.0, 1.0);
	return geometry_schlick_ggx(NdotL, roughness) * geometry_schlick_ggx(NdotV, roughness);
}

vec3 importance_uniform_sample(vec2 u) {
	float phi = 2.0 * M_PI * u.x;
	float cosTheta = 1.0 - u.y;
	float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
	return vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
}

float distribution_charlie(float NoH, float roughness) {
	float a = roughness * roughness;
	float invAlpha = 1.0 / a;
	float sin2h = 1.0 - NoH * NoH;
	return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * M_PI);
}

float visibility_ashikhmin(float NoV, float NoL) {
	return 1.0 / (4.0 * (NoL + NoV - NoL * NoV));
}

void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	float roughness = (float(pos.y) + 0.5) / SIZE;
	float n_dot_v = (float(pos.x) + 0.5) / SIZE;
	vec3 v = vec3(sqrt(1.0 - n_dot_v * n_dot_v), 0.0, n_dot_v);
	vec3 n = vec3(0.0, 0.0, 1.0);
	float A = 0.0;
	float B = 0.0;
	float C = 0.0;
	for (uint i = 0u; i < SAMPLE_COUNT; ++i) {
		vec2 Xi = hammersley(i, float(SAMPLE_COUNT));
		vec3 h = importance_sample_ggx(Xi, n, roughness);
		vec3 l = normalize(2.0 * dot(v, h) * h - v);
		float n_dot_l = clamp(l.z, 0.0, 1.0);
		float n_dot_h = clamp(h.z, 0.0, 1.0);
		float v_dot_h = clamp(dot(v, h), 0.0, 1.0);
		if (n_dot_l > 0.0) {
			float G = geometry_smith(n, v, l, roughness);
			float G_Vis = (G * v_dot_h) / (n_dot_h * n_dot_v);
			float Fc = pow(1.0 - v_dot_h, 5.0);
			A += Fc * G_Vis;
			B += G_Vis;
		}
		vec3 h_cloth = importance_uniform_sample(Xi);
		vec3 l_cloth = normalize(2.0 * dot(v, h_cloth) * h_cloth - v);
		float n_dot_l_cloth = clamp(l_cloth.z, 0.0, 1.0);
		float n_dot_h_cloth = clamp(h_cloth.z, 0.0, 1.0);
		float v_dot_h_cloth = clamp(dot(v, h_cloth), 0.0, 1.0);
		if (n_dot_l_cloth > 0.0) {
			C += visibility_ashikhmin(n_dot_v, n_dot_l_cloth) * distribution_charlie(n_dot_h_cloth, roughness) * n_dot_l_cloth * v_dot_h_cloth;
		}
	}
	A /= float(SAMPLE_COUNT);
	B /= float(SAMPLE_COUNT);
	C *= 4.0 * 2.0 * M_PI / float(SAMPLE_COUNT);
	out_dfg = vec4(A, B, C, 1.0);
}`;

/**
 * Integrates the table into a new RGBA16F target (linear, clamped) and returns its texture.
 * @param {import('./fullscreen.js').FullscreenQuad} quad
 */
export function integrateDfg(quad) {
  const target = new THREE.WebGLRenderTarget(DFG_SIZE, DFG_SIZE, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });
  const material = fullscreenMaterial(INTEGRATE_DFG, {});
  quad.draw(material, target);
  material.dispose();
  return target;
}
