extends Node3D







enum Screen{MENU, MAP, STOP, BATTLE, SUMMARY}

const NO_CELL: = Vector2i(-1, -1)
const FILES: = "abcdef"
const CURSOR_STEPS: = {
	"cursor_up": Vector2i(0, -1), "cursor_down": Vector2i(0, 1), 
	"cursor_left": Vector2i(-1, 0), "cursor_right": Vector2i(1, 0), 
}
const Autopilot: = preload("res://scripts/presentation/autopilot.gd")

var gs: GameState
var screen: = Screen.MENU
var busy: = false

var arena: Arena
var board_view: BoardView
var pieces_root: Node3D
var relics_root: Node3D
var vfx: Vfx
var rig: CameraRig
var hud: Hud
var overlay: Control
var piece_views: Dictionary = {}
var relic_views: Dictionary = {}

var selected_id: = ""
var hover_cell: = NO_CELL
var hover_id: = ""
var cursor_cell: = Vector2i(2, 4)
var keyboard_mode: = false
var hint_move: Dictionary = {}

var _screen_node: Control
var _right_press: = Vector2.ZERO
var _tutorial: = false
var _clock_key_armed: = false


func _ready() -> void :
	if DisplayServer.get_name() != "headless":
		DisplayServer.window_set_min_size(Vector2i(1024, 600))
		DisplayServer.window_set_title("Chainmate")
	_build_scene()
	if OS.has_feature("web"):
		_warm_up_shaders()
	get_tree().set_auto_accept_quit(false)
	Sfx.play_music()
	if OS.get_cmdline_user_args().has("--capture"):
		var pilot: Node = Autopilot.new()
		pilot.main = self
		add_child(pilot)
	else:
		show_menu()






func _warm_up_shaders() -> void :
	var hold: = Node3D.new()
	hold.name = "ShaderWarmUp"
	hold.position = Vector3(0, -0.7, 0)
	add_child(hold)
	var rng: = RandomNumberGenerator.new()
	var props: Array[Node3D] = [ArenaProps.crate(0.3), ArenaProps.books(rng), ArenaProps.banner(0.5, Palette.CAPTURE, Palette.GOLD), 
		ArenaProps.hanging_cloth(0.3, 0.3, Palette.CAPTURE, Palette.GOLD, true)]
	for lit: Dictionary in [ArenaProps.lantern(), ArenaProps.candelabra(), ArenaProps.candles(rng)]:
		props.append(lit.node)
		for light: OmniLight3D in lit.lights:
			light.visible = false
	for prop in props:
		hold.add_child(prop)
	var relic: = RelicView.new()
	hold.add_child(relic)
	relic.setup("fianchetto_glass")
	var effects: = vfx.warm_up(hold.position)
	for i in 4:
		await get_tree().process_frame
	hold.queue_free()
	effects.queue_free()
	JavaScriptBridge.eval("var note = document.getElementById('chainmate-loading'); if (note) { note.remove(); }")


func _notification(what: int) -> void :
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		_quit()


func _build_scene() -> void :
	arena = Arena.new()
	add_child(arena)
	board_view = BoardView.new()
	add_child(board_view)
	pieces_root = Node3D.new()
	pieces_root.name = "Pieces"
	add_child(pieces_root)
	relics_root = Node3D.new()
	relics_root.name = "Relics"
	add_child(relics_root)
	vfx = Vfx.new()
	add_child(vfx)
	rig = CameraRig.new()
	rig.frame_board()
	add_child(rig)

	var layer: = CanvasLayer.new()
	add_child(layer)
	hud = Hud.new()
	hud.visible = false
	layer.add_child(hud)
	hud.end_turn_pressed.connect(_end_turn)
	hud.hint_pressed.connect(_hint)
	hud.help_pressed.connect(_open_help)
	hud.pause_pressed.connect(_open_pause)
	hud.clock_key_pressed.connect(_use_clock_key)
	overlay = Control.new()
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.theme = UiTheme.theme()
	layer.add_child(overlay)




func show_menu() -> void :
	screen = Screen.MENU
	busy = false
	gs = null
	selected_id = ""
	hint_move = {}
	_clear_overlays()
	hud.visible = false
	hud.hide_banner()
	board_view.clear_marks()
	board_view.clear_cursor()
	board_view.hide_arc()
	_clear_relics()
	_set_variant("court")
	arena.set_mood(0.9, 0.25, 0.6)
	rig.idle_orbit = true
	rig.input_enabled = false
	rig.release_focus()
	rig.reset_view()

	rig.set_safe_area(-0.04, 0.86, -0.72, 0.72)

	var demo: = GameState.new()
	demo.new_run({"seed": "CHAINMATE", "army": "vanguard"})
	demo.skip_relic()
	demo.leave()
	demo.choose_node(0)
	_clear_pieces()
	board_view.show_terrain(demo.battle.board)
	_sync_pieces(demo.battle.board)
	var menu: = MenuScreen.new()
	menu.setup(Profile.has_run(), _record_summary())
	menu.continue_run.connect(continue_run)
	menu.new_run.connect(_open_new_run)
	menu.show_help.connect(_open_help)
	menu.show_records.connect( func() -> void : overlay.add_child(RecordsPanel.new()))
	menu.show_settings.connect(_open_settings)
	menu.show_credits.connect( func() -> void : overlay.add_child(CreditsPanel.new()))
	menu.quit_game.connect(_quit)
	_set_screen_node(menu)


