class_name Icons
extends RefCounted




const GOLD: = Color("e0ad55")
const GOLD_DARK: = Color("8a5a22")
const GOLD_LIGHT: = Color("ffe6a6")
const BLUE: = Color("4f8dff")
const BLUE_DARK: = Color("1e3f8a")
const BLUE_LIGHT: = Color("bcd6ff")
const LEATHER: = Color("7a3b2a")
const LEATHER_DARK: = Color("3d1c14")
const PARCHMENT: = Color("e9dcb8")
const STEEL: = Color("b9c2cf")
const STEEL_DARK: = Color("59616e")
const RED: = Color("d0453a")
const GREEN: = Color("6fb04a")
const INK_DARK: = Color("141a24")


static func draw(canvas: CanvasItem, icon: String, c: Vector2, r: float) -> void :
	match icon:
		"coin":
			_coin(canvas, c, r)
		"ribbon":
			_ribbon(canvas, c, r)
		"eye":
			_eye(canvas, c, r)
		"tome":
			_tome(canvas, c, r)
		"laurel":
			_laurel(canvas, c, r)
		"shield":
			_shield(canvas, c, r)
		"key":
			_key(canvas, c, r)
		"crown":
			_crown(canvas, c, r)
		"spur":
			_spur(canvas, c, r)
		"lens":
			_lens(canvas, c, r)
		"banner":
			_banner(canvas, c, r)
		"salt":
			_salt(canvas, c, r)
		"scroll":
			_scroll(canvas, c, r)
		"quill":
			_quill(canvas, c, r)
		"chit":
			_chit(canvas, c, r)
		"envelope":
			_envelope(canvas, c, r)
		"seal":
			_seal(canvas, c, r)
		"feather":
			_feather(canvas, c, r)
		"medal":
			_medal(canvas, c, r)

		"chain":
			_chain(canvas, c, r)
		"momentum":
			_chevrons(canvas, c, r, BLUE_LIGHT)
		"ward":
			_shield(canvas, c, r)
		"veteran":
			_star(canvas, c, r, GOLD, GOLD_DARK, GOLD_LIGHT)
		"extended_range":
			_arrow(canvas, c, r, BLUE_LIGHT)
		"charge":
			_bolt(canvas, c, r)
		"piercing":
			_spear(canvas, c, r)
		"siege_step", "side_step", "royal_stride":
			_steps(canvas, c, r)
		"rebellion":
			_fist(canvas, c, r)
		"vanguard":
			_chevrons(canvas, c, r, GOLD_LIGHT)

		"encounter":
			_swords(canvas, c, r)
		"elite":
			_skull(canvas, c, r)
		"merchant":
			_purse(canvas, c, r)
		"rest":
			_campfire(canvas, c, r)
		"unknown":
			_question(canvas, c, r)
		"boss":
			_crown(canvas, c, r)
		_:
			push_error("Icons: no icon named '%s'" % icon)




static func _p(c: Vector2, r: float, u: Vector2) -> Vector2:
	return c + u * r


static func _poly(canvas: CanvasItem, c: Vector2, r: float, points: Array, color: Color) -> void :
	var packed: = PackedVector2Array()
	for point in points:
		packed.append(_p(c, r, point))
	canvas.draw_colored_polygon(packed, color)


static func _line(canvas: CanvasItem, c: Vector2, r: float, points: Array, color: Color, width: float) -> void :
	var packed: = PackedVector2Array()
	for point in points:
		packed.append(_p(c, r, point))
	canvas.draw_polyline(packed, color, maxf(1.0, width * r), true)


static func _circle(canvas: CanvasItem, c: Vector2, r: float, at: Vector2, radius: float, color: Color) -> void :
	canvas.draw_circle(_p(c, r, at), radius * r, color)


static func _shadow(canvas: CanvasItem, c: Vector2, r: float) -> void :
	var points: = PackedVector2Array()
	for i in 20:
		var a: = TAU * i / 20.0
		points.append(c + Vector2(cos(a) * 0.72, 0.86 + sin(a) * 0.12) * r)
	canvas.draw_colored_polygon(points, Color(0, 0, 0, 0.35))




