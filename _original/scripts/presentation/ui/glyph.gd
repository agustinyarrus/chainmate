class_name Glyph
extends Control


var shape: = "coin"
var color: = Palette.GOLD
var filled: = true


static func make(shape_name: String, size: = 18.0, tint: = Palette.GOLD, is_filled: = true) -> Glyph:
	var glyph: = Glyph.new()
	glyph.shape = shape_name
	glyph.color = tint
	glyph.filled = is_filled
	glyph.custom_minimum_size = Vector2(size, size)
	glyph.mouse_filter = Control.MOUSE_FILTER_IGNORE
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return glyph


func set_filled(on: bool) -> void :
	filled = on
	queue_redraw()


func _draw() -> void :
	var center: = size * 0.5
	var r: = minf(size.x, size.y) * 0.5
	match shape:
		"coin":
			draw_circle(center, r, color.darkened(0.35))
			draw_circle(center, r * 0.82, color)
			draw_arc(center, r * 0.55, 0, TAU, 24, color.darkened(0.3), maxf(1.0, r * 0.14), true)
		"tempo":
			var points: = PackedVector2Array([center + Vector2(0, - r), center + Vector2(r * 0.72, 0), center + Vector2(0, r), center + Vector2( - r * 0.72, 0)])
			if filled:
				draw_colored_polygon(points, color)
			else:
				points.append(points[0])
				draw_polyline(points, Color(color, 0.45), maxf(1.0, r * 0.16), true)
		_:
			Emblems.draw_piece(self, shape, center, r, color)
