/**
 * Best-fit normals — the 1024×1024 table behind `encode24()`: for each direction, the length that
 * loses least when the vector is stored in 8 bits per channel (Kaplanyan, CryEngine 3; Godot's
 * shaders/forward_clustered/best_fit_normal.glsl). With it the normal buffer holds the very bytes
 * the engine's holds, so what SSAO and SSIL read is the same.
 *
 * One pass, 126 candidate lengths per texel, run once at start-up: O(size² · candidates).
 */
import * as THREE from 'three';
import { fullscreenMaterial } from './fullscreen.js';

export const BEST_FIT_SIZE = 1024;

const BEST_FIT_NORMAL = /* glsl */ `
layout(location = 0) out vec4 out_scale;

vec3 quantize(vec3 c) {
	return round(clamp(c * 0.5 + 0.5, 0.0, 1.0) * 255.0) * (1.0 / 255.0) * 2.0 - 1.0;
}

float find_minimum_error(vec3 normal) {
	float min_error = 100000.0;
	float t_best = 0.0;
	for (float nstep = 1.5; nstep < 127.5; ++nstep) {
		float t = nstep / 127.5;
		vec3 vp = normal * t;
		vec3 quantizedp = quantize(vp);
		vec3 vdiff = (quantizedp - vp) / t;
		float error = max(abs(vdiff.x), max(abs(vdiff.y), abs(vdiff.z)));
		if (error < min_error) {
			min_error = error;
			t_best = t;
		}
	}
	return t_best;
}

void main() {
	vec2 uv = floor(gl_FragCoord.xy) * vec2(1.0 / ${BEST_FIT_SIZE}.0) + vec2(0.5 / ${BEST_FIT_SIZE}.0);
	uv.y *= uv.x;
	vec3 dir = vec3(uv.x, uv.y, 1.0);
	out_scale = vec4(find_minimum_error(dir), 1.0, 1.0, 1.0);
}`;

/**
 * Computes the table into a new R8 target (nearest, clamped) and returns it.
 * @param {import('./fullscreen.js').FullscreenQuad} quad
 */
export function computeBestFitNormals(quad) {
  const target = new THREE.WebGLRenderTarget(BEST_FIT_SIZE, BEST_FIT_SIZE, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  });
  const material = fullscreenMaterial(BEST_FIT_NORMAL, {});
  quad.draw(material, target);
  material.dispose();
  return target;
}