func _record_summary() -> String:
	var data: = Profile.data
	if int(data.runs) == 0:
		return ""
	return "%d runs  ·  %d wins  ·  furthest %d / 9 encounters" % [int(data.runs), int(data.wins), int(data.best_encounters)]


func _open_new_run() -> void :
	var setup: = NewRunScreen.new()
	setup.begin.connect(start_run)
	overlay.add_child(setup)


func start_run(config: Dictionary) -> void :
	gs = GameState.new()
	gs.new_run(config)
	_tutorial = not bool(Profile.data.tutorial_done)
	_clear_overlays()
	_clear_pieces()
	_clear_relics()
	_route()


func continue_run() -> void :
	var saved: = Profile.load_run()
	if saved == null:
		Toast.show_on(overlay, "The saved run could not be restored.", Palette.CAPTURE)
		Profile.clear_run()
		show_menu()
		return
	gs = saved
	_tutorial = false
	_clear_overlays()
	_clear_pieces()
	_clear_relics()
	_route()


func _restart_run() -> void :
	start_run({"difficulty": gs.difficulty, "army": gs.army_preset})


func _quit() -> void :
	if gs != null:
		Profile.save_run(gs)
	get_tree().quit()



func _route() -> void :
	busy = false
	Profile.save_run(gs)
	_set_variant(str(gs.act_info().variant))
	if gs.phase == "battle":
		enter_battle(true)
		return
	var evolved: = _enter_camp()
	if evolved:
		await _wait(1.1)
	match gs.phase:
		"reward":
			_open_reward()
		"map":
			_open_map()
		"merchant":
			var shop: = MerchantScreen.new()
			shop.setup(gs)
			_open_stop(shop, shop.changed, shop.leave, shop.refresh)
			if gs.discounted():
				_relic_triggered("patrons_chit")
		"rest":
			var rest: = RestScreen.new()
			rest.setup(gs)
			_open_stop(rest, rest.changed, rest.leave, rest.refresh)
		"event":
			var event: = EventScreen.new()
			event.setup(gs)
			_open_stop(event, event.changed, event.leave, event.refresh)


func _set_variant(variant: String) -> void :
	if arena.variant != variant:
		arena.set_variant(variant)

		if gs != null:
			for i in gs.relics.size():
				if relic_views.has(gs.relics[i]):
					relic_views[gs.relics[i]].place(arena.relic_spot(i))





func _enter_camp() -> bool:
	screen = Screen.MAP if gs.phase == "map" else Screen.STOP
	selected_id = ""
	hint_move = {}
	hud.visible = false
	hud.hide_banner()
	board_view.clear_marks()
	board_view.clear_cursor()
	board_view.hide_arc()
	arena.set_mood(1.0, 0.15, 0.8)
	rig.idle_orbit = true
	rig.input_enabled = false
	rig.release_focus()
	rig.frame_board()
	var board: = Encounters.camp(gs.army)
	board_view.show_terrain(board)
	_sync_relics(false)
	return _sync_pieces(board)


func _refresh_camp() -> void :
	_sync_pieces(Encounters.camp(gs.army))


func _open_map() -> void :
	screen = Screen.MAP
	var map: = MapScreen.new()
	map.setup(gs)
	map.node_chosen.connect(_choose_node)
	_set_screen_node(map)


func _choose_node(index: int) -> void :
	if busy or not gs.choose_node(index):
		return
	Sfx.play(&"map_step")
	_set_screen_node(null)
	_route()


func _open_reward() -> void :
	screen = Screen.STOP
	var reward: = RewardScreen.new()
	reward.setup(gs)
	reward.done.connect( func() -> void :
		Profile.save_run(gs)
		_refresh_camp()

		if _sync_relics(true):
			await _wait(1.3)
		_resolve_levels(_leave_stop))
	overlay.add_child(reward)
	if str(gs.reward.revived) != "":
		_relic_triggered("sealed_move")



func _open_stop(stop: Modal, changed: Signal, leave: Signal, refresh: Callable) -> void :
	screen = Screen.STOP
	changed.connect( func() -> void :
		Profile.save_run(gs)
		_refresh_camp()
		_sync_relics(true)
		_resolve_levels(refresh))
	leave.connect(_leave_stop)
	overlay.add_child(stop)
	if not gs.pending_levels.is_empty():
		_resolve_levels(refresh)



func _resolve_levels(then: Callable) -> void :
	if gs.pending_levels.is_empty():
		then.call()
		return
	var panel: = LevelUpScreen.new()
	panel.setup(gs)
	if gs.relics.has("annotators_quill"):
		_relic_triggered("annotators_quill")
	panel.done.connect( func() -> void :
		Profile.save_run(gs)
		then.call())
	overlay.add_child(panel)


