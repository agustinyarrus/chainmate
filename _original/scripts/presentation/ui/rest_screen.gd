class_name RestScreen
extends Modal


signal changed
signal leave

var _gs: GameState
var _body: VBoxContainer


func _init() -> void :
	super ("Rest", 1000.0, 0.45)
	dismissable = false


func setup(gs: GameState) -> void :
	_gs = gs
	var line: = UiKit.flavor("A quiet fire. Time to tend the army.", 20)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(line)
	_body = UiKit.vbox(16)
	content.add_child(_body)
	var go: = UiKit.button("Move on", func() -> void :
		leave.emit()
		queue_free(), true, 160)
	add_footer([go])
	refresh()


func refresh() -> void :
	for child in _body.get_children():
		child.queue_free()
	if _gs.rest_done:
		var done: = UiKit.label("Rested. The road goes on.", 22, Palette.INK)
		done.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_body.add_child(done)
		return
	var options: = UiKit.hbox(18)
	options.alignment = BoxContainer.ALIGNMENT_CENTER
	var revive: = ChoiceCard.make("feather", "Revive", "A fallen piece returns to the ranks.", "Choose")
	revive.chosen.connect(_show_picker.bind("revive"))
	if _gs.fallen.is_empty() or _gs.army.size() >= GameState.MAX_ARMY:
		revive.set_enabled(false, "No one to revive.")
	options.add_child(revive)
	var train: = ChoiceCard.make("veteran", "Train", "One piece gains a level and an upgrade.", "Choose")
	train.chosen.connect(_show_picker.bind("train"))
	options.add_child(train)
	var fortify: = ChoiceCard.make("shield", "Fortify", "Every piece begins the next encounter warded.", "Choose")
	fortify.chosen.connect( func() -> void :
		if _gs.rest_fortify():
			Sfx.play(&"train")
		changed.emit()
		refresh())
	options.add_child(fortify)
	_body.add_child(options)


func _show_picker(mode: String) -> void :
	for child in _body.get_children():
		child.queue_free()
	var caption: = UiKit.caption("Choose a fallen piece" if mode == "revive" else "Choose a piece to train", Palette.MUTED, 13)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_body.add_child(caption)
	var entries: Array[Dictionary] = _gs.fallen if mode == "revive" else _gs.army
	var picker: = PiecePicker.make(entries, func(entry: Dictionary) -> bool:
		return mode == "revive" or int(entry.level) < GameState.MAX_LEVEL)
	picker.picked.connect( func(index: int) -> void :
		var ok: = _gs.rest_revive(index) if mode == "revive" else _gs.rest_train(str(_gs.army[index].id))
		if ok:
			Sfx.play(&"promote" if mode == "revive" else &"train")
		changed.emit()
		refresh())
	_body.add_child(picker)
	var back: = UiKit.button("Back", refresh)
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_body.add_child(back)
