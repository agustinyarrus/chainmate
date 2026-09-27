/**
 * The game's shaders — shaders/*.gdshader and the inline STONE/SKY shaders of arena.gd — as
 * SpatialMaterial specs. Bodies are the original GLSL, verbatim apart from declarations moving into
 * `uniforms` / `varyings` / `functions` (render modes become `renderMode`).
 */
import { Color, Vector3 } from '../godot/math.js';

const c = (r, g, b, a = 1) => new Color(r, g, b, a);

// ─────────────────────────────────────────────────────────────── tile.gdshader ──────────────────
export const TILE_SHADER = {
  name: 'tile',
  renderMode: {},
  uniforms: {
    base_color: { type: 'vec4', value: c(0.804, 0.737, 0.635), source: true },
    roughness_base: { type: 'float', value: 0.78 },
    tint_color: { type: 'vec4', value: c(1.0, 0.8, 0.45), source: true },
    tint_strength: { type: 'float', value: 0.0 },
    tile_state: { type: 'int', value: 0 },
    variation: { type: 'float', value: 0.0 },
    octaves: { type: 'int', value: 5 },
    voronoi_reach: { type: 'int', value: 1 },
  },
  varyings: `
varying vec3 local_pos;
varying vec3 local_normal;
varying vec2 wear;`,
  functions: /* glsl */ `
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

float resolved(float cycles_per_pixel) {
	return 1.0 - smoothstep(0.15, 0.5, cycles_per_pixel);
}

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
}`,
  vertex: /* glsl */ `
	local_pos = VERTEX;
	local_normal = NORMAL;
	wear = UV2;`,
  fragment: /* glsl */ `
	float seed = variation * 91.7;
	vec2 offset = vec2(fract(variation * 13.37) * 40.0, fract(variation * 7.91) * 40.0);
	vec2 p = local_pos.xz + offset;
	vec2 side_uv = vec2(local_pos.x + local_pos.z, local_pos.y) + offset;
	float top = smoothstep(0.55, 0.85, local_normal.y);
	vec2 q = mix(side_uv, p, top);

	vec3 base = base_color.rgb;
	float luma = dot(base, vec3(0.299, 0.587, 0.114));
	float darkness = 1.0 - smoothstep(0.12, 0.45, luma);

	float px = length(fwidth(q));
	float blotch = fbm2_filtered(q * 2.3 + seed, px * 2.3);
	float stain = smoothstep(0.5, 0.72, fbm2(q * 3.4 - seed * 1.7));
	float speck = mix(0.5, noise2(q * 70.0), resolved(px * 70.0));
	vec3 albedo = base * (0.88 + 0.26 * blotch);
	albedo = mix(albedo, albedo * mix(vec3(0.74, 0.72, 0.74), vec3(1.25, 1.2, 1.16), darkness), stain * (0.35 + 0.35 * fract(variation * 5.3)));
	albedo *= 0.95 + 0.1 * speck;

	float cell_edge = voronoi_edge(q * (3.2 + fract(variation * 3.7) * 1.4) + seed);
	float craze = (1.0 - smoothstep(0.0, 0.018, cell_edge)) * smoothstep(0.35, 0.55, noise2(q * 2.1 + seed * 2.0));
	float crack_count = step(0.35, fract(variation * 11.3));
	float crack = crack_line(q * 1.4, seed, 0.022) * (0.4 + 0.6 * crack_count);
	float lines = max(craze * mix(0.25, 1.0, darkness), crack);
	vec3 line_color = mix(albedo * 0.58, albedo * 1.55 + vec3(0.035, 0.022, 0.01), darkness);
	albedo = mix(albedo, line_color, lines * 0.85);

	albedo = mix(albedo, albedo * (1.18 + 0.2 * darkness) + 0.02, wear.x * 0.55);
	albedo = mix(albedo, mix(albedo * 1.3, albedo * 1.8 + 0.05, darkness), wear.y * 0.7);
	float edge_dist = HALF - max(abs(local_pos.x), abs(local_pos.z));
	float grime = (1.0 - smoothstep(0.0, 0.07, edge_dist)) * (0.4 + 0.6 * noise2(q * 9.0 + seed)) * top;
	albedo *= 1.0 - grime * 0.18;

	float rough = roughness_base + (blotch - 0.5) * 0.16 + lines * 0.08 - stain * 0.04;
	float height = blotch * 0.004 + speck * 0.0012 - lines * 0.004 - wear.y * 0.002;
	vec3 emission = vec3(0.0);
	float specular = 0.45;

	if (tile_state == 1) {
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
	EMISSION = emission;`,
};