func _leave_stop() -> void :
	var left: = gs.leave()
	assert (left, "leave() refused in phase %s" % gs.phase)
	_route()


func _show_summary(won: bool, reason: String, unlocked: Array[String]) -> void :
	screen = Screen.SUMMARY
	busy = false
	var summary: = SummaryScreen.new()
	summary.setup(gs, won, reason, unlocked)
	summary.new_run.connect( func() -> void :
		show_menu()
		_open_new_run())
	summary.main_menu.connect(show_menu)
	overlay.add_child(summary)




func _clear_pieces() -> void :
	for view in piece_views.values():
		view.queue_free()
	piece_views.clear()





func _sync_pieces(board: Board) -> bool:
	var present: = {}
	var arrivals: = 0
	var evolved: = false
	var ordered: Array[Dictionary] = board.friendlies()
	ordered.append_array(board.enemies())
	for piece in ordered:
		var id: = str(piece.id)
		present[id] = true
		if piece_views.has(id) and piece_views[id].friendly != bool(piece.friendly):
			piece_views[id].queue_free()
			piece_views.erase(id)
		if not piece_views.has(id):
			var fresh: = _spawn_piece(piece)
			fresh.drop_in(0.05 + arrivals * 0.045)
			arrivals += 1
			continue
		var view: PieceView = piece_views[id]
		if view.kind != str(piece.kind):
			view.set_kind(str(piece.kind))
		if int(piece.level) > view.level:
			view.evolve(vfx, int(piece.level))
			evolved = true
		elif int(piece.level) != view.level:
			view.set_level(int(piece.level))
		var target: = BoardView.cell_to_world(piece.cell)
		if view.position.distance_to(target) > 0.01:
			view.travel(target, "hop", Settings.duration(0.45))
	for id in piece_views.keys():
		if not present.has(id):
			piece_views[id].sink(0.0)
			piece_views.erase(id)
	if evolved:
		Sfx.play(&"level_up")
	return evolved


func _spawn_piece(piece: Dictionary) -> PieceView:
	var view: = PieceView.new()
	view.name = "Piece_" + str(piece.id)
	pieces_root.add_child(view)
	view.setup(piece)
	view.position = BoardView.cell_to_world(piece.cell)
	piece_views[str(piece.id)] = view
	return view




func _clear_relics() -> void :
	for view in relic_views.values():
		view.queue_free()
	relic_views.clear()





func _sync_relics(animate: bool) -> bool:
	for id in relic_views.keys():
		if not gs.relics.has(id):
			relic_views[id].sink()
			relic_views.erase(id)
	var arrivals: = 0
	for i in gs.relics.size():
		var id: = gs.relics[i]
		var spot: = arena.relic_spot(i)
		if relic_views.has(id):
			var view: RelicView = relic_views[id]
			if view.spot.distance_to(spot) > 0.01:
				view.slide_to(spot)
			continue
		var fresh: = RelicView.new()
		relics_root.add_child(fresh)
		fresh.setup(id)
		fresh.place(spot)
		fresh.rotation.y = CameraRig.DEFAULT_YAW
		relic_views[id] = fresh
		if animate:
			fresh.drop_in(vfx, arrivals * 0.25)
			arrivals += 1
	if arrivals > 0:
		Sfx.play(&"land", 0.7)
	return arrivals > 0



func _relic_triggered(id: String, sound: = true) -> void :
	hud.pulse_relic(id)
	if relic_views.has(id):
		relic_views[id].trigger(vfx, Palette.RARITY_COLORS[str(Relics.info(id).rarity)])
	if sound:
		Sfx.play(&"relic_trigger")



func _opening_relics() -> void :
	var battle: = gs.battle
	if battle.turn != 1 or battle.side != "player" or not gs.relics.has("castling_deed"):
		return
	var warded: = false
	for piece in battle.board.friendlies():
		if piece.kind == "rook" and int(piece.ward) > 0:
			warded = true
	if warded:
		await _wait(0.9)
		_relic_triggered("castling_deed")




func enter_battle(intro: bool) -> void :
	screen = Screen.BATTLE
	busy = false
	selected_id = ""
	hint_move = {}
	hover_cell = NO_CELL
	hover_id = ""
	_clock_key_armed = false
	_clear_overlays()
	var battle: = gs.battle
	hud.visible = true
	hud.refresh(gs)
	hud.show_piece({}, {}, 0)
	hud.set_status("")
	rig.idle_orbit = false
	rig.input_enabled = true
	rig.release_focus()
	rig.reset_view()
	rig.frame_board()
	arena.set_mood(1.0, 0.0, 0.8)
	board_view.show_terrain(battle.board)
	_sync_pieces(battle.board)
	_sync_relics(false)
	cursor_cell = battle.board.king(true).cell
	if intro:
		_announce_encounter()
		_opening_relics()
	_refresh_board()
	if battle.outcome != "":
		_battle_over()
	elif battle.side == "enemy":
		busy = true
		await _wait(0.9)
		await _enemy_turn()
	elif battle.in_follow_up():
		selected_id = battle.active_id
		_refresh_board()


