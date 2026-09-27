shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;

// Heavy woven cloth for hanging banners and draped runners (board-kit reference): a deep base colour,
// gold trim bands along the edges and an optional gold crown emblem. UV.x runs across the cloth, UV.y
// from the hanging edge (0) to the free edge (1). Banners sway from the top; runners stay still.

uniform vec3 base_color : source_color = vec3(0.42, 0.06, 0.07);
uniform vec3 trim_color : source_color = vec3(0.85, 0.62, 0.26);
uniform float trim_width = 0.07;
uniform bool emblem = true;
uniform bool swallowtail = true;
uniform bool trim_ends = false;
uniform float wave = 1.0;
uniform float phase = 0.0;

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

// A three-pointed crown with jewels, centred at the origin, about 0.5 wide.
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
}

void vertex() {
	float t = TIME * 1.3 + phase;
	float sway = sin(UV.y * 5.0 - t * 1.7 + UV.x * 1.5) * 0.035 + sin(UV.y * 11.0 - t * 2.9) * 0.01;
	VERTEX.z += sway * UV.y * wave;
	VERTEX.x += sin(t * 0.8 + UV.y * 2.0) * 0.015 * UV.y * wave;
}

void fragment() {
	vec2 uv = UV;
	float edge_y = free_edge(uv.x);
	if (uv.y > edge_y) {
		discard;
	}
	// Distance to the nearest edge in cloth units (the free edge follows the swallowtail).
	float d_side = min(uv.x, 1.0 - uv.x);
	float d_end = trim_ends ? min(uv.y, edge_y - uv.y) : edge_y - uv.y;
	if (!trim_ends && !swallowtail) {
		d_end = 1.0;
	}
	float d = min(d_side, d_end * 0.6);
	float trim = smoothstep(trim_width, trim_width - 0.008, d) * smoothstep(0.0, 0.01, d);
	float inner_line = smoothstep(0.006, 0.0, abs(d - trim_width * 1.45));
	vec3 color = base_color;
	// Weave and soft folds.
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
	BACKLIGHT = base_color * 0.25;
}
