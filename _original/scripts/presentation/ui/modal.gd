class_name Modal
extends Control



signal closed

var panel: PanelContainer
var content: VBoxContainer
var dismissable: = true
var _frame: Control


func _init(title_text: = "", width: = 640.0, scrim_alpha: = 0.6) -> void :
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	theme = UiTheme.theme()
	add_child(UiKit.scrim(scrim_alpha))
	panel = UiKit.panel(Color(0.04, 0.06, 0.095, 0.97), Palette.PANEL_EDGE_STRONG, Vector4(34, 28, 34, 28), 4)
	panel.custom_minimum_size.x = width

	_frame = Control.new()
	_frame.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame.add_child(panel)
	add_child(_frame)
	content = UiKit.vbox(14)
	panel.add_child(content)
	if title_text != "":
		var heading: = UiKit.title(title_text, 34, Palette.INK)
		heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		content.add_child(heading)
		var rule: = UiKit.ornament(240)
		rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		content.add_child(rule)


func _ready() -> void :
	UiKit.fade_in(_frame, 0.22, 16.0)
	panel.minimum_size_changed.connect(_fit, CONNECT_DEFERRED)
	resized.connect(_fit, CONNECT_DEFERRED)
	_fit()




func _fit() -> void :
	panel.reset_size()
	var need: = panel.size
	var room: = size - Vector2(32.0, 32.0)
	var fit: = minf(1.0, minf(room.x / need.x, room.y / need.y))
	panel.pivot_offset = need * 0.5
	panel.scale = Vector2(fit, fit)
	panel.position = (size - need) * 0.5


func _unhandled_input(event: InputEvent) -> void :
	if dismissable and (event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel")):
		get_viewport().set_input_as_handled()
		close()


func close() -> void :
	Sfx.play(&"ui_back")
	closed.emit()
	queue_free()



func add_row(caption_text: String, control: Control) -> HBoxContainer:
	var row: = UiKit.hbox(16)
	var label: = UiKit.label(caption_text, 19, Palette.INK)
	label.custom_minimum_size.x = 240
	row.add_child(label)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(control)
	content.add_child(row)
	return row



func add_footer(buttons: Array[Button]) -> HBoxContainer:
	content.add_child(UiKit.gap(4))
	var row: = UiKit.hbox(12)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	for button in buttons:
		row.add_child(button)
	content.add_child(row)
	return row