func _announce_encounter() -> void :
	var number: = "Encounter %d / %d" % [gs.encounter_number(), gs.total_encounters()]
	match gs.node_type:
		"boss":
			var boss: Dictionary = Encounters.BOSSES[gs.act]
			hud.show_banner(str(boss.name), "%s\nCapture the enemy king." % str(boss.desc), Palette.CAPTURE, 2.4)
		"elite":
			hud.show_banner("Elite", "%s  ·  A relic awaits the victor." % number, Palette.CHAIN, 1.8)
		_:
			hud.show_banner(str(gs.act_info().name), number, Palette.INK, 1.6)
	Sfx.play(&"encounter_start")



func act_at(cell: Vector2i) -> void :
	if busy or screen != Screen.BATTLE or not gs.battle.is_player_turn() or not Board.in_bounds(cell):
		return
	var battle: = gs.battle
	var piece: = battle.board.piece_at(cell)
	if selected_id != "" and battle.moves_for(selected_id).has(cell):
		_commit(selected_id, cell)
		return
	if battle.in_follow_up():
		if piece.is_empty() or piece.id != battle.active_id:
			_reject("Only your %s can act now. End the turn to stop." % UiKit.piece_name(battle.board.piece_by_id(battle.active_id).kind))
		return
	if not piece.is_empty() and piece.friendly:
		if piece.id == selected_id:
			_deselect()
		elif battle.moves_for(piece.id).is_empty():
			if battle.player_in_check():
				_reject("Your king is in check. That %s can't help." % UiKit.piece_name(piece.kind).to_lower())
			else:
				_reject("Your %s has no moves." % UiKit.piece_name(piece.kind).to_lower())
		else:
			_select(piece.id)
		return
	if selected_id != "":
		_deselect()


func _select(id: String) -> void :
	selected_id = id
	cursor_cell = gs.battle.board.piece_by_id(id).cell
	Sfx.play(&"select")
	_show_card()
	_refresh_board()


func _deselect() -> void :
	if selected_id == "" or gs.battle.in_follow_up():
		return
	selected_id = ""
	Sfx.play(&"deselect")
	_show_card()
	_refresh_board()


func _reject(message: String) -> void :
	Sfx.play(&"error")
	Toast.show_on(overlay, message, Palette.MUTED, 1.4)


func _commit(id: String, to: Vector2i) -> void :
	var battle: = gs.battle
	var mover: = battle.board.piece_by_id(id)

	var ribbon_ready: = gs.relics.has("desperado_ribbon") and not battle.relic_follow_used
	var chart_ready: bool = gs.relics.has("knights_tour_chart") and mover.kind == "knight" and not battle.momentum_used
	var pierces: bool = gs.relics.has("fianchetto_glass") and mover.kind == "bishop" and _passes_through(battle.board, mover.cell, to)
	var record: = battle.move(id, to)
	assert ( not record.is_empty(), "move %s -> %s was offered but refused" % [id, to])
	hint_move = {}
	busy = true
	Profile.save_run(gs)
	_refresh_board()
	if pierces:
		_relic_triggered("fianchetto_glass")
	await _animate_move(record)
	if ribbon_ready and battle.relic_follow_used:
		_relic_triggered("desperado_ribbon")
	if chart_ready and battle.momentum_used:
		_relic_triggered("knights_tour_chart")
	hud.refresh(gs)
	await _continue_turn(record.turn_end)



static func _passes_through(board: Board, from: Vector2i, to: Vector2i) -> bool:
	var delta: = to - from
	var steps: = maxi(absi(delta.x), absi(delta.y))
	if steps < 2 or (delta.x != 0 and delta.y != 0 and absi(delta.x) != absi(delta.y)):
		return false
	var step: = Vector2i(signi(delta.x), signi(delta.y))
	for i in range(1, steps):
		if not board.piece_at(from + step * i).is_empty():
			return true
	return false



func _end_turn() -> void :
	if busy or screen != Screen.BATTLE or not gs.battle.is_player_turn():
		return
	var turn_end: = gs.battle.end_turn()
	busy = true
	selected_id = ""
	hint_move = {}
	Profile.save_run(gs)
	await _continue_turn(turn_end)



func _continue_turn(turn_end: Dictionary) -> void :
	var battle: = gs.battle
	if not turn_end.is_empty():
		selected_id = ""
		await _animate_destroyed(turn_end.destroyed)
		if turn_end.extra_turn:
			var relic: = "clockmakers_key" if _clock_key_armed else "opening_book"
			_clock_key_armed = false
			_relic_triggered(relic)
			hud.show_banner("Extra turn", Relics.display_name(relic), Palette.CHAIN, 1.0)
	if battle.outcome != "":
		_battle_over()
		return
	if battle.side == "enemy":
		await _enemy_turn()
		return
	busy = false
	if battle.in_follow_up():
		selected_id = battle.active_id
		Sfx.play_step(&"chain_step", battle.turn_captures)
		var view: PieceView = piece_views[selected_id]
		vfx.ring(view.global_position + Vector3.UP * 0.05, Palette.CHAIN, 0.9, 0.5)
	_show_card()
	_refresh_board()


