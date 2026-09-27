extends RefCounted
## Oracle probe — the EFFECTIVE theme of every Control type the game uses: Godot's default theme merged
## with UiTheme.theme() (what a control under the game's overlay actually resolves). Constants, colours,
## font sizes, font identity, stylebox parameters, icons (as PNG). The port's UI runtime reads this.

const TYPES := ["Label", "Button", "LineEdit", "CheckButton", "OptionButton", "PopupMenu", "HSlider",
	"VScrollBar", "HScrollBar", "ScrollContainer", "PanelContainer", "Panel", "BoxContainer", "HBoxContainer",
	"VBoxContainer", "MarginContainer", "GridContainer", "CenterContainer", "TooltipPanel", "TooltipLabel",
	"RichTextLabel", "TextureRect", "ColorRect", "Control"]


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(host: Node) -> void:
	var default_theme := ThemeDB.get_default_theme()
	var game_theme := UiTheme.theme()
	var root := Control.new()
	root.theme = game_theme
	host.add_child(root)
	var probe := Control.new()
	root.add_child(probe)
	_emit({"k": "globals", "default_font_size": ThemeDB.fallback_font_size, "base_scale": ThemeDB.fallback_base_scale,
		"tooltip_delay": ProjectSettings.get_setting("gui/timers/tooltip_delay_sec"),
		"tooltip_offset": _v2(ProjectSettings.get_setting("display/mouse_cursor/tooltip_position_offset")),
		"default_font": _font_name(game_theme.default_font), "project_default_font_size": game_theme.default_font_size})
	for type in TYPES:
		var entry := {"k": "type", "type": type, "constants": {}, "colors": {}, "font_sizes": {}, "fonts": {}, "styleboxes": {}, "icons": {}}
		var names := {}
		for name in default_theme.get_constant_list(type):
			entry.constants[name] = probe.get_theme_constant(name, type)
		for name in game_theme.get_constant_list(type):
			entry.constants[name] = probe.get_theme_constant(name, type)
		for name in default_theme.get_color_list(type) + game_theme.get_color_list(type):
			entry.colors[name] = probe.get_theme_color(name, type).to_html()
		for name in default_theme.get_font_size_list(type) + game_theme.get_font_size_list(type):
			entry.font_sizes[name] = probe.get_theme_font_size(name, type)
		for name in default_theme.get_font_list(type) + game_theme.get_font_list(type):
			entry.fonts[name] = _font_name(probe.get_theme_font(name, type))
		for name in default_theme.get_stylebox_list(type) + game_theme.get_stylebox_list(type):
			entry.styleboxes[name] = _stylebox(probe.get_theme_stylebox(name, type))
		for name in default_theme.get_icon_list(type) + game_theme.get_icon_list(type):
			entry.icons[name] = _icon(probe.get_theme_icon(name, type))
		_emit(entry)
	root.queue_free()


func _v2(v: Vector2) -> Array:
	return [v.x, v.y]


func _font_name(font: Font) -> String:
	if font == UiTheme.display_font(): return "display"
	if font == UiTheme.caps_font(): return "caps"
	if font == UiTheme.body_font(): return "body"
	if font == UiTheme.bold_font(): return "bold"
	if font == UiTheme.italic_font(): return "italic"
	if font == UiTheme.number_font(): return "numbers"
	if font == null: return "null"
	return "engine:" + font.get_font_name()


func _stylebox(box: StyleBox) -> Dictionary:
	var out := {"class": box.get_class(), "margins": [box.get_margin(SIDE_LEFT), box.get_margin(SIDE_TOP), box.get_margin(SIDE_RIGHT), box.get_margin(SIDE_BOTTOM)],
		"content": [box.content_margin_left, box.content_margin_top, box.content_margin_right, box.content_margin_bottom]}
	if box is StyleBoxFlat:
		var f := box as StyleBoxFlat
		out.merge({"bg": f.bg_color.to_html(), "border": f.border_color.to_html(), "draw_center": f.draw_center,
			"border_width": [f.border_width_left, f.border_width_top, f.border_width_right, f.border_width_bottom],
			"radius": [f.corner_radius_top_left, f.corner_radius_top_right, f.corner_radius_bottom_right, f.corner_radius_bottom_left],
			"corner_detail": f.corner_detail, "expand": [f.expand_margin_left, f.expand_margin_top, f.expand_margin_right, f.expand_margin_bottom],
			"shadow_color": f.shadow_color.to_html(), "shadow_size": f.shadow_size, "shadow_offset": _v2(f.shadow_offset),
			"anti_aliasing": f.anti_aliasing, "aa_size": f.anti_aliasing_size, "blend": f.border_blend, "skew": _v2(f.skew)})
	elif box is StyleBoxLine:
		var l := box as StyleBoxLine
		out.merge({"color": l.color.to_html(), "thickness": l.thickness, "vertical": l.vertical, "grow_begin": l.grow_begin, "grow_end": l.grow_end})
	elif box is StyleBoxTexture:
		out.merge({"texture": _icon(box.texture)})
	return out


func _icon(texture: Texture2D) -> Dictionary:
	if texture == null:
		return {}
	var image := texture.get_image()
	var out := {"size": [texture.get_width(), texture.get_height()]}
	if image != null:
		if image.is_compressed():
			image.decompress()
		out.png = Marshalls.raw_to_base64(image.save_png_to_buffer())
	return out
