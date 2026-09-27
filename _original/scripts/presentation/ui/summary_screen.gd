class_name SummaryScreen
extends Modal


signal new_run
signal main_menu

const REASONS: = {
	"checkmate": "Checkmated", 
	"exhausted": "Worn down: the enemy held the stronger army at the turn limit", 
	"king": "Your king has fallen", 
}


func _init() -> void :
	super ("", 640.0, 0.55)
	dismissable = false


func setup(gs: GameState, won: bool, reason: String, unlocked: Array[String]) -> void :
	var crown: = Hud.IconBox.make("crown", 54)
	crown.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(crown)
	var heading: = UiKit.title("Victory" if won else "Defeat", 58, Palette.GOLD_BRIGHT if won else Palette.CAPTURE)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(heading)
	var rule: = UiKit.ornament(240)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	content.add_child(rule)
	var line: = "All three acts conquered on %s." % GameState.DIFFICULTIES[gs.difficulty].name
	if not won:
		line = "%s in %s, encounter %d." % [REASONS[reason], str(gs.act_info().name), gs.encounters_won + 1]
	var subtitle: = UiKit.wrap(line, 20, Palette.INK, 560)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(subtitle)
	content.add_child(UiKit.gap(6))
	var stats: = [
		["Encounters", "%d / %d" % [gs.encounters_won, gs.total_encounters()]], 
		["Relics", str(gs.relics.size())], 
		["Pieces remaining", str(gs.army.size())], 
		["Captures", str(int(gs.stats.captures))], 
		["Best chain", str(int(gs.stats.best_chain))], 
		["Promotions", str(int(gs.stats.promotions))], 
	]
	for entry in stats:
		var row: = UiKit.hbox(10)
		row.add_child(UiKit.label(str(entry[0]), 20, Palette.MUTED))
		row.add_child(UiKit.spacer())
		row.add_child(UiKit.number(str(entry[1]), 22, Palette.INK))
		content.add_child(row)
		content.add_child(UiKit.rule(Color(1, 1, 1, 0.05)))
	if not gs.relics.is_empty():
		var relics: = UiKit.hbox(8)
		relics.alignment = BoxContainer.ALIGNMENT_CENTER
		for id in gs.relics:
			relics.add_child(RelicToken.make(id, 44))
		content.add_child(relics)
	for id in unlocked:
		var unlock: = UiKit.label("Unlocked: " + str(Profile.UNLOCKS[id].name), 20, Palette.CHAIN, UiTheme.display_font())
		unlock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		content.add_child(unlock)
	var seed_line: = UiKit.caption("Seed  " + gs.seed_text, Palette.FAINT, 11)
	seed_line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(seed_line)
	var again: = UiKit.button("New run", _choose.bind(new_run), true, 170)
	var buttons: Array[Button] = [UiKit.button("Main menu", _choose.bind(main_menu), false, 170), again]
	add_footer(buttons)
	again.grab_focus.call_deferred()


func _choose(choice: Signal) -> void :
	choice.emit()
	queue_free()
