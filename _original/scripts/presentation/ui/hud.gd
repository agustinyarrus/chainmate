class_name Hud
extends Control




signal end_turn_pressed
signal hint_pressed
signal help_pressed
signal pause_pressed
signal clock_key_pressed

var act_caption: Label
var gold_label: Label
var encounter_label: Label
var objective_label: Label
var rule_label: Label
var relic_row: HBoxContainer
var card: PanelContainer
var card_portrait: PiecePortrait
var card_name: Label
var card_level: Label
var card_move: Label
var card_upgrades: VBoxContainer
var card_xp: Label
var card_flavor: Label
var turn_label: Label
var turn_note: Label
var end_turn_button: Button
var clock_key_button: Button
var hint_button: Button
var status_label: Label
var banner: Control
var banner_title: Label
var banner_subtitle: Label

var _slots: Dictionary = {}
var _banner_tween: Tween


func _ready() -> void :
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UiTheme.theme()
	_build_top_left()
	_build_top_right()
	_build_relics()
	_build_card()
	_build_turn_bar()
	_build_banner()


func _corner(preset: Control.LayoutPreset, margin: Vector2, grow_h: Control.GrowDirection, grow_v: Control.GrowDirection) -> MarginContainer:
	var box: = MarginContainer.new()
	box.set_anchors_preset(preset)
	box.grow_horizontal = grow_h
	box.grow_vertical = grow_v
	for side in ["left", "right"]:
		box.add_theme_constant_override("margin_" + side, int(margin.x))
	for side in ["top", "bottom"]:
		box.add_theme_constant_override("margin_" + side, int(margin.y))
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(box)
	return box


func _build_top_left() -> void :
	var corner: = _corner(Control.PRESET_TOP_LEFT, Vector2(32, 26), Control.GROW_DIRECTION_END, Control.GROW_DIRECTION_END)
	var column: = UiKit.vbox(6)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	corner.add_child(column)
	act_caption = UiKit.caption("", Palette.MUTED, 13)
	column.add_child(act_caption)
	var purse: = UiKit.hbox(8)
	purse.mouse_filter = Control.MOUSE_FILTER_PASS
	purse.tooltip_text = "Gold. Earned by winning encounters; spent at merchants."
	var coin: = IconBox.make("coin", 26)
	purse.add_child(coin)
	gold_label = UiKit.number("10", 26, Palette.GOLD_BRIGHT)
	purse.add_child(gold_label)
	column.add_child(purse)


func _build_top_right() -> void :
	var corner: = _corner(Control.PRESET_TOP_RIGHT, Vector2(32, 24), Control.GROW_DIRECTION_BEGIN, Control.GROW_DIRECTION_END)
	var column: = UiKit.vbox(4)
	column.alignment = BoxContainer.ALIGNMENT_END
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	corner.add_child(column)
	encounter_label = UiKit.title("Encounter 1 / 9", 24, Palette.INK)
	encounter_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	column.add_child(encounter_label)
	var rule: = UiKit.ornament(220, Palette.MUTED)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_END
	column.add_child(rule)
	objective_label = UiKit.label("Eliminate all enemy pieces", 19, Palette.MUTED)
	objective_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	column.add_child(objective_label)
	rule_label = UiKit.wrap("", 17, Palette.CAPTURE, 340)
	rule_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	rule_label.visible = false
	column.add_child(rule_label)
	column.add_child(UiKit.gap(6))
	var buttons: = UiKit.hbox(8)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	hint_button = _small_button("Hint", "The planner suggests a move (H).", func() -> void : hint_pressed.emit())
	buttons.add_child(hint_button)
	buttons.add_child(_small_button("Rules", "How to play (F1).", func() -> void : help_pressed.emit()))
	buttons.add_child(_small_button("Menu", "Pause (Esc).", func() -> void : pause_pressed.emit()))
	column.add_child(buttons)


func _small_button(text: String, tip: String, action: Callable) -> Button:
	var node: = UiKit.button(text, action)
	node.tooltip_text = tip
	node.focus_mode = Control.FOCUS_NONE
	node.add_theme_font_size_override("font_size", 13)
	return node


func _build_relics() -> void :
	var corner: = _corner(Control.PRESET_BOTTOM_LEFT, Vector2(32, 28), Control.GROW_DIRECTION_END, Control.GROW_DIRECTION_BEGIN)
	var column: = UiKit.vbox(8)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	corner.add_child(column)
	column.add_child(UiKit.caption("Relics", Palette.MUTED, 13))
	relic_row = UiKit.hbox(8)
	relic_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(relic_row)


