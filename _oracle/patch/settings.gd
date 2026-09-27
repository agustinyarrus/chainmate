extends Node




signal changed(key: String)

const PATH: = "user://settings.cfg"
const DEFAULTS: = {
	"master_volume": 0.8, 
	"music_volume": 0.55, 
	"sfx_volume": 0.85, 
	"fullscreen": false, 
	"vsync": true, 
	"screen_shake": 1.0, 
	"animation_speed": 1.0, 
	"reduced_motion": false, 
	"high_contrast": false, 
	"ui_scale": 1.0, 
}

var values: Dictionary = DEFAULTS.duplicate()
var ephemeral: = false


func _ready() -> void :
	var oracle := _oracle_path()
	if oracle != "":
		_run_oracle(oracle)
		return
	ephemeral = OS.get_cmdline_user_args().has("--ephemeral") or OS.get_cmdline_user_args().has("--capture")
	_register_input()
	if not ephemeral:
		_load()
	apply.call_deferred()


func get_value(key: String) -> Variant:
	return values[key]


func set_value(key: String, value: Variant) -> void :
	if not DEFAULTS.has(key) or values.get(key) == value:
		return
	values[key] = value
	apply()
	_save()
	changed.emit(key)



func duration(seconds: float) -> float:
	var speed: = float(get_value("animation_speed"))
	if get_value("reduced_motion"):
		speed *= 1.6
	return seconds / maxf(speed, 0.1)


func shake_scale() -> float:
	return 0.0 if get_value("reduced_motion") else float(get_value("screen_shake"))


func apply() -> void :
	Sfx.set_bus_volume("Master", float(get_value("master_volume")))
	Sfx.set_bus_volume("Music", float(get_value("music_volume")))
	Sfx.set_bus_volume("SFX", float(get_value("sfx_volume")))
	if DisplayServer.get_name() != "headless" and not ephemeral:
		var mode: = DisplayServer.WINDOW_MODE_FULLSCREEN if get_value("fullscreen") else DisplayServer.WINDOW_MODE_WINDOWED
		if DisplayServer.window_get_mode() != mode:
			DisplayServer.window_set_mode(mode)
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if get_value("vsync") else DisplayServer.VSYNC_DISABLED)
	get_tree().root.content_scale_factor = clampf(float(get_value("ui_scale")), 0.75, 1.5)


func _load() -> void :
	var config: = ConfigFile.new()
	if config.load(PATH) != OK:
		return
	for key in DEFAULTS:
		var stored = config.get_value("settings", key, DEFAULTS[key])
		if typeof(stored) == typeof(DEFAULTS[key]) or (typeof(DEFAULTS[key]) == TYPE_FLOAT and typeof(stored) == TYPE_INT):
			values[key] = stored


func _save() -> void :
	if ephemeral:
		return
	var config: = ConfigFile.new()
	for key in values:
		config.set_value("settings", key, values[key])
	config.save(PATH)


func _register_input() -> void :
	_bind("cursor_up", [KEY_UP, KEY_W], [JOY_BUTTON_DPAD_UP])
	_bind("cursor_down", [KEY_DOWN, KEY_S], [JOY_BUTTON_DPAD_DOWN])
	_bind("cursor_left", [KEY_LEFT, KEY_A], [JOY_BUTTON_DPAD_LEFT])
	_bind("cursor_right", [KEY_RIGHT, KEY_D], [JOY_BUTTON_DPAD_RIGHT])
	_bind("cursor_act", [KEY_SPACE], [JOY_BUTTON_A])
	_bind("confirm", [KEY_ENTER, KEY_KP_ENTER], [JOY_BUTTON_X])
	_bind("undo", [KEY_BACKSPACE], [JOY_BUTTON_B])
	_bind("cycle_piece", [KEY_TAB], [JOY_BUTTON_RIGHT_STICK])
	_bind("pause", [KEY_ESCAPE], [JOY_BUTTON_START])
	_bind("hint", [KEY_H], [JOY_BUTTON_Y])
	_bind("help", [KEY_F1], [JOY_BUTTON_BACK])
	_bind("camera_left", [KEY_Q], [JOY_BUTTON_LEFT_SHOULDER])
	_bind("camera_right", [KEY_E], [JOY_BUTTON_RIGHT_SHOULDER])
	_bind("camera_reset", [KEY_C], [JOY_BUTTON_LEFT_STICK])


func _bind(action: StringName, keys: Array, buttons: Array) -> void :
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	for key in keys:
		var event: = InputEventKey.new()
		event.physical_keycode = key
		InputMap.action_add_event(action, event)
	for button in buttons:
		var pad: = InputEventJoypadButton.new()
		pad.button_index = button
		InputMap.action_add_event(action, pad)


# --- Oracle hook (only in the patched build used by the port's test-suite) ----------------------
# `-- --oracle=<absolute path to a .gd>` loads that probe (a RefCounted with `run(host)`), runs it
# and quits. Normal launches never pass the argument, so the game behaves exactly as shipped.
func _oracle_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--oracle="):
			return arg.trim_prefix("--oracle=")
	return ""


func _run_oracle(path: String) -> void:
	ephemeral = true
	var script: GDScript = load(path)
	if script == null:
		print("ORACLE_ERROR cannot load ", path)
	else:
		var probe: Object = script.new()
		# Probes may be coroutines (they wait frames for layout); a plain return passes straight through.
		await probe.call("run", self)
	print("ORACLE_DONE")
	get_tree().quit()