func _enemy_turn() -> void :
	var battle: = gs.battle
	busy = true
	selected_id = ""
	_refresh_board()
	hud.set_status("")
	await _wait(0.35)
	if battle.enemy_moves_twice():
		hud.show_banner("%s moves twice" % str(Encounters.BOSSES[gs.act].name), "", Palette.CAPTURE, 0.9)
		await _wait(0.8)
	var records: = gs.run_enemy_turn()
	Profile.save_run(gs)
	for record in records:
		if record.has("terrain"):
			await _animate_destroyed(record.terrain)
		else:
			await _animate_move(record)
			await _wait(0.1)
	hud.refresh(gs)
	if battle.outcome != "":
		_battle_over()
		return
	busy = false
	if battle.player_in_check():
		Sfx.play(&"check", 1.0, -4.0)
		var king: PieceView = piece_views[str(battle.board.king(true).id)]
		vfx.ring(king.global_position + Vector3.UP * 0.05, Palette.THREAT, 1.1, 0.6)
		hud.show_banner("Check", "Protect your king.", Palette.CAPTURE, 0.9)
	_show_card()
	_refresh_board()



func _animate_move(record: Dictionary) -> void :
	var view: PieceView = piece_views[str(record.id)]
	var from: Vector2i = record.from
	var to: Vector2i = record.to
	var to_world: = BoardView.cell_to_world(to)
	var friendly: bool = record.friendly
	if record.bounced:
		Sfx.play(&"move")
		view.bounce_towards(to_world, Settings.duration(0.5))
		await _wait(0.22)
		var guard: PieceView = piece_views[str(record.target_id)]
		if record.shielded:
			_relic_triggered("fortress_stone")
			vfx.ring(guard.global_position + Vector3.UP * 0.05, Palette.GOLD_BRIGHT, 1.1, 0.5)
			vfx.float_text(guard.global_position + Vector3.UP * (guard.top_height() + 0.3), "Fortress", Palette.GOLD_BRIGHT, 56)
		else:
			Sfx.play(&"land", 0.8)
			vfx.ring(guard.global_position + Vector3.UP * 0.05, Palette.MOVE, 1.0, 0.5)
			vfx.float_text(guard.global_position + Vector3.UP * (guard.top_height() + 0.3), "Warded", Palette.MOVE, 56)
		rig.add_trauma(0.15)
		await _wait(0.4)
		return
	var distance: = Board.distance(from, to)
	var style: = "jump" if _is_jump(str(record.kind), from, to) else ("hop" if distance <= 1 else "slide")
	var duration: = Settings.duration(0.24 + 0.07 * distance + (0.12 if style == "jump" else 0.0))
	Sfx.play(&"move" if friendly else &"enemy_move")
	view.travel(to_world, style, duration)
	await get_tree().create_timer(duration).timeout
	Sfx.play(&"land")
	if friendly:
		board_view.pulse_tile(to, Palette.MOVE, 0.3)
	if not record.captured.is_empty():
		_shatter(str(record.captured.id), ChessRules.ROYAL.has(str(record.captured.kind)))
		if friendly:
			vfx.float_text(to_world + Vector3.UP * (view.top_height() + 0.35), "+%d XP" % int(record.xp), Palette.GOLD_BRIGHT, 60)
			if int(record.gold) > 0:
				_relic_triggered("ransom_ledger", false)
				Sfx.play(&"coin")
				vfx.float_text(to_world + Vector3.UP * (view.top_height() + 0.75), "+%d gold" % int(record.gold), Palette.GOLD, 52)
			if gs.relics.has("brilliancy_prize"):
				_relic_triggered("brilliancy_prize", false)
		else:
			rig.add_trauma(0.12)
		if friendly and record.corrupted != NO_CELL:
			var corrupted: Vector2i = record.corrupted
			board_view.show_terrain(gs.battle.board)
			vfx.burst(BoardView.cell_to_world(corrupted, 0.2), Palette.CORRUPTED, 22, 2.0, 0.07)
		await _wait(0.2)
	if record.promoted:
		view.promote(vfx)
		Sfx.play(&"promote")
		vfx.float_text(to_world + Vector3.UP * 1.6, "Promoted", Palette.GOLD_BRIGHT, 60)
		if friendly and gs.relics.has("queening_charter"):
			_relic_triggered("queening_charter", false)
		await _wait(0.55)


func _shatter(id: String, royal: bool) -> void :
	var victim: PieceView = piece_views[id]
	piece_views.erase(id)
	var origin: = victim.global_position
	victim.shatter(vfx, 1.6 if royal else 1.0)
	vfx.burst(origin + Vector3.UP * 0.35, Palette.CAPTURE, 26, 3.0)
	vfx.flash(origin + Vector3.UP * 0.5, Palette.CAPTURE, 2.2, 0.2, 2.2)
	rig.add_trauma(0.55 if royal else 0.32)
	Sfx.play(&"capture")
	Sfx.play(&"shatter", 1.0, -6.0)



