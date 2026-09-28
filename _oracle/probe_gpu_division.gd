extends RefCounted
## Oracle probe — how the GPU divides. Vulkan lets a division be off by a few ULP; on the reference
## machine's GPU a / b is a × rcp(b) with a hardware reciprocal, and particles.glsl makes its restart
## and age decisions with such quotients (index / amount, delta / lifetime).
##
##   division    the bits of every quotient i / n, 0 ≤ i < n < 64 (the model is checked against them)
##   reciprocals the bits of 1 / n for n = 1 … 1024, and of 1 / x for the lifetimes the game uses
##
## A canvas shader writes the float bits into an 8-bit viewport (blending off); they come back as bytes.

const GRID := 64
const WIDTH := 1024
const LIFETIMES := [0.3, 0.8, 0.9, 1.0, 1.6]
const SHADER := """
shader_type canvas_item;
render_mode blend_disabled, unshaded;
uniform float lifetimes[5];
void fragment() {
	ivec2 p = ivec2(FRAGCOORD.xy);
	float q;
	if (p.y < 64) {
		q = float(p.x) / float(max(p.y, 1));
	} else if (p.y == 64) {
		q = 1.0 / float(p.x + 1);
	} else {
		q = 1.0 / lifetimes[min(p.x, 4)];
	}
	uint bits = floatBitsToUint(q);
	COLOR = vec4(float(bits & 255u), float((bits >> 8u) & 255u), float((bits >> 16u) & 255u), float(bits >> 24u)) / 255.0;
}
"""


func _bits(image: Image, x: int, y: int) -> int:
	var c := image.get_pixel(x, y)
	return int(round(c.r * 255.0)) | (int(round(c.g * 255.0)) << 8) | (int(round(c.b * 255.0)) << 16) | (int(round(c.a * 255.0)) << 24)


func run(host: Node) -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(WIDTH, GRID + 2)
	viewport.transparent_bg = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	var rect := ColorRect.new()
	rect.size = Vector2(WIDTH, GRID + 2)
	var material := ShaderMaterial.new()
	var shader := Shader.new()
	shader.code = SHADER
	material.shader = shader
	material.set_shader_parameter("lifetimes", PackedFloat32Array(LIFETIMES))
	rect.material = material
	viewport.add_child(rect)
	host.add_child(viewport)
	for i in 3:
		await RenderingServer.frame_post_draw
	var image := viewport.get_texture().get_image()
	var rows := []
	for n in range(1, GRID):
		var row := []
		for i in n:
			row.append(_bits(image, i, n))
		rows.append(row)
	var reciprocals := []
	for x in WIDTH:
		reciprocals.append(_bits(image, x, GRID))
	var lifetime_reciprocals := {}
	for i in LIFETIMES.size():
		lifetime_reciprocals[str(LIFETIMES[i])] = _bits(image, i, GRID + 1)
	print("ORACLE ", JSON.stringify({"k": "division", "adapter": RenderingServer.get_video_adapter_name(), "rows": rows, "reciprocals": reciprocals, "lifetime_reciprocals": lifetime_reciprocals}))
