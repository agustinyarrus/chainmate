extends Node












const SIZES: Array[Vector2i] = [Vector2i(1280, 720), Vector2i(1920, 1080), Vector2i(1024, 768), Vector2i(2560, 1080)]
const HOME_SIZE: = Vector2i(1600, 900)
const TIME_LIMIT_MSEC: = 20 * 60 * 1000

var main: Node
var _out: = ""
var _seed: = "TOUR-7"
var _acts: = 3
var _arena_only: = false
var _pieces_only: = false
var _relics_only: = false
var _perf: = false
var _menu_only: = false

const HITCH_MS: = 50.0
var _hitches: = false
var _last_frame: = 0
var _slow: Array[Array] = []
var _video: = false
var _bench: = false

const VIDEO_ENCOUNTERS: = 3
var _failures: = 0
var _index: = 0
var _seen: = {}
var _rng: = RandomNumberGenerator.new()
var _started: = 0


func _ready() -> void :
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_out = arg.trim_prefix("--out=")
		elif arg.begins_with("--seed="):
			_seed = arg.trim_prefix("--seed=")
		elif arg.begins_with("--acts="):
			_acts = int(arg.trim_prefix("--acts="))
		elif arg == "--arena":
			_arena_only = true
		elif arg == "--pieces":
			_pieces_only = true
		elif arg == "--relics":
			_relics_only = true
		elif arg == "--perf":
			_perf = true
		elif arg == "--menu":
			_menu_only = true
		elif arg == "--hitches":
			_hitches = true
		elif arg == "--video":
			_video = true
		elif arg == "--bench":
			_bench = true
	assert (_video or _bench or _perf or _out != "", "the capture tour needs --out=<folder>")
	if not _video and not _bench and not _perf:
		DirAccess.make_dir_recursive_absolute(_out)
	_rng.seed = 7
	_started = Time.get_ticks_msec()
	Settings.set_value("animation_speed", 1.5)
	if _bench:
		_benchmark.call_deferred()
	elif _arena_only:
		_arena_tour.call_deferred()
	elif _pieces_only:
		_piece_lineup.call_deferred()
	elif _relics_only:
		_relic_showcase.call_deferred()
	elif _perf:
		_performance.call_deferred()
	elif _menu_only:
		_menu_shot.call_deferred()
	else:
		_run.call_deferred()


func _process(_delta: float) -> void :
	if _hitches:
		var now: = Time.get_ticks_usec()
		if _last_frame > 0 and (now - _last_frame) / 1000.0 > HITCH_MS:
			var side: String = main.gs.battle.side if main.gs != null and main.gs.battle != null else "-"
			_slow.append([(now - _last_frame) / 1000.0, (Time.get_ticks_msec() - _started) / 1000.0, main.screen, side])
		_last_frame = now
	if Time.get_ticks_msec() - _started > TIME_LIMIT_MSEC:
		_check(false, "tour finished within %d minutes" % (TIME_LIMIT_MSEC / 60000))
		_finish()


func _run() -> void :
	await _wait(0.5)
	main.show_menu()
	await _wait(2.8)
	await _shot("menu")
	if not _video:
		var credits: = CreditsPanel.new()
		main.overlay.add_child(credits)
		await _wait(0.6)
		var text: = ""
		for label in credits.find_children("*", "Label", true, false):
			text += (label as Label).text
		_check(text.contains("Godot Engine contributors") and text.contains("Cinzel Project Authors") and text.contains("Cormorant Project Authors"), "the credits carry the Godot and font licence notices")
		await _shot("credits")
		_close_modals()
		await _wait(0.3)
	main._open_new_run()
	await _wait(1.2 if _video else 0.7)
	await _shot("new_run")
	_close_modals()
	await _wait(0.2)

	main.start_run({"seed": _seed, "army": "vanguard", "difficulty": "standard"})
	await _wait(1.4)
	_check(main.gs.phase == "reward" and _find(RewardScreen) != null, "a new run opens on the first relic choice")
	await _shot("opening_relic")
	var resumed: = false
	while main.gs != null and main.gs.act < _acts and main.screen != main.Screen.SUMMARY:
		if _video and main.gs.encounters_won >= VIDEO_ENCOUNTERS:
			await _wait(2.0)
			_finish()
			return
		if main.screen == main.Screen.BATTLE:
			await _play_battle()
		elif main.screen == main.Screen.MAP:
			if not resumed and main.gs.encounters_won == 1 and not _video:
				resumed = true
				await _resume_from_menu()
			await _choose_on_map()
		elif main.screen == main.Screen.STOP:
			await _handle_stop()
		else:
			_check(false, "tour reached an unexpected screen %d" % main.screen)
			break
		await _wait(0.1)
	await _wait(1.0)
	if main.screen == main.Screen.SUMMARY:
		await _shot("summary")
		_check(true, "the run ends on the summary (%s, %d encounters won)" % [main.gs.phase, main.gs.encounters_won])
	else:
		_check(main.gs.act >= _acts, "the tour played %d act(s)" % _acts)
	_finish()