func _animate_destroyed(destroyed: Array) -> void :
	if destroyed.is_empty():
		return
	for piece in destroyed:
		var view: PieceView = piece_views[str(piece.id)]
		piece_views.erase(str(piece.id))
		vfx.burst(view.global_position + Vector3.UP * 0.3, Palette.CORRUPTED, 30, 2.4, 0.08)
		vfx.float_text(view.global_position + Vector3.UP * (view.top_height() + 0.3), "Consumed", Palette.CORRUPTED, 54)
		view.shatter(vfx, 1.2)
	Sfx.play(&"shatter")
	rig.add_trauma(0.3)
	await _wait(0.6)


static func _is_jump(kind: String, from: Vector2i, to: Vector2i) -> bool:
	var delta: = (to - from).abs()
	return kind == "knight" or (delta.x != 0 and delta.y != 0 and delta.x != delta.y)


func _battle_over() -> void :
	busy = true
	selected_id = ""
	hint_move = {}
	hover_cell = NO_CELL
	hover_id = ""
	var battle: = gs.battle
	board_view.clear_marks()
	board_view.clear_cursor()
	board_view.hide_arc()
	hud.show_piece({}, {}, 0)
	hud.set_turn("idle", battle.turn)
	hud.set_status("")
	for view: PieceView in piece_views.values():
		view.clear_marks()
		view.set_threatened(false)
	var won: = battle.outcome == "won"
	var reason: = battle.reason
	var boss: = gs.node_type == "boss"
	if won:
		var delay: = 0.15
		for piece in battle.board.enemies():
			piece_views[str(piece.id)].sink(delay)
			piece_views.erase(str(piece.id))
			delay += 0.08
		Sfx.play(&"victory" if boss else &"encounter_won")
		arena.set_mood(1.25, 0.4, 0.8)
		var title: = "%s falls" % str(Encounters.BOSSES[gs.act].name) if boss else "Victory"
		var subtitle: String = {
			"regicide": "The enemy king is taken.", 
			"eliminated": "Every enemy piece is captured.", 
			"routed": "The broken enemy flees the field.", 
			"withdrew": "Outmatched, the enemy withdraws.", 
		}[reason]
		hud.show_banner(title, subtitle, Palette.GOLD_BRIGHT, 1.6)
		if gs.relics.has("appearance_fee"):
			await _wait(0.7)
			_relic_triggered("appearance_fee", false)
			Sfx.play(&"coin")
			vfx.float_text(relic_views["appearance_fee"].top(), "+2 gold", Palette.GOLD, 52)
			await _wait(1.4)
		else:
			await _wait(2.1)
	else:
		var delay: = 0.1
		for piece in battle.board.friendlies():
			piece_views[str(piece.id)].topple(delay)
			delay += 0.07
		Sfx.play(&"lost")
		arena.set_mood(0.5, 0.0, 1.2)
		hud.show_banner("Defeat", str(SummaryScreen.REASONS[reason]), Palette.CAPTURE, 2.0)
		await _wait(2.6)
	gs.finish_battle()
	if gs.phase == "lost":
		_show_summary(false, reason, Profile.record_run_end(gs, false))
		return
	var unlocked: Array[String] = []
	if boss:
		unlocked.append_array(Profile.record_boss(gs))
	if gs.phase == "won":
		unlocked.append_array(Profile.record_run_end(gs, true))
		_show_summary(true, reason, unlocked)
		return
	if _tutorial:
		Profile.mark_tutorial_done()
		_tutorial = false
	for id in unlocked:
		Toast.show_on(overlay, "Unlocked: %s" % str(Profile.UNLOCKS[id].name), Palette.GOLD_BRIGHT, 3.0)
	_route()






func _refresh_board() -> void :
	var battle: = gs.battle
	board_view.clear_marks()
	board_view.hide_arc()
	var player_turn: = battle.is_player_turn() and not busy


	var foresight: = player_turn and gs.relics.has("kibitzers_whisper")
	var attacked: = {}
	if foresight:
		for cell in battle.enemy_attack_cells():
			attacked[cell] = true
		if hover_id != "" and battle.board.has_piece(hover_id) and not battle.board.piece_by_id(hover_id).friendly:
			for cell in ChessRules.attack_cells(battle.board, battle.board.piece_by_id(hover_id)):
				board_view.mark(cell, BoardView.Mark.REACH, Palette.THREAT)
	var threatened: Array[String] = []
	if battle.outcome == "":
		threatened = battle.threatened_ids()
	for id in piece_views:
		var view: PieceView = piece_views[id]
		view.set_threatened(view.friendly and threatened.has(id))
		view.set_selected(id == selected_id)
		view.set_hinted( not hint_move.is_empty() and id == str(hint_move.id) and id != selected_id)
		view.set_targeted(false)
		view.set_hovered(player_turn and id == hover_id)
	if player_turn and selected_id != "":
		var piece: = battle.board.piece_by_id(selected_id)
		var follow: = battle.in_follow_up()
		var moves: = battle.moves_for(selected_id)
		board_view.mark(piece.cell, BoardView.Mark.SELECTED, Palette.SELECT)
		for cell in moves:
			var target: = battle.board.piece_at(cell)
			if target.is_empty():
				var tile_color: = Palette.CHAIN if follow else Palette.MOVE
				if attacked.has(cell):
					board_view.mark(cell, BoardView.Mark.DANGER, tile_color)
				else:
					board_view.mark(cell, BoardView.Mark.CHAIN if follow else BoardView.Mark.MOVE, tile_color)
			else:
				board_view.mark(cell, BoardView.Mark.CAPTURE, Palette.CAPTURE)
				piece_views[str(target.id)].set_targeted(true)
		if moves.has(hover_cell):
			var capture: = not battle.board.piece_at(hover_cell).is_empty()
			var color: = Palette.CAPTURE if capture else (Palette.CHAIN if follow else Palette.MOVE)
			board_view.show_arc(piece.cell, hover_cell, _is_jump(str(piece.kind), piece.cell, hover_cell), color)
	if player_turn and not hint_move.is_empty():
		board_view.mark(hint_move.to, BoardView.Mark.HINT, Palette.HINT)
	if player_turn and keyboard_mode:
		board_view.set_cursor(cursor_cell, BoardView.Mark.CURSOR, Palette.INK)
	elif player_turn and hover_cell != NO_CELL:
		board_view.set_cursor(hover_cell, BoardView.Mark.HOVER, Palette.INK)
	else:
		board_view.clear_cursor()
	_refresh_turn_bar()


