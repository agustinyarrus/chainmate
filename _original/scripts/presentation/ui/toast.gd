class_name Toast
extends PanelContainer



static func show_on(parent: Control, text: String, color: = Palette.INK, hold: = 2.2) -> void :
	var toast: = Toast.new()
	toast.add_theme_stylebox_override("panel", UiTheme.box(Color(0.03, 0.045, 0.075, 0.95), Color(color, 0.55), 1, 3, Vector4(20, 10, 20, 10)))
	toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast.add_child(UiKit.label(text, 19, color))
	toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var stacked: = 0
	for child in parent.get_children():
		if child is Toast:
			stacked += 1
	toast.offset_top = 150 + stacked * 54
	parent.add_child(toast)
	toast.modulate.a = 0.0
	var tween: = toast.create_tween()
	tween.tween_property(toast, "modulate:a", 1.0, 0.2)
	tween.tween_interval(hold)
	tween.tween_property(toast, "modulate:a", 0.0, 0.4)
	tween.tween_callback(toast.queue_free)
