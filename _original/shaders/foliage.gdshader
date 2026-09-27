shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;

// Leaf cards for ivy, bushes and fallen leaves (board-kit reference). Each MultiMesh instance is one
// leaf; its colour comes from the instance colour (alpha = sway amount). Shapes are cut procedurally:
//   0 ivy (a pointed heart), 1 maple (five lobes), 2 long leaf.

uniform int shape = 0;
uniform float sway = 1.0;

varying float sway_amount;

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
	// Ivy: a heart hanging from its stem notch (UV.y = 0) down to a pointed tip.
	float y = uv.y;
	float w = 0.5 * pow(sin(3.14159 * clamp(y, 0.0, 1.0)), 0.75) + 0.08 * sin(y * 9.0);
	float notch = step(y, 0.1) * step(abs(p.x), 0.12);
	return step(abs(p.x) * 0.5, w * 0.5) * (1.0 - notch);
}

void vertex() {
	sway_amount = COLOR.a;
	vec3 world = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float t = TIME * 1.4 + world.x * 1.7 + world.z * 1.3;
	VERTEX += vec3(sin(t), 0.0, cos(t * 0.8)) * 0.02 * sway * sway_amount * UV.y;
}

void fragment() {
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
	BACKLIGHT = COLOR.rgb * 0.45;
}