func _refresh_turn_bar() -> void :
	var battle: = gs.battle
	if not battle.is_player_turn():
		hud.set_turn("enemy" if battle.outcome == "" else "idle", battle.turn)
		return
	var can_move: = not battle.movable_ids().is_empty()
	hud.set_turn("player", battle.turn, battle.in_follow_up(), can_move)
	if busy:
		return
	hud.set_status(_status_text(can_move))


func _status_text(can_move: bool) -> String:
	var battle: = gs.battle
	if not hint_move.is_empty():
		var piece: = battle.board.piece_by_id(str(hint_move.id))
		return "Hint: your %s to %s." % [UiKit.piece_name(piece.kind).to_lower(), _cell_name(hint_move.to)]
	if battle.in_follow_up():
		var kind_name: = UiKit.piece_name(battle.board.piece_by_id(battle.active_id).kind).to_lower()
		if battle.bonus_captures > 0 and battle.bonus_moves == 0 and battle.bonus_quiet == 0:
			return "Chain: your %s may capture again." % kind_name
		if battle.bonus_quiet > 0 and battle.bonus_moves == 0 and battle.bonus_captures == 0:
			return "Charge: your %s may step back to safety." % kind_name
		return "Your %s may move again." % kind_name
	if battle.player_in_check():
		return "Your king is in check."
	if Battle.TURN_LIMIT - battle.turn < Battle.LIMIT_WARNING:
		return "At turn %d the field goes to the stronger army." % Battle.TURN_LIMIT
	if not can_move:
		return "No legal moves. Pass the turn."
	if _tutorial and selected_id == "" and battle.turn <= 2:
		return "Select a piece. Blue squares are moves, red squares are captures."
	if _tutorial and selected_id != "" and battle.turn <= 2:
		return "Choose a square. The enemy moves after you."
	return ""


func _cell_name(cell: Vector2i) -> String:
	return "%s%d" % [FILES[cell.x], Board.SIZE - cell.y]



func _show_card() -> void :
	var battle: = gs.battle
	var id: = hover_id if hover_id != "" else selected_id
	if id == "" or not battle.board.has_piece(id):
		hud.show_piece({}, {}, 0)
		return
	var piece: = battle.board.piece_by_id(id)
	if not piece.friendly:
		hud.show_piece(piece, {}, 0)
		return
	var entry: = gs.army_entry(id).duplicate()
	entry.xp = int(entry.xp) + int(battle.xp_gained[id])
	hud.show_piece(piece, entry, gs.next_threshold(entry))




func _unhandled_input(event: InputEvent) -> void :
	if gs == null or screen == Screen.MENU or screen == Screen.SUMMARY:
		return
	if screen != Screen.BATTLE:
		if event.is_action_pressed("pause"):
			get_viewport().set_input_as_handled()
			_open_pause()
		return
	if event.is_action_pressed("pause"):
		get_viewport().set_input_as_handled()
		if selected_id != "" and not busy and not gs.battle.in_follow_up():
			_deselect()
		else:
			_open_pause()
		return
	if event.is_action_pressed("help"):
		_open_help()
		return
	if busy or not gs.battle.is_player_turn() or _modal_open():
		return
	if event is InputEventMouseMotion:
		keyboard_mode = false
		_update_hover(event.position)
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			keyboard_mode = false
			var hit: = _pick(event.position)
			if hit.cell != NO_CELL:
				act_at(hit.cell)
			elif not gs.battle.in_follow_up():
				_deselect()
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			if event.pressed:
				_right_press = event.position
			elif event.position.distance_to(_right_press) < 6.0:
				_deselect()
	elif event.is_action_pressed("confirm"):
		if gs.battle.in_follow_up() or gs.battle.movable_ids().is_empty():
			_end_turn()
	elif event.is_action_pressed("undo"):
		_deselect()
	elif event.is_action_pressed("hint"):
		_hint()
	elif event.is_action_pressed("cycle_piece"):
		_cycle_piece()
	elif event.is_action_pressed("cursor_act"):
		keyboard_mode = true
		act_at(cursor_cell)
	else:
		for action in CURSOR_STEPS:
			if event.is_action_pressed(action, true):
				_move_cursor(action)
				break


