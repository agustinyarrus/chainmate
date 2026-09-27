shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

// A small candle or lantern flame on an upright billboard quad: a flickering teardrop with a hot core.
// UV.y runs from the tip (0) to the base (1).

uniform vec4 core_color : source_color = vec4(1.0, 0.86, 0.55, 1.0);
uniform vec4 edge_color : source_color = vec4(1.0, 0.36, 0.08, 1.0);
uniform float energy = 1.8;
uniform float seed = 0.0;

void vertex() {
	vec3 scale = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), length(MODEL_MATRIX[2].xyz));
	vec3 right = normalize(vec3(INV_VIEW_MATRIX[0].x, 0.0, INV_VIEW_MATRIX[0].z) + vec3(0.0001, 0.0, 0.0));
	vec3 back = cross(right, vec3(0.0, 1.0, 0.0));
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(right * scale.x, 0.0), vec4(0.0, scale.y, 0.0, 0.0), vec4(back * scale.z, 0.0), MODEL_MATRIX[3]);
}

void fragment() {
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
	ALPHA = clamp(body * flicker, 0.0, 1.0);
}