// ─────────────────────────────────────────────────────────────── piece.gdshader ─────────────────
export const PIECE_SHADER = {
  name: 'piece',
  renderMode: { discard: true },
  uniforms: {
    albedo: { type: 'vec4', value: c(0.87, 0.8, 0.68), source: true },
    roughness: { type: 'float', value: 0.55 },
    metallic: { type: 'float', value: 0.0 },
    specular: { type: 'float', value: 0.5 },
    stone_wear: { type: 'float', value: 1.0 },
    foot_shade: { type: 'float', value: 0.15 },
    accent_color: { type: 'vec4', value: c(0.831, 0.635, 0.306), source: true },
    accent_energy: { type: 'float', value: 0.0 },
    cloth_color: { type: 'vec4', value: c(0.184, 0.31, 0.604), source: true },
    gem_color: { type: 'vec4', value: c(0.353, 0.627, 1.0), source: true },
    gem_energy: { type: 'float', value: 3.0 },
    rim_color: { type: 'vec4', value: c(0.62, 0.7, 0.86), source: true },
    rim_strength: { type: 'float', value: 0.3 },
    rim_power: { type: 'float', value: 3.0 },
    glow_color: { type: 'vec4', value: c(1.0, 0.78, 0.42), source: true },
    glow_strength: { type: 'float', value: 0.0 },
    temper_level: { type: 'int', value: 0 },
    temper_color: { type: 'vec4', value: c(0.831, 0.635, 0.306), source: true },
    dissolve: { type: 'float', value: 0.0 },
    dissolve_edge_color: { type: 'vec4', value: c(1.0, 0.46, 0.12), source: true },
    dissolve_edge_width: { type: 'float', value: 0.07 },
    dissolve_edge_energy: { type: 'float', value: 5.0 },
    dissolve_noise_scale: { type: 'float', value: 6.0 },
    dissolve_top_bias: { type: 'float', value: 0.35 },
    promoted: { type: 'float', value: 0.0 },
    fbm_octaves: { type: 'int', value: 4 },
  },
  varyings: `varying vec3 obj_pos;`,
  functions: /* glsl */ `
float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float value_noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	float n000 = hash13(i);
	float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
	float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
	float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
	float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
	float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
	float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
	float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
	return mix(
		mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
		mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
		u.z);
}

float fbm(vec3 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < fbm_octaves; i++) {
		v += a * value_noise(p);
		p = p * 2.03 + vec3(17.1, 5.3, 11.7);
		a *= 0.5;
	}
	return v / 0.9375;
}`,
  vertex: `	obj_pos = VERTEX;`,
  fragment: /* glsl */ `
	float trim = COLOR.r;
	float cloth = COLOR.g;
	float glow_amount = COLOR.b;
	float cavity = COLOR.a;
	float is_glow = step(0.001, glow_amount);
	float stone_mask = clamp(1.0 - trim - cloth - is_glow, 0.0, 1.0);
	vec3 n = NORMAL;

	float blotch = value_noise(obj_pos * 7.0 + vec3(3.1, 7.7, 1.3));
	float grain = value_noise(obj_pos * 45.0);
	float marks = value_noise(obj_pos * vec3(22.0, 30.0, 22.0) + vec3(9.2, 0.0, 4.4));
	float marks_fade = clamp(1.0 - fwidth(marks) * 1.5, 0.0, 1.0);
	float bump = (marks - 0.5) * 0.0022 * stone_wear * marks_fade * stone_mask;
	vec3 dpdx = dFdx(VERTEX);
	vec3 dpdy = dFdy(VERTEX);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	if (abs(det) > 1e-12) {
		vec3 surf_grad = sign(det) * (dFdx(bump) * r1 + dFdy(bump) * r2);
		n = normalize(abs(det) * n - surf_grad);
	}

	float temper = float(clamp(temper_level, 0, 3)) / 3.0;
	vec3 stone = albedo.rgb * (1.0 + stone_wear * ((blotch - 0.5) * 0.14 + (grain - 0.5) * 0.07));
	stone *= mix(1.0 - foot_shade, 1.0, smoothstep(0.0, 0.25, UV.y));
	float stone_rough = clamp(roughness * (1.0 + (grain - 0.5) * 0.2 * stone_wear) * (1.0 - 0.2 * temper), 0.02, 1.0);

	vec3 cloth_col = cloth_color.rgb * (0.9 + 0.2 * grain);
	vec3 glow_col = mix(gem_color.rgb, accent_color.rgb, trim);

	vec3 base = stone * stone_mask + accent_color.rgb * trim * (1.0 - is_glow) + cloth_col * cloth + glow_col * is_glow;
	float rough = stone_rough * stone_mask + 0.38 * trim + 0.85 * cloth + 0.15 * is_glow * (1.0 - trim);
	float metal = metallic * stone_mask + 0.9 * trim;
	float spec = mix(specular, 0.75, temper * 0.5);
	base *= mix(0.3, 1.0, cavity);

	vec3 emission = vec3(0.0);
	float facing = clamp(dot(n, VIEW), 0.0, 1.0);
	emission += accent_color.rgb * trim * (1.0 - is_glow) * (0.08 + accent_energy);
	emission += glow_col * glow_amount * gem_energy;
	emission += cloth_col * cloth * pow(1.0 - facing, 3.0) * 0.25;

	float fres = pow(1.0 - facing, rim_power);
	emission += rim_color.rgb * rim_strength * fres;
	float glow_rim = (1.0 - facing) * (1.0 - facing);
	emission += glow_strength * glow_color.rgb * (glow_rim * glow_rim + base * 0.3);

	if (promoted > 0.0) {
		float sweep = fract(TIME * 0.4) * 1.5 - 0.25;
		float s = UV.y - sweep;
		float glint = exp(-s * s / 0.004);
		rough = mix(rough, rough * 0.65, promoted);
		spec = mix(spec, 0.8, promoted);
		emission += promoted * (temper_color.rgb * (0.45 * glint + 0.5 * pow(1.0 - facing, 4.0)) + base * temper_color.rgb * 0.6 * glint);
	}

	if (dissolve > 0.0) {
		float nz = clamp((fbm(obj_pos * dissolve_noise_scale) - 0.2) / 0.6, 0.0, 1.0);
		float field = mix(nz, 1.0 - UV.y, dissolve_top_bias);
		float t = dissolve * (1.0 + dissolve_edge_width) - dissolve_edge_width;
		if (field < t) {
			discard;
		}
		float edge = 1.0 - smoothstep(t, t + dissolve_edge_width, field);
		base *= mix(1.0, 0.12, 1.0 - smoothstep(t, t + dissolve_edge_width * 2.5, field));
		emission += dissolve_edge_color.rgb * dissolve_edge_energy * edge * edge;
	}

	ALBEDO = base;
	ROUGHNESS = rough;
	METALLIC = metal;
	SPECULAR = spec;
	EMISSION = emission;
	NORMAL = n;`,
};

