shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// Board tile stone. Everything is procedural in object space so a tile keeps its look wherever it
// moves; `variation` reseeds the pattern per tile (wear, cracks, stains, chips).

uniform vec4 base_color : source_color = vec4(0.804, 0.737, 0.635, 1.0);
uniform float roughness_base = 0.78;
uniform vec4 tint_color : source_color = vec4(1.0, 0.8, 0.45, 1.0);
uniform float tint_strength = 0.0;
uniform int tile_state = 0;
uniform float variation = 0.0;
// Loop lengths are uniforms rather than constants so shader compilers keep them as loops: the
// Direct3D compiler behind browsers on Windows unrolls constant loops and takes seconds on the result.
uniform int octaves = 5;
uniform int voronoi_reach = 1;

varying vec3 local_pos;
varying vec3 local_normal;
varying vec2 wear;

const float HALF = 0.4825;
const float TOP = 0.08;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
		mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 1 while a noise of this many cycles per pixel is still resolved, fading to 0 as it becomes
// finer than the pixels (where it would only shimmer).
float resolved(float cycles_per_pixel) {
	return 1.0 - smoothstep(0.15, 0.5, cycles_per_pixel);
}

// fbm2 with each octave faded out once it is finer than the pixels. `px` is the size of one pixel
// in p's units (length(fwidth(p))).
float fbm2_filtered(vec2 p, float px) {
	float total = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < octaves; i++) {
		total += amplitude * mix(0.5, noise2(p), resolved(px));
		p = p * 2.03 + vec2(1.7, 9.2);
		px *= 2.03;
		amplitude *= 0.5;
	}
	return total;
}

// Specular anti-aliasing: roughens the surface where its normal changes faster than the pixels
// can show (the screen-space roughness limiter, which the Compatibility renderer lacks).
float limit_roughness(vec3 normal, float roughness) {
	vec3 dndx = dFdx(normal);
	vec3 dndy = dFdy(normal);
	float variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
	return sqrt(clamp(roughness * roughness + min(2.0 * variance, 0.18), 0.0, 1.0));
}

float fbm2(vec2 p) {
	float total = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < octaves; i++) {
		total += amplitude * noise2(p);
		p = p * 2.03 + vec2(1.7, 9.2);
		amplitude *= 0.5;
	}
	return total;
}

// Distance to the nearest Voronoi cell border (for crazing and crack networks).
float voronoi_edge(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	vec2 nearest_offset = vec2(0.0);
	vec2 nearest = vec2(0.0);
	float best = 8.0;
	for (int y = -voronoi_reach; y <= voronoi_reach; y++) {
		for (int x = -voronoi_reach; x <= voronoi_reach; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 r = g + hash22(cell + g) - f;
			float d = dot(r, r);
			if (d < best) {
				best = d;
				nearest = r;
				nearest_offset = g;
			}
		}
	}
	float edge = 8.0;
	for (int y = -voronoi_reach - 1; y <= voronoi_reach + 1; y++) {
		for (int x = -voronoi_reach - 1; x <= voronoi_reach + 1; x++) {
			vec2 g = nearest_offset + vec2(float(x), float(y));
			vec2 r = g + hash22(cell + g) - f;
			vec2 diff = r - nearest;
			if (dot(diff, diff) > 0.00001) {
				edge = min(edge, dot(0.5 * (nearest + r), normalize(diff)));
			}
		}
	}
	return edge;
}

// Thin meandering crack: zero crossing of warped noise, broken up so it starts and stops.
float crack_line(vec2 p, float seed, float width) {
	vec2 q = p + vec2(fbm2(p * 1.3 + seed), fbm2(p * 1.3 - seed)) * 0.9;
	float n = fbm2(q * 1.6 + seed * 3.1) - 0.5;
	float line = 1.0 - smoothstep(0.0, width, abs(n));
	float breakup = smoothstep(0.42, 0.62, noise2(p * 1.1 + seed * 7.0));
	return line * breakup;
}

vec3 perturb_normal(vec3 position, vec3 normal, float height) {
	vec3 dpx = dFdx(position);
	vec3 dpy = dFdy(position);
	float dhx = dFdx(height);
	float dhy = dFdy(height);
	vec3 r1 = cross(dpy, normal);
	vec3 r2 = cross(normal, dpx);
	float det = dot(dpx, r1);
	vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
	return normalize(abs(det) * normal - grad);
}

void vertex() {
	local_pos = VERTEX;
	local_normal = NORMAL;
	wear = UV2;
}