func _arena_tour() -> void :
	await _wait(0.5)
	main.start_run({"seed": _seed, "army": "vanguard", "difficulty": "standard"})
	await _wait(0.8)
	main.gs.skip_relic()
	main._leave_stop()
	await _wait(0.6)
	main._choose_node(0)
	await _wait(2.5)
	main.hud.visible = false
	for variant in Arena.VARIANTS:
		main.arena.set_variant(variant)
		main.rig.reset_view()
		await _wait(1.8)
		await _shot("arena_%s" % variant)
		main.rig.target_pitch = 0.68
		main.rig.target_yaw = CameraRig.DEFAULT_YAW - 0.7
		await _wait(1.8)
		await _shot("arena_%s_low" % variant)
	_finish()



func _piece_lineup() -> void :
	await _wait(0.5)
	main.start_run({"seed": _seed, "army": "vanguard", "difficulty": "standard"})
	await _wait(0.8)
	main.gs.skip_relic()
	main._leave_stop()
	await _wait(0.6)
	main._choose_node(0)
	await _wait(2.0)
	main.hud.visible = false
	main.board_view.clear_marks()
	main._clear_pieces()
	var kinds: Array[String] = ["pawn", "rook", "knight", "bishop", "queen", "king"]
	var rows: = [[5, true, 0], [4, true, 1], [3, true, 2], [2, true, 3], [1, false, 0], [0, false, 2]]
	for row in rows:
		for x in kinds.size():
			var piece: = Board.make_piece("lineup_%d_%d" % [row[0], x], kinds[x], row[1], Vector2i(x, row[0]), row[2])
			main._spawn_piece(piece)
	main.rig.set_safe_area(-0.95, 0.95, -0.95, 0.95)
	main.rig.target_pitch = 0.62
	main.rig.target_yaw = 0.0
	await _wait(2.0)
	await _shot("pieces_all")
	main.rig.target_pitch = 0.32
	main.rig.target_zoom = 0.55
	main.rig.target_focus = Vector3(0, 0, 1.6)
	await _wait(2.0)
	await _shot("pieces_ivory_front")
	main.rig.target_focus = Vector3(0, 0, -0.6)
	await _wait(2.0)
	await _shot("pieces_ivory_late")
	main.rig.target_yaw = PI
	main.rig.target_focus = Vector3(0, 0, -1.8)
	await _wait(2.5)
	await _shot("pieces_obsidian")

	for kind in ["knight", "bishop", "queen", "king", "rook", "pawn"]:
		main._clear_pieces()
		for tier in 4:
			main._spawn_piece(Board.make_piece("show_%d" % tier, kind, true, Vector2i(3, 5 - tier), tier))
		main._spawn_piece(Board.make_piece("show_enemy", kind, false, Vector2i(3, 1), 2))
		main.rig.target_yaw = PI * 0.5 + 0.35
		main.rig.target_pitch = 0.2
		main.rig.target_zoom = 0.5
		main.rig.target_focus = Vector3(0.5, 0.25, 0.6)
		await _wait(1.6)
		await _shot("profile_%s" % kind)
	main.rig.frame_board()
	main.rig.reset_view()
	main.rig.release_focus()
	await _wait(2.5)
	await _shot("pieces_game_view")

	var sheet: = GridContainer.new()
	sheet.columns = 6
	sheet.add_theme_constant_override("h_separation", 28)
	sheet.add_theme_constant_override("v_separation", 18)
	for id in Relics.ids():
		var cell: = UiKit.vbox(6)
		cell.add_child(RelicToken.make(id, 96))
		cell.add_child(UiKit.caption(Relics.display_name(id), Palette.INK, 12))
		sheet.add_child(cell)
	main.overlay.add_child(UiKit.centered(sheet))
	await _wait(0.6)
	await _shot("relic_icons")
	_finish()




