class_name MenuScreen
extends Control


signal continue_run
signal new_run
signal show_help
signal show_records
signal show_settings
signal show_credits
signal quit_game

var _first_button: Button


func setup(has_save: bool, summary: String) -> void :
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UiTheme.theme()
	var shade: = TextureRect.new()
	shade.texture = _side_gradient()
	shade.set_anchors_and_offsets_preset(Control.PRESET_LEFT_WIDE)
	shade.offset_right = 820
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	add_child(shade)

	var margin: = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_LEFT_WIDE)
	margin.add_theme_constant_override("margin_left", 110)
	margin.add_theme_constant_override("margin_top", 96)
	margin.add_theme_constant_override("margin_bottom", 70)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(margin)
	var column: = UiKit.vbox(10)
	column.custom_minimum_size.x = 440
	margin.add_child(column)
	var crown: = Hud.IconBox.make("crown", 40)
	crown.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	column.add_child(crown)
	column.add_child(UiKit.title("Chainmate", 88, Palette.INK))
	column.add_child(UiKit.ornament(360))
	column.add_child(UiKit.caption("A chess roguelite", Palette.GOLD, 15))
	column.add_child(UiKit.gap(8))
	column.add_child(UiKit.wrap("Same rules. More possibilities. Lead your ivory army across three acts, grow every piece, and never let the king fall.", 21, Palette.MUTED, 440))
	column.add_child(UiKit.gap(24))
	if has_save:
		_add(column, "Continue run", func() -> void : continue_run.emit(), true)
		_add(column, "New run", func() -> void : new_run.emit())
	else:
		_add(column, "New run", func() -> void : new_run.emit(), true)
	_add(column, "How to play", func() -> void : show_help.emit())
	_add(column, "Records", func() -> void : show_records.emit())
	_add(column, "Settings", func() -> void : show_settings.emit())
	_add(column, "Credits", func() -> void : show_credits.emit())

	if not OS.has_feature("web"):
		_add(column, "Quit", func() -> void : quit_game.emit())
	column.add_child(UiKit.spacer(false))
	if summary != "":
		column.add_child(UiKit.caption(summary, Palette.FAINT, 12))
	UiKit.fade_in(margin, 0.5, 20.0)


func _ready() -> void :
	if _first_button:
		_first_button.grab_focus.call_deferred()


func _add(column: VBoxContainer, text: String, action: Callable, primary: = false) -> void :
	var button: = UiKit.button(text, action, primary, 300)
	button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	column.add_child(button)
	if _first_button == null:
		_first_button = button


static func _side_gradient() -> GradientTexture2D:
	var gradient: = Gradient.new()
	gradient.set_color(0, Color(0.03, 0.045, 0.07, 0.94))
	gradient.set_color(1, Color(0.03, 0.045, 0.07, 0.0))
	var texture: = GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill_from = Vector2(0, 0.5)
	texture.fill_to = Vector2(1, 0.5)
	texture.width = 256
	texture.height = 4
	return texture