static func _coin(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_circle(canvas, c, r, Vector2(0.06, 0.06), 0.74, GOLD_DARK)
	_circle(canvas, c, r, Vector2.ZERO, 0.74, GOLD)
	_circle(canvas, c, r, Vector2.ZERO, 0.56, GOLD_DARK.lerp(GOLD, 0.55))
	_circle(canvas, c, r, Vector2(-0.04, -0.04), 0.5, GOLD)
	_star(canvas, c + Vector2(0, 0.02) * r, r * 0.42, GOLD_LIGHT, GOLD_DARK, Color.WHITE)
	canvas.draw_arc(_p(c, r, Vector2(-0.12, -0.12)), 0.62 * r, PI * 1.05, PI * 1.5, 12, Color(1, 1, 1, 0.55), maxf(1.0, 0.07 * r), true)


static func _tome(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_poly(canvas, c, r, [Vector2(-0.62, -0.72), Vector2(0.56, -0.8), Vector2(0.66, 0.7), Vector2(-0.52, 0.78)], LEATHER_DARK)
	_poly(canvas, c, r, [Vector2(-0.56, -0.78), Vector2(0.6, -0.86), Vector2(0.7, 0.62), Vector2(-0.46, 0.7)], LEATHER)
	_poly(canvas, c, r, [Vector2(0.6, -0.86), Vector2(0.7, -0.8), Vector2(0.8, 0.66), Vector2(0.7, 0.62)], PARCHMENT)
	_poly(canvas, c, r, [Vector2(-0.3, -0.36), Vector2(0.34, -0.42), Vector2(0.38, 0.2), Vector2(-0.26, 0.26)], Color(GOLD, 0.25))
	_line(canvas, c, r, [Vector2(-0.3, -0.36), Vector2(0.34, -0.42), Vector2(0.38, 0.2), Vector2(-0.26, 0.26), Vector2(-0.3, -0.36)], GOLD, 0.06)
	_circle(canvas, c, r, Vector2(0.03, -0.08), 0.12, GOLD_LIGHT)


static func _laurel(canvas: CanvasItem, c: Vector2, r: float) -> void :
	for side in [-1.0, 1.0]:
		for i in 6:
			var t: = float(i) / 5.0
			var a: = lerpf(PI * 0.62, PI * 1.35, t)
			var at: Vector2 = Vector2(cos(a) * 0.62 * side, sin(a) * 0.7 + 0.05)
			var leaf: Array = [at + Vector2(0, -0.2), at + Vector2(0.13 * side, 0), at + Vector2(0, 0.14), at + Vector2(-0.1 * side, 0)]
			_poly(canvas, c, r, leaf, GREEN.darkened(0.35) if i % 2 == 0 else GREEN)
		_line(canvas, c, r, [Vector2(0.62 * side * cos(PI * 0.62), 0.7 * sin(PI * 0.62)), Vector2(0.2 * side, 0.82)], GREEN.darkened(0.5), 0.05)
	_poly(canvas, c, r, [Vector2(-0.18, 0.72), Vector2(0.18, 0.72), Vector2(0.1, 0.9), Vector2(-0.1, 0.9)], GOLD)


static func _shield(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	var outline: = [Vector2(-0.66, -0.7), Vector2(0.66, -0.7), Vector2(0.6, 0.1), Vector2(0, 0.86), Vector2(-0.6, 0.1)]
	_poly(canvas, c, r, outline, STEEL_DARK)
	_poly(canvas, c, r, [Vector2(-0.54, -0.6), Vector2(0.54, -0.6), Vector2(0.48, 0.06), Vector2(0, 0.72), Vector2(-0.48, 0.06)], STEEL)
	_poly(canvas, c, r, [Vector2(0, -0.6), Vector2(0.54, -0.6), Vector2(0.48, 0.06), Vector2(0, 0.72)], STEEL.darkened(0.2))
	_poly(canvas, c, r, [Vector2(-0.08, -0.45), Vector2(0.08, -0.45), Vector2(0.08, 0.5), Vector2(-0.08, 0.5)], BLUE)
	_poly(canvas, c, r, [Vector2(-0.4, -0.14), Vector2(0.4, -0.14), Vector2(0.4, 0.02), Vector2(-0.4, 0.02)], BLUE)


static func _crown(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	var body: = [Vector2(-0.72, 0.5), Vector2(-0.72, -0.3), Vector2(-0.36, 0.02), Vector2(0, -0.5), Vector2(0.36, 0.02), Vector2(0.72, -0.3), Vector2(0.72, 0.5)]
	_poly(canvas, c, r, body, GOLD)
	_poly(canvas, c, r, [Vector2(0, -0.5), Vector2(0.36, 0.02), Vector2(0.72, -0.3), Vector2(0.72, 0.5), Vector2(0, 0.5)], GOLD_DARK.lerp(GOLD, 0.5))
	_poly(canvas, c, r, [Vector2(-0.72, 0.34), Vector2(0.72, 0.34), Vector2(0.72, 0.56), Vector2(-0.72, 0.56)], GOLD_DARK)
	for x in [-0.72, 0.0, 0.72]:
		_circle(canvas, c, r, Vector2(x, -0.4 if x != 0.0 else -0.6), 0.1, GOLD_LIGHT)
	_circle(canvas, c, r, Vector2(0, 0.14), 0.12, RED)
	_circle(canvas, c, r, Vector2(-0.4, 0.2), 0.08, BLUE)
	_circle(canvas, c, r, Vector2(0.4, 0.2), 0.08, BLUE)


static func _spur(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	canvas.draw_arc(_p(c, r, Vector2(-0.1, 0.1)), 0.55 * r, PI * 0.1, PI * 1.25, 20, STEEL_DARK, maxf(2.0, 0.2 * r), true)
	canvas.draw_arc(_p(c, r, Vector2(-0.1, 0.1)), 0.55 * r, PI * 0.1, PI * 1.25, 20, STEEL, maxf(1.0, 0.11 * r), true)
	_line(canvas, c, r, [Vector2(0.38, 0.28), Vector2(0.62, 0.46)], STEEL, 0.1)
	for i in 8:
		var a: = TAU * i / 8.0
		_line(canvas, c, r, [Vector2(0.72, 0.56), Vector2(0.72, 0.56) + Vector2(cos(a), sin(a)) * 0.24], GOLD, 0.06)
	_circle(canvas, c, r, Vector2(0.72, 0.56), 0.1, GOLD_LIGHT)


static func _lens(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_line(canvas, c, r, [Vector2(0.3, 0.3), Vector2(0.78, 0.78)], LEATHER, 0.2)
	_circle(canvas, c, r, Vector2(-0.14, -0.14), 0.56, GOLD_DARK)
	_circle(canvas, c, r, Vector2(-0.14, -0.14), 0.46, Color(0.55, 0.75, 1.0, 0.85))
	_circle(canvas, c, r, Vector2(-0.26, -0.28), 0.14, Color(1, 1, 1, 0.7))
	_line(canvas, c, r, [Vector2(-0.52, 0.22), Vector2(0.26, -0.56)], Color(1, 1, 1, 0.25), 0.05)


static func _banner(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_line(canvas, c, r, [Vector2(-0.5, -0.86), Vector2(-0.5, 0.9)], LEATHER_DARK, 0.1)
	_poly(canvas, c, r, [Vector2(-0.46, -0.76), Vector2(0.56, -0.76), Vector2(0.56, 0.52), Vector2(0.05, 0.3), Vector2(-0.46, 0.52)], Color("8e1f25"))
	_poly(canvas, c, r, [Vector2(0.05, -0.76), Vector2(0.56, -0.76), Vector2(0.56, 0.52), Vector2(0.05, 0.3)], Color("6a151b"))
	_line(canvas, c, r, [Vector2(-0.46, -0.76), Vector2(0.56, -0.76)], GOLD, 0.08)
	_crown(canvas, c + Vector2(0.05, -0.2) * r, r * 0.34)


static func _scroll(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_poly(canvas, c, r, [Vector2(-0.56, -0.56), Vector2(0.56, -0.56), Vector2(0.56, 0.56), Vector2(-0.56, 0.56)], PARCHMENT)
	for y in [-0.6, 0.6]:
		_poly(canvas, c, r, [Vector2(-0.66, y - 0.1), Vector2(0.66, y - 0.1), Vector2(0.66, y + 0.1), Vector2(-0.66, y + 0.1)], PARCHMENT.darkened(0.25))
	for y in [-0.3, -0.1, 0.1, 0.3]:
		_line(canvas, c, r, [Vector2(-0.38, y), Vector2(0.38, y)], LEATHER, 0.04)


static func _seal(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	var points: = []
	for i in 16:
		var a: = TAU * i / 16.0
		var d: = 0.72 if i % 2 == 0 else 0.62
		points.append(Vector2(cos(a), sin(a)) * d)
	_poly(canvas, c, r, points, Color("8e1f25"))
	_circle(canvas, c, r, Vector2.ZERO, 0.46, Color("b02a30"))
	_circle(canvas, c, r, Vector2(-0.1, -0.12), 0.18, Color(1, 1, 1, 0.18))
	_crown(canvas, c, r * 0.3)


static func _feather(canvas: CanvasItem, c: Vector2, r: float) -> void :
	var vane: = [Vector2(0.52, -0.82), Vector2(0.62, -0.4), Vector2(0.26, 0.2), Vector2(-0.3, 0.56), Vector2(-0.12, 0.08), Vector2(0.2, -0.46)]
	_poly(canvas, c, r, vane, Color("ff7a2e"))
	_poly(canvas, c, r, [Vector2(0.52, -0.82), Vector2(0.62, -0.4), Vector2(0.26, 0.2), Vector2(-0.3, 0.56)], Color("ffb347"))
	_line(canvas, c, r, [Vector2(0.52, -0.82), Vector2(-0.56, 0.8)], GOLD_LIGHT, 0.06)
	_circle(canvas, c, r, Vector2(0.3, -0.4), 0.1, Color(1, 0.95, 0.7, 0.6))


static func _medal(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_poly(canvas, c, r, [Vector2(-0.36, -0.9), Vector2(-0.08, -0.9), Vector2(0.08, -0.2), Vector2(-0.2, -0.2)], BLUE)
	_poly(canvas, c, r, [Vector2(0.36, -0.9), Vector2(0.08, -0.9), Vector2(-0.08, -0.2), Vector2(0.2, -0.2)], BLUE_DARK)
	_circle(canvas, c, r, Vector2(0, 0.28), 0.5, GOLD_DARK)
	_circle(canvas, c, r, Vector2(0, 0.24), 0.46, GOLD)
	_star(canvas, c + Vector2(0, 0.24) * r, r * 0.3, GOLD_LIGHT, GOLD_DARK, Color.WHITE)



static func _ribbon(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_poly(canvas, c, r, [Vector2(-0.2, 0.0), Vector2(-0.02, 0.1), Vector2(-0.34, 0.86), Vector2(-0.46, 0.66), Vector2(-0.6, 0.78)], Color("8e1f25"))
	_poly(canvas, c, r, [Vector2(0.2, 0.0), Vector2(0.02, 0.1), Vector2(0.34, 0.86), Vector2(0.46, 0.66), Vector2(0.6, 0.78)], Color("6a151b"))
	var petals: = []
	for i in 14:
		var a: = TAU * i / 14.0
		petals.append(Vector2(cos(a), sin(a)) * (0.52 if i % 2 == 0 else 0.4) + Vector2(0, -0.2))
	_poly(canvas, c, r, petals, Color("b02a30"))
	_circle(canvas, c, r, Vector2(0, -0.2), 0.28, GOLD)
	_circle(canvas, c, r, Vector2(0, -0.2), 0.2, GOLD_DARK.lerp(GOLD, 0.5))
	_circle(canvas, c, r, Vector2(-0.08, -0.28), 0.07, GOLD_LIGHT)



static func _eye(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	var lid: = []
	for i in 17:
		var t: = float(i) / 16.0
		lid.append(Vector2(lerpf(-0.8, 0.8, t), - sin(PI * t) * 0.46))
	for i in range(15, 0, -1):
		var t: = float(i) / 16.0
		lid.append(Vector2(lerpf(-0.8, 0.8, t), sin(PI * t) * 0.4))
	_poly(canvas, c, r, lid, PARCHMENT)
	_circle(canvas, c, r, Vector2.ZERO, 0.32, BLUE_DARK)
	_circle(canvas, c, r, Vector2.ZERO, 0.24, BLUE)
	_circle(canvas, c, r, Vector2.ZERO, 0.11, INK_DARK)
	_circle(canvas, c, r, Vector2(-0.1, -0.1), 0.07, Color.WHITE)
	_line(canvas, c, r, lid + [lid[0]], LEATHER_DARK, 0.06)



static func _key(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_line(canvas, c, r, [Vector2(-0.12, -0.12), Vector2(0.62, 0.62)], GOLD_DARK, 0.2)
	_line(canvas, c, r, [Vector2(-0.12, -0.12), Vector2(0.62, 0.62)], GOLD, 0.11)
	_poly(canvas, c, r, [Vector2(0.4, 0.62), Vector2(0.62, 0.4), Vector2(0.74, 0.52), Vector2(0.52, 0.74)], GOLD_DARK)
	canvas.draw_arc(_p(c, r, Vector2(-0.34, -0.34)), 0.3 * r, 0, TAU, 20, GOLD_DARK, maxf(2.0, 0.2 * r), true)
	canvas.draw_arc(_p(c, r, Vector2(-0.34, -0.34)), 0.3 * r, 0, TAU, 20, GOLD, maxf(1.0, 0.11 * r), true)
	_circle(canvas, c, r, Vector2(-0.34, -0.34), 0.1, BLUE)
	_circle(canvas, c, r, Vector2(-0.44, -0.46), 0.06, GOLD_LIGHT)



static func _salt(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	var white: = Color("eef1f4")
	var grey: = Color("a9b3bf")
	for crystal in [[Vector2(-0.36, 0.3), 0.38], [Vector2(0.34, 0.34), 0.32], [Vector2(0.0, -0.02), 0.52]]:
		var at: Vector2 = crystal[0]
		var h: float = crystal[1]
		_poly(canvas, c, r, [at + Vector2(0, - h), at + Vector2(h * 0.46, - h * 0.1), at + Vector2(0, h * 0.8), at + Vector2( - h * 0.46, - h * 0.1)], white)
		_poly(canvas, c, r, [at + Vector2(0, - h), at + Vector2(0.04, 0.0), at + Vector2(0, h * 0.8), at + Vector2( - h * 0.46, - h * 0.1)], grey)
	_circle(canvas, c, r, Vector2(-0.06, -0.3), 0.06, Color.WHITE)



static func _quill(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_poly(canvas, c, r, [Vector2(0.58, -0.84), Vector2(0.66, -0.36), Vector2(0.24, 0.24), Vector2(-0.28, 0.58), Vector2(-0.1, 0.1), Vector2(0.24, -0.48)], PARCHMENT)
	_poly(canvas, c, r, [Vector2(0.58, -0.84), Vector2(0.66, -0.36), Vector2(0.24, 0.24), Vector2(-0.28, 0.58)], PARCHMENT.darkened(0.2))
	_line(canvas, c, r, [Vector2(0.58, -0.84), Vector2(-0.54, 0.8)], LEATHER_DARK, 0.05)
	_circle(canvas, c, r, Vector2(-0.62, 0.82), 0.12, INK_DARK)
	_circle(canvas, c, r, Vector2(-0.66, 0.78), 0.04, BLUE_LIGHT)



static func _chit(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_poly(canvas, c, r, [Vector2(-0.74, -0.42), Vector2(0.74, -0.42), Vector2(0.74, -0.12), Vector2(0.62, 0.0), Vector2(0.74, 0.12), Vector2(0.74, 0.42), Vector2(-0.74, 0.42), Vector2(-0.74, 0.12), Vector2(-0.62, 0.0), Vector2(-0.74, -0.12)], PARCHMENT)
	_line(canvas, c, r, [Vector2(-0.3, -0.42), Vector2(-0.3, 0.42)], LEATHER, 0.03)
	_star(canvas, c + Vector2(0.2, 0.0) * r, r * 0.3, GOLD, GOLD_DARK, GOLD_LIGHT)
	for y in [-0.18, 0.0, 0.18]:
		_line(canvas, c, r, [Vector2(-0.6, y), Vector2(-0.4, y)], LEATHER, 0.04)



static func _envelope(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_shadow(canvas, c, r)
	_poly(canvas, c, r, [Vector2(-0.76, -0.48), Vector2(0.76, -0.48), Vector2(0.76, 0.5), Vector2(-0.76, 0.5)], PARCHMENT)
	_poly(canvas, c, r, [Vector2(-0.76, 0.5), Vector2(0.0, -0.02), Vector2(0.76, 0.5)], PARCHMENT.darkened(0.12))
	_poly(canvas, c, r, [Vector2(-0.76, -0.48), Vector2(0.76, -0.48), Vector2(0.0, 0.14)], PARCHMENT.darkened(0.22))
	_circle(canvas, c, r, Vector2(0.0, 0.1), 0.2, Color("8e1f25"))
	_circle(canvas, c, r, Vector2(0.0, 0.1), 0.14, Color("b02a30"))
	_circle(canvas, c, r, Vector2(-0.05, 0.05), 0.05, Color(1, 1, 1, 0.3))




static func _chain(canvas: CanvasItem, c: Vector2, r: float) -> void :
	for i in 3:
		var at: = Vector2(-0.48 + i * 0.48, (-0.24 + i * 0.24))
		canvas.draw_arc(_p(c, r, at), 0.28 * r, 0, TAU, 18, GOLD_DARK, maxf(2.0, 0.16 * r), true)
		canvas.draw_arc(_p(c, r, at), 0.28 * r, 0, TAU, 18, GOLD, maxf(1.0, 0.09 * r), true)


static func _chevrons(canvas: CanvasItem, c: Vector2, r: float, color: Color) -> void :
	for i in 3:
		var x: = -0.6 + i * 0.42
		_line(canvas, c, r, [Vector2(x, -0.5), Vector2(x + 0.34, 0), Vector2(x, 0.5)], Color(color, 0.45 + i * 0.27), 0.14)


static func _star(canvas: CanvasItem, c: Vector2, r: float, body: Color, dark: Color, light: Color) -> void :
	var points: = []
	for i in 10:
		var a: = - PI * 0.5 + TAU * i / 10.0
		var d: = 0.9 if i % 2 == 0 else 0.4
		points.append(Vector2(cos(a), sin(a)) * d)
	_poly(canvas, c, r, points, body)
	_poly(canvas, c, r, [Vector2.ZERO, points[0], points[1], points[2], points[3], points[4]], dark.lerp(body, 0.6))
	_circle(canvas, c, r, Vector2(-0.12, -0.2), 0.1, Color(light, 0.8))


static func _arrow(canvas: CanvasItem, c: Vector2, r: float, color: Color) -> void :
	_line(canvas, c, r, [Vector2(-0.7, 0.62), Vector2(0.4, -0.48)], color, 0.13)
	_poly(canvas, c, r, [Vector2(0.72, -0.8), Vector2(0.6, -0.18), Vector2(0.08, -0.68)], color)


static func _bolt(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_poly(canvas, c, r, [Vector2(0.12, -0.9), Vector2(-0.46, 0.1), Vector2(-0.02, 0.1), Vector2(-0.16, 0.9), Vector2(0.46, -0.16), Vector2(0.04, -0.16)], GOLD)
	_poly(canvas, c, r, [Vector2(0.12, -0.9), Vector2(-0.46, 0.1), Vector2(-0.02, 0.1)], GOLD_LIGHT)


static func _spear(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_line(canvas, c, r, [Vector2(-0.72, 0.72), Vector2(0.3, -0.3)], LEATHER, 0.1)
	_poly(canvas, c, r, [Vector2(0.78, -0.78), Vector2(0.44, -0.08), Vector2(0.18, -0.2), Vector2(0.08, -0.44)], STEEL)
	_poly(canvas, c, r, [Vector2(0.78, -0.78), Vector2(0.18, -0.2), Vector2(0.08, -0.44)], Color.WHITE.lerp(STEEL, 0.4))


static func _steps(canvas: CanvasItem, c: Vector2, r: float) -> void :
	for i in 3:
		var at: = Vector2(-0.56 + i * 0.52, 0.5 - i * 0.5)
		_poly(canvas, c, r, [at + Vector2(-0.2, -0.2), at + Vector2(0.2, -0.2), at + Vector2(0.2, 0.2), at + Vector2(-0.2, 0.2)], Color(BLUE_LIGHT, 0.4 + i * 0.3))


static func _fist(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_poly(canvas, c, r, [Vector2(-0.46, -0.3), Vector2(0.46, -0.3), Vector2(0.5, 0.3), Vector2(0.2, 0.56), Vector2(-0.4, 0.5)], PARCHMENT)
	for i in 4:
		_line(canvas, c, r, [Vector2(-0.34 + i * 0.24, -0.3), Vector2(-0.34 + i * 0.24, 0.0)], LEATHER, 0.05)
	_line(canvas, c, r, [Vector2(0, -0.56), Vector2(0, -0.84)], GOLD, 0.1)
	_poly(canvas, c, r, [Vector2(-0.2, -0.62), Vector2(0.2, -0.62), Vector2(0, -0.9)], GOLD)




static func _swords(canvas: CanvasItem, c: Vector2, r: float) -> void :
	for side in [-1.0, 1.0]:
		_line(canvas, c, r, [Vector2(-0.62 * side, -0.62), Vector2(0.42 * side, 0.42)], STEEL, 0.12)
		_line(canvas, c, r, [Vector2(0.28 * side, 0.6), Vector2(0.6 * side, 0.28)], GOLD, 0.1)
		_line(canvas, c, r, [Vector2(0.44 * side, 0.44), Vector2(0.66 * side, 0.66)], LEATHER, 0.12)


static func _skull(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_circle(canvas, c, r, Vector2(0, -0.14), 0.56, PARCHMENT)
	_poly(canvas, c, r, [Vector2(-0.3, 0.2), Vector2(0.3, 0.2), Vector2(0.26, 0.62), Vector2(-0.26, 0.62)], PARCHMENT)
	_circle(canvas, c, r, Vector2(-0.22, -0.12), 0.15, INK_DARK)
	_circle(canvas, c, r, Vector2(0.22, -0.12), 0.15, INK_DARK)
	_poly(canvas, c, r, [Vector2(0, 0.04), Vector2(0.08, 0.2), Vector2(-0.08, 0.2)], INK_DARK)
	for x in [-0.14, 0.0, 0.14]:
		_line(canvas, c, r, [Vector2(x, 0.4), Vector2(x, 0.6)], INK_DARK, 0.04)


static func _purse(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_poly(canvas, c, r, [Vector2(-0.3, -0.42), Vector2(0.3, -0.42), Vector2(0.62, 0.2), Vector2(0.44, 0.66), Vector2(-0.44, 0.66), Vector2(-0.62, 0.2)], LEATHER)
	_poly(canvas, c, r, [Vector2(0, -0.42), Vector2(0.3, -0.42), Vector2(0.62, 0.2), Vector2(0.44, 0.66), Vector2(0, 0.66)], LEATHER_DARK.lerp(LEATHER, 0.4))
	_line(canvas, c, r, [Vector2(-0.34, -0.44), Vector2(0.34, -0.44)], GOLD, 0.08)
	_circle(canvas, c, r, Vector2(0, 0.2), 0.2, GOLD)


static func _campfire(canvas: CanvasItem, c: Vector2, r: float) -> void :
	_line(canvas, c, r, [Vector2(-0.62, 0.64), Vector2(0.62, 0.38)], LEATHER, 0.14)
	_line(canvas, c, r, [Vector2(0.62, 0.64), Vector2(-0.62, 0.38)], LEATHER_DARK, 0.14)
	_poly(canvas, c, r, [Vector2(-0.34, 0.4), Vector2(-0.16, -0.2), Vector2(0.0, -0.8), Vector2(0.18, -0.24), Vector2(0.36, 0.4)], Color("ff7a2e"))
	_poly(canvas, c, r, [Vector2(-0.16, 0.4), Vector2(0.0, -0.3), Vector2(0.16, 0.4)], GOLD_LIGHT)


static func _question(canvas: CanvasItem, c: Vector2, r: float) -> void :
	canvas.draw_arc(_p(c, r, Vector2(0, -0.3)), 0.34 * r, PI, TAU + PI * 0.4, 16, PARCHMENT, maxf(1.5, 0.16 * r), true)
	_line(canvas, c, r, [Vector2(0.1, 0.0), Vector2(0.0, 0.14), Vector2(0.0, 0.3)], PARCHMENT, 0.16)
	_circle(canvas, c, r, Vector2(0, 0.6), 0.11, PARCHMENT)
