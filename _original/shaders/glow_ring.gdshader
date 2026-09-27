shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

// Expanding shockwave ring on the board surface (captures, promotions, clears).
// `progress` runs 0 -> 1 over the effect's life.

uniform vec4 color : source_color = vec4(1.0, 0.6, 0.3, 1.0);
uniform float progress = 0.0;
uniform float intensity = 2.5;
uniform float thickness = 0.08;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float radius = mix(0.1, 0.95, progress);
	float ring = smoothstep(thickness, 0.0, abs(r - radius));
	float fade = 1.0 - progress;
	ALBEDO = color.rgb * intensity;
	ALPHA = ring * fade * fade;
}
