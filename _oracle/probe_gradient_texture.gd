extends RefCounted
## Oracle probe — GradientTexture2D baking, byte for byte: the menu's side gradient (screens.gd) and a
## three-point gradient like vfx.gd's through every fill and repeat mode, plus the degenerate cases
## (a 1 × 1 texture, fill_from == fill_to). test/gradient_texture.test.mjs compares the port's bytes.
##
##   node tools/oracle.mjs gradient_texture

const FILLS := {"linear": GradientTexture2D.FILL_LINEAR, "radial": GradientTexture2D.FILL_RADIAL, "square": GradientTexture2D.FILL_SQUARE, "conic": GradientTexture2D.FILL_CONIC}
const REPEATS := {"none": GradientTexture2D.REPEAT_NONE, "repeat": GradientTexture2D.REPEAT, "mirror": GradientTexture2D.REPEAT_MIRROR}


func _side() -> Gradient:
	var gradient := Gradient.new()
	gradient.set_color(0, Color(0.03, 0.045, 0.07, 0.94))
	gradient.set_color(1, Color(0.03, 0.045, 0.07, 0.0))
	return gradient


func _three() -> Gradient:
	var gradient := Gradient.new()
	gradient.set_color(0, Color(1.0, 0.95, 0.7, 1.0))
	gradient.add_point(0.4, Color(1.0, 0.45, 0.12, 0.7))
	gradient.set_color(2, Color(0.3, 0.05, 0.02, 0.0))
	return gradient


func _emit(name: String, gradient: Gradient, width: int, height: int, from: Vector2, to: Vector2, fill: String, repeat: String) -> void:
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.width = width
	texture.height = height
	texture.fill_from = from
	texture.fill_to = to
	texture.fill = FILLS[fill]
	texture.repeat = REPEATS[repeat]
	var image := texture.get_image()
	print("ORACLE ", JSON.stringify({
		"k": "texture", "name": name, "width": width, "height": height,
		"from": [from.x, from.y], "to": [to.x, to.y], "fill": fill, "repeat": repeat,
		"format": image.get_format() == Image.FORMAT_RGBA8, "data": image.get_data().hex_encode(),
	}))


func run(_host: Node) -> void:
	_emit("side", _side(), 256, 4, Vector2(0, 0.5), Vector2(1, 0.5), "linear", "none")
	for fill in FILLS:
		for repeat in REPEATS:
			_emit("%s_%s" % [fill, repeat], _three(), 33, 17, Vector2(0.21, 0.37), Vector2(0.58, 0.64), fill, repeat)
	_emit("backwards", _three(), 40, 9, Vector2(0.9, 0.2), Vector2(0.1, 0.7), "linear", "none")
	_emit("single_texel", _three(), 1, 1, Vector2(0, 0), Vector2(1, 1), "linear", "none")
	_emit("same_points", _three(), 8, 8, Vector2(0.5, 0.5), Vector2(0.5, 0.5), "radial", "none")
