class_name NewRunScreen
extends Modal


signal begin(config: Dictionary)

var _army: = "vanguard"
var _difficulty: = "standard"
var _seed_edit: LineEdit
var _army_cards: Dictionary = {}
var _difficulty_cards: Dictionary = {}


func _init() -> void :
	super ("New run", 1080.0, 0.5)


func _ready() -> void :
	super ()
	content.add_child(UiKit.caption("Army", Palette.MUTED, 13))
	var armies: = UiKit.hbox(12)
	content.add_child(armies)
	for preset in GameState.ARMIES:
		var info: Dictionary = GameState.ARMIES[preset]
		var available: = Profile.army_available(preset)
		var card: = OptionCard.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.locked = not available
		var column: = UiKit.vbox(6)
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pieces: = UiKit.hbox(0)
		pieces.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for kind in info.kinds:
			pieces.add_child(Glyph.make(str(kind), 30, Palette.INK))
		column.add_child(pieces)
		column.add_child(UiKit.title(str(info.name), 21))
		var note: = str(info.desc) if available else "Locked · " + Profile.unlock_hint("army_" + preset)
		column.add_child(UiKit.wrap(note, 17, Palette.MUTED if available else Palette.CAPTURE, 200))
		card.add_child(column)
		card.pressed.connect(_pick_army.bind(preset))
		armies.add_child(card)
		_army_cards[preset] = card

	content.add_child(UiKit.gap(2))
	content.add_child(UiKit.caption("Difficulty", Palette.MUTED, 13))
	var levels: = UiKit.hbox(12)
	content.add_child(levels)
	for key in GameState.DIFFICULTIES:
		var info: Dictionary = GameState.DIFFICULTIES[key]
		var available: = Profile.difficulty_available(key)
		var card: = OptionCard.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.locked = not available
		var column: = UiKit.vbox(2)
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.add_child(UiKit.title(str(info.name), 21))
		var note: = str(info.desc) if available else "Locked · " + Profile.unlock_hint("difficulty_" + key)
		column.add_child(UiKit.wrap(note, 17, Palette.MUTED if available else Palette.CAPTURE, 290))
		card.add_child(column)
		card.pressed.connect(_pick_difficulty.bind(key))
		levels.add_child(card)
		_difficulty_cards[key] = card

	content.add_child(UiKit.gap(2))
	var seed_row: = UiKit.hbox(12)
	seed_row.add_child(UiKit.caption("Seed", Palette.MUTED, 13))
	_seed_edit = LineEdit.new()
	_seed_edit.placeholder_text = "Random"
	_seed_edit.max_length = 24
	_seed_edit.custom_minimum_size.x = 260
	_seed_edit.tooltip_text = "The same seed and the same choices replay the same run."
	seed_row.add_child(_seed_edit)
	seed_row.add_child(UiKit.button("Roll", func() -> void : _seed_edit.text = GameState.random_seed_text()))
	seed_row.add_child(UiKit.spacer())
	seed_row.add_child(UiKit.button("Back", close))
	var start: = UiKit.button("Begin", _begin, true, 200)
	seed_row.add_child(start)
	content.add_child(UiKit.rule())
	content.add_child(seed_row)
	_pick_army(_army)
	_pick_difficulty(_difficulty)
	start.grab_focus.call_deferred()


func _pick_army(preset: String) -> void :
	if not Profile.army_available(preset):
		return
	_army = preset
	for key in _army_cards:
		_army_cards[key].selected = key == preset


func _pick_difficulty(key: String) -> void :
	if not Profile.difficulty_available(key):
		return
	_difficulty = key
	for level in _difficulty_cards:
		_difficulty_cards[level].selected = level == key


func _begin() -> void :
	begin.emit({"army": _army, "difficulty": _difficulty, "seed": _seed_edit.text})
	queue_free()
