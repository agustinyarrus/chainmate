class_name UiKit
extends RefCounted



static func label(text: String, size: = 20, color: = Palette.INK, font: Font = null) -> Label:
	var node: = Label.new()
	node.text = text
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	if font != null:
		node.add_theme_font_override("font", font)
	return node



static func title(text: String, size: = 34, color: = Palette.INK) -> Label:
	return label(text, size, color, UiTheme.display_font())



static func caption(text: String, color: = Palette.MUTED, size: = 13) -> Label:
	return label(text.to_upper(), size, color, UiTheme.caps_font())



static func flavor(text: String, size: = 18, color: = Palette.MUTED) -> Label:
	return label(text, size, color, UiTheme.italic_font())


static func number(text: String, size: = 28, color: = Palette.INK) -> Label:
	return label(text, size, color, UiTheme.number_font())


static func wrap(text: String, size: = 18, color: = Palette.MUTED, width: = 300.0) -> Label:
	var node: = label(text, size, color)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.custom_minimum_size.x = width
	return node


static func rich(bbcode: String, size: = 19, width: = 320.0) -> RichTextLabel:
	var node: = RichTextLabel.new()
	node.bbcode_enabled = true
	node.fit_content = true
	node.scroll_active = false
	node.text = bbcode
	node.custom_minimum_size.x = width
	node.add_theme_font_override("normal_font", UiTheme.body_font())
	node.add_theme_font_override("bold_font", UiTheme.bold_font())
	node.add_theme_font_override("italics_font", UiTheme.italic_font())
	node.add_theme_font_size_override("normal_font_size", size)
	node.add_theme_font_size_override("bold_font_size", size)
	node.add_theme_font_size_override("italics_font_size", size)
	node.add_theme_color_override("default_color", Palette.INK)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func button(text: String, action: Callable, primary: = false, min_width: = 0.0) -> Button:
	var node: = Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_ALL
	node.custom_minimum_size.x = min_width
	if primary:
		style_primary(node)
	node.mouse_entered.connect(_hover_sound.bind(node))
	node.pressed.connect( func() -> void : Sfx.play(&"ui_click"))
	if action.is_valid():
		node.pressed.connect(action)
	return node


static func _hover_sound(node: Button) -> void :
	if not node.disabled:
		Sfx.play(&"ui_hover", 1.0, -6.0)



static func style_primary(node: Button) -> void :
	var pad: = Vector4(24, 10, 24, 11)
	var normal: = UiTheme.box(Color(0.06, 0.1, 0.17, 0.96), Palette.ACCENT, 1, 3, pad)
	normal.shadow_color = Color(Palette.ACCENT, 0.35)
	normal.shadow_size = 8
	var hover: = UiTheme.box(Color(0.09, 0.15, 0.26, 0.98), Palette.ACCENT.lightened(0.3), 1, 3, pad)
	hover.shadow_color = Color(Palette.ACCENT, 0.55)
	hover.shadow_size = 12
	node.add_theme_stylebox_override("normal", normal)
	node.add_theme_stylebox_override("hover", hover)
	node.add_theme_stylebox_override("pressed", UiTheme.box(Color(0.12, 0.2, 0.34, 1.0), Palette.ACCENT.lightened(0.3), 1, 3, pad))
	node.add_theme_stylebox_override("disabled", UiTheme.box(Color(0.04, 0.05, 0.075, 0.7), Color(1, 1, 1, 0.08), 1, 3, pad))
	node.add_theme_font_size_override("font_size", 17)


static func vbox(separation: = 10) -> VBoxContainer:
	var node: = VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	return node


static func hbox(separation: = 10) -> HBoxContainer:
	var node: = HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	return node


static func spacer(expand_horizontal: = true) -> Control:
	var node: = Control.new()
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if expand_horizontal:
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		node.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return node


static func gap(height: float) -> Control:
	var node: = Control.new()
	node.custom_minimum_size = Vector2(0, height)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func panel(fill: = Palette.PANEL, edge: = Palette.PANEL_EDGE, pad: = Vector4(22, 18, 22, 18), radius: = 4) -> PanelContainer:
	var node: = PanelContainer.new()
	node.add_theme_stylebox_override("panel", UiTheme.box(fill, edge, 1, radius, pad))
	return node


static func rule(color: = Palette.PANEL_EDGE) -> ColorRect:
	var node: = ColorRect.new()
	node.color = color
	node.custom_minimum_size = Vector2(0, 1)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node



static func ornament(width: = 160.0, color: = Palette.GOLD) -> Control:
	var node: = Ornament.new()
	node.custom_minimum_size = Vector2(width, 12)
	node.color = color
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node



static func scrim(alpha: = 0.55) -> ColorRect:
	var node: = ColorRect.new()
	node.color = Color(0.01, 0.015, 0.025, alpha)
	node.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	node.mouse_filter = Control.MOUSE_FILTER_STOP
	return node


static func centered(child: Control) -> CenterContainer:
	var node: = CenterContainer.new()
	node.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_child(child)
	return node




static func fade_in(node: CanvasItem, duration: = 0.25, rise: = 12.0) -> void :
	node.modulate.a = 0.0
	var tween: = node.create_tween().set_parallel(true)
	tween.tween_property(node, "modulate:a", 1.0, duration)
	if node is Control and rise != 0.0:
		var control: = node as Control
		assert ( not control.get_parent() is Container, "fade_in cannot rise a container child")
		var rest: = control.position
		control.position.y += rise
		tween.tween_property(control, "position:y", rest.y, duration).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


static func format_int(value: int) -> String:
	var digits: = str(absi(value))
	var out: = ""
	while digits.length() > 3:
		out = "," + digits.substr(digits.length() - 3) + out
		digits = digits.substr(0, digits.length() - 3)
	return ("-" if value < 0 else "") + digits + out


static func piece_name(kind: String) -> String:
	return str(ChessRules.PIECE_INFO[kind].name)



class Ornament:
	extends Control
	var color: = Palette.GOLD

	func _draw() -> void :
		var mid: = size * 0.5
		draw_line(Vector2(0, mid.y), Vector2(mid.x - 9, mid.y), Color(color, 0.55), 1.0, true)
		draw_line(Vector2(mid.x + 9, mid.y), Vector2(size.x, mid.y), Color(color, 0.55), 1.0, true)
		draw_colored_polygon(PackedVector2Array([mid + Vector2(0, -5), mid + Vector2(5, 0), mid + Vector2(0, 5), mid + Vector2(-5, 0)]), color)