func _relic_showcase() -> void :
	await _wait(0.5)
	main.start_run({"seed": _seed, "army": "vanguard", "difficulty": "standard"})
	await _wait(0.8)
	main.gs.skip_relic()
	main._leave_stop()
	await _wait(0.6)
	main._choose_node(0)
	await _wait(2.0)
	main.hud.visible = false
	main.board_view.clear_marks()
	main._clear_pieces()
	var shelf: = Node3D.new()
	main.add_child(shelf)
	var ids: = Relics.ids()
	for i in ids.size():
		var view: = RelicView.new()
		shelf.add_child(view)
		view.setup(ids[i])
		view.place(BoardView.cell_to_world(Vector2i(i % 6, (i / 6) * 2)))
	main.rig.set_safe_area(-0.95, 0.95, -0.95, 0.95)
	main.rig.target_yaw = 0.0
	main.rig.target_pitch = 0.62
	await _wait(2.0)
	await _shot("relics_all")
	for row in 3:
		var left: = BoardView.cell_to_world(Vector2i(0, row * 2))
		var right: = BoardView.cell_to_world(Vector2i(5, row * 2))
		main.rig.target_yaw = 0.0
		main.rig.target_pitch = 0.5
		main.rig.target_zoom = 0.5
		main.rig.target_focus = left.lerp(right, 0.5) + Vector3(0, 0.3, 0)
		await _wait(2.0)
		await _shot("relics_row_%d" % row)
	shelf.queue_free()
	main.rig.frame_board()
	main.rig.reset_view()
	main.rig.release_focus()
	main.gs.relics.assign(["kibitzers_whisper", "fortress_stone", "clockmakers_key", "brilliancy_prize", "salt_horn", "grandmaster_norm"])
	main.enter_battle(false)
	main._clear_relics()
	await _wait(1.5)
	main._sync_relics(true)
	await _wait(0.45)
	await _shot("relics_dropping")
	await _wait(2.0)
	await _shot("relics_game_view")
	main._relic_triggered("fortress_stone")
	await _wait(0.22)
	await _shot("relic_trigger")
	await _wait(1.0)
	main.hud.visible = false
	for variant in Arena.VARIANTS:
		main._set_variant(variant)
		main.rig.target_pitch = 0.55
		main.rig.target_zoom = 0.62
		main.rig.target_focus = Vector3(0, 0.3, 2.6)
		await _wait(1.8)
		await _shot("relics_rim_%s" % variant)
	_finish()



func _menu_shot() -> void :
	await _wait(0.5)
	main.show_menu()
	await _wait(4.0)
	await _shot("menu")
	_finish()





func _performance() -> void :
	await _wait(0.5)
	print("PERF renderer=%s adapter=%s size=%s sfx_ms=%.0f music_ms=%.0f" % [RenderingServer.get_current_rendering_method(), RenderingServer.get_video_adapter_name(), get_viewport().get_visible_rect().size, Sfx.build_msec, Sfx.music_msec])
	main.start_run({"seed": _seed, "army": "vanguard", "difficulty": "standard"})
	await _wait(0.8)
	main.gs.skip_relic()
	main._leave_stop()
	await _wait(0.6)
	main._choose_node(0)
	await _wait(2.5)
	for variant in Arena.VARIANTS:
		main._set_variant(variant)
		for relics: Array[String] in [[] as Array[String], ["desperado_ribbon", "brilliancy_prize", "clockmakers_key", "fianchetto_glass", "grandmaster_norm", "opening_book"] as Array[String]]:
			main.gs.relics.assign(relics)
			main._clear_relics()
			main._sync_relics(false)
			await _wait(0.8)
			await _sample("%s relics=%d" % [variant, relics.size()])
	_finish()