func _build_card() -> void :
	var corner: = _corner(Control.PRESET_BOTTOM_RIGHT, Vector2(32, 28), Control.GROW_DIRECTION_BEGIN, Control.GROW_DIRECTION_BEGIN)
	card = UiKit.panel(Palette.PANEL, Palette.PANEL_EDGE_STRONG, Vector4(18, 14, 20, 16), 4)
	card.custom_minimum_size = Vector2(330, 0)
	card.visible = false
	corner.add_child(card)
	var row: = UiKit.hbox(14)
	card.add_child(row)
	card_portrait = PiecePortrait.new()
	card_portrait.custom_minimum_size = Vector2(76, 96)
	row.add_child(card_portrait)
	var column: = UiKit.vbox(4)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(column)
	var header: = UiKit.hbox(8)
	card_name = UiKit.title("Knight", 24, Palette.INK)
	header.add_child(card_name)
	header.add_child(UiKit.spacer())
	card_level = UiKit.caption("", Palette.GOLD, 12)
	card_level.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(card_level)
	column.add_child(header)
	card_move = UiKit.wrap("", 17, Palette.MUTED, 210)
	column.add_child(card_move)
	card_upgrades = UiKit.vbox(2)
	column.add_child(card_upgrades)
	card_xp = UiKit.caption("", Palette.FAINT, 11)
	column.add_child(card_xp)
	card_flavor = UiKit.flavor("", 17)
	column.add_child(card_flavor)


func _build_turn_bar() -> void :
	var holder: = VBoxContainer.new()
	holder.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	holder.grow_horizontal = Control.GROW_DIRECTION_BOTH
	holder.grow_vertical = Control.GROW_DIRECTION_BEGIN
	holder.offset_bottom = -26
	holder.alignment = BoxContainer.ALIGNMENT_END
	holder.add_theme_constant_override("separation", 6)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(holder)
	status_label = UiKit.label("", 18, Palette.MUTED)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	holder.add_child(status_label)
	var bar: = UiKit.hbox(14)
	bar.alignment = BoxContainer.ALIGNMENT_CENTER
	holder.add_child(bar)
	var labels: = UiKit.vbox(0)
	turn_label = UiKit.title("Your turn", 20, Palette.INK)
	turn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	labels.add_child(turn_label)
	turn_note = UiKit.caption("Turn 1", Palette.FAINT, 11)
	turn_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	labels.add_child(turn_note)
	bar.add_child(labels)
	end_turn_button = UiKit.button("End turn", func() -> void : end_turn_pressed.emit(), false, 150)
	end_turn_button.tooltip_text = "Finish your turn (Enter)."
	end_turn_button.focus_mode = Control.FOCUS_NONE
	bar.add_child(end_turn_button)
	clock_key_button = UiKit.button("Clockmaker's Key", func() -> void : clock_key_pressed.emit())
	clock_key_button.tooltip_text = "Take an extra turn before the enemy moves (once per encounter)."
	clock_key_button.focus_mode = Control.FOCUS_NONE
	clock_key_button.visible = false
	bar.add_child(clock_key_button)


func _build_banner() -> void :
	banner = Control.new()
	banner.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	banner.visible = false
	add_child(banner)
	var column: = UiKit.vbox(8)
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	column.grow_horizontal = Control.GROW_DIRECTION_BOTH
	column.grow_vertical = Control.GROW_DIRECTION_BOTH
	column.offset_top = -200
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	banner.add_child(column)
	banner_title = UiKit.title("", 60, Palette.INK)
	banner_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_title.add_theme_constant_override("outline_size", 12)
	banner_title.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.55))
	column.add_child(banner_title)
	var rule: = UiKit.ornament(260, Palette.GOLD)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(rule)
	banner_subtitle = UiKit.label("", 24, Palette.INK)
	banner_subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_subtitle.add_theme_constant_override("outline_size", 8)
	banner_subtitle.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6))
	column.add_child(banner_subtitle)




func refresh(gs: GameState) -> void :
	var act: Dictionary = gs.act_info()
	act_caption.text = "ACT %s  ·  %s" % [["I", "II", "III"][gs.act], str(act.name).to_upper()]
	gold_label.text = str(gs.gold)
	encounter_label.text = "Encounter %d / %d" % [gs.encounter_number(), gs.total_encounters()]
	var battle: = gs.battle
	if battle == null:
		return
	objective_label.text = "Capture the enemy King" if battle.objective == "regicide" else "Eliminate all enemy pieces"
	rule_label.visible = battle.boss_rule != ""
	if battle.boss_rule != "":
		var boss: Dictionary = Encounters.BOSSES[gs.act]
		rule_label.text = "%s  ·  %s" % [boss.name, boss.desc]
	hint_button.disabled = gs.hints_left == 0
	hint_button.text = "Hint" if gs.hints_left < 0 else "Hint (%d)" % gs.hints_left
	clock_key_button.visible = battle.clock_key_ready
	_refresh_relics(gs.relics)


func _refresh_relics(relics: Array[String]) -> void :
	for child in relic_row.get_children():
		child.queue_free()
	_slots.clear()
	for i in Relics.MAX_EQUIPPED:
		var id: = relics[i] if i < relics.size() else ""
		var slot: = RelicToken.make(id, 56)
		relic_row.add_child(slot)
		if id != "":
			_slots[id] = slot


func pulse_relic(id: String) -> void :
	if _slots.has(id) and is_instance_valid(_slots[id]):
		_slots[id].pulse()


func set_status(text: String) -> void :
	status_label.text = text



