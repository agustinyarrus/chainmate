class_name SettingsPanel
extends Modal



func _init() -> void :
	super ("Settings", 620.0, 0.6)


func _ready() -> void :
	super ()
	content.add_child(UiKit.caption("Audio"))
	_slider("Master volume", "master_volume")
	_slider("Music", "music_volume")
	_slider("Effects", "sfx_volume")
	content.add_child(UiKit.gap(4))
	content.add_child(UiKit.caption("Display"))
	_toggle("Fullscreen", "fullscreen")
	_toggle("Vertical sync", "vsync")
	_choice("Interface scale", "ui_scale", [["85%", 0.85], ["100%", 1.0], ["115%", 1.15], ["130%", 1.3]])
	content.add_child(UiKit.gap(4))
	content.add_child(UiKit.caption("Motion and readability"))
	_choice("Animation speed", "animation_speed", [["Relaxed", 0.8], ["Normal", 1.0], ["Brisk", 1.5], ["Fast", 2.2]])
	_slider("Screen shake", "screen_shake")
	_toggle("Reduced motion", "reduced_motion")
	_toggle("High-contrast highlights", "high_contrast")
	content.add_child(UiKit.rule())
	var footer: = UiKit.hbox(10)
	footer.add_child(UiKit.caption("Settings save automatically", Palette.FAINT, 12))
	footer.add_child(UiKit.spacer())
	var done: = UiKit.button("Done", close, true, 120)
	footer.add_child(done)
	content.add_child(footer)
	done.grab_focus.call_deferred()


func _slider(text: String, key: String) -> void :
	var slider: = HSlider.new()
	slider.min_value = 0.0
	slider.max_value = 1.0
	slider.step = 0.05
	slider.value = float(Settings.get_value(key))
	slider.custom_minimum_size = Vector2(220, 24)
	slider.value_changed.connect( func(v: float) -> void :
		Settings.set_value(key, v))
	slider.drag_ended.connect( func(_changed: bool) -> void : Sfx.play(&"ui_click"))
	add_row(text, slider)


func _toggle(text: String, key: String) -> void :
	var check: = CheckButton.new()
	check.button_pressed = bool(Settings.get_value(key))
	check.toggled.connect( func(on: bool) -> void :
		Sfx.play(&"ui_click")
		Settings.set_value(key, on))
	add_row(text, check)


func _choice(text: String, key: String, options: Array) -> void :
	var picker: = OptionButton.new()
	var current: = float(Settings.get_value(key))
	for i in options.size():
		picker.add_item(str(options[i][0]), i)
		if is_equal_approx(float(options[i][1]), current):
			picker.select(i)
	picker.item_selected.connect( func(index: int) -> void :
		Sfx.play(&"ui_click")
		Settings.set_value(key, float(options[index][1])))
	add_row(text, picker)
