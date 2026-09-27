// Chess piece material for PieceMeshes geometry: carved stone with metal trim,
// team cloth and emissive gems, driven by vertex-colour region masks
// (R = trim, G = cloth, B = emission amount, A = cavity; RGB 0 = stone).
// Adds a fresnel rim, selection glow, temper sheen, capture dissolve and a
// promotion shimmer. UV.y is the normalized piece height (0 = base, 1 = top).
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

group_uniforms stone;
/** Stone colour (ivory for the player, obsidian for the enemy). */
uniform vec4 albedo : source_color = vec4(0.87, 0.8, 0.68, 1.0);
uniform float roughness : hint_range(0.0, 1.0) = 0.55;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform float specular : hint_range(0.0, 1.0) = 0.5;
/** Strength of the worn-stone mottling and chisel marks. */
uniform float stone_wear : hint_range(0.0, 2.0) = 1.0;
/** Darkens the foot slightly so the piece sits on the board. */
uniform float foot_shade : hint_range(0.0, 1.0) = 0.15;

group_uniforms regions;
/** Metal trim (vertex colour R): gold for the player, red-bronze for the enemy. */
uniform vec4 accent_color : source_color = vec4(0.831, 0.635, 0.306, 1.0);
/** Self-illumination of the trim (a faint ember glow suits the enemy). */
uniform float accent_energy : hint_range(0.0, 4.0) = 0.0;
/** Team cloth (vertex colour G): tabards, banners, bridles. */
uniform vec4 cloth_color : source_color = vec4(0.184, 0.31, 0.604, 1.0);
/** Gems, eyes and seams (vertex colour B = emission amount). */
uniform vec4 gem_color : source_color = vec4(0.353, 0.627, 1.0, 1.0);
uniform float gem_energy : hint_range(0.0, 16.0) = 3.0;

group_uniforms rim;
uniform vec4 rim_color : source_color = vec4(0.62, 0.7, 0.86, 1.0);
uniform float rim_strength : hint_range(0.0, 4.0) = 0.3;
uniform float rim_power : hint_range(0.5, 8.0) = 3.0;

group_uniforms glow;
uniform vec4 glow_color : source_color = vec4(1.0, 0.78, 0.42, 1.0);
uniform float glow_strength : hint_range(0.0, 8.0) = 0.0;

group_uniforms temper;
/** Progression tier 0..3: the mesh carries the new trims; this adds sheen. */
uniform int temper_level : hint_range(0, 3) = 0;
/** Tint of the promotion shimmer. */
uniform vec4 temper_color : source_color = vec4(0.831, 0.635, 0.306, 1.0);

group_uniforms dissolve;
uniform float dissolve : hint_range(0.0, 1.0) = 0.0;
uniform vec4 dissolve_edge_color : source_color = vec4(1.0, 0.46, 0.12, 1.0);
uniform float dissolve_edge_width = 0.07;
uniform float dissolve_edge_energy = 5.0;
uniform float dissolve_noise_scale = 6.0;
/** 0 = pure noise, 1 = strictly top-down. */
uniform float dissolve_top_bias : hint_range(0.0, 1.0) = 0.35;

group_uniforms promotion;
uniform float promoted : hint_range(0.0, 1.0) = 0.0;
group_uniforms;

varying vec3 obj_pos;

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

// A uniform rather than a constant so the browser's Direct3D shader compiler keeps it as a loop.
uniform int fbm_octaves = 4;

float fbm(vec3 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < fbm_octaves; i++) {
		v += a * value_noise(p);
		p = p * 2.03 + vec3(17.1, 5.3, 11.7);
		a *= 0.5;
	}
	return v / 0.9375;
}

void vertex() {
	obj_pos = VERTEX;
}

void fragment() {
	float trim = COLOR.r;
	float cloth = COLOR.g;
	float glow_amount = COLOR.b;
	float cavity = COLOR.a;
	float is_glow = step(0.001, glow_amount);
	float stone_mask = clamp(1.0 - trim - cloth - is_glow, 0.0, 1.0);
	vec3 n = NORMAL;

	// Worn stone: broad mottling, fine grain and shallow chisel marks. The
	// bump fades out once the marks get smaller than a pixel.
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

	// Blend the regions; emissive regions take the gem (or hot trim) colour.
	vec3 base = stone * stone_mask + accent_color.rgb * trim * (1.0 - is_glow) + cloth_col * cloth + glow_col * is_glow;
	float rough = stone_rough * stone_mask + 0.38 * trim + 0.85 * cloth + 0.15 * is_glow * (1.0 - trim);
	float metal = metallic * stone_mask + 0.9 * trim;
	float spec = mix(specular, 0.75, temper * 0.5);
	base *= mix(0.3, 1.0, cavity);

	vec3 emission = vec3(0.0);
	float facing = clamp(dot(n, VIEW), 0.0, 1.0);
	// Metal in a dark scene has little to reflect; give trim a faint sheen.
	emission += accent_color.rgb * trim * (1.0 - is_glow) * (0.08 + accent_energy);
	emission += glow_col * glow_amount * gem_energy;
	// Cloth sheen at grazing angles, like velvet.
	emission += cloth_col * cloth * pow(1.0 - facing, 3.0) * 0.25;

	float fres = pow(1.0 - facing, rim_power);
	emission += rim_color.rgb * rim_strength * fres;
	// Selection glow: a bright rim that blooms into a halo, plus a lift of the
	// piece's own colour so it keeps its identity.
	float glow_rim = (1.0 - facing) * (1.0 - facing);
	emission += glow_strength * glow_color.rgb * (glow_rim * glow_rim + base * 0.3);

	if (promoted > 0.0) {
		// Regal shimmer: a gold rim and a glint rising up the piece.
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
	NORMAL = n;
}