func set_turn(state: String, turn: int, follow_up: = false, can_move: = true) -> void :
	var left: = Battle.TURN_LIMIT - turn
	turn_note.text = "TURN %d" % turn if left >= Battle.LIMIT_WARNING else "TURN %d / %d" % [turn, Battle.TURN_LIMIT]
	turn_note.add_theme_color_override("font_color", Palette.FAINT if left >= Battle.LIMIT_WARNING else Palette.CHAIN)
	match state:
		"player":
			turn_label.text = "Your turn"
			turn_label.add_theme_color_override("font_color", Palette.INK)
			end_turn_button.disabled = false
			end_turn_button.text = "End turn" if follow_up else ("Pass" if not can_move else "End turn")
			end_turn_button.visible = follow_up or not can_move
			if follow_up:
				UiKit.style_primary(end_turn_button)
		"enemy":
			turn_label.text = "Enemy turn"
			turn_label.add_theme_color_override("font_color", Palette.CAPTURE)
			end_turn_button.visible = false
		_:
			turn_label.text = ""
			end_turn_button.visible = false



func show_piece(piece: Dictionary, entry: Dictionary, next_xp: int) -> void :
	if piece.is_empty():
		card.visible = false
		return
	card.visible = true
	var kind: String = piece.kind
	var info: Dictionary = ChessRules.PIECE_INFO[kind]
	card_portrait.kind = kind
	card_portrait.friendly = piece.friendly
	card_portrait.level = int(piece.level)
	card_portrait.queue_redraw()
	card_name.text = str(info.name) if piece.friendly else "Enemy " + str(info.name).to_lower()
	card_level.text = "Level %d" % int(piece.level) if int(piece.level) > 0 else ""
	var move: = str(info.move)
	if not piece.friendly:
		move += " Never retreats."
	card_move.text = move
	for child in card_upgrades.get_children():
		child.queue_free()
	for id in piece.upgrades:
		if Upgrades.info(str(id)).has("hidden") and piece.friendly:
			continue
		var line: = UiKit.hbox(6)
		line.add_child(IconBox.make(str(id), 20))
		line.add_child(UiKit.label(Upgrades.display_name(str(id)), 17, Palette.INK))
		card_upgrades.add_child(line)
	if int(piece.ward) > 0:
		card_upgrades.add_child(UiKit.label("Warded", 17, Palette.MOVE))
	card_xp.visible = not entry.is_empty()
	if not entry.is_empty():
		card_xp.text = "XP %d / %d" % [int(entry.xp), next_xp] if next_xp > 0 else "XP %d · max level" % int(entry.xp)
	card_flavor.text = str(info.flavor)


func show_banner(title: String, subtitle: String, color: = Palette.INK, hold: = 1.6) -> void :
	if _banner_tween:
		_banner_tween.kill()
	banner_title.text = title
	banner_title.add_theme_color_override("font_color", color)
	banner_subtitle.text = subtitle
	banner.visible = true
	banner.modulate.a = 0.0
	_banner_tween = create_tween()
	_banner_tween.tween_property(banner, "modulate:a", 1.0, 0.25)
	if hold > 0.0:
		_banner_tween.tween_interval(hold)
		_banner_tween.tween_property(banner, "modulate:a", 0.0, 0.45)
		_banner_tween.tween_callback( func() -> void : banner.visible = false)


func hide_banner() -> void :
	if _banner_tween:
		_banner_tween.kill()
	banner.visible = false



class IconBox:
	extends Control
	var icon: = ""

	static func make(icon_name: String, size: float) -> IconBox:
		var box: = IconBox.new()
		box.icon = icon_name
		box.custom_minimum_size = Vector2(size, size)
		box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return box

	func _draw() -> void :
		Icons.draw(self, icon, size * 0.5, minf(size.x, size.y) * 0.46)



class PiecePortrait:
	extends Control
	var kind: = "pawn"
	var friendly: = true
	var level: = 0

	func _draw() -> void :
		var rect: = Rect2(Vector2.ZERO, size)
		draw_rect(rect, Color(0.07, 0.1, 0.16, 0.9))
		draw_rect(rect, Palette.PANEL_EDGE_STRONG, false, 1.0)
		var tint: = Palette.INK if friendly else Color("2a2830")
		var outline: = Palette.GOLD if friendly else Palette.CAPTURE
		var centre: = Vector2(size.x * 0.5, size.y * 0.46)
		var radius: = minf(size.x, size.y) * 0.36
		Emblems.draw_piece(self, kind, centre + Vector2(1.5, 1.5), radius, Color(0, 0, 0, 0.5))
		Emblems.draw_piece(self, kind, centre, radius, tint)
		if not friendly:
			Emblems.draw_piece(self, kind, centre, radius * 0.96, Color(outline, 0.18))
		for i in GameState.MAX_LEVEL:
			var at: = Vector2(size.x * 0.5 + (i - 1) * 14.0, size.y - 11.0)
			var pip: = PackedVector2Array([at + Vector2(0, -5), at + Vector2(5, 0), at + Vector2(0, 5), at + Vector2(-5, 0)])
			if i < level:
				draw_colored_polygon(pip, Palette.GOLD)
			else:
				pip.append(pip[0])
				draw_polyline(pip, Color(Palette.GOLD, 0.4), 1.0, true)
