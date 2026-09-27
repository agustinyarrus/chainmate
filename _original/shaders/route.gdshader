shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

// Planned chain ribbon. UV.x runs along the path in world units; UV.y spans its width.
// Bright dashes flow from the attacking piece towards the final capture.

uniform vec4 color : source_color = vec4(1.0, 0.78, 0.36, 1.0);
uniform float intensity = 2.2;
uniform float dash_density = 3.0;
uniform float flow_speed = 1.4;
uniform float opacity = 1.0;

void fragment() {
	float across = abs(UV.y * 2.0 - 1.0);
	float core = smoothstep(1.0, 0.0, across);
	float dash = 0.35 + 0.65 * smoothstep(0.35, 0.65, fract(UV.x * dash_density - TIME * flow_speed));
	ALBEDO = color.rgb * intensity;
	ALPHA = core * core * dash * opacity;
}