// ─────────────────────────────────────────────────────────────── highlight.gdshader ─────────────
export const HIGHLIGHT_SHADER = {
  name: 'highlight',
  renderMode: { unshaded: true, alpha: true, depthDraw: 'never', cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    mode: { type: 'int', value: 0 },
    color: { type: 'vec4', value: c(0.31, 0.55, 1.0), source: true },
    accent: { type: 'vec4', value: c(1.0, 0.23, 0.19), source: true },
    strength: { type: 'float', value: 1.0 },
    glow: { type: 'float', value: 1.6 },
    phase: { type: 'float', value: 0.0 },
  },
  functions: /* glsl */ `
float box_sdf(vec2 p, vec2 b) {
	vec2 d = abs(p) - b;
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0);
}

float line(float d, float width) {
	return smoothstep(width, width * 0.3, abs(d));
}`,
  fragment: /* glsl */ `
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float t = TIME + phase;
	float d = box_sdf(p, vec2(0.86));
	float inner = smoothstep(0.06, -0.3, d);
	float a = 0.0;
	vec3 tint = color.rgb;
	if (mode == 1) {
		float breathe = 0.85 + 0.15 * sin(t * 2.4);
		a = inner * 0.3 * breathe + line(d, 0.05) * 0.95 + smoothstep(0.17, 0.11, r) * 0.9;
	} else if (mode == 2) {
		float pulse = 0.78 + 0.22 * sin(t * 3.6);
		float corners = step(0.5, abs(p.x)) * step(0.5, abs(p.y));
		a = inner * 0.34 * pulse + line(d, 0.05) * 0.8 + line(box_sdf(p, vec2(0.93)), 0.07) * corners;
	} else if (mode == 3) {
		a = inner * 0.38 + line(d, 0.06) * (0.85 + 0.15 * sin(t * 4.0));
	} else if (mode == 4) {
		float angle = atan(p.y, p.x);
		float dashes = 0.6 + 0.4 * step(0.0, sin(angle * 10.0 + t * 1.6));
		a = line(r - 0.8, 0.06) * dashes + smoothstep(0.85, 0.2, r) * 0.22;
	} else if (mode == 5) {
		a = line(box_sdf(p, vec2(0.92)), 0.03) * 0.6;
	} else if (mode == 6) {
		float pulse = 0.5 + 0.5 * sin(t * 5.0);
		a = inner * 0.3 * pulse + line(d, 0.08) * (0.4 + 0.6 * pulse);
	} else if (mode == 7) {
		float corners = step(0.55, abs(p.x)) * step(0.55, abs(p.y));
		a = line(box_sdf(p, vec2(0.9 - 0.035 * sin(t * 4.5))), 0.05) * corners;
	} else if (mode == 8) {
		float along = abs(p.x) > abs(p.y) ? p.y : p.x;
		float dash = step(0.0, sin(along * 12.0 - t * 2.0));
		a = line(box_sdf(p, vec2(0.78)), 0.022) * 0.7 * dash;
	} else if (mode == 9) {
		float breathe = 0.85 + 0.15 * sin(t * 2.4);
		float warn = smoothstep(0.3, 0.24, abs(p.x) + abs(p.y));
		a = max(inner * 0.26 * breathe + line(d, 0.05) * 0.9, warn);
		tint = mix(color.rgb, accent.rgb, warn);
	}
	ALBEDO = tint * glow;
	ALPHA = clamp(a * strength * color.a, 0.0, 1.0);`,
};