void fragment() {
	float seed = variation * 91.7;
	vec2 offset = vec2(fract(variation * 13.37) * 40.0, fract(variation * 7.91) * 40.0);
	// Top-face coordinates; the sides reuse them wrapped around so stains continue over the edges.
	vec2 p = local_pos.xz + offset;
	vec2 side_uv = vec2(local_pos.x + local_pos.z, local_pos.y) + offset;
	float top = smoothstep(0.55, 0.85, local_normal.y);
	vec2 q = mix(side_uv, p, top);

	vec3 base = base_color.rgb;
	float luma = dot(base, vec3(0.299, 0.587, 0.114));
	float darkness = 1.0 - smoothstep(0.12, 0.45, luma);

	// One pixel's size in q units: fine detail fades out as the tile gets smaller on screen.
	float px = length(fwidth(q));
	// Broad blotches and stains (the reference stone has soft darker patches).
	float blotch = fbm2_filtered(q * 2.3 + seed, px * 2.3);
	float stain = smoothstep(0.5, 0.72, fbm2(q * 3.4 - seed * 1.7));
	float speck = mix(0.5, noise2(q * 70.0), resolved(px * 70.0));
	vec3 albedo = base * (0.88 + 0.26 * blotch);
	albedo = mix(albedo, albedo * mix(vec3(0.74, 0.72, 0.74), vec3(1.25, 1.2, 1.16), darkness), stain * (0.35 + 0.35 * fract(variation * 5.3)));
	albedo *= 0.95 + 0.1 * speck;

	// Crazing on dark slate, sparse cracks on light stone. Cracks catch light on dark tiles.
	float cell_edge = voronoi_edge(q * (3.2 + fract(variation * 3.7) * 1.4) + seed);
	float craze = (1.0 - smoothstep(0.0, 0.018, cell_edge)) * smoothstep(0.35, 0.55, noise2(q * 2.1 + seed * 2.0));
	float crack_count = step(0.35, fract(variation * 11.3));
	float crack = crack_line(q * 1.4, seed, 0.022) * (0.4 + 0.6 * crack_count);
	float lines = max(craze * mix(0.25, 1.0, darkness), crack);
	vec3 line_color = mix(albedo * 0.58, albedo * 1.55 + vec3(0.035, 0.022, 0.01), darkness);
	albedo = mix(albedo, line_color, lines * 0.85);

	// Worn bevels read lighter; chipped spots show fresher, paler stone.
	albedo = mix(albedo, albedo * (1.18 + 0.2 * darkness) + 0.02, wear.x * 0.55);
	albedo = mix(albedo, mix(albedo * 1.3, albedo * 1.8 + 0.05, darkness), wear.y * 0.7);
	// Faint grime creeping in from the edges of the top face.
	float edge_dist = HALF - max(abs(local_pos.x), abs(local_pos.z));
	float grime = (1.0 - smoothstep(0.0, 0.07, edge_dist)) * (0.4 + 0.6 * noise2(q * 9.0 + seed)) * top;
	albedo *= 1.0 - grime * 0.18;

	float rough = roughness_base + (blotch - 0.5) * 0.16 + lines * 0.08 - stain * 0.04;
	float height = blotch * 0.004 + speck * 0.0012 - lines * 0.004 - wear.y * 0.002;
	vec3 emission = vec3(0.0);
	float specular = 0.45;

	if (tile_state == 1) {
		// Enchanted: moss overgrowth with a soft green glow.
		float moss_field = fbm2(q * 3.1 + seed * 0.7);
		float moss_edge = (1.0 - smoothstep(0.0, 0.12, edge_dist)) * 0.18;
		float moss = smoothstep(0.43, 0.52, moss_field + moss_edge);
		float tuft = mix(0.5, noise2(q * 42.0), resolved(px * 42.0));
		vec3 moss_color = mix(vec3(0.16, 0.30, 0.05), vec3(0.42, 0.56, 0.12), tuft * 0.7 + moss_field * 0.3);
		albedo = mix(albedo, moss_color, moss);
		rough = mix(rough, 0.92, moss);
		height += moss * (0.004 + tuft * 0.003);
		float pulse = 0.8 + 0.2 * sin(TIME * 1.6 + seed);
		emission = vec3(0.10, 0.32, 0.05) * moss * (0.35 + 0.65 * tuft) * pulse;
	} else if (tile_state == 2) {
		// Corrupted: stone blackened and split by glowing red fissures.
		float fissure_edge = voronoi_edge(q * 2.6 + seed * 1.3);
		float fissure = 1.0 - smoothstep(0.0, 0.03, fissure_edge);
		float fissure_core = 1.0 - smoothstep(0.0, 0.011, fissure_edge);
		float rim = wear.x;
		albedo = mix(albedo * vec3(0.22, 0.2, 0.22), vec3(0.05, 0.035, 0.04), 0.55);
		albedo = mix(albedo, vec3(0.2, 0.02, 0.01), fissure);
		rough = mix(0.5, 0.9, fissure);
		height -= fissure * 0.006;
		float pulse = 0.75 + 0.25 * sin(TIME * 2.3 + seed + q.x * 3.0);
		emission = vec3(1.0, 0.09, 0.03) * (fissure_core * 3.2 + fissure * 0.7 + rim * 0.9) * pulse;
	} else if (tile_state == 3) {
		// Frozen: a pale icy crust with darker frozen patches and a cold rim glow.
		float patches = smoothstep(0.42, 0.62, fbm2(q * 3.0 + seed * 0.4));
		vec3 ice = mix(vec3(0.84, 0.9, 0.97), vec3(0.46, 0.54, 0.66), patches);
		ice = mix(ice, ice * 0.62, darkness * 0.45);
		float frost = mix(0.5, noise2(q * 55.0), resolved(px * 55.0));
		albedo = mix(ice, vec3(0.95, 0.98, 1.0), smoothstep(0.75, 0.95, frost) * 0.5);
		rough = 0.18 + patches * 0.2 + frost * 0.08;
		specular = 0.65;
		height = patches * 0.003 + frost * 0.0015;
		float rim_glow = wear.x * 0.9 + (1.0 - smoothstep(0.0, 0.05, edge_dist)) * 0.4;
		emission = vec3(0.35, 0.58, 1.0) * rim_glow * 0.55 + vec3(0.25, 0.35, 0.5) * (1.0 - patches) * 0.06;
	}

	albedo = mix(albedo, tint_color.rgb, tint_strength * 0.55);
	emission += tint_color.rgb * tint_strength * 0.9;

	vec3 normal = perturb_normal(VERTEX, NORMAL, height);
	NORMAL = normal;
	ALBEDO = albedo;
	ROUGHNESS = limit_roughness(normal, clamp(rough, 0.05, 1.0));
	SPECULAR = specular;
	EMISSION = emission;
}