func _sample(label: String) -> void :
	var times: = PackedFloat64Array()
	var draws: = 0.0
	var objects: = 0.0
	var primitives: = 0.0
	var last: = Time.get_ticks_usec()
	for i in 180:
		await get_tree().process_frame
		var now: = Time.get_ticks_usec()
		times.append((now - last) / 1000.0)
		last = now
		draws += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
		objects += Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)
		primitives += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
	times.sort()
	var n: = times.size()
	print("PERF %s frame_ms p50=%.1f p90=%.1f p99=%.1f draws=%d objects=%d primitives=%dk" % [label, times[n / 2], times[int(n * 0.9)], times[int(n * 0.99)], roundi(draws / n), roundi(objects / n), roundi(primitives / n / 1000.0)])




func _benchmark() -> void :
	await _wait(0.5)
	print("BENCH sfx_build_ms=%.0f renderer=%s" % [Sfx.build_msec, RenderingServer.get_current_rendering_method()])
	for difficulty in GameState.DIFFICULTIES:
		var depth: = int(GameState.DIFFICULTIES[difficulty].ai_depth)
		var worst: = 0.0
		var total: = 0.0
		var runs: = 0
		for i in 3:
			for node in [0, 2, 4]:
				var gs: = GameState.new()
				gs.new_run({"seed": "BENCH-%d" % i, "difficulty": difficulty})
				gs.skip_relic()
				gs.leave()
				gs.step = node
				gs.choose_node(gs.current_nodes().size() - 1)
				var started: = Time.get_ticks_usec()
				Tactics.best_move(gs.battle.board, false, depth, gs.rng, 0.0)
				var ms: = (Time.get_ticks_usec() - started) / 1000.0
				worst = maxf(worst, ms)
				total += ms
				runs += 1
				await get_tree().process_frame
		print("BENCH %s depth=%d mean_ms=%.0f worst_ms=%.0f" % [difficulty, depth, total / runs, worst])
	_finish()


func _finish() -> void :
	if _hitches:
		var over: = [0, 0, 0]
		for entry in _slow:
			for i in 3:
				if float(entry[0]) > [50.0, 100.0, 250.0][i]:
					over[i] += 1
		print("HITCH frames over 50/100/250 ms: %d / %d / %d" % over)
		_slow.sort_custom( func(a: Array, b: Array) -> bool: return float(a[0]) > float(b[0]))
		for entry in _slow.slice(0, 25):
			print("HITCH %.0f ms at %.1fs screen=%d side=%s" % entry)
	print("TOUR DONE shots=%d failures=%d time=%.0fs" % [_index, _failures, (Time.get_ticks_msec() - _started) / 1000.0])
	get_tree().quit(1 if _failures > 0 else 0)




func _play_battle() -> void :
	var first: = not _seen.has("battle_intro")
	await _wait(0.9)
	await _shot_once("battle_intro" if main.gs.node_type != "boss" else "boss_intro_act%d" % (main.gs.act + 1))
	await _until_idle()
	await _wait(1.6)
	await _shot_once("battle_act%d" % (main.gs.act + 1))
	if first and not _video:
		await _check_sizes()
		await _try_keyboard()
	while main.screen == main.Screen.BATTLE:
		await _until_idle()
		if main.screen != main.Screen.BATTLE:
			break
		var battle: Battle = main.gs.battle
		if not battle.is_player_turn():
			await _wait(0.2)
			continue
		if battle.threatened_ids().size() > 0:
			await _shot_once("threatened_piece")
		if battle.player_in_check():
			await _shot_once("check")
		if battle.turn == 2 and not _seen.has("hint"):
			main._hint()
			await _wait(0.5)
			_check( not main.hint_move.is_empty(), "a hint suggests a move")
			await _shot_once("hint")
		await _take_turn(battle)


func _take_turn(battle: Battle) -> void :
	var allowed: = battle.allowed_moves()
	if battle.in_follow_up():
		await _shot_once("follow_up")
		allowed = allowed.filter( func(m: Dictionary) -> bool: return not battle.board.piece_at(m.to).is_empty())
		if allowed.is_empty():
			_press(KEY_ENTER)
			await _wait(0.3)
			_check( not battle.in_follow_up(), "Enter ends a follow-up")
			return
	if allowed.is_empty():
		main._end_turn()
		return
	var move: = Tactics.best_move(battle.board, true, 2, _rng, 0.0, allowed)
	await _move_with_mouse(battle, str(move.id), move.to)


