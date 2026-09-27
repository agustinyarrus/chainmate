class_name OptionCard
extends PanelContainer


signal pressed

var selected: = false:
	set(value):
		selected = value
		_restyle()
var locked: = false:
	set(value):
		locked = value
		_restyle()
var _hover: = false


func _init() -> void :
	focus_mode = Control.FOCUS_ALL
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _ready() -> void :
	mouse_entered.connect(_set_hover.bind(true))
	mouse_exited.connect(_set_hover.bind(false))
	focus_entered.connect(_restyle)
	focus_exited.connect(_restyle)
	_restyle()


func _set_hover(on: bool) -> void :
	_hover = on
	if on and not locked:
		Sfx.play(&"ui_hover", 1.0, -6.0)
	_restyle()


func _gui_input(event: InputEvent) -> void :
	var clicked: bool = event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	if (clicked or event.is_action_pressed("ui_accept")) and not locked:
		Sfx.play(&"ui_click")
		pressed.emit()
		accept_event()


func _restyle() -> void :
	var pad: = Vector4(16, 14, 16, 14)
	if selected:
		add_theme_stylebox_override("panel", UiTheme.glow_box(pad))
	elif (_hover or has_focus()) and not locked:
		add_theme_stylebox_override("panel", UiTheme.box(Color(0.06, 0.09, 0.14, 0.96), Color(Palette.ACCENT, 0.6), 1, 4, pad))
	else:
		add_theme_stylebox_override("panel", UiTheme.box(Color(0.045, 0.065, 0.1, 0.94), Palette.PANEL_EDGE, 1, 4, pad))
	modulate.a = 0.55 if locked else 1.0