// ─────────────────────────────────────────────────────────────── cloth.gdshader ─────────────────
export const CLOTH_SHADER = {
  name: 'cloth',
  renderMode: { cull: 'disabled', backlight: true, discard: true },
  uniforms: {
    base_color: { type: 'vec3', value: c(0.42, 0.06, 0.07), source: true },
    trim_color: { type: 'vec3', value: c(0.85, 0.62, 0.26), source: true },
    trim_width: { type: 'float', value: 0.07 },
    emblem: { type: 'bool', value: true },
    swallowtail: { type: 'bool', value: true },
    trim_ends: { type: 'bool', value: false },
    wave: { type: 'float', value: 1.0 },
    phase: { type: 'float', value: 0.0 },
  },
  functions: /* glsl */ `
float box(vec2 p, vec2 b) {
	vec2 d = abs(p) - b;
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0);
}

float tri(vec2 p, vec2 a, vec2 b, vec2 c) {
	vec2 e0 = b - a, e1 = c - b, e2 = a - c;
	vec2 v0 = p - a, v1 = p - b, v2 = p - c;
	vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
	vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
	vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
	float s = sign(e0.x * e2.y - e0.y * e2.x);
	vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
		vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
		vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
	return -sqrt(d.x) * sign(d.y);
}

float crown(vec2 p) {
	float band = box(p - vec2(0.0, 0.1), vec2(0.22, 0.05));
	float spikes = min(tri(p, vec2(-0.24, 0.06), vec2(-0.2, -0.16), vec2(-0.07, 0.06)),
		min(tri(p, vec2(-0.09, 0.06), vec2(0.0, -0.22), vec2(0.09, 0.06)),
			tri(p, vec2(0.07, 0.06), vec2(0.2, -0.16), vec2(0.24, 0.06))));
	float jewels = min(length(p - vec2(-0.2, -0.18)), min(length(p - vec2(0.0, -0.25)), length(p - vec2(0.2, -0.18)))) - 0.035;
	return min(min(band, spikes), jewels);
}

float free_edge(float x) {
	return swallowtail ? 1.0 - 0.14 * (1.0 - abs(x * 2.0 - 1.0)) : 1.0;
}`,
  vertex: /* glsl */ `
	float t = TIME * 1.3 + phase;
	float sway = sin(UV.y * 5.0 - t * 1.7 + UV.x * 1.5) * 0.035 + sin(UV.y * 11.0 - t * 2.9) * 0.01;
	VERTEX.z += sway * UV.y * wave;
	VERTEX.x += sin(t * 0.8 + UV.y * 2.0) * 0.015 * UV.y * wave;`,
  fragment: /* glsl */ `
	vec2 uv = UV;
	float edge_y = free_edge(uv.x);
	if (uv.y > edge_y) {
		discard;
	}
	float d_side = min(uv.x, 1.0 - uv.x);
	float d_end = trim_ends ? min(uv.y, edge_y - uv.y) : edge_y - uv.y;
	if (!trim_ends && !swallowtail) {
		d_end = 1.0;
	}
	float d = min(d_side, d_end * 0.6);
	float trim = smoothstep(trim_width, trim_width - 0.008, d) * smoothstep(0.0, 0.01, d);
	float inner_line = smoothstep(0.006, 0.0, abs(d - trim_width * 1.45));
	vec3 color = base_color;
	float weave = sin(uv.x * 420.0) * sin(uv.y * 380.0) * 0.5 + 0.5;
	float folds = sin(uv.x * 18.0 + sin(uv.y * 3.0) * 1.5) * 0.5 + 0.5;
	color *= 0.82 + 0.18 * folds;
	color *= 0.94 + 0.06 * weave;
	float gold = max(trim, inner_line * 0.9);
	if (emblem) {
		float c = crown((uv - vec2(0.5, 0.4)) * vec2(1.0, 1.6) * 1.25);
		gold = max(gold, smoothstep(0.012, 0.0, c));
	}
	color = mix(color, trim_color * (0.85 + 0.15 * weave), gold);
	ALBEDO = color;
	ROUGHNESS = mix(0.86, 0.45, gold);
	METALLIC = gold * 0.6;
	SPECULAR = 0.3 + gold * 0.3;
	BACKLIGHT = base_color * 0.25;`,
};

