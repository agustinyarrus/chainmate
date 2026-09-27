shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley;

// Dark flagstone floor far below the plinth. It catches pools of light and fades into the void.

uniform vec4 base_color : source_color = vec4(0.07, 0.075, 0.085, 1.0);
uniform float fade_radius = 16.0;
uniform float tile_size = 2.2;

varying vec3 world_pos;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 cell = floor(world_pos.xz / tile_size);
	vec2 local = fract(world_pos.xz / tile_size);
	float seam = smoothstep(0.0, 0.03, local.x) * smoothstep(0.0, 0.03, local.y);
	float variation = 0.85 + 0.3 * hash(cell);
	float fade = smoothstep(fade_radius, fade_radius * 0.35, length(world_pos.xz));
	ALBEDO = base_color.rgb * variation * (0.55 + 0.45 * seam) * fade;
	ROUGHNESS = 0.85;
	SPECULAR = 0.25;
}
