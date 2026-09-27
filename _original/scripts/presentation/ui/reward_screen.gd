class_name RewardScreen
extends Modal



signal done

var _gs: GameState
var _continue: Button
var _cards: HBoxContainer


func _init() -> void :
	super ("", 900.0, 0.45)
	dismissable = false


func setup(gs: GameState) -> void :
	_gs = gs
	var opening: = str(gs.reward.kind) == "opening"
	var heading: = UiKit.title("Choose your first relic" if opening else "Victory", 40, Palette.GOLD_BRIGHT if not opening else Palette.INK)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(heading)
	var rule: = UiKit.ornament(260)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(rule)
	if opening:
		var line: = UiKit.flavor("Small curiosities. Big consequences.", 20)
		line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		content.add_child(line)
	else:
		var lines: = UiKit.hbox(18)
		lines.alignment = BoxContainer.ALIGNMENT_CENTER
		for entry in gs.reward.lines:
			lines.add_child(UiKit.label("%s  +%d" % [str(entry[0]), int(entry[1])], 19, Palette.MUTED))
		content.add_child(lines)
		var total: = UiKit.hbox(8)
		total.alignment = BoxContainer.ALIGNMENT_CENTER
		total.add_child(Hud.IconBox.make("coin", 26))
		total.add_child(UiKit.number("+%d gold" % int(gs.reward.gold), 26, Palette.GOLD_BRIGHT))
		content.add_child(total)
		if str(gs.reward.revived) != "":
			var revived: = UiKit.label("The Sealed Move returns your %s." % str(gs.reward.revived), 19, Palette.CHAIN)
			revived.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			content.add_child(revived)
	_cards = UiKit.hbox(18)
	_cards.alignment = BoxContainer.ALIGNMENT_CENTER
	content.add_child(_cards)
	var footer: = add_footer([])
	_continue = UiKit.button("Continue", _finish, true, 180)
	footer.add_child(_continue)
	refresh()


func refresh() -> void :
	for child in _cards.get_children():
		child.queue_free()
	var reward: = _gs.reward
	var choosing: bool = not reward.relic_taken and not reward.relic_choices.is_empty()
	if choosing:
		var full: = _gs.relics.size() >= Relics.MAX_EQUIPPED
		for id in reward.relic_choices:
			var info: = Relics.info(str(id))
			var card: = ChoiceCard.make(str(info.icon), str(info.name), str(info.desc), "Choose", str(info.rarity))
			card.chosen.connect(_choose.bind(str(id)))
			if full:
				card.set_enabled(false, "All six relic slots are full.")
			_cards.add_child(card)
		if full:
			var note: = UiKit.label("Your relic slots are full.", 18, Palette.MUTED)
			_cards.add_child(note)
		var skip: = UiKit.button("Skip", _skip)
		skip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_cards.add_child(skip)
	_cards.visible = choosing
	_continue.visible = not choosing
	if not choosing:
		_continue.grab_focus.call_deferred()


func _choose(id: String) -> void :
	if _gs.take_relic(id):
		Sfx.play(&"relic_trigger")
	refresh()


func _skip() -> void :
	_gs.skip_relic()
	refresh()


func _finish() -> void :
	done.emit()
	queue_free()