// ─────────────────────────────────────────────────────────────── flame.gdshader ─────────────────
export const FLAME_SHADER = {
  name: 'flame',
  renderMode: { unshaded: true, blend: 'add', depthDraw: 'never', cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    core_color: { type: 'vec4', value: c(1.0, 0.86, 0.55), source: true },
    edge_color: { type: 'vec4', value: c(1.0, 0.36, 0.08), source: true },
    energy: { type: 'float', value: 1.8 },
    seed: { type: 'float', value: 0.0 },
  },
  vertex: /* glsl */ `
	vec3 scale = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), length(MODEL_MATRIX[2].xyz));
	vec3 right = normalize(vec3(INV_VIEW_MATRIX[0].x, 0.0, INV_VIEW_MATRIX[0].z) + vec3(0.0001, 0.0, 0.0));
	vec3 back = cross(right, vec3(0.0, 1.0, 0.0));
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(right * scale.x, 0.0), vec4(0.0, scale.y, 0.0, 0.0), vec4(back * scale.z, 0.0), MODEL_MATRIX[3]);`,
  fragment: /* glsl */ `
	float t = TIME * 6.5 + seed;
	float y = UV.y;
	float x = UV.x * 2.0 - 1.0;
	x += sin(t + y * 4.0) * 0.1 * (1.0 - y);
	float width = 0.62 * pow(y, 0.65) * (1.0 - smoothstep(0.8, 1.0, y) * 0.5);
	float d = abs(x) / max(width, 0.001);
	float body = (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.88, 1.0, y));
	float hot = (1.0 - smoothstep(0.15, 0.6, d)) * smoothstep(0.45, 0.7, y) * (1.0 - smoothstep(0.9, 1.0, y));
	float flicker = 0.85 + 0.15 * sin(t * 1.7) * sin(t * 2.9 + 1.0);
	ALBEDO = mix(edge_color.rgb, core_color.rgb, hot) * energy * flicker;
	ALPHA = clamp(body * flicker, 0.0, 1.0);`,
};

