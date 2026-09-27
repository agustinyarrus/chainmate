class_name LevelUpScreen
extends Modal


signal done

var _gs: GameState
var _heading: Label
var _sub: Label
var _cards: HBoxContainer


func _init() -> void :
	super ("", 980.0, 0.5)
	dismissable = false


func setup(gs: GameState) -> void :
	_gs = gs
	var caption: = UiKit.caption("Level up", Palette.GOLD, 14)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(caption)
	_heading = UiKit.title("", 34, Palette.INK)
	_heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(_heading)
	var rule: = UiKit.ornament(240)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(rule)
	_sub = UiKit.flavor("", 20)
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(_sub)
	_cards = UiKit.hbox(18)
	_cards.alignment = BoxContainer.ALIGNMENT_CENTER
	content.add_child(_cards)
	refresh()


func refresh() -> void :
	for child in _cards.get_children():
		child.queue_free()
	if _gs.pending_levels.is_empty():
		done.emit()
		queue_free()
		return
	var pending: Dictionary = _gs.pending_levels[0]
	var entry: = _gs.army_entry(str(pending.id))
	var kind: = str(entry.kind)
	_heading.text = "Choose an upgrade for your %s" % UiKit.piece_name(kind)
	_sub.text = "%s reaches level %d.  %s" % [UiKit.piece_name(kind), int(entry.level), str(ChessRules.PIECE_INFO[kind].flavor)]
	var choices: = _gs.current_level_choices()
	if choices.is_empty():
		var note: = UiKit.label("Nothing left to learn. The level still counts.", 19, Palette.MUTED)
		_cards.add_child(note)
		_cards.add_child(UiKit.button("Continue", _skip, true))
		return
	var first: ChoiceCard = null
	for id in choices:
		var info: = Upgrades.info(id)
		var card: = ChoiceCard.make(id, str(info.name), str(info.desc), "Choose", "", kind)
		card.chosen.connect(_choose.bind(id))
		_cards.add_child(card)
		if first == null:
			first = card
	first.focus_button()


func _choose(id: String) -> void :
	if _gs.choose_level(id):
		Sfx.play(&"level_up")
	refresh()


func _skip() -> void :
	_gs.skip_level()
	refresh()