func _move_with_mouse(battle: Battle, id: String, to: Vector2i) -> void :
	var piece: = battle.board.piece_by_id(id)
	if _video:
		await _wait(0.15)
	if main.selected_id != id:
		await _click_cell(piece.cell)
		_check_once("select", main.selected_id == id, "clicking a piece selects it through the raycast")
		await _wait(0.3)
		await _shot_once("piece_selected")
	await _hover_cell(to)
	await _wait(0.35 if _video else 0.25)
	var capture: = not battle.board.piece_at(to).is_empty()
	await _shot_once("capture_preview" if capture else "move_preview")
	var before: = battle.board.to_data()
	await _click_cell(to)
	var moved: = battle.board.to_data() != before
	_check_once("move", moved, "clicking a destination plays the move")
	if not moved:
		print("TOUR note: %s %s -> %s was not played (selected '%s')" % [piece.kind, piece.cell, to, main.selected_id])
		_finish()
	if capture:
		await _wait(0.42)
		await _shot_once("capture_impact")


func _try_keyboard() -> void :
	_press(KEY_TAB)
	await _wait(0.35)
	_check(main.selected_id != "", "Tab selects a movable piece")
	await _shot("keyboard_select")
	_press(KEY_BACKSPACE)
	await _wait(0.2)
	_check(main.selected_id == "", "Backspace clears the selection")


func _check_sizes() -> void :
	for size in SIZES:
		DisplayServer.window_set_size(size)
		await _wait(0.7)
		await _shot("size_%dx%d" % [size.x, size.y])
	DisplayServer.window_set_size(HOME_SIZE)
	await _wait(0.7)




func _choose_on_map() -> void :
	await _wait(0.9)
	await _shot_once("map_act%d" % (main.gs.act + 1))
	var nodes: Array = main.gs.current_nodes()
	var index: = 0
	var labels: = {"merchant": "stop_merchant", "unknown": "stop_event", "rest": "stop_rest", "elite": "reward_elite"}
	for kind in labels:
		if not _seen.has(labels[kind]) and nodes.has(kind):
			index = nodes.find(kind)
			break

	var map: = _find(MapScreen) as MapScreen
	var view: MapScreen.MapView = map._view
	_tap(view.get_global_transform_with_canvas() * view._positions()[main.gs.step][index])
	await _wait(0.3)
	_check_once("map_tap", main.screen != main.Screen.MAP, "tapping a map node chooses it")


func _handle_stop() -> void :
	await _wait(1.0)
	var levels: = _find(LevelUpScreen) as LevelUpScreen
	if levels != null:
		await _shot_once("level_up")
		var choices: Array[String] = main.gs.current_level_choices()
		if choices.is_empty():
			levels._skip()
		else:
			levels._choose(choices[0])
		return
	var gs: GameState = main.gs
	match gs.phase:
		"reward":
			var reward: = _find(RewardScreen) as RewardScreen
			if reward == null:
				return
			await _shot_once("reward_%s" % str(gs.reward.kind))
			if not gs.reward.relic_taken:
				var choices: Array = gs.reward.relic_choices
				var pick: = str(choices[0])
				for preferred in ["kibitzers_whisper", "desperado_ribbon", "fortress_stone"]:
					if choices.has(preferred):
						pick = preferred
				if gs.relics.size() < Relics.MAX_EQUIPPED:
					reward._choose(pick)
				else:
					reward._skip()
				await _wait(0.4)
			reward._finish()
		"merchant":
			var shop: = _find(MerchantScreen) as MerchantScreen
			if shop == null:
				return
			await _shot_once("stop_merchant")
			for i in gs.shop.relics.size():
				if gs.buy_relic(i):
					shop.changed.emit()
					break
			await _wait(0.4)
			if _find(LevelUpScreen) == null:
				shop.leave.emit()
				shop.queue_free()
		"rest":
			var rest: = _find(RestScreen) as RestScreen
			if rest == null:
				return
			await _shot_once("stop_rest")
			if not gs.rest_done:
				var moved: = gs.rest_revive(0) if not gs.fallen.is_empty() else gs.rest_train(_best_piece(gs))
				if not moved:
					moved = gs.rest_fortify()
				_check(moved, "a rest action applies")
				rest.changed.emit()
				await _wait(1.4)
				await _shot_once("rest_evolve")
			if _find(LevelUpScreen) == null:
				rest.leave.emit()
				rest.queue_free()
		"event":
			var event: = _find(EventScreen) as EventScreen
			if event == null:
				return
			await _shot_once("stop_event")
			if not gs.event.resolved:
				var choices: Array = Events.info(str(gs.event.id)).choices
				for i in choices.size():
					if gs.event_choice_available(i):
						gs.event_choose(i)
						break
				event.refresh()
				event.changed.emit()
				await _wait(0.5)
				await _shot_once("event_outcome")
			if _find(LevelUpScreen) == null:
				event.leave.emit()
				event.queue_free()
	await _wait(0.3)


