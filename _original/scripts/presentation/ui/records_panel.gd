class_name RecordsPanel
extends Modal



func _init() -> void :
	super ("Records", 720.0, 0.6)


func _ready() -> void :
	super ()
	var data: = Profile.data
	var grid: = GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 36)
	grid.add_theme_constant_override("v_separation", 10)
	var cells: = [
		["Runs", str(int(data.runs))], 
		["Victories", str(int(data.wins))], 
		["Bosses", str(int(data.bosses))], 
		["Best chain", str(int(data.best_chain))], 
	]
	for key in GameState.DIFFICULTIES:
		cells.append(["Furthest · " + str(GameState.DIFFICULTIES[key].name), "%d / 9" % Profile.best_for(key)])
	cells.append(["Captures", UiKit.format_int(int(data.total_captures))])
	for entry in cells:
		var cell: = UiKit.vbox(0)
		cell.add_child(UiKit.caption(entry[0], Palette.MUTED, 11))
		cell.add_child(UiKit.number(entry[1], 26))
		grid.add_child(cell)
	content.add_child(grid)
	content.add_child(UiKit.rule())
	content.add_child(UiKit.caption("Unlocks", Palette.MUTED, 12))
	for id in Profile.UNLOCKS:
		var row: = UiKit.hbox(10)
		var open: = Profile.is_unlocked(id)
		row.add_child(Glyph.make("tempo", 14, Palette.MOVE if open else Palette.FAINT, open))
		row.add_child(UiKit.label(str(Profile.UNLOCKS[id].name), 19, Palette.INK if open else Palette.MUTED))
		row.add_child(UiKit.spacer())
		row.add_child(UiKit.caption("Unlocked" if open else str(Profile.UNLOCKS[id].hint), Palette.MOVE if open else Palette.FAINT, 11))
		content.add_child(row)
	var history: Array = data.history
	if not history.is_empty():
		content.add_child(UiKit.rule())
		content.add_child(UiKit.caption("Recent runs", Palette.MUTED, 12))
		for run in history.slice(0, 6):
			var row: = UiKit.hbox(12)
			row.add_child(UiKit.label("Victory" if run.won else "Defeat", 18, Palette.GOLD_BRIGHT if run.won else Palette.INK))
			row.add_child(UiKit.label("%d / 9 · %d pieces left" % [int(run.encounters), int(run.survivors)], 18, Palette.INK))
			row.add_child(UiKit.label("%s · %s" % [GameState.DIFFICULTIES[str(run.difficulty)].name, GameState.ARMIES[str(run.army)].name], 17, Palette.MUTED))
			row.add_child(UiKit.spacer())
			row.add_child(UiKit.caption(str(run.seed), Palette.FAINT, 10))
			content.add_child(row)
	var done: = UiKit.button("Close", close, true, 140)
	var buttons: Array[Button] = [done]
	add_footer(buttons)
	done.grab_focus.call_deferred()
