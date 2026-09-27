class_name Emblems
extends RefCounted



static func draw_piece(canvas: CanvasItem, kind: String, center: Vector2, radius: float, color: Color) -> void :
	draw_shape(canvas, kind, center, radius, color)


static func draw_shape(canvas: CanvasItem, shape: String, c: Vector2, r: float, color: Color) -> void :
	match shape:
		"pawn":
			_pawn(canvas, c, r, color)
		"rook":
			_base(canvas, c, r, color)
			_poly(canvas, c, r, [Vector2(-0.3, -0.3), Vector2(0.3, -0.3), Vector2(0.38, 0.55), Vector2(-0.38, 0.55)], color)
			for x in [-0.45, -0.11, 0.23]:
				_rect(canvas, c, r, Rect2(x, -0.72, 0.22, 0.46), color)
			_rect(canvas, c, r, Rect2(-0.45, -0.4, 0.9, 0.14), color)
		"bishop":
			_base(canvas, c, r, color)
			_poly(canvas, c, r, [Vector2(-0.16, 0.0), Vector2(0.16, 0.0), Vector2(0.3, 0.55), Vector2(-0.3, 0.55)], color)
			var mitre: Array = []
			for i in 16:
				var a: = PI * 0.5 + TAU * i / 16.0
				mitre.append(Vector2(cos(a) * 0.3, -0.32 + sin(a) * 0.36))
			mitre[8] = Vector2(0, -0.82)
			_poly(canvas, c, r, mitre, color)
			canvas.draw_circle(_p(c, r, Vector2(0, -0.9)), r * 0.09, color)
		"knight":
			_knight(canvas, c, r, color)
		"queen":
			_base(canvas, c, r, color)
			_poly(canvas, c, r, [Vector2(-0.2, -0.2), Vector2(0.2, -0.2), Vector2(0.34, 0.55), Vector2(-0.34, 0.55)], color)
			_poly(canvas, c, r, [Vector2(-0.42, -0.58), Vector2(0.42, -0.58), Vector2(0.24, -0.2), Vector2(-0.24, -0.2)], color)
			for i in 5:
				var x: = -0.42 + 0.21 * i
				canvas.draw_circle(_p(c, r, Vector2(x, -0.68 - (0.08 if i == 2 else 0.0))), r * 0.09, color)
		"king":
			_base(canvas, c, r, color)
			_poly(canvas, c, r, [Vector2(-0.2, -0.2), Vector2(0.2, -0.2), Vector2(0.34, 0.55), Vector2(-0.34, 0.55)], color)
			_poly(canvas, c, r, [Vector2(-0.38, -0.52), Vector2(0.38, -0.52), Vector2(0.24, -0.2), Vector2(-0.24, -0.2)], color)
			_rect(canvas, c, r, Rect2(-0.06, -0.98, 0.12, 0.46), color)
			_rect(canvas, c, r, Rect2(-0.2, -0.86, 0.4, 0.12), color)
		_:
			push_error("Emblems: no shape named '%s'" % shape)


static func _p(c: Vector2, r: float, unit: Vector2) -> Vector2:
	return c + unit * r


static func _poly(canvas: CanvasItem, c: Vector2, r: float, unit_points: Array, color: Color, filled: = true, width: = 2.0) -> void :
	var points: = PackedVector2Array()
	for point in unit_points:
		points.append(_p(c, r, point))
	if filled:
		canvas.draw_colored_polygon(points, color)
	else:
		canvas.draw_polyline(points, color, width, true)


static func _rect(canvas: CanvasItem, c: Vector2, r: float, unit_rect: Rect2, color: Color) -> void :
	canvas.draw_rect(Rect2(_p(c, r, unit_rect.position), unit_rect.size * r), color)


static func _base(canvas: CanvasItem, c: Vector2, r: float, color: Color) -> void :
	_rect(canvas, c, r, Rect2(-0.52, 0.55, 1.04, 0.22), color)


static func _pawn(canvas: CanvasItem, c: Vector2, r: float, color: Color) -> void :
	_base(canvas, c, r, color)
	_poly(canvas, c, r, [Vector2(-0.16, -0.2), Vector2(0.16, -0.2), Vector2(0.32, 0.55), Vector2(-0.32, 0.55)], color)
	canvas.draw_circle(_p(c, r, Vector2(0, -0.42)), r * 0.28, color)


static func _knight(canvas: CanvasItem, c: Vector2, r: float, color: Color) -> void :
	_base(canvas, c, r, color)
	_poly(canvas, c, r, [
		Vector2(0.36, 0.55), Vector2(-0.3, 0.55), Vector2(-0.22, 0.18), Vector2(-0.02, -0.06), 
		Vector2(-0.42, 0.04), Vector2(-0.58, -0.14), Vector2(-0.22, -0.52), Vector2(-0.02, -0.82), 
		Vector2(0.1, -0.62), Vector2(0.3, -0.54), Vector2(0.44, -0.2), Vector2(0.46, 0.2), 
	], color)