func _resume_from_menu() -> void :
	var phase: String = main.gs.phase
	var gold: int = main.gs.gold
	main.show_menu()
	await _wait(1.6)
	await _shot("menu_with_save")
	main.continue_run()
	await _wait(1.2)
	_check(main.gs != null and main.gs.phase == phase and main.gs.gold == gold, "Continue restores the saved run")


func _best_piece(gs: GameState) -> String:
	var best: = ""
	var best_value: = -1
	for entry in gs.army:
		if int(entry.level) < GameState.MAX_LEVEL and entry.kind != "king":
			var value: = int(ChessRules.MATERIAL[entry.kind]) * 10 + int(entry.xp)
			if value > best_value:
				best_value = value
				best = str(entry.id)
	return best




func _find(type: Variant) -> Node:
	for child in main.overlay.get_children():
		if is_instance_of(child, type) and not child.is_queued_for_deletion():
			return child
	return null


func _click_cell(cell: Vector2i) -> void :
	var position: = _cell_position(cell)
	_motion(position)
	await get_tree().process_frame
	for pressed in [true, false]:
		var click: = InputEventMouseButton.new()
		click.button_index = MOUSE_BUTTON_LEFT
		click.pressed = pressed
		click.position = position
		get_viewport().push_input(click, true)
	await get_tree().process_frame


func _tap(position: Vector2) -> void :
	for pressed in [true, false]:
		var click: = InputEventMouseButton.new()
		click.button_index = MOUSE_BUTTON_LEFT
		click.pressed = pressed
		click.position = position
		get_viewport().push_input(click, true)


func _hover_cell(cell: Vector2i) -> void :
	_motion(_cell_position(cell))
	await get_tree().process_frame


func _cell_position(cell: Vector2i) -> Vector2:
	var occupied: bool = not main.gs.battle.board.piece_at(cell).is_empty()
	return main.cell_screen_position(cell, 0.25 if occupied else 0.06)


func _motion(position: Vector2) -> void :
	var motion: = InputEventMouseMotion.new()
	motion.position = position
	get_viewport().push_input(motion, true)


func _press(key: Key) -> void :
	for pressed in [true, false]:
		var event: = InputEventKey.new()
		event.physical_keycode = key
		event.keycode = key
		event.pressed = pressed
		get_viewport().push_input(event, true)


func _close_modals() -> void :
	for child in main.overlay.get_children():
		if child is Modal:
			child.queue_free()


func _until_idle(limit: = 20.0) -> void :
	var waited: = 0.0
	await _wait(0.1)
	while main.busy and waited < limit:
		await _wait(0.1)
		waited += 0.1
	_check_once("idle", waited < limit, "animations settle")


func _wait(seconds: float) -> void :
	await get_tree().create_timer(seconds).timeout


func _shot_once(label: String) -> void :
	if _seen.has(label):
		return
	_seen[label] = true
	await _shot(label)


func _shot(label: String) -> void :
	if _video:
		await _wait(0.5)
		return
	await RenderingServer.frame_post_draw
	_index += 1
	var path: = _out.path_join("%02d_%s.png" % [_index, label])
	get_viewport().get_texture().get_image().save_png(path)
	print("TOUR shot %s" % path)


func _check_once(key: String, ok: bool, label: String) -> void :
	if ok and _seen.has("check_" + key):
		return
	_seen["check_" + key] = true
	_check(ok, label)


func _check(ok: bool, label: String) -> void :
	if ok:
		print("TOUR PASS %s" % label)
	else:
		_failures += 1
		print("TOUR FAIL %s" % label)
