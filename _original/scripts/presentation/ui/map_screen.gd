class_name MapScreen
extends Control



signal node_chosen(index: int)

var _gs: GameState
var _view: MapView


func setup(gs: GameState) -> void :
	_gs = gs
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UiTheme.theme()
	add_child(UiKit.scrim(0.35))
	var frame: = UiKit.panel(Color(0.04, 0.06, 0.095, 0.95), Palette.PANEL_EDGE_STRONG, Vector4(28, 22, 28, 24), 4)
	frame.custom_minimum_size = Vector2(1180, 0)
	add_child(UiKit.centered(frame))
	var column: = UiKit.vbox(12)
	frame.add_child(column)

	var header: = UiKit.hbox(16)
	var titles: = UiKit.vbox(2)
	titles.add_child(UiKit.caption("Run map · act %s of 3" % ["I", "II", "III"][gs.act], Palette.MUTED, 13))
	var act: Dictionary = gs.act_info()
	titles.add_child(UiKit.title(str(act.name), 36, Palette.INK))
	titles.add_child(UiKit.flavor(str(act.tagline), 19))
	header.add_child(titles)
	header.add_child(UiKit.spacer())
	var stats: = UiKit.vbox(6)
	stats.alignment = BoxContainer.ALIGNMENT_END
	var purse: = UiKit.hbox(8)
	purse.alignment = BoxContainer.ALIGNMENT_END
	purse.add_child(Hud.IconBox.make("coin", 24))
	purse.add_child(UiKit.number(str(gs.gold), 24, Palette.GOLD_BRIGHT))
	stats.add_child(purse)
	var counter: = UiKit.label("Encounters won  %d / %d" % [gs.encounters_won, gs.total_encounters()], 19, Palette.MUTED)
	counter.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stats.add_child(counter)
	header.add_child(stats)
	column.add_child(header)

	var body: = UiKit.hbox(18)
	column.add_child(body)
	_view = MapView.new()
	_view.custom_minimum_size = Vector2(900, 440)
	_view.gs = gs
	_view.chosen.connect( func(index: int) -> void : node_chosen.emit(index))
	body.add_child(_view)
	var legend: = UiKit.vbox(10)
	legend.custom_minimum_size.x = 190
	legend.add_child(UiKit.caption("Legend", Palette.MUTED, 12))
	for kind in ["encounter", "elite", "merchant", "rest", "unknown", "boss"]:
		var row: = UiKit.hbox(10)
		row.add_child(Hud.IconBox.make(kind, 30))
		var text: = UiKit.vbox(0)
		text.add_child(UiKit.label(str(RunMap.NODE_INFO[kind].name), 19, Palette.INK))
		text.add_child(UiKit.wrap(str(RunMap.NODE_INFO[kind].desc), 15, Palette.FAINT, 140))
		row.add_child(text)
		legend.add_child(row)
	body.add_child(legend)

	var footer: = UiKit.hbox(10)
	footer.add_child(UiKit.caption("Army", Palette.MUTED, 12))
	for entry in gs.army:
		var portrait: = Hud.PiecePortrait.new()
		portrait.kind = str(entry.kind)
		portrait.level = int(entry.level)
		portrait.custom_minimum_size = Vector2(44, 56)
		portrait.tooltip_text = "%s · level %d" % [UiKit.piece_name(str(entry.kind)), int(entry.level)]
		footer.add_child(portrait)
	if not gs.fallen.is_empty():
		footer.add_child(UiKit.caption("  Fallen %d" % gs.fallen.size(), Palette.CAPTURE, 12))
	footer.add_child(UiKit.spacer())
	for id in gs.relics:
		footer.add_child(RelicToken.make(id, 44))
	column.add_child(footer)
	var hint: = UiKit.flavor("A longer road. Stronger ideas.  Choose where to go next.", 18)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(hint)
	UiKit.fade_in(frame, 0.3, 0.0)



