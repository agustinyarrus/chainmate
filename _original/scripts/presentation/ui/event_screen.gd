class_name EventScreen
extends Modal


signal changed
signal leave

var _gs: GameState
var _body: VBoxContainer


func _init() -> void :
	super ("", 760.0, 0.45)
	dismissable = false


func setup(gs: GameState) -> void :
	_gs = gs
	var info: = Events.info(str(gs.event.id))
	var icon: = Hud.IconBox.make("unknown", 64)
	icon.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(icon)
	var heading: = UiKit.title(str(info.title), 34, Palette.INK)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(heading)
	var rule: = UiKit.ornament(220)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(rule)
	var text: = UiKit.wrap(str(info.text), 21, Palette.INK, 680)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(text)
	_body = UiKit.vbox(10)
	content.add_child(_body)
	refresh()


func refresh() -> void :
	for child in _body.get_children():
		child.queue_free()
	if _gs.event.resolved:
		var outcome: = UiKit.wrap(str(_gs.event.outcome), 21, Palette.GOLD_BRIGHT, 680)
		outcome.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_body.add_child(outcome)
		var go: = UiKit.button("Continue", func() -> void :
			leave.emit()
			queue_free(), true, 180)
		go.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_body.add_child(go)
		go.grab_focus.call_deferred()
		return
	var choices: Array = Events.info(str(_gs.event.id)).choices
	for i in choices.size():
		var choice: Dictionary = choices[i]
		var row: = UiKit.hbox(14)
		var button: = UiKit.button(str(choice.label), _choose.bind(i), i == 0, 230)
		button.disabled = not _gs.event_choice_available(i)
		row.add_child(button)
		row.add_child(UiKit.wrap(str(choice.desc), 19, Palette.MUTED if not button.disabled else Palette.FAINT, 400))
		_body.add_child(row)


func _choose(index: int) -> void :
	_gs.event_choose(index)
	Sfx.play(&"relic_trigger")
	changed.emit()
	refresh()