// ─────────────────────────────────────────────────────────────── foliage.gdshader ───────────────
export const FOLIAGE_SHADER = {
  name: 'foliage',
  renderMode: { cull: 'disabled', backlight: true, discard: true },
  uniforms: {
    shape: { type: 'int', value: 0 },
    sway: { type: 'float', value: 1.0 },
  },
  varyings: `varying float sway_amount;`,
  functions: /* glsl */ `
float leaf_mask(vec2 uv) {
	vec2 p = uv * 2.0 - 1.0;
	if (shape == 1) {
		float a = atan(p.x, -p.y);
		float r = length(p);
		float lobes = 0.62 + 0.3 * pow(abs(cos(a * 2.5)), 0.6);
		float stem = step(abs(p.x), 0.04) * step(0.3, p.y);
		return max(step(r, lobes) * step(p.y, 0.78), stem);
	} else if (shape == 2) {
		float w = 0.36 * pow(max(1.0 - p.y * p.y, 0.0), 0.7);
		return step(abs(p.x), w);
	}
	float y = uv.y;
	float w = 0.5 * pow(sin(3.14159 * clamp(y, 0.0, 1.0)), 0.75) + 0.08 * sin(y * 9.0);
	float notch = step(y, 0.1) * step(abs(p.x), 0.12);
	return step(abs(p.x) * 0.5, w * 0.5) * (1.0 - notch);
}`,
  vertex: /* glsl */ `
	sway_amount = COLOR.a;
	vec3 world = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float t = TIME * 1.4 + world.x * 1.7 + world.z * 1.3;
	VERTEX += vec3(sin(t), 0.0, cos(t * 0.8)) * 0.02 * sway * sway_amount * UV.y;`,
  fragment: /* glsl */ `
	float mask = leaf_mask(UV);
	if (mask < 0.5) {
		discard;
	}
	vec2 p = UV * 2.0 - 1.0;
	float vein = smoothstep(0.035, 0.0, abs(p.x)) * 0.35;
	float side_veins = smoothstep(0.04, 0.0, abs(fract((UV.y + abs(p.x) * 0.8) * 5.0) - 0.5) * 0.3) * 0.12;
	vec3 color = COLOR.rgb * (0.85 + 0.25 * (1.0 - UV.y));
	color *= 1.0 - vein * 0.4 + side_veins * 0.2;
	ALBEDO = color;
	ROUGHNESS = 0.62;
	SPECULAR = 0.35;
	BACKLIGHT = COLOR.rgb * 0.45;`,
};

// ─────────────────────────────────────────────────────────────── glow_ring.gdshader ─────────────
export const GLOW_RING_SHADER = {
  name: 'glow_ring',
  renderMode: { unshaded: true, blend: 'add', depthDraw: 'never', cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    color: { type: 'vec4', value: c(1.0, 0.6, 0.3), source: true },
    progress: { type: 'float', value: 0.0 },
    intensity: { type: 'float', value: 2.5 },
    thickness: { type: 'float', value: 0.08 },
  },
  fragment: /* glsl */ `
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float radius = mix(0.1, 0.95, progress);
	float ring = smoothstep(thickness, 0.0, abs(r - radius));
	float fade = 1.0 - progress;
	ALBEDO = color.rgb * intensity;
	ALPHA = ring * fade * fade;`,
};

// ─────────────────────────────────────────────────────────────── route.gdshader ─────────────────
export const ROUTE_SHADER = {
  name: 'route',
  renderMode: { unshaded: true, blend: 'add', depthDraw: 'never', cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    color: { type: 'vec4', value: c(1.0, 0.78, 0.36), source: true },
    intensity: { type: 'float', value: 2.2 },
    dash_density: { type: 'float', value: 3.0 },
    flow_speed: { type: 'float', value: 1.4 },
    opacity: { type: 'float', value: 1.0 },
  },
  fragment: /* glsl */ `
	float across = abs(UV.y * 2.0 - 1.0);
	float core = smoothstep(1.0, 0.0, across);
	float dash = 0.35 + 0.65 * smoothstep(0.35, 0.65, fract(UV.x * dash_density - TIME * flow_speed));
	ALBEDO = color.rgb * intensity;
	ALPHA = core * core * dash * opacity;`,
};