class MapView:
	extends Control
	signal chosen(index: int)

	var gs: GameState
	var _hover: = -1
	var _time: = 0.0

	func _ready() -> void :
		mouse_filter = Control.MOUSE_FILTER_STOP

	func _process(delta: float) -> void :
		_time += delta
		queue_redraw()

	func _positions() -> Array:
		var columns: = []
		var steps: Array = gs.map
		for s in steps.size():
			var nodes: Array = steps[s]
			var x: = lerpf(90.0, size.x - 90.0, float(s) / (steps.size() - 1))
			var column: = []
			for n in nodes.size():
				var spread: = 150.0 if nodes.size() > 1 else 0.0
				var y: = size.y * 0.5 + (n - (nodes.size() - 1) * 0.5) * spread
				y += sin(float(s * 3 + n) * 1.7 + gs.act) * 18.0
				column.append(Vector2(x, y))
			columns.append(column)
		return columns

	func _gui_input(event: InputEvent) -> void :
		if event is InputEventMouseMotion:
			var hovered: = _node_at(event.position)
			if hovered != _hover:
				_hover = hovered
				if hovered >= 0:
					Sfx.play(&"ui_hover", 1.0, -6.0)
				mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hovered >= 0 else Control.CURSOR_ARROW
				tooltip_text = str(RunMap.NODE_INFO[gs.map[gs.step][hovered]].desc) if hovered >= 0 else ""
		elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:

			var clicked: = _node_at(event.position)
			if clicked >= 0:
				Sfx.play(&"ui_click")
				chosen.emit(clicked)


	func _node_at(point: Vector2) -> int:
		var positions: = _positions()
		for n in positions[gs.step].size():
			if point.distance_to(positions[gs.step][n]) < 40.0:
				return n
		return -1

	func _draw() -> void :
		var rect: = Rect2(Vector2.ZERO, size)

		draw_rect(rect, Color("5a4630"))
		draw_rect(rect.grow(-6), Color("8a7152"))
		for i in 26:
			var t: = float(i)
			var at: = Vector2(fposmod(sin(t * 12.9898) * 43758.5, 1.0) * size.x, fposmod(sin(t * 78.233) * 12345.6, 1.0) * size.y)
			draw_circle(at, 30.0 + fposmod(t * 37.0, 60.0), Color(0.3, 0.22, 0.14, 0.08))
		for edge in 18:
			var inset: = float(edge) * 3.0
			draw_rect(rect.grow( - inset), Color(0.16, 0.11, 0.07, 0.035), false, 3.0)
		var positions: = _positions()
		var visited: Array = Array(gs.path)

		for s in positions.size() - 1:
			for a in positions[s].size():
				for b in positions[s + 1].size():
					var travelled: bool = s < visited.size() and visited[s] == a and (s + 1 >= visited.size() or visited[s + 1] == b)
					var towards_choice: bool = s == gs.step - 1 and s < visited.size() and visited[s] == a
					var color: = Color("3b2a1a", 0.55)
					var width: = 2.0
					if travelled and s + 1 < visited.size():
						color = Palette.GOLD
						width = 3.0
					elif towards_choice:
						color = Color(Palette.ACCENT, 0.7)
						width = 2.5
					_dashed(positions[s][a], positions[s + 1][b], color, width)
		for s in positions.size():
			for n in positions[s].size():
				var kind: = str(gs.map[s][n])
				var centre: Vector2 = positions[s][n]
				var is_current: = s == gs.step
				var was_visited: bool = s < visited.size() and visited[s] == n
				var radius: = 30.0 if kind != "boss" else 38.0
				if is_current:
					var glow: = 0.5 + 0.5 * sin(_time * 3.0 + n)
					draw_circle(centre, radius + 10.0 + glow * 4.0, Color(Palette.ACCENT, 0.18 + 0.12 * glow))
					if n == _hover:
						draw_circle(centre, radius + 8.0, Color(Palette.ACCENT, 0.45))
				draw_circle(centre + Vector2(2, 3), radius, Color(0, 0, 0, 0.35))
				draw_circle(centre, radius, Color("1a1f2a") if not was_visited else Color("2a2418"))
				var ring: = Palette.GOLD if was_visited else (Palette.ACCENT if is_current else Color("c9b48a", 0.6))
				draw_arc(centre, radius, 0, TAU, 40, ring, 2.5 if (was_visited or is_current) else 1.5, true)
				var faded: = s > gs.step
				Icons.draw(self, kind, centre, radius * 0.62)
				if faded:
					draw_circle(centre, radius - 1.0, Color(0.1, 0.08, 0.06, 0.45))

	func _dashed(a: Vector2, b: Vector2, color: Color, width: float) -> void :
		var length: = a.distance_to(b)
		var count: = int(length / 14.0)
		for i in count:
			if i % 2 == 0:
				var p0: = a.lerp(b, float(i) / count)
				var p1: = a.lerp(b, float(i + 1) / count)
				draw_line(p0, p1, color, width, true)
