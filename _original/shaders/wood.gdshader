shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

// Weathered planks for crates, poles and shelves. Planks run along local X, stacked along local Y;
// `half_size` (the box's half extents) darkens a frame around each face like the reference crates.

uniform vec3 wood_light : source_color = vec3(0.42, 0.27, 0.15);
uniform vec3 wood_dark : source_color = vec3(0.2, 0.12, 0.07);
uniform vec3 half_size = vec3(0.2, 0.2, 0.2);
uniform float planks = 4.0;
uniform bool framed = true;

varying vec3 local;
varying vec3 local_normal;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void vertex() {
	local = VERTEX;
	local_normal = NORMAL;
}

void fragment() {
	vec3 n = abs(local_normal);
	// Face coordinates: planks run across the face's wider axis.
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
	SPECULAR = 0.3;
}
