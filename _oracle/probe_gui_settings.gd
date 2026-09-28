extends RefCounted
## Oracle probe — the GUI project settings the port's input model depends on.

func run(_host: Node) -> void:
	var keys := ["gui/common/show_focus_state_on_pointer_event", "gui/timers/tooltip_delay_sec", "gui/common/drag_threshold", "display/window/subwindows/embed_subwindows"]
	var out := {}
	for key in keys:
		out[key] = ProjectSettings.get_setting(key)
	print("ORACLE ", JSON.stringify(out))
