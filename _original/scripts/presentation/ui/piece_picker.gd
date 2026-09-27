class_name PiecePicker
extends HBoxContainer


signal picked(index: int)


static func make(entries: Array[Dictionary], enabled: Callable = Callable()) -> PiecePicker:
	var row: = PiecePicker.new()
	row.add_theme_constant_override("separation", 8)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	for i in entries.size():
		var entry: Dictionary = entries[i]
		var button: = Button.new()
		button.custom_minimum_size = Vector2(92, 104)
		button.tooltip_text = "%s · level %d" % [UiKit.piece_name(str(entry.kind)), int(entry.level)]
		button.focus_mode = Control.FOCUS_ALL
		if enabled.is_valid():
			button.disabled = not bool(enabled.call(entry))
		var column: = UiKit.vbox(2)
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		column.alignment = BoxContainer.ALIGNMENT_CENTER
		var portrait: = Hud.PiecePortrait.new()
		portrait.kind = str(entry.kind)
		portrait.level = int(entry.level)
		portrait.custom_minimum_size = Vector2(0, 70)
		portrait.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.add_child(portrait)
		var title_label: = UiKit.caption(UiKit.piece_name(str(entry.kind)), Palette.INK, 11)
		title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		column.add_child(title_label)
		button.add_child(column)
		button.pressed.connect( func() -> void :
			Sfx.play(&"ui_click")
			row.picked.emit(i))
		row.add_child(button)
	return row
