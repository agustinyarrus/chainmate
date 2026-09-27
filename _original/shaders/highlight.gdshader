shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

// Procedural tile markings drawn on a unit quad lying on a tile, in the reference VFX language:
// glowing tiles with a bright inner border. Shapes differ per mode so colour is never the only cue.
//   1 move (tile glow + centre dot) · 2 capture (glow + corner brackets) · 3 chain path (gold fill)
//   4 selected (ring) · 5 hover (hairline) · 6 hint (pulsing) · 7 keyboard cursor
//   8 an enemy's reach (thin dashed outline) · 9 a move onto an attacked square (move tile, red warning)

uniform int mode = 0;
uniform vec4 color : source_color = vec4(0.31, 0.55, 1.0, 1.0);
uniform vec4 accent : source_color = vec4(1.0, 0.23, 0.19, 1.0);
uniform float strength = 1.0;
uniform float glow = 1.6;
uniform float phase = 0.0;

float box_sdf(vec2 p, vec2 b) {
	vec2 d = abs(p) - b;
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0);
}

float line(float d, float width) {
	return smoothstep(width, width * 0.3, abs(d));
}

void fragment() {
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
	ALPHA = clamp(a * strength * color.a, 0.0, 1.0);
}
