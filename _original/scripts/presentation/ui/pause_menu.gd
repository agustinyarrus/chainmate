class_name PauseMenu
extends Modal


signal show_help
signal show_settings
signal restart_run
signal quit_to_menu

var _restart: Button


func _init() -> void :
	super ("Paused", 420.0, 0.6)


func setup(gs: GameState) -> void :
	var line: = UiKit.caption("%s · seed %s" % [str(gs.act_info().name), gs.seed_text], Palette.FAINT, 11)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(line)
	var resume: = UiKit.button("Resume", close, true)
	content.add_child(resume)
	content.add_child(UiKit.button("Settings", func() -> void : show_settings.emit()))
	content.add_child(UiKit.button("Rules", func() -> void : show_help.emit()))
	_restart = UiKit.button("Restart run", _confirm_restart)
	_restart.tooltip_text = "Abandon this run and start again with the same choices."
	content.add_child(_restart)
	content.add_child(UiKit.button("Main menu", func() -> void : quit_to_menu.emit()))
	resume.grab_focus.call_deferred()


func _confirm_restart() -> void :
	if _restart.text != "Confirm restart":
		_restart.text = "Confirm restart"
		_restart.add_theme_color_override("font_color", Palette.CAPTURE)
		return
	restart_run.emit()
	queue_free()