func _modal_open() -> bool:
	for child in overlay.get_children():
		if child is Modal:
			return true
	return false




func _pick(screen_position: Vector2) -> Dictionary:
	var camera: = rig.camera
	var board: = gs.battle.board
	var origin: = camera.project_ray_origin(screen_position)
	var direction: = camera.project_ray_normal(screen_position)
	var floor_cell: = board_view.cell_from_ray(origin, direction)
	var cell: = floor_cell
	var query: = PhysicsRayQueryParameters3D.create(origin, origin + direction * 100.0, PieceView.PICK_LAYER)
	var hit: = get_world_3d().direct_space_state.intersect_ray(query)
	if not hit.is_empty():
		var id: = str(hit.collider.get_meta("piece_id"))
		if board.has_piece(id):
			cell = board.piece_by_id(id).cell
	if selected_id != "" and cell != floor_cell:
		var moves: = gs.battle.moves_for(selected_id)
		if not moves.has(cell) and moves.has(floor_cell):
			cell = floor_cell
	var standing: = board.piece_at(cell) if cell != NO_CELL else {}
	return {"cell": cell, "id": "" if standing.is_empty() else str(standing.id)}



func cell_screen_position(cell: Vector2i, height: = 0.3) -> Vector2:
	return rig.camera.unproject_position(BoardView.cell_to_world(cell, height))


func _update_hover(screen_position: Vector2) -> void :
	var hit: = _pick(screen_position)
	if hit.cell == hover_cell and hit.id == hover_id:
		return
	hover_cell = hit.cell
	hover_id = hit.id
	_show_card()
	_refresh_board()


func _move_cursor(action: String) -> void :
	keyboard_mode = true
	var step: Vector2i = CURSOR_STEPS[action]
	cursor_cell = (cursor_cell + step).clamp(Vector2i.ZERO, Vector2i(Board.SIZE - 1, Board.SIZE - 1))
	hover_cell = cursor_cell
	var piece: = gs.battle.board.piece_at(cursor_cell)
	hover_id = "" if piece.is_empty() else str(piece.id)
	Sfx.play(&"ui_hover", 1.0, -8.0)
	_show_card()
	_refresh_board()


func _cycle_piece() -> void :
	if gs.battle.in_follow_up():
		return
	var movable: = gs.battle.movable_ids()
	if movable.is_empty():
		return
	var next: = movable[(movable.find(selected_id) + 1) % movable.size()]
	keyboard_mode = true
	_select(next)




func _hint() -> void :
	if busy or screen != Screen.BATTLE or not gs.battle.is_player_turn():
		return
	if gs.hints_left == 0:
		_reject("No hints left this run.")
		return
	var move: = gs.hint()
	if move.is_empty():
		_reject("There is no move to suggest.")
		return
	Profile.save_run(gs)
	hint_move = move
	selected_id = str(move.id)
	Sfx.play(&"relic_trigger", 1.3, -6.0)
	hud.refresh(gs)
	_show_card()
	_refresh_board()


func _use_clock_key() -> void :
	if busy or screen != Screen.BATTLE or not gs.battle.use_clock_key():
		return
	_clock_key_armed = true
	Profile.save_run(gs)
	_relic_triggered("clockmakers_key")
	hud.refresh(gs)
	Toast.show_on(overlay, "The clock is wound: you move again before the enemy.", Palette.CHAIN, 2.0)




func _set_screen_node(node: Control) -> void :
	if is_instance_valid(_screen_node):
		_screen_node.queue_free()
	_screen_node = node
	if node != null:
		overlay.add_child(node)
		overlay.move_child(node, 0)


func _clear_overlays() -> void :
	for child in overlay.get_children():
		child.queue_free()
	_screen_node = null


func _open_pause() -> void :
	if gs == null or busy:
		return
	for child in overlay.get_children():
		if child is PauseMenu:
			return
	var pause: = PauseMenu.new()
	pause.setup(gs)
	pause.show_help.connect(_open_help)
	pause.show_settings.connect(_open_settings)
	pause.restart_run.connect(_restart_run)
	pause.quit_to_menu.connect( func() -> void :
		Profile.save_run(gs)
		show_menu())
	overlay.add_child(pause)


func _open_help() -> void :
	for child in overlay.get_children():
		if child is HelpPanel:
			return
	overlay.add_child(HelpPanel.new())


func _open_settings() -> void :
	var panel: = SettingsPanel.new()
	panel.closed.connect( func() -> void :
		if screen == Screen.BATTLE:
			_refresh_board())
	overlay.add_child(panel)


func _wait(seconds: float) -> void :
	await get_tree().create_timer(Settings.duration(seconds)).timeout