// ─────────────────────────────────────────────────────────────── wood.gdshader ──────────────────
export const WOOD_SHADER = {
  name: 'wood',
  renderMode: {},
  uniforms: {
    wood_light: { type: 'vec3', value: c(0.42, 0.27, 0.15), source: true },
    wood_dark: { type: 'vec3', value: c(0.2, 0.12, 0.07), source: true },
    half_size: { type: 'vec3', value: new Vector3(0.2, 0.2, 0.2) },
    planks: { type: 'float', value: 4.0 },
    framed: { type: 'bool', value: true },
  },
  varyings: `
varying vec3 local;
varying vec3 local_normal;`,
  functions: /* glsl */ `
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
  vertex: /* glsl */ `
	local = VERTEX;
	local_normal = NORMAL;`,
  fragment: /* glsl */ `
	vec3 n = abs(local_normal);
	vec2 face = n.x > 0.5 ? local.zy : (n.y > 0.5 ? local.xz : local.xy);
	vec2 extent = n.x > 0.5 ? half_size.zy : (n.y > 0.5 ? half_size.xz : half_size.xy);
	vec2 q = (face / extent) * 0.5 + 0.5;
	float row = floor(q.y * planks);
	float seam = smoothstep(0.035, 0.0, abs(fract(q.y * planks) - 0.5) - 0.465);
	float grain = noise(vec2(q.x * 3.0 + row * 7.0, q.y * planks * 18.0)) * 0.6 + noise(vec2(q.x * 22.0, row * 3.0 + q.y * 40.0)) * 0.4;
	vec3 color = mix(wood_dark, wood_light, 0.35 + 0.5 * grain + 0.15 * hash(vec2(row, 3.0)));
	color *= 1.0 - seam * 0.55;
	if (framed) {
		vec2 edge = min(q, 1.0 - q);
		float frame = smoothstep(0.1, 0.09, min(edge.x, edge.y));
		color = mix(color, wood_dark * 1.25 * (0.8 + 0.4 * grain), frame);
		float nail = 0.0;
		for (int i = 0; i < 4; i++) {
			vec2 corner = vec2(float(i % 2), float(i / 2)) * 0.9 + 0.05;
			nail = max(nail, smoothstep(0.02, 0.012, length(q - corner)));
		}
		color = mix(color, vec3(0.08, 0.075, 0.07), nail);
	}
	ALBEDO = color;
	ROUGHNESS = 0.82 - grain * 0.1;
	SPECULAR = 0.3;`,
};

// ─────────────────────────────────────────────────────────────── arena.gd STONE_SHADER ──────────
const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p3) {
	p3 = fract(p3 * 0.1031);
	p3 += dot(p3, p3.zyx + 31.32);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
			mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
		mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
			mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
	float total = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < noise_octaves; i++) {
		total += amplitude * vnoise(p);
		p = p * 2.03 + vec3(1.7, 9.2, 4.1);
		amplitude *= 0.5;
	}
	return total;
}
float resolved(float cycles_per_pixel) {
	return 1.0 - smoothstep(0.15, 0.5, cycles_per_pixel);
}
float fbm_filtered(vec3 p, float px) {
	float total = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < noise_octaves; i++) {
		total += amplitude * mix(0.5, vnoise(p), resolved(px));
		p = p * 2.03 + vec3(1.7, 9.2, 4.1);
		px *= 2.03;
		amplitude *= 0.5;
	}
	return total;
}
float limit_roughness(vec3 normal, float roughness) {
	vec3 dndx = dFdx(normal);
	vec3 dndy = dFdy(normal);
	float variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
	return sqrt(clamp(roughness * roughness + min(2.0 * variance, 0.18), 0.0, 1.0));
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
}`;

export const STONE_SHADER = {
  name: 'stone',
  renderMode: {},
  uniforms: {
    stone_a: { type: 'vec3', value: c(0.47, 0.425, 0.39), source: true },
    stone_b: { type: 'vec3', value: c(0.36, 0.34, 0.345), source: true },
    stone_edge: { type: 'vec3', value: c(0.66, 0.6, 0.53), source: true },
    moss_a: { type: 'vec3', value: c(0.2, 0.27, 0.07), source: true },
    moss_b: { type: 'vec3', value: c(0.44, 0.47, 0.14), source: true },
    moss: { type: 'float', value: 0.7 },
    wet: { type: 'float', value: 0.0 },
    rough: { type: 'float', value: 0.86 },
    noise_octaves: { type: 'int', value: 4 },
  },
  varyings: `
varying vec3 world_pos;
varying vec3 world_normal;
varying vec4 tint;
varying vec2 wear;
varying vec2 local;
varying vec3 origin;`,
  functions: NOISE_GLSL,
  vertex: /* glsl */ `
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	tint = COLOR;
	wear = UV2;
	local = UV;
	origin = MODEL_MATRIX[3].xyz;`,
  fragment: /* glsl */ `
	vec3 p = world_pos;
	float px = length(fwidth(p));
	float broad = fbm(p * 1.9 + origin * 1.7);
	float mid = fbm_filtered(p * 6.1 + 13.0, px * 6.1);
	float fine = mix(0.5, vnoise(p * 31.0), resolved(px * 31.0));
	vec3 color = mix(stone_a, stone_b, smoothstep(0.32, 0.68, broad));
	color *= tint.rgb;
	color *= 0.84 + 0.3 * mid;
	color *= 0.93 + 0.14 * fine;
	vec3 w = p * 2.6 + origin;
	float crack_noise = fbm(w + vec3(fbm(w * 1.7), 0.0, fbm(w * 1.7 + 5.0)) * 0.6);
	float crack = (1.0 - smoothstep(0.0, 0.012, abs(crack_noise - 0.5))) * smoothstep(0.5, 0.7, vnoise(p * 1.3 + origin));
	color *= 1.0 - crack * 0.55;
	color = mix(color, stone_edge * tint.rgb, wear.x * 0.5);
	color = mix(color, stone_edge * 1.05, wear.y * 0.55);
	float up = clamp(world_normal.y, 0.0, 1.0);
	float foot = smoothstep(-0.55, -0.95, local.x) * (1.0 - up);
	float field = fbm(p * 3.3 + vec3(7.0, 3.0, 1.0));
	float grow = field * (0.45 + 0.55 * max(up, foot)) + tint.a * 0.38 - wear.y * 0.2;
	float m = smoothstep(0.58, 0.7, grow) * moss * step(0.001, tint.a);
	vec3 moss_color = mix(moss_a, moss_b, smoothstep(0.3, 0.8, fine * 0.5 + mid * 0.7));
	color = mix(color, moss_color, m);
	float height = mid * 0.012 + fine * 0.004 - crack * 0.01 + m * fine * 0.01;
	vec3 normal = perturb_normal(VERTEX, NORMAL, height);
	NORMAL = normal;
	ALBEDO = color;
	float r = rough + (mid - 0.5) * 0.2 + m * 0.08 - crack * 0.1;
	ROUGHNESS = limit_roughness(normal, clamp(mix(r, r * 0.45, wet * (1.0 - up * 0.5)), 0.08, 1.0));
	SPECULAR = 0.35 + wet * 0.2;`,
};

// ─────────────────────────────────────────────────────────────── arena.gd SKY_SHADER ────────────
/** Body of Godot's sky(): EYEDIR in, COLOR out (used for the background and the radiance cube). */
export const SKY_FUNCTION = /* glsl */ `
uniform vec3 top_color;
uniform vec3 horizon_color;
uniform vec3 bottom_color;
uniform vec3 glow_color;
uniform vec3 glow_dir;
vec3 gd_sky(vec3 EYEDIR) {
	float y = EYEDIR.y;
	vec3 color = mix(horizon_color, top_color, gd_smoothstep(0.0, 0.55, y));
	color = mix(color, bottom_color, gd_smoothstep(0.02, -0.75, y));
	vec3 flat_dir = normalize(vec3(EYEDIR.x, 0.0, EYEDIR.z) + vec3(0.0001));
	float toward = max(dot(flat_dir, normalize(glow_dir)), 0.0);
	float glow = pow(toward, 3.0) * exp(-abs(y + 0.18) * 4.0);
	color += glow_color * glow * 0.35;
	return color;
}`;
